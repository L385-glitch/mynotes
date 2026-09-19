<script>
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Editor from './components/Editor.svelte';
  import FileExplorer from './components/FileExplorer.svelte';
  import NotebookModal from './components/NotebookModal.svelte';
  import FolderModal from './components/FolderModal.svelte';
  import Settings from './components/Settings.svelte';
  import { api } from './lib/api.js';
  import { getPageCount, getPageSize } from './lib/pdf.js';
  import { initialDark, applyTheme, storeTheme } from './lib/theme.js';

  let folders = $state([]);
  let notebooks = $state([]);
  let tags = $state([]);
  let selectedNotebookId = $state(null);
  let currentFolderId = $state(null);
  let returnFolderId = $state(null);
  let pages = $state([]);
  let activeTag = $state(null);
  let saveState = $state('saved');
  let modalNotebook = $state(null);
  let modalFolder = $state(null);
  let sidebarOpen = $state(false);
  let importing = $state(false);
  let dark = $state(initialDark());
  let settingsOpen = $state(false);
  let editorApi = $state(null);
  let fileInput;
  let navToken = 0;

  // Keep the <html> class + persisted preference in sync with the toggle.
  $effect(() => {
    applyTheme(dark);
    storeTheme(dark);
  });

  function setDark(v) {
    dark = v;
  }

  const notebook = $derived(notebooks.find((n) => n.id === selectedNotebookId) ?? null);

  function registerEditor(api_) {
    editorApi = api_;
  }

  async function refresh() {
    const [f, n, t] = await Promise.all([api.listFolders(), api.listNotebooks(), api.listTags()]);
    folders = f;
    notebooks = n;
    tags = t;
  }

  // Navigate the file explorer to a folder (null = root), closing any open notebook.
  async function navigateFolder(id) {
    currentFolderId = id;
    if (selectedNotebookId != null) {
      await editorApi?.flush?.();
      selectedNotebookId = null;
      pages = [];
    }
    sidebarOpen = false;
  }

  // Leave the editor and return to the folder the notebook lives in.
  async function backToFolders() {
    await editorApi?.flush?.();
    selectedNotebookId = null;
    pages = [];
    currentFolderId = returnFolderId ?? null;
  }

  // Load every page of a notebook WITH its content, so the editor can render
  // the whole stack at once. The token guards against a stale response landing
  // after the user has already navigated away.
  async function loadFullPages(id, tok = navToken) {
    const summaries = await api.listPages(id);
    if (tok !== navToken) return [];
    const full = await Promise.all(summaries.map((s) => api.getPage(s.id)));
    if (tok !== navToken) return [];
    return full;
  }

  async function selectNotebook(id, targetPageId = null) {
    if (id === selectedNotebookId) return;
    const tok = ++navToken;
    selectedNotebookId = id;
    sidebarOpen = false;
    // Persist the notebook we're leaving before its pages are swapped out.
    await editorApi?.flush?.();
    const nb = notebooks.find((n) => n.id === id);
    returnFolderId = nb ? nb.folderId : null;
    pages = await loadFullPages(id, tok);
  }

  async function handleContentChange(pageId, content) {
    saveState = 'saving';
    try {
      await api.savePage(pageId, { content });
      saveState = 'saved';
    } catch {
      saveState = 'unsaved';
    }
  }

  async function refreshPages() {
    if (!selectedNotebookId) return;
    pages = await loadFullPages(selectedNotebookId);
  }

  async function newNotebook(folderId) {
    const title = prompt('Notebook name:', 'New notebook');
    if (title === null) return;
    const nb = await api.createNotebook(title.trim() || 'New notebook', folderId);
    await refresh();
    await selectNotebook(nb.id);
  }

  async function newFolder(parentId) {
    const name = prompt('Folder name:', 'New folder');
    if (name === null) return;
    await api.createFolder(name.trim() || 'New folder', parentId);
    await refresh();
  }

  function toggleTag(name) {
    activeTag = activeTag === name ? null : name;
  }

  function selectSearchResult(r) {
    if (!r.notebookId) return;
    selectNotebook(r.notebookId, r.pageId ?? null);
  }

  function importPdf() {
    fileInput?.click();
  }

  async function onPdfFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    importing = true;
    try {
      const { id: pdfId, name } = await api.uploadPdf(file);
      const count = await getPageCount(pdfId);
      const nb = await api.createNotebook(name.replace(/\.pdf$/i, ''), currentFolderId);
      const initial = await api.listPages(nb.id);
      const blankId = initial.length ? initial[0].id : null;
      // Create the PDF pages BEFORE removing the initial blank page: deleting a
      // page cleans up orphaned PDFs, and the upload is orphaned until a page
      // references it — deleting the blank page first would wipe the PDF and
      // make the next createPage fail its foreign key.
      for (let i = 0; i < count; i++) {
        const { w, h } = await getPageSize(pdfId, i + 1);
        await api.createPage(nb.id, { background: 'pdf', pdfId, pdfPage: i, width: w, height: h });
      }
      if (blankId !== null) await api.deletePage(blankId);
      await refresh();
      await selectNotebook(nb.id);
    } catch (err) {
      alert('PDF import failed: ' + err.message);
    } finally {
      importing = false;
    }
  }

  function onModalSaved(nb) {
    notebooks = notebooks.map((n) => (n.id === nb.id ? nb : n));
  }

  function onModalDeleted(id) {
    notebooks = notebooks.filter((n) => n.id !== id);
    if (selectedNotebookId === id) {
      selectedNotebookId = null;
      pages = [];
    }
  }

  async function onFolderSaved(f) {
    folders = folders.map((o) => (o.id === f.id ? f : o));
  }

  async function onFolderDeleted(id) {
    // Deleting a folder orphans its children (parent_id -> NULL) and removes
    // its notebooks; a full refresh keeps the tree consistent.
    if (currentFolderId === id) currentFolderId = null;
    await refresh();
  }

  onMount(refresh);
