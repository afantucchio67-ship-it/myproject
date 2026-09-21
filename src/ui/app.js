/**
 * Applicazione: carica i file STEP, mostra il modello 3D e tutti i dati
 * ricavati dal file. Nessuna dipendenza esterna.
 */

import { MARCHIO } from '../brand.js';
import { OrbitCamera } from '../viewer/camera.js';
import { PALETTE, Renderer } from '../viewer/renderer.js';
import { pick, verticeVicino } from '../viewer/picking.js';
import {
  dettaglioSelezione,
  fmt,
  h,
  intero,
  nomeSuperficie,
  pannelloDati,
  pannelloDiagnostica,
  pannelloEntita,
  pannelloGeometria,
  pannelloStruttura,
  vec,
} from './panels.js';
import {
  entitaCSV,
  esportaOBJ,
  esportaSTL,
  facceCSV,
  partiCSV,
  reportHTML,
  reportJSON,
  scarica,
} from './exporters.js';

const $ = (sel) => document.querySelector(sel);
const CHIAVE_PREFERENZE = 'visualizzatore-step.preferenze';

const stato = {
  model: null,
  nomeFile: '',
  schedaAttiva: 'struttura',
  parteSelezionata: -1,
  facciaSelezionata: -1,
  selezione: null,
  filtroAlbero: '',
  nodiChiusi: new Set(),
  ricercaEntita: '',
  risultatiEntita: null,
  totaleRisultati: 0,
  entitaAperta: null,
  misura: { attiva: false, punti: [] },
  tolleranza: 0.1,
  tema: 'scuro',
  caricamento: false,
  notaApertura: '', // avviso da ripetere nel messaggio finale (es. piu' file selezionati)
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

function mostraCaricamento(attivo, frazione = 0, etichetta = '') {
  stato.caricamento = attivo;
  const box = $('#caricamento');
  box.hidden = !attivo;
  if (attivo) {
    $('#caricamento-barra').style.width = `${Math.round(Math.max(0, Math.min(1, frazione)) * 100)}%`;
    $('#caricamento-testo').textContent = etichetta ? `${etichetta}… ${Math.round(frazione * 100)}%` : 'elaborazione…';
  }
  $('#stato-vuoto').hidden = attivo || !!stato.model;
}

function progresso(frazione, etichetta) {
  // la barra si chiude solo all'arrivo del modello (o di un errore)
  mostraCaricamento(true, Math.min(frazione, 0.99), etichetta);
}

const um = () => (stato.model && stato.model.units.simbolo) || 'mm';

function kb(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/* ------------------------------------------------------------ preferenze */

function leggiPreferenze() {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_PREFERENZE) || '{}') || {};
  } catch {
    return {};
  }
}

function salvaPreferenza(chiave, valore) {
  try {
    const p = leggiPreferenze();
    p[chiave] = valore;
    localStorage.setItem(CHIAVE_PREFERENZE, JSON.stringify(p));
  } catch {
    // memoria locale non disponibile (modalità privata): si ignora
  }
}

function applicaPreferenze() {
  const p = leggiPreferenze();
  if (p.tema === 'chiaro' || p.tema === 'scuro') {
    stato.tema = p.tema;
    $('#tema').value = p.tema;
  }
  if (p.tolleranza && [0.5, 0.1, 0.03, 0.01].includes(Number(p.tolleranza))) {
    stato.tolleranza = Number(p.tolleranza);
    $('#tolleranza').value = String(stato.tolleranza);
  }
  if (p.modo) {
    $('#modo-vista').value = p.modo;
    renderer.mostraFacce = p.modo !== 'wireframe';
    renderer.mostraSpigoli = p.modo !== 'solido';
  }
  if (p.proiezione) {
    $('#proiezione').value = p.proiezione;
    camera.prospettiva = p.proiezione !== 'ortogonale';
  }
  if (typeof p.assi === 'boolean') {
    $('#mostra-assi').checked = p.assi;
    renderer.mostraAssi = p.assi;
  }
  if (p.larghezzaPannello) $('#laterale').style.width = `${p.larghezzaPannello}px`;
  applicaTema();
}

/**
 * Inserisce il logo (incorporato come data URI) in tutti i punti previsti e
 * lo usa anche come icona della pagina: funziona pure a file unico, offline.
 */
function applicaMarchio() {
  document.querySelectorAll('img.marchio-logo').forEach((img) => { img.src = MARCHIO.logo; });
  let icona = document.querySelector('link[rel="icon"]');
  if (!icona) {
    icona = document.createElement('link');
    icona.rel = 'icon';
    document.head.appendChild(icona);
  }
  icona.type = 'image/png';
  icona.href = MARCHIO.logo;
}

function applicaTema() {
  document.documentElement.dataset.tema = stato.tema;
  renderer.setTema(stato.tema);
  needsRender = true;
}

/* ---------------------------------------------------------------- worker */

