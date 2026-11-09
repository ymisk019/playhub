// ─── لعبة بيدزه — Canvas engine (60fps, pooled particles, screen shake) ───
import { sound } from "./audio";

export type DifficultyKey = "easy" | "normal" | "hard";
export type ItemType =
  | "cheese" | "pepperoni" | "mushroom" | "olive" | "basil" | "tomato"
  | "coal" | "bomb" | "golden";

export interface HudState {
  score: number;
  lives: number;
  combo: number;
  maxCombo: number;
  level: number;
  pizzas: number;
  multiplier: number;
  dashReady: number; // 0..1 (1 = ready)
  magnet: boolean;
  fire: boolean;
  progress: number; // pizza progress 0..8
}

export interface GameResult {
  score: number;
  maxCombo: number;
  pizzas: number;
  level: number;
  timeSurvived: number;
}

interface Item {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; size: number;
  type: ItemType; bad: boolean; bonus: boolean;
  wob: number; wobSpeed: number; dead: boolean;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  color: string; grav: number; drag: number;
  shape: 0 | 1 | 2; rot: number; vr: number;
}

interface FloatText {
  x: number; y: number; life: number; max: number;
  text: string; color: string; size: number;
}

interface Dust { x: number; y: number; s: number; v: number; a: number; ph: number }

const BASE_POINTS: Record<string, number> = {
  cheese: 10, pepperoni: 15, mushroom: 10, olive: 12, basil: 15, tomato: 10,
};
const GOOD: ItemType[] = ["cheese", "pepperoni", "mushroom", "olive", "basil", "tomato"];

const DIFF: Record<DifficultyKey, { spawn: number; speed: number; bad: number; label: string }> = {
  easy: { spawn: 1.25, speed: 0.82, bad: 0.72, label: "هادئ" },
  normal: { spawn: 1.0, speed: 1.0, bad: 1.0, label: "شيف" },
  hard: { spawn: 0.72, speed: 1.24, bad: 1.35, label: "مجنون" },
};

function rand(a: number, b: number) { return a + Math.random() * (b - a); }
function pick<T>(arr: T[]): T { return arr[(Math.random() * arr.length) | 0]; }

