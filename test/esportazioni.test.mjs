import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';
import { entitaCSV, esportaOBJ, esportaSTL, facceCSV, partiCSV, reportHTML, reportJSON } from '../src/ui/exporters.js';
import { cercaEntita, entitaPerTipo, infoEntita, testoEntita } from '../src/step/esploratore.js';
import { cuboStep } from './fixtures.mjs';

const modello = () => {
  const m = buildModel(parseStep(cuboStep(10)), { tolerance: 0.05 });
  m.nomeFileCaricato = 'cubo.stp';
  m.parti.forEach((p) => { p.visibile = true; p.colore = [0.2, 0.4, 0.6]; });
  return m;
};

test('STL binario: dimensione e conteggio dei triangoli coerenti', () => {
  const m = modello();
  const buf = esportaSTL(m, { binario: true });
  const tri = m.parti[0].mesh.indices.length / 3;
  assert.equal(buf.byteLength, 84 + 50 * tri);
  assert.equal(new DataView(buf).getUint32(80, true), tri);
});

test('STL ASCII e OBJ: struttura del testo', () => {
  const m = modello();
  const stl = esportaSTL(m);
  assert.ok(stl.startsWith('solid '));
  assert.equal((stl.match(/facet normal/g) || []).length, m.parti[0].mesh.indices.length / 3);
  const { obj, mtl } = esportaOBJ(m);
  assert.equal((obj.match(/^v /gm) || []).length, m.parti[0].mesh.positions.length / 3);
  assert.equal((obj.match(/^f /gm) || []).length, m.parti[0].mesh.indices.length / 3);
  assert.ok(mtl.includes('newmtl') && mtl.includes('Kd 0.2000 0.4000 0.6000'));
});

test('le parti nascoste sono escluse quando richiesto', () => {
  const m = modello();
  m.parti[0].visibile = false;
  assert.equal(esportaSTL(m, { binario: true, soloVisibili: true }).byteLength, 84);
  assert.equal(esportaOBJ(m, { soloVisibili: true }).obj.match(/^f /gm), null);
});

test('CSV: BOM, separatore ; e unità nelle intestazioni', () => {
  const m = modello();
  for (const csv of [partiCSV(m), facceCSV(m), entitaCSV(m)]) {
    assert.ok(csv.startsWith('﻿'));
    assert.ok(csv.split('\r\n').length > 1);
  }
  assert.ok(partiCSV(m).includes('area_mm2;volume_mm3'));
});

test('report JSON e HTML contengono le misure', () => {
  const m = modello();
  const j = JSON.parse(reportJSON(m));
  assert.equal(j.parti.length, 1);
  assert.ok(Math.abs(j.parti[0].volume - 1000) < 1e-6);
  const html = reportHTML(m, null, { nomeFile: 'cubo.stp' });
  assert.ok(html.includes('<title>Report — cubo.stp</title>'));
  // il sorgente non deve contenere la sequenza "</script>" letterale: chiuderebbe
  // lo script inline del file unico (nel report generato il tag e' normale)
  const sorgente = readFileSync(new URL('../src/ui/exporters.js', import.meta.url), 'utf8');
  assert.ok(!/<\/script>/.test(sorgente));
  assert.ok(html.includes('</script>'));
});

test("esploratore: testo, riferimenti e ricerca per tipo, id e testo", () => {
  const f = parseStep(cuboStep(10));
  const facce = entitaPerTipo(f, 'ADVANCED_FACE');
  assert.equal(facce.totale, 6);
  const info = infoEntita(f, facce.risultati[0].id);
  assert.ok(info.testo.startsWith(`#${info.id}=ADVANCED_FACE(`));
  assert.ok(info.riferimenti.length >= 2 && info.citataDa.length >= 1);
  assert.equal(cercaEntita(f, `#${info.id}`).risultati[0].id, info.id);
  assert.ok(cercaEntita(f, 'PLANE').totale >= 6);
  assert.ok(cercaEntita(f, 'cubo di prova').totale >= 1, 'ricerca nel testo');
  assert.equal(infoEntita(f, 999999), null);
  assert.equal(testoEntita(f.entities.get(info.id)), info.testo);
});
