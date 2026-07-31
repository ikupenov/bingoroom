/* ---------------------------------------------------------------------------
 * Tiny zero-dependency confetti burst. Respects prefers-reduced-motion.
 * ------------------------------------------------------------------------- */

const COLORS = ["#ff2e93", "#14c4a6", "#ff8c1a", "#8a4fc7", "#3b5bdb", "#ffd23f"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

export function burstConfetti(count = 160): void {
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = globalThis.innerWidth * dpr;
  canvas.height = globalThis.innerHeight * dpr;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const w = globalThis.innerWidth;
  const h = globalThis.innerHeight;
  const particles: Particle[] = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.5,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: Math.random() * -14 - 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    size: 6 + Math.random() * 6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }));

  const gravity = 0.35;
  const drag = 0.99;
  let frame = 0;

  const tick = (): void => {
    ctx.clearRect(0, 0, w, h);
    frame++;
    for (const p of particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - frame / 130);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (frame < 130) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };

  requestAnimationFrame(tick);
}