function avviaWorker() {
  // nella versione a file unico (apertura con doppio clic) i worker non sono
  // disponibili: si elabora direttamente nella pagina, a passi
  if (globalThis.__VISUALIZZATORE_FILE_UNICO) {
    worker = null;
    return;
  }
  try {
    worker = new Worker(new URL('../worker/stepWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => gestisciMessaggio(ev.data);
    worker.onerror = () => {
      // il worker non e' partito o si e' rotto: si prosegue nella pagina,
      // ripetendo l'ultimo caricamento richiesto
      try { worker.terminate(); } catch { /* gia' terminato */ }
      worker = null;
      log('Elaborazione in background non disponibile: proseguo nella pagina.', 'attenzione');
      if (ultimaRichiesta) {
        const { text, nome, tolleranza } = ultimaRichiesta;
        elaboraInPagina(text, nome, tolleranza, false).catch((err) => {
          mostraCaricamento(false);
          log('Errore durante la lettura: ' + err.message, 'errore');
        });
      } else mostraCaricamento(false);
    };
  } catch {
    worker = null; // ambiente senza worker: si elabora nella pagina
  }
}

/** Elaborazione senza worker, a passi: l'interfaccia resta reattiva. */
async function elaboraInPagina(text, nome, tolleranza, mantieni) {
  if (!fallbackModuli) {
    const [parser, model, esploratore] = await Promise.all([
      import('../step/parser.js'),
      import('../step/model.js'),
      import('../step/esploratore.js'),
    ]);
    fallbackModuli = { parser, model, esploratore };
  }
  const file = await fallbackModuli.parser.parseStepAsync(text, (f, l) => progresso(f * 0.35, l));
  fallbackModuli.file = file;
  fallbackModuli.cacheTesto = new Map();
  const m = await fallbackModuli.model.buildModelAsync(file, {
    tolerance: tolleranza,
    onProgress: (f, l) => progresso(0.35 + f * 0.65, l),
  });
  m.nomeFileCaricato = nome;
  gestisciMessaggio({ type: 'model', model: m, mantieni });
}

let attesaRitassellazione = false;
let ritassellazioneInSospeso = false; // tolleranza cambiata durante un'elaborazione
let ultimaRichiesta = null; // {text, nome, tolleranza}: per ripetere il lavoro se il worker cade

function gestisciMessaggio(msg) {
  if (!msg) return;
  if (msg.type === 'progress') {
    progresso(msg.frazione, msg.etichetta);
    return;
  }
  if (msg.type === 'error') {
    mostraCaricamento(false);
    attesaRitassellazione = false;
    ritassellazioneInSospeso = false;
    if (!stato.model) $('#stato-vuoto').hidden = false;
    log('Errore durante la lettura: ' + msg.messaggio, 'errore');
    return;
  }
  if (msg.type === 'model') {
    mostraCaricamento(false);
    const mantieni = msg.mantieni === true || attesaRitassellazione;
    attesaRitassellazione = false;
    caricaModello(msg.model, { mantieni });
    if (ritassellazioneInSospeso) {
      ritassellazioneInSospeso = false;
      if (msg.model.tolleranza !== stato.tolleranza) ritassella();
    }
    return;
  }
  if (msg.type === 'entity') {
    stato.entitaAperta = msg.data;
    if (!msg.data) log(`Entità #${msg.richiesta} non presente nel file.`, 'attenzione');
    aggiornaPannelli();
    return;
  }
  if (msg.type === 'search') {
    stato.risultatiEntita = msg.risultati;
    stato.totaleRisultati = msg.totale ?? msg.risultati.length;
    stato.ricercaEntita = msg.query;
    aggiornaPannelli();
  }
}

/* ------------------------------------------------------- caricamento file */

function apriFiles(files) {
  const lista = [...(files || [])].filter(Boolean);
  if (!lista.length) return;
  const stp = lista.filter((f) => /\.(stp|step|p21)$/i.test(f.name));
  const file = stp[0] || lista[0];
  stato.notaApertura = lista.length > 1
    ? `hai selezionato ${lista.length} file, aperto solo «${file.name}» (il visualizzatore mostra un file alla volta)`
    : '';
  if (stato.notaApertura) log(`Hai selezionato ${lista.length} file: apro «${file.name}». Il visualizzatore mostra un file alla volta.`, 'attenzione');
  apriFile(file);
}

let dimensioneFile = 0;

function apriFile(file) {
  if (stato.caricamento) {
    log('Attendi la fine dell’elaborazione in corso.', 'attenzione');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = decodificaTesto(reader.result);
    if (!/^﻿?\s*ISO-10303-21\s*;/i.test(text.slice(0, 64))) {
      log(`«${file.name}» non è un file STEP (manca l’intestazione ISO-10303-21). Il modello aperto resta invariato.`, 'errore');
      mostraCaricamento(false);
      return;
    }
    // il nome in testata cambia solo quando il nuovo modello e' pronto (caricaModello)
    attesaRitassellazione = false;
    ritassellazioneInSospeso = false;
    dimensioneFile = file.size;
    ultimaRichiesta = { text, nome: file.name, tolleranza: stato.tolleranza };
    if (worker) {
      worker.postMessage({ type: 'load', text, nome: file.name, tolleranza: stato.tolleranza });
    } else {
      elaboraInPagina(text, file.name, stato.tolleranza, false).catch((err) => {
        mostraCaricamento(false);
        log('Errore durante la lettura: ' + err.message, 'errore');
      });
    }
  };
  reader.onerror = () => {
    mostraCaricamento(false);
    log('Impossibile leggere il file.', 'errore');
  };
  mostraCaricamento(true, 0.01, `lettura di ${file.name}`);
  reader.readAsArrayBuffer(file);
}

/**
 * I file STEP sono in ASCII, ma i nomi possono contenere accenti: si prova
 * UTF-8 (rigoroso) e si ripiega su Windows-1252, togliendo il BOM.
 */
function decodificaTesto(buffer) {
  let bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function caricaModello(model, opts = {}) {
  const precedente = stato.model;
  const mantieni = opts.mantieni && precedente && precedente.parti.length === model.parti.length;
  stato.model = model;
  if (model.nomeFileCaricato) {
    stato.nomeFile = model.nomeFileCaricato;
    $('#nome-file').textContent = stato.nomeFile;
    $('#nome-file').title = dimensioneFile ? `${stato.nomeFile} · ${kb(dimensioneFile)}` : stato.nomeFile;
    document.title = `${stato.nomeFile} — Visualizzatore STEP`;
  }
  model.parti.forEach((p, i) => {
    const prima = mantieni ? precedente.parti[i] : null;
    p.visibile = prima ? prima.visibile !== false : true;
    if (!p.colore) p.colore = prima && prima.colore ? prima.colore : PALETTE[i % PALETTE.length];
  });
  renderer.setParts(model.parti);
  renderer.setEsplosione(Number($('#esplosione').value));
  if (!mantieni) {
    stato.parteSelezionata = -1;
    stato.facciaSelezionata = -1;
    stato.selezione = null;
    stato.misura.punti = [];
    stato.risultatiEntita = null;
    stato.entitaAperta = null;
    stato.nodiChiusi = new Set();
    stato.filtroAlbero = '';
    renderer.selezione = -1;
    renderer.parteSelezionata = -1;
    renderer.hover = -1;
    renderer.hoverParte = -1;
    renderer.misura.punti = [];
    stato.ricercaEntita = '';
    stato.totaleRisultati = 0;
    $('#esplosione').value = '0';
    $('#esplosione-valore').textContent = '';
    renderer.setEsplosione(0);
    const bb = model.bbox;
    camera.fit(bb, renderer.canvas.clientWidth / Math.max(1, renderer.canvas.clientHeight));
    $('#sezione-attiva').checked = false;
    $('#sezione-posizione').value = '0';
    $('#sezione-inverti').classList.remove('attivo');
    $('#suggerimento').hidden = true;
    renderer.canvas.style.cursor = 'default';
  } else {
    // la ritassellazione conserva selezione e misure
    renderer.selezione = stato.facciaSelezionata;
    renderer.parteSelezionata = stato.parteSelezionata;
    renderer.misura.punti = stato.misura.punti.slice();
  }
  // l'esplosione ha senso solo con almeno due parti
  const esplosione = $('#esplosione');
  esplosione.disabled = model.parti.length < 2;
  esplosione.title = esplosione.disabled ? 'serve un assieme con almeno due parti' : 'allontana le parti dal centro';
  impostaSezione();
  aggiornaPannelli();
  aggiornaBarraStato();
  $('#stato-vuoto').hidden = true;
  needsRender = true;
  const n = model.parti.length;
  const nota = stato.notaApertura ? ` · ${stato.notaApertura}` : '';
  stato.notaApertura = '';
  if (!n) {
    log('Nessuna geometria solida trovata: il file contiene solo dati (consulta le schede Dati ed Entità).' + nota, 'attenzione');
  } else {
    const diag = model.diagnostics.length;
    log(`${stato.nomeFile}: ${intero(model.statistiche.entita)} entità, ${n} part${n === 1 ? 'e' : 'i'}, ${intero(model.statistiche.triangoli)} triangoli` +
      (diag ? ` · ${diag} segnalazion${diag === 1 ? 'e' : 'i'} in Diagnostica` : '') + nota, nota ? 'attenzione' : 'ok');
  }
}

/* ---------------------------------------------------------------- azioni */

/** Ingombro mondo di una faccia (dai triangoli con quel faceId). */
function ingombroFaccia(indiceParte, faccia) {
  const rp = renderer.parts[indiceParte];
  if (!rp) return null;
  const { positions, indices, faceIds } = rp.ref.mesh;
  const m = rp.model;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < faceIds.length; t++) {
    if (faceIds[t] !== faccia) continue;
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k] * 3;
      const l = [positions[i], positions[i + 1], positions[i + 2]];
      const w = [
        m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12],
        m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13],
        m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14],
      ];
      for (let a = 0; a < 3; a++) {
        if (w[a] < min[a]) min[a] = w[a];
        if (w[a] > max[a]) max[a] = w[a];
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function inquadra(bbox) {
  if (!bbox) return;
  camera.fit(bbox, renderer.canvas.clientWidth / Math.max(1, renderer.canvas.clientHeight));
  needsRender = true;
}

/**
 * Unico punto che modifica la selezione: aggiorna lo stato, il renderer e i
 * pannelli. `sel` = null oppure { parte, faccia = -1, punto, normale, daClic }.
 */
function impostaSelezione(sel) {
  stato.selezione = sel;
  stato.parteSelezionata = sel ? sel.parte : -1;
  stato.facciaSelezionata = sel && sel.faccia > 0 ? sel.faccia : -1;
  renderer.parteSelezionata = stato.parteSelezionata;
  renderer.selezione = stato.facciaSelezionata;
  aggiornaPannelli();
  needsRender = true;
}

const azioni = {
  selezionaParte(i) {
    if (!stato.model || !stato.model.parti[i]) return;
    const p = stato.model.parti[i];
    impostaSelezione({ parte: i, faccia: -1, punto: renderer.parts[i] ? renderer.parts[i].centroMondo : p.centroide });
  },
  selezionaNodo(indici) {
    if (indici.length) azioni.selezionaParte(indici[0]);
  },
  selezionaFaccia(parte, faccia) {
    const bb = ingombroFaccia(parte, faccia);
    impostaSelezione({
      parte,
      faccia,
      punto: bb ? [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2] : null,
    });
  },
  deseleziona() {
    impostaSelezione(null);
  },
  inquadraParti(indici) {
    inquadra(renderer.ingombroVisibile(indici));
  },
  inquadraFaccia(parte, faccia) {
    inquadra(ingombroFaccia(parte, faccia) || renderer.ingombroVisibile([parte]));
  },
  inquadraSelezione() {
    const s = stato.selezione;
    if (!s) return inquadra(renderer.ingombroVisibile());
    if (s.faccia > 0) return azioni.inquadraFaccia(s.parte, s.faccia);
    return azioni.inquadraParti([s.parte]);
  },
  vistaNormale() {
    const s = stato.selezione;
    if (!s || !s.normale) return;
    camera.guardaLungo(s.normale);
    if (s.punto) camera.target = s.punto.slice();
    needsRender = true;
  },
  visibilita(i, visibile) {
    stato.model.parti[i].visibile = visibile;
    renderer.setVisibilita(i, visibile);
    dopoVisibilita();
  },
  visibilitaMultipla(indici, visibile) {
    for (const i of indici) {
      stato.model.parti[i].visibile = visibile;
      renderer.setVisibilita(i, visibile);
    }
    dopoVisibilita();
  },
  isola(i) {
    stato.model.parti.forEach((p, k) => {
      p.visibile = k === i;
      renderer.setVisibilita(k, k === i);
    });
    dopoVisibilita();
  },
  tuttoVisibile(v) {
    stato.model.parti.forEach((p, k) => {
      p.visibile = v;
      renderer.setVisibilita(k, v);
    });
    dopoVisibilita();
  },
  inverti() {
    stato.model.parti.forEach((p, k) => {
      p.visibile = p.visibile === false;
      renderer.setVisibilita(k, p.visibile);
    });
    dopoVisibilita();
  },
  colore(i, rgb) {
    renderer.setColore(i, rgb);
    needsRender = true;
  },
  hoverParte(i) {
    renderer.hoverParte = i;
    needsRender = true;
  },
  hoverFaccia(id) {
    renderer.hover = id;
    needsRender = true;
  },
  toggleNodo(chiave) {
    if (stato.nodiChiusi.has(chiave)) stato.nodiChiusi.delete(chiave);
    else stato.nodiChiusi.add(chiave);
    aggiornaPannelli();
  },
  filtraAlbero(testo) {
    stato.filtroAlbero = testo;
    // ricostruisce solo l'albero, mantenendo il fuoco nel campo
    const campo = document.activeElement;
    const pos = campo && campo.selectionStart;
    aggiornaPannelli();
    const nuovo = $('#pannello .ricerca');
    if (nuovo) {
      nuovo.focus();
      try { nuovo.setSelectionRange(pos, pos); } catch { /* campi search senza selezione */ }
    }
  },
  cercaEntita(query) {
    stato.ricercaEntita = query;
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
  mostraEntitaIn3D(id) {
    const m = stato.model;
    const iParte = m.parti.findIndex((p) => p.id === id);
    if (iParte >= 0) {
      azioni.selezionaParte(iParte);
      azioni.inquadraParti([iParte]);
      return;
    }
    const iFaccia = m.parti.findIndex((p) => p.facce.some((f) => f.id === id));
    if (iFaccia >= 0) {
      azioni.selezionaFaccia(iFaccia, id);
      azioni.inquadraFaccia(iFaccia, id);
    }
  },
  async copiaTesto(testo) {
    try {
      await navigator.clipboard.writeText(testo);
      log('Copiato negli appunti.', 'ok');
    } catch {
      log('Copia non consentita dal browser: seleziona il testo e usa Ctrl+C.', 'attenzione');
    }
  },
};

/** Dopo un cambio di visibilita': una parte selezionata ma nascosta viene deselezionata. */
function dopoVisibilita() {
  const sel = stato.parteSelezionata;
  if (sel >= 0 && stato.model.parti[sel] && stato.model.parti[sel].visibile === false) {
    impostaSelezione(null); // aggiorna gia' i pannelli
  } else aggiornaPannelli();
  needsRender = true;
}

/** Ricerca entità senza worker (stesso modulo usato dal worker). */
function cercaInPagina({ query, tipo, id }) {
  const f = fallbackModuli && fallbackModuli.file;
  if (!f) return;
  const E = fallbackModuli.esploratore;
  const cache = fallbackModuli.cacheTesto;
  if (id != null) return gestisciMessaggio({ type: 'entity', data: E.infoEntita(f, id, cache), richiesta: id });
  const { risultati, totale } = tipo ? E.entitaPerTipo(f, tipo, cache) : E.cercaEntita(f, query, cache);
  gestisciMessaggio({ type: 'search', risultati, query: tipo || query, totale });
}

/* --------------------------------------------------------------- pannelli */

function aggiornaPannelli() {
  const cont = $('#pannello');
  const scroll = cont.scrollTop;
  cont.replaceChildren();
  const m = stato.model;
  if (!m) {
    cont.appendChild(h('div.vuoto-pannello',
      h('p', 'Nessun file aperto.'),
      h('p.tenue', 'Trascina un file .stp o .step nella finestra, oppure usa «Apri file…». Il file resta sul tuo computer.')));
    aggiornaDettaglio();
    return;
  }
  const pannelli = {
    struttura: () => pannelloStruttura(m, stato, azioni),
    dati: () => pannelloDati(m),
    geometria: () => pannelloGeometria(m, stato, azioni),
    entita: () => pannelloEntita(m, stato, azioni),
    diagnostica: () => pannelloDiagnostica(m, stato, azioni),
  };
  cont.appendChild((pannelli[stato.schedaAttiva] || pannelli.struttura)());
  cont.scrollTop = scroll;
  const riga = cont.querySelector('tr.selezionata');
  if (riga && typeof riga.scrollIntoView === 'function') riga.scrollIntoView({ block: 'nearest' });
  document.querySelectorAll('.scheda').forEach((b) => {
    b.classList.toggle('attiva', b.dataset.scheda === stato.schedaAttiva);
  });
  const badge = $('#badge-diagnostica');
  badge.textContent = m.diagnostics.length ? String(m.diagnostics.length) : '';
  badge.hidden = !m.diagnostics.length;
  aggiornaDettaglio();
  aggiornaMisura();
}

function aggiornaDettaglio() {
  const box = $('#dettaglio-box');
  const det = $('#dettaglio');
  if (!stato.model || !stato.selezione) {
    box.hidden = true;
    det.replaceChildren();
    return;
  }
  box.hidden = false;
  det.replaceChildren(dettaglioSelezione(stato.model, stato.selezione, azioni));
}

function aggiornaBarraStato() {
  const m = stato.model;
  const el = $('#barra-stato-dati');
  if (!m) {
    el.textContent = '';
    return;
  }
  const n = m.parti.length;
  el.textContent =
    `${um()} · ${intero(m.statistiche.entita)} entità · ${n} part${n === 1 ? 'e' : 'i'} · ${intero(m.statistiche.triangoli)} triangoli · ` +
    `ingombro ${m.bbox.size.map((x) => fmt(x, 1)).join(' × ')} ${um()}`;
}

function aggiornaMisura() {
  const box = $('#misura-info');
  const pts = stato.misura.punti;
  renderer.misura.punti = pts.slice();
  needsRender = true;
  if (!stato.misura.attiva) {
    box.hidden = true;
    $('#misura-etichetta').hidden = true;
    return;
  }
  box.hidden = false;
  const azzera = h('button.mini', { onclick: () => { stato.misura.punti = []; aggiornaMisura(); } }, 'azzera');
  if (pts.length === 0) {
    box.replaceChildren(h('span', 'Misura: clicca il primo punto sul modello (si aggancia ai vertici vicini).'));
    return;
  }
  if (pts.length === 1) {
    box.replaceChildren(h('span', `Primo punto: ${vec(pts[0], 2)} ${um()} — clicca il secondo.`), azzera);
    return;
  }
  const [a, b] = pts;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const esplosa = renderer.esplosione > 0;
  box.replaceChildren(
    h('span.misura-valore', `${fmt(Math.hypot(...d), 3)} ${um()}`),
    h('span', `ΔX ${fmt(d[0], 3)}  ΔY ${fmt(d[1], 3)}  ΔZ ${fmt(d[2], 3)}`),
    // in vista esplosa le parti sono spostate: la distanza non e' quella reale
    esplosa
      ? h('span.avviso', 'vista esplosa: distanza non reale')
      : h('button.mini', { onclick: () => azioni.copiaTesto(testoMisura()) }, 'copia'),
    azzera,
  );
}

/** Testo della misura corrente (null senza due punti). */
function testoMisura() {
  const pts = stato.misura.punti;
  if (!stato.misura.attiva || pts.length < 2) return null;
  const [a, b] = pts;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return `distanza ${fmt(Math.hypot(...d), 3)} ${um()} · ΔX ${fmt(d[0], 3)} · ΔY ${fmt(d[1], 3)} · ΔZ ${fmt(d[2], 3)}` +
    (renderer.esplosione > 0 ? ' (vista esplosa)' : '');
}

/** Carica un'immagine da URL (null se non si carica). */
function caricaImmagine(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Rifinisce lo screenshot WebGL con un canvas 2D: l'etichetta della misura e la
 * firma (logo e riferimenti), che sono elementi HTML e non finirebbero nel PNG.
 * `sfondo` ('tema' | 'bianco' | 'trasparente') decide i colori della firma.
 */
async function componiImmagine(url, sfondo = 'tema', opts = {}) {
  const [base, logo] = await Promise.all([caricaImmagine(url), caricaImmagine(MARCHIO.logo)]);
  if (!base) return url;
  try {
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    disegnaEtichettaMisura(ctx, c.width, c.height);
    // nel report la firma e' gia' in testata: non serve anche sull'immagine
    if (opts.firma !== false) disegnaFirma(ctx, c.width, c.height, logo, sfondo);
    return c.toDataURL('image/png');
  } catch {
    return url; // canvas non disponibile: si esporta l'immagine cosi' com'e'
  }
}

/** Etichetta con la distanza misurata, nella stessa posizione che ha a schermo. */
function disegnaEtichettaMisura(ctx, w, h) {
  const pts = stato.misura.punti;
  if (!stato.misura.attiva || pts.length < 2) return;
  const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, (pts[0][2] + pts[1][2]) / 2];
  const s = camera.toScreen(mid, w, h);
  if (!s) return;
  const dim = Math.max(12, Math.round(h / 45));
  const testo = `${fmt(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]), 3)} ${um()}`;
  ctx.font = `600 ${dim}px system-ui, Segoe UI, sans-serif`;
  const larghezza = ctx.measureText(testo).width + dim;
  const x = Math.min(Math.max(0, s[0] + dim * 0.6), w - larghezza);
  const y = Math.min(Math.max(dim * 1.6, s[1] - dim * 0.6), h);
  ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
  ctx.fillRect(x, y - dim * 1.4, larghezza, dim * 1.8);
  ctx.fillStyle = '#ffb347';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(testo, x + dim * 0.5, y);
}

/** Firma discreta in basso a destra: logo, nome e contatti. */
function disegnaFirma(ctx, w, h, logo, sfondo) {
  const scala = Math.max(1, Math.min(w / 900, 2.2));
  const lato = Math.round(30 * scala);
  const margine = Math.round(14 * scala);
  const dimNome = Math.round(12.5 * scala);
  const dimRiga = Math.round(10 * scala);
  const chiaro = sfondo === 'bianco' || (sfondo === 'tema' && stato.tema === 'chiaro');
  const colNome = chiaro ? '#1a1d24' : '#f2f3f7';
  const colRiga = chiaro ? '#5c6373' : '#c6cbd7';
  ctx.font = `600 ${dimNome}px system-ui, Segoe UI, sans-serif`;
  const wNome = ctx.measureText(MARCHIO.nome).width;
  ctx.font = `${dimRiga}px system-ui, Segoe UI, sans-serif`;
  const riga = `${MARCHIO.ruolo} · ${MARCHIO.email} · ${MARCHIO.telefono}`;
  const wRiga = ctx.measureText(riga).width;
  const spazio = Math.round(9 * scala);
  const larghezza = (logo ? lato + spazio : 0) + Math.max(wNome, wRiga);
  const altezza = Math.max(lato, dimNome + dimRiga + Math.round(6 * scala));
  const x = w - margine - larghezza;
  const y = h - margine - altezza;
  if (x < 0 || y < 0) return; // immagine troppo piccola: meglio non coprire il modello
  // velo leggero dietro la firma: resta leggibile su qualsiasi vista
  if (sfondo !== 'trasparente') {
    const pad = Math.round(7 * scala);
    ctx.fillStyle = chiaro ? 'rgba(255, 255, 255, 0.78)' : 'rgba(18, 20, 26, 0.62)';
    riquadroTondo(ctx, x - pad, y - pad, larghezza + pad * 2, altezza + pad * 2, Math.round(6 * scala));
    ctx.fill();
  }
  if (logo) {
    ctx.save();
    riquadroTondo(ctx, x, y + (altezza - lato) / 2, lato, lato, Math.round(5 * scala));
    ctx.clip();
    ctx.drawImage(logo, x, y + (altezza - lato) / 2, lato, lato);
    ctx.restore();
  }
  const xt = x + (logo ? lato + spazio : 0);
  ctx.textBaseline = 'top';
  ctx.fillStyle = colNome;
  ctx.font = `600 ${dimNome}px system-ui, Segoe UI, sans-serif`;
  ctx.fillText(MARCHIO.nome, xt, y);
  ctx.fillStyle = colRiga;
  ctx.font = `${dimRiga}px system-ui, Segoe UI, sans-serif`;
  ctx.fillText(riga, xt, y + dimNome + Math.round(4 * scala));
}

function riquadroTondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Posiziona a schermo l'etichetta della misura e il suggerimento al passaggio. */
function aggiornaSovrapposizioni() {
  const et = $('#misura-etichetta');
  const pts = stato.misura.punti;
  if (stato.misura.attiva && pts.length === 2) {
    const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, (pts[0][2] + pts[1][2]) / 2];
    const rect = renderer.canvas.getBoundingClientRect();
    const s = camera.toScreen(mid, rect.width, rect.height);
    if (s) {
      et.hidden = false;
      et.textContent = `${fmt(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]), 3)} ${um()}`;
      et.style.left = `${s[0]}px`;
      et.style.top = `${s[1]}px`;
    } else et.hidden = true;
  } else et.hidden = true;
}

/* ------------------------------------------------------------ interazione */

function impostaSezione() {
  const asse = $('#sezione-asse').value;
  const attiva = $('#sezione-attiva').checked;
  const t = Number($('#sezione-posizione').value);
  const inverti = $('#sezione-inverti').classList.contains('attivo');
  const k = asse === 'x' ? 0 : asse === 'y' ? 1 : 2;
  const normale = [0, 0, 0];
  normale[k] = inverti ? -1 : 1;
  // ingombro delle parti con l'esplosione applicata: il piano resta dentro la scena
  const bb = renderer.ingombroVisibile(null, false) || (stato.model ? stato.model.bbox : { min: [0, 0, 0], max: [0, 0, 0] });
  const centro = (bb.min[k] + bb.max[k]) / 2;
  const mezzo = Math.max(1e-6, (bb.max[k] - bb.min[k]) / 2) * 1.05;
  const posizione = centro + t * mezzo;
  renderer.clip = { attivo: attiva, normale, offset: posizione * normale[k] };
  $('#sezione-valore').textContent = attiva ? `${asse.toUpperCase()} = ${fmt(posizione, 2)} ${um()}` : '';
  $('#sezione-posizione').disabled = !attiva;
  $('#sezione-inverti').disabled = !attiva;
  $('#sezione-azzera').disabled = !attiva;
  needsRender = true;
}

function colpisci(ev) {
  const rect = renderer.canvas.getBoundingClientRect();
  const ray = camera.ray(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height);
  return pick(ray, renderer.parts, { clip: renderer.clip });
}

/** Raggio di aggancio della misura: ~12 px convertiti in unità del modello. */
function raggioAggancio(hit) {
  const rect = renderer.canvas.getBoundingClientRect();
  const perPixel = (2 * Math.tan(camera.fov / 2) * (hit ? hit.distanza : camera.distance)) / Math.max(1, rect.height);
  return perPixel * 12;
}

function collegaInterazione() {
  const canvas = renderer.canvas;
  const puntatori = new Map(); // pointerId -> {x, y}
  let trascina = null;
  let pizzico = null;
  let hoverRichiesto = null;

  const aggiornaHover = (ev) => {
    if (!stato.model || trascina || pizzico) return;
    hoverRichiesto = ev;
  };

  const eseguiHover = () => {
    const ev = hoverRichiesto;
    hoverRichiesto = null;
    if (!ev || !stato.model) return;
    const hit = colpisci(ev);
    const nuovo = hit ? hit.faccia : -1;
    if (nuovo !== renderer.hover) {
      renderer.hover = nuovo;
      needsRender = true;
    }
    canvas.style.cursor = hit ? (stato.misura.attiva ? 'crosshair' : 'pointer') : 'default';
    const sugg = $('#suggerimento');
    // in modalita' misura il suggerimento coprirebbe il punto da cliccare
    if (hit && !stato.misura.attiva) {
      const p = stato.model.parti[hit.parte];
      const f = p && p.facce.find((x) => x.id === hit.faccia);
      sugg.hidden = false;
      sugg.replaceChildren(
        h('strong', p ? p.nome : ''),
        f ? h('span', ` · ${nomeSuperficie(f.tipoSuperficie)} #${f.id}`) : null,
        h('br'),
        h('span.tenue', `${vec(hit.punto, 2)} ${um()}${renderer.esplosione > 0 ? ' (vista esplosa)' : ''}`),
      );
      const rect = canvas.getBoundingClientRect();
      sugg.style.left = `${ev.clientX - rect.left + 14}px`;
      sugg.style.top = `${ev.clientY - rect.top + 14}px`;
    } else sugg.hidden = true;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    puntatori.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (puntatori.size === 2) {
      const [a, b] = [...puntatori.values()];
      pizzico = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      trascina = null;
      return;
    }
    trascina = { x: ev.clientX, y: ev.clientY, bottone: ev.button, mosso: false, shift: ev.shiftKey, ctrl: ev.ctrlKey };
    $('#suggerimento').hidden = true;
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (puntatori.has(ev.pointerId)) puntatori.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pizzico && puntatori.size === 2) {
      const [a, b] = [...puntatori.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (pizzico.dist > 0) camera.zoom(pizzico.dist / Math.max(1, dist));
      camera.pan(cx - pizzico.cx, cy - pizzico.cy, canvas.clientHeight);
      pizzico = { dist, cx, cy };
      needsRender = true;
      return;
    }
    if (trascina) {
      const dx = ev.clientX - trascina.x;
      const dy = ev.clientY - trascina.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) trascina.mosso = true;
      const pan = trascina.bottone === 1 || trascina.bottone === 2 || trascina.shift || trascina.ctrl;
      if (pan) camera.pan(dx, dy, canvas.clientHeight);
      else camera.orbit(dx * 0.008, dy * 0.008);
      trascina.x = ev.clientX;
      trascina.y = ev.clientY;
      needsRender = true;
      return;
    }
    aggiornaHover(ev);
  });

  const fine = (ev) => {
    puntatori.delete(ev.pointerId);
    if (puntatori.size < 2) pizzico = null;
    const era = trascina;
    trascina = null;
    if (!era || era.mosso || !stato.model || ev.type !== 'pointerup') return;
    const hit = colpisci(ev);
    if (stato.misura.attiva) {
      if (!hit) return;
      let punto = hit.punto;
      const vicino = verticeVicino(hit.punto, renderer.parts, raggioAggancio(hit));
      if (vicino) punto = vicino.punto;
      if (stato.misura.punti.length >= 2) stato.misura.punti = [];
      stato.misura.punti.push(punto);
      aggiornaMisura();
      return;
    }
    impostaSelezione(hit ? { ...hit, daClic: true } : null);
  };
  canvas.addEventListener('pointerup', fine);
  canvas.addEventListener('pointercancel', fine);
  canvas.addEventListener('pointerleave', () => { $('#suggerimento').hidden = true; });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('dblclick', (ev) => {
    if (!stato.model) return;
    const hit = colpisci(ev);
    if (hit) {
      camera.target = hit.punto.slice();
      camera.zoom(0.7);
      needsRender = true;
    }
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const fattore = Math.exp(ev.deltaY * 0.0012);
    const hit = stato.model ? colpisci(ev) : null;
    camera.zoomTo(fattore, hit ? hit.punto : null);
    needsRender = true;
  }, { passive: false });

  // aggiorna il passaggio del mouse al massimo una volta per fotogramma
  const tick = () => {
    if (hoverRichiesto) eseguiHover();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const inCampo = t instanceof HTMLElement && (t.matches('input, select, textarea') || t.isContentEditable);
    if (ev.code === 'Escape') {
      if (!$('#aiuto').hidden) return chiudiAiuto();
      if (stato.misura.attiva) {
        // primo Esc: azzera i punti; secondo: esce dalla misura
        if (stato.misura.punti.length) {
          stato.misura.punti = [];
          aggiornaMisura();
        } else impostaMisura(false);
        return;
      }
      if (stato.selezione) azioni.deseleziona();
      if (t instanceof HTMLElement) t.blur();
      return;
    }
    if (inCampo) return;
    const viste = { Digit1: 'fronte', Digit2: 'retro', Digit3: 'sinistra', Digit4: 'destra', Digit5: 'alto', Digit6: 'basso', Digit0: 'iso' };
    if (viste[ev.code]) {
      camera.setVista(viste[ev.code]);
      needsRender = true;
      return;
    }
    switch (ev.code) {
      case 'KeyF':
        if (ev.shiftKey) azioni.inquadraSelezione();
        else inquadra(renderer.ingombroVisibile());
        break;
      case 'KeyW': {
        const sel = $('#modo-vista');
        const ordine = ['solido-spigoli', 'solido', 'wireframe'];
        sel.value = ordine[(ordine.indexOf(sel.value) + 1) % ordine.length];
        sel.dispatchEvent(new Event('change'));
        break;
      }
      case 'KeyM':
        impostaMisura(!stato.misura.attiva);
        break;
      case 'KeyS':
        $('#sezione-attiva').checked = !$('#sezione-attiva').checked;
        impostaSezione();
        break;
      case 'KeyH':
        azioni.deseleziona();
        break;
      case 'KeyP': {
        const sel = $('#proiezione');
        sel.value = sel.value === 'prospettiva' ? 'ortogonale' : 'prospettiva';
        sel.dispatchEvent(new Event('change'));
        break;
      }
      case 'Slash':
      case 'F1':
        ev.preventDefault();
        apriAiuto();
        break;
      default:
        return;
    }
    ev.preventDefault();
  });
}

