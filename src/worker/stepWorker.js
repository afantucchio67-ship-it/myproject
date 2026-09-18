/**
 * Worker: legge il file STEP e costruisce il modello senza bloccare la UI.
 * Mantiene in memoria il grafo delle entita' per rispondere alle
 * interrogazioni dell'esploratore entita'.
 */

import { parseStep, valueToText } from '../step/parser.js';
import { buildModel } from '../step/model.js';

let file = null;
let nomeFile = '';

function entityText(ent) {
  const part = (p) => `${p.type}(${p.params.map(valueToText).join(',')})`;
  if (ent.complex) return `#${ent.id}=(${ent.complex.map(part).join('')});`;
  return `#${ent.id}=${part({ type: ent.type, params: ent.params })};`;
}

function collectRefs(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return out;
  }
  if (typeof value === 'object') {
    if ('ref' in value) out.push(value.ref);
    else if ('typed' in value) collectRefs(value.value, out);
  }
  return out;
}

function entityInfo(id) {
  const ent = file?.entities.get(id);
  if (!ent) return null;
  const params = ent.complex ? ent.complex.map((p) => p.params).flat() : ent.params;
  return {
    id: ent.id,
    tipi: ent.types,
    testo: entityText(ent),
    riferimenti: [...new Set(collectRefs(params))].slice(0, 400),
    citataDa: file.referrers(ent.id).map((e) => e.id).slice(0, 400),
  };
}

/** Raccoglie le mesh trasferibili per evitare copie costose. */
function transferables(model) {
  const list = [];
  for (const p of model.parti) {
    list.push(p.mesh.positions.buffer, p.mesh.normals.buffer, p.mesh.indices.buffer, p.mesh.faceIds.buffer);
  }
  return list;
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'load') {
      nomeFile = msg.nome || '';
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
      self.postMessage({ type: 'entity', data: entityInfo(msg.id), richiesta: msg.id });
      return;
    }
    if (msg.type === 'search') {
      const q = String(msg.query || '').trim().toUpperCase();
      const limite = msg.limite || 200;
      const risultati = [];
      if (!file) return;
      if (/^#?\d+$/.test(q)) {
        const info = entityInfo(Number(q.replace('#', '')));
        if (info) risultati.push({ id: info.id, tipi: info.tipi, testo: info.testo });
      } else {
        for (const ent of file.entities.values()) {
          if (risultati.length >= limite) break;
          if (ent.types.some((t) => t.includes(q))) {
            risultati.push({ id: ent.id, tipi: ent.types, testo: entityText(ent).slice(0, 400) });
          }
        }
        if (!risultati.length) {
          for (const ent of file.entities.values()) {
            if (risultati.length >= limite) break;
            const testo = entityText(ent);
            if (testo.toUpperCase().includes(q)) {
              risultati.push({ id: ent.id, tipi: ent.types, testo: testo.slice(0, 400) });
            }
          }
        }
      }
      self.postMessage({ type: 'search', risultati, query: msg.query });
      return;
    }
    if (msg.type === 'entitiesOfType') {
      if (!file) return;
      const list = file.ofType(String(msg.tipo || '').toUpperCase()).slice(0, msg.limite || 500);
      self.postMessage({
        type: 'search',
        query: msg.tipo,
        risultati: list.map((e) => ({ id: e.id, tipi: e.types, testo: entityText(e).slice(0, 400) })),
      });
    }
  } catch (err) {
    self.postMessage({ type: 'error', messaggio: err && err.message ? err.message : String(err) });
  }
};
