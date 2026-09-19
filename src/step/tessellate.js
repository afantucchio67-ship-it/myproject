/**
 * Tassellazione BREP: da ADVANCED_FACE / FACE_SURFACE a mesh triangolari.
 *
 * Per ogni faccia:
 *  1. i bordi (edge loop) sono campionati in 3D con errore di corda
 *     controllato; VERTEX_LOOP -> apici, cuciture -> anelli separati;
 *  2. i punti sono proiettati nello spazio parametrico (u,v), riscalato con
 *     la metrica locale e srotolato sulle superfici periodiche;
 *  3. facce rigate periodiche (cilindri, coni, estrusioni, rivoluzioni) con
 *     due anelli: cucitura diretta fra i bordi (loft); con un apice: ventaglio;
 *     altre facce periodiche intere (sfere, tori): griglia con intervallo v
 *     scelto dall'orientamento del contorno;
 *  4. tutte le altre: ear clipping per qualita' + scambi di Delaunay, poi
 *     suddivisione uniforme (bordi sulle corde condivise: mesh a tenuta);
 *  5. normali analitiche, verso dei triangoli allineato, area della faccia.
 */

import {
  buildCurve,
  buildSurface,
  closestParam,
  cross,
  dist,
  dot,
  len,
  metricScales,
  projectSequence,
  readPoint,
  scaledSurface,
  sub,
} from './geometry.js';

const FACE_TYPES = ['ADVANCED_FACE', 'FACE_SURFACE', 'CURVE_BOUNDED_SURFACE'];

/** Accoda tutti gli elementi senza spread: `push(...arr)` fallisce oltre ~100k elementi. */
export function appendAll(target, source) {
  for (let i = 0; i < source.length; i++) target.push(source[i]);
  return target;
}

/* ------------------------------------------------------- campionamento bordi */

function baseSegments(curve) {
  switch (curve.type) {
    case 'LINE':
      return 1;
    case 'CIRCLE':
    case 'ELLIPSE':
      return 24;
    case 'POLYLINE':
      return Math.max(1, Math.round(curve.domain[1] - curve.domain[0]));
    default:
      return 16;
  }
}

/** Campiona una curva tra t0 e t1 con errore di corda < tol. */
export function sampleCurve(curve, t0, t1, tol, maxPoints = 600) {
  const n0 = baseSegments(curve);
  const params = [];
  for (let i = 0; i <= n0; i++) params.push(t0 + ((t1 - t0) * i) / n0);
  // raffinamento adattivo
  for (let pass = 0; pass < 7 && params.length < maxPoints; pass++) {
    const out = [params[0]];
    let refined = false;
    for (let i = 0; i < params.length - 1; i++) {
      const a = params[i];
      const b = params[i + 1];
      const pa = curve.eval(a);
      const pb = curve.eval(b);
      const mid = (a + b) / 2;
      const pm = curve.eval(mid);
      const chordMid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      if (dist(chordMid, pm) > tol && out.length + 2 < maxPoints) {
        out.push(mid);
        refined = true;
      }
      out.push(b);
    }
    params.length = 0;
    params.push(...out);
    if (!refined) break;
  }
  return params;
}

/** Punti 3D (+ parametri) di un ORIENTED_EDGE, nel verso del loop. */
function sampleOrientedEdge(file, orientedEdge, tol) {
  const oe = file.get(orientedEdge);
  if (!oe) return null;
  const p = oe.partParams('ORIENTED_EDGE') || oe.params;
  const edge = file.get(p[3]);
  const orientation = p[4] && p[4].enum ? p[4].enum === 'T' : true;
  if (!edge) return null;
  const ep = edge.partParams('EDGE_CURVE') || edge.params;
  const startV = file.get(ep[1]);
  const endV = file.get(ep[2]);
  const curve = buildCurve(file, ep[3]);
  const sameSense = ep[4] && ep[4].enum ? ep[4].enum === 'T' : true;
  if (!curve) return { unsupported: edge, points: [] };

  const vpoint = (v) => (v ? readPoint(file, (v.partParams('VERTEX_POINT') || v.params)[1]) : null);
  // con same_sense .F. lo spigolo percorre la curva al contrario: il vertice
  // iniziale dello spigolo corrisponde al parametro finale sulla curva
  const ps = sameSense ? vpoint(startV) : vpoint(endV);
  const pe = sameSense ? vpoint(endV) : vpoint(startV);

  let t0 = curve.domain[0];
  let t1 = curve.domain[1];
  const closedEdge = ps && pe ? dist(ps, pe) < 1e-9 : false;

  if (!closedEdge && ps && pe) {
    t0 = closestParam(curve, ps);
    t1 = closestParam(curve, pe);
    if (curve.periodic) {
      if (t1 <= t0) t1 += curve.periodic;
    } else if (t1 < t0) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
  } else if (closedEdge && curve.periodic) {
    t0 = ps ? closestParam(curve, ps) : curve.domain[0];
    t1 = t0 + curve.periodic;
  }

  let params = sampleCurve(curve, t0, t1, tol);
  let points = params.map((t) => curve.eval(t));
  // verso della curva rispetto all'edge, poi verso dell'oriented edge
  if (!sameSense) {
    params = params.slice().reverse();
    points = points.slice().reverse();
  }
  if (!orientation) {
    params = params.slice().reverse();
    points = points.slice().reverse();
  }
  return { points, params, curve, edge, closedEdge };
}

/**
 * Anelli 3D di una faccia: { rings: [{points, isOuter, edges}], apici, problems }.
 * - i VERTEX_LOOP (apice di un cono, poli di una sfera) diventano `apici`;
 * - uno spigolo percorso due volte nello stesso loop e' una cucitura (stile
 *   OpenCascade/FreeCAD): viene tolto e il loop si spezza negli anelli reali.
 */
