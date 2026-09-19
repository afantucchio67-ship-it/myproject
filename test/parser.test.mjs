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

test('legge i numeri con punto finale e le varianti degli esportatori CAD', () => {
  const f = parseStep(avvolgi("#1=X(10.,0.,1.E-3,3.D0,-.5,+2.5E+1,7);"));
  assert.deepEqual(f.entities.get(1).params, [10, 0, 0.001, 3, -0.5, 25, 7]);
  assert.equal(f.warnings.length, 0);
});

test('non va in loop su testi senza punto e virgola o troncati', () => {
  for (const testo of ['Data di consegna: 12/03/2026', 'Reference: ordine 5', 'ISO-10303-21;\nHEADER;\nDATA', 'ISO-10303-21;\nDATA;\n#1=A(', '']) {
    const t0 = Date.now();
    const f = parseStep(testo);
    assert.ok(Date.now() - t0 < 2000, 'lettura terminata');
    assert.ok(f.warnings.length >= 1, 'segnala il problema');
  }
});

test('riconosce un testo STEP', async () => {
  const { isStepText } = await import('../src/step/parser.js');
  assert.ok(isStepText('ISO-10303-21;\nHEADER;'));
  assert.ok(isStepText('\uFEFF  ISO-10303-21 ;'));
  assert.ok(!isStepText('%PDF-1.4'));
});
