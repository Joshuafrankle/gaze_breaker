// Visual helpers for Gaze Breaker: animated background, glow sprite, canvas HUD panels.
import {
  BackSide,
  Color,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

// A slowly flowing aurora with twinkling stars on a big inside-out sphere. A few sines instead of
// noise keeps it cheap enough for a headset; it is drawn first, behind everything.
// Dark / mid / light colour per world. Each level gets the next world, and the change fades in.
const PALETTES = [
  [[0.03, 0.02, 0.12], [0.35, 0.08, 0.50], [0.05, 0.40, 0.70]], // aurora
  [[0.10, 0.02, 0.08], [0.60, 0.12, 0.25], [0.95, 0.45, 0.15]], // sunset
  [[0.01, 0.07, 0.08], [0.05, 0.40, 0.35], [0.30, 0.85, 0.45]], // emerald
  [[0.02, 0.05, 0.15], [0.15, 0.30, 0.65], [0.55, 0.80, 1.00]], // ice
  [[0.08, 0.01, 0.12], [0.55, 0.10, 0.55], [1.00, 0.35, 0.75]], // magenta
  [[0.08, 0.04, 0.02], [0.55, 0.30, 0.05], [1.00, 0.75, 0.25]], // gold
];

export function makeBackground(): {
  mesh: Mesh;
  tick(t: number, energy: number, pulse: number, boost: number, dt: number): void;
  setPalette(i: number): void;
  setDim(v: number): void;
  setRings(v: number): void;
  setCalm(on: boolean): void;
} {
  const cur = [new Color(), new Color(), new Color()];
  const goal = [new Color(), new Color(), new Color()];
  const load = (i: number, to: Color[]) => PALETTES[i % PALETTES.length].forEach((c, k) => to[k].setRGB(c[0], c[1], c[2]));
  load(0, cur);
  load(0, goal);
  let calmGoal = 0;
  let ringT = 0;
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { t: { value: 0 }, dm: { value: 1 }, rg: { value: 1 }, cm: { value: 0 }, e: { value: 0 }, pu: { value: 0 }, rt: { value: 0 }, bp: { value: 0 }, c1: { value: cur[0] }, c2: { value: cur[1] }, c3: { value: cur[2] } },
    vertexShader: 'varying vec3 v; void main(){ v = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float t; uniform float dm; uniform float rg; uniform float cm; uniform float e; uniform float pu; uniform float rt; uniform float bp; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; varying vec3 v;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(v);
        vec3 p = d * 3.0;
        float a = sin(p.x * 1.7 + t * 0.15) + sin(p.y * 2.1 - t * 0.11) + sin(p.z * 1.9 + t * 0.13)
                + sin((p.x + p.y + p.z) * 1.3 + t * 0.10) + 0.6 * (1.0 - 0.8 * cm) * sin(p.x * 5.0 + p.y * 4.0 + t * 0.30);
        a = a * 0.2 + 0.5;
        vec3 col = mix(c1, c2, smoothstep(0.35, 0.80, a));
        col = mix(col, c3, smoothstep(0.55, 0.95, a) * 0.55);
        col *= mix(0.55, 0.8, cm); // keep the sky dim so the bright tiles in front stand out (calm: a little lighter)
        // Calm: three huge soft lamps of light drifting slowly across a gentle dusk sky.
        float lamps = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          vec3 lc = normalize(vec3(0.9 * sin(t * 0.07 + fi * 2.1), 0.3 * sin(t * 0.05 + fi * 1.3) - 0.1, -1.0));
          lamps += smoothstep(0.4, 0.97, dot(d, lc));
        }
        col += mix(c2, c3, 0.6) * lamps * 0.3 * cm;
        vec3 sp = d * 55.0;
        float h = hash(floor(sp));
        float star = step(0.986, h) * (0.6 + 0.4 * sin(t * 2.0 + h * 60.0)) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
        col = mix(col, col * vec3(1.6, 1.0, 0.6) + vec3(0.14, 0.04, 0.0), e * 0.85); // warms up when the player is on a roll
        col *= 1.0 + 0.3 * pu; // breathes on every kick
        // A ring tunnel, as rhythm games use: neon frames rush toward you, flash on the kick and burn hotter on a roll.
        // They only show round the edges, so the middle (the ball) stays quiet.
        float zf = -d.z;
        if (zf > 0.1) {
          vec2 q = d.xy / zf;
          float s = pow(pow(abs(q.x), 4.0) + pow(abs(q.y + 0.1), 4.0), 0.25);
          float ph = fract(2.2 / max(s, 0.05) + rt);
          float line = smoothstep(0.0, 0.06, ph) * smoothstep(0.2, 0.06, ph);
          float vis = smoothstep(0.55, 0.95, s) * smoothstep(3.2, 1.8, s);
          col += mix(c3, c2, 0.25) * 2.6 * line * vis * rg * (0.35 + 0.9 * pu + 1.0 * bp); // flashes on the kick; burns hotter on combo milestones, power-ups and new levels
        }
        col += vec3(star);
        col *= (0.45 + 0.55 * smoothstep(-0.7, 0.4, d.y)) * dm; // dm: dimmed for the high-contrast option
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(20, 32, 20), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    mesh,
    tick(t, e, pu, boost, dt) {
      mat.uniforms.t.value = t;
      mat.uniforms.bp.value = boost;
      ringT += dt * (0.3 + 0.4 * boost); // the phase is accumulated, so a change of speed never makes the frames jump
      mat.uniforms.rt.value = ringT;
      mat.uniforms.e.value = e;
      mat.uniforms.pu.value = pu;
      for (let k = 0; k < 3; k++) cur[k].lerp(goal[k], Math.min(1, dt * 1.2)); // fade into the next world
      mat.uniforms.cm.value += (calmGoal - mat.uniforms.cm.value) * Math.min(1, dt * 1.5);
    },
    setPalette: (i) => load(i, goal),
    setDim: (v) => (mat.uniforms.dm.value = v),
    setRings: (v) => (mat.uniforms.rg.value = v),
    setCalm: (on) => (calmGoal = on ? 1 : 0),
  };
}

