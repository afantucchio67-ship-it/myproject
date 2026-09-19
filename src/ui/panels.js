/**
 * Costruzione dei pannelli dati (DOM, senza innerHTML sui dati del file:
 * i nomi dentro i file STEP sono testo arbitrario).
 */

/** Crea un elemento: h('div.classe', {attr}, ...figli) */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  // il secondo argomento e' un figlio (testo, numero — anche 0 —, nodo, array)
  // oppure la mappa degli attributi
  if (attrs != null && attrs !== false && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el[k] = v;
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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

/* ---------------------------------------------------------- formattazione */

/** Numero in formato italiano; niente notazione esponenziale nelle tabelle. */
export const fmt = (v, dec = 2) => {
  if (v == null || v === '' || Number.isNaN(v)) return '—';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '—';
  const arrotondato = Math.abs(v) < 0.5 * 10 ** -dec ? 0 : v; // evita "-0,00"
  return arrotondato.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
export const vec = (v, dec = 2, sep = '  ') => (Array.isArray(v) ? v.map((x) => fmt(x, dec)).join(sep) : '—');
export const intero = (v) => (typeof v === 'number' ? v.toLocaleString('it-IT') : String(v ?? '—'));

/** Nomi leggibili delle superfici STEP (il tipo originale resta nel tooltip). */
const NOMI_SUPERFICI = {
  PLANE: 'Piano',
  CYLINDRICAL_SURFACE: 'Cilindro',
  CONICAL_SURFACE: 'Cono',
  SPHERICAL_SURFACE: 'Sfera',
  TOROIDAL_SURFACE: 'Toro',
  B_SPLINE_SURFACE_WITH_KNOTS: 'Superficie B-spline',
  RATIONAL_B_SPLINE_SURFACE: 'Superficie NURBS',
  OFFSET_SURFACE: 'Superficie offset',
  SURFACE_OF_REVOLUTION: 'Superficie di rivoluzione',
  SURFACE_OF_LINEAR_EXTRUSION: 'Superficie estrusa',
  CURVE_BOUNDED_SURFACE: 'Superficie delimitata',
  RECTANGULAR_TRIMMED_SURFACE: 'Superficie ritagliata',
};
export const nomeSuperficie = (tipo) => NOMI_SUPERFICI[tipo] || (tipo ? tipo.toLowerCase().replace(/_/g, ' ') : '—');

/** Etichette italiane per le chiavi delle informazioni di superficie. */
const ETICHETTE_INFO = {
  raggio: 'Raggio', asse: 'Asse', origine: 'Origine', normale: 'Normale', centro: 'Centro',
  semiangolo: 'Semiangolo', raggioMaggiore: 'Raggio maggiore', raggioMinore: 'Raggio minore',
  gradoU: 'Grado U', gradoV: 'Grado V', puntiControllo: 'Punti di controllo', grigliaControllo: 'Griglia di controllo',
  razionale: 'Razionale', dominioU: 'Dominio U', dominioV: 'Dominio V', superficieBase: 'Superficie base',
  distanza: 'Distanza di offset', curvaBase: 'Curva base', direzione: 'Direzione', grado: 'Grado', nodi: 'Nodi',
  dominio: 'Dominio', taglio: 'Intervallo', segmenti: 'Segmenti', punti: 'Punti', lunghezzaVettore: 'Lunghezza vettore',
  semiasse1: 'Semiasse 1', semiasse2: 'Semiasse 2',
};

const CHIAVI_PUNTO = new Set(['origine', 'centro']);
const CHIAVI_DIREZIONE = new Set(['asse', 'normale', 'direzione']);

/** Trasforma punti e direzioni delle informazioni di superficie nel sistema del modello. */
function nelMondo(k, v, matrice) {
  if (!matrice || !Array.isArray(v) || v.length !== 3) return v;
  const m = matrice;
  if (CHIAVI_PUNTO.has(k)) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ];
  }
  if (CHIAVI_DIREZIONE.has(k)) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ];
  }
  return v;
}

