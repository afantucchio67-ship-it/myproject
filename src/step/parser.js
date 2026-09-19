/**
 * Parser ISO-10303-21 (STEP / .stp / .step).
 *
 * Nessuna dipendenza: legge il testo del file e produce un grafo di entita'
 * navigabile (id -> record) piu' gli indici per tipo e i riferimenti inversi.
 *
 * Valori restituiti:
 *   numero            -> Number
 *   stringa '...'     -> { str: "..." }
 *   riferimento #12   -> { ref: 12 }
 *   enum .T. .F. ...  -> { enum: "T" }
 *   binario "0A3"     -> { bin: "0A3" }
 *   $ (non impostato) -> null
 *   * (derivato)      -> { derived: true }
 *   lista (a,b,c)     -> Array
 *   tipizzato NAME(v) -> { typed: "NAME", value: v }
 */

const RE_NAME = /[A-Za-z_][A-Za-z0-9_]*/;

export class StepEntity {
  constructor(id, type, params, complex) {
    this.id = id;
    this.type = type;
    this.params = params;
    /** @type {Array<{type:string, params:any[]}>|null} record complessi (ereditarieta' multipla) */
    this.complex = complex || null;
  }

  /** Tutti i tipi dichiarati dal record (uno, o molti se complesso). */
  get types() {
    return this.complex ? this.complex.map((p) => p.type) : [this.type];
  }

  /** Parametri della prima parte che dichiara `type` (utile nei record complessi). */
  partParams(type) {
    if (!this.complex) return this.type === type ? this.params : null;
    const part = this.complex.find((p) => p.type === type);
    return part ? part.params : null;
  }

  has(type) {
    return this.types.includes(type);
  }
}

export class StepFile {
  constructor() {
    this.header = [];
    /** @type {Map<number, StepEntity>} */
    this.entities = new Map();
    /** @type {Map<string, StepEntity[]>} */
    this.byType = new Map();
    /** @type {Map<number, Set<number>>} id -> id delle entita' che lo citano */
    this.usedBy = new Map();
    this.warnings = [];
    this.stats = { bytes: 0, lines: 0, parseMs: 0 };
  }

  get(value) {
    if (value == null) return null;
    if (typeof value === 'number') return this.entities.get(value) || null;
    if (typeof value === 'object' && 'ref' in value) return this.entities.get(value.ref) || null;
    return null;
  }

  /** Risolve una lista di riferimenti in entita' (salta i buchi). */
  getAll(list) {
    if (!Array.isArray(list)) return [];
    return list.map((v) => this.get(v)).filter(Boolean);
  }

  ofType(type) {
    return this.byType.get(type) || [];
  }

  /** Entita' che citano `id`. */
  referrers(id) {
    const set = this.usedBy.get(id);
    return set ? [...set].map((i) => this.entities.get(i)).filter(Boolean) : [];
  }

  headerEntity(type) {
    return this.header.find((h) => h.type === type) || null;
  }

  /** Conteggio entita' per tipo, ordinato per frequenza. */
  typeCounts() {
    const out = [];
    for (const [type, list] of this.byType) out.push({ type, count: list.length });
    out.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    return out;
  }
}

/** Decodifica le stringhe STEP: '' -> ', \X2\..\X0\ e \X\ per i caratteri non ASCII. */
export function decodeStepString(raw) {
  let s = raw.replace(/''/g, "'");
  s = s.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex) => {
    let out = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = parseInt(hex.substr(i, 4), 16);
      if (!Number.isNaN(code)) out += String.fromCharCode(code);
    }
    return out;
  });
  s = s.replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex) => {
    let out = '';
    for (let i = 0; i + 7 < hex.length + 1; i += 8) {
      const code = parseInt(hex.substr(i, 8), 16);
      if (!Number.isNaN(code)) out += String.fromCodePoint(code);
    }
    return out;
  });
  s = s.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/\\S\\(.)/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 128));
  s = s.replace(/\\N\\/g, '\n').replace(/\\\\/g, '\\');
  return s;
}

