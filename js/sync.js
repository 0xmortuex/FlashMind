// ===== Sync Module =====
// Account-less device sync: the whole library (decks + stats) is stored in
// the worker's KV under a private random code. Enable on one device, enter
// the code on another; changes push automatically (debounced) and pull on
// every app load. The code is a bearer secret — treat it like a password.
const Sync = (() => {
  const KEY = 'flashmind_sync_v1';
  let cfg = null, pushTimer = null, syncing = false;
  let modal = null, releaseTrap = null;

  function load() {
    if (!cfg) {
      try { cfg = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { cfg = {}; }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
      if (typeof cfg.code !== 'string') delete cfg.code;
    }
    return cfg;
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(cfg)); }
  function enabled() { return !!load().code; }

  function payload() {
    return {
      decks: localStorage.getItem('flashmind_decks_v1') || '{"decks":{}}',
      stats: localStorage.getItem('flashmind_stats_v1') || '{}',
      t: Date.now()
    };
  }

  async function push() {
    load();
    const res = await API.syncPush(cfg.code, payload());
    cfg.code = res.code;
    cfg.lastSync = Date.now();
    save();
  }

  async function pull() {
    load();
    if (!cfg.code) return false;
    const remote = await API.syncPull(cfg.code);
    const active = Decks.getActive();
    const changedDecks = Decks.mergeRemote(remote.decks);
    Stats.mergeRemote(remote.stats);
    cfg.lastSync = Date.now();
    save();
    if (changedDecks && typeof App !== 'undefined') App.refreshLibrary(active && active !== Decks.get(active.id));
    return changedDecks;
  }

  let pendingPush = false;
  let operation = null;
  let disabling = false;

  async function runSync(action) {
    if (syncing || disabling) return;
    clearTimeout(pushTimer);
    syncing = true;
    operation = (async () => action())();
    try { return await operation; }
    finally {
      operation = null;
      syncing = false;
      if (pendingPush && !disabling) { pendingPush = false; schedulePush(); }
      renderModalBody();
    }
  }

  // A local edit made during an in-flight upload must get its own upload.
  function schedulePush() {
    if (!enabled() || disabling) return;
    if (syncing) { pendingPush = true; return; }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      runSync(async () => { await pull(); await push(); }).catch(() => {});
    }, 4000);
  }

  async function syncNow() {
    if (!enabled()) return;
    try {
      await runSync(async () => { await pull(); await push(); });
      App.showToast(i18n.t('syncDone'), 'success');
    } catch (e) { App.showToast(i18n.t('syncFailed') + ' ' + e.message, 'error'); }
  }

  async function enable() {
    try {
      await runSync(push);
      App.showToast(i18n.t('syncEnabled'), 'success');
    } catch (e) { App.showToast(i18n.t('syncFailed') + ' ' + e.message, 'error'); }
  }

  async function enterCode() {
    if (syncing || disabling) return;
    const code = (prompt(i18n.t('syncEnterPrompt')) || '').trim().toLowerCase();
    if (!code) return;
    const prevCode = load().code;
    try {
      await runSync(async () => {
        cfg.code = code;
        try { await pull(); }
        catch (e) { cfg.code = prevCode; throw e; }
        await push();
      });
      App.showToast(i18n.t('syncDone'), 'success');
    } catch (e) { App.showToast(i18n.t('syncFailed') + ' ' + e.message, 'error'); }
  }

  async function disable() {
    if (disabling) return;
    disabling = true;
    clearTimeout(pushTimer);
    try {
      // Wait for any upload to settle before deleting its cloud copy.
      if (operation) await operation.catch(() => {});
      if (load().code) await API.syncDelete(cfg.code);
      cfg = {};
      save();
      pendingPush = false;
      App.showToast(i18n.t('syncDisabled'), 'info');
    } catch (e) {
      App.showToast(i18n.t('syncFailed') + ' ' + e.message, 'error');
    } finally { disabling = false; renderModalBody(); }
  }

  // ----- Modal UI -----
  function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML.replace(/"/g, '&quot;'); }

  function buildModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'shortcuts-backdrop';
    modal.style.display = 'none';
    modal.innerHTML = `<div class="shortcuts-card sync-card" role="dialog" aria-modal="true">
      <h3>${esc(i18n.t('syncTitle'))}</h3>
      <div id="sync-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
    });
  }

  function renderModalBody() {
    if (!modal || modal.style.display === 'none') return;
    const T = i18n.t;
    const body = modal.querySelector('#sync-body');
    load();
    if (!cfg.code) {
      body.innerHTML = `
        <p class="sync-desc">${T('syncDesc')}</p>
        <div class="sync-actions">
          <button class="btn-primary" id="sync-enable-btn">${T('syncEnable')}</button>
          <button class="btn-ghost" id="sync-enter-btn">${T('syncEnter')}</button>
        </div>`;
      body.querySelector('#sync-enable-btn').addEventListener('click', enable);
      body.querySelector('#sync-enter-btn').addEventListener('click', enterCode);
    } else {
      const last = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US') : '—';
      body.innerHTML = `
        <p class="sync-desc">${T('syncCodeLabel')}</p>
        <div class="share-link-row">
          <input type="text" class="share-link-input" id="sync-code-input" readonly value="${esc(cfg.code)}">
          <button class="btn-copy" id="sync-copy-btn">${T('copyLink')}</button>
        </div>
        <p class="sync-warn">${T('syncCodeWarn')}</p>
        <p class="sync-last">${T('syncLast')}: ${esc(last)}</p>
        <div class="sync-actions">
          <button class="btn-primary" id="sync-now-btn"${syncing ? ' disabled' : ''}>${T('syncNow')}</button>
          <button class="btn-ghost" id="sync-disable-btn">${T('syncDisable')}</button>
        </div>`;
      body.querySelector('#sync-copy-btn').addEventListener('click', function () {
        navigator.clipboard.writeText(cfg.code).then(() => {
          this.textContent = i18n.t('copied');
          setTimeout(() => { this.textContent = i18n.t('copyLink'); }, 1500);
        });
      });
      body.querySelector('#sync-now-btn').addEventListener('click', syncNow);
      body.querySelector('#sync-disable-btn').addEventListener('click', disable);
    }
  }

  function openModal() {
    buildModal();
    modal.style.display = 'flex';
    renderModalBody();
    releaseTrap = FX.trapFocus(modal);
  }

  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function init() {
    // Pull once per app load so another device's changes appear.
    if (enabled()) setTimeout(() => { if (enabled()) runSync(async () => { await pull(); await push(); }).catch(() => {}); }, 800);
  }

  return { init, enabled, schedulePush, syncNow, openModal };
})();
