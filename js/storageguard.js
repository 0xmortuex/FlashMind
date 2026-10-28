// ===== Storage guard =====
// Decks live in localStorage (~5 MB for everything). A ready-made MEB set is 115-220 KB, so about 33 of
// them fill it; the 33rd used to open, fail to save and be lost on reload. Before a set, scenario or
// whole-course notebook is created, ensureRoom(bytes) checks that a write of that size fits. If it does
// not, the user gets a dialog with their saved decks by size and a delete button per deck, and
// "Open without saving" as an explicit choice; that choice leaves a banner that stays up.
const StorageGuard = (() => {
  const T = (k, p) => i18n.t(k, p);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = n => Math.max(1, Math.round(n / 1024));

  // True when `chars` more characters fit: a probe key is written and removed again.
  function fits(chars) {
    const key = '__fm_guard_probe';
    try {
      localStorage.setItem(key, 'x'.repeat(chars));
      localStorage.removeItem(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  const decksBySize = () => Decks.list().map(d => ({ id: d.id, title: (d.data && d.data.title) || d.id, size: JSON.stringify(d).length }))
    .sort((a, b) => b.size - a.size);

  // The dialog; resolves 'ok' (room now), 'anyway' or 'cancel'. Replaceable in tests.
  let ask = need => new Promise(resolve => {
    const modal = PastPaper.makeModal('guard-panel');
    let done = false;
    const finish = v => { if (done) return; done = true; modal.close(); resolve(v); };
    const render = () => {
      modal.show(`
        <div class="chk-head"><h3>${esc(T('guardTitle'))}</h3><button class="btn-icon" data-guard="cancel" aria-label="${esc(T('close'))}">&times;</button></div>
        <div class="ex-scroll">
          <p class="chk-intro">${esc(T('guardText', { n: kb(need) }))}</p>
          <ul class="meb-list">${decksBySize().map(d => `<li class="meb-row"><div class="meb-row-title">${esc(d.title)}</div>
            <div class="meb-actions"><span class="meb-stats">${kb(d.size)} KB</span>
            <button class="btn-ghost" data-guard="delete" data-id="${esc(d.id)}">${esc(T('guardDelete'))}</button></div></li>`).join('')}</ul>
          <div class="meb-actions"><button class="btn-ghost" data-guard="anyway">${esc(T('guardAnyway'))}</button>
            <button class="btn-ghost" data-guard="cancel">${esc(T('guardCancel'))}</button></div>
        </div>`);
      modal.el.onclick = e => {
        const b = e.target.closest('[data-guard]');
        if (e.target === modal.el) return finish('cancel');
        if (!b) return;
        if (b.dataset.guard === 'delete') { Decks.remove(b.dataset.id); if (fits(need)) finish('ok'); else render(); }
        else finish(b.dataset.guard);
      };
    };
    render();
  });

  let banner = null;
  function warnUnsaved() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'storage-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = T('guardBanner');
    document.body.appendChild(banner);
  }

  // Resolves true to go on (room, or the user chose to open without saving), false when cancelled.
  async function ensureRoom(bytes) {
    if (fits(bytes)) return true;
    const choice = await ask(bytes);
    if (choice === 'anyway') { warnUnsaved(); return true; }
    return choice === 'ok';
  }

  return { ensureRoom, fits, decksBySize, setAsk: fn => { ask = fn; } };
})();