/** Testo semplice di un parametro (per le tabelle della UI). */
export function valueToText(v) {
  if (v === null) return '$';
  if (Array.isArray(v)) return '(' + v.map(valueToText).join(',') + ')';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if ('ref' in v) return '#' + v.ref;
    if ('str' in v) return "'" + v.str + "'";
    if ('enum' in v) return '.' + v.enum + '.';
    if ('bin' in v) return '"' + v.bin + '"';
    if ('derived' in v) return '*';
    if ('typed' in v) return v.typed + '(' + valueToText(v.value) + ')';
  }
  return String(v);
}

class Cursor {
  constructor(text) {
    this.t = text;
    this.i = 0;
    this.n = text.length;
  }

  /** Porta il cursore oltre il prossimo ';' (o a fine testo se manca): mai un passo nullo. */
  oltre(ch = ';') {
    const k = this.t.indexOf(ch, this.i);
    this.i = k < 0 ? this.n : k + 1;
  }

  skip() {
    const t = this.t;
    while (this.i < this.n) {
      const c = t.charCodeAt(this.i);
      // spazi, tab, CR, LF
      if (c === 32 || c === 9 || c === 13 || c === 10) {
        this.i++;
      } else if (c === 47 /* / */ && t.charCodeAt(this.i + 1) === 42 /* * */) {
        const end = t.indexOf('*/', this.i + 2);
        this.i = end < 0 ? this.n : end + 2;
      } else {
        break;
      }
    }
  }

  peek() {
    this.skip();
    return this.i < this.n ? this.t[this.i] : '';
  }

  eat(ch) {
    if (this.peek() === ch) {
      this.i++;
      return true;
    }
    return false;
  }

  expect(ch) {
    if (!this.eat(ch)) {
      throw new Error(`atteso '${ch}' alla posizione ${this.i} (trovato '${this.t[this.i] || 'EOF'}')`);
    }
  }
}

function parseString(cur) {
  // cur.i punta all'apice iniziale
  cur.i++;
  let out = '';
  while (cur.i < cur.n) {
    const c = cur.t[cur.i];
    if (c === "'") {
      if (cur.t[cur.i + 1] === "'") {
        out += "''";
        cur.i += 2;
        continue;
      }
      cur.i++;
      return { str: decodeStepString(out) };
    }
    out += c;
    cur.i++;
  }
  throw new Error('stringa non terminata');
}

function parseValue(cur) {
  const c = cur.peek();
  if (c === '') throw new Error('fine file inattesa');
  if (c === "'") return parseString(cur);
  if (c === '(') return parseList(cur);
  if (c === '#') {
    cur.i++;
    const m = /^[0-9]+/.exec(cur.t.slice(cur.i, cur.i + 24));
    if (!m) throw new Error('riferimento non valido');
    cur.i += m[0].length;
    return { ref: Number(m[0]) };
  }
  if (c === '$') {
    cur.i++;
    return null;
  }
  if (c === '*') {
    cur.i++;
    return { derived: true };
  }
  if (c === '.') {
    const end = cur.t.indexOf('.', cur.i + 1);
    if (end < 0) throw new Error('enumerazione non terminata');
    const val = cur.t.slice(cur.i + 1, end);
    cur.i = end + 1;
    return { enum: val };
  }
  if (c === '"') {
    const end = cur.t.indexOf('"', cur.i + 1);
    if (end < 0) throw new Error('binario non terminato');
    const val = cur.t.slice(cur.i + 1, end);
    cur.i = end + 1;
    return { bin: val };
  }
  if (c === '-' || c === '+' || c === '.' && /[0-9]/.test(cur.t[cur.i + 1] || '') || (c >= '0' && c <= '9')) {
    // accetta anche "10." "0." "1.E-3" "3.D0" "-.5" (esportatori NX, SolidWorks, CATIA, Creo)
    const m = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[EeDd][-+]?[0-9]+)?/.exec(cur.t.slice(cur.i, cur.i + 64));
    if (!m) throw new Error('numero non valido');
    cur.i += m[0].length;
    let testo = m[0].replace(/[Dd]/, 'e');
    if (/\.(?:e|$)/i.test(testo)) testo = testo.replace('.', '.0');
    return Number(testo);
  }
  const m = RE_NAME.exec(cur.t.slice(cur.i, cur.i + 128));
  if (m && m.index === 0) {
    cur.i += m[0].length;
    const name = m[0].toUpperCase();
    if (cur.peek() === '(') {
      const inner = parseList(cur);
      // NAME(v) con un solo valore -> valore tipizzato
      return { typed: name, value: inner.length === 1 ? inner[0] : inner };
    }
    return { enum: name };
  }
  throw new Error(`token non riconosciuto '${c}' alla posizione ${cur.i}`);
}

