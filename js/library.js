// ===== Deck Library =====
const Library = (() => {
  // Contract into App's private state, provided via init().
  let onOpen = () => {};
  let getActiveId = () => null;
  let onActiveDeckGone = () => {};
  let onRenamed = () => {};
  let showToast = () => {};

  function init(opts) {
    onOpen = opts.onOpen;
    getActiveId = opts.getActiveId;
    onActiveDeckGone = opts.onActiveDeckGone;
    onRenamed = opts.onRenamed;
    showToast = opts.showToast;
    // Close any open deck kebab menu on outside clicks.
    document.addEventListener('click', () => {
      document.querySelectorAll('.deck-menu').forEach(m => { m.style.display = 'none'; });
    });
  }

  let librarySearch = '';

  function render() {
    const wrap = document.getElementById('deck-library');
    if (!wrap) return;
    const allDecks = Decks.list();
    if (!allDecks.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; librarySearch = ''; return; }
    wrap.style.display = 'block';
    const T = i18n.t;
    const q = librarySearch.trim().toLocaleLowerCase('tr');
    const decks = q
      ? allDecks.filter(d => ((d.data && d.data.title) || '').toLocaleLowerCase('tr').includes(q))
      : allDecks;
    let html = `<div class="deck-library-head">
      <span class="deck-library-title">${T('yourDecks')}</span>
      <span class="deck-library-tools">
        ${allDecks.length > 4 ? `<input type="text" id="deck-search" class="deck-search" placeholder="${T('searchDecks')}" value="${escText(librarySearch)}">` : ''}
        <button class="btn-ghost deck-sync-btn" id="deck-sync-btn">&#10227; ${T('syncTitle')}</button>
        <button class="btn-ghost deck-sync-btn" id="deck-backup-btn">&#128190; ${T('backupBtn')}</button>
      </span>
    </div><div class="deck-library-grid">`;
    decks.forEach((d, idx) => {
      const data = d.data || {};
      const cardList = Array.isArray(data.flashcards) ? data.flashcards : [];
      const cards = cardList.length;
      const qs = Array.isArray(data.quiz) ? data.quiz.length : 0;
      const now = Date.now();
      // Due + mastery for this specific deck without switching active.
      const due = Object.values(d.srs || {}).filter(s => s && s.due && s.due <= now).length;
      const ids = new Set(cardList.map(c => String(c.id)));
      const masteredCount = Object.entries(d.srs || {})
        .filter(([id, s]) => ids.has(id) && s && s.due > now).length;
      const pct = cards ? Math.round((masteredCount / cards) * 100) : 0;
      html += `
        <div class="deck-card fade-up" data-id="${d.id}" role="button" tabindex="0" style="--i:${idx}">
          <div class="deck-ring-wrap" title="${pct}%">
            <svg class="deck-ring" viewBox="0 0 36 36">
              <circle class="deck-ring-bg" cx="18" cy="18" r="15.5"/>
              <circle class="deck-ring-fill" cx="18" cy="18" r="15.5" pathLength="100" style="--pct:${pct}"/>
            </svg>
            <span class="deck-ring-num">${pct}%</span>
          </div>
          <div class="deck-card-body">
            <h3 class="deck-card-title">${escText(data.title || T('importedSet'))}</h3>
            <div class="deck-card-meta">
              <span>${T('cardsN', { n: cards })}</span>
              <span>&middot;</span>
              <span>${T('questionsN', { n: qs })}</span>
              ${due ? `<span class="deck-card-due">${T('dueN', { n: due })}</span>` : ''}
            </div>
          </div>
          <button class="deck-card-menu-btn" data-menu="${d.id}" aria-label="${T('deckActions')}" title="${T('deckActions')}" aria-haspopup="menu">&#8943;</button>
          <div class="deck-menu" data-menu-for="${d.id}" role="menu" style="display:none">
            <button data-act="rename" data-id="${d.id}" role="menuitem">${T('renameDeck')}</button>
            <button data-act="duplicate" data-id="${d.id}" role="menuitem">${T('duplicateDeck')}</button>
            <button data-act="export" data-id="${d.id}" role="menuitem">${T('allJson')}</button>
            <button data-act="delete" data-id="${d.id}" class="deck-menu-danger" role="menuitem">${T('deleteDeck')}</button>
          </div>
        </div>`;
    });
    html += `</div>`;
    if (q && !decks.length) html += `<p class="deck-search-empty">${T('searchNoResults')}</p>`;
    wrap.innerHTML = html;

    const syncBtn = document.getElementById('deck-sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', () => Sync.openModal());
    const backupBtn = document.getElementById('deck-backup-btn');
    if (backupBtn) backupBtn.addEventListener('click', () => Export.backupAll());

    // Search field keeps focus across re-renders.
    const search = document.getElementById('deck-search');
    if (search) {
      search.addEventListener('input', () => {
        const pos = search.selectionStart;
        librarySearch = search.value;
        render();
        const again = document.getElementById('deck-search');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
    }

    wrap.querySelectorAll('.deck-card').forEach(el => {
      const id = el.dataset.id;
      const open = () => onOpen(id);
      el.addEventListener('click', (e) => {
        if (!e.target.closest('[data-menu], .deck-menu')) open();
      });
      el.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); open(); }
      });
    });

    // Kebab menus: one open at a time; a persistent document listener
    // (registered once in init) closes them on any outside click.
    const closeMenus = () => wrap.querySelectorAll('.deck-menu').forEach(m => { m.style.display = 'none'; });
    wrap.querySelectorAll('[data-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = wrap.querySelector(`[data-menu-for="${btn.dataset.menu}"]`);
        const isOpen = menu.style.display !== 'none';
        closeMenus();
        menu.style.display = isOpen ? 'none' : 'block';
      });
    });

    wrap.querySelectorAll('.deck-menu button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenus();
        deckMenuAction(btn.dataset.act, btn.dataset.id);
      });
    });
  }

  function deckMenuAction(act, id) {
    const T = i18n.t;
    const deck = Decks.get(id);
    if (!deck) return;
    if (act === 'rename') {
      const title = prompt(T('renamePrompt'), (deck.data && deck.data.title) || '');
      if (title && title.trim()) {
        Decks.rename(id, title);
        if (getActiveId() === id) onRenamed(id, title);
        render();
      }
    } else if (act === 'duplicate') {
      Decks.duplicate(id);
      render();
      showToast(T('deckDuplicated'), 'success');
    } else if (act === 'export') {
      const data = deck.data || {};
      Export.downloadFile(JSON.stringify(data, null, 2), `${Export.sanitize(data.title)}_study_set.json`, 'application/json');
      showToast(T('jsonExported'), 'success');
    } else if (act === 'delete') {
      Decks.remove(id);
      if (getActiveId() === id) onActiveDeckGone(id);
      render();
      showToast(T('deckDeleted'), 'info');
    }
  }

  function escText(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  return { init, render };
})();