</script>

<div class="flex h-full overflow-hidden">
  {#if sidebarOpen}
    <div
      class="fixed inset-0 z-20 bg-black/30 md:hidden"
      role="button"
      aria-label="Close sidebar"
      onclick={() => (sidebarOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (sidebarOpen = false)}
    ></div>
  {/if}
  <div class="z-30 h-full {sidebarOpen ? 'fixed inset-y-0 left-0 shadow-xl' : 'hidden md:block'}">
    <Sidebar
      {folders}
      {tags}
      {currentFolderId}
      {activeTag}
      onNavigateFolder={navigateFolder}
      onNewNotebook={newNotebook}
      onNewFolder={newFolder}
      onToggleTag={toggleTag}
      onSelectSearchResult={selectSearchResult}
      onClose={() => (sidebarOpen = false)}
    />
  </div>

  <div class="flex min-w-0 flex-1 flex-col">
    {#if notebook && pages.length}
      <Editor
        register={registerEditor}
        {notebook}
        {pages}
        {saveState}
        onContentChange={handleContentChange}
        onPagesChanged={refreshPages}
        onToggleSidebar={() => (sidebarOpen = true)}
        onBack={backToFolders}
        {dark}
        onOpenSettings={() => (settingsOpen = true)}
      />
    {:else if notebook}
      <div class="flex flex-1 items-center justify-center text-sm text-stone-400">Loading…</div>
    {:else}
      <FileExplorer
        {folders}
        {notebooks}
        {currentFolderId}
        {activeTag}
        onNavigateFolder={navigateFolder}
        onOpenNotebook={(id) => selectNotebook(id)}
        onNewNotebook={newNotebook}
        onNewFolder={newFolder}
        onImportPdf={importPdf}
        onOpenSettings={() => (settingsOpen = true)}
        onOpenNotebookModal={(nb) => (modalNotebook = nb)}
        onOpenFolderModal={(f) => (modalFolder = f)}
      />
    {/if}
  </div>

  <input type="file" accept="application/pdf" class="hidden" bind:this={fileInput} onchange={onPdfFile} />

  {#if modalNotebook}
    <NotebookModal
      notebook={modalNotebook}
      {folders}
      onClose={() => (modalNotebook = null)}
      onSaved={onModalSaved}
      onDeleted={onModalDeleted}
    />
  {/if}

  {#if modalFolder}
    <FolderModal
      folder={modalFolder}
      {folders}
      onClose={() => (modalFolder = null)}
      onSaved={onFolderSaved}
      onDeleted={onFolderDeleted}
    />
  {/if}

  {#if settingsOpen}
    <Settings {dark} onDarkChange={setDark} onClose={() => (settingsOpen = false)} />
  {/if}
</div>