export function faceRings(file, faceEnt, tol) {
  const params = faceEnt.partParams('ADVANCED_FACE') || faceEnt.partParams('FACE_SURFACE') || faceEnt.params;
  const bounds = params[1] || [];
  const rings = [];
  const apici = [];
  const problems = [];
  const pulisci = (pts) => {
    const clean = [];
    for (const p of pts) {
      if (!clean.length || dist(clean[clean.length - 1], p) > 1e-9) clean.push(p);
    }
    while (clean.length > 1 && dist(clean[0], clean[clean.length - 1]) < 1e-9) clean.pop();
    return clean;
  };
  for (const bref of bounds) {
    const bound = file.get(bref);
    if (!bound) continue;
    const bp = bound.partParams('FACE_OUTER_BOUND') || bound.partParams('FACE_BOUND') || bound.params;
    const orientation = bp[2] && bp[2].enum ? bp[2].enum === 'T' : true;
    const loop = file.get(bp[1]);
    if (!loop) continue;
    if (loop.has('VERTEX_LOOP')) {
      const v = file.get((loop.partParams('VERTEX_LOOP') || loop.params)[1]);
      const pt = v ? readPoint(file, (v.partParams('VERTEX_POINT') || v.params)[1]) : null;
      if (pt) apici.push(pt);
      continue;
    }
    const lp = loop.partParams('EDGE_LOOP') || loop.partParams('POLY_LOOP') || loop.params;
    const isOuter = bound.has('FACE_OUTER_BOUND');
    if (loop.has('POLY_LOOP')) {
      const pts = (lp[1] || []).map((r) => readPoint(file, r) || [0, 0, 0]);
      if (!orientation) pts.reverse();
      const clean = pulisci(pts);
      if (clean.length >= 3) rings.push({ points: clean, isOuter, edges: [] });
      continue;
    }
    // segmenti dello spigolo, ognuno con l'id dell'EDGE_CURVE
    const segmenti = [];
    for (const oref of lp[1] || []) {
      const seg = sampleOrientedEdge(file, oref, tol);
      if (!seg) continue;
      if (seg.unsupported) {
        problems.push(`#${faceEnt.id}: curva non supportata su #${seg.unsupported.id}`);
        continue;
      }
      segmenti.push({ id: seg.edge.id, points: seg.points });
    }
    // cuciture: spigoli presenti due volte nel loop
    const conteggio = new Map();
    for (const sg of segmenti) conteggio.set(sg.id, (conteggio.get(sg.id) || 0) + 1);
    const cuciture = new Set([...conteggio].filter(([, n]) => n >= 2).map(([id]) => id));
    // spezza il loop alle cuciture (il loop e' circolare: ruota per iniziare da una cucitura)
    let gruppi = [];
    if (cuciture.size) {
      const primo = segmenti.findIndex((sg) => cuciture.has(sg.id));
      const ruotati = segmenti.slice(primo).concat(segmenti.slice(0, primo));
      let corrente = [];
      for (const sg of ruotati) {
        if (cuciture.has(sg.id)) {
          if (corrente.length) gruppi.push(corrente);
          corrente = [];
        } else corrente.push(sg);
      }
      if (corrente.length) gruppi.push(corrente);
    } else gruppi = [segmenti];

    for (const gruppo of gruppi) {
      const pts = [];
      const edgeRefs = [];
      for (const sg of gruppo) {
        edgeRefs.push(sg.id);
        const sp = sg.points;
        if (!pts.length) pts.push(...sp);
        else {
          const last = pts[pts.length - 1];
          // ricuci il verso se necessario
          if (dist(last, sp[0]) > dist(last, sp[sp.length - 1])) {
            for (let i = sp.length - 2; i >= 0; i--) pts.push(sp[i]);
          } else {
            for (let i = 1; i < sp.length; i++) pts.push(sp[i]);
          }
        }
      }
      if (!orientation) pts.reverse();
      const clean = pulisci(pts);
      if (clean.length >= 3) {
        rings.push({ points: clean, isOuter: isOuter && gruppi.length === 1, edges: edgeRefs, daCucitura: cuciture.size > 0 });
      } else if (clean.length) {
        problems.push(`#${faceEnt.id}: anello degenere (${clean.length} punti)`);
      }
    }
  }
  return { rings, apici, problems };
}

/* ------------------------------------------------------- proiezione UV */

function unwrapRing(surf, points, tol) {
  // proiezione sequenziale: analitica dove possibile, altrimenti continua
  const uv = surf.isPlanar || surf.uPeriod !== null || surf.vPeriod !== null
    ? points.map((p) => surf.project(p))
    : projectSequence(surf, points, Math.max(tol * 0.05, 1e-6));
  // il punto 3D esatto resta agganciato al parametro: i vertici di bordo
  // devono coincidere con quelli della faccia adiacente (mesh a tenuta)
  uv.forEach((x, i) => { x.p3 = points[i]; });
  const fix = (idx, period) => {
    if (!period) return 0;
    let wrap = 0;
    for (let i = 1; i < uv.length; i++) {
      let d = uv[i][idx] + wrap - uv[i - 1][idx];
      while (d > period / 2) {
        wrap -= period;
        d -= period;
      }
      while (d < -period / 2) {
        wrap += period;
        d += period;
      }
      uv[i][idx] += wrap;
    }
    // salto residuo tra ultimo e primo punto = anello che gira sul periodo
    let closing = uv[0][idx] - uv[uv.length - 1][idx];
    while (closing > period / 2) closing -= period;
    while (closing < -period / 2) closing += period;
    const net = uv[uv.length - 1][idx] + closing - uv[0][idx];
    return net;
  };
  const netU = fix(0, surf.uPeriod);
  const netV = fix(1, surf.vPeriod);
  return { uv, netU, netV };
}

/** Area con segno (shoelace): positiva se l'anello e' antiorario in UV. */
function ringArea(uv) {
  let a = 0;
  for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
    a += uv[j][0] * uv[i][1] - uv[i][0] * uv[j][1];
  }
  return a / 2;
}

