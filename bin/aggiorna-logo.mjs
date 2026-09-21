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
import { deflateSync, inflateSync } from 'node:zlib';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const sorgente = process.argv[2] || join(radice, 'assets/logo-af.png');
const destinazione = join(radice, 'src/brand-logo.js');

/** Decodifica un PNG a 8 bit (RGB o RGBA) in pixel RGBA. */
function decodificaPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('non e\' un PNG');
  let p = 8;
  let w = 0, h = 0, bit = 0, colore = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const tipo = buf.toString('ascii', p + 4, p + 8);
    if (tipo === 'IHDR') {
      w = buf.readUInt32BE(p + 8);
      h = buf.readUInt32BE(p + 12);
      bit = buf[p + 16];
      colore = buf[p + 17];
      if (buf[p + 20] !== 0) throw new Error('PNG interlacciato non supportato');
    } else if (tipo === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (tipo === 'IEND') break;
    p += 12 + len;
  }
  if (bit !== 8 || (colore !== 2 && colore !== 6)) throw new Error(`PNG non supportato (bit ${bit}, tipo ${colore}): converti in RGB/RGBA a 8 bit`);
  const canali = colore === 6 ? 4 : 3;
  const stride = w * canali;
  const raw = inflateSync(Buffer.concat(idat));
  const righe = Buffer.alloc(h * stride);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const filtro = raw[off++];
    for (let i = 0; i < stride; i++) {
      const a = i >= canali ? righe[y * stride + i - canali] : 0;
      const b = y > 0 ? righe[(y - 1) * stride + i] : 0;
      const c = i >= canali && y > 0 ? righe[(y - 1) * stride + i - canali] : 0;
      let v = raw[off + i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filtro !== 0) throw new Error('filtro PNG sconosciuto: ' + filtro);
      righe[y * stride + i] = v & 255;
    }
    off += stride;
  }
  // porta tutto a RGBA
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++) {
    px[i * 4] = righe[j];
    px[i * 4 + 1] = righe[j + 1];
    px[i * 4 + 2] = righe[j + 2];
    px[i * 4 + 3] = canali === 4 ? righe[j + 3] : 255;
    j += canali;
  }
  return { w, h, px };
}

/** Ritaglia la cornice uniforme (trasparente o quasi bianca). */
function ritaglia({ w, h, px }) {
  const cornice = (x, y) => {
    const i = (y * w + x) * 4;
    return px[i + 3] < 24 || (px[i] > 238 && px[i + 1] > 238 && px[i + 2] > 238);
  };
  const rigaCornice = (y) => { for (let x = 0; x < w; x++) if (!cornice(x, y)) return false; return true; };
  const colCornice = (x) => { for (let y = 0; y < h; y++) if (!cornice(x, y)) return false; return true; };
  let alto = 0, basso = h - 1, sx = 0, dx = w - 1;
  while (alto < basso && rigaCornice(alto)) alto++;
  while (basso > alto && rigaCornice(basso)) basso--;
  while (sx < dx && colCornice(sx)) sx++;
  while (dx > sx && colCornice(dx)) dx--;
  const nw = dx - sx + 1;
  const nh = basso - alto + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) px.copy(out, y * nw * 4, ((y + alto) * w + sx) * 4, ((y + alto) * w + sx + nw) * 4);
  return { w: nw, h: nh, px: out, tagliato: { alto, basso: h - 1 - basso, sx, dx: w - 1 - dx } };
}

/** Codifica pixel RGBA in PNG, scegliendo per ogni riga il filtro piu' compatto. */
function codificaPng({ w, h, px }) {
  const stride = w * 4;
  const grezzo = Buffer.alloc(h * (stride + 1));
  const prova = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    let migliore = 0;
    let costoMigliore = Infinity;
    for (let filtro = 0; filtro <= 4; filtro++) {
      let costo = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? px[y * stride + i - 4] : 0;
        const b = y > 0 ? px[(y - 1) * stride + i] : 0;
        const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
        const v = px[y * stride + i];
        let d = v;
        if (filtro === 1) d = v - a;
        else if (filtro === 2) d = v - b;
        else if (filtro === 3) d = v - ((a + b) >> 1);
        else if (filtro === 4) {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          d = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        costo += Math.abs((d << 24) >> 24);
      }
      if (costo < costoMigliore) { costoMigliore = costo; migliore = filtro; }
    }
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
      const v = px[y * stride + i];
      let d = v;
      if (migliore === 1) d = v - a;
      else if (migliore === 2) d = v - b;
      else if (migliore === 3) d = v - ((a + b) >> 1);
      else if (migliore === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        d = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      prova[i] = d & 255;
    }
    grezzo[y * (stride + 1)] = migliore;
    prova.copy(grezzo, y * (stride + 1) + 1);
  }
  const blocco = (tipo, dati) => {
    const b = Buffer.alloc(dati.length + 12);
    b.writeUInt32BE(dati.length, 0);
    b.write(tipo, 4, 'ascii');
    dati.copy(b, 8);
    b.writeInt32BE(crc(Buffer.concat([Buffer.from(tipo, 'ascii'), dati])) | 0, dati.length + 8);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', ihdr),
    blocco('IDAT', deflateSync(grezzo, { level: 9 })),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

const TAB_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc(buf) {
  let c = -1;
  for (const b of buf) c = TAB_CRC[(c ^ b) & 255] ^ (c >>> 8);
  return c ^ -1;
}

const originale = readFileSync(sorgente);
let dataUrl;
let nota;
if (sorgente.toLowerCase().endsWith('.svg')) {
  dataUrl = 'data:image/svg+xml;base64,' + originale.toString('base64');
  nota = 'SVG incorporato senza modifiche';
} else {
  const img = ritaglia(decodificaPng(originale));
  const png = codificaPng(img);
  // se il ritaglio non conviene (immagine gia' senza cornice) si tiene l'originale
  const usaRitaglio = png.length <= originale.length * 1.35;
  dataUrl = 'data:image/png;base64,' + (usaRitaglio ? png : originale).toString('base64');
  nota = usaRitaglio
    ? `ritagliato a ${img.w}×${img.h} (cornice: ${JSON.stringify(img.tagliato)})`
    : 'originale (il ritaglio non riduceva il peso)';
}

writeFileSync(destinazione, `/**
 * Logo incorporato come data URI.
 * Generato da \`node bin/aggiorna-logo.mjs\` a partire da assets/logo-af.png:
 * non modificare a mano.
 */
export const LOGO_DATA_URL = '${dataUrl}';
`);
console.log(`scritto ${destinazione} — ${nota}, ${Math.round(dataUrl.length / 1024)} kB di data URI`);
