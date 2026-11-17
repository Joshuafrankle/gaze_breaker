export const STEPS = 8;
export const ROWS = 5;
export const NOTES = 5;

// Today's melody as cell keys (step * ROWS + row): the same for everyone on the same UTC day.
export function echoPhrase(day: number): number[] {
  let s = day >>> 0; // mulberry32
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const steps = [...Array(STEPS).keys()];
  return Array.from({ length: NOTES }, () => {
    const step = steps.splice(Math.floor(rnd() * steps.length), 1)[0];
    return step * ROWS + Math.floor(rnd() * ROWS);
  });
}

export const today = () => Math.floor(Date.now() / 864e5);
