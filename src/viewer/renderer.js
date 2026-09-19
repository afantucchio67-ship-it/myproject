/**
 * Renderer WebGL minimale (senza librerie esterne).
 *
 * Disegna le parti tassellate con illuminazione a due lati, gli spigoli del
 * modello, la bounding box, gli assi, il piano di sezione e gli elementi di
 * misura. Gli uniform, i colori fissi e le matrici per parte sono in cache:
 * nel disegno ordinario non si alloca nulla per fotogramma.
 */

import { identity, invert, multiply, transpose } from './mat4.js';

const VS = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNormal;
attribute float aFaceId;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vFaceId;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = uNormalMat * aNormal;
  vFaceId = aFaceId;
  gl_Position = uViewProj * world;
}`;

const FS = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vFaceId;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uOpacity;
uniform float uSelectedFace;
uniform float uHoverFace;
uniform float uSelectedPart;   // 1 = parte selezionata (bordo piu' chiaro)
uniform vec4 uClipPlane;       // xyz = normale, w = offset; attivo se uClipOn > 0.5
uniform float uClipOn;
void main() {
  if (uClipOn > 0.5 && dot(vWorld, uClipPlane.xyz) > uClipPlane.w) discard;
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uEye - vWorld);
  if (dot(n, viewDir) < 0.0) n = -n;          // illuminazione a due lati
  vec3 l1 = normalize(vec3(0.35, 0.45, 0.82));
  vec3 l2 = normalize(vec3(-0.6, -0.3, 0.4));
  float diff = 0.72 * max(dot(n, l1), 0.0) + 0.28 * max(dot(n, l2), 0.0);
  vec3 h = normalize(l1 + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 42.0) * 0.28;
  vec3 base = uColor;
  if (abs(vFaceId - uSelectedFace) < 0.5) base = mix(base, vec3(1.0, 0.62, 0.16), 0.8);
  else if (abs(vFaceId - uHoverFace) < 0.5) base = mix(base, vec3(0.45, 0.85, 1.0), 0.6);
  else if (uSelectedPart > 0.75) base = mix(base, vec3(1.0, 0.85, 0.55), 0.35);   // parte selezionata
  else if (uSelectedPart > 0.25) base = mix(base, vec3(0.6, 0.85, 1.0), 0.3);     // parte sotto il puntatore (tabella)
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.12;
  vec3 col = base * (0.30 + 0.70 * diff) + vec3(spec) + vec3(rim);
  gl_FragColor = vec4(col, uOpacity);
}`;

const LINE_VS = `
precision highp float;
attribute vec3 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform float uPointSize;
uniform float uDepthBias;
varying vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
  gl_Position.z -= uDepthBias * gl_Position.w;   // evita lo z-fighting con le facce
  gl_PointSize = uPointSize;
}`;

