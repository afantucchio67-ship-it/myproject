/**
 * Utilita' PNG senza dipendenze: decodifica, ricampionamento, angoli
 * arrotondati e codifica. Serve agli strumenti di build (logo e icone).
 * Supporta PNG a 8 bit, RGB o RGBA, non interlacciati.
 */
import { deflateSync, inflateSync } from 'node:zlib';

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

/** @returns {{w:number, h:number, px:Buffer}} pixel RGBA */
export function decodificaPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("non e' un PNG");
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
  if (bit !== 8 || (colore !== 2 && colore !== 6)) {
    throw new Error(`PNG non supportato (bit ${bit}, tipo colore ${colore}): serve RGB o RGBA a 8 bit`);
  }
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

/** Codifica pixel RGBA in PNG scegliendo per ogni riga il filtro piu' compatto. */
export function codificaPng({ w, h, px }) {
  const stride = w * 4;
  const differenza = (filtro, y, i) => {
    const a = i >= 4 ? px[y * stride + i - 4] : 0;
    const b = y > 0 ? px[(y - 1) * stride + i] : 0;
    const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
    const v = px[y * stride + i];
    if (filtro === 1) return v - a;
    if (filtro === 2) return v - b;
    if (filtro === 3) return v - ((a + b) >> 1);
    if (filtro === 4) {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      return v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    return v;
  };
  const grezzo = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    let migliore = 0;
    let costoMigliore = Infinity;
    for (let filtro = 0; filtro <= 4; filtro++) {
      let costo = 0;
      for (let i = 0; i < stride; i++) costo += Math.abs((differenza(filtro, y, i) << 24) >> 24);
      if (costo < costoMigliore) { costoMigliore = costo; migliore = filtro; }
    }
    grezzo[y * (stride + 1)] = migliore;
    for (let i = 0; i < stride; i++) grezzo[y * (stride + 1) + 1 + i] = differenza(migliore, y, i) & 255;
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
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', ihdr),
    blocco('IDAT', deflateSync(grezzo, { level: 9 })),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

/** Ritaglia la cornice uniforme (trasparente o quasi bianca). */
export function ritagliaCornice({ w, h, px }) {
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

/**
 * Ricampiona a (nw, nh): media d'area quando si rimpicciolisce (niente
 * scalettature), bicubica Catmull-Rom quando si ingrandisce.
 */
export function ridimensiona({ w, h, px }, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  const sx = w / nw;
  const sy = h / nh;
  const campione = (x, y, c) => px[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4 + c];
  if (sx >= 1 || sy >= 1) {
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor(x * sx);
        const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
        for (let c = 0; c < 4; c++) {
          let somma = 0;
          let n = 0;
          for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) { somma += campione(xx, yy, c); n++; }
          }
          out[(y * nw + x) * 4 + c] = Math.round(somma / n);
        }
      }
    }
    return { w: nw, h: nh, px: out };
  }
  const peso = (t) => {
    const a = Math.abs(t);
    if (a <= 1) return 1.5 * a ** 3 - 2.5 * a ** 2 + 1;
    if (a < 2) return -0.5 * a ** 3 + 2.5 * a ** 2 - 4 * a + 2;
    return 0;
  };
  for (let y = 0; y < nh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const iy = Math.floor(fy);
    for (let x = 0; x < nw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const ix = Math.floor(fx);
      for (let c = 0; c < 4; c++) {
        let somma = 0;
        let pesi = 0;
        for (let j = -1; j <= 2; j++) {
          const wy = peso(fy - (iy + j));
          if (!wy) continue;
          for (let i = -1; i <= 2; i++) {
            const wx = peso(fx - (ix + i));
            if (!wx) continue;
            somma += campione(ix + i, iy + j, c) * wx * wy;
            pesi += wx * wy;
          }
        }
        out[(y * nw + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(somma / (pesi || 1))));
      }
    }
  }
  return { w: nw, h: nh, px: out };
}

