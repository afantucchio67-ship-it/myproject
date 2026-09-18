/**
 * Costruzione dei pannelli dati (DOM, senza innerHTML sui dati del file:
 * i nomi dentro i file STEP sono testo arbitrario).
 */

/** Crea un elemento: h('div.classe', {attr}, ...figli) */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node)) {
    children.unshift(attrs);
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'onclick' || k === 'onchange' || k === 'oninput') el[k] = v;
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Volume con indicazione dell'attendibilità (mesh a tenuta o no). */
function volumeTesto(p) {
  if (!p.chiusa) return '—';
  if (p.volumeEsatto) return fmt(p.volume, 1);
  if (p.volumeAffidabile) return '≈ ' + fmt(p.volume, 1);
  return h('span', { title: `mesh con ${p.bordiAperti} bordi aperti` }, 'n.d.');
}

const fmt = (v, dec = 2) => {
  if (v == null || v === '' || Number.isNaN(v)) return '—';
  if (typeof v !== 'number') return String(v);
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2);
  return v.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const vec = (v, dec = 2) => (Array.isArray(v) ? v.map((x) => fmt(x, dec)).join('  ') : '—');

function sezione(titolo, ...contenuto) {
  return h('section.pannello-sezione', h('h3', titolo), ...contenuto);
}

