<script>
  import { api } from '../lib/api.js';
  import Icon from './Icon.svelte';

  let {
    folders = [],
    tags = [],
    currentFolderId = null,
    activeTag = null,
    collapsed = false,
    onToggleCollapsed,
    onNavigateFolder,
    onNewNotebook,
    onNewFolder,
    onToggleTag,
    onSelectSearchResult,
    onClose,
  } = $props();

  let query = $state('');
  let results = $state(null);
  let searchTimer = null;
  let isDesktop = $state(window.matchMedia('(min-width: 768px)').matches);

  const I = {
    folder: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'],
    files: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
    panelClose: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18', 'm16 15-3-3 3-3'],
    panelOpen: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18', 'm14 9 3 3-3 3'],
  };

  // Collapse only applies on desktop; on mobile the sidebar is an overlay.
  const minimized = $derived(collapsed && isDesktop);

  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => (isDesktop = e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  $effect(() => {
    const q = query.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) {
      results = null;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        results = await api.search(q);
      } catch {
        results = [];
      }
    }, 300);
  });

  const rootFolders = $derived(
    folders.filter((f) => f.parentId == null).sort((a, b) => a.name.localeCompare(b.name))
  );

  function countIn(folderId) {
    return folders.filter((f) => f.parentId === folderId).length + 0;
  }
</script>

<aside class="flex h-full shrink-0 flex-col border-r border-stone-200 bg-white pt-[env(safe-area-inset-top)] {minimized ? 'w-12 items-center' : 'w-72'}">
  {#if minimized}
    <div class="flex flex-col items-center gap-3 py-3">
      <button class="rounded p-1.5 text-stone-500 hover:bg-stone-100" title="Show folders" aria-label="Show folders" onclick={onToggleCollapsed}>
        <Icon d={I.panelOpen} size={18} />
      </button>
      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4f7cff] text-sm font-bold text-white">M</div>
    </div>
  {:else}
  <div class="flex items-center gap-2 px-4 pt-4 pb-2">
    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4f7cff] text-sm font-bold text-white">M</div>
    <h1 class="text-lg font-semibold tracking-tight">Mynotes</h1>
    <div class="ml-auto flex items-center">
      <button class="hidden rounded p-1 text-stone-500 hover:bg-stone-100 md:block" title="Hide folders" aria-label="Hide folders" onclick={onToggleCollapsed}>
        <Icon d={I.panelClose} size={18} />
      </button>
      <button class="rounded p-1 text-stone-500 hover:bg-stone-100 md:hidden" onclick={onClose} aria-label="Close sidebar">✕</button>
    </div>
  </div>

  <div class="px-3 pb-2">
    <input
      type="search"
      class="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm outline-none focus:border-[#4f7cff]"
      placeholder="Search notes…"
      bind:value={query}
    />
  </div>

  <div class="flex gap-2 px-3 pb-3">
    <button class="flex-1 rounded-lg bg-[#4f7cff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3d68e0]" onclick={() => onNewNotebook(currentFolderId)}>
      + Notebook
    </button>
    <button class="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50" onclick={() => onNewFolder(currentFolderId)}>
      + Folder
    </button>
  </div>

  {#if tags.length}
    <div class="flex flex-wrap gap-1.5 px-3 pb-3">
      {#each tags as tag (tag.id)}
        <button
          class="rounded-full border px-2.5 py-0.5 text-xs {activeTag === tag.name
            ? 'border-[#4f7cff] bg-[#4f7cff] text-white'
            : 'border-stone-200 text-stone-600 hover:bg-stone-50'}"
          onclick={() => onToggleTag(tag.name)}
        >
          #{tag.name}
        </button>
      {/each}
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
    {#if results !== null}
      <p class="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-stone-400">Results</p>
      {#if results.length === 0}
        <p class="px-2 text-sm text-stone-400">Nothing found.</p>
      {:else}
        {#each results as r (JSON.stringify(r))}
          <button class="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-50" onclick={() => onSelectSearchResult(r)}>
            <span class="font-medium text-stone-700">{r.kind === 'title' ? 'Notebook' : 'Page'} </span>
            <span class="text-stone-500">{r.snippet}</span>
          </button>
        {/each}
      {/if}
    {:else}
      <p class="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-stone-400">Folders</p>
      <button
        class="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left {currentFolderId == null
          ? 'bg-[#eef2ff]'
          : 'hover:bg-stone-50'}"
        onclick={() => onNavigateFolder(null)}
      >
        <span class="text-stone-400"><Icon d={I.files} size={16} /></span>
        <span class="text-sm font-medium text-stone-700">All files</span>
      </button>
      {#each rootFolders as f (f.id)}
        <button
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left {f.id === currentFolderId
            ? 'bg-[#eef2ff]'
            : 'hover:bg-stone-50'}"
          onclick={() => onNavigateFolder(f.id)}
        >
          <span class="text-amber-500"><Icon d={I.folder} size={16} /></span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-stone-700">{f.name}</span>
          {#if countIn(f.id)}
            <span class="text-xs text-stone-400">{countIn(f.id)}</span>
          {/if}
        </button>
      {/each}
      {#if rootFolders.length === 0}
        <p class="px-2 pt-2 text-sm text-stone-400">No folders yet. Create one to organize your notes.</p>
      {/if}
    {/if}
  </div>
  {/if}
</aside>
