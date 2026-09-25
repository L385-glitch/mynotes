<script>
  import Canvas from './Canvas.svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { PEN_COLORS, HIGHLIGHTER_COLORS } from '../lib/engine/ink.js';
  import { exportNotebookPdf } from '../lib/export.js';

  let {
    notebook,
    pages = [],
    saveState = 'saved',
    onContentChange,
    onPagesChanged,
    onToggleSidebar,
    onBack,
    onOpenSettings,
    dark = false,
    register,
  } = $props();

  let tool = $state('pen');
  let color = $state('#1f2937');
  let size = $state(3);
  let exporting = $state(false);
  let bgOpen = $state(false);
  let colorOpen = $state(false);
  let eraserMode = $state('brush');
  let selText = $state(null);

  // Shared zoom (scale) applied to every page sheet in the stack.
  let zoom = $state(1);
  let zoomInit = $state(false);
  let activePageId = $state(null);
  let pageApis = $state({});
  let containerRef = $state(null);

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;
  const zoomPct = $derived(Math.round(zoom * 100));

  function clampZoom(z) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  function fitWidth() {
    const el = containerRef;
    const ref = pages[0];
    if (!el || !ref) return 1;
    return clampZoom((el.clientWidth - 48) / ref.width);
  }

  // Fit the first page to the container width once the layout is ready.
  $effect(() => {
    if (!zoomInit && pages.length && containerRef) {
      zoom = fitWidth();
      zoomInit = true;
    }
  });

  function setZoom(z) {
    zoom = clampZoom(z);
  }

  function registerApi(pageId, api_) {
    pageApis[pageId] = api_;
  }

  function onPageActive(pageId) {
    activePageId = pageId;
  }

  function activeApi() {
    return pageApis[activePageId] ?? null;
  }

  // Persist every page's pending edit before leaving the notebook.
  async function flushAll() {
    for (const id of Object.keys(pageApis)) {
      const a = pageApis[id];
      a.commitEdit?.();
      await a.flushSave?.();
    }
  }

  $effect(() => {
    register?.({ flush: flushAll });
  });

  // A single keyboard listener, routed to the page the user last touched.
  $effect(() => {
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) activeApi()?.redo();
        else activeApi()?.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        activeApi()?.redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const I = {
    select: ['M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z'],
    pen: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
    highlighter: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
    eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
    text: ['M17 6H3', 'M21 12H3', 'M15.5 18H3'],
    undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2L3 13'],
    redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2l3 3'],
    plus: ['M5 12h14', 'M12 5v14'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    chevronLeft: ['m15 18-6-6 6-6'],
    chevronUp: ['m18 15-6-6-6 6'],
    chevronDown: ['m6 9 6 6 6-6'],
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    gear: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    ],
  };

  const TOOLS = [
    { id: 'select', icon: I.select, label: 'Select' },
    { id: 'pen', icon: I.pen, label: 'Pen' },
    { id: 'highlighter', icon: I.highlighter, label: 'Highlighter' },
    { id: 'eraser', icon: I.eraser, label: 'Eraser' },
    { id: 'text', icon: I.text, label: 'Text' },
  ];

  const BGS = [
    { id: 'blank', label: 'Blank' },
    { id: 'ruled', label: 'Ruled' },
    { id: 'grid', label: 'Grid' },
    { id: 'dots', label: 'Dots' },
  ];

  const palette = $derived(tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS);

  function setTool(t) {
    tool = t;
    bgOpen = false;
    colorOpen = false;
    if (t === 'select') return;
    // Only reset when crossing between the highlighter and ink palettes, so a
    // custom color picked in the color popover survives tool switches.
    if (t === 'highlighter') {
      if (!HIGHLIGHTER_COLORS.includes(color)) color = HIGHLIGHTER_COLORS[0];
    } else if (HIGHLIGHTER_COLORS.includes(color)) {
      color = PEN_COLORS[0];
    }
  }

  // The text item currently selected on the active page (null when none).
  function onTextSelect(t) {
    selText = t;
  }

  // Apply a formatting patch to the selected text via the active page's API.
  function patchText(patch) {
    if (!selText) return;
    activeApi()?.updateText?.(selText.id, patch);
  }

  function zoomIn() {
    setZoom(zoom * 1.25);
  }
  function zoomOut() {
    setZoom(zoom * 0.8);
  }
  function fitView() {
    zoom = fitWidth();
  }

  // The page the user last interacted with (falls back to the first page).
  const activePage = $derived(pages.find((p) => p.id === activePageId) ?? pages[0] ?? null);

  async function addPage() {
    // Inherit the page layout (dimensions) from the page we insert after, so
    // new pages in a PDF notebook match the imported PDF page size.
    const ref = activePage ?? pages[pages.length - 1];
    const p = await api.createPage(notebook.id, {
      background: 'blank',
      afterId: ref?.id,
      width: ref?.width,
      height: ref?.height,
    });
    await onPagesChanged();
    activePageId = p.id;
  }

  async function deletePage() {
    if (pages.length <= 1) {
      alert('A notebook needs at least one page.');
      return;
    }
    if (!activePage) return;
    if (!confirm('Delete this page?')) return;
    await activeApi()?.flushSave?.();
    await api.deletePage(activePage.id);
    await onPagesChanged();
  }

  async function movePage(dir) {
    if (!activePage) return;
    await api.movePage(activePage.id, dir);
    await onPagesChanged();
  }

  async function setBackground(bg) {
    bgOpen = false;
    const p = activePage;
    if (!p || p.background === 'pdf' || p.background === bg) return;
    await api.savePage(p.id, { background: bg });
    await onPagesChanged();
  }

  async function exportAll() {
    exporting = true;
    try {
      await exportNotebookPdf(notebook);
    } catch (e) {
      alert('Export failed: ' + e.message);
    } finally {
      exporting = false;
    }
  }
</script>

<div class="flex h-full min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-stone-200 bg-white px-2 py-1.5 sm:px-3 order-2">
    {#each TOOLS as t (t.id)}
      <button
        class="rounded-lg p-2 {tool === t.id ? 'bg-[#eef2ff] text-[#4f7cff]' : 'text-stone-600 hover:bg-stone-100'}"
        title={t.label}
        onclick={() => setTool(t.id)}
      >
        <Icon d={t.icon} />
      </button>
    {/each}

    {#if tool === 'eraser'}
      <div class="flex items-center rounded-lg bg-stone-100 p-0.5">
        <button class="rounded px-2 py-1 text-xs font-medium {eraserMode === 'brush' ? 'bg-white text-[#4f7cff] shadow-sm' : 'text-stone-500'}" onclick={() => (eraserMode = 'brush')}>Brush</button>
        <button class="rounded px-2 py-1 text-xs font-medium {eraserMode === 'line' ? 'bg-white text-[#4f7cff] shadow-sm' : 'text-stone-500'}" onclick={() => (eraserMode = 'line')}>Line</button>
      </div>
    {/if}

    {#if tool !== 'select'}
      <div class="mx-1 h-6 w-px bg-stone-200"></div>

      <div class="relative">
        <button
          class="flex items-center gap-1 rounded-lg p-1.5 text-stone-600 hover:bg-stone-100"
          title="Color"
          onclick={() => (colorOpen = !colorOpen)}
        >
          <span class="h-5 w-5 rounded-full border border-stone-300" style="background:{color}"></span>
          <Icon d={I.chevronDown} size={12} />
        </button>
        {#if colorOpen}
          <div class="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            <div class="grid grid-cols-6 gap-1.5">
              {#each palette as c (c)}
                <button
                  class="h-6 w-6 rounded-full border {c === color ? 'border-[#4f7cff] ring-2 ring-[#4f7cff]/40' : 'border-stone-200'}"
                  style="background:{c}"
                  title={c}
                  onclick={() => {
                    color = c;
                    colorOpen = false;
                  }}
                ></button>
              {/each}
            </div>
            <div class="mt-2 flex items-center gap-2 border-t border-stone-200 pt-2">
              <input
                type="color"
                value={color}
                oninput={(e) => (color = e.target.value)}
                class="h-7 w-9 cursor-pointer rounded border border-stone-200 bg-transparent p-0.5"
              />
              <span class="text-xs text-stone-500">Custom color</span>
            </div>
          </div>
        {/if}
      </div>

      <div class="mx-1 h-6 w-px bg-stone-200"></div>

      <div class="flex items-center gap-2">
        <span class="rounded-full bg-stone-700" style="width:{Math.min(20, size * 1.6)}px;height:{Math.min(20, size * 1.6)}px"></span>
        <input
          type="range"
          min="1"
          max="20"
          step="0.5"
          value={size}
          oninput={(e) => (size = Number(e.target.value))}
          class="h-1 w-24 accent-[#4f7cff]"
          title="Brush size"
        />
        <span class="w-7 text-right text-xs text-stone-500">{size}</span>
      </div>
    {/if}

    <div class="mx-1 h-6 w-px bg-stone-200"></div>

    <button class="rounded-lg p-2 text-stone-600 hover:bg-stone-100" title="Undo (Ctrl+Z)" onclick={() => activeApi()?.undo()}>
      <Icon d={I.undo} />
    </button>
    <button class="rounded-lg p-2 text-stone-600 hover:bg-stone-100" title="Redo (Ctrl+Shift+Z)" onclick={() => activeApi()?.redo()}>
      <Icon d={I.redo} />
    </button>

    <div class="mx-1 h-6 w-px bg-stone-200"></div>

    <button class="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100" title="Zoom out" onclick={zoomOut}>-</button>
    <button class="min-w-10 rounded-lg px-1 py-0.5 text-center text-xs text-stone-600 hover:bg-stone-100" title="Fit to width" onclick={fitView}>
      {zoomPct}%
    </button>
    <button class="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100" title="Zoom in" onclick={zoomIn}>+</button>

    <div class="mx-1 h-6 w-px bg-stone-200"></div>

    <div class="relative">
      <button
        class="rounded-lg p-2 {bgOpen ? 'bg-[#eef2ff] text-[#4f7cff]' : 'text-stone-600 hover:bg-stone-100'}"
        title="Page background"
        onclick={() => (bgOpen = !bgOpen)}
        disabled={activePage?.background === 'pdf'}
      >
        <Icon d={I.grid} />
      </button>
      {#if bgOpen}
        <div class="absolute left-0 top-full z-30 mt-1 w-28 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
          {#each BGS as bg (bg.id)}
            <button
              class="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-50 {activePage?.background === bg.id ? 'font-semibold text-[#4f7cff]' : 'text-stone-700'}"
              onclick={() => setBackground(bg.id)}
            >
              {bg.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if tool === 'text' && selText}
    <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-stone-200 bg-stone-50 px-3 py-1.5 order-3">
      <span class="text-xs font-semibold uppercase tracking-wide text-stone-400">Text</span>

      <div class="flex items-center gap-2">
        <span class="text-xs text-stone-500">Size</span>
        <input
          type="range"
          min="8"
          max="72"
          step="1"
          value={selText.size}
          oninput={(e) => patchText({ size: Number(e.target.value) })}
          class="h-1 w-24 accent-[#4f7cff]"
          title="Text size"
        />
        <span class="w-6 text-right text-xs text-stone-500">{Math.round(selText.size)}</span>
      </div>

      <div class="flex items-center gap-1">
        <span class="text-xs text-stone-500">Color</span>
        {#each PEN_COLORS as c (c)}
          <button
            class="h-4 w-4 rounded-full border {selText.color === c ? 'border-[#4f7cff] ring-1 ring-[#4f7cff]/50' : 'border-stone-300'}"
            style="background:{c}"
            title={c}
            onclick={() => patchText({ color: c })}
          ></button>
        {/each}
        <input
          type="color"
          value={selText.color}
          oninput={(e) => patchText({ color: e.target.value })}
          class="h-5 w-6 cursor-pointer rounded border border-stone-200 bg-transparent p-0"
          title="Custom text color"
        />
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-xs text-stone-500">Border</span>
        <button
          class="rounded px-2 py-0.5 text-xs font-medium {selText.border ? 'bg-white text-[#4f7cff] shadow-sm' : 'text-stone-500 hover:bg-stone-100'}"
          onclick={() => patchText({ border: selText.border ? null : { color: '#1f2937', width: 2 } })}
        >
          {selText.border ? 'On' : 'Off'}
        </button>
        {#if selText.border}
          <input
            type="color"
            value={selText.border.color}
            oninput={(e) => patchText({ border: { ...selText.border, color: e.target.value } })}
            class="h-5 w-6 cursor-pointer rounded border border-stone-200 bg-transparent p-0"
            title="Border color"
          />
          <input
            type="range"
            min="1"
            max="6"
            step="0.5"
            value={selText.border.width}
            oninput={(e) => patchText({ border: { ...selText.border, width: Number(e.target.value) } })}
            class="h-1 w-16 accent-[#4f7cff]"
            title="Border width"
          />
        {/if}
      </div>
    </div>
  {/if}

  <div class="flex h-12 shrink-0 items-center gap-1 border-b border-stone-200 bg-white px-2 sm:px-3 order-1">
    <button class="rounded p-1.5 text-stone-500 hover:bg-stone-100 md:hidden" onclick={onToggleSidebar} aria-label="Menu">
      <Icon d={I.menu} />
    </button>
    <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100" title="Back to folders" onclick={onBack}>
      <Icon d={I.chevronLeft} size={16} />
      <span class="hidden sm:inline">Folders</span>
    </button>
    <div class="h-5 w-px bg-stone-200"></div>
    <div class="flex min-w-0 items-center gap-2">
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{notebook.color}"></span>
      <h2 class="truncate text-sm font-semibold">{notebook.title}</h2>
    </div>
    <span class="ml-2 hidden text-xs text-stone-400 sm:inline">
      {saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved' : 'Saved'}
    </span>
    <span class="ml-2 hidden text-xs text-stone-400 sm:inline">{pages.length} page{pages.length === 1 ? '' : 's'}</span>
    <div class="flex-1"></div>

    <button class="rounded p-1.5 text-stone-600 hover:bg-stone-100" title="Add page" onclick={addPage}>
      <Icon d={I.plus} />
    </button>
    <button class="rounded p-1.5 text-stone-600 hover:bg-stone-100 disabled:opacity-30" title="Move page up" disabled={!activePage || activePage.idx === 0} onclick={() => movePage('prev')}>
      <Icon d={I.chevronUp} size={16} />
    </button>
    <button class="rounded p-1.5 text-stone-600 hover:bg-stone-100 disabled:opacity-30" title="Move page down" disabled={!activePage || activePage.idx >= pages.length - 1} onclick={() => movePage('next')}>
      <Icon d={I.chevronDown} size={16} />
    </button>
    <button class="rounded p-1.5 text-stone-600 hover:bg-stone-100 disabled:opacity-30" title="Delete page" disabled={!activePage} onclick={deletePage}>
      <Icon d={I.trash} />
    </button>
    <button
      class="flex items-center gap-1.5 rounded-lg bg-[#4f7cff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3d68e0] disabled:opacity-50"
      title="Export notebook as PDF"
      onclick={exportAll}
      disabled={exporting}
    >
      <Icon d={I.download} size={14} />
      {exporting ? 'Exporting…' : 'Export PDF'}
    </button>
    <button class="rounded p-1.5 text-stone-600 hover:bg-stone-100" title="Settings" aria-label="Settings" onclick={onOpenSettings}>
      <Icon d={I.gear} size={18} />
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto order-4" bind:this={containerRef}>
    <div class="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-8">
      {#each pages as p (p.id)}
        <div class="relative">
          <span class="pointer-events-none absolute -top-6 left-0 text-xs font-medium text-stone-400">Page {p.idx + 1}</span>
          <Canvas
            page={p}
            tool={tool}
            color={color}
            size={size}
            eraserMode={eraserMode}
            {dark}
            {zoom}
            onContentChange={onContentChange}
            onActive={onPageActive}
            onRegister={registerApi}
            onZoomRequest={setZoom}
            onTextSelect={onTextSelect}
          />
        </div>
      {/each}
    </div>
  </div>
</div>
