// ===== Command Palette (Ctrl/Cmd+K) =====
// Quick-jump overlay: study tabs, common actions, and saved decks, filtered
// as you type. Builds its action list fresh on every open so it always
// reflects the current view and deck library.
const Palette = (() => {
  let backdrop = null, input = null, listEl = null;
  let flat = [];   // currently visible items in DOM order
  let sel = 0;
  let releaseTrap = null;

  function isOpen() { return !!backdrop && backdrop.style.display !== 'none'; }

  function build() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    backdrop.style.display = 'none';
    backdrop.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true">
        <input type="text" class="palette-input" autocomplete="off" spellcheck="false">
        <div class="palette-list"></div>
        <div class="palette-footer">
          <span><kbd>&uarr;&darr;</kbd></span>
          <span><kbd>Enter</kbd></span>
          <span><kbd>Esc</kbd></span>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    input = backdrop.querySelector('.palette-input');
    listEl = backdrop.querySelector('.palette-list');

    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    input.addEventListener('input', () => { sel = 0; renderList(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    });
  }

  // A click on a visible tab/button keeps behavior in sync with the UI even
  // if module internals change, so most actions just click the real control.
  function click(id) { const el = document.getElementById(id); if (el) el.click(); }

  function getActions() {
    const T = i18n.t;
    const inStudy = document.getElementById('study-view').classList.contains('active');
    const items = [];

    if (inStudy) {
      [['notes', 'tabNotes'], ['flashcards', 'tabFlashcards'], ['quiz', 'tabQuiz'], ['stats', 'tabStats'], ['chat', 'tabChat']]
        .forEach(([tab, key]) => items.push({
          section: T('paletteNav'), label: T(key), run: () => App.switchTab(tab)
        }));
      items.push({ section: T('paletteActions'), label: T('startStudy'), run: () => { App.switchTab('flashcards'); Flashcards.startStudy('all'); } });
      items.push({ section: T('paletteActions'), label: T('startExam'), run: () => App.switchTab('quiz') });
      items.push({ section: T('paletteActions'), label: T('share'), run: () => click('share-btn') });
      items.push({ section: T('paletteActions'), label: T('allJson'), run: () => Export.allJSON() });
      items.push({ section: T('paletteActions'), label: T('addMaterials'), run: () => click('add-material-btn') });
      items.push({ section: T('paletteActions'), label: T('newMaterial'), run: () => click('new-material-btn') });
    } else {
      items.push({ section: T('paletteActions'), label: T('tryExample'), run: () => click('demo-btn') });
    }

    items.push({ section: T('paletteActions'), label: T('cmdToggleTheme'), run: () => App.toggleTheme() });
    items.push({ section: T('paletteActions'), label: T('cmdToggleSound'), run: () => Sound.toggle() });
    items.push({ section: T('paletteActions'), label: T('shortcutsTitle'), hint: '?', run: () => App.toggleShortcuts(true) });
    items.push({ section: T('paletteActions'), label: T('syncTitle'), run: () => Sync.openModal() });
    items.push({ section: T('paletteActions'), label: T('backupBtn'), run: () => Export.backupAll() });

    if (typeof Decks !== 'undefined') {
      Decks.list().forEach(d => {
        const title = (d.data && d.data.title) || T('importedSet');
        const n = d.data && Array.isArray(d.data.flashcards) ? d.data.flashcards.length : 0;
        items.push({
          section: T('yourDecks'), label: title, hint: T('cardsN', { n }),
          run: () => App.openDeck(d.id)
        });
      });
    }
    return items;
  }

  function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }

  function renderList() {
    const q = input.value.trim().toLocaleLowerCase(i18n.getLang() === 'tr' ? 'tr' : 'en');
    flat = getActions().filter(a => !q || a.label.toLocaleLowerCase('tr').includes(q) || a.label.toLowerCase().includes(q));
    if (!flat.length) {
      listEl.innerHTML = `<div class="palette-empty">${esc(i18n.t('paletteNoResults'))}</div>`;
      return;
    }
    let html = '', lastSection = null;
    flat.forEach((a, i) => {
      if (a.section !== lastSection) { html += `<div class="palette-section">${esc(a.section)}</div>`; lastSection = a.section; }
      html += `<button class="palette-item ${i === sel ? 'selected' : ''}" data-i="${i}">
        <span>${esc(a.label)}</span>${a.hint ? `<span class="palette-item-hint">${esc(a.hint)}</span>` : ''}
      </button>`;
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll('.palette-item').forEach(el => {
      el.addEventListener('click', () => run(parseInt(el.dataset.i)));
      el.addEventListener('mousemove', () => { const i = parseInt(el.dataset.i); if (i !== sel) { sel = i; highlight(); } });
    });
  }

  function highlight() {
    listEl.querySelectorAll('.palette-item').forEach(el => {
      const active = parseInt(el.dataset.i) === sel;
      el.classList.toggle('selected', active);
      if (active) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function move(delta) {
    if (!flat.length) return;
    sel = (sel + delta + flat.length) % flat.length;
    highlight();
  }

  function run(i) {
    const action = flat[i];
    if (!action) return;
    close();
    Sound.play('click');
    action.run();
  }

  function open() {
    build();
    input.value = '';
    input.placeholder = i18n.t('palettePlaceholder');
    input.setAttribute('aria-label', i18n.t('palettePlaceholder'));
    sel = 0;
    backdrop.style.display = 'flex';
    renderList();
    releaseTrap = FX.trapFocus(backdrop);
    input.focus();
  }

  function close() {
    if (backdrop) backdrop.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function init() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        isOpen() ? close() : open();
      } else if (e.key === 'Escape' && isOpen()) {
        e.stopPropagation();
        close();
      }
    }, true); // capture so Esc closes the palette before study-mode handlers see it
  }

  return { init, open, close };
})();
