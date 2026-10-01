// Pure ink rendering helpers (page coordinate space, 1 unit = 1 CSS px of the page)

export const A4 = { w: 794, h: 1123 };

export const PEN_COLORS = [
  '#1f2937', '#ffffff', '#64748b',
  '#dc2626', '#ea580c', '#d97706',
  '#16a34a', '#0d9488', '#2563eb',
  '#0ea5e9', '#7c3aed', '#db2777',
];
export const HIGHLIGHTER_COLORS = [
  '#fde047', '#bbf7d0', '#bfdbfe', '#fbcfe8',
  '#fed7aa', '#ddd6fe', '#99f6e4', '#fecaca',
];

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
  if (s.shape) {
    drawShape(ctx, s.shape, s);
    return;
  }
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
  if (t.border && t.border.width > 0) {
    const b = textBounds(t);
    const pad = 6;
    ctx.strokeStyle = t.border.color || '#1f2937';
    ctx.lineWidth = t.border.width;
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  }
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
  if (s.shape) return shapeNear(s.shape, x, y, r);
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
    if (s.shape) {
      // Geometric shapes can't be partially erased — drop the whole shape when
      // the brush touches it.
      if (shapeNear(s.shape, x, y, r)) continue;
      out.push(s);
      continue;
    }
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


// ---- Auto shape correction + shape geometry ---------------------------------
// When the pen is held still at the end of a stroke, the live stroke is snapped
// to the nearest of: straight line, circle, square, triangle. A corrected
// stroke stores a structured `shape` (so it can be moved / resized) plus a
// generated `points` cloud for compatibility.

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

// Convex hull (Andrew's monotone chain), CCW, no duplicate closing point.
function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Reduce a closed convex loop to its corner points (RDP around the
// farthest-from-centroid anchor). Edge wobble is absorbed; real corners survive.
function loopCorners(points, eps) {
  const n = points.length;
  if (n < 4) return points.map((p) => [p[0], p[1]]);
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  cx /= n;
  cy /= n;
  let anchor = 0;
  let maxd = -1;
  for (let i = 0; i < n; i++) {
    const d = (points[i][0] - cx) ** 2 + (points[i][1] - cy) ** 2;
    if (d > maxd) {
      maxd = d;
      anchor = i;
    }
  }
  const seq = [];
  for (let i = 0; i < n; i++) {
    const p = points[(anchor + i) % n];
    seq.push([p[0], p[1]]);
  }
  seq.push([points[anchor][0], points[anchor][1]]);
  return rdp(seq, eps).slice(0, -1);
}

// Generate a point cloud from a structured shape (for compatibility + fallback).
export function shapeToPoints(shape) {
  const out = [];
  const seg = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.round(len / 6));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1]);
    }
  };
  if (shape.type === 'line') {
    const a = [shape.x1, shape.y1];
    const b = [shape.x2, shape.y2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.round(len / 6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1]);
    }
  } else if (shape.type === 'circle') {
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push([shape.cx + shape.r * Math.cos(a), shape.cy + shape.r * Math.sin(a), 1]);
    }
  } else if (shape.type === 'square' || shape.type === 'rect') {
    const c = [
      [shape.x, shape.y],
      [shape.x + shape.w, shape.y],
      [shape.x + shape.w, shape.y + shape.h],
      [shape.x, shape.y + shape.h],
    ];
    for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]);
    out.push([c[0][0], c[0][1], 1]);
  } else if (shape.type === 'triangle') {
    const c = [
      [shape.x1, shape.y1],
      [shape.x2, shape.y2],
      [shape.x3, shape.y3],
    ];
    for (let i = 0; i < 3; i++) seg(c[i], c[(i + 1) % 3]);
    out.push([c[0][0], c[0][1], 1]);
  }
  return out;
}

// Snap a drawn stroke to the nearest shape. Returns { shape, points } or null.
export function correctStroke(points) {
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
  const isClosed = closure < diag * 0.35;

  if (!isClosed) {
    // Open stroke: snap to a straight line when it is close enough to one.
    if (lineDeviation(points) < diag * 0.13) {
      const shape = { type: 'line', x1: first[0], y1: first[1], x2: last[0], y2: last[1] };
      return { shape, points: shapeToPoints(shape) };
    }
    return null;
  }

  // Closed loop: count corners on the convex hull to pick the shape.
  const corners = loopCorners(convexHull(points), diag * 0.07);
  if (corners.length === 3) {
    const shape = {
      type: 'triangle',
      x1: corners[0][0], y1: corners[0][1],
      x2: corners[1][0], y2: corners[1][1],
      x3: corners[2][0], y3: corners[2][1],
    };
    return { shape, points: shapeToPoints(shape) };
  }
  if (corners.length === 4) {
    const shape = { type: 'square', x: minx, y: miny, w: maxx - minx, h: maxy - miny };
    return { shape, points: shapeToPoints(shape) };
  }
  // Anything else round-ish becomes a circle.
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
  const shape = { type: 'circle', cx, cy, r };
  return { shape, points: shapeToPoints(shape) };
}

