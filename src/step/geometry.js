/**
 * Valutazione della geometria STEP: punti, placement, curve e superfici.
 * Tutte le funzioni lavorano su array [x,y,z] e matrici 4x4 in ordine di colonna
 * (compatibili con WebGL).
 */

/* ------------------------------------------------------------------ vettori */

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function normalize(a) {
  const l = len(a);
  return l > 1e-300 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/* ------------------------------------------------------------------ matrici */

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function transformDir(m, d) {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/** Matrice da assi ortonormali + origine. */
export function fromAxes(x, y, z, o) {
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
}

/** Inversa di una matrice rigida (rotazione + traslazione). */
export function invertRigid(m) {
  // assi (colonne) della matrice diretta
  const X = [m[0], m[1], m[2]];
  const Y = [m[4], m[5], m[6]];
  const Z = [m[8], m[9], m[10]];
  const t = [m[12], m[13], m[14]];
  // l'inversa ha come colonne le righe di R e traslazione -R^T t
  return fromAxes(
    [X[0], Y[0], Z[0]],
    [X[1], Y[1], Z[1]],
    [X[2], Y[2], Z[2]],
    [-dot(X, t), -dot(Y, t), -dot(Z, t)],
  );
}

/* -------------------------------------------------- lettura entita' di base */

export function readPoint(file, ref) {
  const e = file.get(ref);
  if (!e) return null;
  const coords = e.partParams('CARTESIAN_POINT')?.[1] || e.params[1];
  if (!Array.isArray(coords)) return null;
  return [Number(coords[0]) || 0, Number(coords[1]) || 0, Number(coords[2]) || 0];
}

export function readDirection(file, ref) {
  const e = file.get(ref);
  if (!e) return null;
  const coords = e.partParams('DIRECTION')?.[1] || e.params[1];
  if (!Array.isArray(coords)) return null;
  return [Number(coords[0]) || 0, Number(coords[1]) || 0, Number(coords[2]) || 0];
}

export function readVector(file, ref) {
  const e = file.get(ref);
  if (!e) return null;
  if (e.has('VECTOR')) {
    const p = e.partParams('VECTOR');
    const dir = readDirection(file, p[1]) || [1, 0, 0];
    return scale(normalize(dir), Number(p[2]) || 0);
  }
  return readDirection(file, ref);
}

/**
 * AXIS2_PLACEMENT_3D -> matrice locale->globale.
 * Se gli assi sono assenti o degeneri applica i default ISO (Z=+z, X=+x).
 */
export function readPlacement(file, ref) {
  const e = file.get(ref);
  if (!e) return identity();
  const p = e.partParams('AXIS2_PLACEMENT_3D') || e.params;
  const origin = readPoint(file, p[1]) || [0, 0, 0];
  let z = readDirection(file, p[2]);
  let x = readDirection(file, p[3]);
  z = z && len(z) > 1e-12 ? normalize(z) : [0, 0, 1];
  if (!x || len(x) < 1e-12) {
    x = Math.abs(z[2]) < 0.9 ? cross([0, 0, 1], z) : cross([1, 0, 0], z);
  }
  // ortogonalizza x rispetto a z
  x = sub(x, scale(z, dot(x, z)));
  if (len(x) < 1e-12) x = Math.abs(z[0]) < 0.9 ? cross(z, [1, 0, 0]) : cross(z, [0, 1, 0]);
  x = normalize(x);
  const y = cross(z, x);
  return fromAxes(x, y, z, origin);
}

/* ------------------------------------------------------------------ B-spline */

function findSpan(n, degree, u, knots) {
  if (u >= knots[n + 1]) return n;
  if (u <= knots[degree]) return degree;
  let low = degree;
  let high = n + 1;
  let mid = (low + high) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = (low + high) >> 1;
  }
  return mid;
}

/** Base e derivate (fino a `nd`) dei B-spline in un punto. */
function basisDerivatives(span, u, degree, knots, nd) {
  const ndu = [];
  for (let i = 0; i <= degree; i++) ndu.push(new Array(degree + 1).fill(0));
  const left = new Array(degree + 1).fill(0);
  const right = new Array(degree + 1).fill(0);
  ndu[0][0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const temp = den === 0 ? 0 : ndu[r][j - 1] / den;
      ndu[r][j] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    ndu[j][j] = saved;
  }
  const ders = [];
  for (let k = 0; k <= nd; k++) ders.push(new Array(degree + 1).fill(0));
  for (let j = 0; j <= degree; j++) ders[0][j] = ndu[j][degree];
  if (nd === 0) return ders;
  // derivate (algoritmo A2.3, The NURBS Book)
  const a = [new Array(degree + 1).fill(0), new Array(degree + 1).fill(0)];
  for (let r = 0; r <= degree; r++) {
    let s1 = 0;
    let s2 = 1;
    a[0][0] = 1;
    for (let k = 1; k <= nd; k++) {
      let d = 0;
      const rk = r - k;
      const pk = degree - k;
      if (r >= k) {
        const den = knots[span + pk + 1] - knots[span + rk];
        a[s2][0] = den === 0 ? 0 : a[s1][0] / den;
        d = a[s2][0] * ndu[rk][pk];
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : degree - r;
      for (let j = j1; j <= j2; j++) {
        const den = knots[span + pk + 1 + j] - knots[span + rk + j];
        a[s2][j] = den === 0 ? 0 : (a[s1][j] - a[s1][j - 1]) / den;
        d += a[s2][j] * ndu[rk + j][pk];
      }
      if (r <= pk) {
        const den = knots[span + k + 1] - knots[span + 1];
        a[s2][k] = den === 0 ? 0 : -a[s1][k - 1] / den;
        d += a[s2][k] * ndu[r][pk];
      }
      ders[k][r] = d;
      const tmp = s1;
      s1 = s2;
      s2 = tmp;
    }
  }
  let acc = degree;
  for (let k = 1; k <= nd; k++) {
    for (let j = 0; j <= degree; j++) ders[k][j] *= acc;
    acc *= degree - k;
  }
  return ders;
}

/** Espande (multiplicita', valori) nel vettore dei nodi completo. */
function expandKnots(mults, values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const m = Math.round(Number(mults[i]) || 0);
    for (let k = 0; k < m; k++) out.push(Number(values[i]));
  }
  return out;
}

/* ------------------------------------------------------------------- curve */

/**
 * Costruisce un oggetto curva valutabile.
 * @returns {{type:string, eval:(t:number)=>number[], domain:[number,number],
 *            closed:boolean, deriv?:(t:number)=>number[], info:object}|null}
 */
export function buildCurve(file, ref) {
  const e = file.get(ref);
  if (!e) return null;
  const t = e.types;

  if (t.includes('LINE')) {
    const p = e.partParams('LINE');
    const pnt = readPoint(file, p[1]) || [0, 0, 0];
    const dir = readVector(file, p[2]) || [1, 0, 0];
    return {
      type: 'LINE',
      entity: e,
      domain: [0, 1],
      closed: false,
      info: { origine: pnt, direzione: normalize(dir), lunghezzaVettore: len(dir) },
      eval: (u) => add(pnt, scale(dir, u)),
      deriv: () => dir,
      invert: (pt) => {
        const d2 = dot(dir, dir);
        return d2 > 0 ? dot(sub(pt, pnt), dir) / d2 : 0;
      },
    };
  }

  if (t.includes('CIRCLE') || t.includes('ELLIPSE')) {
    const isCircle = t.includes('CIRCLE');
    const p = e.partParams(isCircle ? 'CIRCLE' : 'ELLIPSE');
    const m = readPlacement(file, p[1]);
    const r1 = Number(p[2]) || 0;
    const r2 = isCircle ? r1 : Number(p[3]) || 0;
    return {
      type: isCircle ? 'CIRCLE' : 'ELLIPSE',
      entity: e,
      domain: [0, 2 * Math.PI],
      closed: true,
      periodic: 2 * Math.PI,
      info: isCircle ? { raggio: r1, centro: [m[12], m[13], m[14]] } : { semiasse1: r1, semiasse2: r2, centro: [m[12], m[13], m[14]] },
      eval: (a) => transformPoint(m, [r1 * Math.cos(a), r2 * Math.sin(a), 0]),
      deriv: (a) => transformDir(m, [-r1 * Math.sin(a), r2 * Math.cos(a), 0]),
      invert: (pt) => {
        const inv = invertRigid(m);
        const l = transformPoint(inv, pt);
        let a = Math.atan2(l[1] / (r2 || 1), l[0] / (r1 || 1));
        if (a < 0) a += 2 * Math.PI;
        return a;
      },
    };
  }

  if (t.includes('B_SPLINE_CURVE_WITH_KNOTS') || t.includes('BEZIER_CURVE') || t.includes('B_SPLINE_CURVE')) {
    // record semplice: (name, degree, points, form, closed, self_intersect, mults, knots, spec)
    // record complesso: la parte B_SPLINE_CURVE ha (degree, points, ...) senza il nome,
    // la parte B_SPLINE_CURVE_WITH_KNOTS ha (mults, knots, spec)
    const complesso = !!e.complex && !!e.partParams('B_SPLINE_CURVE');
    const base = complesso ? e.partParams('B_SPLINE_CURVE') : e.partParams('B_SPLINE_CURVE_WITH_KNOTS') || e.params;
    const off = complesso ? 0 : 1;
    const degree = Math.round(Number(base[off]) || 1);
    const ctrlRefs = Array.isArray(base[off + 1]) ? base[off + 1] : [];
    const pts = ctrlRefs.map((r) => readPoint(file, r) || [0, 0, 0]);
    let knots;
    const knotPart = e.partParams('B_SPLINE_CURVE_WITH_KNOTS');
    if (knotPart) {
      const ko = complesso ? 0 : 6;
      knots = expandKnots(knotPart[ko] || [], knotPart[ko + 1] || []);
    } else {
      // uniforme/quasi-uniforme: costruisci nodi clamped
      const n = pts.length - 1;
      knots = [];
      for (let i = 0; i <= degree; i++) knots.push(0);
      for (let i = 1; i <= n - degree; i++) knots.push(i / (n - degree + 1));
      for (let i = 0; i <= degree; i++) knots.push(1);
    }
    let weights = null;
    const ratPart = e.partParams('RATIONAL_B_SPLINE_CURVE');
    if (ratPart) weights = (ratPart[0] || []).map(Number);
    const n = pts.length - 1;
    const domain = [knots[degree], knots[n + 1]];
    const evalAt = (u, nd) => {
      const uu = Math.min(Math.max(u, domain[0]), domain[1]);
      const span = findSpan(n, degree, uu, knots);
      const ders = basisDerivatives(span, uu, degree, knots, nd);
      const res = [];
      for (let k = 0; k <= nd; k++) {
        let x = 0;
        let y = 0;
        let z = 0;
        let w = 0;
        for (let j = 0; j <= degree; j++) {
          const idx = span - degree + j;
          const cp = pts[idx] || [0, 0, 0];
          const wj = weights ? weights[idx] ?? 1 : 1;
          const b = ders[k][j] * wj;
          x += b * cp[0];
          y += b * cp[1];
          z += b * cp[2];
          w += ders[k][j] * wj;
        }
        res.push({ p: [x, y, z], w });
      }
      return res;
    };
    const curve = {
      type: t.includes('RATIONAL_B_SPLINE_CURVE') ? 'RATIONAL_B_SPLINE_CURVE' : 'B_SPLINE_CURVE_WITH_KNOTS',
      entity: e,
      domain,
      closed: dist(pts[0], pts[n]) < 1e-9,
      info: {
        grado: degree,
        puntiControllo: pts.length,
        nodi: knots.length,
        razionale: !!weights,
        dominio: domain,
      },
      knotValues: (knotPart ? knotPart[complesso ? 1 : 7] || [] : []).map(Number),
      eval: (u) => {
        const r = evalAt(u, 0)[0];
        return weights && Math.abs(r.w) > 1e-300 ? scale(r.p, 1 / r.w) : r.p;
      },
      deriv: (u) => {
        const r = evalAt(u, 1);
        if (!weights) return r[1].p;
        const w0 = r[0].w || 1;
        const p0 = scale(r[0].p, 1 / w0);
        return scale(sub(r[1].p, scale(p0, r[1].w)), 1 / w0);
      },
    };
    curve.invert = (pt) => closestParam(curve, pt);
    return curve;
  }

  if (t.includes('POLYLINE')) {
    const p = e.partParams('POLYLINE');
    const pts = (p[1] || []).map((r) => readPoint(file, r) || [0, 0, 0]);
    return {
      type: 'POLYLINE',
      entity: e,
      domain: [0, Math.max(1, pts.length - 1)],
      closed: pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9,
      info: { punti: pts.length },
      eval: (u) => {
        const i = Math.min(pts.length - 2, Math.max(0, Math.floor(u)));
        const f = u - i;
        return add(scale(pts[i], 1 - f), scale(pts[i + 1] || pts[i], f));
      },
      deriv: (u) => {
        const i = Math.min(pts.length - 2, Math.max(0, Math.floor(u)));
        return sub(pts[i + 1] || pts[i], pts[i]);
      },
      invert: (pt) => {
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = dist(pts[i], pt);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        return best;
      },
    };
  }

  if (t.includes('TRIMMED_CURVE')) {
    const p = e.partParams('TRIMMED_CURVE');
    const basis = buildCurve(file, p[1]);
    if (!basis) return null;
    // i parametri numerici di taglio su cerchi ed ellissi sono angoli: nell'unita' del file
    const scalaAngolo = basis.periodic ? file.angoloInRad || 1 : 1;
    const readTrim = (list, fallback) => {
      if (!Array.isArray(list)) return fallback;
      for (const v of list) {
        if (typeof v === 'number') return v * scalaAngolo;
        if (v && typeof v === 'object' && 'typed' in v && typeof v.value === 'number') return v.value * scalaAngolo;
        if (v && typeof v === 'object' && 'ref' in v) {
          const pt = readPoint(file, v);
          if (pt && basis.invert) return basis.invert(pt);
        }
      }
      return fallback;
    };
    let t1 = readTrim(p[2], basis.domain[0]);
    let t2 = readTrim(p[3], basis.domain[1]);
    const senseAgreement = p[4] && p[4].enum ? p[4].enum === 'T' : true;
    if (!senseAgreement) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (basis.periodic && t2 <= t1) t2 += basis.periodic;
    return {
      ...basis,
      type: 'TRIMMED_CURVE(' + basis.type + ')',
      entity: e,
      domain: [t1, t2],
      closed: false,
      info: { ...basis.info, taglio: [t1, t2] },
    };
  }

  if (t.includes('COMPOSITE_CURVE')) {
    const p = e.partParams('COMPOSITE_CURVE');
    const segs = (p[1] || [])
      .map((r) => {
        const seg = file.get(r);
        if (!seg) return null;
        const sp = seg.partParams('COMPOSITE_CURVE_SEGMENT') || seg.params;
        const c = buildCurve(file, sp[2]);
        if (!c) return null;
        const sameSense = sp[1] && sp[1].enum ? sp[1].enum === 'T' : true;
        return { curve: c, sameSense };
      })
      .filter(Boolean);
    if (!segs.length) return null;
    return {
      type: 'COMPOSITE_CURVE',
      entity: e,
      domain: [0, segs.length],
      closed: false,
      info: { segmenti: segs.length },
      eval: (u) => {
        const i = Math.min(segs.length - 1, Math.max(0, Math.floor(u)));
        const f = u - i;
        const s = segs[i];
        const [a, b] = s.curve.domain;
        const tt = s.sameSense ? a + (b - a) * f : b - (b - a) * f;
        return s.curve.eval(tt);
      },
      invert: null,
    };
  }

  if (t.includes('SURFACE_CURVE') || t.includes('SEAM_CURVE') || t.includes('INTERSECTION_CURVE')) {
    // usa la rappresentazione 3D (curve_3d), primo parametro
    const p = e.partParams('SURFACE_CURVE') || e.partParams('SEAM_CURVE') || e.partParams('INTERSECTION_CURVE');
    const basis = buildCurve(file, p[1]);
    if (basis) return { ...basis, type: basis.type, entity: e };
    return null;
  }

  return null;
}

/** Parametro della curva piu' vicino a `pt` (campionamento + raffinamento). */
export function closestParam(curve, pt, samples = 64) {
  if (curve.invert && curve.type !== 'B_SPLINE_CURVE_WITH_KNOTS' && curve.type !== 'RATIONAL_B_SPLINE_CURVE') {
    return curve.invert(pt);
  }
  const [a, b] = curve.domain;
  let best = a;
  let bd = Infinity;
  for (let i = 0; i <= samples; i++) {
    const u = a + ((b - a) * i) / samples;
    const d = dist(curve.eval(u), pt);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  let step = (b - a) / samples;
  for (let iter = 0; iter < 40 && step > 1e-12; iter++) {
    let improved = false;
    for (const s of [-step, step]) {
      const u = Math.min(b, Math.max(a, best + s));
      const d = dist(curve.eval(u), pt);
      if (d < bd) {
        bd = d;
        best = u;
        improved = true;
      }
    }
    if (!improved) step *= 0.5;
  }
  return best;
}

/* --------------------------------------------------------------- superfici */

/**
 * Costruisce una superficie valutabile.
 * @returns {{type:string, eval:(u:number,v:number)=>number[],
 *            normal:(u:number,v:number)=>number[],
 *            uPeriod:number|null, vPeriod:number|null,
 *            uRange:[number,number], vRange:[number,number],
 *            project:(p:number[])=>[number,number], info:object}|null}
 */
export function buildSurface(file, ref) {
  const e = file.get(ref);
  if (!e) return null;
  const t = e.types;
  const TWO_PI = 2 * Math.PI;

  const withNormal = (s) => {
    if (!s.normal) {
      s.normal = (u, v) => {
        const h = 1e-6;
        const du = sub(s.eval(u + h, v), s.eval(u - h, v));
        const dv = sub(s.eval(u, v + h), s.eval(u, v - h));
        return normalize(cross(du, dv));
      };
    }
    s.entity = e;
    return s;
  };

  if (t.includes('PLANE')) {
    const p = e.partParams('PLANE');
    const m = readPlacement(file, p[1]);
    const inv = invertRigid(m);
    const n = normalize([m[8], m[9], m[10]]);
    return withNormal({
      type: 'PLANE',
      uPeriod: null,
      vPeriod: null,
      uRange: [-1e6, 1e6],
      vRange: [-1e6, 1e6],
      isPlanar: true,
      info: { origine: [m[12], m[13], m[14]], normale: n },
      eval: (u, v) => transformPoint(m, [u, v, 0]),
      normal: () => n,
      project: (pt) => {
        const l = transformPoint(inv, pt);
        return [l[0], l[1]];
      },
    });
  }

  if (t.includes('CYLINDRICAL_SURFACE')) {
    const p = e.partParams('CYLINDRICAL_SURFACE');
    const m = readPlacement(file, p[1]);
    const inv = invertRigid(m);
    const r = Number(p[2]) || 0;
    return withNormal({
      type: 'CYLINDRICAL_SURFACE',
      uPeriod: TWO_PI,
      vPeriod: null,
      uRange: [0, TWO_PI],
      vRange: [-1e6, 1e6],
      info: { raggio: r, asse: normalize([m[8], m[9], m[10]]), origine: [m[12], m[13], m[14]] },
      eval: (u, v) => transformPoint(m, [r * Math.cos(u), r * Math.sin(u), v]),
      normal: (u) => transformDir(m, [Math.cos(u), Math.sin(u), 0]),
      project: (pt) => {
        const l = transformPoint(inv, pt);
        let a = Math.atan2(l[1], l[0]);
        if (a < 0) a += TWO_PI;
        return [a, l[2]];
      },
    });
  }

  if (t.includes('CONICAL_SURFACE')) {
    const p = e.partParams('CONICAL_SURFACE');
    const m = readPlacement(file, p[1]);
    const inv = invertRigid(m);
    const r = Number(p[2]) || 0;
    const ang = (Number(p[3]) || 0) * (file.angoloInRad || 1);
    const tan = Math.tan(ang);
    return withNormal({
      type: 'CONICAL_SURFACE',
      uPeriod: TWO_PI,
      vPeriod: null,
      uRange: [0, TWO_PI],
      vRange: [-1e6, 1e6],
      info: { raggio: r, semiangolo: ang, asse: normalize([m[8], m[9], m[10]]) },
      eval: (u, v) => {
        const rr = r + v * tan;
        return transformPoint(m, [rr * Math.cos(u), rr * Math.sin(u), v]);
      },
      project: (pt) => {
        const l = transformPoint(inv, pt);
        let a = Math.atan2(l[1], l[0]);
        if (a < 0) a += TWO_PI;
        return [a, l[2]];
      },
    });
  }

  if (t.includes('SPHERICAL_SURFACE')) {
    const p = e.partParams('SPHERICAL_SURFACE');
    const m = readPlacement(file, p[1]);
    const inv = invertRigid(m);
    const r = Number(p[2]) || 0;
    return withNormal({
      type: 'SPHERICAL_SURFACE',
      uPeriod: TWO_PI,
      vPeriod: null,
      uRange: [0, TWO_PI],
      vRange: [-Math.PI / 2, Math.PI / 2],
      info: { raggio: r, centro: [m[12], m[13], m[14]] },
      eval: (u, v) => transformPoint(m, [r * Math.cos(v) * Math.cos(u), r * Math.cos(v) * Math.sin(u), r * Math.sin(v)]),
      normal: (u, v) => transformDir(m, [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)]),
      project: (pt) => {
        const l = transformPoint(inv, pt);
        let a = Math.atan2(l[1], l[0]);
        if (a < 0) a += TWO_PI;
        const rr = Math.hypot(l[0], l[1]);
        return [a, Math.atan2(l[2], rr)];
      },
    });
  }

  if (t.includes('TOROIDAL_SURFACE') || t.includes('DEGENERATE_TOROIDAL_SURFACE')) {
    const p = e.partParams('TOROIDAL_SURFACE') || e.partParams('DEGENERATE_TOROIDAL_SURFACE');
    const m = readPlacement(file, p[1]);
    const inv = invertRigid(m);
    const R = Number(p[2]) || 0;
    const r = Number(p[3]) || 0;
    return withNormal({
      type: 'TOROIDAL_SURFACE',
      uPeriod: TWO_PI,
      vPeriod: TWO_PI,
      uRange: [0, TWO_PI],
      vRange: [0, TWO_PI],
      info: { raggioMaggiore: R, raggioMinore: r },
      eval: (u, v) => {
        const rr = R + r * Math.cos(v);
        return transformPoint(m, [rr * Math.cos(u), rr * Math.sin(u), r * Math.sin(v)]);
      },
      normal: (u, v) => transformDir(m, [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)]),
      project: (pt) => {
        const l = transformPoint(inv, pt);
        let a = Math.atan2(l[1], l[0]);
        if (a < 0) a += TWO_PI;
        const rr = Math.hypot(l[0], l[1]) - R;
        let b = Math.atan2(l[2], rr);
        if (b < 0) b += TWO_PI;
        return [a, b];
      },
    });
  }

  if (t.includes('B_SPLINE_SURFACE_WITH_KNOTS') || t.includes('BEZIER_SURFACE') || t.includes('B_SPLINE_SURFACE')) {
    // record complesso: B_SPLINE_SURFACE(u_deg, v_deg, grid, form, u_closed, v_closed, self_int)
    // e B_SPLINE_SURFACE_WITH_KNOTS(u_mults, v_mults, u_knots, v_knots, spec), senza il nome
    const complesso = !!e.complex && !!e.partParams('B_SPLINE_SURFACE');
    const base = complesso ? e.partParams('B_SPLINE_SURFACE') : e.partParams('B_SPLINE_SURFACE_WITH_KNOTS') || e.params;
    const off = complesso ? 0 : 1;
    const du = Math.round(Number(base[off]) || 1);
    const dv = Math.round(Number(base[off + 1]) || 1);
    const grid = Array.isArray(base[off + 2]) ? base[off + 2] : [];
    const pts = grid.map((row) => (Array.isArray(row) ? row : []).map((r) => readPoint(file, r) || [0, 0, 0]));
    const nu = pts.length - 1;
    const nv = (pts[0] ? pts[0].length : 1) - 1;
    let uKnots;
    let vKnots;
    const knotPart = e.partParams('B_SPLINE_SURFACE_WITH_KNOTS');
    if (knotPart) {
      const ko = complesso ? 0 : 8;
      uKnots = expandKnots(knotPart[ko] || [], knotPart[ko + 2] || []);
      vKnots = expandKnots(knotPart[ko + 1] || [], knotPart[ko + 3] || []);
    } else {
      const clamped = (n, d) => {
        const k = [];
        for (let i = 0; i <= d; i++) k.push(0);
        for (let i = 1; i <= n - d; i++) k.push(i / (n - d + 1));
        for (let i = 0; i <= d; i++) k.push(1);
        return k;
      };
      uKnots = clamped(nu, du);
      vKnots = clamped(nv, dv);
    }
    let weights = null;
    const ratPart = e.partParams('RATIONAL_B_SPLINE_SURFACE');
    if (ratPart) weights = (ratPart[0] || []).map((row) => (row || []).map(Number));
    const uRange = [uKnots[du], uKnots[nu + 1]];
    const vRange = [vKnots[dv], vKnots[nv + 1]];

    const evalPt = (u, v) => {
      const uu = Math.min(Math.max(u, uRange[0]), uRange[1]);
      const vv = Math.min(Math.max(v, vRange[0]), vRange[1]);
      const su = findSpan(nu, du, uu, uKnots);
      const sv = findSpan(nv, dv, vv, vKnots);
      const bu = basisDerivatives(su, uu, du, uKnots, 0)[0];
      const bv = basisDerivatives(sv, vv, dv, vKnots, 0)[0];
      let x = 0;
      let y = 0;
      let z = 0;
      let w = 0;
      for (let i = 0; i <= du; i++) {
        const iu = su - du + i;
        const row = pts[iu] || [];
        for (let j = 0; j <= dv; j++) {
          const iv = sv - dv + j;
          const cp = row[iv] || [0, 0, 0];
          const wij = weights ? weights[iu]?.[iv] ?? 1 : 1;
          const b = bu[i] * bv[j] * wij;
          x += b * cp[0];
          y += b * cp[1];
          z += b * cp[2];
          w += b;
        }
      }
      return weights && Math.abs(w) > 1e-300 ? [x / w, y / w, z / w] : [x, y, z];
    };

    const surf = withNormal({
      type: t.includes('RATIONAL_B_SPLINE_SURFACE') ? 'RATIONAL_B_SPLINE_SURFACE' : 'B_SPLINE_SURFACE_WITH_KNOTS',
      uPeriod: null,
      vPeriod: null,
      uRange,
      vRange,
      info: {
        gradoU: du,
        gradoV: dv,
        puntiControllo: (nu + 1) * (nv + 1),
        grigliaControllo: `${nu + 1} x ${nv + 1}`,
        razionale: !!weights,
        dominioU: uRange,
        dominioV: vRange,
      },
      eval: evalPt,
    });
    surf.project = (pt) => projectNumeric(surf, pt);
    return surf;
  }

  if (t.includes('SURFACE_OF_LINEAR_EXTRUSION')) {
    const p = e.partParams('SURFACE_OF_LINEAR_EXTRUSION');
    const curve = buildCurve(file, p[1]);
    const dir = readVector(file, p[2]) || [0, 0, 1];
    if (!curve) return null;
    const surf = withNormal({
      type: 'SURFACE_OF_LINEAR_EXTRUSION',
      uPeriod: curve.periodic || null,
      vPeriod: null,
      uRange: curve.type === 'LINE' ? [-1e4, 1e4] : curve.domain,
      vRange: [-1e4, 1e4],
      info: { curvaBase: curve.type, direzione: normalize(dir) },
      eval: (u, v) => add(curve.eval(u), scale(dir, v)),
    });
    surf.project = (pt) => projectNumeric(surf, pt, surf.uRange, [-1e3, 1e3]);
    return surf;
  }

  if (t.includes('SURFACE_OF_REVOLUTION')) {
    const p = e.partParams('SURFACE_OF_REVOLUTION');
    const curve = buildCurve(file, p[1]);
    const axisEnt = file.get(p[2]);
    if (!curve || !axisEnt) return null;
    const ap = axisEnt.partParams('AXIS1_PLACEMENT') || axisEnt.params;
    const origin = readPoint(file, ap[1]) || [0, 0, 0];
    const axis = normalize(readDirection(file, ap[2]) || [0, 0, 1]);
    const rotate = (pt, ang) => {
      const rel = sub(pt, origin);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const par = scale(axis, dot(rel, axis));
      const perp = sub(rel, par);
      const w = cross(axis, perp);
      return add(origin, add(par, add(scale(perp, c), scale(w, s))));
    };
    // con profilo LINE il parametro e' la lunghezza lungo la retta: dominio ampio
    // (gli esportatori scrivono spesso VECTOR a modulo 1)
    const vRange = curve.type === 'LINE' ? [-1e4, 1e4] : curve.domain;
    const surf = withNormal({
      type: 'SURFACE_OF_REVOLUTION',
      uPeriod: 2 * Math.PI,
      vPeriod: null,
      uRange: [0, 2 * Math.PI],
      vRange,
      info: { curvaBase: curve.type, asse: axis, origine: origin },
      eval: (u, v) => rotate(curve.eval(v), u),
    });
    // proiezione analitica in u (angolo attorno all'asse) + numerica in v
    surf.project = (pt) => {
      const rel = sub(pt, origin);
      const par = scale(axis, dot(rel, axis));
      const perp = sub(rel, par);
      // riferimento angolare: la direzione della curva base rispetto all'asse
      const p0 = sub(curve.eval(curve.type === 'LINE' ? 0 : curve.domain[0]), origin);
      let ref = normalize(sub(p0, scale(axis, dot(p0, axis))));
      if (len(ref) < 1e-9) ref = normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const ref2 = cross(axis, ref);
      let u = Math.atan2(dot(perp, ref2), dot(perp, ref));
      if (u < 0) u += 2 * Math.PI;
      // riporta il punto nel semipiano della curva base e cerca v lungo la curva
      const nelPiano = add(origin, add(par, scale(ref, len(perp))));
      const v = closestParam({ ...curve, domain: vRange }, nelPiano, 96);
      return [u, v];
    };
    return surf;
  }

  if (t.includes('OFFSET_SURFACE')) {
    const p = e.partParams('OFFSET_SURFACE');
    const basis = buildSurface(file, p[1]);
    const d = Number(p[2]) || 0;
    if (!basis) return null;
    const surf = withNormal({
      type: 'OFFSET_SURFACE',
      uPeriod: basis.uPeriod,
      vPeriod: basis.vPeriod,
      uRange: basis.uRange,
      vRange: basis.vRange,
      isPlanar: basis.isPlanar,
      info: { superficieBase: basis.type, distanza: d },
      eval: (u, v) => add(basis.eval(u, v), scale(basis.normal(u, v), d)),
      normal: (u, v) => basis.normal(u, v),
    });
    // la proiezione usa la superficie base: sufficiente per offset piccoli
    surf.project = (pt) => basis.project(sub(pt, scale(basis.normal(...basis.project(pt)), d)));
    return surf;
  }

  if (t.includes('CURVE_BOUNDED_SURFACE') || t.includes('RECTANGULAR_TRIMMED_SURFACE')) {
    const p = e.partParams('CURVE_BOUNDED_SURFACE') || e.partParams('RECTANGULAR_TRIMMED_SURFACE');
    const basis = buildSurface(file, p[1]);
    if (!basis) return null;
    if (t.includes('RECTANGULAR_TRIMMED_SURFACE')) {
      const u1 = Number(p[2]);
      const u2 = Number(p[3]);
      const v1 = Number(p[4]);
      const v2 = Number(p[5]);
      return { ...basis, uRange: [u1, u2], vRange: [v1, v2], entity: e };
    }
    return { ...basis, entity: e };
  }

  return null;
}