/** Ritassella il modello aperto con la tolleranza corrente, conservando selezione e misure. */
function ritassella() {
  if (!stato.model || stato.caricamento) return;
  attesaRitassellazione = true;
  mostraCaricamento(true, 0.02, 'nuova tassellazione');
  if (worker) worker.postMessage({ type: 'retessellate', tolleranza: stato.tolleranza });
  else if (fallbackModuli && fallbackModuli.file) {
    const nome = stato.nomeFile;
    fallbackModuli.model.buildModelAsync(fallbackModuli.file, {
      tolerance: stato.tolleranza,
      onProgress: (f, l) => progresso(f, l),
    }).then((m) => {
      m.nomeFileCaricato = nome;
      gestisciMessaggio({ type: 'model', model: m, mantieni: true });
    }).catch((err) => {
      gestisciMessaggio({ type: 'error', messaggio: err.message });
    });
  } else {
    mostraCaricamento(false);
    attesaRitassellazione = false;
  }
}

function impostaMisura(attiva) {
  stato.misura.attiva = attiva;
  stato.misura.punti = [];
  $('#misura-attiva').classList.toggle('attivo', attiva);
  $('#misura-attiva').setAttribute('aria-pressed', attiva ? 'true' : 'false');
  aggiornaMisura();
}

