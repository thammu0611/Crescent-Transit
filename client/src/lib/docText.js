// The text of an uploaded document, read in the browser (nothing is uploaded):
// a PDF's own text layer when it has one, otherwise OCR on the page images or
// the photo. Both libraries load only when someone actually picks a file.

const MAX_PAGES = 3;

/** OCR on an image, canvas or file. `onProgress(0..1)`. */
async function ocr(image, onProgress) {
  const { createWorker } = await import('tesseract.js');
  // Engine, worker and English data come from this server (/ocr), not a CDN.
  const worker = await createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

async function pdfText(file, onProgress) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(doc.numPages, MAX_PAGES);
  let text = '';
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Keep line breaks where the PDF moves down a line, so labels stay next to their values.
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 4) text += '\n';
      text += `${item.str} `;
      lastY = y;
    }
    text += '\n';
  }
  if (text.replace(/\s/g, '').length >= 40) return text;
  // A scanned PDF: draw its pages and read them.
  let scanned = '';
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    scanned += `${await ocr(canvas, (p) => onProgress?.((i - 1 + p) / pages))}\n`;
  }
  return scanned;
}

/** The text of a PDF or image file. Throws a plain-language error for anything else. */
export async function documentText(file, onProgress) {
  const name = file.name?.toLowerCase() ?? '';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfText(file, onProgress);
  if (file.type.startsWith('image/')) return ocr(file, onProgress);
  throw new Error('Choose a PDF or a photo of the document');
}