function tabella(intestazioni, righe, opts = {}) {
  const t = h('table.tabella' + (opts.compatta ? '.compatta' : ''));
  if (intestazioni) {
    t.appendChild(h('thead', h('tr', ...intestazioni.map((x) => h('th', x)))));
  }
  const tb = h('tbody');
  for (const r of righe) {
    const tr = h('tr', ...r.map((c) => h('td', c)));
    if (opts.onRowClick) {
      tr.classList.add('cliccabile');
      tr.onclick = () => opts.onRowClick(r);
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  return t;
}

function coppie(righe) {
  return tabella(null, righe.filter((r) => r[1] !== '' && r[1] != null).map(([k, v]) => [h('span.chiave', k), v]), {
    compatta: true,
  });
}

/* ------------------------------------------------------------- struttura */

export function pannelloStruttura(model, stato, azioni) {
  const root = h('div');
  const um = model.units.simbolo || 'mm';
  const nodo = (n, livello) => {
    const riga = h(
      'div.albero-riga',
      { style: `padding-left:${8 + livello * 14}px` },
      h('span.albero-nome', n.nome || '(senza nome)'),
      n.items.length ? h('span.badge', `${n.items.length} geom.`) : null,
      n.versione ? h('span.badge.tenue', `v. ${n.versione}`) : null,
    );
    riga.onclick = () => azioni.selezionaNodo(n);
    const box = h('div', riga);
    for (const f of n.figli) box.appendChild(nodo(f, livello + 1));
    return box;
  };

  root.appendChild(
    sezione(
      'Albero di assieme',
      model.assieme.length
        ? h('div.albero', ...model.assieme.map((n) => nodo(n, 0)))
        : h('p.vuoto', 'Nessuna struttura di assieme dichiarata nel file.'),
    ),
  );

  const righe = model.parti.map((p, i) => {
    const chk = h('input', {
      type: 'checkbox',
      checked: p.visibile !== false,
      onchange: (ev) => azioni.visibilita(i, ev.target.checked),
    });
    const nome = h('button.link', { onclick: () => azioni.selezionaParte(i) }, p.nome || `#${p.id}`);
    return [
      chk,
      nome,
      p.facce.length,
      (p.mesh.indices.length / 3).toLocaleString('it-IT'),
      fmt(p.area, 1),
      volumeTesto(p),
      h('button.mini', { onclick: () => azioni.isola(i) }, 'isola'),
    ];
  });
  root.appendChild(
    sezione(
      `Parti geometriche (${model.parti.length})`,
      tabella(['', 'nome', 'facce', 'triangoli', `area ${um}²`, `volume ${um}³`, ''], righe),
      h('div.riga-bottoni',
        h('button.mini', { onclick: () => azioni.tuttoVisibile(true) }, 'mostra tutto'),
        h('button.mini', { onclick: () => azioni.tuttoVisibile(false) }, 'nascondi tutto')),
    ),
  );

  if (stato.parteSelezionata >= 0 && model.parti[stato.parteSelezionata]) {
    const p = model.parti[stato.parteSelezionata];
    const righeFacce = p.facce.map((f) => [
      h('button.link', { onclick: () => azioni.selezionaFaccia(stato.parteSelezionata, f.id) }, `#${f.id}`),
      f.tipoSuperficie,
      fmt(f.area, 2),
      f.triangoli,
    ]);
    root.appendChild(
      sezione(
        `Facce di "${p.nome}" (${p.facce.length})`,
        tabella(['id', 'superficie', `area ${um}²`, 'tri.'], righeFacce),
      ),
    );
  }
  return root;
}

/* ------------------------------------------------------------------ dati */

export function pannelloDati(model) {
  const root = h('div');
  const hd = model.header;
  root.appendChild(
    sezione(
      'Intestazione del file',
      coppie([
        ['nome file dichiarato', hd.nomeFile],
        ['data del file', hd.dataFile],
        ['descrizione', hd.descrizione],
        ['schema', hd.schema],
        ['livello di implementazione', hd.livelloImplementazione],
        ['sistema di origine', hd.sistemaOrigine.trim()],
        ['preprocessore', hd.versionePreprocessore],
        ['autore', hd.autore],
        ['organizzazione', hd.organizzazione],
        ['autorizzazione', hd.autorizzazione.trim()],
      ]),
    ),
  );

  const u = model.units;
  root.appendChild(
    sezione(
      'Unità e tolleranze',
      coppie([
        ['unità di lunghezza', u.lunghezza ? `${u.lunghezza.nome} (fattore verso mm: ${u.lunghezza.fattore})` : ''],
        ['unità angolare', u.angolo ? u.angolo.nome : ''],
        ['angolo solido', u.angoloSolido ? u.angoloSolido.nome : ''],
        ['dimensione dello spazio', u.dimensione],
        ['incertezza dichiarata', u.incertezza ? `${u.incertezza.valore} ${u.lunghezza ? u.lunghezza.nome : ''}` : ''],
      ]),
    ),
  );

  if (model.prodotti.length) {
    root.appendChild(
      sezione(
        `Prodotti (${model.prodotti.length})`,
        tabella(
          ['codice', 'nome', 'descrizione', 'categorie', 'contesto'],
          model.prodotti.map((p) => [p.codice, p.nome, p.descrizione, p.categorie.join(', '), p.contesti.join(', ')]),
        ),
      ),
    );
  }

  if (model.proprieta.length) {
    root.appendChild(
      sezione(
        `Proprietà (${model.proprieta.length})`,
        tabella(['nome', 'valore', 'entità'], model.proprieta.map((p) => [p.nome, p.valore, p.fonte])),
      ),
    );
  }

  const org = model.organizzazione;
  if (org.persone.length) {
    root.appendChild(
      sezione(
        'Persone e organizzazioni',
        tabella(
          ['persona', 'organizzazione', 'ruoli', 'occorr.'],
          org.persone.map((p) => [p.persona || '—', p.organizzazione || '—', p.ruoli.join(', '), p.occorrenze || 1]),
        ),
      ),
    );
  }
  if (org.approvazioni.length) {
    root.appendChild(
      sezione(
        'Approvazioni',
        tabella(
          ['stato', 'livello', 'data', 'occorr.'],
          org.approvazioni.map((a) => [a.stato, a.livello, a.data, a.occorrenze || 1]),
        ),
      ),
    );
  }
  if (org.date.length) {
    root.appendChild(
      sezione(
        'Date',
        tabella(
          ['data e ora', 'ruoli', 'occorr.'],
          org.date.map((d) => [d.valore, d.ruoli.join(', '), d.occorrenze || 1]),
        ),
      ),
    );
  }
  if (org.sicurezza.length) {
    root.appendChild(
      sezione(
        'Classificazione',
        tabella(
          ['nome', 'scopo', 'livello', 'occorr.'],
          org.sicurezza.map((s) => [s.nome, s.scopo, s.livello, s.occorrenze || 1]),
        ),
      ),
    );
  }
  if (model.layer.length) {
    root.appendChild(
      sezione(
        'Livelli di presentazione',
        tabella(['nome', 'descrizione', 'elementi'], model.layer.map((l) => [l.nome, l.descrizione, l.elementi.length])),
      ),
    );
  }
  return root;
}

/* ------------------------------------------------------------- geometria */

export function pannelloGeometria(model, stato, azioni) {
  const root = h('div');
  const s = model.statistiche;
  const bb = model.bbox;
  const um = model.units.simbolo || 'mm';
  const versoMm = model.units.fattoreVersoMm || 1;
  root.appendChild(
    sezione(
      'Misure complessive',
      coppie([
        ['ingombro X × Y × Z', `${vec(bb.size, 2)} ${um}`],
        ['minimo', vec(bb.min, 2)],
        ['massimo', vec(bb.max, 2)],
        ['diagonale', `${fmt(Math.hypot(...bb.size), 2)} ${um}`],
        ['area totale', `${fmt(s.areaTotale, 1)} ${um}²`],
        ['volume totale (solidi chiusi)', `${fmt(s.volumeTotale, 1)} ${um}³`],
        ['volume in cm³', fmt((s.volumeTotale * versoMm ** 3) / 1000, 2)],
        ['triangoli / vertici', `${s.triangoli.toLocaleString('it-IT')} / ${s.vertici.toLocaleString('it-IT')}`],
      ]),
      h('p.nota',
        'Area e volume sono calcolati sulla mesh tassellata: l’errore segue la tolleranza impostata. ' +
        '"≈" indica una mesh non perfettamente a tenuta (volume approssimato), "n.d." un valore non attendibile.'),
    ),
  );

  root.appendChild(
    sezione(
      'Per parte',
      tabella(
        ['parte', 'facce', `area ${um}²`, `volume ${um}³`, `X ${um}`, `Y ${um}`, `Z ${um}`, 'centroide', 'tenuta'],
        model.parti.map((p, i) => [
          h('button.link', { onclick: () => azioni.selezionaParte(i) }, p.nome),
          p.facce.length,
          fmt(p.area, 1),
          volumeTesto(p),
          fmt(p.bbox.size[0], 2),
          fmt(p.bbox.size[1], 2),
          fmt(p.bbox.size[2], 2),
          vec(p.centroide, 1),
          p.bordiAperti === 0 ? 'chiusa' : `${p.bordiAperti} bordi aperti`,
        ]),
      ),
    ),
  );

  const g = model.geometria;
  root.appendChild(
    sezione(
      'Contenuto geometrico dichiarato',
      tabella(
        ['elemento', 'quantità'],
        [
          ['solidi (BREP)', g.solidi],
          ['gusci chiusi / aperti', `${g.gusciChiusi} / ${g.gusciAperti}`],
          ['facce', g.facce],
          ['spigoli', g.spigoli],
          ['vertici', g.vertici],
          ['punti cartesiani', g.punti],
          ['piani', g.piani],
          ['cilindri', g.cilindri],
          ['coni', g.coni],
          ['sfere', g.sfere],
          ['tori', g.tori],
          ['superfici offset', g.superficiOffset],
          ['superfici B-spline', g.superficiBspline],
          ['curve B-spline', g.curveBspline],
          ['cerchi', g.cerchi],
          ['linee', g.linee],
        ].filter((r) => r[1] && r[1] !== '0 / 0'),
      ),
    ),
  );
  return root;
}

/* --------------------------------------------------------------- entita' */

export function pannelloEntita(model, stato, azioni) {
  const root = h('div');
  const input = h('input.ricerca', {
    type: 'search',
    placeholder: 'cerca per #id, tipo o testo (es. 303, CIRCLE, PLANE)',
    value: stato.ricercaEntita || '',
  });
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') azioni.cercaEntita(input.value);
  };
  root.appendChild(
    sezione(
      'Esploratore entità',
      h('div.riga-ricerca', input, h('button.mini', { onclick: () => azioni.cercaEntita(input.value) }, 'cerca')),
      stato.risultatiEntita
        ? tabella(
            ['id', 'tipo'],
            stato.risultatiEntita.map((r) => [
              h('button.link', { onclick: () => azioni.apriEntita(r.id) }, `#${r.id}`),
              r.tipi.join(' + '),
            ]),
          )
        : h('p.vuoto', 'Digita una ricerca per esplorare le entità del file.'),
    ),
  );

  if (stato.entitaAperta) {
    const e = stato.entitaAperta;
    root.appendChild(
      sezione(
        `Entità #${e.id}`,
        h('pre.codice', e.testo),
        h('div.riga-bottoni',
          h('span.chiave', 'riferimenti:'),
          ...e.riferimenti.slice(0, 60).map((id) =>
            h('button.mini', { onclick: () => azioni.apriEntita(id) }, `#${id}`))),
        h('div.riga-bottoni',
          h('span.chiave', 'citata da:'),
          ...e.citataDa.slice(0, 60).map((id) =>
            h('button.mini', { onclick: () => azioni.apriEntita(id) }, `#${id}`))),
      ),
    );
  }

  root.appendChild(
    sezione(
      `Entità per tipo (${model.conteggiTipi.length} tipi, ${model.statistiche.entita.toLocaleString('it-IT')} entità)`,
      tabella(
        ['tipo', 'conteggio'],
        model.conteggiTipi.map((t) => [
          h('button.link', { onclick: () => azioni.cercaTipo(t.type) }, t.type),
          t.count.toLocaleString('it-IT'),
        ]),
      ),
    ),
  );
  return root;
}

/* ----------------------------------------------------------- diagnostica */

export function pannelloDiagnostica(model) {
  const root = h('div');
  const s = model.statistiche;
  root.appendChild(
    sezione(
      'Lettura del file',
      coppie([
        ['dimensione', `${(s.byte / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} kB`],
        ['righe', s.righe.toLocaleString('it-IT')],
        ['entità lette', s.entita.toLocaleString('it-IT')],
        ['tipi distinti', s.tipi],
        ['tempo di lettura', `${s.msLettura} ms`],
      ]),
    ),
  );
  root.appendChild(
    sezione(
      `Segnalazioni (${model.diagnostics.length})`,
      model.diagnostics.length
        ? h('ul.elenco', ...model.diagnostics.slice(0, 500).map((d) => h('li', d)))
        : h('p.vuoto', 'Nessuna anomalia: tutte le facce sono state tassellate.'),
    ),
  );
  return root;
}

/* --------------------------------------------------- dettaglio selezione */

export function dettaglioSelezione(model, sel) {
  if (!sel) return h('div.vuoto-overlay', 'Clicca sul modello per interrogare una faccia.');
  const parte = model.parti[sel.parte];
  const faccia = parte ? parte.facce.find((f) => f.id === sel.faccia) : null;
  const righe = [
    ['parte', parte ? parte.nome : '—'],
    ['percorso', parte ? parte.percorso : ''],
    ['entità faccia', sel.faccia > 0 ? `#${sel.faccia}` : '—'],
    ['superficie', faccia ? faccia.tipoSuperficie : '—'],
    ['area faccia', faccia ? `${fmt(faccia.area, 2)} ${model.units.simbolo || 'mm'}²` : '—'],
    ['punto cliccato', `${vec(sel.punto, 2)} ${model.units.simbolo || 'mm'}`],
  ];
  if (faccia && faccia.infoSuperficie) {
    for (const [k, v] of Object.entries(faccia.infoSuperficie)) {
      righe.push([k, Array.isArray(v) ? vec(v, 3) : typeof v === 'number' ? fmt(v, 3) : String(v)]);
    }
  }
  return coppie(righe);
}

export { fmt, vec, sezione, tabella, coppie };
