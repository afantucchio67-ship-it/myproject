/**
 * Esploratore delle entita': testo ricostruito, riferimenti, ricerca.
 * Senza DOM: lo usano il worker e, nella versione a file unico, la pagina.
 */

import { valueToText } from './parser.js';

/** Testo STEP di un'entita' (con cache opzionale: Map id -> testo). */
export function testoEntita(ent, cache = null) {
  if (cache) {
    const t = cache.get(ent.id);
    if (t !== undefined) return t;
  }
  const part = (p) => `${p.type}(${p.params.map(valueToText).join(',')})`;
  const testo = ent.complex
    ? `#${ent.id}=(${ent.complex.map(part).join('')});`
    : `#${ent.id}=${part({ type: ent.type, params: ent.params })};`;
  if (cache) cache.set(ent.id, testo);
  return testo;
}

function raccogliRiferimenti(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const v of value) raccogliRiferimenti(v, out);
    return out;
  }
  if (typeof value === 'object') {
    if ('ref' in value) out.push(value.ref);
    else if ('typed' in value) raccogliRiferimenti(value.value, out);
  }
  return out;
}

/** Scheda di un'entita': { id, tipi, testo, riferimenti, citataDa } oppure null. */
export function infoEntita(file, id, cache = null, limite = 400) {
  const ent = file.entities.get(id);
  if (!ent) return null;
  const params = ent.complex ? ent.complex.map((p) => p.params).flat() : ent.params;
  return {
    id: ent.id,
    tipi: ent.types,
    testo: testoEntita(ent, cache),
    riferimenti: [...new Set(raccogliRiferimenti(params))].slice(0, limite),
    citataDa: file.referrers(ent.id).map((e) => e.id).slice(0, limite),
  };
}

const riga = (ent, cache) => ({ id: ent.id, tipi: ent.types, testo: testoEntita(ent, cache).slice(0, 400) });

/**
 * Ricerca per #id, per tipo (sottostringa) o, in mancanza di tipi
 * corrispondenti, per testo. Restituisce { risultati, totale }.
 */
export function cercaEntita(file, query, cache = null, limite = 300) {
  const q = String(query || '').trim().toUpperCase();
  const risultati = [];
  let totale = 0;
  if (!q) return { risultati, totale };
  if (/^#?\d+$/.test(q)) {
    const ent = file.entities.get(Number(q.replace('#', '')));
    if (ent) risultati.push(riga(ent, cache));
    return { risultati, totale: risultati.length };
  }
  for (const ent of file.entities.values()) {
    if (ent.types.some((t) => t.includes(q))) {
      totale++;
      if (risultati.length < limite) risultati.push(riga(ent, cache));
    }
  }
  if (!totale) {
    for (const ent of file.entities.values()) {
      if (testoEntita(ent, cache).toUpperCase().includes(q)) {
        totale++;
        if (risultati.length < limite) risultati.push(riga(ent, cache));
      }
    }
  }
  return { risultati, totale };
}

/** Tutte le entita' di un tipo esatto. */
export function entitaPerTipo(file, tipo, cache = null, limite = 500) {
  const tutti = file.ofType(String(tipo || '').toUpperCase());
  return { risultati: tutti.slice(0, limite).map((e) => riga(e, cache)), totale: tutti.length };
}
