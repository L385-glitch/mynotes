import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const docCache = new Map(); // pdfId -> { pdf, pages: Map(key -> canvas) }
const textCache = new Map(); // `${pdfId}:${pageNum}` -> [{x,y,w,h}]

export async function getPdfDoc(pdfId) {
  const cached = docCache.get(pdfId);
  if (cached) return cached.pdf;
  const res = await fetch(`/api/pdfs/${pdfId}/file`);
  if (!res.ok) throw new Error(`failed to load pdf (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  docCache.set(pdfId, { pdf, pages: new Map() });
  return pdf;
}

// Page size in page-coordinate units (96 dpi)
export async function getPageSize(pdfId, pageNum) {
  const pdf = await getPdfDoc(pdfId);
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 96 / 72 });
  return { w: vp.width, h: vp.height };
}

export async function getPageCount(pdfId) {
  const pdf = await getPdfDoc(pdfId);
  return pdf.numPages;
}

// Render a PDF page to an offscreen canvas. `res` = canvas pixels per page-coordinate unit.
export async function renderPdfPage(pdfId, pageNum, res = 2) {
  const entry = docCache.get(pdfId);
  const key = `${pageNum}:${res}`;
  if (entry?.pages.has(key)) return entry.pages.get(key);
  const pdf = await getPdfDoc(pdfId);
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: res * (96 / 72) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (entry) entry.pages.set(key, canvas);
  return canvas;
}

// Text lines on a PDF page as page-coordinate boxes ({x,y,w,h}, 96 dpi, top-left
// origin). Used to snap highlighter swipes onto the underlying text.
export async function getPdfTextLayout(pdfId, pageNum) {
  const key = `${pdfId}:${pageNum}`;
  const cached = textCache.get(key);
  if (cached) return cached;
  const pdf = await getPdfDoc(pdfId);
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 96 / 72 });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = Util.transform(vp.transform, it.transform);
    const fs = Math.hypot(tx[2], tx[3]); // font size in page units
    const baseline = tx[5];
    const scale = it.height ? fs / it.height : 1;
    items.push({ x: tx[4], y: baseline - fs * 0.85, w: it.width * scale, h: fs * 1.15 });
  }
  // Group items into visual lines by vertical center.
  items.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines = [];
  for (const it of items) {
    const cy = it.y + it.h / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(cy - last.cy) < Math.max(it.h, last.h) * 0.7) {
      last.minx = Math.min(last.minx, it.x);
      last.maxx = Math.max(last.maxx, it.x + it.w);
      last.miny = Math.min(last.miny, it.y);
      last.maxy = Math.max(last.maxy, it.y + it.h);
      last.cy = (last.miny + last.maxy) / 2;
    } else {
      lines.push({ minx: it.x, maxx: it.x + it.w, miny: it.y, maxy: it.y + it.h, cy });
    }
  }
  const out = lines.map((l) => ({ x: l.minx, y: l.miny, w: l.maxx - l.minx, h: l.maxy - l.miny }));
  textCache.set(key, out);
  return out;
}