export function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

type Ctx = CanvasRenderingContext2D;

// Card colours follow the sky: every world tints the glass, the border and the labels. High contrast = black, white, yellow.
type Theme = { key: string; fill: string; a: string; b: string; label: string; life: string; on: string };
let T: Theme;
const norm = (c: number[]) => c.map((v) => v / Math.max(...c));
const rgb = (c: number[], white = 0) => `rgb(${c.map((v) => Math.round(255 * (v * (1 - white) + white))).join(',')})`;
export function setTheme(world: number, hc: boolean): void {
  const [d, m, l] = PALETTES[world % PALETTES.length];
  T = hc
    ? { key: 'h', fill: 'rgba(6,8,20,0.94)', a: '#ffffff', b: '#f0e442', label: '#f0e442', life: '#f0e442', on: '#f0e442' }
    : {
        key: String(world % PALETTES.length),
        fill: `rgba(${d.map((v) => Math.round(v * 255 * 1.6)).join(',')},0.86)`,
        a: rgb(norm(l), 0.1),
        b: rgb(norm(m), 0.1),
        label: rgb(norm(l), 0.5),
        life: '#ff5fc8',
        on: '#7dffb0',
      };
}
setTheme(0, false);

// Brick colours that stand out from the current sky: the opposite hue, spread over the rows.
export function brickPalette(world: number, rows: number): Color[] {
  const hsl = { h: 0, s: 0, l: 0 };
  const [r, g, b] = norm(PALETTES[world % PALETTES.length][2]);
  new Color().setRGB(r, g, b).getHSL(hsl);
  return Array.from({ length: rows }, (_, i) => new Color().setHSL((hsl.h + 0.5 + (i - (rows - 1) / 2) * 0.16 + 1) % 1, 1, 0.5));
}

