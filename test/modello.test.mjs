import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';
import { cilindroStep, cuboStep } from './fixtures.mjs';

function modello(testo, tolleranza = 0.02) {
  return buildModel(parseStep(testo), { tolerance: tolleranza });
}

test('cubo: misure esatte e mesh a tenuta', () => {
  const m = modello(cuboStep(10));
  assert.equal(m.parti.length, 1);
  const p = m.parti[0];
  assert.equal(p.facce.length, 6);
  assert.ok(Math.abs(p.area - 600) < 1e-6, `area ${p.area}`);
  assert.ok(Math.abs(p.volume - 1000) < 1e-6, `volume ${p.volume}`);
  assert.equal(p.bordiAperti, 0, 'la mesh deve essere chiusa');
  assert.ok(p.volumeEsatto);
  p.centroide.forEach((c) => assert.ok(Math.abs(c - 5) < 1e-9));
  assert.deepEqual(p.bbox.size.map((x) => Math.round(x)), [10, 10, 10]);
});

test('cubo: unità, prodotto e incertezza letti dal file', () => {
  const m = modello(cuboStep(10));
  assert.equal(m.units.lunghezza.nome, 'millimetre');
  assert.equal(m.units.lunghezza.fattore, 1);
  assert.equal(m.units.dimensione, 3);
  assert.equal(m.units.incertezza.valore, 1e-5);
  assert.equal(m.prodotti[0].codice, 'cubo di prova');
  assert.deepEqual(m.prodotti[0].categorie, ['part']);
  assert.equal(m.header.schema, 'CONFIG_CONTROL_DESIGN');
});

test('unità in pollici: simbolo, fattore e misure nelle unità del file', () => {
  const m = modello(cuboStep(2, 'inch'));
  assert.equal(m.units.lunghezza.nome, 'INCH');
  assert.equal(m.units.simbolo, 'in');
  assert.equal(m.units.fattoreVersoMm, 25.4);
  const p = m.parti[0];
  // le coordinate restano quelle del file: area 6·l², volume l³
  assert.ok(Math.abs(p.area - 24) < 1e-6, `area ${p.area}`);
  assert.ok(Math.abs(p.volume - 8) < 1e-6, `volume ${p.volume}`);
  assert.equal(p.bordiAperti, 0);
});

test('cilindro: area e volume entro la tolleranza', () => {
  const r = 5;
  const h = 20;
  const m = modello(cilindroStep(r, h), 0.005);
  const p = m.parti[0];
  const areaAttesa = 2 * Math.PI * r * h + 2 * Math.PI * r * r;
  const volumeAtteso = Math.PI * r * r * h;
  assert.equal(p.facce.length, 3);
  assert.ok(Math.abs(p.area - areaAttesa) / areaAttesa < 0.01, `area ${p.area} vs ${areaAttesa}`);
  assert.ok(Math.abs(p.volume - volumeAtteso) / volumeAtteso < 0.01, `volume ${p.volume} vs ${volumeAtteso}`);
  assert.equal(p.bordiAperti, 0, 'la mesh deve essere chiusa');
  assert.deepEqual(p.facce.map((f) => f.tipoSuperficie).sort(), ['CYLINDRICAL_SURFACE', 'PLANE', 'PLANE']);
});

test('la tolleranza più fine avvicina il volume al valore analitico', () => {
  const volumeAtteso = Math.PI * 25 * 20;
  const grossolano = modello(cilindroStep(5, 20), 0.5).parti[0].volume;
  const fine = modello(cilindroStep(5, 20), 0.005).parti[0].volume;
  assert.ok(Math.abs(fine - volumeAtteso) < Math.abs(grossolano - volumeAtteso));
});

test('le normali dei triangoli puntano verso l’esterno', () => {
  const p = modello(cuboStep(10)).parti[0];
  const { positions, normals, indices } = p.mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t] * 3;
    const centro = [positions[i] - 5, positions[i + 1] - 5, positions[i + 2] - 5];
    const n = [normals[i], normals[i + 1], normals[i + 2]];
    const prodotto = centro[0] * n[0] + centro[1] * n[1] + centro[2] * n[2];
    assert.ok(prodotto > 0, 'la normale deve allontanarsi dal centro del cubo');
  }
});

test('gli spigoli del modello sono disponibili per il wireframe', () => {
  const p = modello(cuboStep(10)).parti[0];
  assert.equal(p.spigoli.length, 12);
  assert.ok(p.spigoli.every((s) => s.punti instanceof Float32Array && s.punti.length >= 6));
});

test('statistiche e conteggi delle entità', () => {
  const m = modello(cuboStep(4));
  assert.ok(m.statistiche.entita > 50);
  assert.ok(m.statistiche.triangoli >= 12);
  assert.equal(m.geometria.solidi, 1);
  assert.equal(m.geometria.facce, 6);
  assert.equal(m.geometria.spigoli, 12);
  assert.equal(m.geometria.vertici, 8);
  assert.ok(m.conteggiTipi.some((t) => t.type === 'ADVANCED_FACE' && t.count === 6));
});
