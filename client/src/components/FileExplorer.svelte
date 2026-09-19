<script>
  import Icon from './Icon.svelte';
  import PdfThumb from './PdfThumb.svelte';

  let {
    folders = [],
    notebooks = [],
    currentFolderId = null,
    activeTag = null,
    onNavigateFolder,
    onOpenNotebook,
    onNewNotebook,
    onNewFolder,
    onImportPdf,
    onOpenSettings,
    onOpenNotebookModal,
    onOpenFolderModal,
  } = $props();

  const I = {
    folder: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
    chevron: ['m9 18 6-6-6-6'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
    gear: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    ],
  };

  const byId = $derived(new Map(folders.map((f) => [f.id, f])));

  // Breadcrumb chain from root down to the current folder.
  const path = $derived.by(() => {
    const chain = [];
    let cur = currentFolderId;
    let guard = 0;
    while (cur != null && byId.has(cur) && guard++ < 100) {
      chain.unshift(byId.get(cur));
      cur = byId.get(cur).parentId;
    }
    return chain;
  });

  const subfolders = $derived(
    folders
      .filter((f) => f.parentId === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  const files = $derived(
    notebooks
      .filter((n) => (currentFolderId == null ? n.folderId == null : n.folderId === currentFolderId))
      .filter((n) => !activeTag || n.tags.includes(activeTag))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  );

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- breadcrumb + actions -->
  <div class="flex h-12 shrink-0 items-center gap-1 border-b border-stone-200 bg-white px-3">
    <button
      class="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-stone-600 hover:bg-stone-100"
      onclick={() => onNavigateFolder(null)}
      title="All files"
    >
      <Icon d={I.folder} size={16} />
      <span class="hidden sm:inline">Files</span>
    </button>
    {#each path as f (f.id)}
      <Icon d={I.chevron} size={14} class="text-stone-300" />
      <button
        class="rounded px-2 py-1 text-sm {f.id === currentFolderId
          ? 'font-semibold text-stone-800'
          : 'font-medium text-stone-600 hover:bg-stone-100'}"
        onclick={() => onNavigateFolder(f.id)}
      >
        {f.name}
      </button>
    {/each}
    <div class="flex-1"></div>
    <button
      class="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
      onclick={onImportPdf}
      title="Import a PDF as a new notebook"
    >
      <Icon d={I.upload} size={15} />
      <span class="hidden sm:inline">Import PDF</span>
    </button>
    <button
      class="rounded-lg bg-[#4f7cff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3d68e0]"
      onclick={() => onNewNotebook(currentFolderId)}
    >
      + Notebook
    </button>
    <button
      class="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
      onclick={() => onNewFolder(currentFolderId)}
    >
      + Folder
    </button>
    <button
      class="rounded-lg p-2 text-stone-600 hover:bg-stone-100"
      title="Settings"
      aria-label="Settings"
      onclick={onOpenSettings}
    >
      <Icon d={I.gear} size={18} />
    </button>
  </div>

  <!-- contents -->
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    {#if subfolders.length === 0 && files.length === 0}
      <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
          <Icon d={I.folder} size={26} />
        </div>
        <p class="text-sm text-stone-500">This folder is empty.</p>
        <div class="flex gap-2">
          <button
            class="rounded-lg bg-[#4f7cff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3d68e0]"
            onclick={() => onNewNotebook(currentFolderId)}
          >
            + New notebook
          </button>
          <button
            class="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
            onclick={() => onNewFolder(currentFolderId)}
          >
            + New folder
          </button>
        </div>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {#each subfolders as f (f.id)}
          <div
            class="group relative flex flex-col gap-2 rounded-xl border border-transparent p-3 text-center hover:border-stone-200 hover:bg-stone-50"
          >
            <button
              class="flex flex-1 flex-col items-center gap-2"
              onclick={() => onNavigateFolder(f.id)}
            >
              <div class="flex h-16 w-full items-center justify-center rounded-lg bg-amber-50 text-amber-500">
                <Icon d={I.folder} size={40} />
              </div>
              <span class="line-clamp-2 w-full text-sm font-medium text-stone-700">{f.name}</span>
            </button>
            <button
              class="absolute right-2 top-2 rounded p-1 text-stone-400 opacity-0 hover:bg-stone-200 group-hover:opacity-100"
              title="Folder settings"
              onclick={() => onOpenFolderModal(f)}
            >
              ⋯
            </button>
          </div>
        {/each}

        {#each files as nb (nb.id)}
          <div
            class="group relative flex flex-col gap-2 rounded-xl border border-transparent p-3 text-center hover:border-stone-200 hover:bg-stone-50"
          >
            <button class="flex flex-1 flex-col items-center gap-2" onclick={() => onOpenNotebook(nb.id)}>
              {#if nb.firstBackground === 'pdf' && nb.firstPdfId != null}
                <PdfThumb pdfId={nb.firstPdfId} pdfPage={nb.firstPdfPage} />
              {:else}
                <div class="flex aspect-[3/4] w-full items-center justify-center rounded border border-stone-200 bg-white text-stone-300">
                  <Icon d={I.file} size={34} />
                </div>
              {/if}
              <span class="line-clamp-2 w-full text-sm font-medium text-stone-700">{nb.title}</span>
              <span class="text-xs text-stone-400">
                {nb.pageCount} page{nb.pageCount === 1 ? '' : 's'} · {fmtDate(nb.updatedAt)}
              </span>
            </button>
            <button
              class="absolute right-2 top-2 rounded p-1 text-stone-400 opacity-0 hover:bg-stone-200 group-hover:opacity-100"
              title="Notebook settings"
              onclick={() => onOpenNotebookModal(nb)}
            >
              ⋯
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
