/* ---------------------------------------------------------------------------
 * Zero-dependency fireworks. One shared canvas; fire radial bursts from any
 * point (firework) and a viewport-wide barrage (finaleFireworks). Self-cleans
 * when the last particle dies. Respects prefers-reduced-motion at the caller.
 * ------------------------------------------------------------------------- */

const COLORS = ["#ff2e93", "#14c4a6", "#ff8c1a", "#8a4fc7", "#3b5bdb", "#ffd23f"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  rot: number;
  vr: number;
  streamer: boolean;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let dpr = 1;
const particles: Particle[] = [];
let running = false;

function ensureCanvas(): boolean {
  if (canvas && ctx) return true;
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  c.width = globalThis.innerWidth * dpr;
  c.height = globalThis.innerHeight * dpr;
  const context = c.getContext("2d");
  if (!context) return false;
  context.scale(dpr, dpr);
  document.body.appendChild(c);
  canvas = c;
  ctx = context;
  return true;
}

function teardown(): void {
  canvas?.remove();
  canvas = null;
  ctx = null;
  particles.length = 0;
  running = false;
}

const GRAVITY = 0.12;
const DRAG = 0.985;

function loop(): void {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, globalThis.innerWidth, globalThis.innerHeight);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.vx *= DRAG;
    p.vy = p.vy * DRAG + GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life++;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.streamer) {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (particles.length > 0) {
    requestAnimationFrame(loop);
  } else {
    teardown();
  }
}

function start(): void {
  if (running) return;
  running = true;
  requestAnimationFrame(loop);
}

/** Radial burst of sparks + streamers from (x, y). */
export function firework(x: number, y: number, count = 60, spread = 8): void {
  if (!ensureCanvas()) return;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * spread;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 5 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      life: 0,
      maxLife: 55 + Math.random() * 45,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.5,
      streamer: Math.random() < 0.5,
    });
  }
  start();
}

/** A short barrage across the upper viewport for the big finale. */
export function finaleFireworks(): void {
  const w = globalThis.innerWidth;
  const h = globalThis.innerHeight;
  const spots: [number, number, number][] = [
    [0.5, 0.4, 0],
    [0.28, 0.5, 80],
    [0.72, 0.48, 120],
    [0.42, 0.28, 220],
    [0.62, 0.33, 300],
  ];
  for (const [fx, fy, delay] of spots) {
    setTimeout(() => firework(w * fx, h * fy, 80, 10), delay);
  }
}
