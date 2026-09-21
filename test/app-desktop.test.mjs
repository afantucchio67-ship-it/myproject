import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const leggi = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('la pagina non contiene script in linea (la CSP dell’app li vieta)', () => {
  const html = leggi('index.html');
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(script.length >= 1, 'almeno uno script di avvio');
  for (const [, attributi, corpo] of script) {
    assert.match(attributi, /\ssrc="/, 'ogni script deve avere src');
    assert.equal(corpo.trim(), '', 'nessun codice in linea');
  }
});

test('l’app desktop è configurata per non essere modificabile', () => {
  const yml = leggi('electron-builder.yml');
  assert.match(yml, /^asar: true$/m, 'codice in app.asar');
  for (const chiave of ['onlyLoadAppFromAsar: true', 'enableEmbeddedAsarIntegrityValidation: true',
    'runAsNode: false', 'enableNodeCliInspectArguments: false', 'enableNodeOptionsEnvironmentVariable: false']) {
    assert.ok(yml.includes(chiave), 'manca ' + chiave);
  }
  // nel pacchetto vanno solo i file dell'applicazione
  assert.ok(yml.includes("- '!**/*.test.*'"), 'i test non vanno impacchettati');
  for (const necessario of ['- index.html', '- css/**/*', '- src/**/*', '- desktop/**/*']) {
    assert.ok(yml.includes(necessario), 'manca ' + necessario);
  }
});

test('la finestra dell’app è isolata e senza strumenti di sviluppo', () => {
  const main = leggi('desktop/main.js');
  assert.match(main, /devTools: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.ok(!/nodeIntegration: true/.test(main));
  // niente accesso fuori dalla cartella dell'app nel protocollo interno
  assert.match(main, /accesso negato/);
  // la CSP consente solo il codice dell'app
  assert.match(main, /"default-src 'none'"/);
  assert.match(main, /"script-src 'self'"/);
});

test('package.json punta all’app desktop', () => {
  const pkg = JSON.parse(leggi('package.json'));
  assert.equal(pkg.main, 'desktop/main.js');
  assert.equal(pkg.productName, 'Visualizzatore STEP');
  assert.equal(pkg.author.email, 'a.fantucchio67@gmail.com');
  for (const script of ['app', 'app:win', 'app:mac', 'app:linux', 'icone']) {
    assert.ok(pkg.scripts[script], 'manca lo script ' + script);
  }
});

test('le icone dell’app esistono nei tre formati', () => {
  const png = readFileSync(new URL('../build/icona.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1024, 'icona.png 1024×1024');
  const ico = readFileSync(new URL('../build/icona.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1, 'tipo icona');
  assert.ok(ico.readUInt16LE(4) >= 6, 'più dimensioni nell’ico');
  const icns = readFileSync(new URL('../build/icona.icns', import.meta.url));
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length, 'lunghezza dichiarata coerente');
});
