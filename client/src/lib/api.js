async function req(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Serialize a page's content in small chunks, yielding to the browser
// between chunks, so a large page never blocks the main thread (and an
// active pen stroke) for more than a few ms at a time.
async function stringifyContent(content) {
  const strokes = content.strokes ?? [];
  const texts = content.texts ?? [];
  const parts = ['{"strokes":['];
  for (let i = 0; i < strokes.length; i++) {
    if (i) parts.push(',');
    parts.push(JSON.stringify(strokes[i]));
    if ((i & 127) === 127) await new Promise((r) => setTimeout(r));
  }
  parts.push('],"texts":[');
  for (let i = 0; i < texts.length; i++) {
    if (i) parts.push(',');
    parts.push(JSON.stringify(texts[i]));
    if ((i & 127) === 127) await new Promise((r) => setTimeout(r));
  }
  parts.push(']}');
  return parts.join('');
}

export const api = {
  // folders
  listFolders: () => req('GET', '/api/folders'),
  createFolder: (name, parentId = null) => req('POST', '/api/folders', { name, parentId }),
  updateFolder: (id, patch) => req('PATCH', `/api/folders/${id}`, patch),
  deleteFolder: (id) => req('DELETE', `/api/folders/${id}`),

  // notebooks
  listNotebooks: () => req('GET', '/api/notebooks'),
  createNotebook: (title, folderId = null, background = 'blank') =>
    req('POST', '/api/notebooks', { title, folderId, background }),
  updateNotebook: (id, patch) => req('PATCH', `/api/notebooks/${id}`, patch),
  deleteNotebook: (id) => req('DELETE', `/api/notebooks/${id}`),
  listTags: () => req('GET', '/api/tags'),

  // pages
  listPages: (notebookId) => req('GET', `/api/notebooks/${notebookId}/pages`),
  createPage: (notebookId, opts) => req('POST', `/api/notebooks/${notebookId}/pages`, opts),
  getPage: (id) => req('GET', `/api/pages/${id}`),
  savePage: (id, patch) => req('PUT', `/api/pages/${id}`, patch),
  // Autosave path: serializes in chunks (see stringifyContent) and skips
  // parsing the response, which is never used — a multi-MB JSON.parse on the
  // main thread would jank the pen just like the stringify would.
  async savePageContent(id, content) {
    const body = await stringifyContent(content);
    const res = await fetch(`/api/pages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
  },
  movePage: (id, dir) => req('POST', `/api/pages/${id}/move`, { dir }),
  deletePage: (id) => req('DELETE', `/api/pages/${id}`),

  // files
  uploadPdf: (file) =>
    fetch('/api/upload/pdf', { method: 'POST', body: makeFormData(file) }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
  pdfUrl: (id) => `/api/pdfs/${id}/file`,

  // search
  search: (q) => req('GET', `/api/search?q=${encodeURIComponent(q)}`),
};

function makeFormData(file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return fd;
}