/* ------------------------------------------------------- ear clipping */

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/** Unisce i fori al contorno esterno con dei ponti, restituendo un unico anello. */
function bridgeHoles(outer, holes) {
  let ring = outer.slice();
  const remaining = holes.slice();
  const allEdges = () => {
    const edges = [];
    for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
    for (const h of remaining) {
      for (let i = 0; i < h.length; i++) edges.push([h[i], h[(i + 1) % h.length]]);
    }
    return edges;
  };
  while (remaining.length) {
    let best = null;
    for (let hi = 0; hi < remaining.length; hi++) {
      const hole = remaining[hi];
      for (let i = 0; i < hole.length; i++) {
        for (let j = 0; j < ring.length; j++) {
          const d = Math.hypot(hole[i][0] - ring[j][0], hole[i][1] - ring[j][1]);
          if (!best || d < best.d) best = { d, hi, i, j };
        }
      }
    }
    if (!best) break;
    // verifica che il ponte non intersechi altri lati
    const hole = remaining[best.hi];
    const a = ring[best.j];
    const b = hole[best.i];
    const edges = allEdges();
    let blocked = false;
    for (const [p, q] of edges) {
      if (p === a || q === a || p === b || q === b) continue;
      if (segmentsIntersect(a, b, p, q)) {
        blocked = true;
        break;
      }
    }
    const rotated = hole.slice(best.i).concat(hole.slice(0, best.i));
    const insert = [...rotated, rotated[0], a];
    ring = ring.slice(0, best.j + 1).concat(insert, ring.slice(best.j + 1));
    remaining.splice(best.hi, 1);
    // se il ponte interseca altri lati la triangolazione puo' degradare ma
    // resta chiusa: l'ear clipping ha il ripiego per i casi difficili
    void blocked;
  }
  return ring;
}

/**
 * Ear clipping su un anello semplice CCW; restituisce triple di indici.
 *
 * L'orecchio non e' il primo valido ma quello di qualita' migliore (lato piu'
 * lungo minimo): sugli anelli sottili e allungati — tipici dei raccordi e
 * delle fasce CAD — evita i triangoli "scheggia" che in 3D taglierebbero
 * attraverso la superficie. Sugli anelli molto grandi si ripiega sul primo
 * valido per restare veloce.
 */
export function earClip(ring) {
  const n = ring.length;
  const tris = [];
  if (n < 3) return tris;
  const quality = n <= 2000;
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  // lista circolare con indici prev/next: rimozione O(1)
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = (i - 1 + n) % n;
    next[i] = (i + 1) % n;
  }
  const vivo = new Uint8Array(n).fill(1);
  // cache: valido[i], bloccante[i] = vertice che impedisce l'orecchio (-1 se nessuno)
  const valido = new Uint8Array(n);
  const bloccante = new Int32Array(n).fill(-1);
  const costo = new Float64Array(n);

  const valuta = (i1) => {
    const i0 = prev[i1];
    const i2 = next[i1];
    const a = ring[i0];
    const b = ring[i1];
    const c = ring[i2];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    bloccante[i1] = -1;
    if (cr <= 1e-16) {
      valido[i1] = 0; // riflesso o degenere: dipende solo dai vicini
      return;
    }
    const minX = Math.min(a[0], b[0], c[0]);
    const maxX = Math.max(a[0], b[0], c[0]);
    const minY = Math.min(a[1], b[1], c[1]);
    const maxY = Math.max(a[1], b[1], c[1]);
    for (let m = next[i2]; m !== i0; m = next[m]) {
      const p = ring[m];
      if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) continue;
      // i vertici duplicati dai ponti dei fori coincidono con a, b o c: non bloccano
      if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
      if (pointInTriangle(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
        valido[i1] = 0;
        bloccante[i1] = m;
        return;
      }
    }
    valido[i1] = 1;
    costo[i1] = Math.max(dist2(a, b), dist2(b, c), dist2(c, a));
  };
  for (let i = 0; i < n; i++) valuta(i);

  let restanti = n;
  let testa = 0;
  let guard = 0;
  while (restanti > 3 && guard++ < 4 * n + 100) {
    let chosen = -1;
    let bestCost = Infinity;
    let i = testa;
    for (let k = 0; k < restanti; k++, i = next[i]) {
      if (!valido[i]) continue;
      if (!quality) {
        chosen = i;
        break;
      }
      if (costo[i] < bestCost) {
        bestCost = costo[i];
        chosen = i;
      }
    }
    if (chosen < 0) {
      // nessun orecchio valido (anello degenere o autointersecante):
      // stacca il triangolo meno degenere per non bloccarsi
      let bestArea = -Infinity;
      i = testa;
      for (let k = 0; k < restanti; k++, i = next[i]) {
        const a = ring[prev[i]];
        const b = ring[i];
        const c = ring[next[i]];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cr > bestArea) {
          bestArea = cr;
          chosen = i;
        }
      }
    }
    const i0 = prev[chosen];
    const i2 = next[chosen];
    tris.push([i0, chosen, i2]);
    // rimozione dalla lista circolare
    next[i0] = i2;
    prev[i2] = i0;
    vivo[chosen] = 0;
    restanti--;
    if (testa === chosen) testa = i2;
    // cambiano solo i vicini e gli orecchi bloccati dal vertice rimosso
    valuta(i0);
    valuta(i2);
    i = testa;
    for (let k = 0; k < restanti; k++, i = next[i]) {
      if (bloccante[i] === chosen) valuta(i);
    }
  }
  if (restanti === 3) tris.push([testa, next[testa], next[next[testa]]]);
  return tris;
}

/* ------------------------------------------------- Delaunay (flip dei lati) */

/** Test in-circle: d cade dentro il cerchio circoscritto ad (a,b,c) (a,b,c CCW)? */
function inCircle(a, b, c, d) {
  const adx = a[0] - d[0];
  const ady = a[1] - d[1];
  const bdx = b[0] - d[0];
  const bdy = b[1] - d[1];
  const cdx = c[0] - d[0];
  const cdy = c[1] - d[1];
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return (
    adx * (bdy * cd - bd * cdy) -
    ady * (bdx * cd - bd * cdx) +
    ad * (bdx * cdy - bdy * cdx) >
    1e-14
  );
}

