// ===== OCR Module =====
// Extracts text from photos (textbook pages, handwritten-ish notes) fully
// client-side with tesseract.js. The library (~2MB + language data) is only
// loaded from the CDN when the user actually drops an image.
const OCR = (() => {
  let libPromise = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the OCR library')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // Recognize `file` (an image File/Blob); onProgress gets 0..1 during the
  // recognition phase. UI language first so Turkish diacritics survive.
  async function extractText(file, onProgress) {
    const T = await loadLib();
    const langs = i18n.getLang() === 'tr' ? 'tur+eng' : 'eng+tur';
    const res = await T.recognize(file, langs, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0);
      }
    });
    return ((res.data && res.data.text) || '').trim();
  }

  return { extractText };
})();