/** Immagine quadrata: sfondo pieno, contenuto centrato con margine (0…0.4). */
export function iconaQuadrata(img, lato, { sfondo = [59, 57, 55, 255], margine = 0.06, raggio = 0 } = {}) {
  const px = Buffer.alloc(lato * lato * 4);
  for (let i = 0; i < lato * lato; i++) {
    px[i * 4] = sfondo[0];
    px[i * 4 + 1] = sfondo[1];
    px[i * 4 + 2] = sfondo[2];
    px[i * 4 + 3] = sfondo[3];
  }
  const dentro = Math.round(lato * (1 - margine * 2));
  const scala = Math.min(dentro / img.w, dentro / img.h);
  const cw = Math.max(1, Math.round(img.w * scala));
  const ch = Math.max(1, Math.round(img.h * scala));
  const piccola = ridimensiona(img, cw, ch);
  const ox = Math.round((lato - cw) / 2);
  const oy = Math.round((lato - ch) / 2);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y * cw + x) * 4;
      const d = ((y + oy) * lato + x + ox) * 4;
      const a = piccola.px[s + 3] / 255;
      for (let c = 0; c < 3; c++) px[d + c] = Math.round(piccola.px[s + c] * a + px[d + c] * (1 - a));
      px[d + 3] = Math.max(px[d + 3], piccola.px[s + 3]);
    }
  }
  const out = { w: lato, h: lato, px };
  return raggio > 0 ? arrotondaAngoli(out, raggio * lato) : out;
}

/** Angoli arrotondati con bordo sfumato (antialias). */
export function arrotondaAngoli({ w, h, px }, r) {
  const copia = Buffer.from(px);
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d = null;
      if (x < r && y < r) d = dist(x + 0.5, y + 0.5, r, r);
      else if (x >= w - r && y < r) d = dist(x + 0.5, y + 0.5, w - r, r);
      else if (x < r && y >= h - r) d = dist(x + 0.5, y + 0.5, r, h - r);
      else if (x >= w - r && y >= h - r) d = dist(x + 0.5, y + 0.5, w - r, h - r);
      if (d === null) continue;
      const alfa = Math.max(0, Math.min(1, r - d + 0.5));
      const i = (y * w + x) * 4;
      copia[i + 3] = Math.round(copia[i + 3] * alfa);
    }
  }
  return { w, h, px: copia };
}

/** Icona Windows (.ico) con dentro piu' PNG. */
export function creaIco(immagini) {
  const voci = immagini.map((img) => ({ lato: img.w, dati: codificaPng(img) }));
  const testa = Buffer.alloc(6 + voci.length * 16);
  testa.writeUInt16LE(0, 0);
  testa.writeUInt16LE(1, 2); // tipo icona
  testa.writeUInt16LE(voci.length, 4);
  let offset = testa.length;
  voci.forEach((v, i) => {
    const p = 6 + i * 16;
    testa[p] = v.lato >= 256 ? 0 : v.lato;
    testa[p + 1] = v.lato >= 256 ? 0 : v.lato;
    testa[p + 2] = 0;
    testa[p + 3] = 0;
    testa.writeUInt16LE(1, p + 4);
    testa.writeUInt16LE(32, p + 6);
    testa.writeUInt32LE(v.dati.length, p + 8);
    testa.writeUInt32LE(offset, p + 12);
    offset += v.dati.length;
  });
  return Buffer.concat([testa, ...voci.map((v) => v.dati)]);
}

/** Icona macOS (.icns) con i tipi PNG moderni. */
export function creaIcns(perLato) {
  const TIPI = [
    ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024],
  ];
  const blocchi = [];
  for (const [tipo, lato] of TIPI) {
    const img = perLato(lato);
    if (!img) continue;
    const dati = codificaPng(img);
    const testa = Buffer.alloc(8);
    testa.write(tipo, 0, 'ascii');
    testa.writeUInt32BE(dati.length + 8, 4);
    blocchi.push(testa, dati);
  }
  const corpo = Buffer.concat(blocchi);
  const testa = Buffer.alloc(8);
  testa.write('icns', 0, 'ascii');
  testa.writeUInt32BE(corpo.length + 8, 4);
  return Buffer.concat([testa, corpo]);
}
