// Hidden window: renders each page of a PDF (made from a PowerPoint file) to a 1920px-wide PNG.
import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
const api = window.lecternPdf;

(async () => {
  try {
    const data = await api.data();
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1920 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await api.page(n, new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
    }
    api.done(doc.numPages);
  } catch (e) {
    api.fail(String(e && e.message || e));
  }
})();