function parseList(cur) {
  cur.expect('(');
  const out = [];
  if (cur.eat(')')) return out;
  for (;;) {
    out.push(parseValue(cur));
    if (cur.eat(',')) continue;
    cur.expect(')');
    return out;
  }
}

/** Legge `NAME(params)` (o piu' parti consecutive nei record complessi). */
function parseRecordBody(cur) {
  const parts = [];
  for (;;) {
    cur.skip();
    const m = RE_NAME.exec(cur.t.slice(cur.i, cur.i + 128));
    if (!m || m.index !== 0) break;
    cur.i += m[0].length;
    const type = m[0].toUpperCase();
    const params = parseList(cur);
    parts.push({ type, params });
    cur.skip();
    if (cur.t[cur.i] === ')' || cur.t[cur.i] === ';' || cur.i >= cur.n) break;
  }
  return parts;
}

function parseHeaderSection(cur, file) {
  for (;;) {
    cur.skip();
    if (cur.i >= cur.n) return;
    if (/^ENDSEC\s*;/i.test(cur.t.slice(cur.i, cur.i + 16))) {
      cur.oltre();
      return;
    }
    if (/^DATA\s*[;(]/i.test(cur.t.slice(cur.i, cur.i + 8))) return; // HEADER senza ENDSEC
    const prima = cur.i;
    let parts = [];
    try {
      parts = parseRecordBody(cur);
    } catch (err) {
      file.warnings.push(`intestazione: ${err.message}`);
    }
    cur.skip();
    cur.eat(';');
    for (const p of parts) file.header.push(new StepEntity(null, p.type, p.params, null));
    if (!parts.length || cur.i <= prima) {
      // token imprevisto: salta alla prossima istruzione
      cur.oltre();
      if (cur.i <= prima) cur.i = prima + 1;
    }
  }
}

function indexEntity(file, ent) {
  file.entities.set(ent.id, ent);
  for (const type of ent.types) {
    let list = file.byType.get(type);
    if (!list) file.byType.set(type, (list = []));
    list.push(ent);
  }
}

function indexReferences(file) {
  const walk = (id, v) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(id, x);
      return;
    }
    if (typeof v !== 'object') return;
    if ('ref' in v) {
      let set = file.usedBy.get(v.ref);
      if (!set) file.usedBy.set(v.ref, (set = new Set()));
      set.add(id);
      return;
    }
    if ('typed' in v) walk(id, v.value);
  };
  for (const ent of file.entities.values()) {
    if (ent.complex) for (const p of ent.complex) walk(ent.id, p.params);
    else walk(ent.id, ent.params);
  }
}

/** Vero se il testo inizia come un file ISO 10303-21 (dopo BOM e spazi). */
export function isStepText(text) {
  return /^\uFEFF?\s*ISO-10303-21\s*;/i.test(text.slice(0, 64));
}

/**
 * Lettura a passi: ogni `yield` e' un avanzamento {frazione, etichetta} e il
 * valore di ritorno del generatore e' lo StepFile. Permette a chi chiama di
 * cedere il controllo al browser fra un passo e l'altro.
 */
