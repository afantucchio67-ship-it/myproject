#!/usr/bin/env node
/**
 * Server statico minimo per aprire il visualizzatore nel browser.
 * Uso: node server.mjs [porta]
 * I moduli ES e i web worker richiedono http://: aprire index.html con
 * file:// non funziona.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const radice = resolve(process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : '.');
const porta = Number(process.argv.find((a) => /^\d+$/.test(a))) || 8080;

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

const server = createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('URL non valido');
    return;
  }
  let percorso = join(radice, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  try {
    if (statSync(percorso).isDirectory()) percorso = join(percorso, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('non trovato');
    return;
  }
  if (!percorso.startsWith(radice)) {
    res.writeHead(403);
    res.end('vietato');
    return;
  }
  res.writeHead(200, {
    'content-type': TIPI[extname(percorso).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(percorso).on('error', () => res.end()).pipe(res);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`La porta ${porta} è già in uso: chiudi l'altra istanza oppure avvia con "node server.mjs ${porta + 1}".`);
  } else console.error(err.message);
  process.exit(1);
});
server.listen(porta, () => {
  console.log(`Visualizzatore STEP su http://localhost:${porta}/  (radice: ${radice})`);
  console.log('Premi Ctrl+C per fermare il server.');
});
