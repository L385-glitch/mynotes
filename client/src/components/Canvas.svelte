<script>
  import { onMount, tick } from 'svelte';
  import { drawStroke, drawTextItem, backgroundCanvas, strokeNear, strokeHitSelect, textBounds, textAt, eraseBrush, uid, correctStroke, moveStroke, resizeStroke, getHandles, strokeBounds } from '../lib/engine/ink.js';
  import { renderPdfPage, getPdfTextLayout } from '../lib/pdf.js';

  // Renders a single page at a shared zoom level. Panning/zooming are handled by
  // the parent (the editor scrolls a vertical stack of these sheets); this
  // component only draws its page and captures ink/text/eraser input.
  let {
    page,
    tool = 'pen',
    color = '#1f2937',
    size = 3,
    eraserMode = 'brush',
    dark = false,
    zoom = 1,
    onContentChange,
    onActive,
    onRegister,
    onZoomRequest,
  } = $props();

  let containerEl = $state(null);
  let canvasEl = $state(null);
  let textEl = $state(null);
  let contentCanvas = null;
  let pdfCanvas = null;
  let pdfTextLines = [];

  let strokes = $state([]);
  let texts = $state([]);
  let live = null;
  let editing = $state(null);
  let selected = $state(null);
  let selStroke = $state(null);
  let eraserPos = null;

  let dpr = 1;
  let ready = false;

  const RES = 2;
  const pointers = new Map();
  let gesture = null;
  let rafPending = false;
  const undoStack = [];
  const redoStack = [];
  let currentPageId = null;
  let saveTimer = null;
  let dirty = false;
  let holdTimer = null;

  $effect(() => {
    const p = page;
    clearHoldTimer();
    if (!p) {
      if (editing) commitEdit();
      if (currentPageId != null) flushSave(currentPageId);
      strokes = [];
      texts = [];
      live = null;
      editing = null;
      selected = null;
      selStroke = null;
      eraserPos = null;
      pdfCanvas = null;
      pdfTextLines = [];
      currentPageId = null;
      return;
    }
    if (p.id === currentPageId) return;
    // Page is changing: commit any pending text edit and save the OLD page's
    // content to the OLD page id (strokes/texts still hold the old content
    // until we reset them below).
    if (editing) commitEdit();
    if (currentPageId != null) flushSave(currentPageId);
    currentPageId = p.id;
    strokes = (p.content?.strokes ?? []).map((s) => ({ ...s, id: s.id ?? uid() }));
    texts = (p.content?.texts ?? []).map((t) => ({ ...t, id: t.id ?? uid() }));
    live = null;
    editing = null;
    selected = null;
    selStroke = null;
    eraserPos = null;
    pdfCanvas = null;
    pdfTextLines = [];
    undoStack.length = 0;
    redoStack.length = 0;
    ensureContentCanvas();
    renderContent();
    resize();
    requestDraw();
    if (p.background === 'pdf' && p.pdfId != null) {
      renderPdfPage(p.pdfId, (p.pdfPage ?? 0) + 1, RES)
        .then((c) => {
          if (page?.id !== p.id) return;
          pdfCanvas = c;
          renderContent();
          requestDraw();
        })
        .catch((e) => console.error('pdf render failed', e));
      getPdfTextLayout(p.pdfId, (p.pdfPage ?? 0) + 1)
        .then((lines) => {
          if (page?.id !== p.id) return;
          pdfTextLines = lines;
        })
        .catch((e) => console.error('pdf text layout failed', e));
    }
  });

  $effect(() => {
    const s = strokes;
    const t = texts;
    const bg = page?.background;
    if (!contentCanvas) return;
    renderContent();
    requestDraw();
  });

  // Redraw the surrounding background when the light/dark theme changes.
  $effect(() => {
    void dark;
    requestDraw();
  });

  // Leaving the text tool clears any selection and commits a pending edit.
  // Leaving the select tool clears the stroke selection.
  $effect(() => {
    if (tool !== 'text') {
      selected = null;
      if (editing) commitEdit();
    }
    if (tool !== 'select') selStroke = null;
  });

  // Re-size the backing canvas whenever the shared zoom changes.
  $effect(() => {
    void zoom;
    resize();
    requestDraw();
  });

  function ensureContentCanvas() {
    const w = Math.max(1, Math.round(page.width * RES));
    const h = Math.max(1, Math.round(page.height * RES));
    if (!contentCanvas || contentCanvas.width !== w || contentCanvas.height !== h) {
      contentCanvas = document.createElement('canvas');
      contentCanvas.width = w;
      contentCanvas.height = h;
    }
  }

  function renderContent() {
    if (!contentCanvas || !page) return;
    const ctx = contentCanvas.getContext('2d');
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.clearRect(0, 0, page.width, page.height);
    if (page.background === 'pdf') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, page.width, page.height);
      if (pdfCanvas) ctx.drawImage(pdfCanvas, 0, 0, page.width, page.height);
    } else {
      ctx.drawImage(
        backgroundCanvas(page.background, page.width, page.height, RES),
        0,
        0,
        page.width,
        page.height
      );
    }
    for (const s of strokes) drawStroke(ctx, s);
    for (const t of texts) if (editing?.id !== t.id) drawTextItem(ctx, t);
  }

  function requestDraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      draw();
    });
  }

  function draw() {
    if (!canvasEl || !page || !ready) return;
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width;
    const H = canvasEl.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#e9e6df';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const k = dpr * zoom;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 24 / zoom;
    ctx.shadowOffsetY = 5 / zoom;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.restore();
    if (contentCanvas) ctx.drawImage(contentCanvas, 0, 0, page.width, page.height);
    if (live) drawStroke(ctx, live, true);
    if (selStroke) {
      const s = strokes.find((o) => o.id === selStroke);
      if (s) drawSelection(ctx, s);
    }
    if (tool === 'eraser' && eraserPos) {
      ctx.save();
      ctx.strokeStyle = 'rgba(31,41,55,0.65)';
      ctx.lineWidth = 1.5 / zoom;
      const r = eraserRadius();
      ctx.beginPath();
      ctx.arc(eraserPos.x, eraserPos.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Dashed bounding box + resize handles for the selected stroke.
  function drawSelection(ctx, s) {
    const bb = strokeBounds(s);
    const pad = 4 / zoom;
    const x = bb.minx - pad;
    const y = bb.miny - pad;
    const w = bb.maxx - bb.minx + pad * 2;
    const h = bb.maxy - bb.miny + pad * 2;
    ctx.save();
    ctx.strokeStyle = '#4f7cff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    const hs = 8 / zoom;
    for (const hd of getHandles(s)) {
      ctx.beginPath();
      ctx.rect(hd.x - hs / 2, hd.y - hs / 2, hs, hs);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Eraser footprint in page units, scaled by the brush size.
  function eraserRadius() {
    return size / zoom + 3;
  }

  // Size the backing canvas to the page at the current zoom (no pan offset).
  function resize() {
    if (!canvasEl || !page) return;
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(page.width * zoom));
    const h = Math.max(1, Math.round(page.height * zoom));
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
    requestDraw();
  }

  function toPage(e) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  }

  // Auto shape correction: while the pen is down, 1s without new points snaps
  // the live stroke to the nearest line/circle/square/triangle. The raw drawn
  // points are kept in live.rawPoints (source of truth); if the user keeps
  // drawing after a correction we revert to the raw points and re-arm.
  function armHoldTimer() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      correctLive();
    }, 1000);
  }

  function clearHoldTimer() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function correctLive() {
    if (!live || live.shape || live.tool !== 'pen' || live.rawPoints.length < 4) return;
    const res = correctStroke(live.rawPoints);
    if (res) {
      live.shape = res.shape;
      live.points = res.points;
      requestDraw();
    }
  }

  // Select tool: pick a stroke (topmost wins) or grab one of the selected
  // stroke's resize handles.
  function selectDown(p, e) {
    if (selStroke) {
      const s = strokes.find((o) => o.id === selStroke);
      if (s) {
        const h = getHandles(s).find((h) => Math.hypot(p.x - h.x, p.y - h.y) < 10 / zoom);
        if (h) {
          gesture = { type: 'resize-stroke', id: s.id, handle: h.id, orig: s, started: false };
          return;
        }
      }
    }
    const hit = [...strokes].reverse().find((s) => strokeHitSelect(s, p.x, p.y, 8 / zoom));
    if (hit) {
      selStroke = hit.id;
      gesture = { type: 'maybe-move-stroke', id: hit.id, startX: e.clientX, startY: e.clientY, orig: hit };
    } else {
      selStroke = null;
    }
    requestDraw();
  }

  function onPointerDown(e) {
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button !== 0) return;
    if (editing) commitEdit();
    canvasEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onActive?.(page?.id);
    if (pointers.size === 2) {
      if (live) {
        live = null;
        requestDraw();
      }
      eraserPos = null;
      const [a, b] = [...pointers.values()];
      gesture = {
        type: 'pinch',
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom0: zoom,
      };
      return;
    }
    const p = toPage(e);
    if (tool === 'select') {
      selectDown(p, e);
      return;
    }
    if (tool === 'text') {
      // Cancel the pointerdown so the browser doesn't fire the compatibility
      // mousedown event — its default action would steal focus from the
      // freshly-focused text overlay and immediately blur (commit) it.
      e.preventDefault();
      if (editing) commitEdit();
      // Hit-test existing text (topmost = last in the array wins).
      const hit = [...texts].reverse().find((t) => textAt(t, p.x, p.y));
      if (hit) {
        const b = textBounds(hit);
        const hx = b.x + b.w;
        const hy = b.y + b.h;
        if (Math.hypot(p.x - hx, p.y - hy) < 14 / zoom) {
          // Bottom-right corner → resize (width + font size).
          selected = hit.id;
          gesture = { type: 'resize-text', id: hit.id, origW: hit.w || 320, origSize: hit.size, startPage: p, started: false };
        } else {
          // Body → select, and a potential drag-to-move.
          selected = hit.id;
          gesture = { type: 'maybe-move-text', id: hit.id, startX: e.clientX, startY: e.clientY, origX: hit.x, origY: hit.y };
        }
      } else if (selected) {
        selected = null;
        requestDraw();
      } else {
        startTextEdit(p.x, p.y);
      }
    } else if (tool === 'eraser') {
      gesture = { type: 'erase' };
      eraserPos = p;
      eraseAt(p.x, p.y);
      requestDraw();
    } else {
      clearHoldTimer();
      const rawPoints = [[p.x, p.y, e.pressure || 0.5]];
      live = {
        id: uid(),
        tool,
        color,
        size: tool === 'highlighter' ? size * 5 : size,
        rawPoints,
        points: rawPoints,
        shape: null,
      };
      requestDraw();
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d1 = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      onZoomRequest?.(gesture.zoom0 * (d1 / gesture.d0));
      return;
    }
    if (gesture?.type === 'maybe-move-stroke' || gesture?.type === 'move-stroke') {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (gesture.type === 'maybe-move-stroke') {
        if (Math.hypot(dx, dy) < 3) return;
        pushUndo();
        gesture = { ...gesture, type: 'move-stroke' };
      }
      const s = strokes.find((o) => o.id === gesture.id);
      if (s) {
        const moved = moveStroke(gesture.orig, dx / zoom, dy / zoom);
        strokes = strokes.map((o) => (o.id === s.id ? moved : o));
        requestDraw();
      }
      return;
    }
    if (gesture?.type === 'resize-stroke') {
      const s = strokes.find((o) => o.id === gesture.id);
      if (s) {
        if (!gesture.started) {
          pushUndo();
          gesture = { ...gesture, started: true };
        }
        const p = toPage(e);
        const resized = resizeStroke(gesture.orig, gesture.handle, p);
        strokes = strokes.map((o) => (o.id === s.id ? resized : o));
        requestDraw();
      }
      return;
    }
    if (gesture?.type === 'erase') {
      const p = toPage(e);
      eraserPos = p;
      eraseAt(p.x, p.y);
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-move-text' || gesture?.type === 'move-text') {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (gesture.type === 'maybe-move-text') {
        if (Math.hypot(dx, dy) < 3) return;
        pushUndo();
        gesture = { ...gesture, type: 'move-text' };
      }
      const t = texts.find((o) => o.id === gesture.id);
      if (t) {
        const nx = gesture.origX + dx / zoom;
        const ny = gesture.origY + dy / zoom;
        texts = texts.map((o) => (o.id === t.id ? { ...t, x: nx, y: ny } : o));
        requestDraw();
      }
      return;
    }
    if (gesture?.type === 'resize-text') {
      const t = texts.find((o) => o.id === gesture.id);
      if (t) {
        if (!gesture.started) {
          pushUndo();
          gesture = { ...gesture, started: true };
        }
        const p = toPage(e);
        const w = Math.max(60, gesture.origW + (p.x - gesture.startPage.x));
        const sz = Math.max(8, gesture.origSize + (p.y - gesture.startPage.y) * 0.25);
        texts = texts.map((o) => (o.id === t.id ? { ...t, w, size: sz } : o));
        requestDraw();
      }
      return;
    }
    if (live) {
      const events = e.getCoalescedEvents?.() || [e];
      let added = false;
      for (const ev of events) {
        const p = toPage(ev);
        const last = live.rawPoints[live.rawPoints.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.4) continue;
        live.rawPoints.push([p.x, p.y, ev.pressure || 0.5]);
        added = true;
      }
      if (added) {
        // A new point means the user is still drawing: undo any correction so
        // the stroke follows the hand again, then re-arm the hold timer.
        if (live.shape) {
          live.shape = null;
          live.points = live.rawPoints;
        }
        if (live.tool === 'pen') armHoldTimer();
        requestDraw();
      }
    }
  }

  // Turn a highlighter swipe into clean rectangles snapped to the PDF text lines
  // it crosses. Returns an array of {x,y,w,h} (page coords) or null to keep the
  // freeform stroke (no text under the swipe / swipe too small).
  function highlightRectsFor(points, lines) {
    if (!lines.length) return null;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of points) {
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
    if (maxx - minx < 3) return null;
    const rects = [];
    for (const line of lines) {
      if (line.y >= maxy || line.y + line.h <= miny) continue;
      const x = Math.max(line.x, minx);
      const right = Math.min(line.x + line.w, maxx);
      if (right - x < 2) continue;
      rects.push({ x, y: line.y, w: right - x, h: line.h });
    }
    return rects.length ? rects : null;
  }

  function onPointerEnd(e) {
    pointers.delete(e.pointerId);
    if (gesture?.type === 'pinch' && pointers.size < 2) {
      gesture = null;
      eraserPos = null;
      requestDraw();
      return;
    }
    if (gesture?.type === 'move-stroke' || gesture?.type === 'resize-stroke') {
      gesture = null;
      scheduleSave(page?.id);
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-move-stroke') {
      gesture = null;
      return;
    }
    if (gesture?.type === 'erase') {
      if (pointers.size === 0) {
        gesture = null;
        eraserPos = null;
        requestDraw();
      }
      return;
    }
    if (gesture?.type === 'move-text' || gesture?.type === 'resize-text') {
      gesture = null;
      scheduleSave(page?.id);
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-move-text') {
      // Plain click on the text body: keep it selected, no move occurred.
      gesture = null;
      return;
    }
    if (live) {
      clearHoldTimer();
      if (live.rawPoints.length > 0) {
        pushUndo();
        const isPdfHighlight = live.tool === 'highlighter' && page?.background === 'pdf' && page.pdfId != null;
        const rects = isPdfHighlight ? highlightRectsFor(live.rawPoints, pdfTextLines) : null;
        if (rects) {
          const snapped = rects.map((r) => ({ id: uid(), tool: 'highlighter', color: live.color, size: live.size, shape: { type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h } }));
          strokes = [...strokes, ...snapped];
        } else {
          const committed = { ...live };
          delete committed.rawPoints;
          strokes = [...strokes, committed];
        }
        scheduleSave(page?.id);
      }
      live = null;
      requestDraw();
    }
  }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onZoomRequest?.(zoom * Math.exp(-e.deltaY * 0.01));
    }
    // Non-ctrl wheel: let the parent scroll container handle it natively.
  }

  function eraseAt(x, y) {
    const r = eraserRadius();
    if (eraserMode === 'line') {
      // Whole-line: touching any part of a stroke erases the entire stroke.
      const keep = [];
      const removed = [];
      for (const s of strokes) (strokeNear(s, x, y, r) ? removed : keep).push(s);
      if (!removed.length) return;
      pushUndo();
      strokes = keep;
    } else {
      // Brush: erase only the points under the eraser, splitting strokes.
      const before = strokes.reduce((n, s) => n + s.points.length, 0);
      const next = eraseBrush(strokes, x, y, r);
      const after = next.reduce((n, s) => n + s.points.length, 0);
      if (after === before) return;
      pushUndo();
      strokes = next;
    }
    scheduleSave(page?.id);
  }

  // Double-click an existing text item to edit its contents in place.
  function onDoubleClick(e) {
    if (tool !== 'text') return;
    const p = toPage(e);
    const hit = [...texts].reverse().find((t) => textAt(t, p.x, p.y));
    if (!hit) return;
    selected = hit.id;
    editing = { ...hit };
    requestDraw();
    tick().then(() => textEl?.focus());
  }

  function startTextEdit(x, y) {
    const t = {
      id: uid(),
      x,
      y,
      w: 320,
      text: '',
      size: 18,
      color: color === '#ffffff' ? '#1f2937' : color,
    };
    pushUndo();
    texts = [...texts, t];
    editing = { ...t };
    selected = t.id;
    requestDraw();
    tick().then(() => textEl?.focus());
  }

  function commitEdit() {
    if (!editing) return;
    const id = editing.id;
    const text = editing.text;
    if (!text.trim()) {
      texts = texts.filter((t) => t.id !== id);
    } else {
      texts = texts.map((t) => (t.id === id ? { ...t, text } : t));
    }
    editing = null;
    scheduleSave(page?.id);
  }

  function pushUndo() {
    undoStack.push({ strokes, texts });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push({ strokes, texts });
    const s = undoStack.pop();
    strokes = s.strokes;
    texts = s.texts;
    scheduleSave(page?.id);
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push({ strokes, texts });
    const s = redoStack.pop();
    strokes = s.strokes;
    texts = s.texts;
    scheduleSave(page?.id);
  }

  // Delete the selected stroke (select tool only).
  function deleteSelectedStroke() {
    if (tool !== 'select' || !selStroke) return;
    pushUndo();
    strokes = strokes.filter((o) => o.id !== selStroke);
    selStroke = null;
    scheduleSave(page?.id);
    requestDraw();
  }

  function cancelSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  // Debounced autosave. The page id is captured at schedule time and re-checked
  // at fire time so a save can never land on the wrong page after a switch.
  function scheduleSave(pid) {
    if (pid == null) return;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    const content = { strokes, texts };
    saveTimer = setTimeout(() => {
      saveTimer = null;
      dirty = false;
      if (currentPageId !== pid) return; // page switched; flushSave already saved
      onContentChange?.(pid, content);
    }, 700);
  }

  // Immediate save of the current content (awaited by the caller before any
  // page switch). Returns a promise so switches can be serialized.
  function flushSave(pid = page?.id) {
    cancelSave();
    if (pid == null || !dirty) return Promise.resolve();
    dirty = false;
    return Promise.resolve(onContentChange?.(pid, { strokes, texts }));
  }

  function onDeleteKey(e) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (tool === 'select' && selStroke) {
      e.preventDefault();
      deleteSelectedStroke();
    }
  }

  onMount(() => {
    ready = true;
    resize();
    canvasEl?.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onDeleteKey);
    return () => {
      canvasEl?.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onDeleteKey);
      clearHoldTimer();
      cancelSave();
      if (dirty && currentPageId != null) flushSave(currentPageId);
    };
  });

  // Expose this page's imperative API to the editor (keyed by page id).
  $effect(() => {
    const id = page?.id;
    if (id != null) onRegister?.(id, { undo, redo, flushSave, commitEdit });
  });

  let editStyle = $derived(
    editing
      ? `left:${editing.x * zoom}px;top:${editing.y * zoom}px;width:${editing.w * zoom}px;height:${Math.max(48, editing.size * 2.7 * zoom)}px;font-size:${editing.size * zoom}px;line-height:${editing.size * 1.35 * zoom}px;color:${editing.color};`
      : ''
  );

  // Screen-space box of the selected text item (for the selection chrome).
  const selectedBox = $derived.by(() => {
    if (!selected || tool !== 'text' || editing) return null;
    const t = texts.find((o) => o.id === selected);
    if (!t) return null;
    const b = textBounds(t);
    return {
      left: b.x * zoom,
      top: b.y * zoom,
      width: b.w * zoom,
      height: b.h * zoom,
    };
  });
</script>

<div
  class="relative shrink-0"
  style="width:{page.width * zoom}px;height:{page.height * zoom}px"
  bind:this={containerEl}
>
  <canvas
    class="ink-canvas tool-{tool}"
    bind:this={canvasEl}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    ondblclick={onDoubleClick}
  ></canvas>
  {#if selectedBox}
    <div
      class="text-select-box"
      style="left:{selectedBox.left}px;top:{selectedBox.top}px;width:{selectedBox.width}px;height:{selectedBox.height}px;"
    >
      <div class="text-handle-resize"></div>
    </div>
  {/if}
  {#if editing}
    <textarea
      class="text-edit-overlay"
      bind:this={textEl}
      style={editStyle}
      placeholder="Type here…"
      bind:value={editing.text}
      onblur={commitEdit}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          commitEdit();
        }
        e.stopPropagation();
      }}
    ></textarea>
  {/if}
</div>
