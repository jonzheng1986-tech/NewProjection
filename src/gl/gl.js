// Minimal immediate-mode WebGL2 renderer for monochrome line art.
//
//   * terrain – static world-space triangles, darkened by the fog texture.
//   * shapes  – one dynamic screen-space triangle list. Unit art, buildings,
//               effects and all UI are flattened into triangles on the CPU so
//               the draw order is exact.
//   * text    – glyph quads grouped per font atlas.
//
// All coordinates are CSS pixels; the viewport is scaled for device pixels.

import { FontAtlas, FONT_SANS } from './font.js';

const SHAPE_VS = `#version 300 es
precision mediump float;
in vec2 aPos;
in vec4 aColor;
uniform vec2 uRes;
out vec4 vColor;
void main() {
  vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

const SHAPE_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

const TERRAIN_VS = `#version 300 es
precision mediump float;
in vec2 aPos;
in vec4 aColor;
uniform vec2 uRes;
uniform vec4 uCam;
uniform vec2 uMapSize;
out vec4 vColor;
out vec2 vFogUV;
void main() {
  vec2 iso = vec2((aPos.x - aPos.y) * 0.8660254037844386, (aPos.x + aPos.y) * 0.5);
  vec2 s = (iso - uCam.xy) * uCam.z + uRes * 0.5;
  gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, 0.0, 1.0);
  vColor = aColor;
  vFogUV = aPos / uMapSize;
}`;

const TERRAIN_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vFogUV;
uniform sampler2D uFog;
uniform float uFogEnabled;
out vec4 outColor;
void main() {
  vec2 f = texture(uFog, vFogUV).rg;
  float visible = f.g;
  float explored = max(f.r, visible);
  float fog = (1.0 - visible) * (0.58 + 0.42 * (1.0 - explored)) * uFogEnabled;
  outColor = vec4(vColor.rgb * (1.0 - fog), vColor.a);
}`;

const TEXT_VS = `#version 300 es
precision mediump float;
in vec2 aPos;
in vec2 aUV;
in vec4 aColor;
uniform vec2 uRes;
out vec2 vUV;
out vec4 vColor;
void main() {
  vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
}`;

const TEXT_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  float a = texture(uTex, vUV).a;
  outColor = vec4(vColor.rgb, vColor.a * a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

export function color(r, g, b, a = 1) { return [r / 255, g / 255, b / 255, a]; }
export function rgba(c, a) { return [c[0], c[1], c[2], a]; }
export function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
    a[3] + ((b[3] === undefined ? 1 : b[3]) - a[3]) * t];
}

