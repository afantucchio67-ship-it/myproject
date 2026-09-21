import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';
import { entitaCSV, esportaOBJ, esportaSTL, facceCSV, partiCSV, reportHTML, reportJSON } from '../src/ui/exporters.js';
import { cercaEntita, entitaPerTipo, infoEntita, testoEntita } from '../src/step/esploratore.js';
import { MARCHIO } from '../src/brand.js';
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
  // numeri con la virgola decimale (Excel in italiano) e niente punti decimali
  const righe = partiCSV(m).split('\r\n');
  assert.ok(/;600,0*;1000,0*;/.test(righe[1]) || /;600;1000;/.test(righe[1]), righe[1]);
  assert.ok(!/\d\.\d/.test(righe[1]), 'nessun punto decimale: ' + righe[1]);
});

test('report HTML riporta la misura e il nome delle unità', () => {
  const m = modello();
  const html = reportHTML(m, null, { nomeFile: 'cubo.stp', misura: 'distanza 10,000 mm' });
  assert.ok(html.includes('distanza 10,000 mm'));
  assert.ok(/millimetri/i.test(html));
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

test('i riferimenti del marchio sono presenti in ogni esportazione', () => {
  const m = modello();
  const j = JSON.parse(reportJSON(m));
  assert.equal(j.generatoDa.autore, MARCHIO.nome);
  assert.equal(j.generatoDa.email, MARCHIO.email);
  assert.equal(j.generatoDa.telefono, MARCHIO.telefono);

  // CSV: la firma sta in coda, l'intestazione resta la prima riga
  for (const csv of [partiCSV(m), facceCSV(m), entitaCSV(m)]) {
    const righe = csv.split('\r\n');
    assert.ok(righe[0].includes(';'), 'prima riga = intestazione');
    assert.ok(righe.at(-1).startsWith(`Generato da;${MARCHIO.nome}`), righe.at(-1));
  }

  // STL: intestazione di 80 byte nel binario, firma dopo endsolid nell'ASCII
  const testa = new TextDecoder().decode(new Uint8Array(esportaSTL(m, { binario: true }), 0, 80));
  assert.ok(testa.includes(MARCHIO.nome), testa);
  const ascii = esportaSTL(m);
  assert.match(ascii, /\nendsolid [^\n]*\n; Antonio Fantucchio - Software Engineer/);

  const { obj, mtl } = esportaOBJ(m);
  assert.ok(obj.startsWith(`# ${MARCHIO.applicazione} - ${MARCHIO.nome}`), obj.slice(0, 80));
  assert.ok(obj.includes(MARCHIO.email) && mtl.includes(MARCHIO.email));

  // report stampabile: logo incorporato, contatti in testata e in piè di pagina
  const html = reportHTML(m, null, { nomeFile: 'cubo.stp' });
  assert.ok(html.includes('data:image/png;base64,'), 'logo incorporato');
  assert.ok(html.includes(MARCHIO.nome) && html.includes(MARCHIO.email) && html.includes(MARCHIO.telefono));
  assert.ok(html.includes('marchio-testata') && html.includes('marchio-pie'));
});

test('il logo incorporato è un PNG valido e leggero', () => {
  assert.match(MARCHIO.logo, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  const byte = Buffer.from(MARCHIO.logo.split(',')[1], 'base64');
  assert.deepEqual([...byte.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'firma PNG');
  assert.ok(byte.length < 120 * 1024, `logo di ${byte.length} byte: troppo pesante per il file unico`);
});
