<script>
  import { onMount, tick } from 'svelte';
  import { drawStroke, drawTextItem, backgroundCanvas, strokeNear, strokeHitSelect, textBounds, textAt, eraseBrush, uid, correctStroke, moveStroke, resizeStroke, getHandles, strokeBounds } from '../lib/engine/ink.js';
  import { renderPdfPage, getPdfTextLayout } from '../lib/pdf.js';
  import { trackMomentum, stopAllMomentum, penDownChange, pensDown } from '../lib/momentum.js';

  // Renders a single page at a shared zoom level. Panning/zooming are handled by
  // the parent (the editor scrolls a vertical stack of these sheets); this
  // component only draws its page and captures ink/text/eraser input.
  let {
    page,
    tool = 'pen',
    color = '#1f2937',
    size = 3,
    eraserSize = 10,
    eraserMode = 'brush',
    dark = false,
    zoom = 1,
    rendered = true,
    onContentChange,
    onActive,
    onRegister,
    onZoomRequest,
    onPinchStart,
    onPinchMove,
    onPinchEnd,
    onNeedRender,
    onTextSelect,
  } = $props();

  let containerEl = $state(null);
  let canvasEl = $state(null);
  let textEl = $state(null);
  let contentCanvas = null;
  let pdfCanvas = null;
  let pdfTextLines = [];

  // Plain (non-reactive) data: the template never renders strokes/texts
  // directly (the canvas draws them imperatively). Keeping them out of
  // Svelte's deep proxy makes autosave serialization ~7x faster (measured:
  // 619ms -> 87ms for a 5000-stroke page), so saves no longer stall the pen.
  // The rev counters provide the reactivity the few deriveds/effects that
  // read this data need.
  let strokes = [];
  let texts = [];
  let strokesRev = $state(0);
  let textsRev = $state(0);

  function setStrokes(v) {
    strokes = v;
    strokesRev++;
  }

  function setTexts(v) {
    texts = v;
    textsRev++;
  }
  let live = null;
  let editing = $state(null);
  let selected = $state(null);
  let selStroke = $state(null);
  let eraserPos = null;

  let ready = false;

  const RES = 2;
  const SAVE_INTERVAL = 2000;
  // Screen-space distance (px) below which a touch/click is a "tap" (select /
  // add text) rather than a drag (scroll / draw / move).
  const TAP_THRESHOLD = 6;
  const pointers = new Map();
  let gesture = null;
  let momentumRaf = null;
  let rafPending = false;
  let contentDirty = false;
  // Incremental pen drawing: once a pen stroke starts we blit the page content
  // to the display ONCE (liveBaseDrawn) and then append only the new segments
  // each frame (liveDrawnIdx = how many points are already on the display).
  // This avoids re-blitting the whole page + redrawing the entire stroke every
  // frame, which is what made the pen feel laggy.
  let liveBaseDrawn = false;
  let liveDrawnIdx = 0;
  const undoStack = [];
  const redoStack = [];
  let currentPageId = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let savePending = 0;
  let dirty = false;
  let holdTimer = null;
  let untrackMomentum = null;

  // Load a page's content and (re)build its canvases. Called when the page
  // changes and when the page scrolls back into the render window.
  function loadPage(p) {
    currentPageId = p.id;
    // Deep-copy to plain data: p.content comes from the proxied `pages` state,
    // and a shallow spread would keep the points/shape sub-arrays proxied,
    // which would make autosave serialization slow again.
    setStrokes(
      (p.content?.strokes ?? []).map((s) => ({
        ...s,
        id: s.id ?? uid(),
        points: s.points ? s.points.map((p) => [p[0], p[1], p[2]]) : undefined,
        shape: s.shape ? { ...s.shape } : undefined,
      }))
    );
    setTexts(
      (p.content?.texts ?? []).map((t) => ({
        ...t,
        id: t.id ?? uid(),
        border: t.border ? { ...t.border } : undefined,
      }))
    );
    live = null;
    liveBaseDrawn = false;
    liveDrawnIdx = 0;
    editing = null;
    selected = null;
    selStroke = null;
    eraserPos = null;
    pdfCanvas = null;
    pdfTextLines = [];
    undoStack.length = 0;
    redoStack.length = 0;
    if (rendered) {
      ensureContentCanvas();
      renderContent();
      resize();
      requestDraw();
      if (p.background === 'pdf' && p.pdfId != null) loadPdf(p);
    } else {
      releaseCanvases();
    }
  }

  function loadPdf(p) {
    renderPdfPage(p.pdfId, (p.pdfPage ?? 0) + 1, RES)
      .then((c) => {
        if (page?.id !== p.id || !rendered) return;
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

  // Free the (potentially large) backing canvases while this page is far
  // offscreen. The stroke/text data stays in memory so undo history survives.
  function releaseCanvases() {
    contentCanvas = null;
    pdfCanvas = null;
    pdfTextLines = [];
    if (canvasEl) {
      canvasEl.width = 1;
      canvasEl.height = 1;
    }
  }

  // Runs only when the page id or the render window actually changes. The
  // effect body reads other reactive state (e.g. `editing` via commitEdit),
  // so without this guard it would re-run on unrelated changes.
  let lastPageKey = null;
  $effect(() => {
    const p = page;
    const r = rendered;
    const key = p ? p.id + ':' + r : 'none';
    clearHoldTimer();
    if (key === lastPageKey) return;
    lastPageKey = key;
    if (!p) {
      if (editing) commitEdit();
      if (currentPageId != null) flushSave(currentPageId);
      setStrokes([]);
      setTexts([]);
      live = null;
      editing = null;
      selected = null;
      selStroke = null;
      eraserPos = null;
      pdfCanvas = null;
      pdfTextLines = [];
      currentPageId = null;
      releaseCanvases();
      return;
    }
    if (p.id !== currentPageId) {
      // Page is changing: commit any pending text edit and save the OLD page's
      // content to the OLD page id (strokes/texts still hold the old content
      // until we reset them below).
      if (editing) commitEdit();
      if (currentPageId != null) flushSave(currentPageId);
      loadPage(p);
      return;
    }
    // Same page, render window changed (scrolled in/out of view).
    if (r) {
      if (!contentCanvas) {
        ensureContentCanvas();
        renderContent();
      }
      resize();
      requestDraw();
      if (p.background === 'pdf' && p.pdfId != null && !pdfCanvas) loadPdf(p);
    } else {
      releaseCanvases();
    }
  });

  // Last committed arrays: lets the effect below tell a pure append (a stroke
  // commit on pen-up) apart from structural changes (erase, undo, move, ...).
  // Appends draw only the new strokes onto the existing content canvas, which
  // is O(new strokes) instead of O(all strokes) — a full re-render of a full
  // page of handwriting takes tens of ms and would stall the pen on every
  // pen-up.
  let prevStrokes = strokes;
  let prevTexts = texts;

  $effect(() => {
    void strokesRev;
    void textsRev;
    const s = strokes;
    const t = texts;
    const isAppend =
      t === prevTexts && s.length >= prevStrokes.length && prevStrokes.every((o, i) => s[i] === o);
    if (isAppend && contentCanvas) {
      const ctx = contentCanvas.getContext('2d');
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      for (let i = prevStrokes.length; i < s.length; i++) drawStroke(ctx, s[i]);
    } else {
      // Coalesce: mark the content canvas dirty and let the next rAF blit it,
      // so several updates in one frame cost a single re-render.
      contentDirty = true;
    }
    prevStrokes = s;
    prevTexts = t;
    requestDraw();
  });

  // Re-render the content canvas when the page's background changes (the page
  // object is replaced in place, so the page-id guard above doesn't catch it).
  $effect(() => {
    const bg = page?.background;
    if (!contentCanvas || !bg) return;
    renderContent();
    requestDraw();
  });

  // Redraw the surrounding background when the light/dark theme changes.
  $effect(() => {
    void dark;
    requestDraw();
  });

  // Switching away from the text tool commits a pending edit. Selections
  // (stroke or text) persist across tools: there is no select tool anymore,
  // a tap selects in any tool.
  $effect(() => {
    if (tool !== 'text' && editing) commitEdit();
  });

  // Report the selected text item (or null) to the editor so it can show
  // formatting controls for it.
  $effect(() => {
    const id = selected;
    void textsRev;
    const t = texts.find((o) => o.id === id) ?? null;
    onTextSelect?.(t ? { ...t } : null);
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
    if (!canvasEl || !page || !ready || !rendered) return;
    const ctx = canvasEl.getContext('2d');

    // A full redraw (clear + blit the whole page + draw the live stroke in
    // full) is needed when the content changed, when nothing is being drawn
    // (selection / eraser preview), or the first frame of a pen stroke. While
    // a pen stroke is in progress we skip all of that and only append the new
    // segments — see the incremental path below.
    // Only a plain (uncorrected) pen stroke can be drawn incrementally. A
    // shape-corrected live stroke (line/circle/square/triangle) or a
    // highlighter swipe must be redrawn in full.
    const penLive = live && live.tool === 'pen' && !live.shape;
    const needsFull = contentDirty || !penLive || !liveBaseDrawn;

    if (needsFull) {
      if (contentDirty) {
        contentDirty = false;
        renderContent();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      if (contentCanvas) ctx.drawImage(contentCanvas, 0, 0, page.width, page.height);
      if (live) {
        drawStroke(ctx, live);
        if (penLive) {
          liveBaseDrawn = true;
          liveDrawnIdx = live.points.length;
        }
      }
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
      return;
    }

    // Incremental pen drawing: the page content is already blitted and the
    // earlier segments are on the display, so draw only the new tail (a couple
    // of line segments). This is the per-frame cost while writing — tiny.
    if (live && liveDrawnIdx < live.points.length) {
      drawStroke(ctx, live, liveDrawnIdx);
      liveDrawnIdx = live.points.length;
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

  // Eraser footprint in page units, scaled by the (independent) eraser size.
  function eraserRadius() {
    return eraserSize / zoom + 3;
  }

  // Size the backing canvas to RES page units (independent of zoom). The
  // content canvas (RES x) is the highest-res source of truth and is blitted
  // here, so a larger canvas would only upscale it — on 3x phones a dpr-sized
  // canvas cost ~18MB per rendered A4 page for no visible gain. Zoom is a CSS
  // transform, so changing it never re-allocates this canvas.
  function resize() {
    if (!canvasEl || !page || !rendered) return;
    canvasEl.width = Math.max(1, Math.round(page.width * RES));
    canvasEl.height = Math.max(1, Math.round(page.height * RES));
    // Re-allocating the canvas clears it, so the incremental pen base is gone.
    liveBaseDrawn = false;
    liveDrawnIdx = 0;
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
      // The corrected shape replaces the raw points wholesale, so the
      // incremental pen base is invalid — force a full redraw next frame.
      liveBaseDrawn = false;
      liveDrawnIdx = 0;
      requestDraw();
    }
  }

  // Topmost stroke under a page point (null when none).
  function hitStroke(p) {
    return [...strokes].reverse().find((s) => strokeHitSelect(s, p.x, p.y, 8 / zoom)) ?? null;
  }

  // Topmost text item under a page point (null when none).
  function hitText(p) {
    return [...texts].reverse().find((t) => textAt(t, p.x, p.y)) ?? null;
  }

  // Resize handle of the currently selected stroke under a page point.
  function hitSelHandle(p) {
    if (!selStroke) return null;
    const s = strokes.find((o) => o.id === selStroke);
    if (!s) return null;
    return getHandles(s).find((h) => Math.hypot(p.x - h.x, p.y - h.y) < 10 / zoom) ?? null;
  }

  // Select a text item and arm a move/resize gesture based on where it was
  // touched (right/left border = resize width, top-left corner = move
  // immediately, body = potential drag-to-move).
  function textItemDown(p, e, hit) {
    const b = textBounds(hit);
    const edge = 14 / zoom;
    const inVertRange = p.y >= b.y - edge && p.y <= b.y + b.h + edge;
    const onRightEdge = p.x >= b.x + b.w - 2 && inVertRange;
    const onLeftEdge = p.x <= b.x + 2 && inVertRange;
    const cornerTL = Math.hypot(p.x - b.x, p.y - b.y) < edge;
    selected = hit.id;
    selStroke = null;
    if (onRightEdge) {
      gesture = { type: 'resize-text', side: 'right', id: hit.id, origW: hit.w || 320, startPage: p, started: false };
    } else if (cornerTL) {
      gesture = { type: 'maybe-move-text', id: hit.id, startX: e.clientX, startY: e.clientY, origX: hit.x, origY: hit.y, threshold: 0 };
    } else if (onLeftEdge) {
      gesture = { type: 'resize-text', side: 'left', id: hit.id, origX: hit.x, origW: hit.w || 320, startPage: p, started: false };
    } else {
      gesture = { type: 'maybe-move-text', id: hit.id, startX: e.clientX, startY: e.clientY, origX: hit.x, origY: hit.y };
    }
    requestDraw();
  }

  // Text tool: tap an existing item to select/move/resize it, tap empty space
  // to start a new one.
  function textDown(p, e) {
    e.preventDefault();
    if (editing) commitEdit();
    const hit = hitText(p);
    if (hit) {
      textItemDown(p, e, hit);
    } else if (selected) {
      selected = null;
      requestDraw();
    } else {
      startTextEdit(p.x, p.y);
    }
  }

  // Begin a freehand stroke with the active ink tool.
  function startDraw(p, e) {
    clearHoldTimer();
    const rawPoints = [[p.x, p.y, e.pressure || 0.5]];
    live = {
      id: uid(),
      pointerId: e.pointerId,
      tool,
      color,
      size: tool === 'highlighter' ? size * 5 : size,
      rawPoints,
      points: rawPoints,
      shape: null,
    };
    liveBaseDrawn = false;
    liveDrawnIdx = 0;
    requestDraw();
  }

  // Finger (touch): navigate the page and select objects. There is no hand or
  // select tool anymore — one finger scrolls (or moves/resizes a selected
  // object) and a tap on an object selects it, in any tool.
  function touchDown(p, e) {
    const handle = hitSelHandle(p);
    if (handle) {
      const s = strokes.find((o) => o.id === selStroke);
      gesture = { type: 'resize-stroke', id: s.id, handle: handle.id, orig: s, started: false };
      return;
    }
    if (selStroke) {
      const s = strokes.find((o) => o.id === selStroke);
      if (s && strokeHitSelect(s, p.x, p.y, 8 / zoom)) {
        // A finger drag on the selected stroke moves it (not scrolls).
        gesture = { type: 'maybe-move-stroke', id: s.id, startX: e.clientX, startY: e.clientY, orig: s };
        return;
      }
    }
    const t = hitText(p);
    if (t) {
      textItemDown(p, e, t);
      return;
    }
    const s = hitStroke(p);
    if (s) {
      // Tap selects the stroke; a drag scrolls the page instead.
      gesture = { type: 'maybe-select-or-scroll', id: s.id, startX: e.clientX, startY: e.clientY };
      return;
    }
    // Empty space: tap deselects (or starts a text field with the text tool);
    // a drag scrolls the page.
    if (tool === 'text') {
      gesture = { type: 'maybe-add-text-or-scroll', startX: e.clientX, startY: e.clientY, page: p };
    } else {
      gesture = { type: 'maybe-scroll', startX: e.clientX, startY: e.clientY };
    }
  }

  // Stylus or mouse: run the active tool. The mouse additionally selects
  // objects on a tap/click (the select tool is gone); the stylus only draws.
  function toolDown(p, e, allowSelect) {
    if (allowSelect) {
      const handle = hitSelHandle(p);
      if (handle) {
        const s = strokes.find((o) => o.id === selStroke);
        gesture = { type: 'resize-stroke', id: s.id, handle: handle.id, orig: s, started: false };
        return;
      }
      if (selStroke) {
        const s = strokes.find((o) => o.id === selStroke);
        if (s && strokeHitSelect(s, p.x, p.y, 8 / zoom)) {
          gesture = { type: 'maybe-move-stroke', id: s.id, startX: e.clientX, startY: e.clientY, orig: s };
          return;
        }
      }
      const t = hitText(p);
      if (t) {
        textItemDown(p, e, t);
        return;
      }
      const s = hitStroke(p);
      if (s) {
        // Click selects the stroke; a drag still draws on top of it.
        gesture = { type: 'maybe-select-or-draw', id: s.id, startX: e.clientX, startY: e.clientY, page: p };
        return;
      }
    }
    if (tool === 'text') {
      textDown(p, e);
    } else if (tool === 'eraser') {
      gesture = { type: 'erase', pointerId: e.pointerId };
      eraserPos = p;
      eraseAt(p.x, p.y);
      requestDraw();
    } else if (allowSelect) {
      // Mouse on empty space (no object under the cursor): a tap deselects
      // (there is no select tool anymore); a drag still draws.
      gesture = { type: 'maybe-deselect-or-draw', startX: e.clientX, startY: e.clientY, page: p };
    } else {
      startDraw(p, e);
    }
  }

  // Nearest scrollable ancestor (the editor's page list).
  function scrollAncestor() {
    let el = canvasEl?.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  // One-finger scroll has no native momentum (touch-action is none), so we add
  // a little inertia: on release, keep scrolling with the finger's velocity,
  // decaying it over ~a second. GoodNotes-style feel.
  function stopMomentum() {
    if (momentumRaf) {
      cancelAnimationFrame(momentumRaf);
      momentumRaf = null;
    }
  }
  function startMomentum(fingerVy) {
    stopMomentum();
    const sc = scrollAncestor();
    if (!sc) return;
    // Cap the fling speed so a fast flick can't launch the page, and decay it
    // fast (~1s) so the scroll settles quickly. Touching down stops it
    // instantly (stopMomentum on pointerdown), so the user can brake anytime.
    let velocity = Math.max(-5, Math.min(5, fingerVy)); // px per ms
    if (Math.abs(velocity) < 0.05) return;
    let last = performance.now();
    function step(now) {
      const dt = Math.min(64, now - last);
      last = now;
      sc.scrollTop -= velocity * dt;
      velocity *= Math.pow(0.9, dt / 16.67);
      if (Math.abs(velocity) < 0.01) {
        momentumRaf = null;
        return;
      }
      momentumRaf = requestAnimationFrame(step);
    }
    momentumRaf = requestAnimationFrame(step);
  }

  function onPointerDown(e) {
    const isMouse = e.pointerType === 'mouse';
    const isTouch = e.pointerType === 'touch';
    const isPen = e.pointerType === 'pen';
    if (isMouse && e.button !== 0) return;
    // Any finger/pen down brakes the scroll — including momentum started by a
    // fast flick on ANOTHER page's canvas (they all share one scroll container).
    stopAllMomentum();

    // Palm rejection: while the pen is down (or a stroke is in progress), a
    // touch is the writing hand resting on the screen. Ignore it entirely so it
    // can't kill the stroke, start a pinch, or scroll the page.
    if (isTouch && (live || pensDown() > 0)) return;

    // Pen down: the resting hand's touch (if any) is no longer a gesture — drop
    // it and the gesture it started, then run the tool.
    if (isPen) {
      penDownChange(1);
      for (const [id, p] of [...pointers]) if (p.type === 'touch') pointers.delete(id);
      if (
        gesture &&
        (gesture.type === 'maybe-scroll' ||
          gesture.type === 'maybe-select-or-scroll' ||
          gesture.type === 'maybe-add-text-or-scroll' ||
          gesture.type === 'pan')
      ) {
        gesture = null;
        canvasEl.classList.remove('panning');
      }
      // Pen down during a pinch: the fingers are the resting hand, not a zoom.
      if (gesture?.type === 'pinch') {
        gesture = null;
        eraserPos = null;
        onPinchEnd?.();
      }
    }

    if (!rendered) onNeedRender?.(page?.id);
    if (editing) commitEdit();
    canvasEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    onActive?.(page?.id);

    // Two-finger touch: pinch-zoom + two-finger pan. The editor locks the
    // scroll container for the whole gesture so the view can't jump to another
    // page mid-zoom. Only two TOUCH pointers pinch: a pen + the writing hand
    // must never zoom (the touch would have been rejected above anyway).
    if (pointers.size === 2 && [...pointers.values()].every((p) => p.type === 'touch')) {
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
      onPinchStart?.({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      return;
    }

    const p = toPage(e);
    if (isTouch) {
      touchDown(p, e);
      return;
    }
    // Stylus: only the active tool. Mouse: active tool + tap/click selects.
    toolDown(p, e, isMouse);
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: prev?.type ?? e.pointerType });
    // Tap-or-drag gestures: once the finger/cursor moves past the tap
    // threshold, commit to the drag action (scroll for touch, draw for mouse)
    // instead of the tap action (select / add text).
    if (
      gesture &&
      (gesture.type === 'maybe-scroll' ||
        gesture.type === 'maybe-select-or-scroll' ||
        gesture.type === 'maybe-add-text-or-scroll' ||
        gesture.type === 'maybe-select-or-draw' ||
        gesture.type === 'maybe-deselect-or-draw')
    ) {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.hypot(dx, dy) < TAP_THRESHOLD) return;
      if (pensDown() > 0 && pointers.get(e.pointerId)?.type === 'touch') {
        // The finger is the writing hand drifting while the pen draws: it must
        // not turn into a page scroll.
        gesture = null;
        return;
      }
      if (gesture.type === 'maybe-select-or-draw' || gesture.type === 'maybe-deselect-or-draw') {
        // Mouse: the drag draws a new stroke starting where the user pressed.
        const startPage = gesture.page;
        gesture = null;
        startDraw(startPage ?? toPage(e), e);
        return;
      }
      // Touch: the drag scrolls the page (a tap would have selected / added).
      gesture = { type: 'pan', lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vy: 0 };
      canvasEl.classList.add('panning');
      return;
    }
    if (gesture?.type === 'pan') {
      if (pensDown() > 0) {
        // The pen came down mid-pan: the finger is now the resting hand.
        gesture = null;
        canvasEl.classList.remove('panning');
        return;
      }
      const sc = scrollAncestor();
      if (sc) {
        sc.scrollLeft -= e.clientX - gesture.lastX;
        sc.scrollTop -= e.clientY - gesture.lastY;
      }
      // Track the finger's velocity so we can fling with momentum on release.
      const now = performance.now();
      const dt = now - (gesture.lastT || now);
      if (dt > 0) gesture.vy = (e.clientY - gesture.lastY) / dt;
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
      gesture.lastT = now;
      return;
    }
    if (gesture?.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d1 = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      // Report the absolute zoom plus the pinch midpoint: the editor anchors
      // the zoom at the midpoint and scrolls by its movement (two-finger pan).
      onPinchMove?.(gesture.zoom0 * (d1 / gesture.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
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
        setStrokes(strokes.map((o) => (o.id === s.id ? moved : o)));
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
        setStrokes(strokes.map((o) => (o.id === s.id ? resized : o)));
        requestDraw();
      }
      return;
    }
    if (gesture?.type === 'erase' && gesture.pointerId === e.pointerId) {
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
        if (Math.hypot(dx, dy) < (gesture.threshold ?? 3)) return;
        pushUndo();
        gesture = { ...gesture, type: 'move-text' };
      }
      const t = texts.find((o) => o.id === gesture.id);
      if (t) {
        const nx = gesture.origX + dx / zoom;
        const ny = gesture.origY + dy / zoom;
        setTexts(texts.map((o) => (o.id === t.id ? { ...t, x: nx, y: ny } : o)));
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
        const dx = p.x - gesture.startPage.x;
        if (gesture.side === 'left') {
          // Drag the left border: move x, keep the right edge anchored.
          const right = gesture.origX + gesture.origW;
          const nx = Math.max(0, Math.min(right - 60, gesture.origX + dx));
          setTexts(texts.map((o) => (o.id === t.id ? { ...t, x: nx, w: right - nx } : o)));
        } else {
          // Drag the right border / corner: only the width changes. The font
          // size is independent (adjusted via the Text formatting row).
          const w = Math.max(60, gesture.origW + dx);
          setTexts(texts.map((o) => (o.id === t.id ? { ...t, w } : o)));
        }
        requestDraw();
      }
      return;
    }
    if (live && live.pointerId === e.pointerId) {
      // Capture every sample the pen delivered this frame. getCoalescedEvents()
      // returns the full batch (including the current event) in most browsers,
      // but WebKit can return an EMPTY array for a non-coalesced event. The old
      // `|| [e]` fallback never fired for that case because [] is truthy, so the
      // sample was silently dropped — the pen felt laggy and fast strokes lost
      // points. Guard against the empty array explicitly.
      const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [e];
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
          // Back to raw points: the display currently shows the corrected
          // shape, so drop the incremental base and redraw the whole stroke.
          liveBaseDrawn = false;
          liveDrawnIdx = 0;
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
    const wasTracked = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (e.pointerType === 'pen' && wasTracked) penDownChange(-1);
    // A touch that was rejected as the writing hand owns no gesture: its lift
    // must not commit the pen's live stroke or end an eraser swipe.
    if (!wasTracked) return;
    if (gesture?.type === 'pan') {
      const vy = gesture.vy || 0;
      gesture = null;
      canvasEl.classList.remove('panning');
      startMomentum(vy);
      return;
    }
    // Tap (no drag) on a tap-or-drag gesture: commit the tap action.
    if (gesture?.type === 'maybe-scroll') {
      // Tap on empty space: clear any selection.
      gesture = null;
      selected = null;
      selStroke = null;
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-select-or-scroll' || gesture?.type === 'maybe-select-or-draw') {
      // Tap on a stroke: select it (and drop any text selection).
      const id = gesture.id;
      gesture = null;
      selStroke = id;
      selected = null;
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-deselect-or-draw') {
      // Tap on empty space: clear any selection.
      gesture = null;
      selected = null;
      selStroke = null;
      requestDraw();
      return;
    }
    if (gesture?.type === 'maybe-add-text-or-scroll') {
      // Tap on empty space with the text tool: start a new text field.
      const page = gesture.page;
      gesture = null;
      startTextEdit(page.x, page.y);
      return;
    }
    if (gesture?.type === 'pinch' && pointers.size < 2) {
      gesture = null;
      eraserPos = null;
      onPinchEnd?.();
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
          setStrokes([...strokes, ...snapped]);
        } else {
          const committed = { ...live };
          delete committed.rawPoints;
          setStrokes([...strokes, committed]);
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
      // Pass the cursor Y so the editor can anchor the zoom there.
      onZoomRequest?.(zoom * Math.exp(-e.deltaY * 0.01), e.clientY);
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
      setStrokes(keep);
    } else {
      // Brush: erase only the points under the eraser, splitting strokes.
      const before = strokes.reduce((n, s) => n + s.points.length, 0);
      const next = eraseBrush(strokes, x, y, r);
      const after = next.reduce((n, s) => n + s.points.length, 0);
      if (after === before) return;
      pushUndo();
      setStrokes(next);
    }
    scheduleSave(page?.id);
  }

  // Double-click an existing text item to edit its contents in place (any tool).
  function onDoubleClick(e) {
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
    setTexts([...texts, t]);
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
      setTexts(texts.filter((t) => t.id !== id));
    } else {
      setTexts(texts.map((t) => (t.id === id ? { ...t, text } : t)));
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
    setStrokes(s.strokes);
    setTexts(s.texts);
    scheduleSave(page?.id);
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push({ strokes, texts });
    const s = redoStack.pop();
    setStrokes(s.strokes);
    setTexts(s.texts);
    scheduleSave(page?.id);
  }

  // Apply a property patch (size, color, border, …) to the selected text item
  // from the editor's formatting controls. Rapid successive calls (slider
  // drags) coalesce into a single undo step.
  let lastTextPropUndo = 0;
  function updateText(id, patch) {
    const t = texts.find((o) => o.id === id);
    if (!t) return;
    const now = Date.now();
    if (now - lastTextPropUndo > 500) {
      pushUndo();
      lastTextPropUndo = now;
    }
    setTexts(texts.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    scheduleSave(page?.id);
    requestDraw();
  }

  // Delete the currently selected stroke (works in any tool).
  function deleteSelectedStroke() {
    if (!selStroke) return;
    pushUndo();
    setStrokes(strokes.filter((o) => o.id !== selStroke));
    selStroke = null;
    scheduleSave(page?.id);
    requestDraw();
  }

  function cancelSave() {
    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }
  }

  // Queue a save onto the chain so saves never overlap and the newest content
  // always lands last. Routine ticks are dropped when the chain is backed up
  // (the next tick or flush carries the latest content); flushes are never
  // dropped.
  function queueSave(pid, content, required = false) {
    if (!required && savePending >= 3) return false;
    savePending++;
    saveChain = saveChain
      .then(() => onContentChange?.(pid, content))
      .finally(() => savePending--);
    return true;
  }

  // Interval autosave: while the page has unsaved changes, persist it every
  // 2s so other devices stay up to date even mid-drawing. The interval reads
  // the current content at fire time and only saves the page this component
  // currently holds (a page switch flushes and cancels the interval first).
  // A tick is skipped while the pen is down so serialization never runs
  // mid-stroke.
  function scheduleSave(pid) {
    if (pid == null) return;
    dirty = true;
    if (saveTimer) return;
    saveTimer = setInterval(() => {
      if (!dirty) {
        clearInterval(saveTimer);
        saveTimer = null;
        return;
      }
      if (currentPageId == null) return;
      if (live) return;
      if (!queueSave(currentPageId, { strokes, texts })) return;
      dirty = false;
    }, SAVE_INTERVAL);
  }

  // Immediate save of the current content (awaited by the caller before any
  // page switch). Returns a promise so switches can be serialized.
  function flushSave(pid = page?.id) {
    cancelSave();
    if (pid == null || !dirty) return Promise.resolve();
    dirty = false;
    queueSave(pid, { strokes, texts }, true);
    return saveChain;
  }

  function onDeleteKey(e) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (selStroke) {
      e.preventDefault();
      deleteSelectedStroke();
    }
  }

  onMount(() => {
    ready = true;
    untrackMomentum = trackMomentum(stopMomentum);
    resize();
    canvasEl?.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onDeleteKey);
    return () => {
      untrackMomentum?.();
      canvasEl?.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onDeleteKey);
      clearHoldTimer();
      stopMomentum();
      // The page is going away (notebook closed / page deleted): commit a
      // pending text edit and persist anything unsaved.
      commitEdit();
      cancelSave();
      if (dirty && currentPageId != null) flushSave(currentPageId);
    };
  });

  // Expose this page's imperative API to the editor (keyed by page id).
  $effect(() => {
    const id = page?.id;
    if (id != null) {
      onRegister?.(id, { undo, redo, flushSave, commitEdit, updateText });
      return () => onRegister?.(id, null);
    }
  });

  let editStyle = $derived(
    editing
      ? `left:${editing.x * zoom}px;top:${editing.y * zoom}px;width:${editing.w * zoom}px;height:${Math.max(48, editing.size * 2.7 * zoom)}px;font-size:${editing.size * zoom}px;line-height:${editing.size * 1.35 * zoom}px;color:${editing.color};${editing.border ? `border:${editing.border.width * zoom}px solid ${editing.border.color};` : ''}`
      : ''
  );

  // Screen-space box of the selected text item (for the selection chrome).
  // Shown in any tool: a tap selects a text item regardless of the active tool.
  const selectedBox = $derived.by(() => {
    void textsRev;
    if (!selected || editing) return null;
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

  // Screen position for the delete button shown above a selected stroke
  // (touch devices have no Delete key).
  const selStrokeDel = $derived.by(() => {
    void strokesRev;
    if (!selStroke) return null;
    const s = strokes.find((o) => o.id === selStroke);
    if (!s) return null;
    const bb = strokeBounds(s);
    return { left: bb.maxx * zoom + 10, top: bb.miny * zoom - 40 };
  });
</script>

<div
  class="page-sheet relative shrink-0"
  style="width:{page.width * zoom}px;height:{page.height * zoom}px"
  bind:this={containerEl}
>
  <canvas
    class="ink-canvas tool-{tool}"
    bind:this={canvasEl}
    style="position:absolute;left:0;top:0;width:{page.width * RES}px;height:{page.height * RES}px;transform:scale({zoom / RES});transform-origin:top left"
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
      <div class="text-handle-move" title="Drag to move"></div>
      <div class="text-handle-edge text-handle-edge-left" title="Drag to resize width"></div>
      <div class="text-handle-edge text-handle-edge-right" title="Drag to resize width"></div>
      <div class="text-handle-resize"></div>
    </div>
  {/if}
  {#if selStrokeDel}
    <button
      class="stroke-delete-btn"
      style="left:{selStrokeDel.left}px;top:{selStrokeDel.top}px"
      title="Delete stroke"
      aria-label="Delete stroke"
      onclick={deleteSelectedStroke}
    >
      ✕
    </button>
  {/if}
  {#if editing}
    <textarea
      class="text-edit-overlay"
      bind:this={textEl}
      style={editStyle}
      placeholder="Type here…"
      enterkeyhint="done"
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