const edgeKey = (i, j) => (i < j ? i + '|' + j : j + '|' + i);

/**
 * Trasforma una triangolazione in (quasi) Delaunay vincolata scambiando i lati
 * interni non localmente Delaunay. Elimina gli "sliver" prodotti dall'ear
 * clipping, che in 3D taglierebbero attraverso la superficie.
 */
function delaunayFlips(points, tris, constrained, maxPasses = 12) {
  const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let pass = 0; pass < maxPasses; pass++) {
    // mappa lato -> triangoli adiacenti
    const map = new Map();
    tris.forEach((t, ti) => {
      for (let k = 0; k < 3; k++) {
        const key = edgeKey(t[k], t[(k + 1) % 3]);
        let list = map.get(key);
        if (!list) map.set(key, (list = []));
        list.push(ti);
      }
    });
    let flips = 0;
    const touched = new Set();
    for (const [key, list] of map) {
      if (list.length !== 2 || constrained.has(key)) continue;
      const [t1, t2] = list;
      if (touched.has(t1) || touched.has(t2)) continue;
      const [i, j] = key.split('|').map(Number);
      const opp = (t) => t.find((v) => v !== i && v !== j);
      const a = opp(tris[t1]);
      const b = opp(tris[t2]);
      if (a === undefined || b === undefined || a === b) continue;
      const P = points;
      // il quadrilatero (i, a, j, b) deve essere convesso
      const s1 = area2(P[i], P[a], P[j]);
      const s2 = area2(P[j], P[b], P[i]);
      if (s1 <= 0 || s2 <= 0) continue;
      const c1 = area2(P[a], P[j], P[b]);
      const c2 = area2(P[b], P[i], P[a]);
      if (c1 <= 0 || c2 <= 0) continue;
      // lato non localmente Delaunay -> scambia
      if (inCircle(P[i], P[a], P[j], P[b]) || inCircle(P[j], P[b], P[i], P[a])) {
        tris[t1] = [a, j, b];
        tris[t2] = [b, i, a];
        touched.add(t1);
        touched.add(t2);
        flips++;
      }
    }
    if (!flips) break;
  }
  return tris;
}

/**
 * Scostamento massimo dalla superficie sui lati di un triangolo UV:
 * misura di quanto la tassellazione corrente "taglia" la curvatura.
 */
function triangleSag(surf, tri) {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    const uv = [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2];
    const ps = surf.eval(uv[0], uv[1]);
    const chord = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    worst = Math.max(worst, dist(ps, chord));
  }
  return worst;
}

/** Segmenti di bordo comuni a due vertici (per tenere i lati sulle corde). */
function sharedSegment(a, b) {
  if (!a.segs || !b.segs) return null;
  for (const s of a.segs) if (b.segs.includes(s)) return s;
  return null;
}

/**
 * Suddivisione uniforme (1 -> 4) di un triangolo UV, ripetuta `level` volte.
 * I lati che appartengono a un segmento di bordo restano sulla corda campionata
 * dalla curva: cosi' le facce adiacenti combaciano e non si aprono fessure.
 */
function subdivideUniform(surf, tri, level, out) {
  if (level <= 0) {
    out.push(tri);
    return;
  }
  const mid = (a, b) => {
    const uv = [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2];
    const seg = sharedSegment(a, b);
    if (seg !== null) {
      // punto sulla corda del bordo: identico per la faccia adiacente
      return {
        uv,
        p: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2],
        segs: [seg],
      };
    }
    return { uv, p: surf.eval(uv[0], uv[1]), segs: null };
  };
  const [A, B, C] = tri;
  const AB = mid(A, B);
  const BC = mid(B, C);
  const CA = mid(C, A);
  subdivideUniform(surf, [A, AB, CA], level - 1, out);
  subdivideUniform(surf, [AB, B, BC], level - 1, out);
  subdivideUniform(surf, [CA, BC, C], level - 1, out);
  subdivideUniform(surf, [AB, BC, CA], level - 1, out);
}

/* ------------------------------------------------------- mesh di una faccia */

/** Accumulatore di vertici/triangoli, con l'id della faccia STEP di origine. */
class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.faceIds = []; // id entita' STEP per triangolo
  }

  vertex(p, n) {
    const i = this.positions.length / 3;
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    return i;
  }

  triangle(a, b, c, faceId) {
    this.indices.push(a, b, c);
    this.faceIds.push(faceId);
  }
}

function surfaceNormalAt(surf, u, v, flip) {
  let n = surf.normal ? surf.normal(u, v) : [0, 0, 1];
  if (!n || len(n) < 1e-9) n = [0, 0, 1];
  return flip ? [-n[0], -n[1], -n[2]] : n;
}

/**
 * Allinea il verso dei triangoli (da `startTri` in poi) alle normali dei
 * vertici e scarta i triangoli di area nulla.
 */
function normalizeWinding(mesh, startTri) {
  const P = mesh.positions;
  const N = mesh.normals;
  const keepIdx = [];
  const keepFace = [];
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3];
    const ib = mesh.indices[t * 3 + 1];
    const ic = mesh.indices[t * 3 + 2];
    if (t < startTri) {
      keepIdx.push(ia, ib, ic);
      keepFace.push(mesh.faceIds[t]);
      continue;
    }
    const i0 = ia * 3;
    const i1 = ib * 3;
    const i2 = ic * 3;
    const a = [P[i0], P[i0 + 1], P[i0 + 2]];
    const b = [P[i1], P[i1 + 1], P[i1 + 2]];
    const c = [P[i2], P[i2 + 1], P[i2 + 2]];
    const gn = cross(sub(b, a), sub(c, a));
    if (len(gn) < 1e-14) continue; // triangolo degenere
    const vn = [
      (N[i0] + N[i1] + N[i2]) / 3,
      (N[i0 + 1] + N[i1 + 1] + N[i2 + 1]) / 3,
      (N[i0 + 2] + N[i1 + 2] + N[i2 + 2]) / 3,
    ];
    if (dot(gn, vn) < 0) keepIdx.push(ia, ic, ib);
    else keepIdx.push(ia, ib, ic);
    keepFace.push(mesh.faceIds[t]);
  }
  mesh.indices = keepIdx;
  mesh.faceIds = keepFace;
}

