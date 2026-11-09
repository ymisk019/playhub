import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, Home, Volume2, VolumeX, Trophy, Heart,
  Flame, Star, Zap, ChefHat, Crown, Timer, Pizza as PizzaIcon, Medal, Sparkles, Bomb, ArrowLeft, ArrowRight,
} from "lucide-react";
import { PizzaEngine, type DifficultyKey, type GameResult, type HudState } from "./game/engine";
import { sound } from "./game/audio";
import { getScores, saveScore, getBest, isHighScore, type ScoreEntry } from "./game/storage";

type Screen = "menu" | "playing" | "paused" | "gameover";

const DIFFS: { key: DifficultyKey; label: string; desc: string }[] = [
  { key: "easy", label: "هادئ", desc: "للتسخين" },
  { key: "normal", label: "شيف", desc: "التجربة الأصلية" },
  { key: "hard", label: "مجنون", desc: "فرن جهنم" },
];

const initialHud: HudState = {
  score: 0, lives: 3, combo: 0, maxCombo: 0, level: 1, pizzas: 0,
  multiplier: 1, dashReady: 1, magnet: false, fire: false, progress: 0,
};

function PizzaLogo({ size = 120, spin = true }: { size?: number; spin?: boolean }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className={`${spin ? "animate-spin-slow" : ""} absolute inset-0 rounded-full shadow-[0_18px_50px_-10px_rgba(255,150,50,0.55)]`}
        style={{ background: "conic-gradient(from 0deg, #f5c86e, #e8a94e, #f5c86e, #e0a04a, #f5c86e)" }}>
        <div className="absolute inset-[7%] rounded-full" style={{ background: "#d93a2b" }} />
        <div className="absolute inset-[14%] rounded-full" style={{ background: "#ffdf8a" }} />
        {/* pepperoni */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          const r = 26;
          return (
            <div key={i} className="absolute rounded-full shadow-inner"
              style={{
                width: size * 0.16, height: size * 0.16, background: "#c22e20",
                border: "2px solid #8f1f14",
                left: `calc(50% + ${Math.cos(a) * r * (size / 120)}px - ${size * 0.08}px)`,
                top: `calc(50% + ${Math.sin(a) * r * (size / 120)}px - ${size * 0.08}px)`,
              }} />
          );
        })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: size * 0.14, height: size * 0.14, background: "#2fbf71", border: "2px solid #166b3d" }} />
      </div>
      {/* shine */}
      <div className="absolute left-[16%] top-[10%] h-[18%] w-[30%] rotate-[-24deg] rounded-full bg-white/40 blur-[3px]" />
    </div>
  );
}

