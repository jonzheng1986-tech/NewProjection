// Tiny procedural WebAudio sound engine. No asset files: every effect is
// synthesised from oscillators and noise so the game stays self-contained.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.lastPlay = new Map();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _env(node, t0, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    this._env(osc, t0, 0.005, dur, vol);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise(dur, vol = 0.14, filterFreq = 1200, q = 1, delay = 0, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    src.connect(filter);
    const g = this._env(filter, t0, 0.004, dur, vol);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(name, volScale = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) || 0;
    const minGap = 0.045;
    if (now - last < minGap) return;
    this.lastPlay.set(name, now);
    switch (name) {
      case 'click': this.tone(760, 0.04, 'square', 0.05 * volScale); break;
      case 'select': this.tone(520, 0.05, 'triangle', 0.06 * volScale); this.tone(780, 0.04, 'sine', 0.04 * volScale, null, 0.03); break;
      case 'order': this.noise(0.06, 0.05 * volScale, 900, 0.8); this.tone(330, 0.05, 'triangle', 0.05 * volScale); break;
      case 'ack': this.tone(620, 0.06, 'triangle', 0.05 * volScale); break;
      case 'sword': this.noise(0.09, 0.09 * volScale, 2600, 1.2); this.tone(1800, 0.05, 'square', 0.02 * volScale, 900); break;
      case 'flesh': this.noise(0.12, 0.1 * volScale, 240, 0.7); break;
      case 'bow': this.noise(0.07, 0.06 * volScale, 3200, 2); this.tone(900, 0.06, 'sine', 0.03 * volScale, 400); break;
      case 'cannon': this.noise(0.35, 0.16 * volScale, 140, 0.6); this.tone(70, 0.3, 'sine', 0.12 * volScale, 40); break;
      case 'magic': this.tone(880, 0.25, 'sine', 0.06 * volScale, 1600); this.tone(1320, 0.2, 'triangle', 0.03 * volScale, 2200, 0.05); break;
      case 'frost': this.noise(0.3, 0.08 * volScale, 5200, 2, 0, 'highpass'); this.tone(1600, 0.25, 'sine', 0.04 * volScale, 900); break;
      case 'death': this.noise(0.3, 0.1 * volScale, 320, 0.5); this.tone(220, 0.3, 'sawtooth', 0.05 * volScale, 60); break;
      case 'build': this.noise(0.1, 0.07 * volScale, 700, 1.5); this.tone(420, 0.06, 'square', 0.03 * volScale); break;
      case 'ready': this.tone(880, 0.1, 'sine', 0.06 * volScale); this.tone(1320, 0.14, 'sine', 0.05 * volScale, null, 0.08); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.06 * volScale, null, i * 0.09)); break;
      case 'error': this.tone(180, 0.16, 'square', 0.05 * volScale); break;
      case 'gold': this.tone(1046, 0.05, 'sine', 0.04 * volScale); this.tone(1568, 0.08, 'sine', 0.03 * volScale, null, 0.05); break;
      case 'victory': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.06 * volScale, null, i * 0.16)); break;
      case 'defeat': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.06 * volScale, null, i * 0.22)); break;
      case 'ping': this.tone(1400, 0.08, 'sine', 0.05 * volScale); break;
      default: break;
    }
  }
}