// Fit one line of text into maxW pixels by shrinking the font if it has to.
function fit(g: Ctx, text: string, px: number, maxW: number, weight = 700): void {
  g.font = `${weight} ${px}px sans-serif`;
  const w = g.measureText(text).width;
  if (w > maxW) g.font = `${weight} ${Math.floor((px * maxW) / w)}px sans-serif`;
}

// A plane that shows a canvas; `draw` repaints only when `key` changes.
export function canvasPlane(w: number, h: number, px = 768) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  let last: string | null = null;
  return {
    mesh,
    draw(key: string, fn: (g: Ctx, cw: number, ch: number) => void) {
      const k = `${T.key}|${key}`;
      if (k === last) return;
      last = k;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      fn(g, c.width, c.height);
      map.needsUpdate = true;
    },
  };
}

function glass(g: Ctx, w: number, h: number): void {
  const m = 6, r = Math.min(h * 0.22, 44);
  g.textBaseline = 'middle';
  g.fillStyle = T.fill;
  g.beginPath();
  g.roundRect(m, m, w - 2 * m, h - 2 * m, r);
  g.fill();
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, T.a);
  grad.addColorStop(1, T.b);
  g.strokeStyle = grad;
  g.lineWidth = T.key === 'h' ? 6 : 3;
  g.shadowColor = T.a;
  g.shadowBlur = T.key === 'h' ? 8 : 10;
  g.beginPath();
  g.roundRect(m, m, w - 2 * m, h - 2 * m, r);
  g.stroke();
  g.shadowBlur = 0;
}

export function drawHud(g: Ctx, w: number, h: number, s: { score: number; best: number; level: number; lives: number; maxLives: number }): void {
  glass(g, w, h);
  g.textAlign = 'center';
  const cols = [0.135, 0.385, 0.6]; // column centres; lives take the right-hand side
  const items: [string, number][] = [['SCORE', s.score], ['BEST', s.best], ['LEVEL', s.level]];
  items.forEach(([label, value], i) => {
    const cx = w * cols[i];
    g.fillStyle = T.label;
    fit(g, label, h * 0.17, w * 0.2);
    g.fillText(label, cx, h * 0.28);
    g.fillStyle = '#fff';
    fit(g, String(value), h * 0.4, w * 0.2, 800);
    g.fillText(String(value), cx, h * 0.64);
  });
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  for (const x of [0.26, 0.51, 0.69]) {
    g.beginPath();
    g.moveTo(w * x, h * 0.24);
    g.lineTo(w * x, h * 0.76);
    g.stroke();
  }
  g.fillStyle = T.label;
  fit(g, 'LIVES', h * 0.17, w * 0.2);
  g.fillText('LIVES', w * 0.85, h * 0.28);
  const n = s.maxLives, r = h * 0.085, step = r * 2.9;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.arc(w * 0.85 + (i - (n - 1) / 2) * step, h * 0.64, r, 0, Math.PI * 2);
    g.fillStyle = i < s.lives ? T.life : 'rgba(255,255,255,0.18)';
    g.fill();
  }
}

export function drawMessage(g: Ctx, w: number, h: number, title: string, sub: string): void {
  glass(g, w, h);
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.shadowColor = T.a;
  g.shadowBlur = T.key === 'h' ? 0 : 14;
  fit(g, title, h * 0.4, w * 0.84, 800);
  g.fillText(title, w / 2, h * 0.4);
  g.shadowBlur = 0;
  g.fillStyle = T.label;
  fit(g, sub, h * 0.17, w * 0.84, 600);
  g.fillText(sub, w / 2, h * 0.75);
}

export function drawToast(g: Ctx, w: number, h: number, text: string, color = '#ffd34d'): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.shadowColor = '#ff9d00';
  g.shadowBlur = 16;
  g.font = `800 ${h * 0.78}px sans-serif`;
  const fit = (w - 30) / g.measureText(text).width;
  if (fit < 1) g.font = `800 ${Math.floor(h * 0.78 * fit)}px sans-serif`;
  g.fillText(text, w / 2, h / 2);
  g.shadowBlur = 0;
  g.textBaseline = 'alphabetic';
}