function HighTable({ scores, compact = false }: { scores: ScoreEntry[]; compact?: boolean }) {
  if (scores.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-5 text-center text-sm text-[#c9b8a8]">
        لا توجد نتائج بعد — كن أول شيف أسطوري! 🍕
      </div>
    );
  }
  return (
    <div className={`space-y-1.5 ${compact ? "max-h-44" : "max-h-56"} overflow-y-auto no-scrollbar`}>
      {scores.map((s, i) => (
        <div key={s.id}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${i === 0 ? "border-[#ffbe33]/50 bg-[#ffbe33]/10" : "border-white/8 bg-white/[0.04]"}`}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${i === 0 ? "bg-[#ffbe33] text-[#3a2000]" : i === 1 ? "bg-white/20 text-white" : i === 2 ? "bg-[#b07a3e] text-white" : "bg-white/10 text-[#c9b8a8]"}`}>
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-[#fff7e6]">{s.name}</div>
            <div className="text-[11px] text-[#c9b8a8]">🔥{s.level} · 🍕{s.pizzas} · كومبو {s.combo}</div>
          </div>
          <div className="flex items-center gap-1 font-black text-[#ffbe33]">
            {i === 0 && <Crown className="h-3.5 w-3.5" />}
            {s.score.toLocaleString("ar-EG")}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PizzaEngine | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState>(initialHud);
  const [difficulty, setDifficulty] = useState<DifficultyKey>("normal");
  const [muted, setMuted] = useState(sound.muted);
  const [scores, setScores] = useState<ScoreEntry[]>(() => getScores());
  const [best, setBest] = useState(() => getBest());
  const [result, setResult] = useState<GameResult | null>(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem("bidza-name") || ""; } catch { return ""; } });
  const [saved, setSaved] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // init engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const eng = new PizzaEngine(canvas);
    engineRef.current = eng;
    eng.onHud = (h) => setHud(h);
    eng.onGameOver = (r) => {
      setResult(r);
      setBest(getBest());
      setNewBest(r.score > getBest() && r.score > 0);
      setSaved(false);
      setScores(getScores());
      setScreen("gameover");
    };
    eng.onPauseKey = () => {
      const s = screenRef.current;
      if (s === "playing") pauseGame();
      else if (s === "paused") resumeGame();
    };
    eng.attach();
    eng.resize();
    const t = setTimeout(() => eng.resize(), 100);
    return () => { clearTimeout(t); eng.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = useCallback((d?: DifficultyKey) => {
    const diff = d ?? difficulty;
    sound.unlock();
    sound.start();
    setHud(initialHud);
    setResult(null);
    setSaved(false);
    setNewBest(false);
    setShowHint(true);
    setTimeout(() => setShowHint(false), 4200);
    engineRef.current?.start(diff);
    setScreen("playing");
  }, [difficulty]);

  const pauseGame = useCallback(() => {
    sound.click();
    engineRef.current?.stopLoop();
    setScreen("paused");
  }, []);

  const resumeGame = useCallback(() => {
    sound.unlock(); sound.click();
    engineRef.current?.resumeLoop();
    setScreen("playing");
  }, []);

  const quitToMenu = useCallback(() => {
    sound.click();
    engineRef.current?.stopLoop();
    setScores(getScores());
    setBest(getBest());
    setScreen("menu");
  }, []);

  const toggleMute = useCallback(() => {
    const m = !muted;
    setMuted(m);
    sound.setMuted(m);
    if (!m) sound.click();
  }, [muted]);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = screenRef.current;
      if (s === "menu" && (e.key === " " || e.key === "Enter")) { e.preventDefault(); startGame(); }
      else if (s === "gameover" && (e.key === "r" || e.key === "R" || e.key === " " || e.key === "Enter")) { e.preventDefault(); startGame(); }
      else if (s === "paused" && (e.key === "r" || e.key === "R")) { e.preventDefault(); startGame(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startGame]);

  const handleSave = () => {
    if (!result || saved) return;
    const n = name.trim() || "شيف مجهول";
    try { localStorage.setItem("bidza-name", n); } catch { /* noop */ }
    const list = saveScore({
      name: n, score: result.score, combo: result.maxCombo,
      pizzas: result.pizzas, level: result.level,
      difficulty: DIFFS.find((d) => d.key === difficulty)?.label ?? "شيف",
    });
    setScores(list);
    setBest(getBest());
    setSaved(true);
    sound.pizzaComplete();
  };

  const canSave = result && isHighScore(result.score) && !saved;

  return (
    <div className="brick-bg relative flex h-dvh w-full flex-col overflow-hidden" dir="rtl">
      {/* top glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/50 to-transparent" />

      {/* GAME AREA */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="game-canvas absolute inset-0" />

        {/* HUD */}
        {(screen === "playing" || screen === "paused") && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3 sm:px-5" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <div className="mx-auto flex max-w-2xl items-start justify-between gap-2">
              {/* score block */}
              <div className="rounded-2xl border border-white/10 bg-black/55 px-3.5 py-2 shadow-lg backdrop-blur-md">
                <div className="text-[10px] font-bold text-[#c9b8a8]">النقاط</div>
                <div key={hud.score} className="animate-score-pop text-2xl font-black leading-none text-[#ffbe33] tabular-nums">
                  {hud.score.toLocaleString("ar-EG")}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-[#c9b8a8]">
                  <span className="flex items-center gap-0.5"><PizzaIcon className="h-3 w-3 text-[#ffbe33]" />{hud.pizzas}</span>
                  <span className="flex items-center gap-0.5"><Flame className="h-3 w-3 text-orange-400" />{hud.level}</span>
                  <span className="text-white/30">|</span>
                  <span className="flex items-center gap-0.5 text-white/70"><Trophy className="h-3 w-3 text-[#ffbe33]" />{Math.max(best, hud.score).toLocaleString("ar-EG")}</span>
                </div>
              </div>

              {/* combo */}
              <div className="flex flex-col items-center gap-1.5 pt-0.5">
                {hud.combo >= 2 && (
                  <div className={`animate-pop-in flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-black shadow-lg backdrop-blur-md ${hud.fire ? "animate-combo border-orange-400/60 bg-gradient-to-l from-[#e63b2e] to-[#ff8a2b] text-white" : hud.multiplier >= 2 ? "border-[#ffbe33]/60 bg-[#ffbe33]/15 text-[#ffbe33]" : "border-white/15 bg-black/55 text-white"}`}>
                    {hud.fire ? <Flame className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                    كومبو {hud.combo} · ×{hud.multiplier}
                  </div>
                )}
                {hud.magnet && (
                  <div className="animate-pop-in flex items-center gap-1 rounded-full border border-sky-300/50 bg-sky-400/15 px-2.5 py-1 text-[11px] font-black text-sky-200 backdrop-blur-md">
                    <Sparkles className="h-3 w-3" /> مغناطيس!
                  </div>
                )}
                {/* pizza progress */}
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 backdrop-blur-md">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className={`h-1.5 w-3 rounded-full transition-all ${i < hud.progress ? "bg-[#ffbe33]" : "bg-white/15"}`} />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold text-[#c9b8a8]">بيتزا</span>
                </div>
              </div>

              {/* lives + buttons */}
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-black/55 px-2.5 py-2 backdrop-blur-md">
                  {[0, 1, 2].map((i) => (
                    <Heart key={`${i}-${hud.lives > i}`} className={`h-5 w-5 transition-all ${hud.lives > i ? "fill-[#ff4d6d] text-[#ff4d6d] drop-shadow-[0_0_6px_rgba(255,77,109,0.7)]" : "fill-white/10 text-white/20"}`} />
                  ))}
                </div>
                <div className="pointer-events-auto flex gap-1.5">
                  <button onClick={toggleMute} aria-label="الصوت"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/55 text-white/80 backdrop-blur-md transition active:scale-90">
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <button onClick={() => (screen === "playing" ? pauseGame() : resumeGame())} aria-label="إيقاف"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/55 text-white/80 backdrop-blur-md transition active:scale-90">
                    {screen === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* first-run hint */}
        {screen === "playing" && showHint && (
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center px-4">
            <div className="animate-slide-up flex items-center gap-3 rounded-2xl border border-[#ffbe33]/30 bg-black/70 px-4 py-2.5 text-sm font-bold text-[#fff7e6] backdrop-blur-md">
              <span className="flex items-center gap-1 text-[#ffbe33]"><ArrowRight className="h-4 w-4" /><ArrowLeft className="h-4 w-4" /></span>
              اسحب أو حرّك بالأسهم — امسك الطازج وتجنب الفحم!
              <span className="hidden items-center gap-1 rounded-lg bg-white/10 px-2 py-0.5 text-[11px] sm:flex"><Zap className="h-3 w-3" /> مسافة = داش</span>
            </div>
          </div>
        )}

        {/* dash button (mobile) */}
        {screen === "playing" && (
          <div className="absolute bottom-6 left-4 z-20 sm:bottom-8 sm:left-6">
            <button
              onPointerDown={(e) => { e.preventDefault(); engineRef.current?.dash(); }}
              className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#ffbe33]/50 bg-gradient-to-b from-[#ffbe33]/25 to-[#e63b2e]/25 text-[#ffbe33] shadow-[0_0_24px_rgba(255,190,51,0.35)] backdrop-blur-md transition active:scale-90"
              aria-label="داش">
              <Zap className="h-7 w-7 fill-current" />
              <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                <circle cx="32" cy="32" r="28" fill="none" stroke="#ffbe33" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${(hud.dashReady * 175.9).toFixed(1)} 175.9`} />
              </svg>
            </button>
            <div className="mt-1 text-center text-[10px] font-black text-[#ffbe33]/80">داش</div>
          </div>
        )}

        {/* ── START SCREEN ── */}
        {screen === "menu" && (
          <div className="absolute inset-0 z-30 overflow-y-auto bg-gradient-to-b from-black/60 via-black/75 to-[#140b09]/95 backdrop-blur-[3px]">
            <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-8">
              <div className="animate-pop-in flex items-center gap-2 rounded-full border border-[#ffbe33]/40 bg-[#ffbe33]/10 px-4 py-1.5 text-xs font-black text-[#ffbe33]">
                <ChefHat className="h-4 w-4" />
                <span className="neon-flicker">فرن نابولي الليلي — مفتوح الآن</span>
              </div>

              <div className="animate-floaty"><PizzaLogo size={132} /></div>

              <div className="text-center">
                <h1 className="text-stroke text-5xl font-black leading-tight text-[#fff7e6] sm:text-6xl">
                  لعبة <span className="bg-gradient-to-l from-[#ffbe33] via-[#ff8a2b] to-[#e63b2e] bg-clip-text text-transparent">بيدزه</span>
                </h1>
                <p className="mt-2 text-sm font-bold text-[#c9b8a8]">
                  امسك المكونات الطازجة 🍅🧀 — ابنِ البيتزا — اهرب من الفحم والقنابل!
                </p>
              </div>

              {best > 0 && (
                <div className="animate-pop-in flex items-center gap-2 rounded-2xl border border-[#ffbe33]/40 bg-gradient-to-l from-[#ffbe33]/20 to-transparent px-4 py-2 text-sm font-black text-[#ffbe33]">
                  <Trophy className="h-4 w-4" /> أفضل نتيجة: {best.toLocaleString("ar-EG")}
                </div>
              )}

              {/* difficulty */}
              <div className="w-full">
                <div className="mb-2 text-center text-xs font-black text-[#c9b8a8]">اختر مستوى الفرن</div>
                <div className="grid grid-cols-3 gap-2">
                  {DIFFS.map((d) => (
                    <button key={d.key} onClick={() => { sound.unlock(); sound.click(); setDifficulty(d.key); }}
                      className={`rounded-2xl border-2 px-2 py-2.5 text-center transition active:scale-95 ${difficulty === d.key ? "border-[#ffbe33] bg-[#ffbe33]/15 shadow-[0_0_20px_rgba(255,190,51,0.3)]" : "border-white/10 bg-white/[0.05]"}`}>
                      <div className={`text-base font-black ${difficulty === d.key ? "text-[#ffbe33]" : "text-white"}`}>{d.label}</div>
                      <div className="text-[10px] font-bold text-[#c9b8a8]">{d.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => startGame()}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#e63b2e] to-[#ff8a2b] px-6 py-4 text-xl font-black text-white shadow-[0_12px_36px_-8px_rgba(230,59,46,0.7)] transition hover:brightness-110 active:scale-[0.97]">
                <Play className="h-6 w-6 fill-current transition group-hover:scale-125" />
                ابدأ اللعب
                <kbd className="rounded-lg bg-black/30 px-2 py-0.5 text-[11px] font-bold">مسافة</kbd>
              </button>

              {/* how to play */}
              <div className="grid w-full grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5">
                  <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-xl bg-[#2fbf71]/15 text-[#2fbf71]"><PizzaIcon className="h-4 w-4" /></div>
                  <div className="text-[11px] font-black text-white">اجمع الطازج</div>
                  <div className="text-[10px] text-[#c9b8a8]">+ نقاط وكومبو</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5">
                  <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-xl bg-[#e63b2e]/15 text-[#ff6b5d]"><Bomb className="h-4 w-4" /></div>
                  <div className="text-[11px] font-black text-white">تجنب الخطر</div>
                  <div className="text-[10px] text-[#c9b8a8]">فحم وقنابل −❤</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5">
                  <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-xl bg-[#ffbe33]/15 text-[#ffbe33]"><Star className="h-4 w-4" /></div>
                  <div className="text-[11px] font-black text-white">النجمة الذهبية</div>
                  <div className="text-[10px] text-[#c9b8a8]">مغناطيس وتباطؤ</div>
                </div>
              </div>

              <div className="w-full">
                <div className="mb-2 flex items-center gap-2 text-xs font-black text-[#c9b8a8]">
                  <Medal className="h-4 w-4 text-[#ffbe33]" /> لوحة الشرف
                </div>
                <HighTable scores={scores} />
              </div>

              <div className="flex items-center gap-3 text-[11px] font-bold text-white/40">
                <span>⌨️ الأسهم / A D للحركة</span>
                <span>·</span>
                <span>👆 السحب على الجوال</span>
                <span>·</span>
                <button onClick={toggleMute} className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-white/60">
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />} {muted ? "كتم" : "صوت"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PAUSE ── */}
        {screen === "paused" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
            <div className="animate-pop-in w-full max-w-xs rounded-3xl border border-white/10 bg-[#221310] p-6 text-center shadow-2xl">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ffbe33]/15 text-[#ffbe33]">
                <Pause className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-black text-[#fff7e6]">استراحة شيف ☕</h2>
              <p className="mt-1 text-sm font-bold text-[#c9b8a8]">الفرن ينتظرك… النقاط: <span className="text-[#ffbe33]">{hud.score.toLocaleString("ar-EG")}</span></p>
              <div className="mt-5 space-y-2">
                <button onClick={resumeGame} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#2fbf71] to-[#25a55e] px-4 py-3 font-black text-white transition active:scale-[0.97]">
                  <Play className="h-5 w-5 fill-current" /> استئناف
                </button>
                <button onClick={() => startGame()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 font-black text-white transition active:scale-[0.97]">
                  <RotateCcw className="h-4 w-4" /> إعادة سريعة
                </button>
                <div className="flex gap-2">
                  <button onClick={quitToMenu} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 transition active:scale-[0.97]">
                    <Home className="h-4 w-4" /> القائمة
                  </button>
                  <button onClick={toggleMute} className="flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-white/80 transition active:scale-95">
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── GAME OVER ── */}
        {screen === "gameover" && result && (
          <div className="absolute inset-0 z-30 overflow-y-auto bg-gradient-to-b from-[#2b0d0d]/85 via-black/80 to-[#140b09]/95 backdrop-blur-[3px]">
            <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-3.5 px-5 py-8">
              <div className="animate-wiggle text-6xl">🔥</div>
              <h2 className="animate-pop-in text-4xl font-black text-[#fff7e6]">احترقت البيتزا!</h2>
              {newBest && (
                <div className="animate-pop-in flex items-center gap-2 rounded-full border border-[#ffbe33]/60 bg-[#ffbe33]/15 px-4 py-1.5 text-sm font-black text-[#ffbe33] shadow-[0_0_24px_rgba(255,190,51,0.4)]">
                  <Crown className="h-4 w-4" /> رقم قياسي جديد! 🎉
                </div>
              )}
              <div className="animate-pop-in rounded-3xl border border-[#ffbe33]/30 bg-black/60 px-8 py-4 text-center shadow-xl">
                <div className="text-xs font-black text-[#c9b8a8]">النتيجة النهائية</div>
                <div className="text-5xl font-black text-[#ffbe33] tabular-nums">{result.score.toLocaleString("ar-EG")}</div>
              </div>

              <div className="grid w-full grid-cols-4 gap-2 text-center">
                {[
                  { icon: <Zap className="h-4 w-4" />, v: result.maxCombo, l: "أعلى كومبو" },
                  { icon: <PizzaIcon className="h-4 w-4" />, v: result.pizzas, l: "بيتزا" },
                  { icon: <Flame className="h-4 w-4" />, v: result.level, l: "الفرن" },
                  { icon: <Timer className="h-4 w-4" />, v: `${Math.floor(result.timeSurvived)}ث`, l: "الصمود" },
                ].map((s, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.05] px-1 py-2.5">
                    <div className="mx-auto mb-0.5 flex w-fit items-center gap-1 text-[#ffbe33]">{s.icon}<span className="text-base font-black text-white">{s.v}</span></div>
                    <div className="text-[10px] font-bold text-[#c9b8a8]">{s.l}</div>
                  </div>
                ))}
              </div>

              {canSave ? (
                <div className="animate-slide-up w-full rounded-2xl border border-[#ffbe33]/30 bg-[#ffbe33]/[0.07] p-3">
                  <div className="mb-2 text-xs font-black text-[#ffbe33]">🏆 دخلت لوحة الشرف! سجّل اسمك:</div>
                  <div className="flex gap-2">
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18} placeholder="اسم الشيف…"
                      className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/50 px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/30 focus:border-[#ffbe33] focus:outline-none" />
                    <button onClick={handleSave} className="shrink-0 rounded-xl bg-[#ffbe33] px-4 py-2.5 text-sm font-black text-[#3a2000] transition active:scale-95">
                      حفظ
                    </button>
                  </div>
                </div>
              ) : saved ? (
                <div className="flex items-center gap-1.5 rounded-full bg-[#2fbf71]/15 px-4 py-1.5 text-xs font-black text-[#2fbf71]">
                  <Trophy className="h-3.5 w-3.5" /> تم الحفظ في لوحة الشرف!
                </div>
              ) : null}

              <div className="flex w-full gap-2">
                <button onClick={() => startGame()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#e63b2e] to-[#ff8a2b] px-4 py-3.5 text-lg font-black text-white shadow-[0_12px_30px_-8px_rgba(230,59,46,0.7)] transition hover:brightness-110 active:scale-[0.97]">
                  <RotateCcw className="h-5 w-5" /> العب مجددًا
                  <kbd className="rounded-lg bg-black/30 px-1.5 py-0.5 text-[10px]">R</kbd>
                </button>
                <button onClick={quitToMenu} className="flex items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-white/5 px-4 py-3.5 font-black text-white/85 transition active:scale-[0.97]">
                  <Home className="h-5 w-5" />
                </button>
              </div>

              <div className="w-full">
                <HighTable scores={scores} compact />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* bottom safe bar */}
      <div className="pointer-events-none z-10 hidden justify-center pb-2 sm:flex">
        <div className="text-[11px] font-bold text-white/30">
          {screen === "playing" ? "الأسهم / A D للحركة · مسافة للداش · P للإيقاف" : "صُنعت بحب في فرن نابولي 🍕"}
        </div>
      </div>
    </div>
  );
}
