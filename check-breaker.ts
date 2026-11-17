// Run: node check-breaker.ts  (fails loudly if the game rules break)
import assert from 'node:assert/strict';
import {
  mulberry32, COLS, ROWS, TOP, W, PADDLE_W, PADDLE_Y, PADDLE_H, R, BOTTOM,
  KIND_BOMB, KIND_NORMAL, SHAPE_COUNT, blast, brickX, brickY, dropCapsule, launch, makeLevel, step, stepCapsules,
  type Capsule, type Events, type Game,
} from './src/breaker-core.ts';
import { clearDay, clearedToday, liveStreak, newProgress, rankOf } from './src/progress.ts';

const ev = (): Events => ({ brick: -1, paddle: false, wall: false, lost: false });
const game = (alive = Array<boolean>(COLS * ROWS).fill(false)): Game => ({
  x: 0, y: 0, vx: 0, vy: 0, speed: 1.2, paddle: 0, paddleW: PADDLE_W, pierce: false, alive,
  kind: Array<number>(COLS * ROWS).fill(KIND_NORMAL), idle: 0,
});

// levels: deterministic per day, a decent size, always one bomb
for (let level = 1; level < 30; level++) {
  const w = makeLevel(20000, level);
  assert.deepEqual(w, makeLevel(20000, level), 'same day, same wall');
  assert.ok(w.alive.filter(Boolean).length >= 15, 'shaped wall is a decent size');
  assert.ok(w.kind.includes(KIND_BOMB), 'at least one bomb');
  assert.ok(w.kind.every((k, i) => w.alive[i] || k === KIND_NORMAL), 'bombs only on bricks that exist');
}
assert.notDeepEqual(makeLevel(1, 1).alive, makeLevel(2, 1).alive, 'different days give different shapes');
assert.equal(new Set(Array.from({ length: SHAPE_COUNT }, (_, d) => makeLevel(d, 1).name)).size, SHAPE_COUNT, 'every shape shows up');

// ball falling onto the paddle centre goes back up; paddle edge sends it sideways
let g = game(); let e = ev();
g.y = PADDLE_Y + PADDLE_H / 2 + R + 0.01; g.vy = -1.2;
step(g, 0.05, e);
assert.ok(e.paddle && g.vy > 0 && Math.abs(g.vx) < 0.15, 'centre bounce is nearly straight up');
g = game(); g.y = PADDLE_Y + 0.02; g.x = 0.14; g.vy = -1.2; step(g, 0.01, e);
assert.ok(e.paddle && g.vx > 0.5, 'right edge sends it right');

// missing the paddle loses the ball
g = game(); g.paddle = 0.7; g.y = PADDLE_Y + 0.1; g.vy = -1.2; e = ev();
let lost = false;
for (let i = 0; i < 200 && !lost; i++) { step(g, 0.016, e); lost = e.lost; }
assert.ok(lost && g.y < BOTTOM + 0.05);

// ball moving up hits a brick: brick dies once, ball turns around
const alive = Array<boolean>(COLS * ROWS).fill(false); alive[23] = true;
g = game(alive); g.x = brickX(23); g.y = brickY(23) - 0.1; g.vy = 1.2; e = ev();
let hits = 0;
for (let i = 0; i < 60; i++) { step(g, 0.016, e); if (e.brick === 23) hits++; }
assert.equal(hits, 1); assert.equal(alive[23], false);

// fireball: breaks a column of two bricks in one pass and keeps going up
const col = Array<boolean>(COLS * ROWS).fill(false); col[COLS * 2 + 4] = col[COLS * 1 + 4] = true;
g = game(col); g.pierce = true; g.x = brickX(COLS * 2 + 4); g.y = brickY(COLS * 2 + 4) - 0.12; g.vy = 1.2; e = ev();
for (let i = 0; i < 80; i++) step(g, 0.016, e);
assert.ok(!col[COLS * 2 + 4] && !col[COLS + 4], 'fireball broke both');

// bombs: break all alive neighbours, and chain into neighbouring bombs
const bw = game(Array<boolean>(COLS * ROWS).fill(true));
bw.alive[44] = false; bw.alive[33] = false; bw.kind[33] = KIND_BOMB; // 33 just broke; 44 was already gone
const out: number[] = [];
blast(bw, 33, out);
assert.deepEqual(out.slice().sort((a, b) => a - b), [22, 23, 24, 32, 34, 42, 43], 'every alive neighbour of 33');
const chain = game(Array<boolean>(COLS * ROWS).fill(true));
chain.kind[12] = KIND_BOMB; chain.alive[11] = false; // 11 just broke; the bomb at 12 is next door
blast(chain, 11, out);
assert.ok(!chain.alive[12] && !chain.alive[3] && !chain.alive[23], 'the second bomb went off and took its own neighbours');

