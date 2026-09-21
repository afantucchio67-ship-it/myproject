/**
 * Genera le icone dell'app desktop dal logo in `assets/logo-af.png`:
 *
 *   build/icona.png    1024×1024  (Linux e base per gli altri formati)
 *   build/icona.ico    16…256     (Windows)
 *   build/icona.icns   16…1024    (macOS, angoli arrotondati come da stile)
 *
 * Nessuna dipendenza esterna: PNG letto, ricampionato e riscritto in casa.
 * Uso: node bin/genera-icone.mjs [logo.png]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { creaIcns, creaIco, decodificaPng, codificaPng, iconaQuadrata, ritagliaCornice } from './lib/png.mjs';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const sorgente = process.argv[2] || join(radice, 'assets/logo-af.png');
const cartella = join(radice, 'build');
mkdirSync(cartella, { recursive: true });

const logo = ritagliaCornice(decodificaPng(readFileSync(sorgente)));
// sfondo preso dall'angolo del logo: l'icona resta di un pezzo
const i0 = 0;
const sfondo = [logo.px[i0], logo.px[i0 + 1], logo.px[i0 + 2], 255];

const quadrata = (lato, raggio = 0) => iconaQuadrata(logo, lato, { sfondo, margine: 0.08, raggio });

const png = codificaPng(quadrata(1024));
writeFileSync(join(cartella, 'icona.png'), png);

// Windows: piena, senza angoli arrotondati (li disegna il sistema)
const ico = creaIco([16, 24, 32, 48, 64, 128, 256].map((l) => quadrata(l)));
writeFileSync(join(cartella, 'icona.ico'), ico);

// macOS: angoli arrotondati (circa 22% del lato, come le icone di sistema)
const icns = creaIcns((lato) => quadrata(lato, 0.22));
writeFileSync(join(cartella, 'icona.icns'), icns);

const kb = (n) => `${Math.round(n / 1024)} kB`;
console.log(`logo ${logo.w}×${logo.h} →`);
console.log(`  build/icona.png   1024×1024  ${kb(png.length)}`);
console.log(`  build/icona.ico   16…256     ${kb(ico.length)}`);
console.log(`  build/icona.icns  16…1024    ${kb(icns.length)}`);