// Draw a structured shape with a crisp geometric path.
function drawShape(ctx, shape, s) {
  if (shape.type === 'rect') {
    ctx.save();
    if (s.tool === 'highlighter') {
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.fillStyle = s.color;
    ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.beginPath();
  if (shape.type === 'line') {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
  } else if (shape.type === 'circle') {
    ctx.arc(shape.cx, shape.cy, Math.max(0.5, shape.r), 0, Math.PI * 2);
  } else if (shape.type === 'square') {
    ctx.rect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.type === 'triangle') {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.lineTo(shape.x3, shape.y3);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

function shapeBounds(shape) {
  if (shape.type === 'line') {
    return {
      minx: Math.min(shape.x1, shape.x2),
      miny: Math.min(shape.y1, shape.y2),
      maxx: Math.max(shape.x1, shape.x2),
      maxy: Math.max(shape.y1, shape.y2),
    };
  }
  if (shape.type === 'circle') {
    return { minx: shape.cx - shape.r, miny: shape.cy - shape.r, maxx: shape.cx + shape.r, maxy: shape.cy + shape.r };
  }
  if (shape.type === 'square' || shape.type === 'rect') {
    return { minx: shape.x, miny: shape.y, maxx: shape.x + shape.w, maxy: shape.y + shape.h };
  }
  if (shape.type === 'triangle') {
    return {
      minx: Math.min(shape.x1, shape.x2, shape.x3),
      miny: Math.min(shape.y1, shape.y2, shape.y3),
      maxx: Math.max(shape.x1, shape.x2, shape.x3),
      maxy: Math.max(shape.y1, shape.y2, shape.y3),
    };
  }
  return { minx: 0, miny: 0, maxx: 0, maxy: 0 };
}

// Bounding box of a stroke (shape-aware).
export function strokeBounds(s) {
  if (s.shape) return shapeBounds(s.shape);
  const pts = s.points;
  if (!pts || !pts.length) return { minx: 0, miny: 0, maxx: 0, maxy: 0 };
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of pts) {
    if (p[0] < minx) minx = p[0];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[1] > maxy) maxy = p[1];
  }
  return { minx, miny, maxx, maxy };
}

function pointInTriangle(px, py, a, b, c) {
  const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const s2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  const s3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

// Is (x,y) within r of a structured shape's outline/fill?
function shapeNear(shape, x, y, r) {
  const bb = shapeBounds(shape);
  if (x < bb.minx - r || x > bb.maxx + r || y < bb.miny - r || y > bb.maxy + r) return false;
  if (shape.type === 'line') {
    return distToSeg(x, y, [shape.x1, shape.y1], [shape.x2, shape.y2]) <= r;
  }
  if (shape.type === 'circle') {
    const d = Math.abs(Math.hypot(x - shape.cx, y - shape.cy) - shape.r);
    return d <= r;
  }
  if (shape.type === 'square' || shape.type === 'rect') {
    // Inside the box, or near any edge.
    const inside = x >= shape.x - r && x <= shape.x + shape.w + r && y >= shape.y - r && y <= shape.y + shape.h + r;
    if (!inside) return false;
    const edges = [
      distToSeg(x, y, [shape.x, shape.y], [shape.x + shape.w, shape.y]),
      distToSeg(x, y, [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h]),
      distToSeg(x, y, [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]),
      distToSeg(x, y, [shape.x, shape.y + shape.h], [shape.x, shape.y]),
    ];
    return Math.min(...edges) <= r;
  }
  if (shape.type === 'triangle') {
    const a = [shape.x1, shape.y1];
    const b = [shape.x2, shape.y2];
    const c = [shape.x3, shape.y3];
    if (pointInTriangle(x, y, a, b, c)) return true;
    return Math.min(distToSeg(x, y, a, b), distToSeg(x, y, b, c), distToSeg(x, y, c, a)) <= r;
  }
  return false;
}

// Is (x,y) inside a shape's filled area? (lines have no fill.)
function shapeContains(shape, x, y) {
  if (shape.type === 'circle') return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
  if (shape.type === 'square' || shape.type === 'rect') return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  if (shape.type === 'triangle') return pointInTriangle(x, y, [shape.x1, shape.y1], [shape.x2, shape.y2], [shape.x3, shape.y3]);
  return false;
}

// Hit test for the select tool: a shape is picked when the point is inside its
// fill or near its outline; freeform strokes are picked when near their points.
export function strokeHitSelect(s, x, y, r) {
  if (s.shape) return shapeContains(s.shape, x, y) || shapeNear(s.shape, x, y, r);
  return strokeNear(s, x, y, r);
}

// Translate a stroke (shape-aware). Returns a new stroke.
export function moveStroke(s, dx, dy) {
  if (s.shape) {
    const sh = { ...s.shape };
    if (sh.type === 'line') {
      sh.x1 += dx; sh.y1 += dy; sh.x2 += dx; sh.y2 += dy;
    } else if (sh.type === 'circle') {
      sh.cx += dx; sh.cy += dy;
    } else if (sh.type === 'square' || sh.type === 'rect') {
      sh.x += dx; sh.y += dy;
    } else if (sh.type === 'triangle') {
      sh.x1 += dx; sh.y1 += dy; sh.x2 += dx; sh.y2 += dy; sh.x3 += dx; sh.y3 += dy;
    }
    return { ...s, shape: sh, points: shapeToPoints(sh) };
  }
  return { ...s, points: s.points.map((p) => [p[0] + dx, p[1] + dy, p[2]]) };
}

// Resize a stroke by dragging one of its handles to a new page position.
export function resizeStroke(s, handleId, p) {
  if (s.shape) {
    const sh = { ...s.shape };
    if (sh.type === 'line') {
      if (handleId === 'p1') { sh.x1 = p.x; sh.y1 = p.y; }
      else if (handleId === 'p2') { sh.x2 = p.x; sh.y2 = p.y; }
    } else if (sh.type === 'circle') {
      sh.r = Math.max(2, Math.hypot(p.x - sh.cx, p.y - sh.cy));
    } else if (sh.type === 'square' || sh.type === 'rect') {
      const right = sh.x + sh.w;
      const bottom = sh.y + sh.h;
      if (handleId === 'br') { sh.w = Math.max(4, p.x - sh.x); sh.h = Math.max(4, p.y - sh.y); }
      else if (handleId === 'tl') { sh.x = Math.min(p.x, right - 4); sh.y = Math.min(p.y, bottom - 4); sh.w = right - sh.x; sh.h = bottom - sh.y; }
      else if (handleId === 'tr') { sh.w = Math.max(4, p.x - sh.x); sh.y = Math.min(p.y, bottom - 4); sh.h = bottom - sh.y; }
      else if (handleId === 'bl') { sh.x = Math.min(p.x, right - 4); sh.w = right - sh.x; sh.h = Math.max(4, p.y - sh.y); }
    } else if (sh.type === 'triangle') {
      if (handleId === 'v1') { sh.x1 = p.x; sh.y1 = p.y; }
      else if (handleId === 'v2') { sh.x2 = p.x; sh.y2 = p.y; }
      else if (handleId === 'v3') { sh.x3 = p.x; sh.y3 = p.y; }
    }
    return { ...s, shape: sh, points: shapeToPoints(sh) };
  }
  // Freeform: scale the bounding box about the opposite corner.
  const bb = strokeBounds(s);
  const anchors = {
    br: [bb.minx, bb.miny],
    tl: [bb.maxx, bb.maxy],
    tr: [bb.minx, bb.maxy],
    bl: [bb.maxx, bb.miny],
  };
  const [ax, ay] = anchors[handleId] || [bb.minx, bb.miny];
  const sx = bb.maxx - bb.minx || 1;
  const sy = bb.maxy - bb.miny || 1;
  const nsx = Math.max(0.15, (p.x - ax) / sx);
  const nsy = Math.max(0.15, (p.y - ay) / sy);
  return { ...s, points: s.points.map((pt) => [ax + (pt[0] - ax) * nsx, ay + (pt[1] - ay) * nsy, pt[2]]) };
}

// The draggable resize handles for a stroke (page coordinates).
export function getHandles(s) {
  const sh = s.shape;
  if (sh) {
    if (sh.type === 'line') return [{ id: 'p1', x: sh.x1, y: sh.y1 }, { id: 'p2', x: sh.x2, y: sh.y2 }];
    if (sh.type === 'circle') return [{ id: 'r', x: sh.cx + sh.r, y: sh.cy }];
    if (sh.type === 'square' || sh.type === 'rect')
      return [
        { id: 'tl', x: sh.x, y: sh.y },
        { id: 'tr', x: sh.x + sh.w, y: sh.y },
        { id: 'br', x: sh.x + sh.w, y: sh.y + sh.h },
        { id: 'bl', x: sh.x, y: sh.y + sh.h },
      ];
    if (sh.type === 'triangle')
      return [
        { id: 'v1', x: sh.x1, y: sh.y1 },
        { id: 'v2', x: sh.x2, y: sh.y2 },
        { id: 'v3', x: sh.x3, y: sh.y3 },
      ];
  }
  const bb = strokeBounds(s);
  return [
    { id: 'tl', x: bb.minx, y: bb.miny },
    { id: 'tr', x: bb.maxx, y: bb.miny },
    { id: 'br', x: bb.maxx, y: bb.maxy },
    { id: 'bl', x: bb.minx, y: bb.maxy },
  ];
}
