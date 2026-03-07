import { createSignal, onMount, onCleanup, createMemo } from "solid-js";
import type { AllocationDetail } from "~/lib/api-client";

const COLORS: [number, number, number][] = [
  [212, 168, 83], [255, 59, 63], [52, 211, 153], [167, 139, 250],
  [236, 72, 153], [6, 182, 212], [245, 158, 11], [132, 204, 22],
];
const SKIN = "#f4c9a0";
const HAIR_COLORS = ["#3a2a1a", "#c4943a", "#b84233", "#5a3a2a", "#8a6a3a", "#2a1a0a"];
const CURRENCY = "AVAX";

interface DisplayEntry {
  label: string; shares_bps: number; isCreator: boolean;
  receivesPrimary: boolean; color: [number, number, number]; hairColor: string;
}
interface Particle {
  x: number; y: number; tx: number; ty: number;
  progress: number; speed: number; color: [number, number, number];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

// ─── Sound FX ───
class SoundFX {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private musicPlaying = false;
  private getCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }
  play(type: "pop" | "coin" | "whoosh" | "success" | "tick" | "sign") {
    try {
      const c = this.getCtx(), now = c.currentTime;
      const g = c.createGain(); g.connect(c.destination);
      if (type === "pop") {
        const o = c.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(600, now); o.frequency.exponentialRampToValueAtTime(200, now + 0.15);
        g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        o.connect(g); o.start(now); o.stop(now + 0.2);
      } else if (type === "coin") {
        const o = c.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(1200, now); o.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        g.gain.setValueAtTime(0.07, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        o.connect(g); o.start(now); o.stop(now + 0.15);
        const o2 = c.createOscillator(), g2 = c.createGain(); g2.connect(c.destination);
        o2.type = "sine"; o2.frequency.setValueAtTime(1600, now + 0.05);
        o2.frequency.exponentialRampToValueAtTime(1000, now + 0.2);
        g2.gain.setValueAtTime(0.05, now + 0.05); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        o2.connect(g2); o2.start(now + 0.05); o2.stop(now + 0.25);
      } else if (type === "whoosh") {
        const buf = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
        const n = c.createBufferSource(); n.buffer = buf;
        const f = c.createBiquadFilter(); f.type = "bandpass";
        f.frequency.setValueAtTime(2000, now); f.frequency.exponentialRampToValueAtTime(200, now + 0.3);
        f.Q.value = 2; g.gain.setValueAtTime(0.06, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        n.connect(f); f.connect(g); n.start(now); n.stop(now + 0.3);
      } else if (type === "success") {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const o = c.createOscillator(), gg = c.createGain(); gg.connect(c.destination);
          o.type = "sine"; o.frequency.value = freq;
          gg.gain.setValueAtTime(0.06, now + i * 0.1);
          gg.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
          o.connect(gg); o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.25);
        });
      } else if (type === "tick") {
        const o = c.createOscillator(); o.type = "square"; o.frequency.value = 800;
        g.gain.setValueAtTime(0.02, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        o.connect(g); o.start(now); o.stop(now + 0.04);
      } else if (type === "sign") {
        // Pen scratch sound: short noise bursts
        for (let i = 0; i < 3; i++) {
          const buf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * 0.3;
          const n = c.createBufferSource(); n.buffer = buf;
          const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3000; f.Q.value = 3;
          const sg = c.createGain(); sg.connect(c.destination);
          sg.gain.setValueAtTime(0.04, now + i * 0.12);
          sg.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.08);
          n.connect(f); f.connect(sg); n.start(now + i * 0.12); n.stop(now + i * 0.12 + 0.08);
        }
        // Confirmation ding after scratch
        const o = c.createOscillator(); o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.06, now + 0.4); g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        o.connect(g); o.start(now + 0.4); o.stop(now + 0.7);
      }
    } catch { /* */ }
  }
  startMusic() {
    if (this.musicPlaying) return;
    try {
      const c = this.getCtx();
      this.musicPlaying = true;
      this.musicGain = c.createGain();
      this.musicGain.gain.value = 0.035;
      this.musicGain.connect(c.destination);
      const padFreqs = [130.81, 164.81, 196, 246.94];
      for (const freq of padFreqs) {
        const o = c.createOscillator();
        o.type = "sine"; o.frequency.value = freq;
        const g = c.createGain(); g.gain.value = 0.4;
        o.connect(g); g.connect(this.musicGain!);
        o.start();
      }
      const melody = [
        523.25, 0, 659.25, 0, 783.99, 659.25, 523.25, 0,
        493.88, 0, 587.33, 0, 783.99, 0, 659.25, 0,
      ];
      const noteLen = 0.4;
      const loopLen = melody.length * noteLen;
      const playMelodyLoop = () => {
        if (!this.musicPlaying || !this.musicGain) return;
        const now = c.currentTime;
        melody.forEach((freq, i) => {
          if (freq === 0) return;
          const o = c.createOscillator();
          o.type = "triangle"; o.frequency.value = freq;
          const g = c.createGain();
          const start = now + i * noteLen;
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.3, start + 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, start + noteLen * 0.9);
          o.connect(g); g.connect(this.musicGain!);
          o.start(start); o.stop(start + noteLen);
        });
        setTimeout(() => playMelodyLoop(), loopLen * 1000);
      };
      playMelodyLoop();
    } catch { /* */ }
  }
  stopMusic() {
    this.musicPlaying = false;
    if (this.musicGain) {
      try {
        this.musicGain.gain.linearRampToValueAtTime(0, this.getCtx().currentTime + 0.3);
      } catch { /* */ }
      this.musicGain = null;
    }
    // Close and reset AudioContext to fully stop all sounds
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* */ }
      this.ctx = null;
    }
  }
}

