/**
 * Camera orbitale con pan e zoom, viste standard e inquadratura automatica.
 * Unita': quelle del modello (mm nei file STEP tipici).
 */

import { add, invert, lookAt, multiply, normalize, ortho, perspective, scale, sub } from './mat4.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.distance = 100;
    this.yaw = Math.PI * 0.25;
    this.pitch = Math.PI * 0.18;
    this.up = [0, 0, 1]; // Z verso l'alto: convenzione CAD
    this.fov = (35 * Math.PI) / 180;
    this.prospettiva = true;
    this.near = 0.1;
    this.far = 10000;
  }

  get eye() {
    const cp = Math.cos(this.pitch);
    const dir = [cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch)];
    return add(this.target, scale(dir, this.distance));
  }

  view() {
    return lookAt(this.eye, this.target, this.up);
  }

  projection(aspect) {
    if (this.prospettiva) {
      this.near = Math.max(this.distance / 1000, 1e-3);
      this.far = this.distance * 20 + 1000;
      return perspective(this.fov, aspect, this.near, this.far);
    }
    const h = this.distance * Math.tan(this.fov / 2);
    this.near = -this.distance * 10 - 1000;
    this.far = this.distance * 10 + 1000;
    return ortho(-h * aspect, h * aspect, -h, h, this.near, this.far);
  }

  viewProjection(aspect) {
    return multiply(this.projection(aspect), this.view());
  }

  orbit(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  /** Trascina il bersaglio nel piano dello schermo. */
  pan(dx, dy, viewportHeight) {
    const view = this.view();
    const right = [view[0], view[4], view[8]];
    const up = [view[1], view[5], view[9]];
    const scaleFactor = (2 * this.distance * Math.tan(this.fov / 2)) / Math.max(1, viewportHeight);
    this.target = add(this.target, add(scale(right, -dx * scaleFactor), scale(up, dy * scaleFactor)));
  }

  zoom(factor) {
    this.distance = clamp(this.distance * factor, 1e-3, 1e7);
  }

  /** Zoom verso un punto (rotellina con puntatore). */
  zoomTo(factor, worldPoint) {
    if (worldPoint) {
      const t = 1 - factor;
      this.target = add(scale(this.target, 1 - t), scale(worldPoint, t));
    }
    this.zoom(factor);
  }

  /** Inquadra una bounding box. */
  fit(bbox, aspect = 1) {
    const size = bbox.size || sub(bbox.max, bbox.min);
    const center = [
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2,
    ];
    const radius = Math.max(1e-3, Math.hypot(size[0], size[1], size[2]) / 2);
    this.target = center;
    const fitFov = Math.min(this.fov, 2 * Math.atan(Math.tan(this.fov / 2) * Math.max(0.35, Math.min(1, aspect))));
    this.distance = (radius / Math.sin(fitFov / 2)) * 1.12;
  }

  /** Viste standard: 'fronte','retro','sinistra','destra','alto','basso','iso'. */
  setVista(nome) {
    const v = {
      fronte: [-Math.PI / 2, 0],
      retro: [Math.PI / 2, 0],
      destra: [0, 0],
      sinistra: [Math.PI, 0],
      alto: [-Math.PI / 2, Math.PI / 2 - 0.001],
      basso: [-Math.PI / 2, -Math.PI / 2 + 0.001],
      iso: [Math.PI * 0.25, Math.PI * 0.18],
    }[nome];
    if (!v) return;
    this.yaw = v[0];
    this.pitch = v[1];
  }

  /** Raggio nel mondo da coordinate pixel del canvas. */
  ray(px, py, width, height) {
    const vp = this.viewProjection(width / height);
    const inv = invert(vp);
    const x = (px / width) * 2 - 1;
    const y = 1 - (py / height) * 2;
    const unproject = (z) => {
      const p = [x, y, z, 1];
      const o = [
        inv[0] * p[0] + inv[4] * p[1] + inv[8] * p[2] + inv[12],
        inv[1] * p[0] + inv[5] * p[1] + inv[9] * p[2] + inv[13],
        inv[2] * p[0] + inv[6] * p[1] + inv[10] * p[2] + inv[14],
      ];
      const w = inv[3] * p[0] + inv[7] * p[1] + inv[11] * p[2] + inv[15];
      return w ? [o[0] / w, o[1] / w, o[2] / w] : o;
    };
    const near = unproject(-1);
    const far = unproject(1);
    return { origin: near, direction: normalize(sub(far, near)) };
  }
}
