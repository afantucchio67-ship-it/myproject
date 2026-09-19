/**
 * Livello semantico: da grafo di entita' STEP a modello leggibile.
 *
 * Estrae intestazione, unita', prodotti, albero di assieme con le
 * trasformazioni, geometria tassellata per ogni solido, colori, proprieta',
 * persone/approvazioni e statistiche. Non dipende dal DOM: lo usano sia il
 * viewer sia la CLI.
 */

import {
  buildCurve,
  dist,
  identity,
  invertRigid,
  multiply,
  readPlacement,
  readPoint,
  transformPoint,
} from './geometry.js';
import {
  MeshBuilder,
  appendAll,
  collectFaces,
  contaBordiAperti,
  meshCentroid,
  meshVolume,
  sampleCurve,
  tessellateFace,
} from './tessellate.js';

const str = (v) => (v && typeof v === 'object' && 'str' in v ? v.str : v == null ? '' : String(v));
const numOf = (v) => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'typed' in v && typeof v.value === 'number') return v.value;
  return null;
};

/* ------------------------------------------------------------ intestazione */

export function readHeader(file) {
  const desc = file.headerEntity('FILE_DESCRIPTION');
  const name = file.headerEntity('FILE_NAME');
  const schema = file.headerEntity('FILE_SCHEMA');
  const list = (v) => (Array.isArray(v) ? v.map(str).filter((s) => s.trim()) : []);
  return {
    descrizione: list(desc?.params?.[0]).join(' / '),
    livelloImplementazione: str(desc?.params?.[1]),
    nomeFile: str(name?.params?.[0]),
    dataFile: str(name?.params?.[1]),
    autore: list(name?.params?.[2]).join(', '),
    organizzazione: list(name?.params?.[3]).join(', '),
    versionePreprocessore: str(name?.params?.[4]),
    sistemaOrigine: str(name?.params?.[5]),
    autorizzazione: str(name?.params?.[6]),
    schema: list(schema?.params?.[0]).join(', '),
  };
}

/* ----------------------------------------------------------------- unita' */

const SI_PREFIX = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
  HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6,
  NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};

/** Risolve una unita' in {nome, tipo, fattoreVersoMm|fattoreVersoRad}. */
function readUnit(file, ent) {
  if (!ent) return null;
  const types = ent.types;
  const kind = types.includes('LENGTH_UNIT')
    ? 'lunghezza'
    : types.includes('PLANE_ANGLE_UNIT')
      ? 'angolo'
      : types.includes('SOLID_ANGLE_UNIT')
        ? 'angolo solido'
        : types.includes('MASS_UNIT')
          ? 'massa'
          : 'altro';

  if (types.includes('CONVERSION_BASED_UNIT')) {
    const p = ent.partParams('CONVERSION_BASED_UNIT');
    const nome = str(p[0]);
    const factorEnt = file.get(p[1]);
    let factor = 1;
    let baseName = '';
    if (factorEnt) {
      const fp = factorEnt.partParams('LENGTH_MEASURE_WITH_UNIT') ||
        factorEnt.partParams('PLANE_ANGLE_MEASURE_WITH_UNIT') ||
        factorEnt.partParams('MEASURE_WITH_UNIT') ||
        factorEnt.params;
      factor = numOf(fp[0]) ?? 1;
      const base = readUnit(file, file.get(fp[1]));
      baseName = base ? base.nome : '';
      if (base && base.fattore) factor *= base.fattore;
    }
    return { nome, tipo: kind, fattore: factor, base: baseName, conversione: true };
  }

  if (types.includes('SI_UNIT')) {
    const p = ent.partParams('SI_UNIT');
    const prefix = p[0] && p[0].enum ? p[0].enum : null;
    const unitName = p[1] && p[1].enum ? p[1].enum : '';
    const mult = prefix ? SI_PREFIX[prefix] ?? 1 : 1;
    const nome = (prefix ? prefix.toLowerCase() : '') + unitName.toLowerCase();
    // fattore verso mm per le lunghezze, verso rad per gli angoli
    let fattore = mult;
    if (kind === 'lunghezza') fattore = mult * 1000; // metro -> mm
    return { nome, tipo: kind, fattore, si: true };
  }

  const p = ent.params;
  return { nome: str(p[0]) || ent.types[0], tipo: kind, fattore: 1 };
}

const SIMBOLI = {
  millimetre: 'mm', millimeter: 'mm', mm: 'mm',
  metre: 'm', meter: 'm', m: 'm',
  centimetre: 'cm', centimeter: 'cm', cm: 'cm',
  micrometre: 'µm', micrometer: 'µm',
  inch: 'in', in: 'in', foot: 'ft', feet: 'ft', mile: 'mi',
};

/** Simbolo breve di un'unita' di lunghezza, per le etichette. */
export function simboloUnita(unita) {
  if (!unita) return 'mm';
  const nome = String(unita.nome || '').toLowerCase();
  return SIMBOLI[nome] || unita.nome || 'mm';
}

