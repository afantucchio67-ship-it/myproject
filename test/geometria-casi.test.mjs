/**
 * Casi geometrici con valori analitici (test/fixtures-geometria.mjs): coni,
 * sfere, tori, fori, cuciture, gusci invertiti, vuoti, B-spline razionali,
 * superfici di rivoluzione, unita' in gradi e in pollici, assiemi.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from './fixtures-geometria.mjs';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';

const CASI = {
  'cono tronco': () => G.conoTronco(10, 4, 12),
  'cono tronco (angoli in gradi)': () => G.conoTronco(10, 4, 12, { angolo: 'degree' }),
  'cono a punta (VERTEX_LOOP)': () => G.conoPunta(10, 12),
  'sfera in due emisferi': () => G.sferaDueFacce(5),
  'sfera a una faccia con cucitura': () => G.sferaCucitura(5),
  'sfera con cucitura e poli come VERTEX_LOOP': () => G.sferaCucitura(5, { vertexLoops: true }),
  'toro a una faccia con cuciture': () => G.toroCucitura(10, 3),
  'toro in due meta': () => G.toroDueFacce(10, 3),
  'cubo con foro passante': () => G.cuboForo(10, 2),
  cilindro: () => G.cilindro(5, 20),
  'cilindro con asse -z': () => G.cilindro(5, 20, { asseGiu: true }),
  'cilindro con guscio invertito': () => G.cilindro(5, 20, { inverti: true }),
  'cilindro con cucitura (stile OpenCascade)': () => G.cilindro(5, 20, { cucitura: true }),
  'cilindro con laterale divisa': () => G.cilindro(5, 20, { split: true }),
  'cilindro con archi same_sense .F.': () => G.cilindro(5, 20, { split: true, senseF: true }),
  'cilindro con TRIMMED_CURVE': () => G.cilindro(5, 20, { split: true, trimmed: true }),
  'FACETED_BREP con POLY_LOOP': () => G.cuboPolyLoop(10, 'FACETED_BREP', 'FACE_SURFACE'),
  'MANIFOLD_SOLID_BREP con POLY_LOOP': () => G.cuboPolyLoop(10, 'MANIFOLD_SOLID_BREP', 'ADVANCED_FACE'),
  'assieme con due istanze trasformate': () => G.assiemeDueIstanze(10),
  'modello a gusci aperto': () => G.superficie('aperto'),
  'modello a gusci chiuso': () => G.superficie('chiuso'),
  'cubo con guscio invertito': () => G.cuboInvertito(10),
  'ORIENTED_CLOSED_SHELL .F.': () => G.cuboInvertito(10, { orientedShell: true }),
  'BREP_WITH_VOIDS': () => G.cuboVuoto(10, 4),
  'B-spline razionale in record complesso': () => G.patchRazionale(5, 10),
  'superficie di rivoluzione': () => G.conoRivoluzione(10, 4, 12),
  'superficie di rivoluzione con VECTOR a modulo 1': () => G.conoRivoluzione(10, 4, 12, { magnitudoUno: true }),
  'cilindro tagliato da un piano inclinato (ellisse)': () => G.cilindroEllisse(5, 20, 30),
  'fascia torica': () => G.fasciaTorica(10, 3, -Math.PI / 2, 0),
  'quarto di disco razionale': () => G.quartoDiscoRazionale(5),
};

for (const [nome, gen] of Object.entries(CASI)) {
  test(nome, () => {
    const { testo, atteso } = gen();
    const m = buildModel(parseStep(testo), { tolerance: 0.02 });
    const area = m.parti.reduce((a, p) => a + p.area, 0);
    const volume = m.parti.reduce((a, p) => a + (p.volume || 0), 0);
    const aperti = m.parti.reduce((a, p) => a + (p.bordiAperti || 0), 0);
    const facce = m.parti.reduce((a, p) => a + p.facce.length, 0);
    if (atteso.area) assert.ok(Math.abs(area - atteso.area) / atteso.area < 0.01, `area ${area.toFixed(2)} vs ${atteso.area.toFixed(2)}`);
    if (atteso.volume) assert.ok(Math.abs(volume - atteso.volume) / atteso.volume < 0.01, `volume ${volume.toFixed(2)} vs ${atteso.volume.toFixed(2)}`);
    if (atteso.bordiAperti != null) assert.equal(aperti, atteso.bordiAperti, 'bordi aperti');
    if (atteso.facce != null) assert.equal(facce, atteso.facce, 'facce');
  });
}

test('un modello aperto non viene "raddrizzato" e non produce diagnostiche spurie', () => {
  const m = buildModel(parseStep(G.superficie('faccia').testo), { tolerance: 0.02 });
  const p = m.parti[0];
  assert.equal(p.orientamentoInvertito, false);
  assert.ok(m.diagnostics.every((d) => !d.includes('orientato verso l')));
  // normale +z come da file
  assert.ok(p.mesh.normals[2] > 0.99);
});

test('un guscio con ORIENTED_CLOSED_SHELL .F. non e segnalato come invertito', () => {
  const m = buildModel(parseStep(G.cuboInvertito(10, { orientedShell: true }).testo), { tolerance: 0.02 });
  assert.equal(m.parti[0].orientamentoInvertito, false);
});
