/**
 * Selezione e misure lato CPU: intersezione raggio/triangoli sulla mesh
 * tassellata, accelerata da una griglia uniforme per parte (costruita una
 * volta e conservata sull'oggetto parte). Funziona anche con trasparenza e
 * sezione attive, perche' non dipende dal disegno GPU.
 */

import { invert, transformDir, transformPoint } from './mat4.js';

function rayTriangle(orig, dir, P, i0, i1, i2) {
  const ax = P[i0], ay = P[i0 + 1], az = P[i0 + 2];
  const e1x = P[i1] - ax, e1y = P[i1 + 1] - ay, e1z = P[i1 + 2] - az;
  const e2x = P[i2] - ax, e2y = P[i2 + 1] - ay, e2z = P[i2 + 2] - az;
  const px = dir[1] * e2z - dir[2] * e2y;
  const py = dir[2] * e2x - dir[0] * e2z;
  const pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const tx = orig[0] - ax, ty = orig[1] - ay, tz = orig[2] - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > 1e-9 ? t : null;
}

/** Intervallo [tmin, tmax] del raggio dentro una scatola, o null. */
function rayBox(orig, dir, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (orig[k] < min[k] - 1e-9 || orig[k] > max[k] + 1e-9) return null;
      continue;
    }
    const t1 = (min[k] - orig[k]) / dir[k];
    const t2 = (max[k] - orig[k]) / dir[k];
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(0, tmin)) return null;
  return [Math.max(0, tmin), tmax];
}

/**
 * Griglia uniforme dei triangoli di una mesh (in coordinate locali).
 * Costruzione O(n) con ordinamento per conteggio, senza array annidati.
 */
function costruisciGriglia(mesh, bbox) {
  const { positions: P, indices: I } = mesh;
  const nTri = I.length / 3;
  const size = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  const lato = Math.max(1e-9, Math.cbrt((size[0] * size[1] * size[2]) / Math.max(1, nTri)) * 2);
  const n = [0, 1, 2].map((k) => Math.max(1, Math.min(64, Math.ceil(size[k] / lato))));
  const cella = [0, 1, 2].map((k) => (size[k] > 0 ? size[k] / n[k] : 1));
  const nCelle = n[0] * n[1] * n[2];
  const idx = (x, y, z) => x + n[0] * (y + n[1] * z);
  const range = (t) => {
    const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const i = I[t * 3 + k] * 3;
      for (let a = 0; a < 3; a++) {
        const v = P[i + a];
        if (v < out[a]) out[a] = v;
        if (v > out[3 + a]) out[3 + a] = v;
      }
    }
    const lo = [0, 1, 2].map((a) => Math.min(n[a] - 1, Math.max(0, Math.floor((out[a] - bbox.min[a]) / cella[a]))));
    const hi = [0, 1, 2].map((a) => Math.min(n[a] - 1, Math.max(0, Math.floor((out[3 + a] - bbox.min[a]) / cella[a]))));
    return [lo, hi];
  };
  // 1) conteggio per cella
  const conteggi = new Uint32Array(nCelle + 1);
  for (let t = 0; t < nTri; t++) {
    const [lo, hi] = range(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) conteggi[idx(x, y, z) + 1]++;
  }
  // 2) somme prefisse -> offset
  for (let c = 0; c < nCelle; c++) conteggi[c + 1] += conteggi[c];
  const inizio = conteggi;
  const riempimento = new Uint32Array(nCelle);
  const elementi = new Uint32Array(inizio[nCelle]);
  // 3) riempimento
  for (let t = 0; t < nTri; t++) {
    const [lo, hi] = range(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const c = idx(x, y, z);
      elementi[inizio[c] + riempimento[c]++] = t;
    }
  }
  return { n, cella, inizio, elementi, min: bbox.min, max: bbox.max };
}

/**
 * Attraversamento 3D-DDA della griglia: restituisce {t, tri} del primo
 * triangolo colpito. `scarta(t)` permette di ignorare i punti tagliati dal
 * piano di sezione e continuare verso le facce visibili dietro.
 */