export function infoSuperficieRighe(info, um, matrice = null) {
  if (!info) return [];
  const righe = [];
  for (const [k, v0] of Object.entries(info)) {
    const etichetta = ETICHETTE_INFO[k] || k;
    const v = nelMondo(k, v0, matrice);
    let testo;
    if (Array.isArray(v)) testo = vec(v, 3);
    else if (typeof v === 'number') {
      if (k === 'semiangolo') testo = `${fmt((v * 180) / Math.PI, 2)}°`;
      else if (['raggio', 'raggioMaggiore', 'raggioMinore', 'distanza', 'semiasse1', 'semiasse2'].includes(k)) testo = `${fmt(v, 3)} ${um}`;
      else testo = fmt(v, Number.isInteger(v) ? 0 : 4);
    } else if (typeof v === 'boolean') testo = v ? 'sì' : 'no';
    else if (typeof v === 'string' && NOMI_SUPERFICI[v]) testo = NOMI_SUPERFICI[v];
    else testo = String(v);
    righe.push([etichetta, testo]);
  }
  return righe;
}

/** Nome leggibile dell'unità di lunghezza. */
export function nomeUnita(u) {
  if (!u) return '—';
  const nomi = { mm: 'millimetri (mm)', m: 'metri (m)', cm: 'centimetri (cm)', in: 'pollici (in)', ft: 'piedi (ft)', 'µm': 'micrometri (µm)' };
  return nomi[u.simbolo] || `${u.lunghezza ? u.lunghezza.nome : '?'} (${u.simbolo})`;
}

/* --------------------------------------------------------- elementi base */

export function sezione(titolo, ...contenuto) {
  return h('section.pannello-sezione', h('h3', titolo), ...contenuto);
}

/**
 * Tabella. `righe` = array di celle (nodo o testo); opts.numeriche = indici
 * delle colonne allineate a destra; opts.chiave(r) = id riga per la
 * selezione; opts.selezionata = chiave della riga evidenziata.
 */
