/**
 * Generatori di STEP sintetici (stesso stile di test/fixtures.mjs) per i casi
 * geometrici non ancora coperti dai test. Ogni generatore restituisce
 * { testo, atteso } dove `atteso` contiene i valori analitici.
 */

const DEG = Math.PI / 180;

export class W {
  constructor() { this.righe = []; this.n = 0; }
  add(t) { this.n += 1; this.righe.push(`#${this.n}=${t};`); return `#${this.n}`; }
  punto(p) { return this.add(`CARTESIAN_POINT('',(${p.map((x) => x.toFixed(9)).join(',')}))`); }
  direzione(d) { return this.add(`DIRECTION('',(${d.map((x) => x.toFixed(9)).join(',')}))`); }
  placement(o, z, x) { return this.add(`AXIS2_PLACEMENT_3D('',${this.punto(o)},${this.direzione(z)},${this.direzione(x)})`); }
  vertice(p) { return this.add(`VERTEX_POINT('',${this.punto(p)})`); }
  cerchio(centro, asse, x, r) { return this.add(`CIRCLE('',${this.placement(centro, asse, x)},${r.toFixed(9)})`); }
  ellisse(centro, asse, x, a, b) { return this.add(`ELLIPSE('',${this.placement(centro, asse, x)},${a.toFixed(9)},${b.toFixed(9)})`); }
  linea(a, b, magnitudoUno = false) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d);
    const vet = this.add(`VECTOR('',${this.direzione(d.map((x) => x / l))},${(magnitudoUno ? 1 : l).toFixed(9)})`);
    return this.add(`LINE('',${this.punto(a)},${vet})`);
  }
  edge(v1, v2, curva, sense = true) { return this.add(`EDGE_CURVE('',${v1},${v2},${curva},${sense ? '.T.' : '.F.'})`); }
  oe(edge, orient = true) { return this.add(`ORIENTED_EDGE('',*,*,${edge},${orient ? '.T.' : '.F.'})`); }
  loop(oes) { return this.add(`EDGE_LOOP('',(${oes.join(',')}))`); }
  outer(loop) { return this.add(`FACE_OUTER_BOUND('',${loop},.T.)`); }
  bound(loop) { return this.add(`FACE_BOUND('',${loop},.T.)`); }
  piano(o, z, x) { return this.add(`PLANE('',${this.placement(o, z, x)})`); }
  faccia(bounds, superficie, sameSense = true) {
    return this.add(`ADVANCED_FACE('',(${bounds.join(',')}),${superficie},${sameSense ? '.T.' : '.F.'})`);
  }

  contesto(unita = 'mm', angolo = 'rad') {
    let mm = this.add('(NAMED_UNIT(*)LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.))');
    if (unita === 'inch') {
      const misura = this.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
      const dim = this.add('DIMENSIONAL_EXPONENTS(1.0,0.0,0.0,0.0,0.0,0.0,0.0)');
      mm = this.add(`(CONVERSION_BASED_UNIT('INCH',${misura})LENGTH_UNIT()NAMED_UNIT(${dim}))`);
    }
    let rad = this.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    if (angolo === 'degree') {
      const misura = this.add(`PLANE_ANGLE_MEASURE_WITH_UNIT(PLANE_ANGLE_MEASURE(0.017453292519943295),${rad})`);
      const dim = this.add('DIMENSIONAL_EXPONENTS(0.0,0.0,0.0,0.0,0.0,0.0,0.0)');
      rad = this.add(`(CONVERSION_BASED_UNIT('DEGREE',${misura})NAMED_UNIT(${dim})PLANE_ANGLE_UNIT())`);
    }
    const sr = this.add('(NAMED_UNIT(*)SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.))');
    const unc = this.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-5),${mm},'chiusura','')`);
    return this.add(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))` +
        `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('prova','test'))`,
    );
  }

  /** Prodotto + rappresentazione; `items` e' la lista degli elementi geometrici. */
  prodotto(nome, items, contesto, tipoRep = 'ADVANCED_BREP_SHAPE_REPRESENTATION') {
    const appCtx = this.add(`APPLICATION_CONTEXT('automotive design')`);
    const mechCtx = this.add(`MECHANICAL_CONTEXT('',${appCtx},'mechanical')`);
    const designCtx = this.add(`DESIGN_CONTEXT('',${appCtx},'design')`);
    const prod = this.add(`PRODUCT('${nome}','${nome}','pezzo di prova',(${mechCtx}))`);
    const form = this.add(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('A','NONE',${prod},.MADE.)`);
    const pd = this.add(`PRODUCT_DEFINITION('progetto','',${form},${designCtx})`);
    const pds = this.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    const rep = this.add(`${tipoRep}('${nome}',(${items.join(',')}),${contesto})`);
    this.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    this.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${prod}))`);
    return { rep, pd, prod };
  }

  testo(nomeFile) {
    return [
      'ISO-10303-21;', 'HEADER;',
      "FILE_DESCRIPTION(('modello di prova'),'2;1');",
      `FILE_NAME('${nomeFile}','2026-01-01T00:00:00',('test'),('nessuna'),'generatore di prova','','');`,
      "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
      'ENDSEC;', 'DATA;', ...this.righe, 'ENDSEC;', 'END-ISO-10303-21;', '',
    ].join('\n');
  }
}

/* ------------------------------------------------------------ cubo generico */

