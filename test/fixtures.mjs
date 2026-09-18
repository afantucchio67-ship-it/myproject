/**
 * Generatori di file STEP sintetici per i test: costruiscono un cubo e un
 * cilindro completi (AP203, BREP avanzato) di cui area e volume sono noti in
 * forma analitica.
 */

class Scrittore {
  constructor() {
    this.righe = [];
    this.n = 0;
  }

  /** Aggiunge un'entita' e restituisce il suo riferimento (#id). */
  add(testo) {
    this.n += 1;
    this.righe.push(`#${this.n}=${testo};`);
    return `#${this.n}`;
  }

  punto(p) {
    return this.add(`CARTESIAN_POINT('',(${p.map((x) => x.toFixed(9)).join(',')}))`);
  }

  direzione(d) {
    return this.add(`DIRECTION('',(${d.map((x) => x.toFixed(9)).join(',')}))`);
  }

  placement(origine, asseZ, asseX) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.punto(origine)},${this.direzione(asseZ)},${this.direzione(asseX)})`);
  }

  contesto(unita = 'mm') {
    let mm = this.add("(NAMED_UNIT(*)LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.))");
    if (unita === 'inch') {
      // pollice come unita' derivata: 1 in = 25.4 mm
      const misura = this.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
      const dim = this.add('DIMENSIONAL_EXPONENTS(1.0,0.0,0.0,0.0,0.0,0.0,0.0)');
      mm = this.add(`(CONVERSION_BASED_UNIT('INCH',${misura})LENGTH_UNIT()NAMED_UNIT(${dim}))`);
    }
    const rad = this.add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
    const sr = this.add("(NAMED_UNIT(*)SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.))");
    const unc = this.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-5),${mm},'chiusura','')`);
    return this.add(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))` +
        `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('prova','test'))`,
    );
  }

  /** Involucro prodotto + rappresentazione di forma per un solido. */
  prodotto(nome, solido, contesto) {
    const appCtx = this.add(`APPLICATION_CONTEXT('automotive design')`);
    const mechCtx = this.add(`MECHANICAL_CONTEXT('',${appCtx},'mechanical')`);
    const designCtx = this.add(`DESIGN_CONTEXT('',${appCtx},'design')`);
    const prod = this.add(`PRODUCT('${nome}','${nome}','pezzo di prova',(${mechCtx}))`);
    const form = this.add(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('A','NONE',${prod},.MADE.)`);
    const pd = this.add(`PRODUCT_DEFINITION('progetto','',${form},${designCtx})`);
    const pds = this.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    const rep = this.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${nome}',(${solido}),${contesto})`);
    this.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    this.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${prod}))`);
    return rep;
  }

  testo(nomeFile) {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('modello di prova'),'2;1');",
      `FILE_NAME('${nomeFile}','2026-01-01T00:00:00',('test'),('nessuna'),'generatore di prova','','');`,
      "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
      'ENDSEC;',
      'DATA;',
      ...this.righe,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

/** Cubo di lato `l` con un vertice nell'origine: area 6l², volume l³. */
export function cuboStep(l = 10, unita = 'mm') {
  const w = new Scrittore();
  const ctx = w.contesto(unita);
  const c = [
    [0, 0, 0], [l, 0, 0], [l, l, 0], [0, l, 0],
    [0, 0, l], [l, 0, l], [l, l, l], [0, l, l],
  ];
  const vertici = c.map((p) => w.add(`VERTEX_POINT('',${w.punto(p)})`));

  // facce come quadruple di vertici in verso antiorario visto da fuori
  const facce = [
    { idx: [0, 3, 2, 1], normale: [0, 0, -1], asseX: [1, 0, 0] },
    { idx: [4, 5, 6, 7], normale: [0, 0, 1], asseX: [1, 0, 0] },
    { idx: [0, 1, 5, 4], normale: [0, -1, 0], asseX: [1, 0, 0] },
    { idx: [1, 2, 6, 5], normale: [1, 0, 0], asseX: [0, 1, 0] },
    { idx: [2, 3, 7, 6], normale: [0, 1, 0], asseX: [-1, 0, 0] },
    { idx: [3, 0, 4, 7], normale: [-1, 0, 0], asseX: [0, -1, 0] },
  ];

  const spigoli = new Map(); // "a-b" -> riferimento EDGE_CURVE
  const spigolo = (a, b) => {
    const chiave = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!spigoli.has(chiave)) {
      const [i, j] = a < b ? [a, b] : [b, a];
      const dir = [c[j][0] - c[i][0], c[j][1] - c[i][1], c[j][2] - c[i][2]];
      const lung = Math.hypot(...dir);
      const vettore = w.add(`VECTOR('',${w.direzione(dir.map((x) => x / lung))},${lung.toFixed(9)})`);
      const linea = w.add(`LINE('',${w.punto(c[i])},${vettore})`);
      spigoli.set(chiave, { ref: w.add(`EDGE_CURVE('',${vertici[i]},${vertici[j]},${linea},.T.)`), da: i, a: j });
    }
    return spigoli.get(chiave);
  };

  const facceRef = facce.map((f) => {
    const orientati = [];
    for (let k = 0; k < 4; k++) {
      const a = f.idx[k];
      const b = f.idx[(k + 1) % 4];
      const e = spigolo(a, b);
      const verso = e.da === a ? '.T.' : '.F.';
      orientati.push(w.add(`ORIENTED_EDGE('',*,*,${e.ref},${verso})`));
    }
    const loop = w.add(`EDGE_LOOP('',(${orientati.join(',')}))`);
    const bound = w.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const piano = w.add(`PLANE('',${w.placement(c[f.idx[0]], f.normale, f.asseX)})`);
    return w.add(`ADVANCED_FACE('',(${bound}),${piano},.T.)`);
  });

  const shell = w.add(`CLOSED_SHELL('',(${facceRef.join(',')}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cubo',${shell})`);
  w.prodotto('cubo di prova', solido, ctx);
  return w.testo('cubo.stp');
}

/** Cilindro di raggio r e altezza h sull'asse Z: volume πr²h. */
export function cilindroStep(r = 5, h = 20) {
  const w = new Scrittore();
  const ctx = w.contesto();
  const vBasso = w.add(`VERTEX_POINT('',${w.punto([r, 0, 0])})`);
  const vAlto = w.add(`VERTEX_POINT('',${w.punto([r, 0, h])})`);
  const cerchioBasso = w.add(`CIRCLE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const cerchioAlto = w.add(`CIRCLE('',${w.placement([0, 0, h], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const eBasso = w.add(`EDGE_CURVE('',${vBasso},${vBasso},${cerchioBasso},.T.)`);
  const eAlto = w.add(`EDGE_CURVE('',${vAlto},${vAlto},${cerchioAlto},.T.)`);

  // disco inferiore: normale della superficie +Z, same_sense .F. => normale uscente -Z
  const loopB = w.add(`EDGE_LOOP('',(${w.add(`ORIENTED_EDGE('',*,*,${eBasso},.F.)`)}))`);
  const boundB = w.add(`FACE_OUTER_BOUND('',${loopB},.T.)`);
  const pianoB = w.add(`PLANE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])})`);
  const facciaB = w.add(`ADVANCED_FACE('',(${boundB}),${pianoB},.F.)`);

  // disco superiore
  const loopA = w.add(`EDGE_LOOP('',(${w.add(`ORIENTED_EDGE('',*,*,${eAlto},.T.)`)}))`);
  const boundA = w.add(`FACE_OUTER_BOUND('',${loopA},.T.)`);
  const pianoA = w.add(`PLANE('',${w.placement([0, 0, h], [0, 0, 1], [1, 0, 0])})`);
  const facciaA = w.add(`ADVANCED_FACE('',(${boundA}),${pianoA},.T.)`);

  // superficie laterale: due contorni (sotto e sopra)
  const loopL1 = w.add(`EDGE_LOOP('',(${w.add(`ORIENTED_EDGE('',*,*,${eBasso},.T.)`)}))`);
  const loopL2 = w.add(`EDGE_LOOP('',(${w.add(`ORIENTED_EDGE('',*,*,${eAlto},.F.)`)}))`);
  const boundL1 = w.add(`FACE_OUTER_BOUND('',${loopL1},.T.)`);
  const boundL2 = w.add(`FACE_BOUND('',${loopL2},.T.)`);
  const cilindro = w.add(`CYLINDRICAL_SURFACE('',${w.placement([0, 0, 0], [0, 0, 1], [1, 0, 0])},${r.toFixed(9)})`);
  const facciaL = w.add(`ADVANCED_FACE('',(${boundL1},${boundL2}),${cilindro},.T.)`);

  const shell = w.add(`CLOSED_SHELL('',(${facciaB},${facciaA},${facciaL}))`);
  const solido = w.add(`MANIFOLD_SOLID_BREP('cilindro',${shell})`);
  w.prodotto('cilindro di prova', solido, ctx);
  return w.testo('cilindro.stp');
}