/**
 * Raffinamento locale (Gauss-Newton) del parametro (u,v) piu' vicino a `pt`,
 * partendo da `uv0`. Segue la superficie senza saltare su altri rami.
 * @returns {{uv:[number,number], residual:number}}
 */
export function projectLocal(surf, pt, uv0, iters = 24) {
  const [u0, u1] = surf.uRange;
  const [v0, v1] = surf.vRange;
  const hu = Math.max((u1 - u0) * 1e-6, 1e-9);
  const hv = Math.max((v1 - v0) * 1e-6, 1e-9);
  let u = Math.min(Math.max(uv0[0], u0), u1);
  let v = Math.min(Math.max(uv0[1], v0), v1);
  let residual = dist(surf.eval(u, v), pt);
  for (let it = 0; it < iters; it++) {
    const p = surf.eval(u, v);
    const r = sub(pt, p);
    residual = len(r);
    if (residual < 1e-10) break;
    const Su = scale(sub(surf.eval(Math.min(u1, u + hu), v), surf.eval(Math.max(u0, u - hu), v)), 1 / (2 * hu));
    const Sv = scale(sub(surf.eval(u, Math.min(v1, v + hv)), surf.eval(u, Math.max(v0, v - hv))), 1 / (2 * hv));
    const a = dot(Su, Su);
    const b = dot(Su, Sv);
    const c = dot(Sv, Sv);
    const d1 = dot(r, Su);
    const d2 = dot(r, Sv);
    const det = a * c - b * b;
    let du;
    let dv;
    if (Math.abs(det) < 1e-300) {
      du = a > 1e-300 ? d1 / a : 0;
      dv = c > 1e-300 ? d2 / c : 0;
    } else {
      du = (c * d1 - b * d2) / det;
      dv = (a * d2 - b * d1) / det;
    }
    // passo limitato: evita salti fuori dal ramo corrente
    const maxU = (u1 - u0) * 0.25;
    const maxV = (v1 - v0) * 0.25;
    du = Math.max(-maxU, Math.min(maxU, du));
    dv = Math.max(-maxV, Math.min(maxV, dv));
    let step = 1;
    let improved = false;
    for (let k = 0; k < 6; k++) {
      const nu = Math.min(u1, Math.max(u0, u + du * step));
      const nv = Math.min(v1, Math.max(v0, v + dv * step));
      const nd = dist(surf.eval(nu, nv), pt);
      if (nd < residual) {
        u = nu;
        v = nv;
        residual = nd;
        improved = true;
        break;
      }
      step *= 0.4;
    }
    if (!improved) break;
  }
  return { uv: [u, v], residual };
}