const CUBO_FACCE = [
  { idx: [0, 3, 2, 1], normale: [0, 0, -1], asseX: [1, 0, 0] },
  { idx: [4, 5, 6, 7], normale: [0, 0, 1], asseX: [1, 0, 0] },
  { idx: [0, 1, 5, 4], normale: [0, -1, 0], asseX: [1, 0, 0] },
  { idx: [1, 2, 6, 5], normale: [1, 0, 0], asseX: [0, 1, 0] },
  { idx: [2, 3, 7, 6], normale: [0, 1, 0], asseX: [-1, 0, 0] },
  { idx: [3, 0, 4, 7], normale: [-1, 0, 0], asseX: [0, -1, 0] },
];

function cuboVertici(l, o = [0, 0, 0]) {
  return [
    [0, 0, 0], [l, 0, 0], [l, l, 0], [0, l, 0],
    [0, 0, l], [l, 0, l], [l, l, l], [0, l, l],
  ].map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
}

/**
 * Facce del cubo con EDGE_LOOP. opzioni: { inverti: normali verso l'interno,
 * salta: indici di facce da omettere, extraBounds: (i) => [bound refs] }
 */
function cuboFacce(w, l, o = [0, 0, 0], opz = {}) {
  const c = cuboVertici(l, o);
  const vertici = c.map((p) => w.vertice(p));
  const spigoli = new Map();
  const spigolo = (a, b) => {
    const chiave = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!spigoli.has(chiave)) {
      const [i, j] = a < b ? [a, b] : [b, a];
      spigoli.set(chiave, { ref: w.edge(vertici[i], vertici[j], w.linea(c[i], c[j])), da: i });
    }
    return spigoli.get(chiave);
  };
  const out = [];
  CUBO_FACCE.forEach((f, fi) => {
    if (opz.salta && opz.salta.includes(fi)) return;
    const idx = opz.inverti ? f.idx.slice().reverse() : f.idx;
    const orientati = [];
    for (let k = 0; k < 4; k++) {
      const a = idx[k];
      const b = idx[(k + 1) % 4];
      const e = spigolo(a, b);
      orientati.push(w.oe(e.ref, e.da === a));
    }
    const bounds = [w.outer(w.loop(orientati))];
    if (opz.extraBounds) bounds.push(...opz.extraBounds(fi));
    const piano = w.piano(c[f.idx[0]], f.normale, f.asseX);
    out.push(w.faccia(bounds, piano, !opz.inverti));
  });
  return out;
}

/* ============================================================== generatori */

/** Cono tronco: r1 in basso (z=0), r2 in alto (z=h). */
export function conoTronco(r1 = 10, r2 = 4, h = 12, opz = {}) {
  const w = new W();
  const ctx = w.contesto('mm', opz.angolo || 'rad');
  const vB = w.vertice([r1, 0, 0]);
  const vT = w.vertice([r2, 0, h]);
  const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r1);
  const cT = w.cerchio([0, 0, h], [0, 0, 1], [1, 0, 0], r2);
  const eB = w.edge(vB, vB, cB);
  const eT = w.edge(vT, vT, cT);
  const fB = w.faccia([w.outer(w.loop([w.oe(eB, false)]))], w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]), false);
  const fT = w.faccia([w.outer(w.loop([w.oe(eT, true)]))], w.piano([0, 0, h], [0, 0, 1], [1, 0, 0]), true);
  let cono;
  const alfa = Math.atan((r1 - r2) / h);
  const ang = opz.angolo === 'degree' ? alfa / DEG : alfa;
  if (opz.angoloNegativo) {
    // asse +z, raggio r1 alla base, semiangolo negativo (stile OCC)
    cono = w.add(`CONICAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r1.toFixed(9)},${(-ang).toFixed(12)})`);
  } else {
    // asse -z con origine in alto: il raggio cresce scendendo, semiangolo positivo
    cono = w.add(`CONICAL_SURFACE('',${w.placement([0, 0, h], [0, 0, -1], [1, 0, 0])},${r2.toFixed(9)},${ang.toFixed(12)})`);
  }
  const fL = w.faccia([w.outer(w.loop([w.oe(eB, true)])), w.bound(w.loop([w.oe(eT, false)]))], cono, true);
  const shell = w.add(`CLOSED_SHELL('',(${fB},${fT},${fL}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cono',${shell})`);
  w.prodotto('cono tronco', [solido], ctx);
  const s = Math.hypot(h, r1 - r2);
  return {
    testo: w.testo('cono.stp'),
    atteso: { area: Math.PI * (r1 + r2) * s + Math.PI * r1 * r1 + Math.PI * r2 * r2, volume: (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2), bordiAperti: 0, facce: 3 },
  };
}

/** Cono a punta: base r, altezza h; apice come VERTEX_LOOP. */
export function conoPunta(r = 10, h = 12) {
  const w = new W();
  const ctx = w.contesto();
  const vB = w.vertice([r, 0, 0]);
  const vA = w.vertice([0, 0, h]);
  const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
  const eB = w.edge(vB, vB, cB);
  const fB = w.faccia([w.outer(w.loop([w.oe(eB, false)]))], w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]), false);
  const alfa = Math.atan(r / h);
  const cono = w.add(`CONICAL_SURFACE('',${w.placement([0, 0, h], [0, 0, -1], [1, 0, 0])},0.0,${alfa.toFixed(12)})`);
  const vl = w.add(`VERTEX_LOOP('',${vA})`);
  const fL = w.faccia([w.outer(w.loop([w.oe(eB, true)])), w.bound(vl)], cono, true);
  const shell = w.add(`CLOSED_SHELL('',(${fB},${fL}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cono',${shell})`);
  w.prodotto('cono a punta', [solido], ctx);
  const s = Math.hypot(h, r);
  return { testo: w.testo('cono-punta.stp'), atteso: { area: Math.PI * r * s + Math.PI * r * r, volume: (Math.PI * r * r * h) / 3, bordiAperti: 0, facce: 2 } };
}