function apriAiuto() {
  $('#aiuto').hidden = false;
}
function chiudiAiuto() {
  $('#aiuto').hidden = true;
}

/* ------------------------------------------------------------- comandi */

function collegaComandi() {
  $('#file-input').onchange = (ev) => {
    apriFiles(ev.target.files);
    ev.target.value = ''; // permette di riaprire lo stesso file
  };
  $('#bottone-apri').onclick = () => $('#file-input').click();
  $('#stato-vuoto').onclick = (ev) => {
    if (ev.target.closest('button')) return;
    $('#file-input').click();
  };
  $('#bottone-apri-vuoto').onclick = () => $('#file-input').click();

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

  $('#bottone-fit').onclick = () => inquadra(renderer.ingombroVisibile());
  $('#bottone-fit-selezione').onclick = () => azioni.inquadraSelezione();

  $('#modo-vista').onchange = (ev) => {
    const v = ev.target.value;
    renderer.mostraFacce = v !== 'wireframe';
    renderer.mostraSpigoli = v !== 'solido';
    salvaPreferenza('modo', v);
    needsRender = true;
  };

  $('#proiezione').onchange = (ev) => {
    camera.prospettiva = ev.target.value === 'prospettiva';
    salvaPreferenza('proiezione', ev.target.value);
    needsRender = true;
  };

  $('#opacita').oninput = (ev) => {
    renderer.opacita = Number(ev.target.value);
    $('#opacita-valore').textContent = `${Math.round(renderer.opacita * 100)}%`;
    needsRender = true;
  };

  $('#esplosione').oninput = (ev) => {
    renderer.setEsplosione(Number(ev.target.value));
    $('#esplosione-valore').textContent = Number(ev.target.value) > 0 ? `${Math.round(Number(ev.target.value) * 100)}%` : '';
    impostaSezione(); // il piano segue l'ingombro esploso
    if (stato.misura.attiva) aggiornaMisura(); // avviso «vista esplosa»
    needsRender = true;
  };

  $('#mostra-bbox').onchange = (ev) => {
    renderer.mostraBbox = ev.target.checked;
    needsRender = true;
  };
  $('#mostra-assi').onchange = (ev) => {
    renderer.mostraAssi = ev.target.checked;
    salvaPreferenza('assi', ev.target.checked);
    needsRender = true;
  };
  $('#misura-attiva').onclick = () => impostaMisura(!stato.misura.attiva);

  $('#sezione-attiva').onchange = impostaSezione;
  $('#sezione-asse').onchange = impostaSezione;
  $('#sezione-posizione').oninput = impostaSezione;
  $('#sezione-inverti').onclick = (ev) => {
    ev.currentTarget.classList.toggle('attivo');
    impostaSezione();
  };
  $('#sezione-azzera').onclick = () => {
    $('#sezione-posizione').value = '0';
    $('#sezione-inverti').classList.remove('attivo');
    impostaSezione();
  };

  $('#tema').onchange = (ev) => {
    stato.tema = ev.target.value;
    salvaPreferenza('tema', stato.tema);
    applicaTema();
  };

  $('#tolleranza').onchange = (ev) => {
    stato.tolleranza = Number(ev.target.value);
    salvaPreferenza('tolleranza', stato.tolleranza);
    if (!stato.model && !stato.caricamento) return;
    if (stato.caricamento) {
      // si applica appena finisce l'elaborazione in corso
      ritassellazioneInSospeso = true;
      log('Qualità cambiata: verrà applicata al termine dell’elaborazione in corso.', 'attenzione');
      return;
    }
    ritassella();
  };

  $('#dettaglio-comprimi').onclick = () => {
    const box = $('#dettaglio-box');
    box.classList.toggle('compresso');
    $('#dettaglio-comprimi').textContent = box.classList.contains('compresso') ? '▸' : '▾';
  };

  $('#bottone-aiuto').onclick = apriAiuto;
  $('#chiudi-aiuto').onclick = chiudiAiuto;
  $('#aiuto').onclick = (ev) => {
    if (ev.target === ev.currentTarget) chiudiAiuto();
  };

  $('#bottone-schermo').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => log('Schermo intero non disponibile.', 'attenzione'));
  };

  $('#bottone-pannello').onclick = () => {
    const lat = $('#laterale');
    lat.classList.toggle('nascosto');
    needsRender = true;
  };

  // ridimensionamento del pannello laterale
  const maniglia = $('#maniglia');
  maniglia.addEventListener('pointerdown', (ev) => {
    maniglia.setPointerCapture(ev.pointerId);
    const lat = $('#laterale');
    const inizio = ev.clientX;
    const larghezza = lat.getBoundingClientRect().width;
    const muovi = (e) => {
      const w = Math.max(260, Math.min(window.innerWidth * 0.6, larghezza + (e.clientX - inizio)));
      lat.style.width = `${w}px`;
      needsRender = true;
    };
    const fine = () => {
      maniglia.removeEventListener('pointermove', muovi);
      maniglia.removeEventListener('pointerup', fine);
      salvaPreferenza('larghezzaPannello', Math.round(lat.getBoundingClientRect().width));
    };
    maniglia.addEventListener('pointermove', muovi);
    maniglia.addEventListener('pointerup', fine);
  });

  collegaEsportazioni();

  // trascinamento file
  const drop = document.body;
  let contatore = 0;
  drop.addEventListener('dragenter', (ev) => {
    ev.preventDefault();
    contatore++;
    document.body.classList.add('trascinamento');
  });
  drop.addEventListener('dragover', (ev) => ev.preventDefault());
  drop.addEventListener('dragleave', () => {
    contatore = Math.max(0, contatore - 1);
    if (!contatore) document.body.classList.remove('trascinamento');
  });
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    contatore = 0;
    document.body.classList.remove('trascinamento');
    apriFiles(ev.dataTransfer && ev.dataTransfer.files);
  });
}

