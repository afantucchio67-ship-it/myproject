#!/usr/bin/env node
/**
 * Costruisce la versione a file unico: dist/visualizzatore-step.html
 *
 * Unisce HTML, CSS e tutti i moduli in un solo file apribile con un doppio
 * clic (protocollo file://), dove import fra file e web worker non sono
 * disponibili. I moduli restano invariati: qui vengono solo registrati in un
 * piccolo caricatore interno che risolve gli import a runtime.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const radice = resolve('.');
const ingresso = 'src/ui/app.js';

const moduli = new Map();

/** Risolve un import relativo rispetto al modulo che lo contiene. */
function risolvi(da, spec) {
  return relative(radice, resolve(dirname(join(radice, da)), spec)).replace(/\\/g, '/');
}

/** Trasforma un modulo ES in una funzione registrata nel caricatore. */
function converti(percorso) {
  if (moduli.has(percorso)) return;
  moduli.set(percorso, null); // segnaposto: evita cicli infiniti
  let codice = readFileSync(join(radice, percorso), 'utf8');
  const esportati = new Set();
  const dipendenze = [];

  // import { a, b as c } from './x.js';
  codice = codice.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, nomi, spec) => {
      const dep = risolvi(percorso, spec);
      dipendenze.push(dep);
      const lista = nomi
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const m = n.match(/^(\S+)\s+as\s+(\S+)$/);
          return m ? `${m[1]}: ${m[2]}` : n;
        })
        .join(', ');
      return `const { ${lista} } = __richiedi('${dep}');`;
    },
  );

  // import dinamico: import('./x.js') -> promessa gia' risolta
  codice = codice.replace(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, (_, spec) => {
    const dep = risolvi(percorso, spec);
    dipendenze.push(dep);
    return `Promise.resolve(__richiedi('${dep}'))`;
  });

  // export ... -> dichiarazione normale, con annotazione del nome esportato
  codice = codice.replace(/export\s+(async\s+)?function\s*(\*?)\s*(\w+)/g, (_, asy, gen, nome) => {
    esportati.add(nome);
    return `${asy || ''}function${gen ? '* ' : ' '}${nome}`;
  });
  codice = codice.replace(/export\s+class\s+(\w+)/g, (_, nome) => {
    esportati.add(nome);
    return `class ${nome}`;
  });
  codice = codice.replace(/export\s+(const|let|var)\s+(\w+)/g, (_, tipo, nome) => {
    esportati.add(nome);
    return `${tipo} ${nome}`;
  });
  codice = codice.replace(/export\s*\{([^}]*)\};?/g, (_, nomi) => {
    nomi.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => esportati.add(n.split(/\s+as\s+/)[0]));
    return '';
  });

  for (const dep of dipendenze) converti(dep);

  // dentro uno <script> inline la sequenza "</script" chiuderebbe l'elemento
  codice = codice.replace(/<\/script/gi, '<\\/script');

  const registro = [...esportati].map((n) => `${n}`).join(', ');
  moduli.set(
    percorso,
    `__definisci('${percorso}', (esporta, __richiedi) => {\n${codice}\n` +
      (registro ? `Object.assign(esporta, { ${registro} });\n` : '') +
      '});\n',
  );
}

converti(ingresso);

const caricatore = `
// caricatore minimo: i moduli restano scritti come moduli ES
const __registro = {};
function __definisci(nome, corpo) { __registro[nome] = { corpo, esporta: null }; }
function __richiedi(nome) {
  const m = __registro[nome];
  if (!m) throw new Error('modulo mancante: ' + nome);
  if (!m.esporta) { m.esporta = {}; m.corpo(m.esporta, __richiedi); }
  return m.esporta;
}
globalThis.__VISUALIZZATORE_FILE_UNICO = true;
`;

const css = readFileSync(join(radice, 'css/app.css'), 'utf8');
let html = readFileSync(join(radice, 'index.html'), 'utf8');
// sostituzioni con funzione: il codice contiene $ e non deve essere
// interpretato come riferimento ai gruppi della regex
html = html.replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}\n</style>`);
const script =
  `<script type="module">\n${caricatore}\n${[...moduli.values()].join('\n')}\n` +
  `__richiedi('${ingresso}').avvia();\n</script>`;
html = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => script);
html = html.replace('<title>', () => '<!-- versione a file unico: generata da build.mjs -->\n<title>');

mkdirSync(join(radice, 'dist'), { recursive: true });
const uscita = join(radice, 'dist/visualizzatore-step.html');
writeFileSync(uscita, html);
console.log(`scritto ${uscita} (${(html.length / 1024).toFixed(0)} kB, ${moduli.size} moduli)`);
