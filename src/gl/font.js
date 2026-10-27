// Glyph atlases rasterised from a 2D canvas so the WebGL text pass can draw
// crisp UI text without shipping any font files.

const ATLAS_SIZE = 1024;

export const FONT_SANS = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const FONT_SERIF = 'Georgia, "Times New Roman", "Palatino Linotype", serif';
export const FONT_MONO = '"SF Mono", "Cascadia Mono", "Consolas", monospace';

const EXTRA_CHARS = '×°·—–→←↑↓✓✕✦⏵⏸⌁⌂⚔⛏♥♦☾☀';

export class FontAtlas {
  constructor(gl, size, weight = 400, family = FONT_SANS, scale = 1) {
    this.gl = gl;
    this.size = size;
    this.weight = weight;
    this.family = family;
    this.scale = Math.max(1, Math.min(3, scale));
    this.glyphs = new Map();
    this.texture = gl.createTexture();
    this._build();
  }

  _build() {
    const gl = this.gl;
    const s = this.scale;
    const px = Math.round(this.size * s);
    const family = this.family;
    const fontStr = `${this.weight} ${px}px ${family}`;

    const measureCanvas = document.createElement('canvas');
    let mctx = measureCanvas.getContext('2d');
    mctx.font = fontStr;
    const metrics = mctx.measureText('Hgy');
    const ascent = Math.ceil(metrics.fontBoundingBoxAscent || px * 0.8);
    const descent = Math.ceil(metrics.fontBoundingBoxDescent || px * 0.25);
    const lineH = ascent + descent;
    this.ascent = ascent / s;
    this.descent = descent / s;
    this.lineHeight = (lineH + 2) / s;
    this.spaceWidth = (mctx.measureText(' ').width) / s;

    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.font = fontStr;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';

    const chars = [];
    for (let i = 32; i < 127; i++) chars.push(String.fromCharCode(i));
    for (const ch of EXTRA_CHARS) chars.push(ch);

    let x = 1, y = 1, rowH = lineH + 3;
    const cells = [];
    for (const ch of chars) {
      const w = Math.max(1, Math.ceil(ctx.measureText(ch).width + 2));
      if (x + w >= ATLAS_SIZE - 1) {
        x = 1;
        y += rowH;
        rowH = lineH + 3;
      }
      if (y + rowH >= ATLAS_SIZE - 1) break;
      ctx.fillText(ch, x, y + ascent);
      cells.push({ ch, x, y, w, h: rowH, adv: ctx.measureText(ch).width });
      x += w + 1;
    }

    const tex = this.texture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    for (const c of cells) {
      const gw = Math.max(1, c.adv + 1.5);
      this.glyphs.set(c.ch, {
        u0: c.x / ATLAS_SIZE,
        v0: c.y / ATLAS_SIZE,
        u1: (c.x + gw) / ATLAS_SIZE,
        v1: (c.y + c.h) / ATLAS_SIZE,
        w: gw / s,
        h: c.h / s,
        adv: c.adv / s,
        ox: 0,
        oy: 0,
      });
    }
  }

  glyph(ch) {
    return this.glyphs.get(ch) || this.glyphs.get('?') || null;
  }

  measure(str) {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
      const g = this.glyph(str[i]);
      w += g ? g.adv : this.spaceWidth;
    }
    return w;
  }
}
