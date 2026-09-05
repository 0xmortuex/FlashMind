// ===== PDF Module =====
const PDF = (() => {

  function init() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  async function extractText(file, onProgress) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js not loaded');
    }
    // The CDN script is deferred, so it may load after this module ran init().
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) init();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    const totalPages = pdf.numPages;
    let fullText = '';

    try {
      for (let i = 1; i <= totalPages; i++) {
        if (onProgress) onProgress(i, totalPages);

        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n--- Page ' + i + ' ---\n\n';
        page.cleanup();
      }

      return { text: fullText.trim(), pages: totalPages };
    } finally { await pdf.destroy(); }
  }

  init();
  return { extractText };
})();