// wide paddle catches what a normal one misses
g = game(); g.paddle = 0; g.y = PADDLE_Y + 0.08; g.x = 0.2; g.vy = -1.2; e = ev();
let caught = false; for (let i = 0; i < 20; i++) { step(g, 0.01, e); caught ||= e.paddle; }
assert.ok(!caught, 'normal paddle misses at 0.2');
g = game(); g.paddleW = 0.5; g.y = PADDLE_Y + 0.08; g.x = 0.2; g.vy = -1.2; e = ev();
caught = false; for (let i = 0; i < 20; i++) { step(g, 0.01, e); caught ||= e.paddle; }
assert.ok(caught, 'wide paddle catches at 0.2');

// capsules: caught on the paddle, lost off the bottom
const caps: Capsule[] = Array.from({ length: 4 }, () => ({ on: false, x: 0, y: 0, kind: 0 }));
g = game(); dropCapsule(caps, 0.05, PADDLE_Y + 0.3, 2);
let got = -1; for (let i = 0; i < 100 && got < 0; i++) got = stepCapsules(caps, g, 0.016);
assert.equal(got, 2); assert.ok(!caps[0].on);
dropCapsule(caps, 0.6, PADDLE_Y + 0.3, 1); g.paddle = -0.6; got = -1;
for (let i = 0; i < 200; i++) got = Math.max(got, stepCapsules(caps, g, 0.016));
assert.equal(got, -1, 'missed capsule is not caught'); assert.ok(caps.every((c) => !c.on));

// a perfectly centred player loops the ball straight up and down; after a drought the bounce leans toward the last brick
{
  const real = Math.random; Math.random = mulberry32(5);
  const lone = Array<boolean>(COLS * ROWS).fill(false); lone[9] = true; // top-right corner
  g = game(lone); g.x = 0; g.y = -0.5; launch(g, 0.05); e = ev();
  let t = 0;
  while (lone[9] && t < 60) { g.paddle = g.x; step(g, 1 / 60, e); t += 1 / 60; }
  Math.random = real;
  assert.ok(!lone[9], `the last brick must break within a minute, took ${t.toFixed(0)} s`);
}

// long random run: ball stays finite and inside the field, paddle chasing it
{ const L = makeLevel(7, 3); g = game(L.alive); g.kind = L.kind; }
g.x = 0; g.y = -0.5; launch(g, 0.3); e = ev();
for (let i = 0; i < 20000; i++) {
  g.paddle = g.x; // perfect player
  step(g, 0.011, e);
  assert.ok(Number.isFinite(g.x + g.y + g.vx + g.vy));
  assert.ok(Math.abs(g.x) <= W / 2 && g.y <= TOP && !e.lost, `escaped at step ${i}`);
  if (!g.alive.some(Boolean)) { const L = makeLevel(i, 5); g.alive = L.alive; g.kind = L.kind; }
}

// daily streak: counts once per day, grows on consecutive days, resets after a missed day
const pr = newProgress();
assert.equal(clearDay(pr, 100), true); assert.equal(clearDay(pr, 100), false, 'only once a day');
assert.equal(pr.streak, 1); assert.ok(clearedToday(pr, 100) && !clearedToday(pr, 101));
clearDay(pr, 101); clearDay(pr, 102); assert.equal(pr.streak, 3);
assert.equal(liveStreak(pr, 103), 3, 'still alive the day after'); assert.equal(liveStreak(pr, 104), 0, 'a missed day shows 0');
clearDay(pr, 105); assert.equal(pr.streak, 1, 'restarts after a gap');
// rank only goes up as lifetime bricks grow
assert.equal(rankOf(0).name, 'CADET'); assert.equal(rankOf(59).name, 'CADET'); assert.equal(rankOf(60).name, 'PILOT');
assert.equal(rankOf(1199).name, 'COMMANDER'); assert.equal(rankOf(5000).name, 'LEGEND'); assert.equal(rankOf(5000).span, 0);
assert.deepEqual([rankOf(130).into, rankOf(130).span], [70, 140]);
console.log('breaker ok');
