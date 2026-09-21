/**
 * Rigenera `src/brand-logo.js` dal logo in `assets/logo-af.png`.
 *
 * Il logo viene incorporato come data URI perche' il visualizzatore funziona
 * anche come singolo file HTML aperto con doppio clic: nessuna risorsa esterna.
 * La cornice uniforme (bianca o trasparente) attorno all'immagine viene
 * ritagliata, cosi' il marchio resta pulito su sfondo chiaro e su sfondo scuro.
 *
 * Uso: node bin/aggiorna-logo.mjs [immagine.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codificaPng, decodificaPng, ritagliaCornice } from './lib/png.mjs';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const sorgente = process.argv[2] || join(radice, 'assets/logo-af.png');
const destinazione = join(radice, 'src/brand-logo.js');

const originale = readFileSync(sorgente);
let dataUrl;
let nota;
if (sorgente.toLowerCase().endsWith('.svg')) {
  dataUrl = 'data:image/svg+xml;base64,' + originale.toString('base64');
  nota = 'SVG incorporato senza modifiche';
} else {
  const img = ritagliaCornice(decodificaPng(originale));
  const png = codificaPng(img);
  // se il ritaglio non conviene (immagine gia' senza cornice) si tiene l'originale
  const usaRitaglio = png.length <= originale.length * 1.35;
  dataUrl = 'data:image/png;base64,' + (usaRitaglio ? png : originale).toString('base64');
  nota = usaRitaglio
    ? `ritagliato a ${img.w}x${img.h} (cornice: ${JSON.stringify(img.tagliato)})`
    : 'originale (il ritaglio non riduceva il peso)';
}

writeFileSync(destinazione, `/**
 * Logo incorporato come data URI.
 * Generato da \`node bin/aggiorna-logo.mjs\` a partire da assets/logo-af.png:
 * non modificare a mano.
 */
export const LOGO_DATA_URL = '${dataUrl}';
`);
console.log(`scritto ${destinazione} - ${nota}, ${Math.round(dataUrl.length / 1024)} kB di data URI`);