export function tabella(intestazioni, righe, opts = {}) {
  const t = h('table.tabella' + (opts.compatta ? '.compatta' : ''));
  const numeriche = new Set(opts.numeriche || []);
  if (intestazioni) {
    t.appendChild(h('thead', h('tr', ...intestazioni.map((x, i) => h('th' + (numeriche.has(i) ? '.num' : ''), x)))));
  }
  const tb = h('tbody');
  righe.forEach((r, ri) => {
    const tr = h('tr', ...r.map((c, i) => h('td' + (numeriche.has(i) ? '.num' : ''), c)));
    if (opts.chiave) {
      const k = opts.chiave(r, ri);
      tr.dataset.chiave = String(k);
      if (opts.selezionata != null && String(k) === String(opts.selezionata)) tr.classList.add('selezionata');
    }
    if (opts.onRowClick) {
      tr.classList.add('cliccabile');
      tr.onclick = (ev) => {
        if (ev.target.closest('button, input, select, a')) return;
        opts.onRowClick(r, ri, ev);
      };
    }
    if (opts.onRowDblClick) tr.ondblclick = () => opts.onRowDblClick(r, ri);
    if (opts.onRowHover) {
      tr.onpointerenter = () => opts.onRowHover(r, ri, true);
      tr.onpointerleave = () => opts.onRowHover(r, ri, false);
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return opts.scorrevole ? h('div.scorri', t) : t;
}

export function coppie(righe) {
  return tabella(
    null,
    righe.filter((r) => r[1] !== '' && r[1] != null).map(([k, v]) => [h('span.chiave', k), v]),
    { compatta: true },
  );
}

/** Volume con indicazione dell'attendibilità (mesh a tenuta o no). */
export function volumeTesto(p) {
  if (!p.chiusa) return '—';
  if (p.volumeEsatto) return fmt(p.volume, 1);
  if (p.volumeAffidabile) return h('span', { title: 'mesh non perfettamente a tenuta: valore approssimato' }, '≈ ' + fmt(p.volume, 1));
  return h('span.tenue', { title: `mesh con ${p.bordiAperti} bordi aperti: valore non attendibile` }, 'n.d.');
}

/* ------------------------------------------------------------- struttura */

export function pannelloStruttura(model, stato, azioni) {
  const root = h('div');
  const um = model.units.simbolo || 'mm';
  // le parti si identificano per istanza (percorso nell'albero), non per
  // entita': lo stesso solido puo' essere usato piu' volte in un assieme
  const indiciPerNodo = (n) => {
    const percorso = n.percorso.join(' / ');
    const out = [];
    model.parti.forEach((p, i) => { if (p.percorso === percorso) out.push(i); });
    for (const f of n.figli) out.push(...indiciPerNodo(f));
    return out;
  };

  const filtro = (stato.filtroAlbero || '').trim().toLowerCase();
  const corrisponde = (n) =>
    !filtro || n.nome.toLowerCase().includes(filtro) || n.figli.some(corrisponde);

  const nodo = (n, livello) => {
    if (!corrisponde(n)) return null;
    const indici = indiciPerNodo(n);
    const chiave = `nodo-${n.id}-${livello}-${n.nome}`;
    const aperto = stato.nodiChiusi ? !stato.nodiChiusi.has(chiave) : true;
    const tuttiVisibili = indici.length > 0 && indici.every((i) => model.parti[i].visibile !== false);
    const alcuniVisibili = indici.some((i) => model.parti[i].visibile !== false);
    const selezionato = stato.parteSelezionata >= 0 && indici.includes(stato.parteSelezionata);
    const chk = h('input.vis', {
      type: 'checkbox',
      title: 'mostra / nascondi',
      checked: tuttiVisibili,
      disabled: !indici.length,
      onclick: (ev) => ev.stopPropagation(),
      onchange: (ev) => azioni.visibilitaMultipla(indici, ev.target.checked),
    });
    if (!tuttiVisibili && alcuniVisibili) chk.indeterminate = true;
    const freccia = n.figli.length
      ? h('button.freccia', {
        title: aperto ? 'comprimi' : 'espandi',
        onclick: (ev) => { ev.stopPropagation(); azioni.toggleNodo(chiave); },
      }, aperto ? '▾' : '▸')
      : h('span.freccia-vuota');
    const riga = h(
      'div.albero-riga' + (selezionato ? '.selezionata' : ''),
      { style: { paddingLeft: `${6 + livello * 16}px` }, title: n.prodotto && n.prodotto !== n.nome ? `prodotto: ${n.prodotto}` : null },
      freccia,
      chk,
      h('span.albero-nome', n.nome || '(senza nome)'),
      indici.length ? h('span.badge', indici.length === 1 ? '1 parte' : `${indici.length} parti`) : null,
      n.versione && n.versione.trim() ? h('span.badge.tenue', `rev. ${n.versione.trim()}`) : null,
    );
    riga.onclick = (ev) => {
      if (ev.target.closest('input, button')) return; // casella e freccia hanno i loro gestori
      azioni.selezionaNodo(indici);
    };
    riga.ondblclick = (ev) => {
      if (ev.target.closest('input, button')) return;
      azioni.inquadraParti(indici);
    };
    const box = h('div', riga);
    if (aperto) {
      for (const f of n.figli) {
        const figlio = nodo(f, livello + 1);
        if (figlio) box.appendChild(figlio); // null = escluso dal filtro
      }
    }
    return box;
  };

  const campoFiltro = h('input.ricerca', {
    type: 'search',
    placeholder: 'filtra per nome…',
    value: stato.filtroAlbero || '',
    oninput: (ev) => azioni.filtraAlbero(ev.target.value),
  });

  root.appendChild(
    sezione(
      'Albero di assieme',
      model.assieme.length
        ? [h('div.riga-ricerca', campoFiltro), h('div.albero', ...model.assieme.map((n) => nodo(n, 0)))]
        : h('p.vuoto', 'Nessuna struttura di assieme dichiarata nel file.'),
    ),
  );

  const righe = model.parti.map((p, i) => {
    const chk = h('input.vis', {
      type: 'checkbox',
      title: 'mostra / nascondi',
      checked: p.visibile !== false,
      onchange: (ev) => azioni.visibilita(i, ev.target.checked),
    });
    const colore = h('input.colore', {
      type: 'color',
      title: 'colore della parte',
      value: rgbToHex(p.colore || [0.5, 0.5, 0.5]),
      oninput: (ev) => azioni.colore(i, hexToRgb(ev.target.value)),
    });
    return [
      chk,
      colore,
      h('span.nome-parte', { title: p.percorso }, p.nome || `#${p.id}`),
      intero(p.facce.length),
      fmt(p.area, 1),
      volumeTesto(p),
      h('div.azioni-riga',
        h('button.mini', { title: 'inquadra questa parte', onclick: () => azioni.inquadraParti([i]) }, '⌖'),
        h('button.mini', { title: 'mostra solo questa parte', onclick: () => azioni.isola(i) }, '◎')),
    ];
  });
  root.appendChild(
    sezione(
      `Parti (${model.parti.length})`,
      tabella(['', '', 'nome', 'facce', `area ${um}²`, `volume ${um}³`, ''], righe, {
        numeriche: [3, 4, 5, 6],
        chiave: (r, i) => i,
        selezionata: stato.parteSelezionata,
        onRowClick: (r, i) => azioni.selezionaParte(i),
        onRowDblClick: (r, i) => azioni.inquadraParti([i]),
        onRowHover: (r, i, dentro) => azioni.hoverParte(dentro ? i : -1),
      }),
      h('div.riga-bottoni',
        h('button.mini', { onclick: () => azioni.tuttoVisibile(true) }, 'mostra tutto'),
        h('button.mini', { onclick: () => azioni.tuttoVisibile(false) }, 'nascondi tutto'),
        h('button.mini', { onclick: () => azioni.inverti() }, 'inverti')),
    ),
  );

  if (stato.parteSelezionata >= 0 && model.parti[stato.parteSelezionata]) {
    const p = model.parti[stato.parteSelezionata];
    const righeFacce = p.facce.map((f) => [
      `#${f.id}`,
      h('span', { title: f.tipoSuperficie }, nomeSuperficie(f.tipoSuperficie)),
      fmt(f.area, 2),
      intero(f.triangoli),
    ]);
    root.appendChild(
      sezione(
        `Facce di «${p.nome}» (${p.facce.length})`,
        tabella(['id', 'superficie', `area ${um}²`, 'triangoli'], righeFacce, {
          numeriche: [2, 3],
          chiave: (r, i) => p.facce[i].id,
          selezionata: stato.facciaSelezionata,
          onRowClick: (r, i) => azioni.selezionaFaccia(stato.parteSelezionata, p.facce[i].id),
          onRowDblClick: (r, i) => azioni.inquadraFaccia(stato.parteSelezionata, p.facce[i].id),
          onRowHover: (r, i, dentro) => azioni.hoverFaccia(dentro ? p.facce[i].id : -1),
        }),
        h('p.nota', 'Clic: evidenzia la faccia · doppio clic: inquadra.'),
      ),
    );
  }
  return root;
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
}
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.5, 0.5, 0.5];
}

/* ------------------------------------------------------------------ dati */

export function pannelloDati(model) {
  const root = h('div');
  const hd = model.header;
  root.appendChild(
    sezione(
      'Intestazione del file',
      coppie([
        ['Nome dichiarato', hd.nomeFile],
        ['Data del file', hd.dataFile],
        ['Descrizione', hd.descrizione],
        ['Schema', hd.schema],
        ['Livello di implementazione', hd.livelloImplementazione],
        ['Sistema di origine', hd.sistemaOrigine.trim()],
        ['Preprocessore', hd.versionePreprocessore.trim()],
        ['Autore', hd.autore.trim()],
        ['Organizzazione', hd.organizzazione.trim()],
        ['Autorizzazione', hd.autorizzazione.trim()],
      ]),
    ),
  );

  const u = model.units;
  root.appendChild(
    sezione(
      'Unità e tolleranze',
      coppie([
        ['Unità di lunghezza', nomeUnita(u)],
        ['Fattore verso mm', u.fattoreVersoMm && u.fattoreVersoMm !== 1 ? fmt(u.fattoreVersoMm, 4) : ''],
        ['Unità angolare', u.angolo ? (u.angolo.nome === 'radian' ? 'radianti' : u.angolo.nome) : ''],
        ['Dimensione dello spazio', u.dimensione],
        ['Incertezza dichiarata', u.incertezza && u.incertezza.valore != null
          ? `${u.incertezza.valore.toLocaleString('it-IT', { maximumSignificantDigits: 3 })} ${u.simbolo || ''}`
          : ''],
      ]),
    ),
  );

  if (model.prodotti.length) {
    // i file esportati ripetono spesso lo stesso prodotto per ogni componente
    const gruppi = new Map();
    for (const p of model.prodotti) {
      const k = [p.codice, p.nome, p.descrizione, p.categorie.join(','), p.contesti.join(',')].join('|');
      const g = gruppi.get(k);
      if (g) g.occorrenze++;
      else gruppi.set(k, { ...p, occorrenze: 1 });
    }
    const righe = [...gruppi.values()].map((p) => [
      p.codice, p.nome !== p.codice ? p.nome : '', p.descrizione, p.categorie.join(', '), p.contesti.join(', '),
      p.occorrenze > 1 ? `×${p.occorrenze}` : '',
    ]);
    root.appendChild(
      sezione(`Prodotti (${gruppi.size})`, tabella(['codice', 'nome', 'descrizione', 'categoria', 'contesto', ''], righe, { scorrevole: true })),
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
  const volte = (n) => (n > 1 ? `×${n}` : '');
  if (org.persone.length) {
    root.appendChild(
      sezione(
        'Persone e organizzazioni',
        tabella(
          ['persona', 'organizzazione', 'ruoli', ''],
          org.persone.map((p) => [p.persona || '—', p.organizzazione || '—', p.ruoli.join(', ').replace(/_/g, ' '), volte(p.occorrenze)]),
        ),
      ),
    );
  }
  if (org.approvazioni.length) {
    root.appendChild(
      sezione(
        'Approvazioni',
        tabella(['stato', 'livello', 'data', ''], org.approvazioni.map((a) => [a.stato, a.livello, a.data, volte(a.occorrenze)])),
      ),
    );
  }
  if (org.date.length) {
    root.appendChild(
      sezione('Date', tabella(['data e ora', 'ruoli', ''], org.date.map((d) => [d.valore, d.ruoli.join(', ').replace(/_/g, ' '), volte(d.occorrenze)]))),
    );
  }
  if (org.sicurezza.length) {
    root.appendChild(
      sezione(
        'Classificazione',
        tabella(['nome', 'scopo', 'livello', ''], org.sicurezza.map((s) => [s.nome, s.scopo, s.livello, volte(s.occorrenze)])),
      ),
    );
  }
  if (model.layer.length) {
    root.appendChild(
      sezione(
        'Livelli di presentazione',
        tabella(['nome', 'descrizione', 'elementi'], model.layer.map((l) => [l.nome, l.descrizione, l.elementi.length]), { numeriche: [2] }),
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
  const volMm3 = s.volumeTotale * versoMm ** 3;
  root.appendChild(
    sezione(
      'Misure complessive',
      coppie([
        ['Ingombro X × Y × Z', `${vec(bb.size, 2, ' × ')} ${um}`],
        ['Minimo', vec(bb.min, 2)],
        ['Massimo', vec(bb.max, 2)],
        ['Diagonale', `${fmt(Math.hypot(...bb.size), 2)} ${um}`],
        ['Area totale', `${fmt(s.areaTotale, 1)} ${um}²`],
        ['Volume totale (solidi chiusi)', `${fmt(s.volumeTotale, 1)} ${um}³`],
        ['Volume in cm³', fmt(volMm3 / 1000, 2)],
        ['Triangoli / vertici', `${intero(s.triangoli)} / ${intero(s.vertici)}`],
      ]),
      h('p.nota',
        `Area e volume sono calcolati sulla mesh (tolleranza di corda ${fmt(stato.tolleranza ?? 0.1, 2)} mm): ` +
        'per superfici curve piccole l’errore può superare l’1 %; con «Qualità massima» scende sotto lo 0,5 %. ' +
        '«≈» segnala una mesh non perfettamente chiusa (volume approssimato), «n.d.» un valore non attendibile.'),
    ),
  );

  root.appendChild(
    sezione(
      'Per parte',
      tabella(
        ['parte', 'facce', `area ${um}²`, `volume ${um}³`, `ingombro ${um}`, 'mesh'],
        model.parti.map((p, i) => [
          h('span.nome-parte', { title: p.percorso }, p.nome),
          intero(p.facce.length),
          fmt(p.area, 1),
          volumeTesto(p),
          vec((p.bboxMondo || p.bbox).size, 1, ' × '),
          p.bordiAperti === 0
            ? h('span.ok', 'chiusa')
            : h('span.tenue', { title: `${p.bordiAperti} bordi su ${p.bordiTotali} non condivisi` }, `${p.bordiAperti} bordi aperti`),
        ]),
        {
          numeriche: [1, 2, 3, 4, 5],
          chiave: (r, i) => i,
          selezionata: stato.parteSelezionata,
          onRowClick: (r, i) => azioni.selezionaParte(i),
          onRowDblClick: (r, i) => azioni.inquadraParti([i]),
          scorrevole: true,
        },
      ),
    ),
  );

  if (stato.parteSelezionata >= 0 && model.parti[stato.parteSelezionata]) {
    const p = model.parti[stato.parteSelezionata];
    root.appendChild(
      sezione(
        `Dettaglio «${p.nome}»`,
        coppie([
          ['Percorso', p.percorso],
          ['Tipo', p.tipo === 'MANIFOLD_SOLID_BREP' ? 'solido (BREP)' : p.tipo.toLowerCase().replace(/_/g, ' ')],
          ['Entità', `#${p.id}`],
          ['Centroide', `${vec(p.centroideMondo || p.centroide, 2)} ${um}`],
          ['Minimo', vec((p.bboxMondo || p.bbox).min, 2)],
          ['Massimo', vec((p.bboxMondo || p.bbox).max, 2)],
          ['Triangoli', intero(p.mesh.indices.length / 3)],
          ['Orientamento', p.orientamentoInvertito ? 'corretto (era verso l’interno)' : 'come nel file'],
        ]),
      ),
    );
  }

  const g = model.geometria;
  root.appendChild(
    sezione(
      'Contenuto geometrico dichiarato',
      tabella(
        ['elemento', 'quantità'],
        [
          ['Solidi (BREP)', g.solidi],
          ['Gusci chiusi / aperti', `${g.gusciChiusi} / ${g.gusciAperti}`],
          ['Facce', g.facce],
          ['Spigoli', g.spigoli],
          ['Vertici', g.vertici],
          ['Punti cartesiani', g.punti],
          ['Piani', g.piani],
          ['Cilindri', g.cilindri],
          ['Coni', g.coni],
          ['Sfere', g.sfere],
          ['Tori', g.tori],
          ['Superfici offset', g.superficiOffset],
          ['Superfici B-spline', g.superficiBspline],
          ['Curve B-spline', g.curveBspline],
          ['Cerchi', g.cerchi],
          ['Linee', g.linee],
        ].filter((r) => r[1] && r[1] !== '0 / 0').map((r) => [r[0], typeof r[1] === 'number' ? intero(r[1]) : r[1]]),
        { numeriche: [1] },
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
  const troncati = stato.totaleRisultati > (stato.risultatiEntita || []).length;
  root.appendChild(
    sezione(
      'Esploratore entità',
      h('div.riga-ricerca', input, h('button', { onclick: () => azioni.cercaEntita(input.value) }, 'Cerca')),
      stato.risultatiEntita
        ? [
          h('p.nota', stato.risultatiEntita.length
            ? `${intero(stato.totaleRisultati || stato.risultatiEntita.length)} risultat${(stato.totaleRisultati || stato.risultatiEntita.length) === 1 ? 'o' : 'i'}` +
              (troncati ? ` (mostrati i primi ${stato.risultatiEntita.length})` : '')
            : 'Nessuna entità corrisponde.'),
          tabella(
            ['id', 'tipo'],
            stato.risultatiEntita.map((r) => [
              h('button.link', { onclick: () => azioni.apriEntita(r.id) }, `#${r.id}`),
              r.tipi.join(' + '),
            ]),
          ),
        ]
        : h('p.vuoto', 'Digita una ricerca per esplorare le entità del file: un numero (#id), un tipo STEP o un testo.'),
    ),
  );

  if (stato.entitaAperta) {
    const e = stato.entitaAperta;
    const parte = model.parti.findIndex((p) => p.id === e.id || p.facce.some((f) => f.id === e.id));
    const inScena = parte >= 0
      ? h('button.mini', { onclick: () => azioni.mostraEntitaIn3D(e.id) }, 'evidenzia nel 3D')
      : null;
    root.appendChild(
      sezione(
        `Entità #${e.id}`,
        h('div.riga-bottoni', h('span.chiave', e.tipi.join(' + ')), inScena,
          h('button.mini', { onclick: () => azioni.copiaTesto(e.testo) }, 'copia')),
        h('pre.codice', e.testo),
        h('div.riga-bottoni',
          h('span.chiave', 'riferimenti:'),
          e.riferimenti.length ? e.riferimenti.slice(0, 80).map((id) =>
            h('button.mini', { onclick: () => azioni.apriEntita(id) }, `#${id}`)) : h('span.tenue', 'nessuno'),
          e.riferimenti.length > 80 ? h('span.tenue', `… +${e.riferimenti.length - 80}`) : null),
        h('div.riga-bottoni',
          h('span.chiave', 'citata da:'),
          e.citataDa.length ? e.citataDa.slice(0, 80).map((id) =>
            h('button.mini', { onclick: () => azioni.apriEntita(id) }, `#${id}`)) : h('span.tenue', 'nessuna'),
          e.citataDa.length > 80 ? h('span.tenue', `… +${e.citataDa.length - 80}`) : null),
      ),
    );
  }

  root.appendChild(
    sezione(
      `Entità per tipo (${model.conteggiTipi.length} tipi, ${intero(model.statistiche.entita)} entità)`,
      tabella(
        ['tipo', 'conteggio'],
        model.conteggiTipi.map((t) => [
          h('button.link.tipo-entita', { onclick: () => azioni.cercaTipo(t.type) }, t.type),
          intero(t.count),
        ]),
        { numeriche: [1] },
      ),
      h('p.nota', 'I record complessi (ereditarietà multipla) sono contati sotto ogni tipo dichiarato: la somma può superare il numero di entità.'),
    ),
  );
  return root;
}

/* ----------------------------------------------------------- diagnostica */

export function pannelloDiagnostica(model, stato = {}, azioni = {}) {
  const root = h('div');
  const rigaDiagnostica = (d) => {
    // «Nome parte (#id): messaggio» -> nome cliccabile
    const m = /^(.*?) \(#(\d+)\): (.*)$/.exec(d);
    if (!m) return h('li', d);
    const idx = model.parti.findIndex((p) => p.nome === m[1] && String(p.id) === m[2]);
    return h('li',
      idx >= 0 && azioni.selezionaParte ? h('button.link', { onclick: () => azioni.selezionaParte(idx) }, m[1]) : m[1],
      ` (#${m[2]}): ${m[3]}`);
  };
  const s = model.statistiche;
  root.appendChild(
    sezione(
      'Lettura del file',
      coppie([
        ['Dimensione', `${(s.byte / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} kB`],
        ['Righe', intero(s.righe)],
        ['Entità lette', intero(s.entita)],
        ['Tipi distinti', s.tipi],
        ['Tempo di lettura', `${s.msLettura} ms`],
        ['Triangoli generati', intero(s.triangoli)],
      ]),
    ),
  );
  root.appendChild(
    sezione(
      `Segnalazioni (${model.diagnostics.length})`,
      model.diagnostics.length
        ? h('ul.elenco', ...model.diagnostics.slice(0, 500).map(rigaDiagnostica))
        : h('p.ok', 'Nessuna anomalia: tutte le facce sono state tassellate e le mesh sono coerenti.'),
    ),
  );
  return root;
}

/* --------------------------------------------------- dettaglio selezione */

export function dettaglioSelezione(model, sel, azioni) {
  if (!sel) return null;
  const um = model.units.simbolo || 'mm';
  const parte = model.parti[sel.parte];
  const faccia = parte ? parte.facce.find((f) => f.id === sel.faccia) : null;
  const righe = [
    ['Parte', parte ? parte.nome : '—'],
    ['Percorso', parte && parte.percorso !== parte.nome ? parte.percorso : ''],
  ];
  if (faccia) {
    righe.push(
      ['Faccia', h('span', { title: faccia.tipoSuperficie }, `${nomeSuperficie(faccia.tipoSuperficie)} · #${faccia.id}`)],
      ['Area faccia', `${fmt(faccia.area, 2)} ${um}²`],
    );
    righe.push(...infoSuperficieRighe(faccia.infoSuperficie, um, parte.matrice));
  } else if (parte) {
    righe.push(
      ['Area', `${fmt(parte.area, 1)} ${um}²`],
      ['Volume', parte.chiusa ? [volumeTesto(parte), ` ${um}³`] : '—'],
      ['Ingombro', `${vec((parte.bboxMondo || parte.bbox).size, 1, ' × ')} ${um}`],
      ['Visibilità', parte.visibile === false ? 'parte nascosta' : ''],
    );
  }
  if (sel.punto && sel.daClic) righe.push(['Punto cliccato', `${vec(sel.punto, 2)} ${um}`]);
  const bottoni = h('div.riga-bottoni',
    h('button.mini', { onclick: () => azioni.inquadraSelezione() }, 'inquadra'),
    sel.normale ? h('button.mini', { onclick: () => azioni.vistaNormale() }, 'vista normale') : null,
    parte ? h('button.mini', { onclick: () => azioni.isola(sel.parte) }, 'isola parte') : null,
    parte && parte.visibile !== false ? h('button.mini', { onclick: () => azioni.visibilita(sel.parte, false) }, 'nascondi parte') : null,
    parte && parte.visibile === false ? h('button.mini', { onclick: () => azioni.visibilita(sel.parte, true) }, 'mostra parte') : null,
    h('button.mini', { onclick: () => azioni.deseleziona() }, 'chiudi'),
  );
  return h('div', coppie(righe), bottoni);
}
