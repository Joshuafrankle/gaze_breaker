// Pure Gaze Breaker rules (no three.js) so `node check-breaker.ts` can test them.
// Units: metres, field-local, y up, origin at the middle of the playfield plane.
export const W = 1.6; // playfield width: an arc of 1.6 m at 1.4 m is about 65 deg, inside the glasses' 74
export const TOP = 0.45;
export const BOTTOM = -0.92; // ball below this = life lost
export const PADDLE_Y = -0.8;
export const PADDLE_W = 0.28;
export const PADDLE_H = 0.03;
export const COLS = 10;
export const ROWS = 5;
export const BW = 0.15;
export const BH = 0.07;
export const R = 0.025; // ball radius

export const brickX = (i: number) => ((i % COLS) - (COLS - 1) / 2) * 0.16;
export const brickY = (i: number) => 0.36 - Math.floor(i / COLS) * 0.085;
export const today = () => Math.floor(Date.now() / 864e5); // UTC day: the daily wall

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Game {
  x: number; y: number; vx: number; vy: number;
  speed: number;
  paddle: number; // paddle centre x
  paddleW: number; // current paddle width (a power-up widens it)
  pierce: boolean; // fireball: breaks bricks without bouncing
  alive: boolean[];
  kind: number[]; // per brick: KIND_NORMAL or KIND_BOMB
  idle: number; // seconds since a brick last broke: after a long drought the paddle nudges the ball toward what is left
}
export interface Events { brick: number; paddle: boolean; wall: boolean; lost: boolean }

export const KIND_NORMAL = 0, KIND_BOMB = 1;

// Hand-drawn daily wall shapes, 5 rows by 10 columns ('X' = brick). The shape of the day is the same for everyone.
const SHAPES = [
  { name: 'HEART', rows: ['..XX..XX..', '.XXXXXXXX.', '.XXXXXXXX.', '..XXXXXX..', '...XXXX...'] },
  { name: 'INVADER', rows: ['..X....X..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XXXXXXXXXX', 'X.X....X.X'] },
  { name: 'DIAMOND', rows: ['....XX....', '...XXXX...', '..XXXXXX..', '...XXXX...', '....XX....'] },
  { name: 'FRAME', rows: ['XXXXXXXXXX', 'X........X', 'X..XXXX..X', 'X........X', 'XXXXXXXXXX'] },
  { name: 'FUNNEL', rows: ['X........X', 'XX......XX', 'XXX....XXX', 'XXXX..XXXX', 'XXXXXXXXXX'] },
  { name: 'WAVES', rows: ['XX..XX..XX', '.XX..XX..X', '..XX..XX..', '.XX..XX..X', 'XX..XX..XX'] },
];

export const SHAPE_COUNT = SHAPES.length;

export interface Level { alive: boolean[]; kind: number[]; name: string }

// Same day + level = same wall for everyone. Each level is a new shape; later levels fill in extra bricks.
// Every wall has at least one bomb brick, so a chain blast is always on the table.
export function makeLevel(day: number, level: number): Level {
  const rnd = mulberry32(day * 100 + level);
  const shape = SHAPES[(day + level - 1) % SHAPES.length];
  const fill = Math.min(0.35, 0.12 * Math.max(0, level - 2));
  const alive = Array.from({ length: COLS * ROWS }, (_, i) => shape.rows[Math.floor(i / COLS)][i % COLS] === 'X' || rnd() < fill);
  const kind = alive.map((a) => (a && rnd() < 0.07 ? KIND_BOMB : KIND_NORMAL));
  if (!kind.includes(KIND_BOMB)) {
    const cells = alive.flatMap((a, i) => (a ? [i] : []));
    kind[cells[Math.floor(rnd() * cells.length)]] = KIND_BOMB;
  }
  return { alive, kind, name: shape.name };
}

