/**
 * Selezione e misure lato CPU: intersezione raggio/triangoli sulla mesh
 * tassellata. Nessun passaggio GPU aggiuntivo, quindi funziona anche mentre
 * la scena e' in trasparenza o in sezione.
 */

import { invert, transformDir, transformPoint } from './mat4.js';

function rayTriangle(orig, dir, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const t = [orig[0] - a[0], orig[1] - a[1], orig[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * invDet;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * invDet;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * invDet;
  return dist > 1e-9 ? dist : null;
}

function hitBox(orig, dir, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (orig[k] < min[k] - 1e-9 || orig[k] > max[k] + 1e-9) return false;
      continue;
    }
    const t1 = (min[k] - orig[k]) / dir[k];
    const t2 = (max[k] - orig[k]) / dir[k];
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax >= Math.max(0, tmin);
}

/**
 * Primo triangolo colpito dal raggio.
 * @returns {{parte:number, faccia:number, punto:number[], distanza:number, triangolo:number}|null}
 */
export function pick(ray, parti, opts = {}) {
  let best = null;
  parti.forEach((p, pi) => {
    if (p.visibile === false) return;
    const model = p.matrice || p.model;
    const inv = invert(model);
    const o = transformPoint(inv, ray.origin);
    const d = transformDir(inv, ray.direction);
    const mesh = p.mesh || (p.ref && p.ref.mesh);
    if (!mesh) return;
    const bb = (p.bbox || (p.ref && p.ref.bbox));
    if (bb && !hitBox(o, d, bb.min, bb.max)) return;
    const { positions, indices, faceIds } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t] * 3;
      const i1 = indices[t + 1] * 3;
      const i2 = indices[t + 2] * 3;
      const a = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
      const b = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
      const c = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
      const dist = rayTriangle(o, d, a, b, c);
      if (dist == null) continue;
      if (!best || dist < best.distanzaLocale) {
        const local = [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist];
        best = {
          parte: pi,
          faccia: faceIds ? faceIds[t / 3] : -1,
          triangolo: t / 3,
          punto: transformPoint(model, local),
          puntoLocale: local,
          distanzaLocale: dist,
        };
      }
    }
  });
  if (best && opts.clip && opts.clip.attivo) {
    // il punto tagliato dal piano di sezione non e' selezionabile
    const { normale, offset } = opts.clip;
    const d = best.punto[0] * normale[0] + best.punto[1] * normale[1] + best.punto[2] * normale[2];
    if (d > offset) return null;
  }
  return best;
}