/** Proiezione numerica globale: ricerca su griglia + raffinamento locale. */
export function projectNumeric(surf, pt, uRangeOverride, vRangeOverride) {
  const [u0, u1] = uRangeOverride || surf.uRange;
  const [v0, v1] = vRangeOverride || surf.vRange;
  const N = 16;
  let bu = u0;
  let bv = v0;
  let bd = Infinity;
  for (let i = 0; i <= N; i++) {
    const u = u0 + ((u1 - u0) * i) / N;
    for (let j = 0; j <= N; j++) {
      const v = v0 + ((v1 - v0) * j) / N;
      const d = dist(surf.eval(u, v), pt);
      if (d < bd) {
        bd = d;
        bu = u;
        bv = v;
      }
    }
  }
  return projectLocal(surf, pt, [bu, bv]).uv;
}

/**
 * Proietta una sequenza di punti mantenendo la continuita': ogni punto parte
 * dal parametro del precedente, con ricaduta sulla ricerca globale se il
 * residuo resta alto. Indispensabile sulle superfici che si ripiegano.
 */
export function projectSequence(surf, points, tol = 1e-4) {
  const out = [];
  let prev = null;
  for (const p of points) {
    let best = null;
    if (prev) {
      const r = projectLocal(surf, p, prev);
      if (r.residual <= tol) best = r.uv;
    }
    if (!best) {
      const guess = projectNumeric(surf, p);
      const r = projectLocal(surf, p, guess);
      best = r.uv;
    }
    out.push(best);
    prev = best;
  }
  return out;
}

