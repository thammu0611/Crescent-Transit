// Reading an uploaded bus document on the server, for the phone app (the web
// app reads files in the browser): a PDF's text layer, or OCR on a photo, then
// the same recognition as everywhere else (shared/docscan.js). Nothing leaves
// this server and the file is not kept.
import path from 'node:path';
import { createRequire } from 'node:module';
import { readDocument } from '../shared/docscan.js';
import { HttpError } from './auth.js';

const require = createRequire(import.meta.url);
const MAX_BYTES = 8 * 1024 * 1024;
const KINDS = ['INSURANCE', 'FITNESS', 'PERMIT', 'PUC', 'SERVICE', 'FUEL'];

// One OCR worker, made on first use and kept: starting one takes a few seconds.
let ocrWorker = null;
async function ocr(buffer) {
  if (!ocrWorker) {
    const { createWorker } = await import('tesseract.js');
    const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
    ocrWorker = createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
  }
  const worker = await ocrWorker;
  const { data } = await worker.recognize(buffer);
  return data.text ?? '';
}

async function pdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}${path.sep}`;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 3); i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 4) text += '\n';
      text += `${item.str} `;
      lastY = y;
    }
    text += '\n';
  }
  await doc.destroy();
  return text;
}

/** { data: base64, mimeType, name, kind? } -> what the document says (readDocument's result). */
export async function readUploadedDocument(body = {}) {
  const b64 = String(body.data ?? '').replace(/^data:[^,]*,/, '');
  if (!b64) throw new HttpError(400, 'Choose a file');
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'That file is larger than 8 MB. Use a smaller photo or PDF.');
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const type = String(body.mimeType ?? '').toLowerCase();
  const name = String(body.name ?? '').toLowerCase();
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf') || buffer.subarray(0, 5).toString() === '%PDF-';
  let text;
  if (isPdf) {
    text = await pdfText(buffer);
    if (text.replace(/\s/g, '').length < 40) {
      // A scanned PDF has no text to read here; a photo of the page works.
      return { kind, scanned: true, confidence: 'none', message: 'This PDF is a scan. Take a photo of the page instead.' };
    }
  } else if (type.startsWith('image/') || /\.(jpe?g|png|webp|heic|bmp)$/.test(name)) {
    text = await ocr(buffer);
  } else {
    throw new HttpError(400, 'Choose a PDF or a photo of the document');
  }
  return { ...readDocument(text, kind), text: text.slice(0, 4000) };
}