/** Sfera completa come due emisferi separati dall'equatore. */
export function sferaDueFacce(r = 5) {
  const w = new W();
  const ctx = w.contesto();
  const v = w.vertice([r, 0, 0]);
  const c = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
  const e = w.edge(v, v, c);
  const sf = w.add(`SPHERICAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const fN = w.faccia([w.outer(w.loop([w.oe(e, true)]))], sf, true);
  const fS = w.faccia([w.outer(w.loop([w.oe(e, false)]))], sf, true);
  const shell = w.add(`CLOSED_SHELL('',(${fN},${fS}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('sfera',${shell})`);
  w.prodotto('sfera due facce', [solido], ctx);
  return { testo: w.testo('sfera2.stp'), atteso: { area: 4 * Math.PI * r * r, volume: (4 / 3) * Math.PI * r ** 3, bordiAperti: 0, facce: 2 } };
}

/** Sfera completa come UNA faccia con cucitura meridiana (stile OpenCascade). */
export function sferaCucitura(r = 5, opz = {}) {
  const w = new W();
  const ctx = w.contesto();
  const vS = w.vertice([0, 0, -r]);
  const vN = w.vertice([0, 0, r]);
  // meridiano nel piano xz: eval(t) = (r sin t, 0, -r cos t): t=0 polo sud, t=pi polo nord
  const mer = w.cerchio([0, 0, 0], [0, -1, 0], [0, 0, -1], r);
  const seam = w.edge(vS, vN, mer);
  const sf = w.add(`SPHERICAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const oes = [w.oe(seam, true), w.oe(seam, false)];
  const bounds = [w.outer(w.loop(oes))];
  if (opz.vertexLoops) {
    bounds.push(w.bound(w.add(`VERTEX_LOOP('',${vN})`)), w.bound(w.add(`VERTEX_LOOP('',${vS})`)));
  }
  const f = w.faccia(bounds, sf, true);
  const shell = w.add(`CLOSED_SHELL('',(${f}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('sfera',${shell})`);
  w.prodotto('sfera cucitura', [solido], ctx);
  return { testo: w.testo('sfera1.stp'), atteso: { area: 4 * Math.PI * r * r, volume: (4 / 3) * Math.PI * r ** 3, bordiAperti: 0, facce: 1 } };
}

/** Toro completo come UNA faccia con due cuciture (stile OpenCascade). */
export function toroCucitura(R = 10, r = 3) {
  const w = new W();
  const ctx = w.contesto();
  const vA = w.vertice([R + r, 0, 0]);
  const minore = w.cerchio([R, 0, 0], [0, -1, 0], [1, 0, 0], r); // nel piano xz
  const maggiore = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], R + r);
  const eMin = w.edge(vA, vA, minore);
  const eMag = w.edge(vA, vA, maggiore);
  const toro = w.add(`TOROIDAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${R.toFixed(9)},${r.toFixed(9)})`);
  const f = w.faccia([w.outer(w.loop([w.oe(eMin, true), w.oe(eMag, true), w.oe(eMin, false), w.oe(eMag, false)]))], toro, true);
  const shell = w.add(`CLOSED_SHELL('',(${f}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('toro',${shell})`);
  w.prodotto('toro cucitura', [solido], ctx);
  return { testo: w.testo('toro1.stp'), atteso: { area: 4 * Math.PI * Math.PI * R * r, volume: 2 * Math.PI * Math.PI * R * r * r, bordiAperti: 0, facce: 1 } };
}

/** Toro completo come due facce (meta' esterna e meta' interna) separate dai cerchi maggiori in alto e in basso. */
export function toroDueFacce(R = 10, r = 3) {
  const w = new W();
  const ctx = w.contesto();
  const vT = w.vertice([R, 0, r]);
  const vB = w.vertice([R, 0, -r]);
  const cT = w.cerchio([0, 0, r], [0, 0, 1], [1, 0, 0], R);
  const cB = w.cerchio([0, 0, -r], [0, 0, 1], [1, 0, 0], R);
  const eT = w.edge(vT, vT, cT);
  const eB = w.edge(vB, vB, cB);
  const toro = w.add(`TOROIDAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${R.toFixed(9)},${r.toFixed(9)})`);
  const fOut = w.faccia([w.outer(w.loop([w.oe(eB, true)])), w.bound(w.loop([w.oe(eT, false)]))], toro, true);
  const fIn = w.faccia([w.outer(w.loop([w.oe(eT, true)])), w.bound(w.loop([w.oe(eB, false)]))], toro, true);
  const shell = w.add(`CLOSED_SHELL('',(${fOut},${fIn}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('toro',${shell})`);
  w.prodotto('toro due facce', [solido], ctx);
  return { testo: w.testo('toro2.stp'), atteso: { area: 4 * Math.PI * Math.PI * R * r, volume: 2 * Math.PI * Math.PI * R * r * r, bordiAperti: 0, facce: 2 } };
}

/** Cubo di lato l con foro cilindrico passante lungo z (raggio r, centrato). */
export function cuboForo(l = 10, r = 2) {
  const w = new W();
  const ctx = w.contesto();
  const cx = l / 2;
  const vB = w.vertice([cx + r, cx, 0]);
  const vT = w.vertice([cx + r, cx, l]);
  const cB = w.cerchio([cx, cx, 0], [0, 0, 1], [1, 0, 0], r);
  const cT = w.cerchio([cx, cx, l], [0, 0, 1], [1, 0, 0], r);
  const eB = w.edge(vB, vB, cB);
  const eT = w.edge(vT, vT, cT);
  // faccia 0 = fondo (normale -z): foro percorso in senso antiorario visto da +z (= orario visto da -z)
  // faccia 1 = cima (normale +z): foro percorso in senso orario visto da +z
  const facce = cuboFacce(w, l, [0, 0, 0], {
    extraBounds: (fi) => (fi === 0 ? [w.bound(w.loop([w.oe(eB, true)]))] : fi === 1 ? [w.bound(w.loop([w.oe(eT, false)]))] : []),
  });
  const cil = w.add(`CYLINDRICAL_SURFACE('',${w.placement([cx, cx, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const fForo = w.faccia([w.outer(w.loop([w.oe(eB, false)])), w.bound(w.loop([w.oe(eT, true)]))], cil, false);
  const shell = w.add(`CLOSED_SHELL('',(${facce.join(',')},${fForo}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cubo forato',${shell})`);
  w.prodotto('cubo con foro', [solido], ctx);
  return {
    testo: w.testo('cubo-foro.stp'),
    atteso: { area: 6 * l * l - 2 * Math.PI * r * r + 2 * Math.PI * r * l, volume: l ** 3 - Math.PI * r * r * l, bordiAperti: 0, facce: 7 },
    foro: { faccia: fForo, asse: [cx, cx] },
  };
}

/**
 * Cilindro generico. opz: { asseGiu: placement con asse -z, inverti: guscio verso
 * l'interno, unita, cucitura: faccia laterale con un solo loop e spigolo di cucitura
 * (stile OpenCascade), split: laterale divisa in due facce a 0 e 90 gradi,
 * senseF: gli archi del split hanno same_sense .F., trimmed: archi come TRIMMED_CURVE }
 */
export function cilindro(r = 5, h = 20, opz = {}) {
  const w = new W();
  const ctx = w.contesto(opz.unita || 'mm', opz.angolo || 'rad');
  const inv = !!opz.inverti;
  const facce = [];
  const zAsse = opz.asseGiu ? [0, 0, -1] : [0, 0, 1];
  const cilSup = w.add(`CYLINDRICAL_SURFACE('',${w.placement([0, 0, opz.asseGiu ? h : 0], zAsse, [1, 0, 0])},${r.toFixed(9)})`);
  const pianoB = w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const pianoT = w.piano([0, 0, h], [0, 0, 1], [1, 0, 0]);
  if (opz.split) {
    // vertici a 0 e 90 gradi su entrambi i cerchi
    const q = Math.PI / 2;
    const v0B = w.vertice([r, 0, 0]);
    const v9B = w.vertice([0, r, 0]);
    const v0T = w.vertice([r, 0, h]);
    const v9T = w.vertice([0, r, h]);
    const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
    const cT = w.cerchio([0, 0, h], [0, 0, 1], [1, 0, 0], r);
    const curva = (c, a, b) => (opz.trimmed
      ? w.add(`TRIMMED_CURVE('',${c},(PARAMETER_VALUE(${a.toFixed(9)})),(PARAMETER_VALUE(${b.toFixed(9)})),.T.,.PARAMETER.)`)
      : c);
    let eB1; let eB2; let eT1; let eT2;
    if (opz.senseF) {
      // arco 0->90 descritto da 90 a 0 con same_sense .F. (verso opposto alla curva)
      eB1 = w.edge(v9B, v0B, curva(cB, 0, q), false);
      eB2 = w.edge(v0B, v9B, curva(cB, q, 2 * Math.PI), false);
      eT1 = w.edge(v9T, v0T, curva(cT, 0, q), false);
      eT2 = w.edge(v0T, v9T, curva(cT, q, 2 * Math.PI), false);
    } else {
      eB1 = w.edge(v0B, v9B, curva(cB, 0, q));
      eB2 = w.edge(v9B, v0B, curva(cB, q, 2 * Math.PI));
      eT1 = w.edge(v0T, v9T, curva(cT, 0, q));
      eT2 = w.edge(v9T, v0T, curva(cT, q, 2 * Math.PI));
    }
    const s = !opz.senseF; // orientamento "in avanti" per gli oriented edge
    const l0 = w.edge(v0B, v0T, w.linea([r, 0, 0], [r, 0, h]));
    const l9 = w.edge(v9B, v9T, w.linea([0, r, 0], [0, r, h]));
    // fondo: cerchio in senso orario visto da +z (normale -z con same_sense .F. sul piano +z)
    facce.push(w.faccia([w.outer(w.loop([w.oe(eB2, !s), w.oe(eB1, !s)]))], pianoB, false));
    facce.push(w.faccia([w.outer(w.loop([w.oe(eT1, s), w.oe(eT2, s)]))], pianoT, true));
    // laterale 0..90: eB1 avanti, l9 su, eT1 indietro, l0 giu'
    facce.push(w.faccia([w.outer(w.loop([w.oe(eB1, s), w.oe(l9, true), w.oe(eT1, !s), w.oe(l0, false)]))], cilSup, true));
    facce.push(w.faccia([w.outer(w.loop([w.oe(eB2, s), w.oe(l0, true), w.oe(eT2, !s), w.oe(l9, false)]))], cilSup, true));
  } else {
    const vB = w.vertice([r, 0, 0]);
    const vT = w.vertice([r, 0, h]);
    const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
    const cT = w.cerchio([0, 0, h], [0, 0, 1], [1, 0, 0], r);
    const eB = w.edge(vB, vB, cB);
    const eT = w.edge(vT, vT, cT);
    facce.push(w.faccia([w.outer(w.loop([w.oe(eB, inv)]))], pianoB, inv));
    facce.push(w.faccia([w.outer(w.loop([w.oe(eT, !inv)]))], pianoT, !inv));
    if (opz.cucitura) {
      const seam = w.edge(vB, vT, w.linea([r, 0, 0], [r, 0, h]));
      const loop = w.loop([w.oe(eB, !inv), w.oe(seam, true), w.oe(eT, inv), w.oe(seam, false)]);
      facce.push(w.faccia([w.outer(loop)], cilSup, !inv));
    } else {
      facce.push(w.faccia([w.outer(w.loop([w.oe(eB, !inv)])), w.bound(w.loop([w.oe(eT, inv)]))], cilSup, !inv));
    }
  }
  let shell = w.add(`CLOSED_SHELL('',(${facce.join(',')}))`);
  if (opz.orientedShell) shell = w.add(`ORIENTED_CLOSED_SHELL('',*,${shell},.F.)`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cilindro',${shell})`);
  w.prodotto('cilindro', [solido], ctx);
  return {
    testo: w.testo('cilindro.stp'),
    atteso: { area: 2 * Math.PI * r * h + 2 * Math.PI * r * r, volume: Math.PI * r * r * h, bordiAperti: 0, facce: facce.length },
  };
}

/** Cubo con facce POLY_LOOP. tipo: 'FACETED_BREP' | 'MANIFOLD_SOLID_BREP'; faccia: 'FACE_SURFACE' | 'ADVANCED_FACE'. */
export function cuboPolyLoop(l = 10, tipo = 'FACETED_BREP', faccia = 'FACE_SURFACE') {
  const w = new W();
  const ctx = w.contesto();
  const c = cuboVertici(l);
  const punti = c.map((p) => w.punto(p));
  const facce = CUBO_FACCE.map((f) => {
    const loop = w.add(`POLY_LOOP('',(${f.idx.map((i) => punti[i]).join(',')}))`);
    const piano = w.piano(c[f.idx[0]], f.normale, f.asseX);
    return w.add(`${faccia}('',(${w.outer(loop)}),${piano},.T.)`);
  });
  const shell = w.add(`CLOSED_SHELL('',(${facce.join(',')}))`);
  const solido = w.add(`${tipo}('cubo',${shell})`);
  w.prodotto('cubo poly', [solido], ctx, tipo === 'FACETED_BREP' ? 'FACETED_BREP_SHAPE_REPRESENTATION' : 'ADVANCED_BREP_SHAPE_REPRESENTATION');
  return { testo: w.testo('cubo-poly.stp'), atteso: { area: 6 * l * l, volume: l ** 3, bordiAperti: 0, facce: 6 } };
}

/**
 * Assieme: un cubo di lato l usato due volte. Convenzione CAx-IF / OpenCascade /
 * Spatial (come nel file reale del cliente): rep_1 = rappresentazione del figlio
 * (contiene item_1 = origine), rep_2 = rappresentazione del padre (contiene
 * item_2 = collocazione del figlio). Istanza A: traslata di (30,0,0).
 * Istanza B: ruotata di 90 gradi attorno a z e traslata di (0,30,0).
 * opz.invertiConvenzione: scambia rep_1/rep_2 e item_1/item_2.
 */
export function assiemeDueIstanze(l = 10, opz = {}) {
  const w = new W();
  const ctx = w.contesto();
  const facce = cuboFacce(w, l);
  const shell = w.add(`CLOSED_SHELL('',(${facce.join(',')}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cubo',${shell})`);
  const origine = w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const posA = w.placement([30, 0, 0], [0, 0, 1], [1, 0, 0]);
  const posB = w.placement([0, 30, 0], [0, 0, 1], [0, 1, 0]); // X locale -> +y globale (rotazione 90 gradi)
  const figlio = w.prodotto('cubo', [origine, solido], ctx);
  const padre = w.prodotto('assieme', [origine, posA, posB], ctx, 'SHAPE_REPRESENTATION');
  const istanza = (nome, pos) => {
    const idt = opz.invertiConvenzione
      ? w.add(`ITEM_DEFINED_TRANSFORMATION('','',${pos},${origine})`)
      : w.add(`ITEM_DEFINED_TRANSFORMATION('','',${origine},${pos})`);
    const rel = opz.invertiConvenzione
      ? w.add(`(REPRESENTATION_RELATIONSHIP('','',${padre.rep},${figlio.rep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`)
      : w.add(`(REPRESENTATION_RELATIONSHIP('','',${figlio.rep},${padre.rep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
    const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${nome}','${nome}','',${padre.pd},${figlio.pd},$)`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${nauo})`);
    w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${pds})`);
  };
  istanza('istanza A', posA);
  istanza('istanza B', posB);
  return {
    testo: w.testo('assieme.stp'),
    // A: [30,40]x[0,10]x[0,10]; B: ruotato 90 gradi -> [-10,0]x[0,10] poi +(0,30,0) -> [-10,0]x[30,40]
    atteso: { bboxMin: [-10, 0, 0], bboxMax: [40, 40, l], parti: 2, volume: 2 * l ** 3 },
  };
}

/** SHELL_BASED_SURFACE_MODEL. modo: 'aperto' (5 facce, OPEN_SHELL), 'chiuso' (6 facce, CLOSED_SHELL), 'faccia' (una sola faccia a z=-5 con normale +z). */
export function superficie(modo = 'aperto', l = 10) {
  const w = new W();
  const ctx = w.contesto();
  let shell;
  let atteso;
  if (modo === 'faccia') {
    const facce = cuboFacce(w, l, [0, 0, -5 - l], { salta: [0, 2, 3, 4, 5] }); // solo la faccia superiore, a z = -5
    shell = w.add(`OPEN_SHELL('',(${facce.join(',')}))`);
    atteso = { area: l * l, chiusa: false, invertito: false, normaleZ: 1 };
  } else if (modo === 'aperto') {
    const facce = cuboFacce(w, l, [0, 0, 0], { salta: [1] });
    shell = w.add(`OPEN_SHELL('',(${facce.join(',')}))`);
    atteso = { area: 5 * l * l, chiusa: false };
  } else {
    const facce = cuboFacce(w, l);
    shell = w.add(`CLOSED_SHELL('',(${facce.join(',')}))`);
    atteso = { area: 6 * l * l, volume: l ** 3, bordiAperti: 0 };
  }
  const sbsm = w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`);
  w.prodotto('superficie', [sbsm], ctx, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
  return { testo: w.testo('superficie.stp'), atteso };
}

/** Cubo con guscio verso l'interno (loop invertiti e same_sense .F.). opz.orientedShell: avvolto in ORIENTED_CLOSED_SHELL .F. */
export function cuboInvertito(l = 10, opz = {}) {
  const w = new W();
  const ctx = w.contesto();
  const facce = cuboFacce(w, l, [0, 0, 0], { inverti: true });
  let shell = w.add(`CLOSED_SHELL('',(${facce.join(',')}))`);
  if (opz.orientedShell) shell = w.add(`ORIENTED_CLOSED_SHELL('',*,${shell},.F.)`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cubo',${shell})`);
  w.prodotto('cubo invertito', [solido], ctx);
  return { testo: w.testo('cubo-inv.stp'), atteso: { area: 6 * l * l, volume: l ** 3, bordiAperti: 0, invertito: !opz.orientedShell } };
}

/** Cubo l con vuoto cubico interno di lato v (BREP_WITH_VOIDS). */
export function cuboVuoto(l = 10, v = 4) {
  const w = new W();
  const ctx = w.contesto();
  const esterno = cuboFacce(w, l);
  const o = (l - v) / 2;
  const interno = cuboFacce(w, v, [o, o, o], { inverti: true }); // normali verso il vuoto
  const shellE = w.add(`CLOSED_SHELL('',(${esterno.join(',')}))`);
  const shellI = w.add(`CLOSED_SHELL('',(${interno.join(',')}))`);
  const voidShell = w.add(`ORIENTED_CLOSED_SHELL('',*,${shellI},.T.)`);
  const solido = w.add(`BREP_WITH_VOIDS('cubo con vuoto',${shellE},(${voidShell}))`);
  w.prodotto('cubo con vuoto', [solido], ctx);
  return { testo: w.testo('cubo-vuoto.stp'), atteso: { area: 6 * l * l + 6 * v * v, volume: l ** 3 - v ** 3, bordiAperti: 0, facce: 12 } };
}

/**
 * Quarto di cilindro (r, h) come B_SPLINE_SURFACE razionale in record complesso,
 * chiuso da 4 spigoli; una sola faccia in una OPEN_SHELL. opz.curveRazionali:
 * gli archi sono RATIONAL_B_SPLINE_CURVE in record complesso invece di CIRCLE.
 * opz.semplice: superficie non razionale (bilineare piana) come controllo.
 */
export function patchRazionale(r = 5, h = 10, opz = {}) {
  const w = new W();
  const ctx = w.contesto();
  const s2 = Math.SQRT1_2;
  let surf;
  let atteso;
  const v00 = w.vertice([r, 0, 0]);
  const v10 = w.vertice([0, r, 0]);
  const v01 = w.vertice([r, 0, h]);
  const v11 = w.vertice([0, r, h]);
  const arco = (z, vA, vB) => {
    if (opz.curveRazionali) {
      const pts = [w.punto([r, 0, z]), w.punto([r, r, z]), w.punto([0, r, z])];
      const c = w.add(
        `(BOUNDED_CURVE()B_SPLINE_CURVE(2,(${pts.join(',')}),.UNSPECIFIED.,.F.,.F.)` +
        `B_SPLINE_CURVE_WITH_KNOTS((3,3),(0.0,1.0),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()` +
        `RATIONAL_B_SPLINE_CURVE((1.0,${s2.toFixed(12)},1.0))REPRESENTATION_ITEM(''))`,
      );
      return w.edge(vA, vB, c);
    }
    return w.edge(vA, vB, w.cerchio([0, 0, z], [0, 0, 1], [1, 0, 0], r));
  };
  if (opz.semplice) {
    // patch bilineare piana z=0: quadrato di lato r nel piano
    const g = [[w.punto([0, 0, 0]), w.punto([0, r, 0])], [w.punto([r, 0, 0]), w.punto([r, r, 0])]];
    surf = w.add(`B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((${g[0].join(',')}),(${g[1].join(',')})),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.0,1.0),(0.0,1.0),.UNSPECIFIED.)`);
    const a = w.vertice([0, 0, 0]); const b = w.vertice([r, 0, 0]); const c = w.vertice([r, r, 0]); const d = w.vertice([0, r, 0]);
    const e1 = w.edge(a, b, w.linea([0, 0, 0], [r, 0, 0]));
    const e2 = w.edge(b, c, w.linea([r, 0, 0], [r, r, 0]));
    const e3 = w.edge(c, d, w.linea([r, r, 0], [0, r, 0]));
    const e4 = w.edge(d, a, w.linea([0, r, 0], [0, 0, 0]));
    const f = w.faccia([w.outer(w.loop([w.oe(e1), w.oe(e2), w.oe(e3), w.oe(e4)]))], surf, true);
    const shell = w.add(`OPEN_SHELL('',(${f}))`);
    w.prodotto('patch', [w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`)], ctx, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
    return { testo: w.testo('patch.stp'), atteso: { area: r * r, facce: 1 } };
  }
  // griglia u (3 punti, grado 2, razionale) x v (2 punti, grado 1)
  const g = [
    [w.punto([r, 0, 0]), w.punto([r, 0, h])],
    [w.punto([r, r, 0]), w.punto([r, r, h])],
    [w.punto([0, r, 0]), w.punto([0, r, h])],
  ];
  const griglia = `((${g[0].join(',')}),(${g[1].join(',')}),(${g[2].join(',')}))`;
  const pesi = `((1.0,1.0),(${s2.toFixed(12)},${s2.toFixed(12)}),(1.0,1.0))`;
  surf = w.add(
    `(BOUNDED_SURFACE()B_SPLINE_SURFACE(2,1,${griglia},.UNSPECIFIED.,.F.,.F.,.F.)` +
    `B_SPLINE_SURFACE_WITH_KNOTS((3,3),(2,2),(0.0,1.0),(0.0,1.0),.UNSPECIFIED.)GEOMETRIC_REPRESENTATION_ITEM()` +
    `RATIONAL_B_SPLINE_SURFACE(${pesi})REPRESENTATION_ITEM('')SURFACE())`,
  );
  const eB = arco(0, v00, v10);
  const eT = arco(h, v01, v11);
  const l0 = w.edge(v00, v01, w.linea([r, 0, 0], [r, 0, h]));
  const l9 = w.edge(v10, v11, w.linea([0, r, 0], [0, r, h]));
  const f = w.faccia([w.outer(w.loop([w.oe(eB), w.oe(l9), w.oe(eT, false), w.oe(l0, false)]))], surf, true);
  const shell = w.add(`OPEN_SHELL('',(${f}))`);
  w.prodotto('patch', [w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`)], ctx, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
  atteso = { area: (Math.PI / 2) * r * h, facce: 1 };
  return { testo: w.testo('patch-razionale.stp'), atteso };
}

/** Cono tronco con la laterale come SURFACE_OF_REVOLUTION di una LINE. opz.magnitudoUno: VECTOR con modulo 1 (stile OCC). */
export function conoRivoluzione(r1 = 10, r2 = 4, h = 12, opz = {}) {
  const w = new W();
  const ctx = w.contesto();
  const vB = w.vertice([r1, 0, 0]);
  const vT = w.vertice([r2, 0, h]);
  const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r1);
  const cT = w.cerchio([0, 0, h], [0, 0, 1], [1, 0, 0], r2);
  const eB = w.edge(vB, vB, cB);
  const eT = w.edge(vT, vT, cT);
  const fB = w.faccia([w.outer(w.loop([w.oe(eB, false)]))], w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]), false);
  const fT = w.faccia([w.outer(w.loop([w.oe(eT, true)]))], w.piano([0, 0, h], [0, 0, 1], [1, 0, 0]), true);
  const profilo = w.linea([r1, 0, 0], [r2, 0, h], !!opz.magnitudoUno);
  const asse = w.add(`AXIS1_PLACEMENT('',${w.punto([0, 0, 0])},${w.direzione([0, 0, 1])})`);
  const rev = w.add(`SURFACE_OF_REVOLUTION('',${profilo},${asse})`);
  const fL = w.faccia([w.outer(w.loop([w.oe(eB, true)])), w.bound(w.loop([w.oe(eT, false)]))], rev, true);
  const shell = w.add(`CLOSED_SHELL('',(${fB},${fT},${fL}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cono',${shell})`);
  w.prodotto('cono rivoluzione', [solido], ctx);
  const s = Math.hypot(h, r1 - r2);
  return {
    testo: w.testo('cono-rev.stp'),
    atteso: { area: Math.PI * (r1 + r2) * s + Math.PI * r1 * r1 + Math.PI * r2 * r2, volume: (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2), bordiAperti: 0, facce: 3 },
  };
}

/** Cilindro (r, h) tagliato in alto da un piano inclinato di alfa: la faccia superiore e' un'ellisse. */
export function cilindroEllisse(r = 5, h = 20, alfaGradi = 30) {
  const w = new W();
  const ctx = w.contesto();
  const a = alfaGradi * DEG;
  const vB = w.vertice([r, 0, 0]);
  const vT = w.vertice([r, 0, h + r * Math.tan(a)]);
  const cB = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
  const n = [-Math.sin(a), 0, Math.cos(a)];
  const x = [Math.cos(a), 0, Math.sin(a)];
  const ell = w.ellisse([0, 0, h], n, x, r / Math.cos(a), r);
  const eB = w.edge(vB, vB, cB);
  const eT = w.edge(vT, vT, ell);
  const fB = w.faccia([w.outer(w.loop([w.oe(eB, false)]))], w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]), false);
  const fT = w.faccia([w.outer(w.loop([w.oe(eT, true)]))], w.piano([0, 0, h], n, x), true);
  const cil = w.add(`CYLINDRICAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const fL = w.faccia([w.outer(w.loop([w.oe(eB, true)])), w.bound(w.loop([w.oe(eT, false)]))], cil, true);
  const shell = w.add(`CLOSED_SHELL('',(${fB},${fT},${fL}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cilindro tagliato',${shell})`);
  w.prodotto('cilindro ellisse', [solido], ctx);
  return {
    testo: w.testo('ellisse.stp'),
    atteso: { area: 2 * Math.PI * r * h + Math.PI * r * r + (Math.PI * r * r) / Math.cos(a), volume: Math.PI * r * r * h, bordiAperti: 0, facce: 3 },
  };
}

/** Wireframe: GEOMETRIC_CURVE_SET con un TRIMMED_CURVE (0..90 gradi) su un cerchio; unita' angolare a scelta. */
export function arcoWireframe(r = 10, angolo = 'rad') {
  const w = new W();
  const ctx = w.contesto('mm', angolo);
  const c = w.cerchio([0, 0, 0], [0, 0, 1], [1, 0, 0], r);
  const t1 = angolo === 'degree' ? 90 : Math.PI / 2;
  const tc = w.add(`TRIMMED_CURVE('',${c},(PARAMETER_VALUE(0.0)),(PARAMETER_VALUE(${t1.toFixed(9)})),.T.,.PARAMETER.)`);
  const set = w.add(`GEOMETRIC_CURVE_SET('',(${tc}))`);
  w.prodotto('arco', [set], ctx, 'GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION');
  return { testo: w.testo('arco.stp'), atteso: { lunghezza: (Math.PI / 2) * r, bboxMax: [r, r, 0] } };
}

/** Fascia torica (raccordo) tra due cerchi: v in [v1, v2] sul toro (R, r), una faccia in OPEN_SHELL. */
export function fasciaTorica(R = 10, r = 3, v1 = -Math.PI / 2, v2 = 0) {
  const w = new W();
  const ctx = w.contesto();
  const p = (v) => [R + r * Math.cos(v), 0, r * Math.sin(v)];
  const c = (v) => w.cerchio([0, 0, r * Math.sin(v)], [0, 0, 1], [1, 0, 0], R + r * Math.cos(v));
  const vA = w.vertice(p(v1));
  const vB = w.vertice(p(v2));
  const eA = w.edge(vA, vA, c(v1));
  const eB = w.edge(vB, vB, c(v2));
  const toro = w.add(`TOROIDAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${R.toFixed(9)},${r.toFixed(9)})`);
  const f = w.faccia([w.outer(w.loop([w.oe(eA, true)])), w.bound(w.loop([w.oe(eB, false)]))], toro, true);
  const shell = w.add(`OPEN_SHELL('',(${f}))`);
  w.prodotto('fascia', [w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`)], ctx, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
  // area = int_u int_v (R + r cos v) r dv du = 2 pi r [R (v2-v1) + r (sin v2 - sin v1)]
  return { testo: w.testo('fascia.stp'), atteso: { area: 2 * Math.PI * r * (R * (v2 - v1) + r * (Math.sin(v2) - Math.sin(v1))), facce: 1 } };
}

/** Quarto di disco piano (raggio r) delimitato da un arco RATIONAL_B_SPLINE_CURVE (record complesso) e due segmenti. */
export function quartoDiscoRazionale(r = 5) {
  const w = new W();
  const ctx = w.contesto();
  const s2 = Math.SQRT1_2;
  const o = w.vertice([0, 0, 0]);
  const a = w.vertice([r, 0, 0]);
  const b = w.vertice([0, r, 0]);
  const pts = [w.punto([r, 0, 0]), w.punto([r, r, 0]), w.punto([0, r, 0])];
  const arco = w.add(
    `(BOUNDED_CURVE()B_SPLINE_CURVE(2,(${pts.join(',')}),.UNSPECIFIED.,.F.,.F.)` +
    `B_SPLINE_CURVE_WITH_KNOTS((3,3),(0.0,1.0),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()` +
    `RATIONAL_B_SPLINE_CURVE((1.0,${s2.toFixed(12)},1.0))REPRESENTATION_ITEM(''))`,
  );
  const e1 = w.edge(o, a, w.linea([0, 0, 0], [r, 0, 0]));
  const e2 = w.edge(a, b, arco);
  const e3 = w.edge(b, o, w.linea([0, r, 0], [0, 0, 0]));
  const f = w.faccia([w.outer(w.loop([w.oe(e1), w.oe(e2), w.oe(e3)]))], w.piano([0, 0, 0], [0, 0, 1], [1, 0, 0]), true);
  const shell = w.add(`OPEN_SHELL('',(${f}))`);
  w.prodotto('quarto disco', [w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`)], ctx, 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION');
  return { testo: w.testo('quarto-disco.stp'), atteso: { area: (Math.PI * r * r) / 4, facce: 1 } };
}
