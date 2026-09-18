/**
 * Applicazione: carica i file STEP, mostra il modello 3D e tutti i dati
 * ricavati dal file. Nessuna dipendenza esterna.
 */

import { OrbitCamera } from '../viewer/camera.js';
import { PALETTE, Renderer } from '../viewer/renderer.js';
import { pick } from '../viewer/picking.js';
import {
  dettaglioSelezione,
  h,
  pannelloDati,
  pannelloDiagnostica,
  pannelloEntita,
  pannelloGeometria,
  pannelloStruttura,
} from './panels.js';
import {
  entitaCSV,
  esportaOBJ,
  esportaSTL,
  facceCSV,
  partiCSV,
  reportJSON,
  scarica,
} from './exporters.js';

const $ = (sel) => document.querySelector(sel);

const stato = {
  model: null,
  nomeFile: '',
  schedaAttiva: 'struttura',
  parteSelezionata: -1,
  facciaSelezionata: -1,
  selezione: null,
  ricercaEntita: '',
  risultatiEntita: null,
  entitaAperta: null,
  misura: { attiva: false, punti: [] },
  tolleranza: 0.1,
  tema: 'scuro',
};

let renderer;
let camera;
let worker = null;
let fallbackModuli = null;
let needsRender = true;

/* --------------------------------------------------------------- utilita' */

function log(messaggio, tipo = 'info') {
  const el = $('#stato-messaggio');
  el.textContent = messaggio;
  el.className = 'stato-messaggio ' + tipo;
}

function progresso(frazione, etichetta) {
  const barra = $('#barra-progresso');
  barra.hidden = frazione >= 1;
  barra.querySelector('.riempimento').style.width = `${Math.round(frazione * 100)}%`;
  if (etichetta) log(`${etichetta}… ${Math.round(frazione * 100)}%`);
}

const fmtNum = (v, d = 2) =>
  typeof v === 'number' ? v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';

/* ---------------------------------------------------------------- worker */