/**
 * Banda tra due anelli chiusi (cilindro, cono, estrusione): cuce direttamente
 * i punti campionati dai due bordi, cosi' la mesh combacia con le facce
 * adiacenti. Restituisce false se la faccia non ha questa forma.
 */
function tessellateLoft(surf, rings, tol, flip, mesh, faceId, livello = 0, apici = []) {
  const rigato = ['CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SURFACE_OF_LINEAR_EXTRUSION', 'SURFACE_OF_REVOLUTION'].includes(surf.type);
  if (!rigato) return false;
  // cono a punta: ventaglio dal contorno all'apice (i punti del bordo restano
  // quelli campionati dalla curva, cosi' la base combacia)
  if (rings.length === 1 && apici.length === 1) {
    const pts = rings[0].points;
    const apice = apici[0];
    const uvA = surf.project(apice);
    const iApice = mesh.vertex(apice, surfaceNormalAt(surf, uvA[0], uvA[1], flip));
    const idx = pts.map((p) => {
      const uv = surf.project(p);
      return mesh.vertex(p, surfaceNormalAt(surf, uv[0], uv[1], flip));
    });
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i];
      const b = idx[(i + 1) % idx.length];
      if (flip) mesh.triangle(a, iApice, b, faceId);
      else mesh.triangle(a, b, iApice, faceId);
    }
    return true;
  }
  if (rings.length !== 2) return false;
  // densifica i bordi con gli stessi punti di mezzo delle facce suddivise:
  // le facce adiacenti devono avere vertici coincidenti
  const densifica = (punti) => {
    let out = punti;
    for (let l = 0; l < livello; l++) {
      const next = [];
      for (let i = 0; i < out.length; i++) {
        const a = out[i];
        const b = out[(i + 1) % out.length];
        next.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      }
      out = next;
    }
    return out;
  };
  const anelli = rings.map((r0) => {
    const r = { ...r0, points: densifica(r0.points) };
    const uv = r.points.map((p) => surf.project(p));
    // srotola u per avere una sequenza monotona sul periodo
    const period = surf.uPeriod;
    if (period) {
      let wrap = 0;
      for (let i = 1; i < uv.length; i++) {
        let d = uv[i][0] + wrap - uv[i - 1][0];
        while (d > period / 2) { wrap -= period; d -= period; }
        while (d < -period / 2) { wrap += period; d += period; }
        uv[i][0] += wrap;
      }
    }
    const punti = r.points.map((p, i) => ({ p, u: uv[i][0], v: uv[i][1] }));
    // orientamento crescente in u
    if (punti.length > 1 && punti[punti.length - 1].u < punti[0].u) punti.reverse();
    return punti;
  });
  let [A, B] = anelli;
  if (A[0].v > B[0].v) [A, B] = [B, A];
  const period = surf.uPeriod || 0;
  // allinea l'inizio di B al primo u di A
  const ruota = (ring, uRif) => {
    let best = 0;
    let bd = Infinity;
    ring.forEach((pt, i) => {
      let d = Math.abs(((pt.u - uRif) % period + period * 1.5) % period - period * 0.5);
      if (!period) d = Math.abs(pt.u - uRif);
      if (d < bd) { bd = d; best = i; }
    });
    return ring.slice(best).concat(ring.slice(0, best));
  };
  if (period) {
    B = ruota(B, A[0].u);
    // dopo la rotazione i parametri u vanno risistemati crescenti,
    // altrimenti la cucitura si attorciglia
    for (let k = 1; k < B.length; k++) {
      while (B[k].u < B[k - 1].u) B[k].u += period;
    }
    while (B[0].u > A[0].u + period / 2) B.forEach((pt) => { pt.u -= period; });
    while (B[0].u < A[0].u - period / 2) B.forEach((pt) => { pt.u += period; });
  }

  const vert = (pt) => mesh.vertex(pt.p, surfaceNormalAt(surf, pt.u, pt.v, flip));
  const idxA = A.map(vert);
  const idxB = B.map(vert);
  // chiudi gli anelli
  idxA.push(idxA[0]);
  idxB.push(idxB[0]);
  const uA = A.map((p) => p.u).concat([A[0].u + (period || 0)]);
  const uB = B.map((p) => p.u).concat([B[0].u + (period || 0)]);
  let i = 0;
  let j = 0;
  let guard = 0;
  while ((i < idxA.length - 1 || j < idxB.length - 1) && guard++ < 100000) {
    const avanzaA = j >= idxB.length - 1 || (i < idxA.length - 1 && uA[i + 1] - uA[0] <= uB[j + 1] - uB[0]);
    if (avanzaA) {
      if (flip) mesh.triangle(idxA[i], idxB[j], idxA[i + 1], faceId);
      else mesh.triangle(idxA[i], idxA[i + 1], idxB[j], faceId);
      i++;
    } else {
      if (flip) mesh.triangle(idxA[i], idxB[j + 1], idxB[j], faceId);
      else mesh.triangle(idxA[i], idxB[j], idxB[j + 1], faceId);
      j++;
    }
  }
  return true;
}

/**
 * Intervallo [v0, v1] della banda di una faccia periodica in u.
 * - due anelli: il secondo viene srotolato dal lato indicato dall'orientamento
 *   del primo (l'interno della faccia sta a sinistra del contorno);
 * - un anello: fino all'apice (cono, polo) oppure al bordo naturale della
 *   superficie dal lato dell'interno (emisfero);
 * - nessun anello: tutto il dominio (sfera o toro a una faccia con cuciture).
 */
