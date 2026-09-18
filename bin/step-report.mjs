#!/usr/bin/env node
/**
 * Report da riga di comando su uno o piu' file STEP.
 *
 *   node bin/step-report.mjs modello.stp              riepilogo leggibile
 *   node bin/step-report.mjs modello.stp --json       report completo JSON
 *   node bin/step-report.mjs modello.stp --csv facce  CSV (facce|parti|entita)
 *   node bin/step-report.mjs *.stp --tolleranza 0.05
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a) ||
  (!a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--tolleranza' && !/^[\d.]+$/.test(a)));
const flag = (nome) => argv.includes('--' + nome);
const valore = (nome, dflt) => {
  const i = argv.indexOf('--' + nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

if (!files.length) {
  console.error('Uso: node bin/step-report.mjs <file.stp> [--json] [--csv facce|parti|entita] [--tolleranza 0.1]');
  process.exit(1);
}

const tolleranza = Number(valore('tolleranza', '0.1'));
const fmt = (v, d = 2) =>
  typeof v === 'number' ? v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v);

for (const percorso of files) {
  const testo = readFileSync(percorso, 'latin1');
  const file = parseStep(testo);
  const model = buildModel(file, { tolerance: tolleranza });
  model.nomeFileCaricato = basename(percorso);

  if (flag('json')) {
    const { reportJSONCli } = await import('./report-json.mjs');
    console.log(reportJSONCli(model));
    continue;
  }
  if (flag('csv')) {
    const quale = valore('csv', 'parti');
    const { csvCli } = await import('./report-json.mjs');
    console.log(csvCli(model, quale));
    continue;
  }

  const h = model.header;
  const u = model.units;
  const um = u.simbolo || 'mm';
  console.log(`\n=== ${basename(percorso)} ===`);
  console.log(`schema            : ${h.schema}`);
  console.log(`nome dichiarato   : ${h.nomeFile}`);
  console.log(`data              : ${h.dataFile}`);
  console.log(`origine           : ${h.versionePreprocessore} ${h.sistemaOrigine.trim()}`);
  console.log(`unità             : ${u.lunghezza ? u.lunghezza.nome : 'n.d.'} / ${u.angolo ? u.angolo.nome : 'n.d.'}` +
    (u.incertezza ? ` · incertezza ${u.incertezza.valore}` : ''));
  console.log(`entità            : ${model.statistiche.entita} (${model.statistiche.tipi} tipi) in ${model.statistiche.msLettura} ms`);
  console.log(`ingombro          : ${model.bbox.size.map((x) => fmt(x, 2)).join(' × ')} ${um}`);
  console.log(`area / volume     : ${fmt(model.statistiche.areaTotale, 1)} ${um}² / ` +
    `${fmt(model.statistiche.volumeTotale, 1)} ${um}³`);
  console.log(`triangoli         : ${model.statistiche.triangoli}`);

  if (model.prodotti.length) {
    console.log('\nprodotti:');
    for (const p of model.prodotti) {
      console.log(`  - ${p.codice}${p.descrizione ? ` (${p.descrizione})` : ''}${p.categorie.length ? ` [${p.categorie.join(', ')}]` : ''}`);
    }
  }

  if (model.assieme.length) {
    console.log('\nstruttura:');
    const stampa = (n, ind) => {
      console.log(`  ${ind}${n.nome}${n.items.length ? ` — ${n.items.length} geom.` : ''}`);
      n.figli.forEach((c) => stampa(c, ind + '  '));
    };
    model.assieme.forEach((n) => stampa(n, ''));
  }

  console.log('\nparti:');
  for (const p of model.parti) {
    const vol = !p.chiusa
      ? 'n.d.'
      : p.volumeEsatto
        ? `${fmt(p.volume, 1)} ${um}³`
        : p.volumeAffidabile
          ? `≈ ${fmt(p.volume, 1)} ${um}³`
          : `n.d. (${p.bordiAperti} bordi aperti)`;
    console.log(`  - ${p.nome}: ${p.facce.length} facce, ${p.mesh.indices.length / 3} tri, ` +
      `area ${fmt(p.area, 1)} ${um}², volume ${vol}, ` +
      `ingombro ${p.bbox.size.map((x) => fmt(x, 1)).join('×')} ${um}`);
  }

  if (model.proprieta.length) {
    console.log('\nproprietà:');
    for (const p of model.proprieta) console.log(`  ${p.nome}: ${p.valore}`);
  }

  const org = model.organizzazione;
  if (org.persone.length || org.approvazioni.length) {
    console.log('\norganizzazione:');
    const volte = (n) => (n > 1 ? ` (x${n})` : '');
    for (const p of org.persone) {
      console.log(`  ${p.persona || '—'} @ ${p.organizzazione || '—'} [${p.ruoli.join(', ')}]${volte(p.occorrenze)}`);
    }
    for (const a of org.approvazioni) console.log(`  approvazione: ${a.stato} ${a.data}${volte(a.occorrenze)}`);
    for (const s of org.sicurezza) console.log(`  classificazione: ${s.livello}${volte(s.occorrenze)}`);
  }

  console.log('\nentità più frequenti:');
  for (const t of model.conteggiTipi.slice(0, 12)) console.log(`  ${String(t.count).padStart(6)}  ${t.type}`);

  if (model.diagnostics.length) {
    console.log('\nsegnalazioni:');
    for (const d of model.diagnostics.slice(0, 20)) console.log('  ! ' + d);
  }
}
