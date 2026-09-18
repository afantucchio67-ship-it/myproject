/**
 * Renderer WebGL minimale (senza librerie esterne).
 *
 * Disegna le parti tassellate con illuminazione a due lati, gli spigoli del
 * modello, la bounding box, gli assi e un piano di sezione opzionale.
 * L'evidenziazione della faccia selezionata usa un attributo per vertice con
 * l'id dell'entita' STEP.
 */

import { identity, invert, transpose } from './mat4.js';

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
uniform vec4 uClipPlane;   // xyz = normale, w = offset; attivo se uClipOn > 0.5
uniform float uClipOn;
uniform float uFlat;
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
  if (abs(vFaceId - uSelectedFace) < 0.5) base = mix(base, vec3(1.0, 0.62, 0.16), 0.75);
  else if (abs(vFaceId - uHoverFace) < 0.5) base = mix(base, vec3(0.35, 0.78, 1.0), 0.45);
  vec3 col = base * (0.30 + 0.70 * diff) + vec3(spec);
  if (uFlat > 0.5) col = base;
  gl_FragColor = vec4(col, uOpacity);
}`;

const LINE_VS = `
precision highp float;
attribute vec3 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
varying vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
  gl_Position.z -= 0.00004 * gl_Position.w;   // evita lo z-fighting con le facce
}`;

const LINE_FS = `
precision highp float;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uClipPlane;
uniform float uClipOn;
void main() {
  if (uClipOn > 0.5 && dot(vWorld, uClipPlane.xyz) > uClipPlane.w) discard;
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

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: false, preserveDrawingBuffer: true };
    this.gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!this.gl) throw new Error('WebGL non disponibile in questo browser');
    const gl = this.gl;
    this.isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (!this.isGL2) {
      this.uintExt = gl.getExtension('OES_element_index_uint');
    }
    this.prog = program(gl, VS, FS);
    this.lineProg = program(gl, LINE_VS, LINE_FS);
    this.parts = [];
    this.sfondo = [0.09, 0.10, 0.12];
    this.mostraSpigoli = true;
    this.mostraFacce = true;
    this.mostraBbox = false;
    this.mostraAssi = true;
    this.opacita = 1;
    this.selezione = -1;
    this.hover = -1;
    this.clip = { attivo: false, normale: [0, 0, 1], offset: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  /** Carica le parti del modello sulla GPU. */
  setParts(parti) {
    const gl = this.gl;
    for (const p of this.parts) {
      for (const b of [p.posBuf, p.normBuf, p.faceBuf, p.idxBuf, p.edgeBuf, p.bboxBuf]) {
        if (b) gl.deleteBuffer(b);
      }
    }
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
      const buf = (data, target = gl.ARRAY_BUFFER) => {
        const b = gl.createBuffer();
        gl.bindBuffer(target, b);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return b;
      };
      // spigoli: segmenti consecutivi delle polilinee
      const segs = [];
      for (const e of part.spigoli || []) {
        for (let i = 0; i + 1 < e.punti.length; i++) {
          segs.push(...e.punti[i], ...e.punti[i + 1]);
        }
      }
      const bb = part.bbox;
      const bboxLines = boxLines(bb.min, bb.max);
      return {
        nome: part.nome,
        model: part.matrice || identity(),
        colore: part.colore || PALETTE[i % PALETTE.length],
        visibile: part.visibile !== false,
        posBuf: buf(positions),
        normBuf: buf(normals),
        faceBuf: buf(vertexFaceId),
        idxBuf: buf(indices, gl.ELEMENT_ARRAY_BUFFER),
        count: indices.length,
        edgeBuf: segs.length ? buf(new Float32Array(segs)) : null,
        edgeCount: segs.length / 3,
        bboxBuf: buf(new Float32Array(bboxLines)),
        bboxCount: bboxLines.length / 3,
        ref: part,
      };
    });
  }

  setVisibilita(indice, visibile) {
    if (this.parts[indice]) this.parts[indice].visibile = visibile;
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

  render(camera) {
    const gl = this.gl;
    const [w, h] = this.resize();
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.sfondo[0], this.sfondo[1], this.sfondo[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const viewProj = camera.viewProjection(w / h);
    const eye = camera.eye;
    const trasparente = this.opacita < 0.99;

    if (this.mostraFacce) {
      gl.useProgram(this.prog);
      const u = (n) => gl.getUniformLocation(this.prog, n);
      const aPos = gl.getAttribLocation(this.prog, 'aPos');
      const aNormal = gl.getAttribLocation(this.prog, 'aNormal');
      const aFaceId = gl.getAttribLocation(this.prog, 'aFaceId');
      gl.uniformMatrix4fv(u('uViewProj'), false, new Float32Array(viewProj));
      gl.uniform3fv(u('uEye'), new Float32Array(eye));
      gl.uniform1f(u('uOpacity'), this.opacita);
      gl.uniform1f(u('uSelectedFace'), this.selezione);
      gl.uniform1f(u('uHoverFace'), this.hover);
      gl.uniform1f(u('uFlat'), 0);
      gl.uniform4fv(u('uClipPlane'), new Float32Array([...this.clip.normale, this.clip.offset]));
      gl.uniform1f(u('uClipOn'), this.clip.attivo ? 1 : 0);
      if (trasparente) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      for (const p of this.parts) {
        if (!p.visibile || !p.count) continue;
        gl.uniformMatrix4fv(u('uModel'), false, new Float32Array(p.model));
        gl.uniformMatrix3fv(u('uNormalMat'), false, new Float32Array(normalMatrix(p.model)));
        gl.uniform3fv(u('uColor'), new Float32Array(p.colore));
        bindAttr(gl, aPos, p.posBuf, 3);
        bindAttr(gl, aNormal, p.normBuf, 3);
        bindAttr(gl, aFaceId, p.faceBuf, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.idxBuf);
        gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // linee: spigoli, bounding box, assi
    gl.useProgram(this.lineProg);
    const lu = (n) => gl.getUniformLocation(this.lineProg, n);
    const laPos = gl.getAttribLocation(this.lineProg, 'aPos');
    gl.uniformMatrix4fv(lu('uViewProj'), false, new Float32Array(viewProj));
    gl.uniform4fv(lu('uClipPlane'), new Float32Array([...this.clip.normale, this.clip.offset]));
    gl.uniform1f(lu('uClipOn'), this.clip.attivo ? 1 : 0);

    if (this.mostraSpigoli) {
      const chiaro = this.sfondo[0] > 0.5;
      gl.uniform3fv(lu('uColor'), new Float32Array(chiaro ? [0.15, 0.17, 0.2] : [0.92, 0.94, 0.98]));
      gl.uniform1f(lu('uOpacity'), this.mostraFacce ? 0.85 : 1);
      for (const p of this.parts) {
        if (!p.visibile || !p.edgeBuf) continue;
        gl.uniformMatrix4fv(lu('uModel'), false, new Float32Array(p.model));
        bindAttr(gl, laPos, p.edgeBuf, 3);
        gl.drawArrays(gl.LINES, 0, p.edgeCount);
      }
    }

    if (this.mostraBbox) {
      gl.uniform3fv(lu('uColor'), new Float32Array([0.95, 0.65, 0.2]));
      gl.uniform1f(lu('uOpacity'), 0.6);
      for (const p of this.parts) {
        if (!p.visibile) continue;
        gl.uniformMatrix4fv(lu('uModel'), false, new Float32Array(p.model));
        bindAttr(gl, laPos, p.bboxBuf, 3);
        gl.drawArrays(gl.LINES, 0, p.bboxCount);
      }
    }

    if (this.mostraAssi) {
      if (!this.axisBuf) {
        this.axisBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.axisBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0, 0, 0, 1, 0, 0,
          0, 0, 0, 0, 1, 0,
          0, 0, 0, 0, 0, 1,
        ]), gl.STATIC_DRAW);
      }
      const l = Math.max(1e-3, camera.distance * 0.12);
      const scaleM = [l, 0, 0, 0, 0, l, 0, 0, 0, 0, l, 0, 0, 0, 0, 1];
      gl.uniformMatrix4fv(lu('uModel'), false, new Float32Array(scaleM));
      gl.uniform1f(lu('uOpacity'), 0.95);
      bindAttr(gl, laPos, this.axisBuf, 3);
      const colori = [[0.9, 0.3, 0.3], [0.35, 0.8, 0.4], [0.4, 0.55, 0.95]];
      for (let i = 0; i < 3; i++) {
        gl.uniform3fv(lu('uColor'), new Float32Array(colori[i]));
        gl.drawArrays(gl.LINES, i * 2, 2);
      }
    }
  }

  /** PNG del fotogramma corrente. */
  screenshot() {
    return this.canvas.toDataURL('image/png');
  }
}

function bindAttr(gl, loc, buf, size) {
  if (loc < 0 || !buf) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function normalMatrix(model) {
  const inv = transpose(invert(model));
  return [inv[0], inv[1], inv[2], inv[4], inv[5], inv[6], inv[8], inv[9], inv[10]];
}

function boxLines(min, max) {
  const c = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const out = [];
  for (const [a, b] of pairs) out.push(...c[a], ...c[b]);
  return out;
}