// A bomb brick broke: its alive neighbours (all 8 around it) break too, and any bomb among them goes off in turn.
// Broken indices are written to `out`.
export function blast(g: Game, from: number, out: number[]): void {
  out.length = 0;
  const queue = [from];
  while (queue.length) {
    const b = queue.pop()!;
    const c = b % COLS, r = Math.floor(b / COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((!dr && !dc) || rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        const j = rr * COLS + cc;
        if (!g.alive[j]) continue;
        g.alive[j] = false;
        out.push(j);
        if (g.kind[j] === KIND_BOMB) queue.push(j);
      }
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const IDLE_NUDGE_SEC = 10;

// The nearest brick still standing, or -1.
function nearestBrick(g: Game): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.alive.length; i++) {
    if (!g.alive[i]) continue;
    const d = (brickX(i) - g.x) ** 2 + (brickY(i) - g.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function launch(g: Game, angle: number): void {
  g.vx = g.speed * Math.sin(angle);
  g.vy = g.speed * Math.cos(angle);
}

// Advance the ball by dt seconds. Reports at most one brick per call.
export function step(g: Game, dt: number, ev: Events): void {
  ev.brick = -1;
  ev.paddle = ev.wall = ev.lost = false;
  g.idle += dt;
  const n = Math.max(1, Math.ceil((g.speed * dt) / 0.01)); // sub-steps so it can't tunnel through a brick
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    g.x += g.vx * h;
    g.y += g.vy * h;
    if (g.x < -W / 2 + R) { g.x = -W / 2 + R; g.vx = Math.abs(g.vx); ev.wall = true; }
    else if (g.x > W / 2 - R) { g.x = W / 2 - R; g.vx = -Math.abs(g.vx); ev.wall = true; }
    if (g.y > TOP - R) { g.y = TOP - R; g.vy = -Math.abs(g.vy); ev.wall = true; }
    if (g.y < BOTTOM) { ev.lost = true; return; }

    if (
      g.vy < 0 &&
      g.y - R <= PADDLE_Y + PADDLE_H / 2 &&
      g.y + R >= PADDLE_Y - PADDLE_H / 2 &&
      Math.abs(g.x - g.paddle) <= g.paddleW / 2 + R
    ) {
      const off = clamp((g.x - g.paddle) / (g.paddleW / 2 + R), -1, 1);
      // edge of the paddle sends it out at about 60 degrees; the jitter stops a dead-centre vertical loop
      let angle = off * 1.05 + (Math.random() - 0.5) * 0.14;
      const near = g.idle > IDLE_NUDGE_SEC ? nearestBrick(g) : -1;
      if (near >= 0) {
        // a long drought (a centred player can loop straight up and down): lean the bounce toward the nearest brick
        const aim = Math.atan2(brickX(near) - g.x, brickY(near) - g.y);
        angle = 0.5 * angle + 0.5 * clamp(aim, -1, 1);
      }
      launch(g, angle);
      g.y = PADDLE_Y + PADDLE_H / 2 + R;
      ev.paddle = true;
    }

    if (ev.brick < 0) {
      for (let i = 0; i < g.alive.length; i++) {
        if (!g.alive[i]) continue;
        const bx = brickX(i), by = brickY(i);
        const dx = g.x - clamp(g.x, bx - BW / 2, bx + BW / 2);
        const dy = g.y - clamp(g.y, by - BH / 2, by + BH / 2);
        if (dx * dx + dy * dy >= R * R) continue;
        g.alive[i] = false;
        ev.brick = i;
        g.idle = 0;
        if (g.pierce) { /* fireball: straight through */ }
        else if (Math.abs(dx) > Math.abs(dy)) g.vx = dx > 0 ? Math.abs(g.vx) : -Math.abs(g.vx);
        else g.vy = dy >= 0 ? Math.abs(g.vy) : -Math.abs(g.vy);
        break;
      }
    }
  }
}

// Power-up capsules fall from broken bricks; catching one with the paddle activates it.
export interface Capsule { on: boolean; x: number; y: number; kind: number }
export const CAP_SPEED = 0.45;
export const CAP_R = 0.035;

export function dropCapsule(caps: Capsule[], x: number, y: number, kind: number): void {
  const c = caps.find((c) => !c.on);
  if (c) { c.on = true; c.x = x; c.y = y; c.kind = kind; }
}

// Returns the kind of a capsule caught this call, or -1.
export function stepCapsules(caps: Capsule[], g: Game, dt: number): number {
  let caught = -1;
  for (const c of caps) {
    if (!c.on) continue;
    c.y -= CAP_SPEED * dt;
    if (
      c.y <= PADDLE_Y + PADDLE_H / 2 + CAP_R &&
      c.y >= PADDLE_Y - PADDLE_H &&
      Math.abs(c.x - g.paddle) <= g.paddleW / 2 + CAP_R
    ) { c.on = false; caught = c.kind; }
    else if (c.y < PADDLE_Y - 0.08) c.on = false; // missed: gone just past the paddle, before it reaches the score panel
  }
  return caught;
}