function intervalloV(surf, anelli, apici, flip) {
  const [vMin, vMax] = surf.vRange;
  const periodo = surf.vPeriod;
  const finito = (x) => Number.isFinite(x) && Math.abs(x) < 1e5;
  const info = anelli.map((uv) => {
    let netU = 0;
    let vSum = 0;
    for (let i = 1; i < uv.length; i++) netU += uv[i][0] - uv[i - 1][0];
    for (const p of uv) vSum += p[1];
    return { netU, v: vSum / uv.length };
  });
  const apiciV = apici.map((p) => surf.project(p)[1]);
  if (!info.length) {
    if (periodo) return [0, periodo];
    return [finito(vMin) ? vMin : Math.min(...apiciV, 0), finito(vMax) ? vMax : Math.max(...apiciV, 1)];
  }
  const A = info[0];
  // interno verso +v se il contorno gira nel verso +u con la normale della faccia uscente
  const versoAlto = (A.netU > 0) === !flip;
  if (info.length === 1) {
    if (apiciV.length) {
      const va = apiciV[0];
      return [Math.min(A.v, va), Math.max(A.v, va)];
    }
    if (periodo) return versoAlto ? [A.v, A.v + periodo] : [A.v - periodo, A.v];
    if (versoAlto) return [A.v, finito(vMax) ? vMax : A.v + 1];
    return [finito(vMin) ? vMin : A.v - 1, A.v];
  }
  let vB = info[1].v;
  if (periodo) {
    const mod = (x) => ((x % periodo) + periodo) % periodo;
    vB = versoAlto ? A.v + (mod(vB - A.v) || periodo) : A.v - (mod(A.v - vB) || periodo);
  }
  let lo = Math.min(A.v, vB);
  let hi = Math.max(A.v, vB);
  for (const v of info.slice(2).map((x) => x.v)) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** Tassella una faccia periodica con una griglia sul periodo e sull'intervallo v scelto. */
function tessellateBand(surf, anelli, apici, tol, flip, mesh, faceId) {
  const uPeriod = surf.uPeriod;
  const [v0, vFine] = intervalloV(surf, anelli, apici, flip);
  const v1 = vFine > v0 ? vFine : v0 + 1e-6;
  const u0 = 0;
  const u1 = uPeriod || 1;
  // numero di suddivisioni dalla tolleranza
  const probe = (n, along) => {
    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const pa = along(t0);
      const pb = along(t1);
      const pm = along((t0 + t1) / 2);
      const chord = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      maxErr = Math.max(maxErr, dist(chord, pm));
    }
    return maxErr;
  };
  let nu = 8;
  while (nu < 256 && probe(nu, (t) => surf.eval(u0 + (u1 - u0) * t, (v0 + v1) / 2)) > tol) nu *= 2;
  let nv = 2;
  while (nv < 128 && probe(nv, (t) => surf.eval((u0 + u1) / 2, v0 + (v1 - v0) * t)) > tol) nv *= 2;

  const grid = [];
  for (let i = 0; i <= nu; i++) {
    const u = u0 + ((u1 - u0) * i) / nu;
    const row = [];
    for (let j = 0; j <= nv; j++) {
      const v = v0 + ((v1 - v0) * j) / nv;
      row.push(mesh.vertex(surf.eval(u, v), surfaceNormalAt(surf, u, v, flip)));
    }
    grid.push(row);
  }
  let count = 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      if (flip) {
        mesh.triangle(a, c, b, faceId);
        mesh.triangle(a, d, c, faceId);
      } else {
        mesh.triangle(a, b, c, faceId);
        mesh.triangle(a, c, d, faceId);
      }
      count += 2;
    }
  }
  return count;
}

/**
 * Tassella una singola faccia aggiungendo i triangoli a `mesh`.
 * @returns {{triangles:number, area:number, surfaceType:string, problems:string[]}}
 */