function avviaWorker() {
  try {
    worker = new Worker(new URL('../worker/stepWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => gestisciMessaggio(ev.data);
    worker.onerror = () => {
      worker = null;
      log('Worker non disponibile: elaborazione nella pagina principale.', 'attenzione');
    };
  } catch {
    worker = null; // ambiente senza worker: si elabora nella pagina
  }
}

/** Elaborazione senza worker (per ambienti che non li supportano). */
async function elaboraInPagina(text, nome, tolleranza) {
  if (!fallbackModuli) {
    const [parser, model] = await Promise.all([
      import('../step/parser.js'),
      import('../step/model.js'),
    ]);
    fallbackModuli = { parser, model };
  }
  const file = fallbackModuli.parser.parseStep(text, (f, l) => progresso(f * 0.35, l));
  const m = fallbackModuli.model.buildModel(file, {
    tolerance: tolleranza,
    onProgress: (f, l) => progresso(0.35 + f * 0.65, l),
  });
  m.nomeFileCaricato = nome;
  fallbackModuli.file = file;
  fallbackModuli.valueToText = fallbackModuli.parser.valueToText;
  gestisciMessaggio({ type: 'model', model: m });
}

function gestisciMessaggio(msg) {
  if (!msg) return;
  if (msg.type === 'progress') {
    progresso(msg.frazione, msg.etichetta);
    return;
  }
  if (msg.type === 'error') {
    progresso(1, '');
    log('Errore: ' + msg.messaggio, 'errore');
    return;
  }
  if (msg.type === 'model') {
    progresso(1, '');
    caricaModello(msg.model);
    return;
  }
  if (msg.type === 'entity') {
    stato.entitaAperta = msg.data;
    aggiornaPannelli();
    return;
  }
  if (msg.type === 'search') {
    stato.risultatiEntita = msg.risultati;
    stato.ricercaEntita = msg.query;
    aggiornaPannelli();
  }
}

/* ------------------------------------------------------- caricamento file */

function apriFile(file) {
  stato.nomeFile = file.name;
  $('#nome-file').textContent = file.name;
  log(`lettura di ${file.name}…`);
  progresso(0.01, 'apertura');
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    if (worker) {
      worker.postMessage({ type: 'load', text, nome: file.name, tolleranza: stato.tolleranza });
    } else {
      elaboraInPagina(text, file.name, stato.tolleranza).catch((err) =>
        log('Errore: ' + err.message, 'errore'));
    }
  };
  reader.onerror = () => log('Impossibile leggere il file.', 'errore');
  // i file STEP sono ASCII/Latin-1: evita caratteri sostitutivi sugli accenti
  reader.readAsText(file, 'windows-1252');
}

function caricaModello(model) {
  stato.model = model;
  stato.parteSelezionata = -1;
  stato.facciaSelezionata = -1;
  stato.selezione = null;
  stato.misura.punti = [];
  model.parti.forEach((p, i) => {
    p.visibile = true;
    if (!p.colore) p.colore = PALETTE[i % PALETTE.length];
  });
  renderer.setParts(model.parti);
  renderer.selezione = -1;
  const bb = model.bbox;
  camera.fit(bb, renderer.canvas.clientWidth / Math.max(1, renderer.canvas.clientHeight));
  $('#sezione-posizione').min = '-1';
  $('#sezione-posizione').max = '1';
  impostaSezione();
  aggiornaPannelli();
  aggiornaBarraStato();
  needsRender = true;
  const n = model.parti.length;
  log(`${stato.nomeFile}: ${model.statistiche.entita.toLocaleString('it-IT')} entità, ${n} part${n === 1 ? 'e' : 'i'}, ${model.statistiche.triangoli.toLocaleString('it-IT')} triangoli`, 'ok');
  if (!model.parti.length) log('Nessuna geometria solida trovata: il file contiene solo dati.', 'attenzione');
}

/* ---------------------------------------------------------------- pannelli */

const azioni = {
  selezionaParte(i) {
    stato.parteSelezionata = i;
    stato.facciaSelezionata = -1;
    renderer.selezione = -1;
    stato.selezione = { parte: i, faccia: -1, punto: stato.model.parti[i].centroide };
    aggiornaPannelli();
    needsRender = true;
  },
  selezionaNodo(n) {
    const ids = new Set(n.items.map((i) => i.item.id));
    const idx = stato.model.parti.findIndex((p) => ids.has(p.id));
    if (idx >= 0) azioni.selezionaParte(idx);
  },
  selezionaFaccia(parte, faccia) {
    stato.parteSelezionata = parte;
    stato.facciaSelezionata = faccia;
    renderer.selezione = faccia;
    const p = stato.model.parti[parte];
    stato.selezione = { parte, faccia, punto: p.centroide };
    aggiornaPannelli();
    needsRender = true;
  },
  visibilita(i, visibile) {
    stato.model.parti[i].visibile = visibile;
    renderer.setVisibilita(i, visibile);
    needsRender = true;
  },
  isola(i) {
    stato.model.parti.forEach((p, k) => {
      p.visibile = k === i;
      renderer.setVisibilita(k, k === i);
    });
    aggiornaPannelli();
    needsRender = true;
  },
  tuttoVisibile(v) {
    stato.model.parti.forEach((p, k) => {
      p.visibile = v;
      renderer.setVisibilita(k, v);
    });
    aggiornaPannelli();
    needsRender = true;
  },
  cercaEntita(query) {
    if (worker) worker.postMessage({ type: 'search', query });
    else cercaInPagina({ query });
  },
  cercaTipo(tipo) {
    if (worker) worker.postMessage({ type: 'entitiesOfType', tipo });
    else cercaInPagina({ tipo });
  },
  apriEntita(id) {
    if (worker) worker.postMessage({ type: 'entity', id });
    else cercaInPagina({ id });
  },
};

/** Ricerca entità senza worker. */
function cercaInPagina({ query, tipo, id }) {
  const f = fallbackModuli && fallbackModuli.file;
  if (!f) return;
  const testo = (ent) => {
    const part = (t, p) => `${t}(${p.map(fallbackModuli.valueToText).join(',')})`;
    return ent.complex
      ? `#${ent.id}=(${ent.complex.map((p) => part(p.type, p.params)).join('')});`
      : `#${ent.id}=${part(ent.type, ent.params)};`;
  };
  if (id != null) {
    const ent = f.entities.get(id);
    if (!ent) return;
    const refs = [];
    const walk = (v) => {
      if (v == null) return;
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') {
        if ('ref' in v) refs.push(v.ref);
        else if ('typed' in v) walk(v.value);
      }
    };
    walk(ent.complex ? ent.complex.map((p) => p.params) : ent.params);
    gestisciMessaggio({
      type: 'entity',
      data: {
        id: ent.id,
        tipi: ent.types,
        testo: testo(ent),
        riferimenti: [...new Set(refs)],
        citataDa: f.referrers(ent.id).map((e) => e.id),
      },
    });
    return;
  }
  const q = String(tipo || query || '').trim().toUpperCase();
  const risultati = [];
  if (/^#?\d+$/.test(q)) {
    const ent = f.entities.get(Number(q.replace('#', '')));
    if (ent) risultati.push({ id: ent.id, tipi: ent.types, testo: testo(ent) });
  } else {
    for (const ent of f.entities.values()) {
      if (risultati.length >= 200) break;
      if (ent.types.some((t) => t.includes(q)) || testo(ent).toUpperCase().includes(q)) {
        risultati.push({ id: ent.id, tipi: ent.types, testo: testo(ent).slice(0, 400) });
      }
    }
  }
  gestisciMessaggio({ type: 'search', risultati, query: q });
}

