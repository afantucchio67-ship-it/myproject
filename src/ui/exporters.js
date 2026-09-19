/**
 * Esportazioni: report JSON, CSV, mesh STL/OBJ, immagine PNG.
 * Funzioni pure (usate anche dalla riga di comando), tranne `scarica`.
 */

import { transformDir, transformPoint } from '../viewer/mat4.js';

export function scarica(nomeFile, contenuto, tipo = 'text/plain') {
  const blob = contenuto instanceof Blob ? contenuto : new Blob([contenuto], { type: tipo + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const num = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
const unita = (model) => (model.units && model.units.simbolo) || 'mm';
const partiDaEsportare = (model, opts) =>
  model.parti.filter((p) => !(opts.soloVisibili && p.visibile === false));

/** Report completo (senza le mesh) in JSON. */
export function reportJSON(model) {
  const parti = model.parti.map((p) => ({
    nome: p.nome,
    percorso: p.percorso,
    tipo: p.tipo,
    idEntita: p.id,
    visibile: p.visibile !== false,
    triangoli: p.mesh.indices.length / 3,
    facce: p.facce.map((f) => ({
      id: f.id,
      tipoSuperficie: f.tipoSuperficie,
      area: num(f.area),
      triangoli: f.triangoli,
      info: f.infoSuperficie || undefined,
    })),
    area: num(p.area),
    volume: num(p.volume),
    volumeEsatto: p.volumeEsatto,
    volumeAffidabile: p.volumeAffidabile,
    bordiAperti: p.bordiAperti,
    chiusa: p.chiusa,
    centroide: p.centroide.map(num),
    bbox: { min: p.bbox.min.map(num), max: p.bbox.max.map(num), dimensioni: p.bbox.size.map(num) },
    matrice: p.matrice.map(num),
  }));
  const albero = (n) => ({
    nome: n.nome,
    prodotto: n.prodotto,
    versione: n.versione,
    idDefinizione: n.id,
    elementiGeometrici: n.items.map((i) => i.item.id),
    figli: n.figli.map(albero),
  });
  return JSON.stringify(
    {
      file: model.nomeFileCaricato || model.header.nomeFile,
      unitaDiLunghezza: unita(model),
      intestazione: model.header,
      unita: model.units,
      prodotti: model.prodotti,
      assieme: model.assieme.map(albero),
      parti,
      boundingBoxGlobale: {
        min: model.bbox.min.map(num),
        max: model.bbox.max.map(num),
        dimensioni: model.bbox.size.map(num),
      },
      proprieta: model.proprieta,
      organizzazione: model.organizzazione,
      layer: model.layer,
      riepilogoGeometria: model.geometria,
      statistiche: model.statistiche,
      conteggiTipiEntita: model.conteggiTipi,
      diagnostica: model.diagnostics,
    },
    null,
    2,
  );
}

function csvRighe(righe) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // BOM: Excel riconosce l'UTF-8 e il separatore ';' delle impostazioni italiane
  return '﻿' + righe.map((r) => r.map(esc).join(';')).join('\r\n');
}

/** CSV con una riga per faccia (utile per preventivi e controlli). */
export function facceCSV(model) {
  const u = unita(model);
  const righe = [['parte', 'percorso', 'id_faccia', 'tipo_superficie', `area_${u}2`, 'triangoli', 'dettagli']];
  for (const p of model.parti) {
    for (const f of p.facce) {
      righe.push([
        p.nome,
        p.percorso,
        f.id,
        f.tipoSuperficie,
        num(f.area),
        f.triangoli,
        f.infoSuperficie ? JSON.stringify(f.infoSuperficie) : '',
      ]);
    }
  }
  return csvRighe(righe);
}

/** CSV del conteggio entita' per tipo. */
export function entitaCSV(model) {
  return csvRighe([['tipo_entita', 'conteggio'], ...model.conteggiTipi.map((t) => [t.type, t.count])]);
}

/** CSV di riepilogo delle parti. */
export function partiCSV(model) {
  const u = unita(model);
  const righe = [[
    'parte', 'percorso', 'tipo', 'id', 'facce', 'triangoli', `area_${u}2`, `volume_${u}3`,
    'chiusa', 'volume_esatto', 'bordi_aperti', `dx_${u}`, `dy_${u}`, `dz_${u}`, `cx_${u}`, `cy_${u}`, `cz_${u}`,
  ]];
  for (const p of model.parti) {
    righe.push([
      p.nome, p.percorso, p.tipo, p.id, p.facce.length, p.mesh.indices.length / 3,
      num(p.area), num(p.volume), p.chiusa ? 'si' : 'no',
      p.volumeEsatto ? 'si' : 'no', p.bordiAperti,
      ...p.bbox.size.map(num), ...p.centroide.map(num),
    ]);
  }
  return csvRighe(righe);
}

/** Triangoli in coordinate mondo di un elenco di parti: [{v:[a,b,c], n}]. */
function* triangoliMondo(parti) {
  for (const p of parti) {
    const { positions, indices, normals } = p.mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const i = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const v = i.map((k) => transformPoint(p.matrice, [positions[k], positions[k + 1], positions[k + 2]]));
      const n = transformDir(p.matrice, [normals[i[0]], normals[i[0] + 1], normals[i[0] + 2]]);
      yield { v, n };
    }
  }
}

/**
 * STL della scena. opts: { soloVisibili, binario, parte (indice) }.
 * Il formato binario e' ~6 volte piu' compatto dell'ASCII.
 * @returns {string|ArrayBuffer}
 */
export function esportaSTL(model, opts = {}) {
  const parti = opts.parte != null ? [model.parti[opts.parte]].filter(Boolean) : partiDaEsportare(model, opts);
  if (opts.binario) {
    let n = 0;
    for (const p of parti) n += p.mesh.indices.length / 3;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const intestazione = `Visualizzatore STEP - ${model.nomeFileCaricato || 'modello'}`.slice(0, 79);
    for (let i = 0; i < intestazione.length; i++) dv.setUint8(i, intestazione.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    for (const { v, n: nrm } of triangoliMondo(parti)) {
      dv.setFloat32(o, nrm[0], true); dv.setFloat32(o + 4, nrm[1], true); dv.setFloat32(o + 8, nrm[2], true);
      o += 12;
      for (const pt of v) {
        dv.setFloat32(o, pt[0], true); dv.setFloat32(o + 4, pt[1], true); dv.setFloat32(o + 8, pt[2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    return buf;
  }
  const out = ['solid ' + (model.nomeFileCaricato || 'modello').replace(/\s+/g, '_')];
  for (const { v, n } of triangoliMondo(parti)) {
    out.push(`  facet normal ${n.map((x) => x.toExponential(6)).join(' ')}`);
    out.push('    outer loop');
    for (const pt of v) out.push(`      vertex ${pt.map((x) => x.toExponential(6)).join(' ')}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push('endsolid');
  return out.join('\n');
}

/** OBJ della scena, un gruppo per parte, con materiali (colori) in linea. opts: { soloVisibili }. */
export function esportaOBJ(model, opts = {}) {
  const parti = partiDaEsportare(model, opts);
  const out = ['# generato dal Visualizzatore STEP', `# unita': ${unita(model)}`];
  const mtl = [];
  let offset = 1;
  parti.forEach((p, k) => {
    const { positions, indices, normals } = p.mesh;
    const nome = (p.nome || `parte_${k}`).replace(/[^\w.-]+/g, '_');
    const col = p.colore || [0.7, 0.7, 0.7];
    mtl.push(`newmtl ${nome}`, `Kd ${col.map((c) => c.toFixed(4)).join(' ')}`, 'Ka 0.1 0.1 0.1', 'Ks 0.2 0.2 0.2', '');
    out.push(`g ${nome}`, `usemtl ${nome}`);
    for (let i = 0; i < positions.length; i += 3) {
      const w = transformPoint(p.matrice, [positions[i], positions[i + 1], positions[i + 2]]);
      out.push(`v ${w[0].toFixed(6)} ${w[1].toFixed(6)} ${w[2].toFixed(6)}`);
    }
    for (let i = 0; i < normals.length; i += 3) {
      const n = transformDir(p.matrice, [normals[i], normals[i + 1], normals[i + 2]]);
      out.push(`vn ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`);
    }
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] + offset;
      const b = indices[t + 1] + offset;
      const c = indices[t + 2] + offset;
      out.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    offset += positions.length / 3;
  });
  return { obj: out.join('\n'), mtl: mtl.join('\n') };
}

/* ------------------------------------------------------- report stampabile */

const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const numIt = (v, d = 2) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
    : escHtml(v);

/**
 * Report HTML autonomo (per la stampa o il salvataggio in PDF dal browser):
 * immagine del modello, misure, struttura, parti, proprieta' e dati del file.
 */
export function reportHTML(model, immagineDataUrl, opts = {}) {
  const u = unita(model);
  const s = model.statistiche;
  const righe = (arr) => arr.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? '' : 'k'}">${c}</td>`).join('')}</tr>`).join('');
  const tab = (intestazioni, corpo) =>
    `<table><thead><tr>${intestazioni.map((x) => `<th>${escHtml(x)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table>`;
  const albero = (n, liv = 0) =>
    `<div style="padding-left:${liv * 16}px">${escHtml(n.nome)}${n.items.length ? ` <small>(${n.items.length} geom.)</small>` : ''}</div>` +
    n.figli.map((f) => albero(f, liv + 1)).join('');
  const parti = model.parti.map((p) => `<tr>
    <td>${escHtml(p.nome)}</td><td class="n">${p.facce.length}</td><td class="n">${numIt(p.area, 1)}</td>
    <td class="n">${p.chiusa ? (p.volumeEsatto ? '' : p.volumeAffidabile ? '≈ ' : 'n.d. ') + (p.volumeAffidabile ? numIt(p.volume, 1) : '') : '—'}</td>
    <td class="n">${p.bbox.size.map((x) => numIt(x, 1)).join(' × ')}</td></tr>`).join('');
  const proprieta = model.proprieta.map((p) => [escHtml(p.nome), escHtml(p.valore)]);
  const org = model.organizzazione;
  const data = new Date().toLocaleString('it-IT');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Report — ${escHtml(opts.nomeFile || model.nomeFileCaricato || 'modello STEP')}</title>
<style>
  body { font: 12px/1.45 system-ui, Segoe UI, Roboto, sans-serif; color: #1a1d24; margin: 28px 36px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 1px solid #cbd0da; padding-bottom: 3px; }
  .sotto { color: #5c6373; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; font-size: 11.5px; }
  th, td { text-align: left; padding: 3px 8px 3px 0; border-bottom: 1px solid #e3e6ec; vertical-align: top; }
  th { color: #5c6373; font-weight: 600; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.k { color: #5c6373; width: 34%; }
  .griglia { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
  img { max-width: 100%; border: 1px solid #cbd0da; border-radius: 6px; margin: 6px 0 4px; }
  small { color: #5c6373; }
  @media print { body { margin: 10mm; } h2 { break-after: avoid; } table { break-inside: auto; } tr { break-inside: avoid; } }
</style></head><body>
<h1>${escHtml(opts.nomeFile || model.nomeFileCaricato || 'Modello STEP')}</h1>
<div class="sotto">Report generato il ${data} · Visualizzatore STEP · unità: ${escHtml(u)}</div>
${immagineDataUrl ? `<img src="${immagineDataUrl}" alt="modello">` : ''}
<div class="griglia">
<div><h2>Misure complessive</h2>
<table><tbody>${righe([
  ['Ingombro X × Y × Z', `${model.bbox.size.map((x) => numIt(x, 2)).join(' × ')} ${escHtml(u)}`],
  ['Area totale', `${numIt(s.areaTotale, 1)} ${escHtml(u)}²`],
  ['Volume totale (solidi chiusi)', `${numIt(s.volumeTotale, 1)} ${escHtml(u)}³`],
  ['Parti', String(model.parti.length)],
  ['Entità', String(s.entita)],
])}</tbody></table></div>
<div><h2>File</h2>
<table><tbody>${righe([
  ['Nome dichiarato', escHtml(model.header.nomeFile)],
  ['Data', escHtml(model.header.dataFile)],
  ['Schema', escHtml(model.header.schema)],
  ['Origine', escHtml([model.header.versionePreprocessore, model.header.sistemaOrigine].map((x) => x.trim()).filter(Boolean).join(' '))],
  ['Unità', escHtml(model.units.lunghezza ? model.units.lunghezza.nome : '')],
])}</tbody></table></div>
</div>
<h2>Struttura</h2>
${model.assieme.length ? model.assieme.map((n) => albero(n)).join('') : '<small>nessun assieme dichiarato</small>'}
<h2>Parti</h2>
${tab(['parte', 'facce', `area ${u}²`, `volume ${u}³`, `ingombro ${u}`], parti)}
${proprieta.length ? `<h2>Proprietà</h2>${tab(['nome', 'valore'], righe(proprieta))}` : ''}
${org.persone.length || org.approvazioni.length ? `<h2>Organizzazione</h2>${tab(['voce', 'valore'], righe([
  ...org.persone.map((p) => ['persona / organizzazione', `${escHtml(p.persona || '—')} @ ${escHtml(p.organizzazione || '—')} <small>${escHtml(p.ruoli.join(', '))}</small>`]),
  ...org.approvazioni.map((a) => ['approvazione', `${escHtml(a.stato)} ${escHtml(a.data)}`]),
  ...org.sicurezza.map((c) => ['classificazione', escHtml(c.livello)]),
]))}` : ''}
${model.diagnostics.length ? `<h2>Segnalazioni</h2><ul>${model.diagnostics.slice(0, 50).map((d) => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));<\/script>
</body></html>`;
}