const LINE_FS = `
precision highp float;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uClipPlane;
uniform float uClipOn;
uniform float uRound;
void main() {
  if (uClipOn > 0.5 && dot(vWorld, uClipPlane.xyz) > uClipPlane.w) discard;
  if (uRound > 0.5) {
    vec2 c = gl_PointCoord - vec2(0.5);
    float r = length(c);
    if (r > 0.5) discard;
    // bordo scuro per staccare il punto dal modello
    if (r > 0.36) { gl_FragColor = vec4(0.08, 0.08, 0.1, uOpacity); return; }
  }
  gl_FragColor = vec4(uColor, uOpacity);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vs, fs, uniforms, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  const u = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
  const a = {};
  for (const name of attribs) a[name] = gl.getAttribLocation(p, name);
  return { prog: p, u, a };
}

/** Palette per le parti (leggibile su sfondo chiaro e scuro). */
export const PALETTE = [
  [0.44, 0.60, 0.80],
  [0.85, 0.55, 0.32],
  [0.46, 0.72, 0.55],
  [0.78, 0.45, 0.62],
  [0.55, 0.52, 0.80],
  [0.80, 0.72, 0.38],
  [0.40, 0.72, 0.75],
  [0.72, 0.42, 0.40],
];

const SFONDI = {
  scuro: [0.09, 0.10, 0.12],
  chiaro: [0.93, 0.94, 0.96],
  bianco: [1, 1, 1],
};

function normalMatrixInto(model, out) {
  const inv = transpose(invert(model));
  out[0] = inv[0]; out[1] = inv[1]; out[2] = inv[2];
  out[3] = inv[4]; out[4] = inv[5]; out[5] = inv[6];
  out[6] = inv[8]; out[7] = inv[9]; out[8] = inv[10];
}

function boxLines(min, max) {
  const c = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const out = new Float32Array(pairs.length * 6);
  let k = 0;
  for (const [a, b] of pairs) {
    out[k++] = c[a][0]; out[k++] = c[a][1]; out[k++] = c[a][2];
    out[k++] = c[b][0]; out[k++] = c[b][1]; out[k++] = c[b][2];
  }
  return out;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
    this.gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!this.gl) throw new Error('WebGL non disponibile in questo browser');
    const gl = this.gl;
    this.isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (!this.isGL2) this.uintExt = gl.getExtension('OES_element_index_uint');
    this.mesh = program(gl, VS, FS,
      ['uModel', 'uViewProj', 'uNormalMat', 'uColor', 'uEye', 'uOpacity', 'uSelectedFace', 'uHoverFace',
        'uSelectedPart', 'uClipPlane', 'uClipOn'],
      ['aPos', 'aNormal', 'aFaceId']);
    this.line = program(gl, LINE_VS, LINE_FS,
      ['uModel', 'uViewProj', 'uPointSize', 'uDepthBias', 'uColor', 'uOpacity', 'uClipPlane', 'uClipOn', 'uRound'],
      ['aPos']);
    this.parts = [];
    this.tema = 'scuro';
    this.sfondo = SFONDI.scuro;
    this.mostraSpigoli = true;
    this.mostraFacce = true;
    this.mostraBbox = false;
    this.mostraAssi = true;
    this.opacita = 1;
    this.selezione = -1;       // id faccia selezionata
    this.parteSelezionata = -1;
    this.hoverParte = -1;      // parte evidenziata dal passaggio sulle tabelle
    this.hover = -1;
    this.esplosione = 0;
    this.clip = { attivo: false, normale: [0, 0, 1], offset: 0 };
    this.misura = { punti: [] };  // punti nel mondo (max 2) + segmento
    this.bounds = null;           // ingombro della scena nel mondo
    this.identity = new Float32Array(identity());
    this.viewProjF32 = new Float32Array(16);
    this.eyeF32 = new Float32Array(3);
    this.clipF32 = new Float32Array(4);
    this.scratchBuf = gl.createBuffer();
    this.axisBuf = null;
    this.contestoPerso = false;
    // colori fissi, creati una volta: niente allocazioni per fotogramma
    this.col = {
      spigoliScuro: new Float32Array([0.92, 0.94, 0.98]),
      spigoliChiaro: new Float32Array([0.15, 0.17, 0.2]),
      bbox: new Float32Array([0.95, 0.65, 0.2]),
      sezioneScuro: new Float32Array([1.0, 0.62, 0.25]),
      sezioneChiaro: new Float32Array([0.85, 0.35, 0.1]),
      misuraLinea: new Float32Array([1.0, 0.62, 0.16]),
      misuraPunto: new Float32Array([1.0, 0.75, 0.25]),
      assi: [new Float32Array([0.9, 0.3, 0.3]), new Float32Array([0.35, 0.8, 0.4]), new Float32Array([0.4, 0.55, 0.95])],
    };
    this.assiScala = new Float32Array(16);
    this.onContesto = null; // callback (stato: 'perso'|'ripristinato')
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.contestoPerso = true;
      if (this.onContesto) this.onContesto('perso');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.ripristina();
      if (this.onContesto) this.onContesto('ripristinato');
    });
  }

  /** Ricrea programmi e buffer dopo il ripristino del contesto WebGL. */
  ripristina() {
    const gl = this.gl;
    this.mesh = program(gl, VS, FS,
      ['uModel', 'uViewProj', 'uNormalMat', 'uColor', 'uEye', 'uOpacity', 'uSelectedFace', 'uHoverFace',
        'uSelectedPart', 'uClipPlane', 'uClipOn'],
      ['aPos', 'aNormal', 'aFaceId']);
    this.line = program(gl, LINE_VS, LINE_FS,
      ['uModel', 'uViewProj', 'uPointSize', 'uDepthBias', 'uColor', 'uOpacity', 'uClipPlane', 'uClipOn', 'uRound'],
      ['aPos']);
    this.scratchBuf = gl.createBuffer();
    this.axisBuf = null;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const parti = this.parts.map((p) => p.ref);
    const visibilita = this.parts.map((p) => p.visibile);
    const colori = this.parts.map((p) => p.colore);
    this.parts = []; // i vecchi buffer non esistono piu'
    this.setParts(parti);
    this.parts.forEach((p, i) => {
      p.visibile = visibilita[i];
      p.colore = colori[i];
      p.coloreF32.set(colori[i]);
    });
    this.contestoPerso = false;
  }

  setTema(tema) {
    this.tema = tema;
    this.sfondo = SFONDI[tema] || SFONDI.scuro;
  }

  /**
   * Disabilita gli array di attributi: un attributo abilitato ma senza buffer
   * (o con un buffer cancellato) fa fallire i disegni successivi.
   */
  disabilitaAttributi() {
    const gl = this.gl;
    for (const prog of [this.mesh, this.line]) {
      for (const loc of Object.values(prog.a)) if (loc >= 0) gl.disableVertexAttribArray(loc);
    }
  }

  /** Carica le parti del modello sulla GPU. */
  setParts(parti) {
    const gl = this.gl;
    this.disabilitaAttributi();
    for (const p of this.parts) {
      for (const b of [p.posBuf, p.normBuf, p.faceBuf, p.idxBuf, p.edgeBuf, p.bboxBuf]) if (b) gl.deleteBuffer(b);
    }
    const buf = (data, target = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    this.parts = parti.map((part, i) => {
      const { positions, normals, indices, faceIds } = part.mesh;
      // id faccia per vertice (ogni vertice appartiene a una sola faccia)
      const vertexFaceId = new Float32Array(positions.length / 3);
      for (let t = 0; t < indices.length / 3; t++) {
        const id = faceIds[t] || 0;
        vertexFaceId[indices[t * 3]] = id;
        vertexFaceId[indices[t * 3 + 1]] = id;
        vertexFaceId[indices[t * 3 + 2]] = id;
      }
      // polilinee (Float32Array piatte) -> segmenti consecutivi
      let nSeg = 0;
      for (const e of part.spigoli || []) nSeg += Math.max(0, e.punti.length / 3 - 1);
      const segs = new Float32Array(nSeg * 6);
      let k = 0;
      for (const e of part.spigoli || []) {
        const p = e.punti;
        for (let j = 0; j + 5 < p.length; j += 3) {
          segs[k++] = p[j]; segs[k++] = p[j + 1]; segs[k++] = p[j + 2];
          segs[k++] = p[j + 3]; segs[k++] = p[j + 4]; segs[k++] = p[j + 5];
        }
      }
      const bb = part.bbox;
      const bboxLines = boxLines(bb.min, bb.max);
      return {
        nome: part.nome,
        matrice: part.matrice || identity(),
        model: part.matrice || identity(),
        modelF32: new Float32Array(part.matrice || identity()),
        normalF32: new Float32Array(9),
        offset: [0, 0, 0],
        colore: part.colore || PALETTE[i % PALETTE.length],
        coloreF32: new Float32Array(part.colore || PALETTE[i % PALETTE.length]),
        visibile: part.visibile !== false,
        posBuf: buf(positions),
        normBuf: buf(normals),
        faceBuf: buf(vertexFaceId),
        idxBuf: buf(indices, gl.ELEMENT_ARRAY_BUFFER),
        count: indices.length,
        edgeBuf: segs.length ? buf(segs) : null,
        edgeCount: segs.length / 3,
        bboxBuf: buf(bboxLines),
        bboxCount: bboxLines.length / 3,
        ref: part,
      };
    });
    this.calcolaIngombro();
    this.aggiornaMatrici();
  }

  /** Ingombro della scena (mondo, senza esplosione) e centroidi mondo delle parti. */
  calcolaIngombro() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts) {
      const bb = p.ref.bbox;
      const m = p.matrice;
      // trasforma gli 8 vertici della scatola locale
      for (let c = 0; c < 8; c++) {
        const l = [c & 1 ? bb.max[0] : bb.min[0], c & 2 ? bb.max[1] : bb.min[1], c & 4 ? bb.max[2] : bb.min[2]];
        const w = [
          m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12],
          m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13],
          m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
      }
      const c = p.ref.centroide || [0, 0, 0];
      p.centroMondo = [
        m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12],
        m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13],
        m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14],
      ];
    }
    this.bounds = Number.isFinite(min[0])
      ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        centro: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] }
      : null;
  }

  /** Ricalcola le matrici effettive (con l'esplosione) e le loro copie per la GPU. */
  aggiornaMatrici() {
    const b = this.bounds;
    const diag = b ? Math.hypot(b.size[0], b.size[1], b.size[2]) : 0;
    for (const p of this.parts) {
      const f = this.esplosione;
      let offset = [0, 0, 0];
      if (f > 0 && b && this.parts.length > 1) {
        const d = [p.centroMondo[0] - b.centro[0], p.centroMondo[1] - b.centro[1], p.centroMondo[2] - b.centro[2]];
        const l = Math.hypot(...d) || 1;
        // spostamento proporzionale alla distanza dal centro, fino a mezza diagonale
        const k = (f * diag * 0.5 * (l / (diag * 0.5 + 1e-9))) / l;
        offset = [d[0] * k, d[1] * k, d[2] * k];
      }
      p.offset = offset;
      const T = identity();
      T[12] = offset[0]; T[13] = offset[1]; T[14] = offset[2];
      p.model = multiply(T, p.matrice);
      p.modelF32.set(p.model);
      normalMatrixInto(p.model, p.normalF32);
    }
  }

  setEsplosione(f) {
    this.esplosione = Math.max(0, Math.min(1, Number(f) || 0));
    this.aggiornaMatrici();
  }

  setVisibilita(indice, visibile) {
    if (this.parts[indice]) this.parts[indice].visibile = visibile;
  }

  setColore(indice, rgb) {
    const p = this.parts[indice];
    if (!p) return;
    p.colore = rgb;
    p.coloreF32.set(rgb);
    if (p.ref) p.ref.colore = rgb;
  }

  /**
   * Ingombro mondo delle parti visibili (con esplosione): per l'inquadratura.
   * Con `soloVisibili = false` considera tutte le parti (piano di sezione).
   */
  ingombroVisibile(indici = null, soloVisibili = true) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    this.parts.forEach((p, i) => {
      if (soloVisibili && !p.visibile) return;
      if (indici && !indici.includes(i)) return;
      const bb = p.ref.bbox;
      const m = p.model;
      for (let c = 0; c < 8; c++) {
        const l = [c & 1 ? bb.max[0] : bb.min[0], c & 2 ? bb.max[1] : bb.min[1], c & 4 ? bb.max[2] : bb.min[2]];
        const w = [
          m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12],
          m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13],
          m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
      }
    });
    if (!Number.isFinite(min[0])) return this.bounds;
    return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h];
  }

  /** Disegna la scena; `dims` e `sfondo` servono allo screenshot. */
  render(camera, dims = null, sfondo = null) {
    const gl = this.gl;
    if (this.contestoPerso) return;
    const [w, h] = dims || this.resize();
    gl.viewport(0, 0, w, h);
    const bg = sfondo === 'trasparente' ? null : sfondo === 'bianco' ? SFONDI.bianco : this.sfondo;
    if (bg) gl.clearColor(bg[0], bg[1], bg[2], 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.viewProjF32.set(camera.viewProjection(w / h));
    this.eyeF32.set(camera.eye);
    const c = this.clip;
    this.clipF32[0] = c.normale[0]; this.clipF32[1] = c.normale[1]; this.clipF32[2] = c.normale[2]; this.clipF32[3] = c.offset;
    const clipOn = c.attivo ? 1 : 0;
    const trasparente = this.opacita < 0.99;

    if (this.mostraFacce) {
      const { prog, u, a } = this.mesh;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(u.uViewProj, false, this.viewProjF32);
      gl.uniform3fv(u.uEye, this.eyeF32);
      gl.uniform1f(u.uOpacity, this.opacita);
      gl.uniform1f(u.uSelectedFace, this.selezione);
      gl.uniform1f(u.uHoverFace, this.hover);
      gl.uniform4fv(u.uClipPlane, this.clipF32);
      gl.uniform1f(u.uClipOn, clipOn);
      if (trasparente) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      this.parts.forEach((p, i) => {
        if (!p.visibile || !p.count) return;
        gl.uniformMatrix4fv(u.uModel, false, p.modelF32);
        gl.uniformMatrix3fv(u.uNormalMat, false, p.normalF32);
        gl.uniform3fv(u.uColor, p.coloreF32);
        gl.uniform1f(u.uSelectedPart, i === this.parteSelezionata ? 1 : i === this.hoverParte ? 0.5 : 0);
        bindAttr(gl, a.aPos, p.posBuf, 3);
        bindAttr(gl, a.aNormal, p.normBuf, 3);
        bindAttr(gl, a.aFaceId, p.faceBuf, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.idxBuf);
        gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      // il programma delle linee usa solo aPos: gli altri array vanno spenti
      if (a.aNormal >= 0) gl.disableVertexAttribArray(a.aNormal);
      if (a.aFaceId >= 0) gl.disableVertexAttribArray(a.aFaceId);
    }

    // linee: spigoli, bounding box, assi, sezione, misura
    const { prog, u, a } = this.line;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProjF32);
    gl.uniform4fv(u.uClipPlane, this.clipF32);
    gl.uniform1f(u.uClipOn, clipOn);
    gl.uniform1f(u.uPointSize, 1);
    gl.uniform1f(u.uRound, 0);
    gl.uniform1f(u.uDepthBias, 0.00004);
    const chiaro = this.sfondo[0] > 0.5 || sfondo === 'bianco';

    if (this.mostraSpigoli) {
      gl.uniform3fv(u.uColor, chiaro ? this.col.spigoliChiaro : this.col.spigoliScuro);
      gl.uniform1f(u.uOpacity, this.mostraFacce ? 0.85 : 1);
      for (const p of this.parts) {
        if (!p.visibile || !p.edgeBuf) continue;
        gl.uniformMatrix4fv(u.uModel, false, p.modelF32);
        bindAttr(gl, a.aPos, p.edgeBuf, 3);
        gl.drawArrays(gl.LINES, 0, p.edgeCount);
      }
    }

    if (this.mostraBbox) {
      gl.uniform3fv(u.uColor, this.col.bbox);
      gl.uniform1f(u.uOpacity, 0.6);
      for (const p of this.parts) {
        if (!p.visibile) continue;
        gl.uniformMatrix4fv(u.uModel, false, p.modelF32);
        bindAttr(gl, a.aPos, p.bboxBuf, 3);
        gl.drawArrays(gl.LINES, 0, p.bboxCount);
      }
    }

    // da qui in poi: elementi ausiliari, mai tagliati dalla sezione
    gl.uniform1f(u.uClipOn, 0);

    if (this.clip.attivo && this.bounds) this.disegnaPianoSezione(u, a, chiaro);

    if (this.misura.punti.length) this.disegnaMisura(u, a);

    if (this.mostraAssi && this.parts.length) {
      if (!this.axisBuf) {
        this.axisBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.axisBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]), gl.STATIC_DRAW);
      }
      const l = Math.max(1e-3, camera.distance * 0.12);
      this.assiScala.set([l, 0, 0, 0, 0, l, 0, 0, 0, 0, l, 0, 0, 0, 0, 1]);
      gl.uniformMatrix4fv(u.uModel, false, this.assiScala);
      gl.uniform1f(u.uOpacity, 0.95);
      bindAttr(gl, a.aPos, this.axisBuf, 3);
      for (let i = 0; i < 3; i++) {
        gl.uniform3fv(u.uColor, this.col.assi[i]);
        gl.drawArrays(gl.LINES, i * 2, 2);
      }
    }
  }

  /** Contorno del piano di sezione (rettangolo sull'ingombro della scena, esplosione inclusa). */
  disegnaPianoSezione(u, a, chiaro) {
    const gl = this.gl;
    const b = this.ingombroVisibile(null, false) || this.bounds;
    const n = this.clip.normale;
    const k = Math.abs(n[0]) > 0.5 ? 0 : Math.abs(n[1]) > 0.5 ? 1 : 2;
    const [i, j] = k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
    const margine = 0.04 * Math.max(b.size[i], b.size[j]);
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    lo[i] = b.min[i] - margine; hi[i] = b.max[i] + margine;
    lo[j] = b.min[j] - margine; hi[j] = b.max[j] + margine;
    const off = this.clip.offset / (n[k] || 1);
    const pt = (ii, jj) => {
      const p = [0, 0, 0];
      p[i] = ii; p[j] = jj; p[k] = off;
      return p;
    };
    const quad = [pt(lo[i], lo[j]), pt(hi[i], lo[j]), pt(hi[i], hi[j]), pt(lo[i], hi[j])];
    const data = new Float32Array(quad.flat());
    gl.bindBuffer(gl.ARRAY_BUFFER, this.scratchBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(u.uModel, false, this.identity);
    gl.uniform3fv(u.uColor, chiaro ? this.col.sezioneChiaro : this.col.sezioneScuro);
    gl.uniform1f(u.uOpacity, 0.9);
    bindAttr(gl, a.aPos, this.scratchBuf, 3);
    gl.drawArrays(gl.LINE_LOOP, 0, 4);
  }

  /** Punti e segmento della misura, sempre visibili sopra il modello. */
  disegnaMisura(u, a) {
    const gl = this.gl;
    const pts = this.misura.punti;
    const data = new Float32Array(pts.flat());
    gl.bindBuffer(gl.ARRAY_BUFFER, this.scratchBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(u.uModel, false, this.identity);
    gl.disable(gl.DEPTH_TEST);
    bindAttr(gl, a.aPos, this.scratchBuf, 3);
    if (pts.length >= 2) {
      gl.uniform3fv(u.uColor, this.col.misuraLinea);
      gl.uniform1f(u.uOpacity, 1);
      gl.drawArrays(gl.LINE_STRIP, 0, pts.length);
    }
    gl.uniform1f(u.uPointSize, 12 * Math.min(window.devicePixelRatio || 1, 2));
    gl.uniform1f(u.uRound, 1);
    gl.uniform3fv(u.uColor, this.col.misuraPunto);
    gl.drawArrays(gl.POINTS, 0, pts.length);
    gl.uniform1f(u.uRound, 0);
    gl.uniform1f(u.uPointSize, 1);
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * PNG del fotogramma. opts: { larghezza, altezza, sfondo: 'tema'|'bianco'|'trasparente' }.
   * Disegna nello stesso task, quindi non serve preserveDrawingBuffer.
   */
  screenshot(camera, opts = {}) {
    const canvas = this.canvas;
    const salvaW = canvas.width;
    const salvaH = canvas.height;
    const w = Math.min(8192, Math.max(64, Math.round(opts.larghezza || salvaW)));
    const h = Math.min(8192, Math.max(64, Math.round(opts.altezza || (salvaW ? (w * salvaH) / salvaW : w * 0.6))));
    canvas.width = w;
    canvas.height = h;
    const sfondo = opts.sfondo === 'tema' ? null : opts.sfondo || null;
    this.render(camera, [w, h], sfondo);
    const url = canvas.toDataURL('image/png');
    canvas.width = salvaW;
    canvas.height = salvaH;
    this.render(camera);
    return url;
  }
}

function bindAttr(gl, loc, buf, size) {
  if (loc < 0 || !buf) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}
