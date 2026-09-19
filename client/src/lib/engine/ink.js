// Pure ink rendering helpers (page coordinate space, 1 unit = 1 CSS px of the page)

export const A4 = { w: 794, h: 1123 };

export const PEN_COLORS = ['#1f2937', '#ffffff', '#dc2626', '#2563eb', '#16a34a', '#d97706'];
export const HIGHLIGHTER_COLORS = ['#fde047', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
let measureCtx;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// Bounding box of a text item in page coordinates (used for hit-testing and
// drawing the selection/resize handles).
export function textBounds(t) {
  const ctx = mctx();
  ctx.font = `${t.size}px ${FONT}`;
  const lines = wrapText(ctx, t.text || '', t.w || 320);
  const h = Math.max(t.size * 1.35, lines.length * t.size * 1.35);
  return { x: t.x, y: t.y, w: t.w || 320, h };
}

export function textAt(t, x, y) {
  const b = textBounds(t);
  const pad = 6;
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

export function drawStroke(ctx, s, fast = false) {
  const pts = s.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.moveTo(pts[0][0] - 0.1, pts[0][1]);
      ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
    ctx.stroke();
  } else if (fast) {
    // Live preview: single smooth path, average width (committed strokes use the
    // per-segment pressure path below, rendered once into the content canvas).
    ctx.strokeStyle = s.color;
    let wSum = 0;
    for (const p of pts) wSum += 0.4 + 0.6 * p[2];
    ctx.lineWidth = Math.max(0.5, s.size * (wSum / pts.length));
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.fillStyle = s.color;
      const r = (s.size * (0.4 + 0.6 * pts[0][2])) / 2;
      ctx.arc(pts[0][0], pts[0][1], Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = s.color;
    if (pts.length === 1) {
      ctx.fillStyle = s.color;
      const r = (s.size * (0.4 + 0.6 * pts[0][2])) / 2;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        ctx.lineWidth = Math.max(0.5, s.size * (0.4 + 0.6 * (p0[2] + p1[2]) / 2));
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function drawTextItem(ctx, t) {
  if (!t.text) return;
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.font = `${t.size}px ${FONT}`;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, t.text, t.w || 320);
  let y = t.y;
  for (const line of lines) {
    ctx.fillText(line, t.x, y);
    y += t.size * 1.35;
  }
  ctx.restore();
}

export function wrapText(ctx, text, maxW) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (!raw) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of raw.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function drawBackground(ctx, background, w, h) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const step = 32;
  if (background === 'ruled') {
    ctx.strokeStyle = '#c7d4e8';
    ctx.lineWidth = 1;
    for (let y = step * 2; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (background === 'grid') {
    ctx.strokeStyle = '#d8dce3';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (background === 'dots') {
    ctx.fillStyle = '#b9bec7';
    for (let x = step / 2; x < w; x += step) {
      for (let y = step / 2; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// Backgrounds are static per (type, size) — render once to an offscreen canvas
// at RES and blit, so switching pages / erasing doesn't re-draw ~900 dots.
const bgCache = new Map();
export function backgroundCanvas(background, w, h, res) {
  const key = `${background}:${Math.round(w * res)}x${Math.round(h * res)}`;
  let c = bgCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * res));
    c.height = Math.max(1, Math.round(h * res));
    const ctx = c.getContext('2d');
    ctx.setTransform(res, 0, 0, res, 0, 0);
    drawBackground(ctx, background, w, h);
    bgCache.set(key, c);
  }
  return c;
}

// Bounding boxes are cached in a WeakMap (strokes are immutable — the array is
// replaced, never mutated) so erasing stays fast on big pages without polluting
// the serialized content.
const bbCache = new WeakMap();
export function strokeNear(s, x, y, r) {
  const pts = s.points;
  if (!pts || pts.length === 0) return false;
  let bb = bbCache.get(s);
  if (!bb || bb.n !== pts.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) {
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
    bb = { minx, miny, maxx, maxy, n: pts.length };
    bbCache.set(s, bb);
  }
  if (x < bb.minx - r || x > bb.maxx + r || y < bb.miny - r || y > bb.maxy + r) return false;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y, pts[i - 1], pts[i]) <= r) return true;
  }
  if (pts.length === 1 && Math.hypot(pts[0][0] - x, pts[0][1] - y) <= r) return true;
  return false;
}

function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// Brush erase: remove the points near (x,y) from every stroke, splitting a
// stroke into separate segments wherever points were removed. Returns a new
// array (unchanged strokes keep their identity so the caller can detect no-ops).
export function eraseBrush(strokes, x, y, r) {
  const r2 = r * r;
  const out = [];
  for (const s of strokes) {
    const pts = s.points;
    if (!pts || !pts.length) continue;
    let seg = [];
    const flush = () => {
      if (seg.length >= 2) out.push({ ...s, id: uid(), points: seg });
      seg = [];
    };
    for (const p of pts) {
      const dx = p[0] - x;
      const dy = p[1] - y;
      if (dx * dx + dy * dy <= r2) flush();
      else seg.push(p);
    }
    flush();
  }
  return out;
}

// ---- Auto shape correction (task 5) -----------------------------------------
// When the pen is held still at the end of a stroke, the live stroke is snapped
// to the nearest of: straight line, circle, square, triangle. Returns a new
// points array, or null when the stroke doesn't clearly match a shape.

function rdp(points, eps) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSeg(points[i][0], points[i][1], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx !== -1) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function lineDeviation(points) {
  const a = points[0];
  const b = points[points.length - 1];
  let maxD = 0;
  for (const p of points) maxD = Math.max(maxD, distToSeg(p[0], p[1], a, b));
  return maxD;
}

function snapLine(points) {
  const a = points[0];
  const b = points[points.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(2, Math.round(len / 6));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1]);
  }
  return out;
}

function makeCircle(points) {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  cx /= points.length;
  cy /= points.length;
  let r = 0;
  for (const p of points) r += Math.hypot(p[0] - cx, p[1] - cy);
  r /= points.length;
  const a0 = Math.atan2(points[0][1] - cy, points[0][0] - cx);
  const steps = 72;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (i / steps) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 1]);
  }
  return out;
}