export function tessellateFace(file, faceEnt, mesh, opts = {}) {
  const tol = opts.tolerance ?? 0.05;
  const params = faceEnt.partParams('ADVANCED_FACE') || faceEnt.partParams('FACE_SURFACE') || faceEnt.params;
  const surfRef = params[2];
  const sameSense = (params[3] && params[3].enum ? params[3].enum === 'T' : true) !== !!opts.flip;
  let surf = buildSurface(file, surfRef);
  const problems = [];
  if (!surf) {
    const se = file.get(surfRef);
    problems.push(`#${faceEnt.id}: superficie ${se ? se.types.join('+') : '?'} non supportata`);
    return { triangles: 0, area: 0, surfaceType: se ? se.types[0] : 'SCONOSCIUTA', problems };
  }
  const flip = !sameSense;
  // lavora in uno spazio parametrico ~isometrico: la triangolazione 2D e'
  // affidabile solo se u e v hanno scale comparabili alle lunghezze reali
  if (!surf.isPlanar) {
    const [su, sv] = metricScales(surf);
    surf = scaledSurface(surf, su, sv);
  }

  const { rings, apici, problems: ringProblems } = faceRings(file, faceEnt, tol);
  appendAll(problems, ringProblems);
  const periodica = surf.uPeriod !== null || surf.vPeriod !== null;
  if (!rings.length && !(periodica && (apici.length || surf.type === 'SPHERICAL_SURFACE' || surf.type === 'TOROIDAL_SURFACE'))) {
    problems.push(`#${faceEnt.id}: nessun contorno utilizzabile`);
    return { triangles: 0, area: 0, surfaceType: surf.type, problems };
  }

  // proiezione + rilevamento cuciture
  const projected = rings.map((r) => ({ ...r, ...unwrapRing(surf, r.points, tol) }));
  const wrapsU = surf.uPeriod && projected.some((r) => Math.abs(r.netU) > surf.uPeriod * 0.5);
  const wrapsV = surf.vPeriod && projected.some((r) => Math.abs(r.netV) > surf.vPeriod * 0.5);
  // faccia periodica intera: nessun anello (cuciture), un solo anello con apice
  // o un anello che gira sul periodo
  const banda = wrapsU || wrapsV || (periodica && (!rings.length || (rings.length === 1 && apici.length)));

  const startTri = mesh.indices.length / 3;
  let livelloUsato = 0;

  if (banda) {
    livelloUsato = opts.livelloForzato ?? 0;
    if (!tessellateLoft(surf, rings, tol, flip, mesh, faceEnt.id, livelloUsato, apici)) {
      tessellateBand(surf, projected.map((r) => r.uv), apici, tol, flip, mesh, faceEnt.id);
    }
  } else {
    // scegli il contorno esterno (area UV massima)
    let outerIdx = projected.findIndex((r) => r.isOuter);
    if (outerIdx < 0) {
      let best = -1;
      let bestA = -1;
      projected.forEach((r, i) => {
        const a = Math.abs(ringArea(r.uv));
        if (a > bestA) {
          bestA = a;
          best = i;
        }
      });
      outerIdx = best;
    }
    const outer = projected[outerIdx];
    const holes = projected.filter((_, i) => i !== outerIdx);
    const outerUV = outer.uv.slice();
    if (ringArea(outerUV) < 0) outerUV.reverse();
    const holeUVs = holes.map((h) => {
      const uv = h.uv.slice();
      if (ringArea(uv) > 0) uv.reverse();
      return uv;
    });
    const ring = holeUVs.length ? bridgeHoles(outerUV, holeUVs) : outerUV;
    const tris = earClip(ring);
    // i lati del contorno sono vincolati, gli altri si possono scambiare
    const constrained = new Set();
    for (let i = 0; i < ring.length; i++) constrained.add(edgeKey(i, (i + 1) % ring.length));
    delaunayFlips(ring, tris, constrained);
    const isPlanar = !!surf.isPlanar;
    // ogni vertice del contorno appartiene ai due segmenti di bordo adiacenti
    const nRing = ring.length;
    const verts = ring.map((uv, i) => ({
      uv,
      // sul contorno si usa il punto campionato dalla curva, non la
      // valutazione della superficie: identico per le facce adiacenti
      p: uv.p3 || surf.eval(uv[0], uv[1]),
      segs: [(i - 1 + nRing) % nRing, i],
    }));
    const cache = new Map();
    const emit = (vert) => {
      const key = vert.uv[0] + '|' + vert.uv[1];
      let id = cache.get(key);
      if (id === undefined) {
        id = mesh.vertex(vert.p, surfaceNormalAt(surf, vert.uv[0], vert.uv[1], flip));
        cache.set(key, id);
      }
      return id;
    };
    // livello di suddivisione dal massimo scostamento (l'errore scala ~ h^2)
    let level = 0;
    // il livello forzato vale anche per le facce piane: le facce adiacenti
    // devono suddividere lo spigolo comune lo stesso numero di volte,
    // altrimenti restano fessure (T-junction) tra le facce
    if (opts.livelloForzato != null) {
      level = opts.livelloForzato;
    } else if (!isPlanar) {
      let sag = 0;
      for (const [i0, i1, i2] of tris) {
        sag = Math.max(sag, triangleSag(surf, [verts[i0], verts[i1], verts[i2]]));
      }
      if (sag > tol) level = Math.ceil(Math.log2(sag / tol) / 2);
      const maxLevel = opts.maxDepth ?? 3;
      level = Math.min(level, maxLevel);
      // tetto ai triangoli per faccia
      const budget = opts.maxTrianglesPerFace ?? 60000;
      while (level > 0 && tris.length * 4 ** level > budget) level--;
    }
    livelloUsato = level;
    for (const [i0, i1, i2] of tris) {
      const parts = [];
      subdivideUniform(surf, [verts[i0], verts[i1], verts[i2]], level, parts);
      for (const t of parts) {
        const a = emit(t[0]);
        const b = emit(t[1]);
        const c = emit(t[2]);
        if (flip) mesh.triangle(a, c, b, faceEnt.id);
        else mesh.triangle(a, b, c, faceEnt.id);
      }
    }
  }

  // Coerenza: il verso dei triangoli deve concordare con le normali analitiche
  // della superficie (che tengono conto di same_sense). Rimuove anche i
  // triangoli degeneri.
  normalizeWinding(mesh, startTri);

  // area dei triangoli generati
  let area = 0;
  for (let t = startTri; t < mesh.indices.length / 3; t++) {
    const i0 = mesh.indices[t * 3] * 3;
    const i1 = mesh.indices[t * 3 + 1] * 3;
    const i2 = mesh.indices[t * 3 + 2] * 3;
    const P = mesh.positions;
    const a = [P[i0], P[i0 + 1], P[i0 + 2]];
    const b = [P[i1], P[i1 + 1], P[i1 + 2]];
    const c = [P[i2], P[i2 + 1], P[i2 + 2]];
    area += len(cross(sub(b, a), sub(c, a))) / 2;
  }

  return {
    triangles: mesh.indices.length / 3 - startTri,
    area,
    surfaceType: surf.type,
    surfaceInfo: surf.info,
    livello: livelloUsato,
    problems,
  };
}

/**
 * Elenca le facce contenute in un item geometrico (solido, guscio, faccia):
 * [{ face, flip }], dove `flip` e' vero se un ORIENTED_*_SHELL con
 * orientamento .F. (o il guscio di un vuoto) ribalta la faccia.
 */