// Power-up looks: shared by the falling capsule and the timer chips.
export const CAP_STYLE = [
  { hex: 0x44ddff, css: '#44ddff' }, // wide paddle
  { hex: 0x66ff99, css: '#66ff99' }, // slow motion
  { hex: 0xff8a33, css: '#ff8a33' }, // fireball
];

// A round badge with a white glyph: arrows (wide), clock (slow), flame (fire).
export function drawIcon(g: Ctx, kind: number, cx: number, cy: number, r: number): void {
  const k = r / 64;
  g.save();
  g.translate(cx - 64 * k, cy - 64 * k);
  g.scale(k, k);
  g.fillStyle = 'rgba(8,10,36,0.92)';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = CAP_STYLE[kind].css;
  g.lineWidth = 9;
  g.shadowColor = CAP_STYLE[kind].css;
  g.shadowBlur = 14;
  g.beginPath();
  g.arc(64, 64, 55, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 8;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  if (kind === 0) {
    g.moveTo(34, 64); g.lineTo(94, 64);
    g.moveTo(50, 48); g.lineTo(34, 64); g.lineTo(50, 80);
    g.moveTo(78, 48); g.lineTo(94, 64); g.lineTo(78, 80);
    g.stroke();
  } else if (kind === 1) {
    g.arc(64, 64, 27, 0, Math.PI * 2);
    g.moveTo(64, 64); g.lineTo(64, 46);
    g.moveTo(64, 64); g.lineTo(77, 72);
    g.stroke();
  } else {
    g.moveTo(66, 24);
    g.bezierCurveTo(88, 46, 94, 62, 84, 82);
    g.bezierCurveTo(78, 96, 50, 98, 45, 80);
    g.bezierCurveTo(41, 66, 52, 60, 56, 46);
    g.bezierCurveTo(60, 56, 66, 52, 66, 24);
    g.fill();
  }
  g.restore();
}

export function iconTexture(kind: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  drawIcon(c.getContext('2d')!, kind, 64, 64, 64);
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  return map;
}

// Chips for the power-ups that are running: icon plus a bar that drains.
export function drawFx(g: Ctx, w: number, h: number, items: { kind: number; frac: number }[]): void {
  const slot = w / 3;
  items.forEach((it, i) => {
    const x = slot * i;
    drawIcon(g, it.kind, x + h * 0.5, h / 2, h * 0.46);
    const bx = x + h * 1.1, bw = slot - h * 1.3, by = h * 0.4, bh = h * 0.2;
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
    g.fillStyle = CAP_STYLE[it.kind].css;
    g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * it.frac), bh, bh / 2); g.fill();
  });
}

// An accessibility toggle: title and ON/OFF pill on one line, help under it. Hover draws a white outline; a pinch toggles it.
export function drawChip(g: Ctx, w: number, h: number, title: string, sub: string, on: boolean, hover: boolean): void {
  glass(g, w, h);
  const pad = h * 0.17;
  if (hover) {
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, Math.min(h * 0.22, 44));
    g.stroke();
  }
  // ON / OFF pill, top right
  const pw = h * 0.62, ph = h * 0.3, px = w - pad - pw, py = h * 0.3 - ph / 2;
  g.beginPath();
  g.roundRect(px, py, pw, ph, ph / 2);
  if (on) {
    g.fillStyle = T.on;
    g.fill();
  } else {
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 3;
    g.stroke();
  }
  g.textAlign = 'center';
  g.fillStyle = on ? '#001018' : 'rgba(255,255,255,0.8)';
  g.font = `800 ${ph * 0.6}px sans-serif`;
  g.fillText(on ? 'ON' : 'OFF', px + pw / 2, py + ph / 2 + 1);
  g.textAlign = 'left';
  g.fillStyle = '#fff';
  fit(g, title, h * 0.27, px - pad * 1.6, 800);
  g.fillText(title, pad, h * 0.3);
  g.fillStyle = T.label;
  fit(g, sub, h * 0.22, w - 2 * pad, 600);
  g.fillText(sub, pad, h * 0.62);
}