/** Unita' e tolleranza del contesto geometrico. */
export function readUnits(file) {
  const contexts = [
    ...file.ofType('GEOMETRIC_REPRESENTATION_CONTEXT'),
    ...file.ofType('GLOBAL_UNIT_ASSIGNED_CONTEXT'),
  ];
  const out = { lunghezza: null, angolo: null, angoloSolido: null, incertezza: null, dimensione: null };
  for (const ctx of contexts) {
    const dim = ctx.partParams('GEOMETRIC_REPRESENTATION_CONTEXT');
    if (dim && out.dimensione == null) out.dimensione = numOf(dim[0]);
    const gua = ctx.partParams('GLOBAL_UNIT_ASSIGNED_CONTEXT');
    if (gua) {
      for (const u of gua[0] || []) {
        const unit = readUnit(file, file.get(u));
        if (!unit) continue;
        if (unit.tipo === 'lunghezza' && !out.lunghezza) out.lunghezza = unit;
        else if (unit.tipo === 'angolo' && !out.angolo) out.angolo = unit;
        else if (unit.tipo === 'angolo solido' && !out.angoloSolido) out.angoloSolido = unit;
      }
    }
    const unc = ctx.partParams('GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT');
    if (unc && !out.incertezza) {
      const u = file.get((unc[0] || [])[0]);
      if (u) {
        const up = u.partParams('UNCERTAINTY_MEASURE_WITH_UNIT') || u.params;
        out.incertezza = { valore: numOf(up[0]), nome: str(up[2]), descrizione: str(up[3]) };
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- prodotti */

function productOf(file, pdEnt) {
  // PRODUCT_DEFINITION -> PRODUCT_DEFINITION_FORMATION -> PRODUCT
  const pdp = pdEnt.partParams('PRODUCT_DEFINITION') || pdEnt.params;
  const formation = file.get(pdp[2]);
  if (!formation) return null;
  const fp = formation.partParams('PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE') ||
    formation.partParams('PRODUCT_DEFINITION_FORMATION') || formation.params;
  const product = file.get(fp[2]);
  return {
    product,
    versione: str(fp[0]),
    sorgente: fp[3] && fp[3].enum ? fp[3].enum.toLowerCase() : '',
  };
}

export function readProducts(file) {
  const out = [];
  for (const p of file.ofType('PRODUCT')) {
    const pp = p.partParams('PRODUCT') || p.params;
    const categorie = file
      .referrers(p.id)
      .filter((e) => e.has('PRODUCT_RELATED_PRODUCT_CATEGORY') || e.has('PRODUCT_CATEGORY'))
      .map((e) => str((e.partParams('PRODUCT_RELATED_PRODUCT_CATEGORY') || e.params)[0]))
      .filter(Boolean);
    const contesti = file.getAll(pp[3]).map((c) => {
      const cp = c.partParams('MECHANICAL_CONTEXT') || c.partParams('PRODUCT_CONTEXT') || c.params;
      return str(cp[2]) || str(cp[0]);
    });
    out.push({
      id: p.id,
      codice: str(pp[0]),
      nome: str(pp[1]),
      descrizione: str(pp[2]),
      categorie: [...new Set(categorie)],
      contesti: [...new Set(contesti.filter(Boolean))],
    });
  }
  return out;
}

/* ----------------------------------------------- rappresentazioni di forma */

/** SHAPE_REPRESENTATION collegate a una PRODUCT_DEFINITION. */
function shapeRepsOf(file, pdEnt) {
  const reps = [];
  for (const pds of file.referrers(pdEnt.id)) {
    if (!pds.has('PRODUCT_DEFINITION_SHAPE')) continue;
    for (const sdr of file.referrers(pds.id)) {
      if (!sdr.has('SHAPE_DEFINITION_REPRESENTATION') && !sdr.has('PROPERTY_DEFINITION_REPRESENTATION')) continue;
      const p = sdr.partParams('SHAPE_DEFINITION_REPRESENTATION') ||
        sdr.partParams('PROPERTY_DEFINITION_REPRESENTATION') || sdr.params;
      const rep = file.get(p[1]);
      if (rep) reps.push(rep);
    }
  }
  return reps;
}

/** Segue SHAPE_REPRESENTATION_RELATIONSHIP per raggiungere la geometria. */
function relatedReps(file, rep, seen = new Set()) {
  if (!rep || seen.has(rep.id)) return [];
  seen.add(rep.id);
  const out = [rep];
  for (const rel of file.referrers(rep.id)) {
    if (!rel.has('REPRESENTATION_RELATIONSHIP') && !rel.has('SHAPE_REPRESENTATION_RELATIONSHIP')) continue;
    const p = rel.partParams('REPRESENTATION_RELATIONSHIP') || rel.params;
    const rep1 = file.get(p[2]);
    const rep2 = file.get(p[3]);
    // relazione senza trasformazione: stessa collocazione, segui l'altro lato
    const hasTransform = rel.has('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION');
    if (hasTransform) continue;
    for (const other of [rep1, rep2]) {
      if (other && other.id !== rep.id) out.push(...relatedReps(file, other, seen));
    }
  }
  return out;
}

/** Elementi geometrici (solidi, shell, facce, insiemi di curve) di una rappresentazione. */
function repItems(file, rep) {
  const p = rep.partParams('SHAPE_REPRESENTATION') ||
    rep.partParams('ADVANCED_BREP_SHAPE_REPRESENTATION') ||
    rep.partParams('MANIFOLD_SURFACE_SHAPE_REPRESENTATION') ||
    rep.partParams('GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION') ||
    rep.partParams('REPRESENTATION') || rep.params;
  return file.getAll(p[1]);
}

const SOLID_LIKE = [
  'MANIFOLD_SOLID_BREP',
  'BREP_WITH_VOIDS',
  'SHELL_BASED_SURFACE_MODEL',
  'FACE_BASED_SURFACE_MODEL',
  'CLOSED_SHELL',
  'OPEN_SHELL',
  'ADVANCED_FACE',
  'FACE_SURFACE',
];

/* -------------------------------------------------------- albero assieme */

/** Matrice di una ITEM_DEFINED_TRANSFORMATION (da figlio a padre). */
function transformMatrix(file, idtEnt) {
  if (!idtEnt) return identity();
  const p = idtEnt.partParams('ITEM_DEFINED_TRANSFORMATION') || idtEnt.params;
  const parent = readPlacement(file, p[2]);
  const child = readPlacement(file, p[3]);
  // porta le coordinate del figlio nel sistema del padre
  return multiply(parent, invertRigid(child));
}

/** Trasformazione associata a una occorrenza (NEXT_ASSEMBLY_USAGE_OCCURRENCE). */
function occurrenceTransform(file, nauoEnt) {
  for (const pds of file.referrers(nauoEnt.id)) {
    if (!pds.has('PRODUCT_DEFINITION_SHAPE') && !pds.has('PROPERTY_DEFINITION')) continue;
    for (const cdsr of file.referrers(pds.id)) {
      if (!cdsr.has('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) continue;
      const p = cdsr.partParams('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') || cdsr.params;
      const rel = file.get(p[1]);
      if (!rel) continue;
      const rp = rel.partParams('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION');
      if (rp) {
        const trRef = Array.isArray(rp[0]) ? rp[0][0] : rp[0];
        const idt = file.get(trRef);
        if (idt) return transformMatrix(file, idt);
      }
    }
  }
  return identity();
}

/**
 * Costruisce l'albero di assieme.
 * Ogni nodo: { nome, prodotto, definizione, matrice, figli[], items[] }
 */
export function readAssembly(file) {
  const occurrences = [
    ...file.ofType('NEXT_ASSEMBLY_USAGE_OCCURRENCE'),
    ...file.ofType('ASSEMBLY_COMPONENT_USAGE'),
  ];
  const childIds = new Set();
  const byParent = new Map();
  for (const occ of occurrences) {
    const p = occ.partParams('NEXT_ASSEMBLY_USAGE_OCCURRENCE') ||
      occ.partParams('ASSEMBLY_COMPONENT_USAGE') || occ.params;
    const parent = file.get(p[3]);
    const child = file.get(p[4]);
    if (!parent || !child) continue;
    childIds.add(child.id);
    if (!byParent.has(parent.id)) byParent.set(parent.id, []);
    byParent.get(parent.id).push({
      occ,
      child,
      nome: str(p[0]) || str(p[1]),
      matrice: occurrenceTransform(file, occ),
    });
  }

  const pds = file.ofType('PRODUCT_DEFINITION');
  const roots = pds.filter((pd) => !childIds.has(pd.id));

  const build = (pdEnt, nome, matrice, depth, path, seen) => {
    const prod = productOf(file, pdEnt);
    const nomeProdotto = prod?.product
      ? str((prod.product.partParams('PRODUCT') || prod.product.params)[1]) ||
        str((prod.product.partParams('PRODUCT') || prod.product.params)[0])
      : '';
    const node = {
      id: pdEnt.id,
      nome: nome || nomeProdotto || `#${pdEnt.id}`,
      prodotto: nomeProdotto,
      versione: prod?.versione || '',
      matrice,
      percorso: [...path, nome || nomeProdotto || `#${pdEnt.id}`],
      figli: [],
      items: [],
    };
    // geometria propria
    for (const rep of shapeRepsOf(file, pdEnt)) {
      for (const r of relatedReps(file, rep)) {
        for (const item of repItems(file, r)) {
          if (SOLID_LIKE.some((t) => item.has(t)) || item.has('GEOMETRIC_CURVE_SET') || item.has('GEOMETRIC_SET')) {
            node.items.push({ item, rappresentazione: r.id, nomeRappresentazione: str((r.params || [])[0]) });
          }
        }
      }
    }
    if (depth < 32) {
      for (const link of byParent.get(pdEnt.id) || []) {
        if (seen.has(link.child.id)) continue;
        const childSeen = new Set(seen);
        childSeen.add(link.child.id);
        node.figli.push(
          build(link.child, link.nome, multiply(matrice, link.matrice), depth + 1, node.percorso, childSeen),
        );
      }
    }
    return node;
  };

  return roots.map((r) => build(r, '', identity(), 0, [], new Set([r.id])));
}

/* ------------------------------------------------------------- presentazione */

const PREDEFINED_COLORS = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], yellow: [1, 1, 0],
  magenta: [1, 0, 1], cyan: [0, 1, 1], black: [0, 0, 0], white: [1, 1, 1],
};

/** Colori per elemento geometrico, da STYLED_ITEM / COLOUR_RGB. */
export function readColors(file) {
  const map = new Map();
  const findColor = (ent, depth = 0) => {
    if (!ent || depth > 8) return null;
    if (ent.has('COLOUR_RGB')) {
      const p = ent.partParams('COLOUR_RGB') || ent.params;
      return [Number(p[1]) || 0, Number(p[2]) || 0, Number(p[3]) || 0];
    }
    if (ent.has('DRAUGHTING_PRE_DEFINED_COLOUR')) {
      const nome = str((ent.partParams('DRAUGHTING_PRE_DEFINED_COLOUR') || ent.params)[0]).toLowerCase();
      return PREDEFINED_COLORS[nome] || null;
    }
    const walk = (v) => {
      if (v == null) return null;
      if (Array.isArray(v)) {
        for (const x of v) {
          const c = walk(x);
          if (c) return c;
        }
        return null;
      }
      if (typeof v === 'object' && 'ref' in v) return findColor(file.get(v), depth + 1);
      if (typeof v === 'object' && 'typed' in v) return walk(v.value);
      return null;
    };
    const parts = ent.complex ? ent.complex.map((p) => p.params) : [ent.params];
    for (const params of parts) {
      const c = walk(params);
      if (c) return c;
    }
    return null;
  };

  for (const si of file.ofType('STYLED_ITEM')) {
    const p = si.partParams('STYLED_ITEM') || si.params;
    const item = file.get(p[2]);
    if (!item) continue;
    const colore = findColor(si);
    if (colore) map.set(item.id, colore);
  }
  return map;
}

/** Livelli di presentazione (PRESENTATION_LAYER_ASSIGNMENT). */
export function readLayers(file) {
  const out = [];
  for (const l of file.ofType('PRESENTATION_LAYER_ASSIGNMENT')) {
    const p = l.partParams('PRESENTATION_LAYER_ASSIGNMENT') || l.params;
    out.push({
      nome: str(p[0]),
      descrizione: str(p[1]),
      elementi: (p[2] || []).map((r) => (r && r.ref) || null).filter(Boolean),
    });
  }
  return out;
}

/* --------------------------------------------- persone, date, approvazioni */

function readPersonOrg(file, ent) {
  if (!ent) return null;
  const p = ent.partParams('PERSON_AND_ORGANIZATION') || ent.params;
  const person = file.get(p[0]);
  const org = file.get(p[1]);
  const pp = person ? person.partParams('PERSON') || person.params : [];
  const op = org ? org.partParams('ORGANIZATION') || org.params : [];
  const nome = [str(pp[2]), str(pp[1])].filter(Boolean).join(' ').trim();
  return {
    persona: nome || str(pp[1]) || str(pp[0]) || '',
    organizzazione: str(op[1]) || str(op[0]) || '',
    descrizioneOrg: str(op[2]) || '',
  };
}

function readDateTime(file, ent) {
  if (!ent) return '';
  if (ent.has('DATE_AND_TIME')) {
    const p = ent.partParams('DATE_AND_TIME') || ent.params;
    const d = file.get(p[0]);
    const t = file.get(p[1]);
    const dp = d ? d.partParams('CALENDAR_DATE') || d.params : [];
    const tp = t ? t.partParams('LOCAL_TIME') || t.params : [];
    const pad = (n) => String(Math.round(Number(n) || 0)).padStart(2, '0');
    // CALENDAR_DATE eredita year_component da `date`: ordine (anno, giorno, mese)
    if (dp.length >= 3) {
      const data = `${dp[0]}-${pad(dp[2])}-${pad(dp[1])}`;
      const ora = tp.length ? ` ${pad(tp[0])}:${pad(tp[1])}:${pad(tp[2] || 0)}` : '';
      return data + ora;
    }
  }
  if (ent.has('CALENDAR_DATE')) {
    const p = ent.partParams('CALENDAR_DATE') || ent.params;
    const pad = (n) => String(Math.round(Number(n) || 0)).padStart(2, '0');
    return `${p[0]}-${pad(p[2])}-${pad(p[1])}`;
  }
  return '';
}

export function readOrganizational(file) {
  const persone = [];
  for (const a of file.ofType('PERSON_AND_ORGANIZATION')) {
    const info = readPersonOrg(file, a);
    if (!info) continue;
    const ruoli = new Set();
    for (const ass of file.referrers(a.id)) {
      const p = ass.params;
      const role = file.get(p[1]);
      if (role && (role.has('PERSON_AND_ORGANIZATION_ROLE') || role.has('APPROVAL_ROLE'))) {
        ruoli.add(str((role.partParams('PERSON_AND_ORGANIZATION_ROLE') || role.params)[0]));
      }
    }
    persone.push({ ...info, ruoli: [...ruoli].filter(Boolean) });
  }

  const approvazioni = file.ofType('APPROVAL').map((a) => {
    const p = a.partParams('APPROVAL') || a.params;
    const status = file.get(p[0]);
    const dt = file
      .referrers(a.id)
      .find((e) => e.has('APPROVAL_DATE_TIME'));
    return {
      stato: status ? str((status.partParams('APPROVAL_STATUS') || status.params)[0]) : '',
      livello: str(p[1]),
      data: dt ? readDateTime(file, file.get((dt.partParams('APPROVAL_DATE_TIME') || dt.params)[0])) : '',
    };
  });

  const date = [];
  for (const a of file.ofType('DATE_AND_TIME')) {
    const usi = file.referrers(a.id).filter((e) => e.types.some((t) => t.includes('DATE_AND_TIME_ASSIGNMENT')));
    const ruoli = new Set();
    for (const u of usi) {
      const role = file.get((u.params || [])[1]);
      if (role) ruoli.add(str((role.partParams('DATE_TIME_ROLE') || role.params)[0]));
    }
    date.push({ valore: readDateTime(file, a), ruoli: [...ruoli].filter(Boolean) });
  }

  const sicurezza = file.ofType('SECURITY_CLASSIFICATION').map((s) => {
    const p = s.partParams('SECURITY_CLASSIFICATION') || s.params;
    const lvl = file.get(p[2]);
    return {
      nome: str(p[0]),
      scopo: str(p[1]),
      livello: lvl ? str((lvl.partParams('SECURITY_CLASSIFICATION_LEVEL') || lvl.params)[0]) : '',
    };
  });

  // i file esportati ripetono spesso le stesse righe per ogni prodotto:
  // raggruppa gli identici indicando quante volte compaiono
  const raggruppa = (righe) => {
    const map = new Map();
    for (const r of righe) {
      const chiave = JSON.stringify(r);
      const found = map.get(chiave);
      if (found) found.occorrenze++;
      else map.set(chiave, { ...r, occorrenze: 1 });
    }
    return [...map.values()];
  };

  return {
    persone: raggruppa(persone),
    approvazioni: raggruppa(approvazioni),
    date: raggruppa(date),
    sicurezza: raggruppa(sicurezza),
  };
}

/* ------------------------------------------------------------- proprieta' */

export function readProperties(file) {
  const out = [];
  const consumati = new Set(); // elementi già usati come valore di una proprietà

  // PROPERTY_DEFINITION -> PROPERTY_DEFINITION_REPRESENTATION -> valore
  for (const pd of file.ofType('PROPERTY_DEFINITION')) {
    const p = pd.partParams('PROPERTY_DEFINITION') || pd.params;
    const nome = str(p[0]);
    let valore = str(p[1]);
    for (const pdr of file.referrers(pd.id)) {
      if (!pdr.has('PROPERTY_DEFINITION_REPRESENTATION')) continue;
      const rep = file.get((pdr.partParams('PROPERTY_DEFINITION_REPRESENTATION') || pdr.params)[1]);
      if (!rep) continue;
      for (const item of repItems(file, rep)) {
        consumati.add(item.id);
        const ip = item.params;
        const v = numOf(ip[1]);
        const testo = v != null ? String(v) : str(ip[1]);
        if (testo) valore = testo;
      }
    }
    if (nome || valore) out.push({ nome: nome || `#${pd.id}`, valore, fonte: `#${pd.id}` });
  }

  // proprietà generali (spesso solo il nome, con il valore altrove)
  for (const g of file.ofType('GENERAL_PROPERTY')) {
    const p = g.partParams('GENERAL_PROPERTY') || g.params;
    const nome = str(p[1]) || str(p[0]);
    const valore = str(p[2]);
    if (!nome) continue;
    const esistente = out.find((r) => r.nome === nome);
    if (esistente) {
      if (!esistente.valore && valore) esistente.valore = valore;
      continue;
    }
    out.push({ nome, valore, fonte: `#${g.id}` });
  }

  // testo libero non già associato a una proprietà
  for (const d of file.ofType('DESCRIPTIVE_REPRESENTATION_ITEM')) {
    if (consumati.has(d.id)) continue;
    const p = d.partParams('DESCRIPTIVE_REPRESENTATION_ITEM') || d.params;
    let nome = str(p[0]);
    if (!nome) {
      const rep = file.referrers(d.id).find((e) => e.has('REPRESENTATION'));
      if (rep) nome = str((rep.partParams('REPRESENTATION') || rep.params)[0]);
    }
    out.push({ nome: nome || 'descrizione', valore: str(p[1]), fonte: `#${d.id}` });
  }

  return out;
}

/* ------------------------------------------------------- geometria: solidi */

function bboxOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Punti [x,y,z][] -> Float32Array piatta (x0,y0,z0,x1,...), trasferibile al worker. */
function flatPoints(pts) {
  const out = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    out[i * 3] = pts[i][0];
    out[i * 3 + 1] = pts[i][1];
    out[i * 3 + 2] = pts[i][2];
  }
  return out;
}

/** Spigoli unici delle facce, campionati per il disegno del wireframe. */
function collectEdgePolylines(file, faces, tol) {
  const seen = new Set();
  const out = [];
  for (const face of faces) {
    const fp = face.partParams('ADVANCED_FACE') || face.partParams('FACE_SURFACE') || face.params;
    for (const bref of fp[1] || []) {
      const bound = file.get(bref);
      if (!bound) continue;
      const loop = file.get((bound.partParams('FACE_OUTER_BOUND') || bound.partParams('FACE_BOUND') || bound.params)[1]);
      if (!loop) continue;
      const lp = loop.partParams('EDGE_LOOP') || loop.params;
      for (const oref of lp[1] || []) {
        const oe = file.get(oref);
        if (!oe) continue;
        const edge = file.get((oe.partParams('ORIENTED_EDGE') || oe.params)[3]);
        if (!edge || seen.has(edge.id)) continue;
        seen.add(edge.id);
        const ep = edge.partParams('EDGE_CURVE') || edge.params;
        const curve = buildCurve(file, ep[3]);
        if (!curve) continue;
        const vp = (v) => {
          const ent = file.get(v);
          return ent ? readPoint(file, (ent.partParams('VERTEX_POINT') || ent.params)[1]) : null;
        };
        const ps = vp(ep[1]);
        const pe = vp(ep[2]);
        let t0 = curve.domain[0];
        let t1 = curve.domain[1];
        const closed = ps && pe ? dist(ps, pe) < 1e-9 : false;
        if (!closed && ps && pe && curve.invert) {
          t0 = curve.invert(ps);
          t1 = curve.invert(pe);
          if (curve.periodic && t1 <= t0) t1 += curve.periodic;
          else if (!curve.periodic && t1 < t0) [t0, t1] = [t1, t0];
        } else if (closed && curve.periodic) {
          t0 = ps && curve.invert ? curve.invert(ps) : curve.domain[0];
          t1 = t0 + curve.periodic;
        }
        const pts = sampleCurve(curve, t0, t1, tol).map((t) => curve.eval(t));
        if (pts.length >= 2) out.push({ id: edge.id, tipo: curve.type, punti: flatPoints(pts) });
      }
    }
  }
  return out;
}

/** Curve di un GEOMETRIC_CURVE_SET (file wireframe). */
function collectSetCurves(file, itemEnt, tol) {
  const p = itemEnt.partParams('GEOMETRIC_CURVE_SET') || itemEnt.partParams('GEOMETRIC_SET') || itemEnt.params;
  const out = [];
  for (const ref of p[1] || []) {
    const curve = buildCurve(file, ref);
    if (!curve) continue;
    const pts = sampleCurve(curve, curve.domain[0], curve.domain[1], tol).map((t) => curve.eval(t));
    if (pts.length >= 2) out.push({ id: (ref && ref.ref) || 0, tipo: curve.type, punti: flatPoints(pts) });
  }
  return out;
}

/**
 * Tassella un elemento geometrico, restituendo mesh, spigoli e misure.
 */
/**
 * Geometria di una parte, a passi: ogni `yield` corrisponde a una faccia
 * tassellata (cosi' l'interfaccia puo' aggiornare l'avanzamento senza worker).
 * Il valore di ritorno del generatore e' il risultato di buildPartGeometry.
 */
export function* partGeometrySteps(file, itemEnt, opts = {}) {
  const tol = opts.tolerance ?? 0.1;
  const maxDepth = opts.maxDepth ?? 3;
  const diagnostics = [];
  const faces = collectFaces(file, itemEnt);

  // Prima passata: ogni faccia nella propria mesh, per poter uniformare dopo
  // il livello di suddivisione (necessario per una mesh a tenuta: le facce
  // adiacenti devono suddividere lo spigolo comune allo stesso modo).
  const perFaccia = [];
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const mesh = new MeshBuilder();
    const r = tessellateFace(file, face, mesh, { tolerance: tol, maxDepth });
    perFaccia.push({ face, mesh, r });
    yield { fatte: i + 1, totali: faces.length * 2 };
  }
  const livelloMax = perFaccia.reduce((m, x) => Math.max(m, x.r.livello || 0), 0);
  for (let i = 0; i < perFaccia.length; i++) {
    const voce = perFaccia[i];
    if ((voce.r.livello || 0) < livelloMax) {
      const mesh = new MeshBuilder();
      const r = tessellateFace(file, voce.face, mesh, {
        tolerance: tol,
        maxDepth,
        livelloForzato: livelloMax,
      });
      voce.mesh = mesh;
      voce.r = r;
      yield { fatte: faces.length + i + 1, totali: faces.length * 2 };
    }
  }

  // unisce le mesh delle facce (senza spread: le facce grandi superano il
  // limite di argomenti di V8)
  const finale = new MeshBuilder();
  const facce = [];
  let area = 0;
  for (const { face, mesh, r } of perFaccia) {
    const offset = finale.positions.length / 3;
    appendAll(finale.positions, mesh.positions);
    appendAll(finale.normals, mesh.normals);
    for (let i = 0; i < mesh.indices.length; i++) finale.indices.push(mesh.indices[i] + offset);
    appendAll(finale.faceIds, mesh.faceIds);
    area += r.area;
    facce.push({
      id: face.id,
      tipoSuperficie: r.surfaceType,
      infoSuperficie: r.surfaceInfo || null,
      triangoli: r.triangles,
      area: r.area,
    });
    if (r.problems.length) appendAll(diagnostics, r.problems);
  }

  const positions = new Float32Array(finale.positions);
  const normals = new Float32Array(finale.normals);
  const indices = new Uint32Array(finale.indices);

  const chiusa = itemEnt.has('MANIFOLD_SOLID_BREP') || itemEnt.has('CLOSED_SHELL') || itemEnt.has('BREP_WITH_VOIDS');
  const tenuta = contaBordiAperti(finale.positions, finale.indices, Math.max(tol * 0.05, 1e-5));

  let volume = meshVolume(finale.positions, finale.indices);
  let invertito = false;
  if (volume < 0 && faces.length) {
    // guscio orientato verso l'interno: raddrizza per avere normali uscenti
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
    for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
    volume = -volume;
    invertito = true;
    diagnostics.push(`#${itemEnt.id}: guscio orientato verso l'interno nel file, orientamento corretto`);
  }

  const bbox = bboxOf(finale.positions);
  const volumeBbox = bbox.size[0] * bbox.size[1] * bbox.size[2];
  const frazioneAperta = tenuta.totali ? tenuta.aperti / tenuta.totali : 1;
  const plausibile = volume > 0 && (volumeBbox <= 0 || volume <= volumeBbox * 1.02);
  // mesh a tenuta -> valore esatto entro la tolleranza; qualche bordo aperto
  // -> valore approssimato; mesh molto aperta o valore implausibile -> niente
  const volumeAffidabile = chiusa && plausibile && frazioneAperta < 0.05;
  const volumeEsatto = chiusa && plausibile && tenuta.aperti === 0;
  if (chiusa && !volumeEsatto) {
    diagnostics.push(
      `#${itemEnt.id}: mesh con ${tenuta.aperti} bordi aperti su ${tenuta.totali}` +
        (volumeAffidabile ? ': volume approssimato' : ': volume non calcolabile in modo attendibile'),
    );
  }

  const spigoli = faces.length
    ? collectEdgePolylines(file, faces, tol)
    : collectSetCurves(file, itemEnt, tol);

  return {
    id: itemEnt.id,
    tipo: itemEnt.types[0],
    tipi: itemEnt.types,
    mesh: { positions, normals, indices, faceIds: new Uint32Array(finale.faceIds) },
    spigoli,
    facce,
    area,
    volume,
    volumeAffidabile,
    volumeEsatto,
    bordiAperti: tenuta.aperti,
    bordiTotali: tenuta.totali,
    orientamentoInvertito: invertito,
    centroide: meshCentroid(finale.positions, finale.indices),
    bbox,
    chiusa,
    diagnostics,
  };
}

/** Versione sincrona di partGeometrySteps. */
export function buildPartGeometry(file, itemEnt, opts = {}) {
  const g = partGeometrySteps(file, itemEnt, opts);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/* ------------------------------------------------------------ statistiche */

export function geometrySummary(file) {
  const count = (t) => file.ofType(t).length;
  return {
    solidi: count('MANIFOLD_SOLID_BREP') + count('BREP_WITH_VOIDS'),
    gusciChiusi: count('CLOSED_SHELL'),
    gusciAperti: count('OPEN_SHELL'),
    facce: count('ADVANCED_FACE') + count('FACE_SURFACE'),
    spigoli: count('EDGE_CURVE'),
    vertici: count('VERTEX_POINT'),
    punti: count('CARTESIAN_POINT'),
    superficiBspline: count('B_SPLINE_SURFACE_WITH_KNOTS') + count('B_SPLINE_SURFACE'),
    curveBspline: count('B_SPLINE_CURVE_WITH_KNOTS') + count('B_SPLINE_CURVE'),
    piani: count('PLANE'),
    cilindri: count('CYLINDRICAL_SURFACE'),
    coni: count('CONICAL_SURFACE'),
    sfere: count('SPHERICAL_SURFACE'),
    tori: count('TOROIDAL_SURFACE'),
    superficiOffset: count('OFFSET_SURFACE'),
    cerchi: count('CIRCLE'),
    linee: count('LINE'),
  };
}

/**
 * Costruisce il modello completo, a passi: ogni `yield` e' un avanzamento
 * {frazione, etichetta}; il valore di ritorno e' il modello.
 */
export function* buildModelSteps(file, opts = {}) {
  const units = readUnits(file);
  const scaleToMm = units.lunghezza?.fattore && Number.isFinite(units.lunghezza.fattore)
    ? units.lunghezza.fattore
    : 1;
  units.simbolo = simboloUnita(units.lunghezza);
  units.fattoreVersoMm = scaleToMm;

  yield { frazione: 0.05, etichetta: 'struttura del prodotto' };
  const assemblyRoots = readAssembly(file);
  const colors = readColors(file);

  // istanze geometriche: percorre l'albero applicando le trasformazioni
  const istanze = [];
  const visit = (node) => {
    for (const it of node.items) {
      istanze.push({
        nodo: node.nome,
        percorso: node.percorso.join(' / '),
        prodotto: node.prodotto,
        matrice: node.matrice,
        item: it.item,
        rappresentazione: it.rappresentazione,
      });
    }
    node.figli.forEach(visit);
  };
  assemblyRoots.forEach(visit);

  // elementi geometrici non raggiunti dall'albero (file senza assieme)
  const usati = new Set(istanze.map((i) => i.item.id));
  if (!istanze.length) {
    for (const t of ['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'SHELL_BASED_SURFACE_MODEL', 'FACE_BASED_SURFACE_MODEL']) {
      for (const item of file.ofType(t)) {
        if (usati.has(item.id)) continue;
        usati.add(item.id);
        istanze.push({ nodo: `#${item.id}`, percorso: `#${item.id}`, prodotto: '', matrice: identity(), item });
      }
    }
    if (!istanze.length) {
      for (const item of file.ofType('GEOMETRIC_CURVE_SET')) {
        istanze.push({ nodo: `#${item.id}`, percorso: `#${item.id}`, prodotto: '', matrice: identity(), item });
      }
    }
  }

  // la tolleranza e' espressa in millimetri: portala nelle unita' del file
  const tol = (opts.tolerance ?? 0.1) / (scaleToMm || 1);
  const parti = [];
  const diagnostics = [...file.warnings];
  for (let i = 0; i < istanze.length; i++) {
    const inst = istanze[i];
    const quota = 0.85 / Math.max(1, istanze.length);
    const etichetta = istanze.length > 1 ? `tassellazione parte ${i + 1} di ${istanze.length}` : 'tassellazione';
    yield { frazione: 0.1 + quota * i, etichetta };
    const passi = partGeometrySteps(file, inst.item, { tolerance: tol, maxDepth: opts.maxDepth });
    let geo;
    for (;;) {
      const r = passi.next();
      if (r.done) {
        geo = r.value;
        break;
      }
      yield { frazione: 0.1 + quota * (i + r.value.fatte / Math.max(1, r.value.totali)), etichetta };
    }
    appendAll(diagnostics, geo.diagnostics);
    parti.push({
      ...geo,
      nome: inst.nodo,
      percorso: inst.percorso,
      prodotto: inst.prodotto,
      matrice: inst.matrice,
      colore: colors.get(inst.item.id) || null,
    });
  }

  // bounding box globale (con le trasformazioni applicate)
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parti) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const w = transformPoint(part.matrice, [p[i], p[i + 1], p[i + 2]]);
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
  }
  const bbox = Number.isFinite(min[0])
    ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
    : { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };

  yield { frazione: 0.98, etichetta: 'riepilogo' };
  const model = {
    header: readHeader(file),
    units,
    prodotti: readProducts(file),
    assieme: assemblyRoots,
    parti,
    bbox,
    layer: readLayers(file),
    organizzazione: readOrganizational(file),
    proprieta: readProperties(file),
    geometria: geometrySummary(file),
    statistiche: {
      entita: file.entities.size,
      tipi: file.byType.size,
      byte: file.stats.bytes,
      righe: file.stats.lines,
      msLettura: file.stats.parseMs,
      triangoli: parti.reduce((a, p) => a + p.mesh.indices.length / 3, 0),
      vertici: parti.reduce((a, p) => a + p.mesh.positions.length / 3, 0),
      areaTotale: parti.reduce((a, p) => a + p.area, 0),
      volumeTotale: parti.reduce((a, p) => a + (p.volumeAffidabile ? p.volume : 0), 0),
    },
    conteggiTipi: file.typeCounts(),
    diagnostics,
  };
  return model;
}

/**
 * Costruisce il modello completo (sincrono).
 * @param {import('./parser.js').StepFile} file
 * @param {{tolerance?:number, onProgress?:(f:number,l:string)=>void, maxDepth?:number}} opts
 */
export function buildModel(file, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const g = buildModelSteps(file, opts);
  for (;;) {
    const r = g.next();
    if (r.done) {
      onProgress(1, 'pronto');
      return r.value;
    }
    onProgress(r.value.frazione, r.value.etichetta);
  }
}

/**
 * Come buildModel, ma cede il controllo al browser a intervalli regolari:
 * l'interfaccia resta reattiva anche senza web worker (versione a file unico).
 */
export async function buildModelAsync(file, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const fetta = opts.sliceMs ?? 40;
  const g = buildModelSteps(file, opts);
  let ultimo = Date.now();
  for (;;) {
    const r = g.next();
    if (r.done) {
      onProgress(1, 'pronto');
      return r.value;
    }
    onProgress(r.value.frazione, r.value.etichetta);
    if (Date.now() - ultimo > fetta) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      ultimo = Date.now();
    }
  }
}
