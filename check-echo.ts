// Run: node check-echo.ts  (fails loudly if the daily phrase logic breaks)
import assert from 'node:assert/strict';
import { echoPhrase, NOTES, STEPS, ROWS } from './src/echo.ts';

const seen = new Set<string>();
for (let day = 20000; day < 20400; day++) {
  const p = echoPhrase(day);
  assert.deepEqual(p, echoPhrase(day), 'same day, same phrase');
  assert.equal(p.length, NOTES);
  const steps = p.map((k) => Math.floor(k / ROWS));
  assert.equal(new Set(steps).size, NOTES, 'one note per step');
  assert.ok(steps.every((s) => s >= 0 && s < STEPS) && p.every((k) => k % ROWS < ROWS));
  seen.add(p.join());
}
assert.ok(seen.size > 300, 'phrases vary by day');
console.log('echo ok');