export class PizzaEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private running = false;
  private destroyed = false;

  private W = 400; private H = 700;
  private dpr = 1;

  difficulty: DifficultyKey = "normal";

  // world state
  private score = 0;
  private lives = 3;
  private combo = 0;
  private maxCombo = 0;
  private pizzas = 0;
  private progress = 0;
  private elapsed = 0;
  private level = 1;
  private nextHeal = 400;

  // player
  private px = 200; private pv = 0; private targetX = 200;
  private pointerActive = false;
  private mouseX: number | null = null;
  private keyL = false; private keyR = false;
  private lastDir = 1;
  private squash = 0;
  private dashT = 0; private dashCd = 0;
  private magnetT = 0; private slowmoT = 0;
  private invulnT = 0;

  // juice
  private trauma = 0;
  private hitstop = 0;
  private redFlash = 0;
  private goldFlash = 0;
  private time = 0;

  private items: Item[] = [];
  private parts: Particle[] = [];
  private floats: FloatText[] = [];
  private dust: Dust[] = [];
  private spawnT = 0.5;

  private hudT = 0;
  private gameOverPending = false;
  private gameOverT = 0;

  onHud: (h: HudState) => void = () => {};
  onGameOver: (r: GameResult) => void = () => {};
  onPauseKey: () => void = () => {};

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) { if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault(); return; }
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { this.keyL = true; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { this.keyR = true; e.preventDefault(); }
    else if (k === " " || k === "Shift") { if (this.running) { this.dash(); e.preventDefault(); } }
    else if (k === "p" || k === "P" || k === "Escape") { this.onPauseKey(); }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") this.keyL = false;
    else if (k === "ArrowRight" || k === "d" || k === "D") this.keyR = false;
  };
  private dragId: number | null = null;
  private onPointerDown = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.targetX = e.clientX - r.left;
    if (e.pointerType === "mouse") {
      this.mouseX = this.targetX;
    } else {
      this.dragId = e.pointerId;
      this.pointerActive = true;
    }
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (e.pointerType === "mouse") {
      this.mouseX = x;
      this.targetX = x;
    } else if (this.dragId !== null && e.pointerId === this.dragId) {
      this.targetX = x;
    } else if (this.pointerActive && this.dragId === null) {
      this.targetX = x;
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    if (this.dragId === null || e.pointerId === this.dragId) {
      this.dragId = null;
      this.pointerActive = false;
    }
  };
  private onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.resize();
    for (let i = 0; i < 26; i++) {
      this.dust.push({ x: Math.random(), y: Math.random(), s: rand(1, 3), v: rand(8, 26), a: rand(0.05, 0.22), ph: rand(0, 6.28) });
    }
  }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("resize", this.onResize);
  }
  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.onResize);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(300, w);
    this.H = Math.max(420, h);
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.px = Math.min(Math.max(this.px, 60), this.W - 60);
    this.targetX = this.px;
  }

  reset(diff: DifficultyKey) {
    this.difficulty = diff;
    this.score = 0; this.lives = 3; this.combo = 0; this.maxCombo = 0;
    this.pizzas = 0; this.progress = 0; this.elapsed = 0; this.level = 1;
    this.nextHeal = 400;
    this.px = this.W / 2; this.pv = 0; this.targetX = this.px;
    this.squash = 0; this.dashT = 0; this.dashCd = 0;
    this.magnetT = 0; this.slowmoT = 0; this.invulnT = 0;
    this.trauma = 0; this.hitstop = 0; this.redFlash = 0; this.goldFlash = 0;
    this.items.length = 0; this.parts.length = 0; this.floats.length = 0;
    this.spawnT = 0.4; this.gameOverPending = false; this.gameOverT = 0;
    this.dragId = null; this.pointerActive = false;
    if (this.mouseX !== null) this.targetX = Math.max(60, Math.min(this.W - 60, this.mouseX));
    this.emitHud();
  }

  start(diff: DifficultyKey) {
    this.reset(diff);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.loop);
    }
  }
  stopLoop() { this.running = false; cancelAnimationFrame(this.raf); }
  resumeLoop() {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { this.destroyed = true; this.stopLoop(); this.detach(); }

  dash() {
    if (this.dashCd > 0 || this.gameOverPending) return;
    const dir = this.keyL && !this.keyR ? -1 : this.keyR && !this.keyL ? 1 : this.lastDir;
    this.lastDir = dir;
    this.dashT = 0.2;
    this.dashCd = 2.6;
    this.pv = dir * 1250;
    this.trauma = Math.min(1, this.trauma + 0.12);
    sound.dash();
    const py = this.playerY();
    for (let i = 0; i < 12; i++) {
      this.spawnPart(this.px - dir * 40 + rand(-20, 20), py + rand(-8, 8), -dir * rand(200, 520), rand(-60, 60), rand(0.2, 0.4), rand(2, 5), "255,220,150", -200, 2, 1);
    }
    this.emitHud();
  }

  private playerY() { return this.H - Math.max(84, this.H * 0.13); }
  private trayW() { return Math.min(156, Math.max(104, this.W * 0.3)); }

  private multiplier() {
    if (this.combo >= 15) return 5;
    if (this.combo >= 10) return 3;
    if (this.combo >= 5) return 2;
    return 1;
  }

  private loop = (now: number) => {
    if (!this.running || this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;

    // hit-stop: freeze world briefly
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.render(dt);
      return;
    }

    let scale = 1;
    if (this.slowmoT > 0) { this.slowmoT -= dt; scale = 0.42; }
    const wdt = dt * scale;
    this.time += dt;
    this.update(wdt, dt);
    this.render(dt);

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.08; this.emitHud(); }
  };

  private update(dt: number, realDt: number) {
    const cfg = DIFF[this.difficulty];
    this.elapsed += dt;
    const newLevel = 1 + Math.floor(this.elapsed / 16);
    if (newLevel !== this.level) {
      this.level = newLevel;
      sound.levelUp();
      this.addFloat(this.W / 2, this.H * 0.35, `🔥 فرن ${this.level} 🔥`, "#ffbe33", 30);
      this.trauma = Math.min(1, this.trauma + 0.15);
      for (let i = 0; i < 18; i++) this.spawnPart(rand(0, this.W), this.H * 0.3, rand(-160, 160), rand(-320, -80), rand(0.5, 1), rand(3, 6), "255,150,50", 300, 1, 0);
    }

    // timers
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashT > 0) this.dashT -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - realDt * 5);
    if (this.redFlash > 0) this.redFlash = Math.max(0, this.redFlash - realDt * 1.8);
    if (this.goldFlash > 0) this.goldFlash = Math.max(0, this.goldFlash - realDt * 1.4);
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);

    // game-over delay
    if (this.gameOverPending) {
      this.gameOverT -= realDt;
      this.updateParts(dt);
      this.updateFloats(dt);
      if (this.gameOverT <= 0) {
        this.gameOverPending = false;
        this.running = false;
        this.onGameOver({ score: this.score, maxCombo: this.maxCombo, pizzas: this.pizzas, level: this.level, timeSurvived: this.elapsed });
      }
      return;
    }

    // ── player movement ──
    const half = this.trayW() / 2;
    const accel = 5200, maxSp = this.dashT > 0 ? 1350 : 760;
    if (this.keyL || this.keyR) {
      const dir = (this.keyR ? 1 : 0) - (this.keyL ? 1 : 0);
      this.pv += dir * accel * dt;
      this.lastDir = dir !== 0 ? dir : this.lastDir;
      this.mouseX = null;
    } else if (this.pointerActive || this.mouseX !== null) {
      // tight exponential follow for pointer/mouse
      const k = 1 - Math.exp(-16 * dt);
      const nx = this.px + (this.targetX - this.px) * k;
      this.pv = (nx - this.px) / Math.max(dt, 0.0001);
      this.px = nx;
      if (Math.abs(this.targetX - this.px) > 4) this.lastDir = this.targetX > this.px ? 1 : -1;
    } else {
      this.pv *= Math.exp(-9 * dt);
    }
    if (this.keyL || this.keyR) {
      this.pv = Math.max(-maxSp, Math.min(maxSp, this.pv));
      this.px += this.pv * dt;
    } else if (!this.pointerActive && this.mouseX === null) {
      this.pv = Math.max(-maxSp, Math.min(maxSp, this.pv));
      this.px += this.pv * dt;
    }
    // clamp
    if (this.px < half + 6) { this.px = half + 6; this.pv = Math.max(0, this.pv); }
    if (this.px > this.W - half - 6) { this.px = this.W - half - 6; this.pv = Math.min(0, this.pv); }

    // ── spawning ──
    const speedMul = cfg.speed * (1 + (this.level - 1) * 0.09);
    const baseInterval = Math.max(0.3, 0.92 - this.level * 0.055 - this.elapsed * 0.0012) * cfg.spawn;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.items.length < 22) {
      this.spawnT = baseInterval * rand(0.7, 1.25);
      this.spawnItem(speedMul, cfg.bad);
    }

    // ── items ──
    const py = this.playerY();
    const magnet = this.magnetT > 0;
    const magnetR = 240;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (magnet && !it.bad) {
        const dx = this.px - it.x;
        if (Math.abs(dx) < magnetR && it.y > -20 && it.y < py) {
          it.vx += dx * 9 * dt;
          it.vy -= 160 * dt;
        }
      }
      it.wob += it.wobSpeed * dt;
      it.x += (it.vx + Math.sin(it.wob) * 32) * dt;
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
      if (it.x < -40) it.x = -40; else if (it.x > this.W + 40) it.x = this.W + 40;

      // catch?
      const dx = Math.abs(it.x - this.px);
      const dy = it.y - py;
      if (!it.dead && dy > -34 && dy < 22 && dx < half + it.size * 0.32) {
        it.dead = true;
        this.items.splice(i, 1);
        if (it.bad) this.onBadCatch(it);
        else if (it.bonus) this.onGolden(it);
        else this.onGoodCatch(it);
        continue;
      }
      // missed
      if (it.y > this.H + 46) {
        this.items.splice(i, 1);
        if (!it.bad && !it.bonus) this.onMiss(it);
      }
    }

    this.updateParts(dt);
    this.updateFloats(dt);
    // dust
    for (const d of this.dust) {
      d.y -= (d.v * dt) / this.H;
      d.ph += dt;
      if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
    }
  }

  private updateParts(dt: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }
  private updateFloats(dt: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      f.y -= 66 * dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
  }

  private spawnItem(speedMul: number, badMul: number) {
    const roll = Math.random();
    const badChance = Math.min(0.3, (0.13 + this.level * 0.008) * badMul);
    const goldChance = 0.045;
    let type: ItemType;
    let bad = false, bonus = false;
    if (roll < goldChance) { type = "golden"; bonus = true; }
    else if (roll < goldChance + badChance) { type = Math.random() < 0.62 ? "coal" : "bomb"; bad = true; }
    else { type = pick(GOOD); }
    const size = type === "golden" ? 34 : type === "bomb" ? 34 : bad ? 32 : rand(26, 34);
    const vy = rand(210, 300) * speedMul * rand(0.9, 1.15) + this.elapsed * 0.9;
    this.items.push({
      x: rand(30, this.W - 30), y: -40,
      vx: rand(-46, 46), vy: Math.min(720, vy),
      rot: rand(0, 6.28), vr: rand(-3, 3),
      size, type, bad, bonus, wob: rand(0, 6.28), wobSpeed: rand(2, 5), dead: false,
    });
  }

  private spawnPart(x: number, y: number, vx: number, vy: number, life: number, size: number, rgb: string, grav: number, drag: number, shape: 0 | 1 | 2) {
    if (this.parts.length > 300) this.parts.shift();
    this.parts.push({ x, y, vx, vy, life, max: life, size, color: rgb, grav, drag, shape, rot: rand(0, 6.28), vr: rand(-8, 8) });
  }

  private burst(x: number, y: number, rgb: string, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(90, 340) * power;
      this.spawnPart(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 160, rand(0.35, 0.8), rand(2.5, 6), rgb, 900, 1.6, (Math.floor(Math.random() * 3) as 0 | 1 | 2));
    }
  }

  private addFloat(x: number, y: number, text: string, color: string, size: number) {
    if (this.floats.length > 18) this.floats.shift();
    const cx = Math.max(60, Math.min(this.W - 60, x));
    this.floats.push({ x: cx, y, life: 1.05, max: 1.05, text, color, size });
  }

  private onGoodCatch(it: Item) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = this.multiplier();
    const pts = (BASE_POINTS[it.type] || 10) * mult;
    this.score += pts;
    this.progress++;
    this.squash = 1;
    this.invulnT = Math.max(this.invulnT, 0); // no-op clarity
    sound.catchGood(this.combo);
    const py = this.playerY();
    this.burst(it.x, py - 18, "255,190,51", 10, 1);
    this.burst(it.x, py - 18, "255,255,255", 4, 0.7);
    const label = mult > 1 ? `+${pts}` : `+${pts}`;
    this.addFloat(it.x, py - 52, label, mult >= 3 ? "#ff5d3b" : mult >= 2 ? "#ffbe33" : "#fff7e6", mult >= 3 ? 26 : 20);

    if (this.combo === 5 || this.combo === 10 || this.combo === 15 || this.combo === 20 || this.combo === 30) {
      this.addFloat(this.px, py - 110, `كومبو ×${mult} 🔥`, "#ff7a3b", 24);
      this.trauma = Math.min(1, this.trauma + 0.14);
      sound.levelUp();
    }
    // pizza complete
    if (this.progress >= 8) {
      this.progress = 0;
      this.pizzas++;
      const bonus = 100 * mult;
      this.score += bonus;
      sound.pizzaComplete();
      this.addFloat(this.W / 2, this.H * 0.4, `🍕 بيتزا كاملة! +${bonus}`, "#ffbe33", 30);
      for (let i = 0; i < 34; i++) {
        this.spawnPart(rand(0, this.W), rand(this.H * 0.2, this.H * 0.5), rand(-220, 220), rand(-380, -60), rand(0.7, 1.4), rand(3, 7),
          pick(["255,190,51", "230,59,46", "47,191,113", "255,255,255"]), 500, 1.2, (Math.floor(Math.random() * 3) as 0 | 1 | 2));
      }
      this.trauma = Math.min(1, this.trauma + 0.2);
      this.emitHud();
    }
    // heal
    if (this.score >= this.nextHeal) {
      this.nextHeal += 500;
      if (this.lives < 3) {
        this.lives++;
        sound.heart();
        this.addFloat(this.px, py - 140, "+ ❤ قلب!", "#ff6b8a", 24);
        this.burst(this.px, py - 30, "255,107,138", 16, 1);
      }
    }
    this.emitHud();
  }

  private onGolden(it: Item) {
    const mult = this.multiplier();
    const pts = 50 * mult;
    this.score += pts;
    this.combo += 2;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.magnetT = 4;
    this.slowmoT = 1.4;
    this.goldFlash = 0.7;
    this.squash = 1;
    sound.catchGolden();
    const py = this.playerY();
    this.addFloat(it.x, py - 70, `⭐ ذهبية +${pts}`, "#ffe27a", 28);
    this.addFloat(this.px, py - 110, "مغناطيس + تباطؤ!", "#8ecae6", 18);
    for (let i = 0; i < 26; i++) {
      this.spawnPart(it.x, py - 20, rand(-320, 320), rand(-460, -80), rand(0.5, 1.1), rand(2, 6),
        pick(["255,226,122", "255,255,255", "255,190,51"]), 420, 1.4, (Math.floor(Math.random() * 3) as 0 | 1 | 2));
    }
    this.emitHud();
  }

  private onBadCatch(it: Item) {
    if (this.invulnT > 0 || this.gameOverPending) return;
    this.lives--;
    this.combo = 0;
    this.squash = 1;
    this.trauma = 1;
    this.hitstop = 0.09;
    this.redFlash = 0.75;
    this.invulnT = 1.0;
    sound.bad();
    const py = this.playerY();
    const name = it.type === "bomb" ? "💥 قنبلة!" : "⚫ فحم!";
    this.addFloat(it.x, py - 70, `${name} -❤`, "#ff5d5d", 26);
    this.burst(it.x, py - 16, it.type === "bomb" ? "80,80,90" : "40,40,46", 22, 1.4);
    this.burst(it.x, py - 16, "255,90,40", 14, 1.2);
    // knock items slightly away? no
    if (this.lives <= 0) {
      this.lives = 0;
      this.gameOverPending = true;
      this.gameOverT = 1.1;
      this.slowmoT = 0.9;
      sound.gameOver();
      this.addFloat(this.W / 2, this.H * 0.42, "احترق الفرن!!", "#ff5d5d", 34);
      for (let i = 0; i < 46; i++) {
        this.spawnPart(this.px, py - 20, rand(-420, 420), rand(-560, -60), rand(0.6, 1.3), rand(3, 8),
          pick(["255,90,40", "60,60,70", "255,190,51", "255,255,255"]), 700, 1.3, (Math.floor(Math.random() * 3) as 0 | 1 | 2));
      }
    }
    this.emitHud();
  }

  private onMiss(it: Item) {
    if (this.gameOverPending) return;
    if (this.combo >= 5) {
      this.addFloat(it.x, this.H - 120, "فاتتك!", "#c9b8a8", 17);
      sound.miss();
      this.trauma = Math.min(1, this.trauma + 0.18);
    }
    this.combo = 0;
    this.emitHud();
  }

  private emitHud() {
    this.onHud({
      score: this.score, lives: this.lives, combo: this.combo,
      maxCombo: this.maxCombo, level: this.level, pizzas: this.pizzas,
      multiplier: this.multiplier(),
      dashReady: this.dashCd <= 0 ? 1 : 1 - this.dashCd / 2.6,
      magnet: this.magnetT > 0, fire: this.combo >= 10,
      progress: this.progress,
    });
  }

  // ─────────────── RENDER ───────────────
  private render(realDt: number) {
    const { ctx, W, H } = this;
    void realDt;
    ctx.save();
    // screen shake
    const sh = this.trauma * this.trauma;
    if (sh > 0.001) {
      ctx.translate(rand(-1, 1) * sh * 16, rand(-1, 1) * sh * 14);
    }
    this.drawBackground();
    // magnet ring
    if (this.magnetT > 0) {
      const py = this.playerY();
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(this.time * 8) * 0.12;
      ctx.strokeStyle = "#8ecae6";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(this.px, py - 10, 120 + Math.sin(this.time * 6) * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const it of this.items) this.drawItem(it);
    this.drawPlayer();
    this.drawParts();
    this.drawFloats();
    ctx.restore();

    // overlays (no shake)
    if (this.redFlash > 0) {
      ctx.fillStyle = `rgba(230,40,30,${(this.redFlash * 0.32).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.goldFlash > 0) {
      ctx.fillStyle = `rgba(255,210,90,${(this.goldFlash * 0.18).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.slowmoT > 0) {
      ctx.fillStyle = "rgba(140,200,255,0.07)";
      ctx.fillRect(0, 0, W, H);
    }
    // invuln blink edge
    if (this.invulnT > 0 && !this.gameOverPending && Math.floor(this.time * 10) % 2 === 0) {
      ctx.strokeStyle = "rgba(255,90,90,0.5)";
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, W - 8, H - 8);
    }
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  private drawBackground() {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#241210");
    g.addColorStop(0.55, "#1a0e0c");
    g.addColorStop(1, "#0f0807");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // oven glow (left) with flicker
    const flick = 0.85 + Math.sin(this.time * 7.3) * 0.06 + Math.sin(this.time * 13.7) * 0.04;
    const og = ctx.createRadialGradient(W * 0.08, H * 0.22, 10, W * 0.08, H * 0.22, W * 0.55);
    og.addColorStop(0, `rgba(255,120,40,${0.22 * flick})`);
    og.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, W, H);

    // neon glow (right)
    const ng = ctx.createRadialGradient(W * 0.92, H * 0.18, 10, W * 0.92, H * 0.18, W * 0.4);
    ng.addColorStop(0, "rgba(255,60,80,0.10)");
    ng.addColorStop(1, "rgba(255,60,80,0)");
    ctx.fillStyle = ng;
    ctx.fillRect(0, 0, W, H);

    // brick lines (cheap)
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rowH = 34;
    for (let y = 40; y < H * 0.7; y += rowH) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();

    // hanging bulbs
    const n = Math.max(3, Math.floor(W / 130));
    for (let i = 0; i < n; i++) {
      const bx = (W / (n + 1)) * (i + 1) + Math.sin(this.time * 1.2 + i * 2) * 6;
      const len = 44 + (i % 2) * 14;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, len); ctx.stroke();
      const glow = ctx.createRadialGradient(bx, len + 12, 2, bx, len + 12, 30);
      glow.addColorStop(0, "rgba(255,200,110,0.85)");
      glow.addColorStop(0.35, "rgba(255,170,70,0.25)");
      glow.addColorStop(1, "rgba(255,170,70,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(bx, len + 12, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd98a";
      ctx.beginPath(); ctx.arc(bx, len + 12, 5, 0, Math.PI * 2); ctx.fill();
    }

    // floor
    const fy = H - Math.max(56, H * 0.085);
    const fg = ctx.createLinearGradient(0, fy, 0, H);
    fg.addColorStop(0, "#3a2418");
    fg.addColorStop(1, "#1c100b");
    ctx.fillStyle = fg;
    ctx.fillRect(-20, fy, W + 40, H - fy + 20);
    ctx.fillStyle = "rgba(255,180,90,0.14)";
    ctx.fillRect(-20, fy, W + 40, 2);

    // flour dust
    ctx.fillStyle = "#fff";
    for (const d of this.dust) {
      ctx.globalAlpha = d.a * (0.7 + Math.sin(d.ph) * 0.3);
      ctx.beginPath();
      ctx.arc(d.x * W + Math.sin(d.ph) * 8, d.y * H, d.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer() {
    const { ctx } = this;
    const py = this.playerY();
    const tw = this.trayW();
    const tilt = Math.max(-0.22, Math.min(0.22, this.pv / 2400));
    const sq = this.squash; // 0..1
    const sx = 1 + sq * 0.16;
    const sy = 1 - sq * 0.22;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(this.px, py + 26, tw * 0.48, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // dash ghosts
    if (this.dashT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#ffbe33";
      const gx = this.px - this.lastDir * 46;
      ctx.beginPath();
      ctx.ellipse(gx, py, tw * 0.42, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // fire trail
    if (this.combo >= 10 && !this.gameOverPending) {
      for (let i = 0; i < 3; i++) {
        const fx = this.px + rand(-tw * 0.35, tw * 0.35);
        const fh = rand(14, 30) * (1 + Math.sin(this.time * 20 + i * 2) * 0.25);
        ctx.fillStyle = i === 0 ? "rgba(255,90,30,0.85)" : i === 1 ? "rgba(255,160,40,0.7)" : "rgba(255,220,100,0.6)";
        ctx.beginPath();
        ctx.moveTo(fx - 7, py + 8);
        ctx.quadraticCurveTo(fx, py - fh, fx + 7, py + 8);
        ctx.closePath(); ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(this.px, py);
    ctx.rotate(tilt);
    ctx.scale(sx, sy);

    // pizza being built (mini)
    const layers = Math.min(7, this.progress);
    // crust
    ctx.fillStyle = "#e8a94e";
    ctx.beginPath(); ctx.ellipse(0, -10, tw * 0.36, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5c86e";
    ctx.beginPath(); ctx.ellipse(0, -12, tw * 0.33, 11, 0, 0, Math.PI * 2); ctx.fill();
    // sauce
    ctx.fillStyle = "#d93a2b";
    ctx.beginPath(); ctx.ellipse(0, -12, tw * 0.27, 8.5, 0, 0, Math.PI * 2); ctx.fill();
    // cheese + toppings dots grow with progress
    ctx.fillStyle = "#ffdf8a";
    ctx.beginPath(); ctx.ellipse(0, -12, tw * 0.23, 7, 0, 0, Math.PI * 2); ctx.fill();
    const dotColors = ["#d93a2b", "#2fbf71", "#7a4a21", "#222"];
    for (let i = 0; i < layers; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.5;
      const rr = tw * 0.13 * ((i % 3) / 2 + 0.4);
      ctx.fillStyle = dotColors[i % dotColors.length];
      ctx.beginPath(); ctx.arc(Math.cos(a) * rr, -12 + Math.sin(a) * 4.5, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    // golden shimmer
    if (this.magnetT > 0) {
      ctx.strokeStyle = `rgba(142,202,230,${0.6 + Math.sin(this.time * 10) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -11, tw * 0.38, 14, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // wooden tray
    const tg = ctx.createLinearGradient(0, -4, 0, 14);
    tg.addColorStop(0, "#b07a3e");
    tg.addColorStop(0.5, "#8b5a2b");
    tg.addColorStop(1, "#5f3a17");
    ctx.fillStyle = tg;
    ctx.beginPath();
    const r = 9;
    const x0 = -tw / 2, y0 = -2, w = tw, h = 14;
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
    ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + w, y0, r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x0 + 8, y0 + 2, w - 16, 2.5);
    // handles
    ctx.fillStyle = "#4a2c12";
    ctx.fillRect(x0 - 10, y0 + 3, 10, 6);
    ctx.fillRect(x0 + w, y0 + 3, 10, 6);

    ctx.restore();

    // dash cooldown pips under tray
    // (drawn in DOM HUD instead; skip)
  }

  private drawItem(it: Item) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    const s = it.size;
    // danger pulse for bad
    if (it.bad) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 9 + it.wob) * 0.25;
      ctx.strokeStyle = "#ff3b30";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.68, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(3, s * 0.42, s * 0.4, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();

    switch (it.type) {
      case "cheese": {
        ctx.fillStyle = "#ffbe33";
        ctx.strokeStyle = "#b97a12";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-s * 0.45, s * 0.3); ctx.lineTo(s * 0.45, s * 0.3); ctx.lineTo(0, -s * 0.45); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e09b1a";
        ctx.beginPath(); ctx.arc(-s * 0.1, s * 0.05, s * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.14, -s * 0.1, s * 0.07, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "pepperoni": {
        ctx.fillStyle = "#d93a2b";
        ctx.strokeStyle = "#8f1f14";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#a32216";
        ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.08, s * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.12, s * 0.1, s * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.05, -s * 0.16, s * 0.06, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "mushroom": {
        ctx.fillStyle = "#f3e7d3";
        ctx.fillRect(-s * 0.1, -s * 0.05, s * 0.2, s * 0.4);
        ctx.fillStyle = "#c96f4a";
        ctx.strokeStyle = "#8a4526";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -s * 0.12, s * 0.42, s * 0.28, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(-s * 0.14, -s * 0.22, s * 0.07, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "olive": {
        ctx.fillStyle = "#2b2b33";
        ctx.strokeStyle = "#101016";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#5a3a5a";
        ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.14, s * 0.06, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "basil": {
        ctx.fillStyle = "#2fbf71";
        ctx.strokeStyle = "#166b3d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.45);
        ctx.quadraticCurveTo(s * 0.45, -s * 0.1, 0, s * 0.45);
        ctx.quadraticCurveTo(-s * 0.45, -s * 0.1, 0, -s * 0.45);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#166b3d";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.38); ctx.lineTo(0, s * 0.38); ctx.stroke();
        break;
      }
      case "tomato": {
        ctx.fillStyle = "#ef4444";
        ctx.strokeStyle = "#991b1b";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, s * 0.05, s * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.32);
        ctx.lineTo(-s * 0.16, -s * 0.14); ctx.lineTo(0, -s * 0.2); ctx.lineTo(s * 0.16, -s * 0.14);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.05, s * 0.07, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "coal": {
        ctx.fillStyle = "#232228";
        ctx.strokeStyle = "#0c0c10";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const n = 7;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = s * 0.4 * (0.85 + ((i * 37) % 10) / 28);
          const px = Math.cos(a) * rr, pyy = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, pyy); else ctx.lineTo(px, pyy);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = `rgba(255,110,30,${0.7 + Math.sin(this.time * 11 + it.wob) * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-s * 0.18, -s * 0.05); ctx.lineTo(0, s * 0.08); ctx.lineTo(s * 0.18, -s * 0.1); ctx.stroke();
        // smoke
        ctx.fillStyle = "rgba(150,150,160,0.35)";
        ctx.beginPath(); ctx.arc(Math.sin(this.time * 5 + it.wob) * 4, -s * 0.55, s * 0.12, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "bomb": {
        ctx.fillStyle = "#1d1d24";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, s * 0.05, s * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#8b5a2b";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s * 0.1, -s * 0.28); ctx.quadraticCurveTo(s * 0.3, -s * 0.5, s * 0.42, -s * 0.42); ctx.stroke();
        // spark
        const sa = this.time * 18 + it.wob;
        ctx.fillStyle = "#ffd23b";
        ctx.beginPath(); ctx.arc(s * 0.42 + Math.cos(sa) * 2, -s * 0.42 + Math.sin(sa) * 2, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff7a2b";
        ctx.beginPath(); ctx.arc(s * 0.42, -s * 0.42, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath(); ctx.arc(-s * 0.1, -s * 0.06, s * 0.08, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "golden": {
        ctx.shadowColor = "rgba(255,210,90,0.9)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#ffd94d";
        ctx.strokeStyle = "#a87400";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const R1 = s * 0.5, R2 = s * 0.22;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? R1 : R2;
          const px = Math.cos(a) * rr, pyy = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, pyy); else ctx.lineTo(px, pyy);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#a87400";
        ctx.font = `900 ${Math.floor(s * 0.55)}px Cairo, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("★", 0, 2);
        break;
      }
    }
    ctx.restore();
  }

  private drawParts() {
    const { ctx } = this;
    for (const p of this.parts) {
      const t = p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.4));
      ctx.fillStyle = `rgba(${p.color},1)`;
      if (p.shape === 0) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        ctx.restore();
      } else if (p.shape === 1) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5 * t + 0.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rr = i % 2 === 0 ? p.size * 0.6 : p.size * 0.25;
          const px = Math.cos(a) * rr, pyy = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, pyy); else ctx.lineTo(px, pyy);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFloats() {
    const { ctx } = this;
    ctx.textAlign = "center";
    for (const f of this.floats) {
      const t = f.life / f.max;
      const scale = t > 0.8 ? 1 + (t - 0.8) * 2.2 : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 2.2);
      ctx.translate(f.x, f.y);
      ctx.scale(scale, scale);
      ctx.font = `900 ${f.size}px Cairo, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }
}