export class GLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: true, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = canvas.clientWidth || 1280;
    this.height = canvas.clientHeight || 720;
    this.cam = { x: 0, y: 0, zoom: 1 };

    this.shapeProg = link(gl, SHAPE_VS, SHAPE_FS);
    this.terrainProg = link(gl, TERRAIN_VS, TERRAIN_FS);
    this.textProg = link(gl, TEXT_VS, TEXT_FS);

    this.shapeLoc = {
      pos: gl.getAttribLocation(this.shapeProg, 'aPos'),
      color: gl.getAttribLocation(this.shapeProg, 'aColor'),
      res: gl.getUniformLocation(this.shapeProg, 'uRes'),
    };
    this.terrainLoc = {
      pos: gl.getAttribLocation(this.terrainProg, 'aPos'),
      color: gl.getAttribLocation(this.terrainProg, 'aColor'),
      res: gl.getUniformLocation(this.terrainProg, 'uRes'),
      cam: gl.getUniformLocation(this.terrainProg, 'uCam'),
      fog: gl.getUniformLocation(this.terrainProg, 'uFog'),
      mapSize: gl.getUniformLocation(this.terrainProg, 'uMapSize'),
      fogEnabled: gl.getUniformLocation(this.terrainProg, 'uFogEnabled'),
    };
    this.textLoc = {
      pos: gl.getAttribLocation(this.textProg, 'aPos'),
      uv: gl.getAttribLocation(this.textProg, 'aUV'),
      color: gl.getAttribLocation(this.textProg, 'aColor'),
      res: gl.getUniformLocation(this.textProg, 'uRes'),
      tex: gl.getUniformLocation(this.textProg, 'uTex'),
    };

    // dynamic shapes
    this.shapeCapacity = 160000;
    this.shapeData = new Float32Array(this.shapeCapacity * 6);
    this.shapeCount = 0;
    this.shapeVAO = gl.createVertexArray();
    this.shapeVBO = gl.createBuffer();
    gl.bindVertexArray(this.shapeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.shapeData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.shapeLoc.pos);
    gl.vertexAttribPointer(this.shapeLoc.pos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.shapeLoc.color);
    gl.vertexAttribPointer(this.shapeLoc.color, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    // static terrain
    this.terrainVAO = gl.createVertexArray();
    this.terrainVBO = gl.createBuffer();
    this.terrainCount = 0;

    // text
    this.textCapacity = 60000;
    this.textData = new Float32Array(this.textCapacity * 8);
    this.textAtlasIds = new Uint16Array(this.textCapacity);
    this.textCount = 0;
    this.textRuns = [];
    this.textVAO = gl.createVertexArray();
    this.textVBO = gl.createBuffer();
    gl.bindVertexArray(this.textVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.textData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.textLoc.pos);
    gl.vertexAttribPointer(this.textLoc.pos, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(this.textLoc.uv);
    gl.vertexAttribPointer(this.textLoc.uv, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(this.textLoc.color);
    gl.vertexAttribPointer(this.textLoc.color, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);

    this.fonts = new Map();
    this.fontList = [];

    // fog texture
    this.fogTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array([0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fogEnabled = 1;
    this.mapSize = [1, 1];

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.035, 0.04, 0.047, 1);
  }

  resize() {
    const cw = Math.floor(this.canvas.clientWidth * this.dpr);
    const ch = Math.floor(this.canvas.clientHeight * this.dpr);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.gl.viewport(0, 0, cw, ch);
  }

  setFog(data, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  setTerrainMesh(mesh) {
    const gl = this.gl;
    this.terrainCount = mesh.count;
    gl.bindVertexArray(this.terrainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainVBO);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.terrainLoc.pos);
    gl.vertexAttribPointer(this.terrainLoc.pos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.terrainLoc.color);
    gl.vertexAttribPointer(this.terrainLoc.color, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------------- frame
  beginFrame(camSX, camSY, zoom) {
    this.shapeCount = 0;
    this.textCount = 0;
    this.textRuns.length = 0;
    this.cam = { x: camSX, y: camSY, zoom };
  }

  // --------------------------------------------------------------- shapes
  _ensureShape(n) {
    if (this.shapeCount + n <= this.shapeCapacity) return true;
    const next = this.shapeCapacity * 2;
    if (this.shapeCount + n > next) return false;
    const data = new Float32Array(next * 6);
    data.set(this.shapeData.subarray(0, this.shapeCount * 6));
    this.shapeData = data;
    this.shapeCapacity = next;
    return true;
  }

  _vertex(x, y, c) {
    const i = this.shapeCount * 6;
    const d = this.shapeData;
    d[i] = x; d[i + 1] = y; d[i + 2] = c[0]; d[i + 3] = c[1]; d[i + 4] = c[2]; d[i + 5] = c[3];
    this.shapeCount++;
  }

  tri(x1, y1, x2, y2, x3, y3, c) {
    if (!this._ensureShape(3)) return;
    this._vertex(x1, y1, c);
    this._vertex(x2, y2, c);
    this._vertex(x3, y3, c);
  }

  quad(x1, y1, x2, y2, x3, y3, x4, y4, c) {
    if (!this._ensureShape(6)) return;
    this._vertex(x1, y1, c); this._vertex(x2, y2, c); this._vertex(x3, y3, c);
    this._vertex(x1, y1, c); this._vertex(x3, y3, c); this._vertex(x4, y4, c);
  }

  rect(x, y, w, h, c) {
    this.quad(x, y, x + w, y, x + w, y + h, x, y + h, c);
  }

  roundRect(x, y, w, h, r, c) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r <= 0.01) { this.rect(x, y, w, h, c); return; }
    const seg = 4;
    this.rect(x + r, y, w - 2 * r, h, c);
    this.rect(x, y + r, r, h - 2 * r, c);
    this.rect(x + w - r, y + r, r, h - 2 * r, c);
    const corner = (cx, cy, a0) => {
      for (let i = 0; i < seg; i++) {
        const a1 = a0 + (i / seg) * (Math.PI / 2);
        const a2 = a0 + ((i + 1) / seg) * (Math.PI / 2);
        this.tri(cx, cy,
          cx + Math.cos(a1) * r, cy + Math.sin(a1) * r,
          cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, c);
      }
    };
    corner(x + r, y + r, Math.PI);
    corner(x + w - r, y + r, Math.PI * 1.5);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI * 0.5);
  }

  disc(cx, cy, r, c, segments = 18) {
    if (r <= 0.01) return;
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      this.tri(cx, cy, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r,
        cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, c);
    }
  }

  ring(cx, cy, r, width, c, segments = 30) {
    if (r <= 0.01) return;
    const inner = Math.max(0, r - width);
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      this.quad(cx + c1 * inner, cy + s1 * inner, cx + c1 * r, cy + s1 * r,
        cx + c2 * r, cy + s2 * r, cx + c2 * inner, cy + s2 * inner, c);
    }
  }

  seg(x1, y1, x2, y2, w, c) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return;
    const nx = (-dy / len) * w * 0.5, ny = (dx / len) * w * 0.5;
    this.quad(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny, c);
  }

  polyline(pts, w, c, closed = false, joints = true) {
    const n = pts.length / 2;
    if (n < 2) return;
    for (let i = 0; i < n - 1; i++) {
      this.seg(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], w, c);
    }
    if (closed) this.seg(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], pts[0], pts[1], w, c);
    if (joints && w > 1.5) {
      const r = w * 0.5;
      for (let i = 1; i < n - (closed ? 0 : 1); i++) {
        this.disc(pts[i * 2], pts[i * 2 + 1], r, c, 6);
      }
    }
  }

  strokeRect(x, y, w, h, lw, c) {
    this.seg(x, y, x + w, y, lw, c);
    this.seg(x + w, y, x + w, y + h, lw, c);
    this.seg(x + w, y + h, x, y + h, lw, c);
    this.seg(x, y + h, x, y, lw, c);
  }

  strokeRoundRect(x, y, w, h, r, lw, c) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r <= 0.5) { this.strokeRect(x, y, w, h, lw, c); return; }
    const n = 5;
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * (Math.PI / 2);
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    };
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    this.polyline(pts, lw, c, true, false);
  }

  dashedLine(x1, y1, x2, y2, w, c, dash = 6, gap = 5) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len, uy = dy / len;
    let t = 0;
    while (t < len) {
      const e = Math.min(t + dash, len);
      this.seg(x1 + ux * t, y1 + uy * t, x1 + ux * e, y1 + uy * e, w, c);
      t = e + gap;
    }
  }

  dashedCircle(cx, cy, r, w, c, dash = 5, gap = 4) {
    if (r <= 0.01) return;
    const circ = Math.PI * 2 * r;
    let t = 0;
    while (t < circ) {
      const a0 = t / r;
      const a1 = Math.min(t + dash, circ) / r;
      const steps = Math.max(1, Math.ceil((a1 - a0) / 0.18));
      for (let i = 0; i < steps; i++) {
        const b0 = a0 + (a1 - a0) * (i / steps);
        const b1 = a0 + (a1 - a0) * ((i + 1) / steps);
        this.seg(cx + Math.cos(b0) * r, cy + Math.sin(b0) * r,
          cx + Math.cos(b1) * r, cy + Math.sin(b1) * r, w, c);
      }
      t += dash + gap;
    }
  }

  bar(x, y, w, h, value, fg, bg, borderC) {
    this.rect(x, y, w, h, bg);
    if (value > 0) this.rect(x, y, w * Math.max(0, Math.min(1, value)), h, fg);
    if (borderC) this.strokeRect(x, y, w, h, 1, borderC);
  }

  // ------------------------------------------------------------------ text
  font(size, weight = 400, family = FONT_SANS) {
    const key = `${size}|${weight}|${family}`;
    let f = this.fonts.get(key);
    if (!f) {
      f = new FontAtlas(this.gl, size, weight, family, this.dpr);
      this.fonts.set(key, f);
      this.fontList.push(f);
    }
    return f;
  }

  textWidth(str, size, weight = 400, family = FONT_SANS) {
    return this.font(size, weight, family).measure(str);
  }

  text(str, x, y, opts = {}) {
    if (str === undefined || str === null) return 0;
    str = String(str);
    const size = opts.size || 14;
    const weight = opts.weight || 400;
    const family = opts.family || FONT_SANS;
    const c = opts.color || [1, 1, 1, 1];
    const f = this.font(size, weight, family);
    const total = f.measure(str);
    let px = x;
    if (opts.align === 'center') px = x - total / 2;
    else if (opts.align === 'right') px = x - total;
    let py = y;
    if (opts.baseline === 'middle') py = y - f.lineHeight / 2;
    else if (opts.baseline === 'bottom') py = y - f.lineHeight;
    const tracking = opts.tracking || 0;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const g = f.glyph(ch);
      if (!g) { px += f.spaceWidth; continue; }
      if (ch !== ' ' && g.w > 0) {
        if (this.textCount + 6 > this.textCapacity) {
          this.textCapacity *= 2;
          const nd = new Float32Array(this.textCapacity * 8);
          nd.set(this.textData.subarray(0, this.textCount * 8));
          this.textData = nd;
        }
        if (!this.textRuns.length || this.textRuns[this.textRuns.length - 1].font !== f) {
          this.textRuns.push({ font: f, start: this.textCount, count: 0 });
        }
        const run = this.textRuns[this.textRuns.length - 1];
        const x0 = px + g.ox;
        const y0 = py + g.oy;
        const x1 = x0 + g.w;
        const y1 = y0 + g.h;
        const d = this.textData;
        const vert = (vx, vy, u, v) => {
          const i2 = this.textCount * 8;
          d[i2] = vx; d[i2 + 1] = vy; d[i2 + 2] = u; d[i2 + 3] = v;
          d[i2 + 4] = c[0]; d[i2 + 5] = c[1]; d[i2 + 6] = c[2]; d[i2 + 7] = c[3];
          this.textCount++;
        };
        vert(x0, y0, g.u0, g.v0);
        vert(x1, y0, g.u1, g.v0);
        vert(x1, y1, g.u1, g.v1);
        vert(x0, y0, g.u0, g.v0);
        vert(x1, y1, g.u1, g.v1);
        vert(x0, y1, g.u0, g.v1);
        run.count += 6;
      }
      px += g.adv + tracking;
    }
    return total;
  }

  textShadow(str, x, y, opts = {}, shadow = [0, 0, 0, 0.85], off = 1.2) {
    this.text(str, x + off, y + off, { ...opts, color: shadow });
    return this.text(str, x, y, opts);
  }

  wrapText(str, maxWidth, size, weight = 400, family = FONT_SANS) {
    const f = this.font(size, weight, family);
    const words = String(str).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (f.measure(test) > maxWidth && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ------------------------------------------------------------------ draw
  render() {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (this.terrainCount > 0) {
      gl.useProgram(this.terrainProg);
      gl.uniform2f(this.terrainLoc.res, this.width, this.height);
      gl.uniform4f(this.terrainLoc.cam, this.cam.x, this.cam.y, this.cam.zoom, 0);
      gl.uniform2f(this.terrainLoc.mapSize, this.mapSize[0], this.mapSize[1]);
      gl.uniform1f(this.terrainLoc.fogEnabled, this.fogEnabled);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
      gl.uniform1i(this.terrainLoc.fog, 0);
      gl.bindVertexArray(this.terrainVAO);
      gl.drawArrays(gl.TRIANGLES, 0, this.terrainCount);
    }

    if (this.shapeCount > 0) {
      gl.useProgram(this.shapeProg);
      gl.uniform2f(this.shapeLoc.res, this.width, this.height);
      gl.bindVertexArray(this.shapeVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.shapeData.subarray(0, this.shapeCount * 6), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, this.shapeCount);
    }

    if (this.textCount > 0) {
      gl.useProgram(this.textProg);
      gl.uniform2f(this.textLoc.res, this.width, this.height);
      gl.uniform1i(this.textLoc.tex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.textVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.textData.subarray(0, this.textCount * 8), gl.DYNAMIC_DRAW);
      for (const run of this.textRuns) {
        if (run.count <= 0) continue;
        gl.bindTexture(gl.TEXTURE_2D, run.font.texture);
        gl.drawArrays(gl.TRIANGLES, run.start, run.count);
      }
    }
    gl.bindVertexArray(null);
  }
}