function aggiornaPannelli() {
  const cont = $('#pannello');
  cont.replaceChildren();
  if (!stato.model) {
    cont.appendChild(h('p.vuoto', 'Carica un file .stp o .step per vederne struttura e dati.'));
    return;
  }
  const m = stato.model;
  const pannelli = {
    struttura: () => pannelloStruttura(m, stato, azioni),
    dati: () => pannelloDati(m),
    geometria: () => pannelloGeometria(m, stato, azioni),
    entita: () => pannelloEntita(m, stato, azioni),
    diagnostica: () => pannelloDiagnostica(m),
  };
  cont.appendChild((pannelli[stato.schedaAttiva] || pannelli.struttura)());
  const det = $('#dettaglio');
  det.replaceChildren(dettaglioSelezione(m, stato.selezione));
  aggiornaMisura();
  document.querySelectorAll('.scheda').forEach((b) => {
    b.classList.toggle('attiva', b.dataset.scheda === stato.schedaAttiva);
  });
}

function aggiornaBarraStato() {
  const m = stato.model;
  if (!m) return;
  const u = m.units.lunghezza ? m.units.lunghezza.nome.toLowerCase() : 'n.d.';
  $('#barra-stato-dati').textContent =
    `unità: ${u} · entità: ${m.statistiche.entita.toLocaleString('it-IT')} · parti: ${m.parti.length} · ` +
    `triangoli: ${m.statistiche.triangoli.toLocaleString('it-IT')} · ` +
    `ingombro: ${m.bbox.size.map((x) => fmtNum(x, 1)).join(' × ')} ${m.units.simbolo || 'mm'}`;
}

function aggiornaMisura() {
  const box = $('#misura-info');
  const pts = stato.misura.punti;
  if (!stato.misura.attiva) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (pts.length === 0) {
    box.replaceChildren(h('span', 'Modalità misura: clicca il primo punto.'));
    return;
  }
  if (pts.length === 1) {
    box.replaceChildren(h('span', 'Primo punto fissato: clicca il secondo.'));
    return;
  }
  const [a, b] = pts;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const um = (stato.model && stato.model.units.simbolo) || 'mm';
  box.replaceChildren(
    h('span.misura-valore', `distanza ${fmtNum(Math.hypot(...d), 3)} ${um}`),
    h('span', `ΔX ${fmtNum(d[0], 3)}  ΔY ${fmtNum(d[1], 3)}  ΔZ ${fmtNum(d[2], 3)}`),
    h('button.mini', { onclick: () => { stato.misura.punti = []; aggiornaMisura(); } }, 'azzera'),
  );
}

/* ------------------------------------------------------------ interazione */

function impostaSezione() {
  const asse = $('#sezione-asse').value;
  const attiva = $('#sezione-attiva').checked;
  const t = Number($('#sezione-posizione').value);
  const normale = asse === 'x' ? [1, 0, 0] : asse === 'y' ? [0, 1, 0] : [0, 0, 1];
  const bb = stato.model ? stato.model.bbox : { min: [0, 0, 0], max: [0, 0, 0] };
  const k = asse === 'x' ? 0 : asse === 'y' ? 1 : 2;
  const centro = (bb.min[k] + bb.max[k]) / 2;
  const mezzo = Math.max(1e-6, (bb.max[k] - bb.min[k]) / 2) * 1.05;
  renderer.clip = { attivo: attiva, normale, offset: centro + t * mezzo };
  needsRender = true;
}