export function* parseStepSteps(text) {
  const t0 = Date.now();
  const file = new StepFile();
  file.stats.bytes = text.length;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const cur = new Cursor(text);
  cur.skip();
  if (!/^ISO-10303-21\s*;/i.test(text.slice(cur.i, cur.i + 32))) {
    file.warnings.push("Intestazione ISO-10303-21 assente: il file potrebbe non essere STEP.");
  } else {
    cur.oltre();
  }

  let dataSections = 0;
  let nextProgress = 0;
  for (;;) {
    cur.skip();
    if (cur.i >= cur.n) break;

    const ahead = text.slice(cur.i, cur.i + 24);
    const prima = cur.i;
    if (/^HEADER\s*;/i.test(ahead)) {
      cur.oltre();
      parseHeaderSection(cur, file);
      continue;
    }
    if (/^(DATA|ANCHOR|REFERENCE|SIGNATURE)\s*[;(]/i.test(ahead)) {
      // DATA; oppure DATA('nome');
      cur.oltre();
      dataSections++;
      continue;
    }
    if (/^ENDSEC\s*;/i.test(ahead)) {
      cur.oltre();
      continue;
    }
    if (/^END-ISO-10303-21\s*;/i.test(ahead)) {
      cur.oltre();
      continue;
    }

    if (text[cur.i] === '#') {
      const start = cur.i;
      cur.i++;
      const m = /^[0-9]+/.exec(text.slice(cur.i, cur.i + 24));
      if (!m) {
        cur.i = start;
        cur.oltre();
        continue;
      }
      const id = Number(m[0]);
      cur.i += m[0].length;
      cur.skip();
      if (!cur.eat('=')) {
        cur.oltre();
        continue;
      }
      try {
        cur.skip();
        let ent;
        if (text[cur.i] === '(') {
          // record complesso: #1=(A(..)B(..));
          cur.i++;
          const parts = parseRecordBody(cur);
          cur.skip();
          cur.eat(')');
          ent = new StepEntity(id, parts.length ? parts[0].type : 'UNKNOWN', parts.length ? parts[0].params : [], parts);
        } else {
          const parts = parseRecordBody(cur);
          if (!parts.length) throw new Error('record senza tipo');
          ent = parts.length > 1
            ? new StepEntity(id, parts[0].type, parts[0].params, parts)
            : new StepEntity(id, parts[0].type, parts[0].params, null);
        }
        cur.skip();
        cur.eat(';');
        indexEntity(file, ent);
      } catch (err) {
        file.warnings.push(`#${id}: ${err.message}`);
        cur.oltre();
      }

      if (cur.i >= nextProgress) {
        nextProgress = cur.i + Math.max(65536, Math.floor(cur.n / 100));
        yield { frazione: cur.i / cur.n, etichetta: 'lettura entità' };
      }
      continue;
    }

    // qualsiasi altra cosa: avanza fino al prossimo ';'
    cur.oltre();
    if (cur.i <= prima) cur.i = prima + 1; // guardia: mai fermi sullo stesso punto
  }

  if (!dataSections) file.warnings.push('Nessuna sezione DATA trovata.');
  yield { frazione: 0.97, etichetta: 'indici' };
  indexReferences(file);
  file.stats.lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) file.stats.lines++;
  file.stats.parseMs = Date.now() - t0;
  return file;
}

/**
 * Analizza il testo di un file STEP (sincrono).
 * @param {string} text
 * @param {(frac:number, label:string)=>void} [onProgress]
 * @returns {StepFile}
 */
export function parseStep(text, onProgress) {
  const g = parseStepSteps(text);
  for (;;) {
    const r = g.next();
    if (r.done) {
      if (onProgress) onProgress(1, 'lettura completata');
      return r.value;
    }
    if (onProgress) onProgress(r.value.frazione, r.value.etichetta);
  }
}

/** Come parseStep, ma cede il controllo al browser ogni `sliceMs` millisecondi. */
export async function parseStepAsync(text, onProgress, sliceMs = 40) {
  const g = parseStepSteps(text);
  let ultimo = Date.now();
  for (;;) {
    const r = g.next();
    if (r.done) {
      if (onProgress) onProgress(1, 'lettura completata');
      return r.value;
    }
    if (onProgress) onProgress(r.value.frazione, r.value.etichetta);
    if (Date.now() - ultimo > sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      ultimo = Date.now();
    }
  }
}
