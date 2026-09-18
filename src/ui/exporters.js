/** Esportazioni: report JSON, CSV, mesh STL/OBJ, immagine PNG. */

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

/** Report completo (senza le mesh) in JSON. */
export function reportJSON(model) {
  const parti = model.parti.map((p) => ({
    nome: p.nome,
    percorso: p.percorso,
    tipo: p.tipo,
    idEntita: p.id,
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
  return righe.map((r) => r.map(esc).join(';')).join('\r\n');
}

/** CSV con una riga per faccia (utile per preventivi e controlli). */
export function facceCSV(model) {
  const righe = [['parte', 'percorso', 'id_faccia', 'tipo_superficie', 'area_mm2', 'triangoli', 'dettagli']];
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
  const righe = [[
    'parte', 'percorso', 'tipo', 'id', 'facce', 'triangoli', 'area_mm2', 'volume_mm3',
    'chiusa', 'volume_esatto', 'bordi_aperti', 'dx', 'dy', 'dz', 'cx', 'cy', 'cz',
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

/** STL ASCII della scena (o della sola parte indicata). */
export function esportaSTL(model, indiceParte = -1) {
  const parti = indiceParte >= 0 ? [model.parti[indiceParte]] : model.parti;
  const out = ['solid ' + (model.nomeFileCaricato || 'modello')];
  for (const p of parti) {
    if (!p) continue;
    const { positions, indices, normals } = p.mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const i = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const v = i.map((k) => transformPoint(p.matrice, [positions[k], positions[k + 1], positions[k + 2]]));
      const n = transformDir(p.matrice, [normals[i[0]], normals[i[0] + 1], normals[i[0] + 2]]);
      out.push(`  facet normal ${n.map((x) => x.toExponential(6)).join(' ')}`);
      out.push('    outer loop');
      for (const pt of v) out.push(`      vertex ${pt.map((x) => x.toExponential(6)).join(' ')}`);
      out.push('    endloop');
      out.push('  endfacet');
    }
  }
  out.push('endsolid');
  return out.join('\n');
}

/** OBJ della scena, un gruppo per parte. */
export function esportaOBJ(model) {
  const out = ['# generato dal Visualizzatore STEP'];
  let offset = 1;
  for (const p of model.parti) {
    const { positions, indices, normals } = p.mesh;
    out.push(`g ${p.nome.replace(/\s+/g, '_')}`);
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
  }
  return out.join('\n');
}