/**
 * Fattori di scala che rendono lo spazio (u,v) approssimativamente isometrico:
 * mediana di |dS/du| e |dS/dv| sul dominio. Serve a evitare parametrizzazioni
 * estremamente anisotrope, che rovinerebbero la triangolazione 2D.
 */
export function metricScales(surf, samples = 7) {
  const clampRange = ([a, b]) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [0, 1];
    const span = b - a;
    return span > 1e5 ? [a + span * 0.4999, b - span * 0.4999] : [a, b];
  };
  const [u0, u1] = clampRange(surf.uRange);
  const [v0, v1] = clampRange(surf.vRange);
  const hu = (u1 - u0) * 1e-4 || 1e-6;
  const hv = (v1 - v0) * 1e-4 || 1e-6;
  const du = [];
  const dv = [];
  for (let i = 0; i < samples; i++) {
    const u = u0 + ((u1 - u0) * i) / (samples - 1);
    for (let j = 0; j < samples; j++) {
      const v = v0 + ((v1 - v0) * j) / (samples - 1);
      const p = surf.eval(u, v);
      du.push(dist(surf.eval(Math.min(u1, u + hu), v), p) / hu);
      dv.push(dist(surf.eval(u, Math.min(v1, v + hv)), p) / hv);
    }
  }
  const median = (arr) => {
    const a = arr.filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 1;
  };
  return [median(du), median(dv)];
}

/**
 * Riparametrizza una superficie moltiplicando i parametri per i fattori dati:
 * il risultato si usa come una superficie qualsiasi, ma con (u,v) in unita'
 * di lunghezza approssimata.
 */
export function scaledSurface(surf, su, sv) {
  if (!(su > 0) || !(sv > 0) || (Math.abs(su - 1) < 1e-9 && Math.abs(sv - 1) < 1e-9)) return surf;
  return {
    type: surf.type,
    entity: surf.entity,
    info: surf.info,
    isPlanar: surf.isPlanar,
    uPeriod: surf.uPeriod ? surf.uPeriod * su : null,
    vPeriod: surf.vPeriod ? surf.vPeriod * sv : null,
    uRange: [surf.uRange[0] * su, surf.uRange[1] * su],
    vRange: [surf.vRange[0] * sv, surf.vRange[1] * sv],
    eval: (u, v) => surf.eval(u / su, v / sv),
    normal: (u, v) => surf.normal(u / su, v / sv),
    project: (p) => {
      const uv = surf.project(p);
      return [uv[0] * su, uv[1] * sv];
    },
    base: surf,
    scales: [su, sv],
  };
}