function attraversa(griglia, mesh, o, d, tIn, tOut, scarta = null) {
  const { n, cella, inizio, elementi, min } = griglia;
  const { positions: P, indices: I } = mesh;
  const eps = 1e-9;
  const p0 = [o[0] + d[0] * (tIn + eps), o[1] + d[1] * (tIn + eps), o[2] + d[2] * (tIn + eps)];
  const c = [0, 1, 2].map((k) => Math.min(n[k] - 1, Math.max(0, Math.floor((p0[k] - min[k]) / cella[k]))));
  const step = [0, 1, 2].map((k) => (d[k] > 0 ? 1 : d[k] < 0 ? -1 : 0));
  const tDelta = [0, 1, 2].map((k) => (d[k] !== 0 ? Math.abs(cella[k] / d[k]) : Infinity));
  const tMax = [0, 1, 2].map((k) => {
    if (d[k] === 0) return Infinity;
    const bordo = min[k] + (c[k] + (step[k] > 0 ? 1 : 0)) * cella[k];
    return (bordo - o[k]) / d[k];
  });
  let best = null;
  let guard = 0;
  for (;;) {
    if (guard++ > n[0] + n[1] + n[2] + 3) break;
    const ci = c[0] + n[0] * (c[1] + n[1] * c[2]);
    const a = inizio[ci];
    const b = inizio[ci + 1];
    for (let k = a; k < b; k++) {
      const t = elementi[k];
      const hit = rayTriangle(o, d, P, I[t * 3] * 3, I[t * 3 + 1] * 3, I[t * 3 + 2] * 3);
      if (hit == null || (best && hit >= best.t)) continue;
      if (scarta && scarta(hit)) continue;
      best = { t: hit, tri: t };
    }
    const tProssimo = Math.min(tMax[0], tMax[1], tMax[2]);
    // un colpo prima del bordo della cella e' definitivo
    if (best && best.t <= tProssimo + eps) return best;
    if (tProssimo > tOut + eps) return best;
    const k = tMax[0] <= tMax[1] ? (tMax[0] <= tMax[2] ? 0 : 2) : tMax[1] <= tMax[2] ? 1 : 2;
    c[k] += step[k];
    if (c[k] < 0 || c[k] >= n[k]) return best;
    tMax[k] += tDelta[k];
  }
  return best;
}

/**
 * Primo triangolo colpito dal raggio.
 * `parti` accetta sia le parti del modello (matrice, mesh, bbox) sia quelle
 * del renderer (model, ref) — cosi' la selezione segue anche l'esplosione.
 * @returns {{parte:number, faccia:number, punto:number[], puntoLocale:number[], distanza:number, triangolo:number, normale:number[]}|null}
 */
export function pick(ray, parti, opts = {}) {
  let best = null;
  parti.forEach((p, pi) => {
    if (p.visibile === false) return;
    const ref = p.ref || p;
    const model = p.model || p.matrice;
    const mesh = ref.mesh;
    const bb = ref.bbox;
    if (!mesh || !bb || !mesh.indices.length) return;
    const inv = invert(model);
    const o = transformPoint(inv, ray.origin);
    const d = transformDir(inv, ray.direction);
    const intervallo = rayBox(o, d, bb.min, bb.max);
    if (!intervallo) return;
    if (!ref._griglia) ref._griglia = costruisciGriglia(mesh, bb);
    let scarta = null;
    if (opts.clip && opts.clip.attivo) {
      // piano di sezione nel sistema locale: dot(M l, n) > off  <=>  dot(l, R^T n) > off - dot(t, n)
      const n = opts.clip.normale;
      const nl = [
        model[0] * n[0] + model[1] * n[1] + model[2] * n[2],
        model[4] * n[0] + model[5] * n[1] + model[6] * n[2],
        model[8] * n[0] + model[9] * n[1] + model[10] * n[2],
      ];
      const soglia = opts.clip.offset - (model[12] * n[0] + model[13] * n[1] + model[14] * n[2]);
      scarta = (t) => (o[0] + d[0] * t) * nl[0] + (o[1] + d[1] * t) * nl[1] + (o[2] + d[2] * t) * nl[2] > soglia;
    }
    const hit = attraversa(ref._griglia, mesh, o, d, intervallo[0], intervallo[1], scarta);
    if (!hit) return;
    // distanza confrontabile fra parti: nel mondo
    const local = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
    const mondo = transformPoint(model, local);
    const dist = Math.hypot(mondo[0] - ray.origin[0], mondo[1] - ray.origin[1], mondo[2] - ray.origin[2]);
    if (!best || dist < best.distanza) {
      const N = mesh.normals;
      const i0 = mesh.indices[hit.tri * 3] * 3;
      const nLoc = [N[i0], N[i0 + 1], N[i0 + 2]];
      best = {
        parte: pi,
        faccia: mesh.faceIds ? mesh.faceIds[hit.tri] : -1,
        triangolo: hit.tri,
        punto: mondo,
        puntoLocale: local,
        distanza: dist,
        normale: transformDir(model, nLoc),
      };
    }
  });
  return best;
}

/**
 * Vertice di spigolo piu' vicino a un punto del mondo (per l'aggancio della
 * misura). Restituisce {punto, distanza} o null se oltre `raggio`.
 */
export function verticeVicino(punto, parti, raggio) {
  let best = null;
  for (const p of parti) {
    if (p.visibile === false) continue;
    const ref = p.ref || p;
    const model = p.model || p.matrice;
    for (const e of ref.spigoli || []) {
      const pts = e.punti;
      for (let i = 0; i < pts.length; i += 3) {
        const w = transformPoint(model, [pts[i], pts[i + 1], pts[i + 2]]);
        const d = Math.hypot(w[0] - punto[0], w[1] - punto[1], w[2] - punto[2]);
        if (d <= raggio && (!best || d < best.distanza)) best = { punto: w, distanza: d };
      }
    }
  }
  return best;
}