export default function SimulationCartoon(props: {
  allocations: AllocationDetail[];
  creatorSharesBps: number;
  royalty_bps: number;
  creatorName?: string;
  salePrice?: number;
  creatorRole?: string;
}) {
  const [sceneIndex, setSceneIndex] = createSignal(0);
  const savedMusicOff = typeof localStorage !== "undefined" && localStorage.getItem("sim-music-off") === "1";
  const [musicOn, setMusicOn] = createSignal(false);
  const [musicMuted, setMusicMuted] = createSignal(savedMusicOff);
  const sfx = new SoundFX();

  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animFrameId: number | undefined;
  let W = 900, H = 520, dpr = 1;
  let sceneStartTime = 0;
  let particles: Particle[] = [];
  let soundsPlayed = new Set<string>();

  // Background images
  const bgImages: Record<string, HTMLImageElement | null> = { workshop: null, gallery: null, homes: null };
  const bgLoaded: Record<string, boolean> = { workshop: false, gallery: false, homes: false };
  function loadBgImage(key: string, src: string) {
    const img = new Image();
    img.onload = () => { bgImages[key] = img; bgLoaded[key] = true; };
    img.src = src;
  }
  loadBgImage("workshop", "/bg-workshop.png");
  loadBgImage("gallery", "/bg-gallery.png");
  loadBgImage("homes", "/bg-homes.png");

  // Character sprite images
  const charImages: Record<string, HTMLImageElement | null> = { creator: null, collab: null, buyer: null };
  const charLoaded: Record<string, boolean> = { creator: false, collab: false, buyer: false };
  function loadCharImage(key: string, src: string) {
    const img = new Image();
    img.onload = () => { charImages[key] = img; charLoaded[key] = true; };
    img.src = src;
  }
  loadCharImage("creator", "/char-creator.png");
  loadCharImage("collab", "/char-collab.png");
  loadCharImage("collab_gallery", "/char-collab-gallery.png");
  loadCharImage("buyer", "/char-buyer.png");
  loadCharImage("contract", "/contract.png");

  const price = () => props.salePrice || 1;

  const isSolo = createMemo(() => props.allocations.length === 0);

  const creatorSprite = createMemo(() =>
    props.creatorRole === "producer" || props.creatorRole === "gallery" ? "collab_gallery" : "creator"
  );

  const entries = createMemo((): DisplayEntry[] => {
    const r: DisplayEntry[] = [{
      label: props.creatorName || "Creator",
      shares_bps: isSolo() ? 10000 : props.creatorSharesBps,
      isCreator: true, receivesPrimary: true,
      color: COLORS[0], hairColor: HAIR_COLORS[0],
    }];
    if (!isSolo()) {
      props.allocations.forEach((a, i) => r.push({
        label: a.label || a.role,
        shares_bps: a.total_bps,
        isCreator: false, receivesPrimary: a.receives_primary,
        color: COLORS[(i + 1) % COLORS.length],
        hairColor: HAIR_COLORS[(i + 1) % HAIR_COLORS.length],
      }));
    }
    return r;
  });

  const primaryAmounts = createMemo(() => {
    const e = entries(), p = price();
    const pBps = e.filter(x => !x.isCreator && x.receivesPrimary).reduce((s, x) => s + x.shares_bps, 0);
    return e.map(x => x.isCreator ? ((10000 - pBps) / 10000) * p : x.receivesPrimary ? (x.shares_bps / 10000) * p : 0);
  });

  const resaleAmounts = createMemo(() => {
    const e = entries(), pool = (props.royalty_bps / 10000) * price();
    return e.map(x => (x.shares_bps / 10000) * pool);
  });

  function playOnce(key: string, sound: "pop" | "coin" | "whoosh" | "success" | "tick") {
    if (!soundsPlayed.has(key)) { soundsPlayed.add(key); sfx.play(sound); }
  }

  // ─── Drawing helpers ───

  function drawChar(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    col: [number, number, number], _hair: string, label: string,
    s: number, bob: number,
    _emotion: "neutral" | "happy" | "surprised" | "money" = "neutral",
    hand: "none" | "wave" | "hold_nft" | "hold_coin" = "none",
    overrides?: { sprite?: string; flip?: boolean },
  ) {
    // Pick the right sprite based on role
    const isBuyer = label === "Buyer";
    const entryMatch = entries().find(e => e.label === label);
    const isCreator = entryMatch ? entryMatch.isCreator : false;
    const spriteKey = overrides?.sprite || (isBuyer ? "buyer" : isCreator ? "creator" : "collab");
    const img = charImages[spriteKey];
    const loaded = charLoaded[spriteKey];

    // Flip: creator by default, or override
    const flipX = overrides?.flip !== undefined ? overrides.flip : spriteKey === "creator";

    const charH = 520 * s;  // x4 size
    const rgb = `${col[0]},${col[1]},${col[2]}`;

    // Sway animation: gentle rotation pivot at feet
    const swayAngle = Math.sin(bob) * 0.03;

    if (loaded && img) {
      const aspect = img.width / img.height;
      const charW = charH * aspect;
      const footY = y + charH / 2;

      ctx.save();
      ctx.translate(x, footY);
      ctx.rotate(swayAngle);
      if (flipX) ctx.scale(-1, 1);
      ctx.drawImage(img, -charW / 2, -charH, charW, charH);
      ctx.restore();
    } else {
      // Minimal fallback
      const pw = 30 * s, ph = 70 * s;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath(); ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, 8 * s); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - ph / 2 - 12 * s, 14 * s, 0, Math.PI * 2);
      ctx.fillStyle = SKIN; ctx.fill();
    }

    // Draw held items on top of the sprite
    if (hand === "hold_nft") {
      ctx.save(); ctx.translate(x, y); drawNft(ctx, 0, -charH * 0.35, 18 * s); ctx.restore();
    }
    if (hand === "hold_coin") {
      ctx.save(); ctx.translate(x, y); drawCoinItem(ctx, 0, -charH * 0.15, 10 * s); ctx.restore();
    }

    // Label below character
    ctx.fillStyle = `rgb(${rgb})`; ctx.font = `bold ${11 * s}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x, y + charH / 2 + 18 * s);
  }

  function drawNft(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number) {
    ctx.save(); ctx.translate(x, y - sz);
    ctx.fillStyle = "#d4a853"; ctx.fillRect(-sz / 2 - 3, -sz / 2 - 3, sz + 6, sz + 6);
    const g = ctx.createLinearGradient(-sz / 2, -sz / 2, sz / 2, sz / 2);
    g.addColorStop(0, "#2a1a4a"); g.addColorStop(0.5, "#4a2a6a"); g.addColorStop(1, "#1a2a3a");
    ctx.fillStyle = g; ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
    ctx.fillStyle = "#d4a853"; ctx.font = `${sz * 0.5}px serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("★", 0, 0);
    ctx.restore();
  }

  function drawCoinItem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.shadowColor = "rgba(212,168,83,0.5)"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y - r * 2, r, 0, Math.PI * 2);
    ctx.fillStyle = "#d4a853"; ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "#08080c"; ctx.font = `bold ${r * 0.8}px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("A", x, y - r * 2);
    ctx.restore();
  }

  function drawBubble(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    text: string, maxW: number, progress: number,
    opts: { tail?: boolean; tailX?: number } = {},
  ) {
    if (progress <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 4);

    ctx.font = "13px sans-serif";
    const words = text.split(" ");
    const lines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width > maxW - 28) { if (cur) lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);

    const lh = 19;
    const bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 32);
    const bh = lines.length * lh + 18;

    let bx = x - bw / 2, by = y - bh;
    if (bx < 8) bx = 8;
    if (bx + bw > W - 8) bx = W - 8 - bw;
    if (by < 8) by = 8;
    const cx = bx + bw / 2;

    ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 12);
    ctx.fillStyle = "rgba(245,240,235,0.97)"; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(212,168,83,0.3)"; ctx.lineWidth = 1; ctx.stroke();

    if (opts.tail !== false) {
      const tx = opts.tailX != null ? Math.max(bx + 12, Math.min(bx + bw - 12, opts.tailX)) : cx;
      ctx.beginPath();
      ctx.moveTo(tx - 6, by + bh); ctx.lineTo(tx, by + bh + 10); ctx.lineTo(tx + 6, by + bh);
      ctx.fillStyle = "rgba(245,240,235,0.97)"; ctx.fill();
    }

    ctx.fillStyle = "#1a1a2a"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    const visibleChars = Math.floor(text.length * Math.min(1, progress * 1.3));
    let cc = 0;
    for (let i = 0; i < lines.length; i++) {
      const end = Math.min(lines[i].length, visibleChars - cc);
      if (end > 0) ctx.fillText(lines[i].substring(0, end), cx, by + 16 + i * lh + lh / 2);
      cc += lines[i].length;
    }
    ctx.restore();
  }

  // ─── Background: Atelier / Workshop (scenes 0-1) ───
  function drawBgWorkshop(ctx: CanvasRenderingContext2D, t: number) {
    if (bgLoaded.workshop && bgImages.workshop) {
      ctx.drawImage(bgImages.workshop, 0, 0, W, H);
    } else {
      // Fallback gradient while image loads
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#f5e8d4"); g.addColorStop(1, "#a0845a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // Floating dust particles overlay
    ctx.save();
    for (let i = 0; i < 12; i++) {
      const dx = W * 0.15 + ((i * 47 + t * 0.008) % (W * 0.3));
      const dy = H * 0.1 + ((i * 31 + t * 0.012) % (H * 0.5));
      const a = 0.2 + 0.15 * Math.sin(t * 0.002 + i * 1.5);
      ctx.globalAlpha = a; ctx.fillStyle = "#ffd";
      ctx.beginPath(); ctx.arc(dx, dy, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ─── Background: Gallery (scenes 2-3) ───
  function drawBgGallery(ctx: CanvasRenderingContext2D, _t: number) {
    if (bgLoaded.gallery && bgImages.gallery) {
      ctx.drawImage(bgImages.gallery, 0, 0, W, H);
    } else {
      // Fallback gradient while image loads
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#f0ede8"); g.addColorStop(1, "#d5cfc5");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  // ─── Background: Homes / Remote (scenes 4-6) ───
  function drawBgHomes(ctx: CanvasRenderingContext2D, t: number) {
    if (bgLoaded.homes && bgImages.homes) {
      ctx.drawImage(bgImages.homes, 0, 0, W, H);
    } else {
      // Fallback gradient while image loads
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#4a9de5"); g.addColorStop(0.6, "#87CEEB"); g.addColorStop(1, "#4caf50");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // Animated clouds overlay
    const drawCloud = (baseX: number, cy: number, sc: number, speed: number) => {
      const cx = ((baseX + t * speed) % (W + 200)) - 100;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.arc(cx, cy, 18 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 16 * sc, cy - 3 * sc, 14 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 14 * sc, cy + 2 * sc, 12 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 6 * sc, cy + 5 * sc, 10 * sc, 0, Math.PI * 2); ctx.fill();
    };
    drawCloud(100, 48, 1.0, 0.006);
    drawCloud(450, 32, 0.8, 0.004);
    drawCloud(750, 60, 0.7, 0.008);
  }

  function drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of particles) {
      if (p.progress >= 1) continue;
      p.progress += p.speed;
      if (p.progress < 0) continue;
      const t = easeOut(Math.min(1, p.progress));
      const px = p.x + (p.tx - p.x) * t;
      const py = p.y + (p.ty - p.y) * t - Math.sin(t * Math.PI) * 50;
      const alpha = p.progress < 0.7 ? 1 : (1 - p.progress) * 3.3;
      ctx.save();
      ctx.shadowColor = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha * 0.5})`;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha})`;
      ctx.fill(); ctx.restore();
    }
  }

  function drawAmount(ctx: CanvasRenderingContext2D, x: number, y: number, amount: number, col: [number, number, number], p: number) {
    if (p <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, p * 2);
    const rgb = `${col[0]},${col[1]},${col[2]}`;
    const sc = easeOut(Math.min(1, p * 2));
    ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y);
    ctx.fillStyle = `rgba(${rgb},0.2)`;
    ctx.beginPath(); ctx.roundRect(x - 55, y - 12, 110, 24, 8); ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},0.3)`; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${fmt(amount)} ${CURRENCY}`, x, y);
    ctx.restore();
  }

  function spawnCoins(fx: number, fy: number, tx: number, ty: number, col: [number, number, number], n: number) {
    for (let i = 0; i < n; i++) particles.push({
      x: fx + (Math.random() - 0.5) * 30, y: fy,
      tx: tx + (Math.random() - 0.5) * 20, ty,
      progress: -i * 0.05 - Math.random() * 0.03,
      speed: 0.012 + Math.random() * 0.008, color: col,
    });
  }

  const charY = () => H - 90 - 18;
  const charPos = () => {
    const e = entries(), n = e.length;
    const m = W * 0.25, u = W - 2 * m, step = n > 1 ? u / (n - 1) : 0;
    return e.map((_, i) => ({ x: n > 1 ? m + i * step : W / 2, y: charY() }));
  };
  const collX = () => W - 80;

  // ─── Scenes ───
  function buildScenes() {
    const e = entries();
    const solo = isSolo();
    const sprite = creatorSprite();
    const scenes: { draw: (ctx: CanvasRenderingContext2D, t: number, p: number) => void; text: string }[] = [];

    if (solo) {
      // ─── Solo scenes (creator + buyer only) ───

      // 0: Intro — Creator alone
      scenes.push({
        text: "",
        draw: (ctx, t, p) => {
          drawBgWorkshop(ctx, t);
          const cx = W / 2, cy = charY();
          const ep = Math.min(1, Math.max(0, p * 3.5));
          const sy = cy + 80 * (1 - easeOut(ep));
          ctx.save(); ctx.globalAlpha = Math.min(1, ep * 2);
          drawChar(ctx, cx, sy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, "happy", "wave", { sprite });
          ctx.restore();
          playOnce("intro", "pop");
          drawBubble(ctx, cx, cy - 200, "Hello! I manage this project from start to finish.", W * 0.4, p, { tail: true, tailX: cx });
        },
      });

      // 1: Contract — Creator alone + contract appears
      scenes.push({
        text: "",
        draw: (ctx, t, p) => {
          drawBgWorkshop(ctx, t);
          const cx = W / 2, cy = charY();
          drawChar(ctx, cx, cy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, "happy", "none", { sprite });
          drawBubble(ctx, cx, cy - 200, "I create a smart contract for my project.", W * 0.4, p, { tail: true, tailX: cx });
          if (p > 0.55) {
            playOnce("contract_sign", "sign");
            const cp = easeOut(Math.min(1, (p - 0.55) * 4));
            const contractImg = charImages.contract;
            const ccx = W / 2, ccy = H * 0.32;
            ctx.save(); ctx.globalAlpha = cp;
            ctx.translate(ccx, ccy); ctx.scale(cp, cp); ctx.translate(-ccx, -ccy);
            if (contractImg && charLoaded.contract) {
              const ch = 120, cw = ch * (contractImg.width / contractImg.height);
              ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 16;
              ctx.drawImage(contractImg, ccx - cw / 2, ccy - ch / 2, cw, ch);
            } else {
              ctx.fillStyle = "white"; ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 16;
              ctx.beginPath(); ctx.roundRect(ccx - 45, ccy - 55, 90, 110, 6); ctx.fill();
              ctx.fillStyle = "#333"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
              ctx.fillText("CONTRACT", ccx, ccy - 30);
            }
            ctx.restore();
          }
        },
      });

      // 2: Primary sale — Creator + Buyer
      scenes.push({
        text: "Primary sale! All proceeds go to the creator.",
        draw: (ctx, t, p) => {
          drawBgGallery(ctx, t);
          const amounts = primaryAmounts();
          const creatorX = W * 0.25, buyerX = W * 0.75;
          const cy = charY();

          if (p > 0.15 && p < 0.22) {
            playOnce("primary_coins", "coin");
            spawnCoins(buyerX, cy - 30, creatorX, cy - 20, e[0].color, Math.max(6, Math.round(amounts[0] / price() * 20)));
          }
          drawChar(ctx, creatorX, cy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, p > 0.4 && amounts[0] > 0 ? "money" : "neutral", "none", { sprite });
          if (p > 0.45 && amounts[0] > 0) {
            playOnce("amt_pop", "pop");
            drawAmount(ctx, creatorX, cy + 100, amounts[0], e[0].color, (p - 0.45) * 4);
          }
          drawChar(ctx, buyerX, cy, [100, 140, 200], "#b84233", "Buyer", 0.9,
            t * 0.002 + 5, p > 0.2 ? "happy" : "neutral", "hold_nft",
            { flip: true });
          drawParticles(ctx);
          drawBubble(ctx, W / 2, 55, scenes[2].text, W * 0.5, p, { tail: false });
        },
      });

      // 3: Time passes — Clock (identical)
      scenes.push({
        text: "Time passes... The artwork gains value.",
        draw: (ctx, t, p) => {
          ctx.save(); ctx.filter = "blur(6px)"; drawBgWorkshop(ctx, t); ctx.restore();
          ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.fillRect(0, 0, W, H);
          const cx = W / 2, cy = H / 2 - 30, cr = 44;
          ctx.save();
          ctx.shadowColor = "rgba(212,168,83,0.4)"; ctx.shadowBlur = 25;
          const ap = easeOut(Math.min(1, p * 3));
          ctx.translate(cx, cy); ctx.scale(ap, ap); ctx.translate(-cx, -cy);
          ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
          ctx.strokeStyle = "rgba(212,168,83,0.6)"; ctx.lineWidth = 2.5; ctx.stroke();
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const inner = i % 3 === 0 ? cr - 12 : cr - 8;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * (cr - 5), cy + Math.sin(a) * (cr - 5));
            ctx.strokeStyle = i % 3 === 0 ? "#d4a853" : "rgba(212,168,83,0.3)";
            ctx.lineWidth = i % 3 === 0 ? 2 : 1; ctx.stroke();
          }
          if (p > 0.1) playOnce("t1", "tick"); if (p > 0.3) playOnce("t2", "tick");
          if (p > 0.5) playOnce("t3", "tick"); if (p > 0.7) playOnce("t4", "tick");
          const a1 = (p * Math.PI * 8) - Math.PI / 2, a2 = (p * Math.PI * 0.6) - Math.PI / 2;
          ctx.strokeStyle = "#d4a853"; ctx.lineWidth = 2; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a1) * cr * 0.55, cy + Math.sin(a1) * cr * 0.55); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a2) * cr * 0.35, cy + Math.sin(a2) * cr * 0.35); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = "#d4a853"; ctx.fill();
          ctx.restore();
          drawBubble(ctx, W / 2, cy + cr + 50, scenes[3].text, W * 0.5, p, { tail: false });
        },
      });

      // 4: Resale — Creator receives all royalties
      scenes.push({
        text: "Resale detected! All royalties go to the creator.",
        draw: (ctx, t, p) => {
          drawBgHomes(ctx, t);
          const cx = W / 2, cy = charY();
          const amounts = resaleAmounts();
          if (p > 0.15 && p < 0.22) {
            playOnce("resale_coins", "coin");
            spawnCoins(W / 2, 100, cx, cy - 20, e[0].color, Math.max(6, 14));
          }
          drawChar(ctx, cx, cy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, p > 0.4 && amounts[0] > 0 ? "money" : "happy", "none", { sprite });
          if (p > 0.45 && amounts[0] > 0) drawAmount(ctx, cx, cy + 100, amounts[0], e[0].color, (p - 0.45) * 4);
          if (p > 0.08) {
            const rp = easeOut(Math.min(1, (p - 0.08) * 4));
            ctx.save(); ctx.globalAlpha = rp;
            const pool = (props.royalty_bps / 10000) * price();
            ctx.translate(W / 2, 90); ctx.scale(rp, rp); ctx.translate(-W / 2, -90);
            ctx.fillStyle = "rgba(167,139,250,0.18)";
            ctx.beginPath(); ctx.roundRect(W / 2 - 90, 78, 180, 28, 8); ctx.fill();
            ctx.strokeStyle = "rgba(167,139,250,0.3)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = "#a78bfa"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
            ctx.fillText(`Royalties: ${fmt(pool)} ${CURRENCY}`, W / 2, 96);
            ctx.restore();
          }
          drawParticles(ctx);
          drawBubble(ctx, W / 2, 40, scenes[4].text, W * 0.55, Math.min(p * 1.8, 1), { tail: false });
        },
      });

      // 5: Summary — Creator alone
      scenes.push({
        text: "Every sale goes entirely to you. Simple and transparent.",
        draw: (ctx, t, p) => {
          drawBgHomes(ctx, t);
          const cx = W / 2, cy = charY();
          drawChar(ctx, cx, cy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, "happy", "wave", { sprite });
          if (p > 0.15) {
            playOnce("summary_success", "success");
            const pa = primaryAmounts(), ra = resaleAmounts();
            const cardW = Math.min(W * 0.65, 380), cardH = 66;
            const cardCx = W / 2, cardCy = 40;
            const cp = easeOut(Math.min(1, (p - 0.15) * 3.5));
            ctx.save(); ctx.globalAlpha = cp;
            ctx.translate(cardCx, cardCy + cardH / 2); ctx.scale(cp, cp); ctx.translate(-cardCx, -(cardCy + cardH / 2));
            ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 16;
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            ctx.beginPath(); ctx.roundRect(cardCx - cardW / 2, cardCy, cardW, cardH, 14); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(212,168,83,0.3)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = "#d4a853"; ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center"; ctx.fillText("TOTAL EARNINGS (2 SALES)", cardCx, cardCy + 22);
            const y = cardCy + 42;
            const rgb = `${e[0].color[0]},${e[0].color[1]},${e[0].color[2]}`;
            ctx.fillStyle = `rgb(${rgb})`;
            ctx.beginPath(); ctx.arc(cardCx - cardW / 2 + 20, y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = "left"; ctx.font = "13px sans-serif"; ctx.fillStyle = "#333";
            ctx.fillText(e[0].label, cardCx - cardW / 2 + 32, y + 4);
            ctx.textAlign = "right"; ctx.font = "bold 13px monospace"; ctx.fillStyle = `rgb(${rgb})`;
            ctx.fillText(`${fmt(pa[0] + ra[0])} ${CURRENCY}`, cardCx + cardW / 2 - 16, y + 4);
            ctx.restore();
          }
          drawBubble(ctx, W / 2, H - 140, scenes[5].text, W * 0.55, p, { tail: false });
        },
      });

    } else {
      // ─── Collab scenes (original multi-participant) ───

      // 0: Intro — Workshop (greetings)
      scenes.push({
        text: "",
        draw: (ctx, t, p) => {
          drawBgWorkshop(ctx, t);
          const pos = charPos();
          e.forEach((en, i) => {
            const ep = Math.min(1, Math.max(0, (p * 3.5 - i * 0.3)));
            const sy = pos[i].y + 80 * (1 - easeOut(ep));
            ctx.save(); ctx.globalAlpha = Math.min(1, ep * 2);
            drawChar(ctx, pos[i].x, sy, en.color, en.hairColor, en.label, 0.9,
              t * 0.002 + i * 0.8, "happy", i === 0 ? "wave" : "none");
            ctx.restore();
          });
          playOnce("intro", "pop");
          if (pos.length > 0) {
            drawBubble(ctx, pos[0].x, pos[0].y - 200, "Hello, I'm an artist!", W * 0.3, p, { tail: true, tailX: pos[0].x });
          }
          if (pos.length > 1 && p > 0.35) {
            drawBubble(ctx, pos[1].x, pos[1].y - 200, "Nice to meet you, I'm a gallerist!", W * 0.3, (p - 0.35) * 2.5, { tail: true, tailX: pos[1].x });
          }
        },
      });

      // 1: Contract proposal — Workshop
      scenes.push({
        text: "",
        draw: (ctx, t, p) => {
          drawBgWorkshop(ctx, t);
          const pos = charPos();
          e.forEach((en, i) => drawChar(ctx, pos[i].x, pos[i].y, en.color, en.hairColor, en.label, 0.9,
            t * 0.002 + i * 0.8, "happy", "none"));
          if (pos.length > 0) {
            drawBubble(ctx, pos[0].x, pos[0].y - 200, "I have a new art project!", W * 0.35, p, { tail: true, tailX: pos[0].x });
          }
          if (pos.length > 1 && p > 0.3) {
            drawBubble(ctx, pos[1].x, pos[1].y - 200, "Oh really? Great, let me suggest we set up a contract!", W * 0.38, (p - 0.3) * 2.5, { tail: true, tailX: pos[1].x });
          }
          if (p > 0.65) {
            playOnce("contract_sign", "sign");
            const cp = easeOut(Math.min(1, (p - 0.65) * 4));
            const contractImg = charImages.contract;
            const cx = W / 2, cy = H * 0.42;
            ctx.save(); ctx.globalAlpha = cp;
            ctx.translate(cx, cy); ctx.scale(cp, cp); ctx.translate(-cx, -cy);
            if (contractImg && charLoaded.contract) {
              const ch = 130, cw = ch * (contractImg.width / contractImg.height);
              ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 16;
              ctx.drawImage(contractImg, cx - cw / 2, cy - ch / 2, cw, ch);
            } else {
              ctx.fillStyle = "white"; ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 16;
              ctx.beginPath(); ctx.roundRect(cx - 45, cy - 55, 90, 110, 6); ctx.fill();
              ctx.fillStyle = "#333"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
              ctx.fillText("CONTRACT", cx, cy - 30);
            }
            ctx.restore();
          }
        },
      });

      // 2: Primary sale — Gallery
      scenes.push({
        text: "Primary sale! Proceeds go to the producer.",
        draw: (ctx, t, p) => {
          drawBgGallery(ctx, t);
          const amounts = primaryAmounts();
          const artistX = W * 0.12, galeristeX = W * 0.38, buyerX = W * 0.75;
          const cy = charY();

          if (p > 0.15 && p < 0.22) {
            playOnce("primary_coins", "coin");
            e.forEach((en, i) => {
              if (amounts[i] > 0) spawnCoins(buyerX, cy - 30, galeristeX, cy - 20, en.color, Math.max(4, Math.round(amounts[i] / price() * 20)));
            });
          }
          drawChar(ctx, artistX, cy, e[0].color, e[0].hairColor, e[0].label, 0.9,
            t * 0.002, p > 0.4 && amounts[0] > 0 ? "money" : "neutral", "none");
          if (p > 0.45 && amounts[0] > 0) {
            playOnce("amt_pop", "pop");
            drawAmount(ctx, artistX, cy + 100, amounts[0], e[0].color, (p - 0.45) * 4);
          }
          if (e.length > 1) {
            drawChar(ctx, galeristeX, cy, e[1].color, e[1].hairColor, e[1].label, 0.9,
              t * 0.002 + 0.8, p > 0.4 && amounts[1] > 0 ? "money" : "neutral", "none",
              { sprite: "collab_gallery", flip: true });
            if (p > 0.45 && amounts[1] > 0) {
              drawAmount(ctx, galeristeX, cy + 100, amounts[1], e[1].color, (p - 0.45) * 4);
            }
          }
          drawChar(ctx, buyerX, cy, [100, 140, 200], "#b84233", "Buyer", 0.9,
            t * 0.002 + 5, p > 0.2 ? "happy" : "neutral", "hold_nft",
            { flip: true });
          drawParticles(ctx);
          drawBubble(ctx, W / 2, 55, scenes[2].text, W * 0.5, p, { tail: false });
        },
      });

      // 3: Time passes — Workshop blurred
      scenes.push({
        text: "Time passes... The artwork gains value.",
        draw: (ctx, t, p) => {
          ctx.save();
          ctx.filter = "blur(6px)";
          drawBgWorkshop(ctx, t);
          ctx.restore();
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(0, 0, W, H);
          const cx = W / 2, cy = H / 2 - 30, cr = 44;
          ctx.save();
          ctx.shadowColor = "rgba(212,168,83,0.4)"; ctx.shadowBlur = 25;
          const ap = easeOut(Math.min(1, p * 3));
          ctx.translate(cx, cy); ctx.scale(ap, ap); ctx.translate(-cx, -cy);
          ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
          ctx.strokeStyle = "rgba(212,168,83,0.6)"; ctx.lineWidth = 2.5; ctx.stroke();
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const inner = i % 3 === 0 ? cr - 12 : cr - 8;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * (cr - 5), cy + Math.sin(a) * (cr - 5));
            ctx.strokeStyle = i % 3 === 0 ? "#d4a853" : "rgba(212,168,83,0.3)";
            ctx.lineWidth = i % 3 === 0 ? 2 : 1; ctx.stroke();
          }
          if (p > 0.1) playOnce("t1", "tick"); if (p > 0.3) playOnce("t2", "tick");
          if (p > 0.5) playOnce("t3", "tick"); if (p > 0.7) playOnce("t4", "tick");
          const a1 = (p * Math.PI * 8) - Math.PI / 2, a2 = (p * Math.PI * 0.6) - Math.PI / 2;
          ctx.strokeStyle = "#d4a853"; ctx.lineWidth = 2; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a1) * cr * 0.55, cy + Math.sin(a1) * cr * 0.55); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a2) * cr * 0.35, cy + Math.sin(a2) * cr * 0.35); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = "#d4a853"; ctx.fill();
          ctx.restore();
          drawBubble(ctx, W / 2, cy + cr + 50, scenes[3].text, W * 0.5, p, { tail: false });
        },
      });

      // 4: Resale — Homes
      scenes.push({
        text: "Resale detected! Everyone receives their share.",
        draw: (ctx, t, p) => {
          drawBgHomes(ctx, t);
          const pos = charPos(), amounts = resaleAmounts();
          if (p > 0.15 && p < 0.22) {
            playOnce("resale_coins", "coin");
            const mx = Math.max(...amounts, 0.01);
            e.forEach((en, i) => { if (amounts[i] > 0) spawnCoins(W / 2, 100, pos[i].x, pos[i].y - 20, en.color, Math.max(4, Math.round((amounts[i] / mx) * 14))); });
          }
          e.forEach((en, i) => {
            drawChar(ctx, pos[i].x, pos[i].y, en.color, en.hairColor, en.label, 0.9,
              t * 0.002 + i * 0.8, p > 0.4 && amounts[i] > 0 ? "money" : "happy", "none");
            if (p > 0.45 && amounts[i] > 0) drawAmount(ctx, pos[i].x, pos[i].y + 100, amounts[i], en.color, (p - 0.45) * 4);
          });
          if (p > 0.08) {
            const rp = easeOut(Math.min(1, (p - 0.08) * 4));
            ctx.save(); ctx.globalAlpha = rp;
            const pool = (props.royalty_bps / 10000) * price();
            ctx.translate(W / 2, 90); ctx.scale(rp, rp); ctx.translate(-W / 2, -90);
            ctx.fillStyle = "rgba(167,139,250,0.18)";
            ctx.beginPath(); ctx.roundRect(W / 2 - 90, 78, 180, 28, 8); ctx.fill();
            ctx.strokeStyle = "rgba(167,139,250,0.3)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = "#a78bfa"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
            ctx.fillText(`Royalties: ${fmt(pool)} ${CURRENCY}`, W / 2, 96);
            ctx.restore();
          }
          drawParticles(ctx);
          drawBubble(ctx, W / 2, 40, scenes[4].text, W * 0.55, Math.min(p * 1.8, 1), { tail: false });
        },
      });

      // 5: Summary — Homes
      scenes.push({
        text: "Every sale distributes shares automatically. Transparent and fair.",
        draw: (ctx, t, p) => {
          drawBgHomes(ctx, t);
          const pos = charPos();
          e.forEach((en, i) => drawChar(ctx, pos[i].x, pos[i].y, en.color, en.hairColor, en.label, 0.9,
            t * 0.002 + i * 0.8, "happy", i === 0 ? "wave" : "none"));
          if (p > 0.15) {
            playOnce("summary_success", "success");
            const pa = primaryAmounts(), ra = resaleAmounts();
            const cardW = Math.min(W * 0.65, 380), cardH = e.length * 26 + 40;
            const cx = W / 2, cy = 40;
            const cp = easeOut(Math.min(1, (p - 0.15) * 3.5));
            ctx.save(); ctx.globalAlpha = cp;
            ctx.translate(cx, cy + cardH / 2); ctx.scale(cp, cp); ctx.translate(-cx, -(cy + cardH / 2));
            ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 16;
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            ctx.beginPath(); ctx.roundRect(cx - cardW / 2, cy, cardW, cardH, 14); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(212,168,83,0.3)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = "#d4a853"; ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center"; ctx.fillText("TOTAL EARNINGS (2 SALES)", cx, cy + 22);
            e.forEach((en, i) => {
              const y = cy + 42 + i * 26;
              const rgb = `${en.color[0]},${en.color[1]},${en.color[2]}`;
              ctx.fillStyle = `rgb(${rgb})`;
              ctx.beginPath(); ctx.arc(cx - cardW / 2 + 20, y, 5, 0, Math.PI * 2); ctx.fill();
              ctx.textAlign = "left"; ctx.font = "13px sans-serif"; ctx.fillStyle = "#333";
              ctx.fillText(en.label, cx - cardW / 2 + 32, y + 4);
              ctx.textAlign = "right"; ctx.font = "bold 13px monospace"; ctx.fillStyle = `rgb(${rgb})`;
              ctx.fillText(`${fmt(pa[i] + ra[i])} ${CURRENCY}`, cx + cardW / 2 - 16, y + 4);
            });
            ctx.restore();
          }
          drawBubble(ctx, W / 2, H - 140, scenes[5].text, W * 0.55, p, { tail: false });
        },
      });
    }

    return scenes;
  }

  const scenes = createMemo(() => buildScenes());

  function renderLoop(now: number) {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d")!;
    ctx.save(); ctx.scale(dpr, dpr);

    const elapsed = (now - sceneStartTime) / 1000;
    const progress = Math.min(1, elapsed / 3);

    const sc = scenes(), idx = sceneIndex();
    if (idx < sc.length) sc[idx].draw(ctx, now, progress);

    // Progress dots
    const total = sc.length;
    const startX = W / 2 - (total * 14) / 2;
    for (let i = 0; i < total; i++) {
      ctx.beginPath(); ctx.arc(startX + i * 14 + 4, H - 36, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === idx ? "#d4a853" : i < idx ? "rgba(212,168,83,0.4)" : "rgba(200,200,200,0.3)";
      ctx.fill();
    }

    if (progress > 0.5) {
      const a = 0.3 + 0.3 * Math.sin(now * 0.003);
      ctx.fillStyle = `rgba(100,80,50,${a})`; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Click to continue →", W / 2, H - 14);
    }

    ctx.restore();
    animFrameId = requestAnimationFrame(renderLoop);
  }

  function goScene(i: number) {
    setSceneIndex(i); sceneStartTime = performance.now();
    particles = []; soundsPlayed.clear();
  }

  function next() {
    if (!musicOn() && !musicMuted()) { setMusicOn(true); sfx.startMusic(); }
    goScene(sceneIndex() < scenes().length - 1 ? sceneIndex() + 1 : 0);
  }
  function prev() { if (sceneIndex() > 0) goScene(sceneIndex() - 1); }

  function toggleMusic() {
    if (musicOn()) {
      sfx.stopMusic();
      setMusicOn(false);
      setMusicMuted(true);
      localStorage.setItem("sim-music-off", "1");
    } else {
      sfx.stopMusic(); // Ensure clean state before starting
      sfx.startMusic();
      setMusicOn(true);
      setMusicMuted(false);
      localStorage.removeItem("sim-music-off");
    }
  }

  function resize() {
    if (!canvasRef || !containerRef) return;
    dpr = window.devicePixelRatio || 1;
    W = containerRef.clientWidth;
    H = Math.max(420, Math.min(550, W * 0.58));
    canvasRef.width = W * dpr;
    canvasRef.height = H * dpr;
    canvasRef.style.height = H + "px";
  }

  onMount(() => {
    resize(); sceneStartTime = performance.now();
    animFrameId = requestAnimationFrame(renderLoop);
    const onR = () => resize();
    window.addEventListener("resize", onR);
    onCleanup(() => {
      window.removeEventListener("resize", onR);
      if (animFrameId) cancelAnimationFrame(animFrameId);
      sfx.stopMusic();
    });
  });

  return (
    <div class="space-y-4">
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Simulation V2 — Story Mode
            </h3>
            <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Discover how revenue is distributed, step by step
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button class="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors"
              style={{ background: musicOn() ? "rgba(212,168,83,0.15)" : "var(--surface-light)", color: musicOn() ? "var(--gold)" : "var(--text-muted)" }}
              onClick={toggleMusic} title={musicOn() ? "Mute music" : "Enable music"}>
              {musicOn() ? "♫" : "♪"}
            </button>
            <button class="btn-secondary text-xs" style={{ padding: "6px 14px" }}
              onClick={prev} disabled={sceneIndex() === 0}>←</button>
            <span class="text-xs font-mono px-2" style={{ color: "var(--text-muted)" }}>
              {sceneIndex() + 1}/{scenes().length}
            </span>
            <button class="btn-gold text-xs" style={{ padding: "6px 14px" }} onClick={next}>
              {sceneIndex() === scenes().length - 1 ? "↺" : "→"}
            </button>
          </div>
        </div>

        <div ref={containerRef} class="w-full rounded-xl overflow-hidden cursor-pointer"
          style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }} onClick={next}>
          <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
        </div>

        <div class="flex items-center justify-center gap-1 mt-3">
          {scenes().map((_, i) => (
            <button class="w-2.5 h-2.5 rounded-full transition-all"
              style={{
                background: i === sceneIndex() ? "var(--gold)" : i < sceneIndex() ? "rgba(212,168,83,0.4)" : "var(--surface-light)",
                transform: i === sceneIndex() ? "scale(1.3)" : "scale(1)",
              }}
              onClick={(ev) => { ev.stopPropagation(); goScene(i); }} />
          ))}
        </div>
      </div>
    </div>
  );
}