function collegaEsportazioni() {
  const menu = $('#menu-esporta');
  const bottone = $('#bottone-esporta');
  bottone.onclick = (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.onclick = (ev) => ev.stopPropagation();

  // nome base dal modello aperto (non dal file in lettura)
  const base = () => ((stato.model && stato.model.nomeFileCaricato) || stato.nomeFile || 'modello').replace(/\.[^.]+$/, '');
  const fine = (nome, contenuto) => {
    const dim = contenuto instanceof ArrayBuffer ? contenuto.byteLength : contenuto.length;
    log(`Esportato ${nome} (${kb(dim)}).`, 'ok');
  };
  const png = async (opts, suffisso) => {
    const url = await componiImmagine(renderer.screenshot(camera, opts), opts.sfondo);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base()}${suffisso}.png`;
    a.click();
    log(`Esportata l’immagine ${a.download}.`, 'ok');
  };
  const azioniEsporta = {
    json: () => { const c = reportJSON(stato.model); scarica(base() + '-report.json', c, 'application/json'); fine('report JSON', c); },
    'csv-parti': () => { const c = partiCSV(stato.model); scarica(base() + '-parti.csv', c, 'text/csv'); fine('CSV parti', c); },
    'csv-facce': () => { const c = facceCSV(stato.model); scarica(base() + '-facce.csv', c, 'text/csv'); fine('CSV facce', c); },
    'csv-entita': () => { const c = entitaCSV(stato.model); scarica(base() + '-entita.csv', c, 'text/csv'); fine('CSV entità', c); },
    'stl-bin': () => {
      const c = esportaSTL(stato.model, { soloVisibili: true, binario: true });
      scarica(base() + '.stl', new Blob([c], { type: 'model/stl' }));
      fine('STL binario (parti visibili)', c);
    },
    'stl-ascii': () => { const c = esportaSTL(stato.model, { soloVisibili: true }); scarica(base() + '-ascii.stl', c, 'model/stl'); fine('STL ASCII', c); },
    obj: () => {
      const { obj, mtl } = esportaOBJ(stato.model, { soloVisibili: true });
      scarica(base() + '.obj', `mtllib ${base()}.mtl\n` + obj, 'text/plain');
      setTimeout(() => scarica(base() + '.mtl', mtl, 'text/plain'), 300);
      fine('OBJ + MTL (parti visibili)', obj);
    },
    png: () => png({ sfondo: 'tema' }, ''),
    'png-hd': () => {
      const w = Math.min(4096, renderer.canvas.width * 2);
      png({ larghezza: w, sfondo: 'bianco' }, '-hd');
    },
    'png-trasparente': () => png({ larghezza: Math.min(4096, renderer.canvas.width * 2), sfondo: 'trasparente' }, '-trasparente'),
    stampa: async () => {
      // la finestra va aperta subito nel gestore del clic, altrimenti il browser la blocca
      const w = window.open('', '_blank');
      if (!w) return log('Il browser ha bloccato la finestra del report: consenti i pop-up per questo file.', 'attenzione');
      const immagine = await componiImmagine(renderer.screenshot(camera, { larghezza: 1600, sfondo: 'bianco' }), 'bianco', { firma: false });
      const html = reportHTML(stato.model, immagine, { nomeFile: base() + (stato.nomeFile.match(/\.[^.]+$/) || [''])[0], misura: testoMisura() });
      w.document.open();
      w.document.write(html);
      w.document.close();
      log('Report aperto in una nuova scheda: usa Stampa (Ctrl+P) per salvarlo in PDF.', 'ok');
    },
  };
  menu.querySelectorAll('[data-esporta]').forEach((b) => {
    b.onclick = async () => {
      menu.hidden = true;
      if (!stato.model) return log('Apri prima un file.', 'attenzione');
      if (stato.caricamento) return log('Attendi la fine dell’elaborazione in corso.', 'attenzione');
      try {
        await azioniEsporta[b.dataset.esporta]();
      } catch (err) {
        log('Esportazione non riuscita: ' + err.message, 'errore');
      }
    };
  });
}

/* ---------------------------------------------------------------- avvio */

function loop() {
  if (needsRender) {
    try {
      renderer.render(camera);
      aggiornaSovrapposizioni();
    } catch (err) {
      log('Errore di disegno: ' + err.message, 'errore');
    }
    needsRender = false;
  }
  requestAnimationFrame(loop);
}

export function avvia() {
  applicaMarchio(); // prima di tutto: il marchio si vede anche se WebGL manca
  const canvas = $('#vista');
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    log(err.message, 'errore');
    $('#stato-vuoto').replaceChildren(h('p', 'WebGL non è disponibile in questo browser: impossibile mostrare il modello 3D.'));
    return;
  }
  camera = new OrbitCamera();
  renderer.onContesto = (statoCtx) => {
    if (statoCtx === 'perso') log('Il contesto grafico è stato perso (memoria video esaurita?): in attesa del ripristino…', 'attenzione');
    else {
      needsRender = true;
      log('Contesto grafico ripristinato.', 'ok');
    }
  };
  avviaWorker();
  collegaComandi();
  collegaInterazione();
  applicaPreferenze();
  impostaSezione();
  aggiornaPannelli();
  new ResizeObserver(() => { needsRender = true; }).observe(canvas);
  window.addEventListener('resize', () => { needsRender = true; });
  loop();
  log('Pronto: trascina un file .stp nella finestra oppure usa «Apri file…».');
}
