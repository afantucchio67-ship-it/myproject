import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeStepString, parseStep, valueToText } from '../src/step/parser.js';

const avvolgi = (corpo) =>
  `ISO-10303-21;\nHEADER;\nFILE_NAME('x','2026-01-01T00:00:00',(''),(''),'','','');\nENDSEC;\nDATA;\n${corpo}\nENDSEC;\nEND-ISO-10303-21;\n`;

test('legge valori, riferimenti, enumerazioni e liste', () => {
  const f = parseStep(avvolgi("#1=PUNTO('nome',(1.0,-2.5,3.0E1),#2,.T.,$,*);"));
  const e = f.entities.get(1);
  assert.equal(e.type, 'PUNTO');
  assert.deepEqual(e.params[0], { str: 'nome' });
  assert.deepEqual(e.params[1], [1, -2.5, 30]);
  assert.deepEqual(e.params[2], { ref: 2 });
  assert.deepEqual(e.params[3], { enum: 'T' });
  assert.equal(e.params[4], null);
  assert.deepEqual(e.params[5], { derived: true });
});

test('legge i record complessi (ereditarietà multipla)', () => {
  const f = parseStep(avvolgi('#3= (NAMED_UNIT(*)LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.));'));
  const e = f.entities.get(3);
  assert.deepEqual(e.types, ['NAMED_UNIT', 'LENGTH_UNIT', 'SI_UNIT']);
  assert.deepEqual(e.partParams('SI_UNIT')[1], { enum: 'METRE' });
  assert.ok(e.has('LENGTH_UNIT'));
});

test('gestisce apici raddoppiati, commenti e valori tipizzati', () => {
  const f = parseStep(avvolgi("/* commento */ #4=X('l''albero',LENGTH_MEASURE(2.5));"));
  const e = f.entities.get(4);
  assert.equal(e.params[0].str, "l'albero");
  assert.deepEqual(e.params[1], { typed: 'LENGTH_MEASURE', value: 2.5 });
});

test('decodifica le stringhe con caratteri estesi', () => {
  assert.equal(decodeStepString('\\X2\\00E800E9\\X0\\'), 'èé');
  assert.equal(decodeStepString('a\\X\\41b'), 'aAb');
});

test('indicizza i riferimenti inversi e i tipi', () => {
  const f = parseStep(avvolgi('#1=A(#2,#3);\n#2=B();\n#3=B();'));
  assert.deepEqual(f.referrers(2).map((e) => e.id), [1]);
  assert.equal(f.ofType('B').length, 2);
  assert.deepEqual(f.typeCounts()[0], { type: 'B', count: 2 });
});

test('segnala le righe non valide senza interrompere la lettura', () => {
  const f = parseStep(avvolgi('#1=A(;\n#2=B(1.0);'));
  assert.ok(f.entities.get(2), 'l’entità successiva viene comunque letta');
  assert.equal(f.warnings.length, 1);
});

test('ricostruisce il testo di un parametro', () => {
  assert.equal(valueToText([{ ref: 5 }, { str: 'a' }, { enum: 'T' }, null]), "(#5,'a',.T.,$)");
});
