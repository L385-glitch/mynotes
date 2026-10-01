// Shared input state across all page canvases. Every page renders in the same
// scroll container, so a gesture on one page must react to input on another
// (a pen down anywhere stops finger momentum everywhere; a touch while the pen
// is down anywhere is the writing hand, not a gesture).

const stops = new Set();

export function trackMomentum(stop) {
  stops.add(stop);
  return () => stops.delete(stop);
}

export function stopAllMomentum() {
  for (const stop of [...stops]) stop();
}

let pens = 0;

export function penDownChange(delta) {
  pens = Math.max(0, pens + delta);
}

export function pensDown() {
  return pens;
}
