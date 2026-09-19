import assert from 'node:assert/strict';
import test from 'node:test';
import { OrbitCamera } from '../src/viewer/camera.js';
import { pick, verticeVicino } from '../src/viewer/picking.js';
import { identity, invert, multiply, perspective, transformPoint } from '../src/viewer/mat4.js';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';
import { cuboStep } from './fixtures.mjs';

const cubo = () => {
  const m = buildModel(parseStep(cuboStep(10)), { tolerance: 0.05 });
  m.parti.forEach((p) => { p.visibile = true; });
  return m;
};

test('mat4: inversa e proiezione prospettica', () => {
  const m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1];
  const p = multiply(m, invert(m));
  identity().forEach((v, i) => assert.ok(Math.abs(p[i] - v) < 1e-12));
  const pr = perspective(Math.PI / 3, 1.5, 0.1, 100);
  assert.ok(pr[11] === -1 && pr[0] > 0);
});

test('camera: inquadratura, raggio e proiezione a schermo coerenti', () => {
  const c = new OrbitCamera();
  c.fit({ min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] }, 1);
  const s = c.toScreen(c.target, 800, 800);
  assert.ok(Math.abs(s[0] - 400) < 1e-6 && Math.abs(s[1] - 400) < 1e-6);
  const r = c.ray(400, 400, 800, 800);
  const d = [c.target[0] - r.origin[0], c.target[1] - r.origin[1], c.target[2] - r.origin[2]];
  const l = Math.hypot(...d);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(d[k] / l - r.direction[k]) < 1e-6);
  c.setVista('alto');
  assert.ok(c.eye[2] > c.target[2] + 10);
  c.guardaLungo([1, 0, 0]);
  assert.ok(c.eye[0] > c.target[0] + 10);
  // near/far seguono la scena
  c.projection(1);
  assert.ok(c.near > 0 && c.far > c.distance);
});

test('picking: faccia, normale, sezione e aggancio ai vertici', () => {
  const m = cubo();
  const alto = pick({ origin: [5, 5, 50], direction: [0, 0, -1] }, m.parti);
  assert.ok(alto && Math.abs(alto.punto[2] - 10) < 1e-6 && alto.normale[2] > 0.99);
  // con la sezione che toglie z > 5 si colpisce la faccia opposta (z = 0)
  const sez = pick({ origin: [5, 5, 50], direction: [0, 0, -1] }, m.parti, { clip: { attivo: true, normale: [0, 0, 1], offset: 5 } });
  assert.ok(sez && Math.abs(sez.punto[2]) < 1e-6);
  assert.equal(pick({ origin: [50, 50, 50], direction: [0, 0, -1] }, m.parti), null);
  const v = verticeVicino([0.3, 0.2, 10.1], m.parti, 1);
  assert.ok(v && v.punto.every((x, i) => Math.abs(x - [0, 0, 10][i]) < 1e-9));
  // parte nascosta: nessun colpo
  m.parti[0].visibile = false;
  assert.equal(pick({ origin: [5, 5, 50], direction: [0, 0, -1] }, m.parti), null);
});

test('picking segue la matrice della parte (esplosione/trasformazioni)', () => {
  const m = cubo();
  const T = identity();
  T[12] = 100;
  const parti = [{ ref: m.parti[0], model: T, visibile: true }];
  const hit = pick({ origin: [105, 5, 50], direction: [0, 0, -1] }, parti);
  assert.ok(hit && Math.abs(hit.punto[0] - 105) < 1e-6);
  assert.ok(Math.abs(transformPoint(T, hit.puntoLocale)[0] - hit.punto[0]) < 1e-9);
});