function polyPoints(corners, close) {
  const out = [];
  const seq = close ? [...corners, corners[0]] : corners;
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.round(len / 6));
    const last = i === seq.length - 2;
    for (let s = 0; s <= (last ? steps : steps - 1); s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1]);
    }
  }
  return out;
}

function makeSquare(points) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of points) {
    if (p[0] < minx) minx = p[0];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[1] > maxy) maxy = p[1];
  }
  return polyPoints(
    [
      [minx, miny],
      [maxx, miny],
      [maxx, maxy],
      [minx, maxy],
    ],
    true,
  );
}

function makeTriangle(points) {
  // Pick the 3 points forming the largest-area triangle (sampled for speed).
  const n = points.length;
  const step = Math.max(1, Math.floor(n / 48));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  idx.push(n - 1);
  let best = null;
  let bestA = -1;
  for (let i = 0; i < idx.length; i++)
    for (let j = i + 1; j < idx.length; j++)
      for (let k = j + 1; k < idx.length; k++) {
        const a = points[idx[i]];
        const b = points[idx[j]];
        const c = points[idx[k]];
        const area =
          Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
        if (area > bestA) {
          bestA = area;
          best = [a, b, c];
        }
      }
  if (!best) return null;
  return polyPoints(best, true);
}

export function correctStrokePoints(points) {
  if (!points || points.length < 4) return null;
  const first = points[0];
  const last = points[points.length - 1];
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of points) {
    if (p[0] < minx) minx = p[0];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[1] > maxy) maxy = p[1];
  }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 1;
  const closure = Math.hypot(first[0] - last[0], first[1] - last[1]);
  const isClosed = closure < diag * 0.3;

  if (!isClosed) {
    // Open stroke: only correct to a line when it is clearly straight.
    if (lineDeviation(points) < diag * 0.08) return snapLine(points);
    return null;
  }

  // Closed loop: decide circle vs polygon from radius spread + corner count.
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  cx /= points.length;
  cy /= points.length;
  let r = 0;
  for (const p of points) r += Math.hypot(p[0] - cx, p[1] - cy);
  r /= points.length;
  let varr = 0;
  for (const p of points) {
    const d = Math.hypot(p[0] - cx, p[1] - cy) - r;
    varr += d * d;
  }
  const cv = Math.sqrt(varr / points.length) / (r || 1);
  if (cv < 0.18) return makeCircle(points);

  const closed = [...points, first];
  const corners = rdp(closed, diag * 0.04).length - 1;
  if (corners <= 3) return makeTriangle(points);
  return makeSquare(points);
}
