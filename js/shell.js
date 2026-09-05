// ===== App Chrome (theme, shortcuts overlay, reading progress) =====
const Shell = (() => {
  // Getters into App's private view state, provided via init().
  let getView = () => 'input';
  let getTab = () => 'notes';

  function init(opts) {
    getView = opts.getView;
    getTab = opts.getTab;
    setupTheme();
    setupReadProgress();
    setupShortcutsOverlay();
  }

  // ===== Theme =====
  // The initial theme is applied by an inline <head> script before first
  // paint; these buttons just flip it and persist the choice. Where the View
  // Transitions API exists, the new theme sweeps out from the button in an
  // expanding circle (see fx.css ::view-transition rules).
  function toggleTheme(originEl) {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('flashmind_theme', next); } catch {}
    };
    if (document.startViewTransition && !FX.reduced()) {
      if (originEl) {
        const r = originEl.getBoundingClientRect();
        document.documentElement.style.setProperty('--tt-x', (r.left + r.width / 2) + 'px');
        document.documentElement.style.setProperty('--tt-y', (r.top + r.height / 2) + 'px');
      }
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  function setupTheme() {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', () => toggleTheme(btn));
    });
  }

  // ===== Notes reading progress =====
  // Thin gradient bar under the topbar that fills as you scroll the notes.
  let readBar = null;

  function setupReadProgress() {
    readBar = document.createElement('div');
    readBar.className = 'read-progress';
    document.querySelector('.topbar').appendChild(readBar);
    window.addEventListener('scroll', updateReadProgress, { passive: true });
  }

  function updateReadProgress() {
    if (!readBar) return;
    if (getView() !== 'study' || getTab() !== 'notes') { readBar.style.width = '0%'; return; }
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    readBar.style.width = max > 40 ? Math.min(100, (h.scrollTop / max) * 100) + '%' : '0%';
  }

  // ===== Keyboard shortcuts overlay (press ?) =====
  let shortcutsEl = null;

  function buildShortcuts() {
    if (shortcutsEl) return;
    const T = i18n.t;
    const rows = [
      ['Ctrl + K', T('scPalette')],
      ['Ctrl + Enter', T('scGenerate')],
      ['Space', T('scFlip')],
      ['1 / 2 / 3', T('scRate')],
      ['A – E', T('scAnswer')],
      ['Enter', T('scNext')],
      ['Esc', T('scEsc')],
      ['?', T('shortcutsTitle')]
    ];
    shortcutsEl = document.createElement('div');
    shortcutsEl.className = 'shortcuts-backdrop';
    shortcutsEl.style.display = 'none';
    shortcutsEl.innerHTML = `
      <div class="shortcuts-card" role="dialog" aria-modal="true">
        <h3>${T('shortcutsTitle')}</h3>
        ${rows.map(([k, d]) => `<div class="shortcut-row"><span>${d}</span><kbd>${k}</kbd></div>`).join('')}
      </div>`;
    document.body.appendChild(shortcutsEl);
    shortcutsEl.addEventListener('click', (e) => { if (e.target === shortcutsEl) toggleShortcuts(false); });
  }

  let releaseShortcutsTrap = null;

  function toggleShortcuts(force) {
    buildShortcuts();
    const show = force !== undefined ? force : shortcutsEl.style.display === 'none';
    shortcutsEl.style.display = show ? 'flex' : 'none';
    if (show) releaseShortcutsTrap = FX.trapFocus(shortcutsEl);
    else if (releaseShortcutsTrap) { releaseShortcutsTrap(); releaseShortcutsTrap = null; }
  }

  function setupShortcutsOverlay() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && shortcutsEl && shortcutsEl.style.display !== 'none') { toggleShortcuts(false); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.key === '?') { e.preventDefault(); toggleShortcuts(); }
    });
  }

  return { init, toggleTheme, toggleShortcuts, updateReadProgress };
})();
