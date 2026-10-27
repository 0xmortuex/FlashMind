// ===== Handwritten answers for open-ended exam questions =====
// Instead of typing a klasik answer, the student photographs what they wrote
// on paper. The photo is read with the existing OCR module (tesseract.js,
// lazy-loaded), the recognised text lands in the answer box next to a
// thumbnail of the photo so OCR slips can be corrected, and the normal
// Submit button grades it through the usual API.grade path.
const Handwrite = (() => {
  const T = (k, p) => i18n.t(k, p);
  let lastUrl = null;

  function buttonHtml() {
    if (typeof OCR === 'undefined') return '';
    return `<div class="hw-row">
        <button type="button" class="btn-ghost hw-btn" data-hw-act="photo">&#128247; ${T('hwPhoto')}</button>
        <input type="file" class="hw-file" accept="image/*" hidden>
      </div>
      <div class="hw-status" aria-live="polite"></div>`;
  }

  function spinner() {
    return '<svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>';
  }

  async function read(file, area) {
    const ta = area.querySelector('#oe-answer');
    const status = area.querySelector('.hw-status');
    const btn = area.querySelector('.hw-btn');
    if (!ta || ta.disabled || !status) return;
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
    if (btn) btn.disabled = true;
    status.innerHTML = `<div class="hw-progress">${spinner()}<span>${T('hwReading', { p: 0 })}</span></div>`;
    try {
      const text = await OCR.extractText(file, p => {
        const s = status.querySelector('.hw-progress span');
        if (s) s.textContent = T('hwReading', { p: Math.round(p * 100) });
      });
      // The student may have moved on (or submitted) while OCR ran.
      if (!document.body.contains(ta) || ta.disabled) return;
      if (text) ta.value = ta.value.trim() ? ta.value.trim() + '\n' + text : text;
      lastUrl = URL.createObjectURL(file);
      status.innerHTML = `<div class="hw-result">
          <img class="hw-thumb" src="${lastUrl}" alt="${T('hwThumbAlt')}">
          <p class="hw-hint">${text ? T('hwCheck') : T('hwEmpty')}</p>
        </div>`;
      ta.classList.add('hw-filled');
      ta.focus();
    } catch (err) {
      if (document.body.contains(status)) status.innerHTML = `<p class="hw-hint hw-error">${T('ocrFailed')} ${err && err.message ? String(err.message).replace(/[<>&]/g, '') : ''}</p>`;
    } finally {
      if (btn && document.body.contains(btn)) btn.disabled = false;
    }
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-hw-act="photo"]');
      if (!b || b.disabled) return;
      const area = b.closest('.open-ended-area');
      const input = area && area.querySelector('.hw-file');
      if (input) { input.value = ''; input.click(); }
    });
    document.addEventListener('change', e => {
      const input = e.target;
      if (!input || !input.classList || !input.classList.contains('hw-file')) return;
      const file = input.files && input.files[0];
      const area = input.closest('.open-ended-area');
      if (file && area) read(file, area);
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  return { buttonHtml, read };
})();
