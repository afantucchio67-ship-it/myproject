import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStep } from '../src/step/parser.js';
import {
  buildCurve,
  buildSurface,
  dist,
  identity,
  invertRigid,
  multiply,
  readPlacement,
  transformPoint,
} from '../src/step/geometry.js';

const avvolgi = (corpo) =>
  `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${corpo}\nENDSEC;\nEND-ISO-10303-21;\n`;

test('la matrice inversa di un posizionamento è corretta', () => {
  const f = parseStep(avvolgi(
    "#1=AXIS2_PLACEMENT_3D('',#2,#3,#4);\n#2=CARTESIAN_POINT('',(10.0,-4.0,7.0));\n" +
    "#3=DIRECTION('',(0.0,0.6,0.8));\n#4=DIRECTION('',(1.0,0.0,0.0));",
  ));
  const m = readPlacement(f, { ref: 1 });
  const prodotto = multiply(m, invertRigid(m));
  identity().forEach((v, i) => assert.ok(Math.abs(prodotto[i] - v) < 1e-12));
  const p = [3, -2, 5];
  assert.ok(dist(transformPoint(m, transformPoint(invertRigid(m), p)), p) < 1e-12);
});

test('assi predefiniti quando mancano direzione o riferimento', () => {
  const f = parseStep(avvolgi("#1=AXIS2_PLACEMENT_3D('',#2,$,$);\n#2=CARTESIAN_POINT('',(1.0,2.0,3.0));"));
  const m = readPlacement(f, { ref: 1 });
  assert.deepEqual([m[12], m[13], m[14]], [1, 2, 3]);
  // gli assi restano ortonormali
  const z = [m[8], m[9], m[10]];
  assert.ok(Math.abs(Math.hypot(...z) - 1) < 1e-12);
});

test('il cerchio viene valutato e invertito correttamente', () => {
  const f = parseStep(avvolgi(
    "#1=CIRCLE('',#2,4.0);\n#2=AXIS2_PLACEMENT_3D('',#3,#4,#5);\n" +
    "#3=CARTESIAN_POINT('',(1.0,2.0,3.0));\n#4=DIRECTION('',(0.0,0.0,1.0));\n#5=DIRECTION('',(1.0,0.0,0.0));",
  ));
  const c = buildCurve(f, { ref: 1 });
  assert.equal(c.type, 'CIRCLE');
  assert.ok(dist(c.eval(0), [5, 2, 3]) < 1e-12);
  assert.ok(dist(c.eval(Math.PI / 2), [1, 6, 3]) < 1e-12);
  assert.ok(Math.abs(c.invert([1, 6, 3]) - Math.PI / 2) < 1e-9);
});

test('la superficie cilindrica proietta i punti sul parametro giusto', () => {
  const f = parseStep(avvolgi(
    "#1=CYLINDRICAL_SURFACE('',#2,3.0);\n#2=AXIS2_PLACEMENT_3D('',#3,#4,#5);\n" +
    "#3=CARTESIAN_POINT('',(0.0,0.0,0.0));\n#4=DIRECTION('',(0.0,0.0,1.0));\n#5=DIRECTION('',(1.0,0.0,0.0));",
  ));
  const s = buildSurface(f, { ref: 1 });
  const p = s.eval(Math.PI, 5);
  assert.ok(dist(p, [-3, 0, 5]) < 1e-12);
  const [u, v] = s.project(p);
  assert.ok(Math.abs(u - Math.PI) < 1e-9 && Math.abs(v - 5) < 1e-9);
  // la normale è radiale e uscente
  assert.ok(dist(s.normal(0, 0), [1, 0, 0]) < 1e-9);
});

test('la B-spline passa per i punti di controllo estremi', () => {
  const f = parseStep(avvolgi(
    "#1=B_SPLINE_CURVE_WITH_KNOTS('',3,(#2,#3,#4,#5),.UNSPECIFIED.,.F.,.F.,(4,4),(0.0,1.0),.UNSPECIFIED.);\n" +
    "#2=CARTESIAN_POINT('',(0.0,0.0,0.0));\n#3=CARTESIAN_POINT('',(1.0,2.0,0.0));\n" +
    "#4=CARTESIAN_POINT('',(3.0,2.0,0.0));\n#5=CARTESIAN_POINT('',(4.0,0.0,0.0));",
  ));
  const c = buildCurve(f, { ref: 1 });
  assert.ok(dist(c.eval(0), [0, 0, 0]) < 1e-12);
  assert.ok(dist(c.eval(1), [4, 0, 0]) < 1e-12);
  // a metà la curva sta dentro il poligono di controllo
  const m = c.eval(0.5);
  assert.ok(m[0] > 1.5 && m[0] < 2.5 && m[1] > 0 && m[1] < 2);
});
