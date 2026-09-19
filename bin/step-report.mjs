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
import { isStepText, parseStep } from '../src/step/parser.js';
import { buildModel } from '../src/step/model.js';
import { entitaCSV, facceCSV, partiCSV, reportJSON } from '../src/ui/exporters.js';

const USO = 'Uso: node bin/step-report.mjs <file.stp> [...] [--json] [--csv facce|parti|entita] [--tolleranza 0.1]';

/** Analisi degli argomenti: le opzioni con valore consumano il token successivo. */
function leggiArgomenti(argv) {
  const opzioni = { files: [], json: false, csv: null, tolleranza: 0.1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opzioni.json = true;
    else if (a === '--csv') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) opzioni.csv = 'parti';
      else {
        opzioni.csv = v;
        i++;
      }
    } else if (a === '--tolleranza' || a === '--tolerance') {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v <= 0) {
        console.error('--tolleranza richiede un numero positivo (mm)');
        process.exit(1);
      }
      opzioni.tolleranza = v;
      i++;
    } else if (a === '--help' || a === '-h') {
      console.log(USO);
      process.exit(0);
    } else if (a.startsWith('--')) {
      console.error(`opzione sconosciuta: ${a}\n${USO}`);
      process.exit(1);
    } else opzioni.files.push(a);
  }
  return opzioni;
}

const opzioni = leggiArgomenti(process.argv.slice(2));
if (!opzioni.files.length) {
  console.error(USO);
  process.exit(1);
}
if (opzioni.csv && !['facce', 'parti', 'entita'].includes(opzioni.csv)) {
  console.error(`--csv accetta facce, parti o entita (ricevuto: ${opzioni.csv})`);
  process.exit(1);
}

/** Stessa decodifica dell'interfaccia: UTF-8 rigoroso, altrimenti Windows-1252; via il BOM. */
function decodifica(buffer) {
  let bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const fmt = (v, d = 2) =>
  typeof v === 'number' ? v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v);

let errori = 0;
for (const percorso of opzioni.files) {
  let testo;
  try {
    testo = decodifica(readFileSync(percorso));
  } catch (err) {
    console.error(`${percorso}: impossibile leggere il file (${err.code || err.message})`);
    errori++;
    continue;
  }
  if (!isStepText(testo)) {
    console.error(`${percorso}: non è un file STEP (manca l'intestazione ISO-10303-21)`);
    errori++;
    continue;
  }
  let model;
  try {
    const file = parseStep(testo);
    model = buildModel(file, { tolerance: opzioni.tolleranza });
  } catch (err) {
    console.error(`${percorso}: errore durante l'elaborazione: ${err.message}`);
    errori++;
    continue;
  }
  model.nomeFileCaricato = basename(percorso);

  if (opzioni.json) {
    console.log(reportJSON(model));
    continue;
  }
  if (opzioni.csv) {
    const gen = { facce: facceCSV, parti: partiCSV, entita: entitaCSV }[opzioni.csv];
    console.log(gen(model).replace(/^﻿/, ''));
    continue;
  }

  const h = model.header;
  const u = model.units;
  const um = u.simbolo || 'mm';
  console.log(`\n=== ${basename(percorso)} ===`);
  console.log(`schema            : ${h.schema}`);
  console.log(`nome dichiarato   : ${h.nomeFile}`);
  console.log(`data              : ${h.dataFile}`);
  console.log(`origine           : ${[h.versionePreprocessore, h.sistemaOrigine.trim()].filter(Boolean).join(' ')}`);
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
process.exit(errori ? 1 : 0);
