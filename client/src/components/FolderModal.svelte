<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let { folder, folders = [], onClose, onSaved, onDeleted } = $props();

  let name = $state(folder.name);
  let parentId = $state(folder.parentId ?? '');
  let busy = $state(false);
  let nameEl = $state(null);

  // A folder cannot be moved into itself or one of its own descendants.
  const excluded = new Set([folder.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of folders) {
      if (f.parentId != null && excluded.has(f.parentId) && !excluded.has(f.id)) {
        excluded.add(f.id);
        changed = true;
      }
    }
  }
  const options = folders.filter((f) => !excluded.has(f.id));

  onMount(() => {
    nameEl?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    busy = true;
    try {
      const f = await api.updateFolder(folder.id, { name: trimmed, parentId: parentId === '' ? null : Number(parentId) });
      onSaved(f);
      onClose();
    } finally {
      busy = false;
    }
  }

  async function del() {
    if (!confirm(`Delete folder "${folder.name}"?\nAll notebooks and pages inside it will be deleted.`)) return;
    busy = true;
    try {
      await api.deleteFolder(folder.id);
      onDeleted(folder.id);
      onClose();
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
  role="button"
  aria-label="Close dialog"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
>
  <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onclick={(e) => e.stopPropagation()}>
    <h2 class="mb-4 text-base font-semibold">Folder settings</h2>

    <label for="fd-name" class="mb-1 block text-xs font-medium text-stone-500">Name</label>
    <input
      id="fd-name"
      bind:this={nameEl}
      class="mb-3 w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-[#4f7cff]"
      bind:value={name}
      placeholder="Folder name"
      onkeydown={(e) => e.key === 'Enter' && save()}
    />

    <label for="fd-parent" class="mb-1 block text-xs font-medium text-stone-500">Parent folder</label>
    <select
      id="fd-parent"
      class="mb-4 w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#4f7cff]"
      bind:value={parentId}
    >
      <option value="">No parent (top level)</option>
      {#each options as f (f.id)}
        <option value={f.id}>{f.name}</option>
      {/each}
    </select>

    <div class="flex items-center gap-2">
      <button
        class="rounded-lg bg-[#4f7cff] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#3d68e0] disabled:opacity-50"
        disabled={busy || !name.trim()}
        onclick={save}
      >
        Save
      </button>
      <button
        class="rounded-lg border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        disabled={busy}
        onclick={del}
      >
        Delete
      </button>
      <button class="ml-auto rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100" onclick={onClose}>
        Close
      </button>
    </div>
  </div>
</div>