function collegaInterazione() {
  const canvas = renderer.canvas;
  let trascina = null;

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    trascina = { x: ev.clientX, y: ev.clientY, bottone: ev.button, mosso: false, shift: ev.shiftKey };
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (trascina) {
      const dx = ev.clientX - trascina.x;
      const dy = ev.clientY - trascina.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) trascina.mosso = true;
      const pan = trascina.bottone === 1 || trascina.bottone === 2 || trascina.shift;
      if (pan) camera.pan(dx, dy, canvas.clientHeight);
      else camera.orbit(dx * 0.008, dy * 0.008);
      trascina.x = ev.clientX;
      trascina.y = ev.clientY;
      needsRender = true;
      return;
    }
    if (!stato.model) return;
    const hit = colpisci(ev);
    const nuovo = hit ? hit.faccia : -1;
    if (nuovo !== renderer.hover) {
      renderer.hover = nuovo;
      needsRender = true;
      canvas.style.cursor = hit ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('pointerup', (ev) => {
    const era = trascina;
    trascina = null;
    if (!era || era.mosso || !stato.model) return;
    const hit = colpisci(ev);
    if (!hit) {
      stato.selezione = null;
      stato.facciaSelezionata = -1;
      renderer.selezione = -1;
      aggiornaPannelli();
      needsRender = true;
      return;
    }
    if (stato.misura.attiva) {
      stato.misura.punti.push(hit.punto);
      if (stato.misura.punti.length > 2) stato.misura.punti = [hit.punto];
      aggiornaMisura();
      needsRender = true;
      return;
    }
    stato.parteSelezionata = hit.parte;
    stato.facciaSelezionata = hit.faccia;
    renderer.selezione = hit.faccia;
    stato.selezione = hit;
    aggiornaPannelli();
    needsRender = true;
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const fattore = Math.exp(ev.deltaY * 0.0012);
    const hit = stato.model ? colpisci(ev) : null;
    camera.zoomTo(fattore, hit ? hit.punto : null);
    needsRender = true;
  }, { passive: false });

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    const viste = { 1: 'fronte', 2: 'retro', 3: 'sinistra', 4: 'destra', 5: 'alto', 6: 'basso', 0: 'iso' };
    if (viste[ev.key]) {
      camera.setVista(viste[ev.key]);
      needsRender = true;
    }
    if (ev.key === 'f' && stato.model) {
      camera.fit(stato.model.bbox, renderer.canvas.clientWidth / renderer.canvas.clientHeight);
      needsRender = true;
    }
    if (ev.key === 'w') {
      renderer.mostraSpigoli = !renderer.mostraSpigoli;
      needsRender = true;
    }
    if (ev.key === 'm') {
      stato.misura.attiva = !stato.misura.attiva;
      $('#misura-attiva').checked = stato.misura.attiva;
      aggiornaMisura();
    }
  });
}

function colpisci(ev) {
  const rect = renderer.canvas.getBoundingClientRect();
  const ray = camera.ray(
    ev.clientX - rect.left,
    ev.clientY - rect.top,
    rect.width,
    rect.height,
  );
  return pick(ray, stato.model.parti, { clip: renderer.clip });
}

/* ------------------------------------------------------------- barra comandi */

