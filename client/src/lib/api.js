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
