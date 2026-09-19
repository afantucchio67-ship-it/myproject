/**
 * Worker: legge il file STEP e costruisce il modello senza bloccare la UI.
 * Mantiene in memoria il grafo delle entita' per rispondere alle
 * interrogazioni dell'esploratore entita'.
 */

import { parseStep } from '../step/parser.js';
import { buildModel } from '../step/model.js';
import { cercaEntita, entitaPerTipo, infoEntita } from '../step/esploratore.js';

let file = null;
let nomeFile = '';
/** Testo ricostruito per entita' (le ricerche testuali lo riusano). */
let cacheTesto = new Map();

/** Raccoglie le mesh trasferibili per evitare copie costose. */
function transferables(model) {
  const list = [];
  for (const p of model.parti) {
    list.push(p.mesh.positions.buffer, p.mesh.normals.buffer, p.mesh.indices.buffer, p.mesh.faceIds.buffer);
    for (const e of p.spigoli || []) list.push(e.punti.buffer);
  }
  return list;
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'load') {
      nomeFile = msg.nome || '';
      cacheTesto = new Map();
      self.postMessage({ type: 'progress', frazione: 0.02, etichetta: 'lettura del file' });
      file = parseStep(msg.text, (frazione, etichetta) =>
        self.postMessage({ type: 'progress', frazione: frazione * 0.35, etichetta }));
      const model = buildModel(file, {
        tolerance: msg.tolleranza ?? 0.1,
        onProgress: (frazione, etichetta) =>
          self.postMessage({ type: 'progress', frazione: 0.35 + frazione * 0.65, etichetta }),
      });
      model.nomeFileCaricato = nomeFile;
      self.postMessage({ type: 'model', model }, transferables(model));
      return;
    }
    if (msg.type === 'retessellate') {
      if (!file) return;
      const model = buildModel(file, {
        tolerance: msg.tolleranza,
        onProgress: (frazione, etichetta) => self.postMessage({ type: 'progress', frazione, etichetta }),
      });
      model.nomeFileCaricato = nomeFile;
      self.postMessage({ type: 'model', model }, transferables(model));
      return;
    }
    if (msg.type === 'entity') {
      self.postMessage({ type: 'entity', data: file ? infoEntita(file, msg.id, cacheTesto) : null, richiesta: msg.id });
      return;
    }
    if (msg.type === 'search') {
      if (!file) return;
      const { risultati, totale } = cercaEntita(file, msg.query, cacheTesto, msg.limite || 300);
      self.postMessage({ type: 'search', risultati, query: msg.query, totale });
      return;
    }
    if (msg.type === 'entitiesOfType') {
      if (!file) return;
      const { risultati, totale } = entitaPerTipo(file, msg.tipo, cacheTesto, msg.limite || 500);
      self.postMessage({ type: 'search', query: msg.tipo, risultati, totale });
    }
  } catch (err) {
    self.postMessage({ type: 'error', messaggio: err && err.message ? err.message : String(err) });
  }
};