function collegaComandi() {
  $('#file-input').onchange = (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (file) apriFile(file);
  };
  $('#bottone-apri').onclick = () => $('#file-input').click();

  document.querySelectorAll('.scheda').forEach((b) => {
    b.onclick = () => {
      stato.schedaAttiva = b.dataset.scheda;
      aggiornaPannelli();
    };
  });

  document.querySelectorAll('[data-vista]').forEach((b) => {
    b.onclick = () => {
      camera.setVista(b.dataset.vista);
      needsRender = true;
    };
  });

  $('#bottone-fit').onclick = () => {
    if (stato.model) {
      camera.fit(stato.model.bbox, renderer.canvas.clientWidth / renderer.canvas.clientHeight);
      needsRender = true;
    }
  };

  $('#modo-vista').onchange = (ev) => {
    const v = ev.target.value;
    renderer.mostraFacce = v !== 'wireframe';
    renderer.mostraSpigoli = v !== 'solido';
    needsRender = true;
  };

  $('#proiezione').onchange = (ev) => {
    camera.prospettiva = ev.target.value === 'prospettiva';
    needsRender = true;
  };

  $('#opacita').oninput = (ev) => {
    renderer.opacita = Number(ev.target.value);
    needsRender = true;
  };

  $('#mostra-bbox').onchange = (ev) => {
    renderer.mostraBbox = ev.target.checked;
    needsRender = true;
  };
  $('#mostra-assi').onchange = (ev) => {
    renderer.mostraAssi = ev.target.checked;
    needsRender = true;
  };
  $('#misura-attiva').onchange = (ev) => {
    stato.misura.attiva = ev.target.checked;
    stato.misura.punti = [];
    aggiornaMisura();
  };

  $('#sezione-attiva').onchange = impostaSezione;
  $('#sezione-asse').onchange = impostaSezione;
  $('#sezione-posizione').oninput = impostaSezione;

  $('#tema').onchange = (ev) => {
    stato.tema = ev.target.value;
    document.documentElement.dataset.tema = stato.tema;
    renderer.sfondo = stato.tema === 'chiaro' ? [0.93, 0.94, 0.96] : [0.09, 0.10, 0.12];
    needsRender = true;
  };

  $('#tolleranza').onchange = (ev) => {
    stato.tolleranza = Number(ev.target.value);
    if (!stato.model) return;
    log('nuova tassellazione…');
    if (worker) worker.postMessage({ type: 'retessellate', tolleranza: stato.tolleranza });
    else if (fallbackModuli && fallbackModuli.file) {
      const m = fallbackModuli.model.buildModel(fallbackModuli.file, { tolerance: stato.tolleranza });
      m.nomeFileCaricato = stato.nomeFile;
      caricaModello(m);
    }
  };

  const esporta = {
    json: () => scarica(base() + '-report.json', reportJSON(stato.model), 'application/json'),
    'csv-parti': () => scarica(base() + '-parti.csv', partiCSV(stato.model), 'text/csv'),
    'csv-facce': () => scarica(base() + '-facce.csv', facceCSV(stato.model), 'text/csv'),
    'csv-entita': () => scarica(base() + '-entita.csv', entitaCSV(stato.model), 'text/csv'),
    stl: () => scarica(base() + '.stl', esportaSTL(stato.model), 'model/stl'),
    obj: () => scarica(base() + '.obj', esportaOBJ(stato.model), 'text/plain'),
    png: () => {
      renderer.render(camera);
      const url = renderer.screenshot();
      const a = document.createElement('a');
      a.href = url;
      a.download = base() + '.png';
      a.click();
    },
  };
  const base = () => (stato.nomeFile || 'modello').replace(/\.[^.]+$/, '');
  $('#esporta').onchange = (ev) => {
    const v = ev.target.value;
    ev.target.value = '';
    if (!stato.model) return log('Carica prima un file.', 'attenzione');
    (esporta[v] || (() => {}))();
  };

  // trascinamento file
  const drop = document.body;
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (ev) => {
      ev.preventDefault();
      document.body.classList.add('trascinamento');
    }));
  ['dragleave', 'drop'].forEach((t) =>
    drop.addEventListener(t, (ev) => {
      ev.preventDefault();
      if (t === 'dragleave' && ev.relatedTarget) return;
      document.body.classList.remove('trascinamento');
    }));
  drop.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (file) apriFile(file);
  });
}

/* ---------------------------------------------------------------- avvio */

function loop() {
  if (needsRender) {
    try {
      renderer.render(camera);
    } catch (err) {
      log('Errore di disegno: ' + err.message, 'errore');
    }
    needsRender = false;
  }
  requestAnimationFrame(loop);
}

export function avvia() {
  const canvas = $('#vista');
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    log(err.message, 'errore');
    return;
  }
  camera = new OrbitCamera();
  document.documentElement.dataset.tema = stato.tema;
  avviaWorker();
  collegaComandi();
  collegaInterazione();
  aggiornaPannelli();
  new ResizeObserver(() => { needsRender = true; }).observe(canvas);
  window.addEventListener('resize', () => { needsRender = true; });
  loop();
  log('Pronto: trascina qui un file .stp oppure usa "Apri file".');
}
