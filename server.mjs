#!/usr/bin/env node
/**
 * Server statico minimo per aprire il visualizzatore nel browser.
 *
 *   node server.mjs [porta] [--rete]
 *
 * Ascolta solo su 127.0.0.1 (il computer locale): con --rete ascolta su tutte
 * le interfacce, per usare il visualizzatore da un altro dispositivo della
 * rete. Non serve mai file o cartelle il cui nome inizia con "." (.git ecc.).
 * I moduli ES e i web worker richiedono http://: aprire index.html con
 * file:// non funziona (per quello c'e' dist/visualizzatore-step.html).
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const argomenti = process.argv.slice(2);
const inRete = argomenti.includes('--rete');
const radice = resolve(argomenti.find((a) => !/^\d+$/.test(a) && !a.startsWith('--')) || '.');
const porta = Number(argomenti.find((a) => /^\d+$/.test(a))) || 8080;

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.stp': 'text/plain; charset=utf-8',
  '.step': 'text/plain; charset=utf-8',
};

const rispondi = (res, codice, testo) => {
  res.writeHead(codice, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(testo);
};

const server = createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    return rispondi(res, 400, 'URL non valido');
  }
  // niente file o cartelle nascosti (.git, .claude, ...) e niente risalite
  if (url.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')) return rispondi(res, 404, 'non trovato');
  let percorso = join(radice, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!percorso.startsWith(radice + sep) && percorso !== radice) return rispondi(res, 403, 'vietato');
  try {
    if (statSync(percorso).isDirectory()) percorso = join(percorso, 'index.html');
    if (!statSync(percorso).isFile()) return rispondi(res, 404, 'non trovato');
  } catch {
    return rispondi(res, 404, 'non trovato');
  }
  const flusso = createReadStream(percorso);
  flusso.on('error', () => rispondi(res, 404, 'non trovato'));
  flusso.once('open', () => {
    res.writeHead(200, {
      'content-type': TIPI[extname(percorso).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    flusso.pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`La porta ${porta} è già in uso: chiudi l'altra istanza oppure avvia con "node server.mjs ${porta + 1}".`);
  } else console.error(err.message);
  process.exit(1);
});

server.listen(porta, inRete ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Visualizzatore STEP su http://localhost:${porta}/  (radice: ${radice}${inRete ? ', raggiungibile dalla rete' : ''})`);
  console.log('Premi Ctrl+C per fermare il server.');
});
