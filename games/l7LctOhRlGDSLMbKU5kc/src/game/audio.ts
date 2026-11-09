// Tiny synthesized sound engine — no assets, WebAudio only.
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("bidza-muted") === "1";
    } catch { /* noop */ }
  }

  private ensure(): AudioContext | null {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  unlock() {
    this.ensure();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem("bidza-muted", m ? "1" : "0"); } catch { /* noop */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.5, slideTo?: number, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol = 0.4, delay = 0, lowpass = 1200) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  click() { this.tone(700, 0.07, "triangle", 0.35, 900); }
  dash() { this.noise(0.18, 0.35, 0, 2500); this.tone(220, 0.18, "sawtooth", 0.18, 660); }

  catchGood(combo: number) {
    const base = 440 + Math.min(combo, 20) * 32;
    this.tone(base, 0.12, "triangle", 0.5, base * 1.5);
    this.tone(base * 2, 0.09, "sine", 0.22, base * 2.4, 0.03);
  }
  catchGolden() {
    const seq = [523, 659, 784, 1046, 1318];
    seq.forEach((f, i) => this.tone(f, 0.16, "triangle", 0.45, undefined, i * 0.06));
    this.noise(0.3, 0.12, 0, 6000);
  }
  bad() {
    this.tone(160, 0.35, "sawtooth", 0.5, 55);
    this.noise(0.3, 0.4, 0, 700);
  }
  miss() { this.tone(300, 0.18, "sine", 0.28, 140); }
  heart() {
    this.tone(520, 0.12, "sine", 0.4);
    this.tone(780, 0.18, "sine", 0.4, undefined, 0.1);
  }
  levelUp() {
    [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.14, "square", 0.16, undefined, i * 0.07));
  }
  pizzaComplete() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.4, undefined, i * 0.08));
    this.noise(0.4, 0.15, 0.1, 8000);
  }
  gameOver() {
    [440, 349, 293, 220, 165].forEach((f, i) => this.tone(f, 0.3, "sawtooth", 0.3, f * 0.9, i * 0.16));
    this.noise(0.8, 0.25, 0.2, 500);
  }
  start() {
    [262, 392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.12, "triangle", 0.35, undefined, i * 0.05));
  }
}

export const sound = new SoundEngine();