export function collectFaces(file, itemEnt, seen = new Set(), flip = false) {
  if (!itemEnt || seen.has(itemEnt.id)) return [];
  seen.add(itemEnt.id);
  const t = itemEnt.types;
  const out = [];
  const push = (refs, f = flip) => {
    for (const r of refs || []) {
      const e = file.get(r);
      if (e) appendAll(out, collectFaces(file, e, seen, f));
    }
  };
  if (FACE_TYPES.some((ft) => t.includes(ft))) {
    out.push({ face: itemEnt, flip });
    return out;
  }
  if (t.includes('MANIFOLD_SOLID_BREP') || t.includes('BREP_WITH_VOIDS') || t.includes('FACETED_BREP')) {
    const p = itemEnt.partParams('MANIFOLD_SOLID_BREP') || itemEnt.partParams('FACETED_BREP') || itemEnt.params;
    const outerShell = file.get(p[1]);
    if (outerShell) appendAll(out, collectFaces(file, outerShell, seen, flip));
    const voidsP = itemEnt.partParams('BREP_WITH_VOIDS');
    if (voidsP) {
      // BREP_WITH_VOIDS(name, outer, voids): i vuoti sono gusci orientati verso il vuoto
      const voids = Array.isArray(voidsP[2]) ? voidsP[2] : Array.isArray(voidsP[1]) ? voidsP[1] : [];
      push(voids);
    }
    return out;
  }
  if (t.includes('CLOSED_SHELL') || t.includes('OPEN_SHELL')) {
    const p = itemEnt.partParams('CLOSED_SHELL') || itemEnt.partParams('OPEN_SHELL') || itemEnt.params;
    push(p[1]);
    return out;
  }
  if (t.includes('ORIENTED_CLOSED_SHELL') || t.includes('ORIENTED_OPEN_SHELL')) {
    // ORIENTED_*_SHELL(name, cfs_faces*, shell, orientation)
    const p = itemEnt.params;
    const inner = file.get(p[2] ?? p[1]);
    const orient = p[3] && p[3].enum ? p[3].enum === 'T' : true;
    if (inner) appendAll(out, collectFaces(file, inner, seen, orient ? flip : !flip));
    return out;
  }
  if (t.includes('SHELL_BASED_SURFACE_MODEL')) {
    const p = itemEnt.partParams('SHELL_BASED_SURFACE_MODEL') || itemEnt.params;
    push(p[1]);
    return out;
  }
  if (t.includes('FACE_BASED_SURFACE_MODEL')) {
    const p = itemEnt.partParams('FACE_BASED_SURFACE_MODEL') || itemEnt.params;
    push(p[1]);
    return out;
  }
  if (t.includes('MANIFOLD_SURFACE_SHAPE_REPRESENTATION') || t.includes('SHAPE_REPRESENTATION')) {
    const p = itemEnt.partParams('SHAPE_REPRESENTATION') || itemEnt.params;
    push(p[1]);
    return out;
  }
  return out;
}

/** Vero se tutti i gusci dell'item sono dichiarati chiusi (solido o modello a gusci chiusi). */
export function gusciChiusi(file, itemEnt) {
  const t = itemEnt.types;
  if (t.includes('MANIFOLD_SOLID_BREP') || t.includes('BREP_WITH_VOIDS') || t.includes('FACETED_BREP') || t.includes('CLOSED_SHELL')) return true;
  if (t.includes('ORIENTED_CLOSED_SHELL')) return true;
  if (t.includes('SHELL_BASED_SURFACE_MODEL')) {
    const p = itemEnt.partParams('SHELL_BASED_SURFACE_MODEL') || itemEnt.params;
    const shells = file.getAll(p[1]);
    return shells.length > 0 && shells.every((sh) => sh.has('CLOSED_SHELL') || sh.has('ORIENTED_CLOSED_SHELL'));
  }
  return false;
}

/** Volume con segno della mesh (somma dei tetraedri) — chiuso => volume reale. */
export function meshVolume(positions, indices) {
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const bx = positions[i1];
    const by = positions[i1 + 1];
    const bz = positions[i1 + 2];
    const cx = positions[i2];
    const cy = positions[i2 + 1];
    const cz = positions[i2 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

/** Centroide approssimato (media pesata sulle aree dei triangoli). */
export function meshCentroid(positions, indices) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let wsum = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    const a = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
    const b = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
    const c = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
    const w = len(cross(sub(b, a), sub(c, a))) / 2;
    cx += ((a[0] + b[0] + c[0]) / 3) * w;
    cy += ((a[1] + b[1] + c[1]) / 3) * w;
    cz += ((a[2] + b[2] + c[2]) / 3) * w;
    wsum += w;
  }
  return wsum > 0 ? [cx / wsum, cy / wsum, cz / wsum] : [0, 0, 0];
}

export { MeshBuilder, FACE_TYPES };

/**
 * Conta i lati di triangolo non condivisi da due triangoli: se e' zero la
 * mesh e' a tenuta e area/volume sono affidabili.
 */
export function contaBordiAperti(positions, indices, tolleranza = 1e-4) {
  // 1) salda i vertici coincidenti: indice -> id saldato (una chiave per vertice)
  const nVert = positions.length / 3;
  const saldato = new Int32Array(nVert);
  const idPerChiave = new Map();
  let nextId = 0;
  const inv = 1 / tolleranza;
  for (let v = 0; v < nVert; v++) {
    const key =
      Math.round(positions[v * 3] * inv) + ',' +
      Math.round(positions[v * 3 + 1] * inv) + ',' +
      Math.round(positions[v * 3 + 2] * inv);
    let id = idPerChiave.get(key);
    if (id === undefined) {
      id = nextId++;
      idPerChiave.set(key, id);
    }
    saldato[v] = id;
  }
  // 2) conta i lati con chiave numerica (min * N + max)
  const N = nextId;
  const conta = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const a = saldato[indices[t]];
    const b = saldato[indices[t + 1]];
    const c = saldato[indices[t + 2]];
    const lati = [a, b, b, c, c, a];
    for (let k = 0; k < 6; k += 2) {
      const x = lati[k];
      const y = lati[k + 1];
      if (x === y) continue;
      const key = x < y ? x * N + y : y * N + x;
      conta.set(key, (conta.get(key) || 0) + 1);
    }
  }
  let aperti = 0;
  for (const c of conta.values()) if (c !== 2) aperti++;
  return { aperti, totali: conta.size };
}
