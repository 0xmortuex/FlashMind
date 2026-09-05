// ===== Community Gallery =====
// Publicly listed shared decks (opt-in via the share modal). The section on
// the home screen stays hidden unless the worker returns entries — offline,
// an old worker, or an empty gallery all just mean "no section".
const Gallery = (() => {
  function init() {
    // Off the critical path: the home screen renders first, gallery follows.
    setTimeout(() => { load().catch(() => { /* stay hidden */ }); }, 1200);
  }

  async function load() {
    const wrap = document.getElementById('gallery-section');
    if (!wrap) return;
    const list = await API.gallery();
    if (!list.length) return;
    const T = i18n.t;
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="deck-library-head">
        <span class="deck-library-title">&#127757; ${T('galleryTitle')}</span>
        <span class="gallery-hint">${T('galleryHint')}</span>
      </div>
      <div class="gallery-grid">` +
      list.map((e, i) => `
        <button class="gallery-card fade-up" style="--i:${Math.min(i, 12)}" data-code="${esc(e.code)}">
          <span class="gallery-card-title">${esc(e.title)}</span>
          <span class="gallery-card-meta">
            ${T('cardsN', { n: e.cards || 0 })} &middot; ${T('questionsN', { n: e.questions || 0 })}
            <span class="gallery-lang">${esc((e.lang || 'en').toUpperCase())}</span>
          </span>
        </button>`).join('') +
      '</div>';
    wrap.querySelectorAll('.gallery-card').forEach(btn =>
      btn.addEventListener('click', () => App.openSharedCode(btn.dataset.code)));
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  return { init, load };
})();