// The standard brick face: solid colour, lit from above (bright top, darker underside) with a glossy stripe, so it reads
// as a chunky 3D block. Multiplied by the row colour (also used as the emissive map). UVs as in patternTexture.
export function tileTexture(w: number, h: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const g = c.getContext('2d')!;
  const H = c.height, W = c.width;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#e4e4e4');
  grad.addColorStop(1, '#8e8e8e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.7)'; // gloss stripe
  g.beginPath();
  g.roundRect(W * 0.06, H * 0.12, W * 0.88, H * 0.2, H * 0.1);
  g.fill();
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  map.repeat.set(1 / w, 1 / h);
  map.offset.set(0.5, 0.5);
  return map;
}

// A pattern per brick row for high-contrast mode, so rows differ by shape as well as colour:
// 0 solid, 1 stripes, 2 dots, 3 hatch, 4 zigzag. Mapped onto the tile face in world units (see applyOptions).
export function patternTexture(kind: number, w: number, h: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const g = c.getContext('2d')!;
  const H = c.height, W = c.width;
  // Lit from above like the standard tile, so contrast bricks are chunky too (the bomb brick stays pale and flat).
  const lit = g.createLinearGradient(0, 0, 0, H);
  lit.addColorStop(0, '#ffffff');
  lit.addColorStop(0.55, '#f4f4f4');
  lit.addColorStop(1, kind === 5 ? '#ffffff' : '#e0e0e0');
  g.fillStyle = lit;
  g.fillRect(0, 0, W, H);
  g.fillStyle = g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = H * 0.14;
  g.lineJoin = 'round';
  if (kind === 1) {
    for (let i = 0; i < 3; i++) g.fillRect(W * 0.08, H * (0.14 + i * 0.3), W * 0.84, H * 0.18);
  } else if (kind === 2) {
    for (let x = 0; x < 6; x++) for (let y = 0; y < 2; y++) {
      g.beginPath();
      g.arc(W * (0.12 + x * 0.152), H * (0.3 + y * 0.4), H * 0.12, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 3) {
    g.beginPath();
    for (let x = -H; x < W; x += H * 0.5) { g.moveTo(x, H); g.lineTo(x + H, 0); }
    g.stroke();
  } else if (kind === 5) {
    // bomb brick: a cartoon bomb (black ball, shine, fuse and a lit spark)
    const cx = W / 2 - H * 0.1, cy = H * 0.62, r = H * 0.33;
    g.fillStyle = '#16161c';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(cx - r * 0.38, cy - r * 0.38, r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a2a1a';
    g.lineWidth = H * 0.07;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + r * 0.55, cy - r * 0.85);
    g.quadraticCurveTo(cx + r * 0.95, cy - r * 1.35, cx + r * 1.45, cy - r * 1.2);
    g.stroke();
    const sx = cx + r * 1.5, sy = cy - r * 1.2;
    g.fillStyle = '#ff5a1a';
    g.beginPath();
    for (let i = 0; i < 16; i++) g.lineTo(sx + Math.cos((i * Math.PI) / 8) * H * (i % 2 ? 0.1 : 0.2), sy + Math.sin((i * Math.PI) / 8) * H * (i % 2 ? 0.1 : 0.2));
    g.fill();
    g.fillStyle = '#ffe14d';
    g.beginPath();
    g.arc(sx, sy, H * 0.07, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 4) {
    for (let r = 0; r < 2; r++) {
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = W * (0.08 + i * 0.105), y = H * (r === 0 ? 0.3 : 0.7) + (i % 2 ? H * 0.12 : -H * 0.12);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  // UVs on an extruded face are world units centred on the shape: remap to 0..1 across the tile
  map.repeat.set(1 / w, 1 / h);
  map.offset.set(0.5, 0.5);
  return map;
}

// The list of ranks: the one you hold is filled in, the ones ahead are dimmed with what it takes to reach them.
export function drawRanks(g: Ctx, w: number, h: number, ranks: { name: string; at: number }[], index: number, bricks: number): void {
  glass(g, w, h);
  const pad = w * 0.06;
  g.textAlign = 'left';
  g.fillStyle = T.label;
  fit(g, 'RANKS', h * 0.1, w * 0.4, 700);
  g.fillText('RANKS', pad, h * 0.1);
  g.textAlign = 'right';
  fit(g, `${bricks} bricks broken`, h * 0.085, w * 0.5, 600);
  g.fillText(`${bricks} bricks broken`, w - pad, h * 0.1);
  const rh = h * 0.115;
  ranks.forEach((r, i) => {
    const cy = h * (0.27 + 0.13 * i);
    const now = i === index;
    if (now) {
      g.fillStyle = T.a;
      g.beginPath(); g.roundRect(pad * 0.6, cy - rh / 2, w - pad * 1.2, rh, rh / 2); g.fill();
    }
    g.fillStyle = now ? '#001018' : i < index ? '#fff' : 'rgba(255,255,255,0.55)';
    g.textAlign = 'left';
    fit(g, r.name, rh * 0.62, w * 0.5, 800);
    g.fillText(r.name, pad * 1.2, cy);
    g.textAlign = 'right';
    const note = now ? 'YOU ARE HERE' : r.at === 0 ? 'start' : `${r.at} bricks`;
    fit(g, note, rh * 0.5, w * 0.4, 700);
    g.fillText(note, w - pad * 1.2, cy);
  });
  g.textAlign = 'center';
  g.fillStyle = T.label;
  fit(g, 'Pinch to close', h * 0.07, w * 0.5, 600);
  g.fillText('Pinch to close', w / 2, h * 0.93);
}

// Between rounds: daily streak, whether today's wall is cleared, and lifetime rank with a progress bar.
export function drawProgress(
  g: Ctx, w: number, h: number,
  s: { streak: number; done: boolean; name: string; rank: string; into: number; span: number },
): void {
  glass(g, w, h);
  const col = w / 3;
  g.textAlign = 'center';
  const label = (i: number, text: string) => {
    g.fillStyle = T.label;
    fit(g, text, h * 0.18, col * 0.84, 700);
    g.fillText(text, col * (i + 0.5), h * 0.26);
  };
  const big = (i: number, text: string, color = '#fff', dx = 0, y = 0.6) => {
    g.fillStyle = color;
    fit(g, text, h * 0.34, col * 0.84 - Math.abs(dx) * 2, 800);
    g.fillText(text, col * (i + 0.5) + dx, h * y);
  };
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  for (const i of [1, 2]) {
    g.beginPath();
    g.moveTo(col * i, h * 0.22);
    g.lineTo(col * i, h * 0.78);
    g.stroke();
  }
  label(0, 'DAILY STREAK');
  if (s.streak > 0) drawIcon(g, 2, col * 0.5 - h * 0.58, h * 0.6, h * 0.15); // flame
  big(0, `${s.streak} ${s.streak === 1 ? 'DAY' : 'DAYS'}`, '#fff', s.streak > 0 ? h * 0.2 : 0);
  label(1, s.name ? `TODAY: ${s.name}` : "TODAY'S WALL");
  big(1, s.done ? 'CLEARED' : 'CLEAR IT', s.done ? T.on : '#ffd34d');
  label(2, 'RANK');
  // A drawn chevron after the label (the text glyph sits low), hinting that the panel opens the list.
  const cx = col * 2.5 + g.measureText('RANK').width / 2 + h * 0.1, cy = h * 0.26, k = h * 0.04;
  g.strokeStyle = T.label;
  g.lineWidth = h * 0.022;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.moveTo(cx - k / 2, cy - k); g.lineTo(cx + k / 2, cy); g.lineTo(cx - k / 2, cy + k); g.stroke();
  big(2, s.rank, '#fff', 0, 0.5);
  const bw = col * 0.6, bx = col * 2.5 - bw / 2, by = h * 0.76, bh = h * 0.07;
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
  const frac = s.span > 0 ? s.into / s.span : 1;
  g.fillStyle = T.a;
  g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * frac), bh, bh / 2); g.fill();
}
