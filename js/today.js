// ===== Today — cross-deck review queue, app badge, due notification =====
// FSRS schedules live per deck; this module aggregates every due card in the
// library into one "review everything due today" session, keeps the PWA app
// badge in sync with the total, and (opt-in) fires one local notification per
// day when the app opens with reviews waiting.
const Today = (() => {
  const NOTIFY_KEY = 'flashmind_notify';
  const NOTIFIED_KEY = 'flashmind_notified_day';

  function dueItems() {
    return typeof Decks !== 'undefined' ? Decks.dueAcrossDecks() : [];
  }

  function start() {
    const items = dueItems().map(d =>
      Object.assign({}, d.card, { _deckId: d.deckId, _deckTitle: d.deckTitle }));
    Flashcards.startQueue(items);
  }

  // PWA app-icon badge with the total due count (no-op where unsupported).
  function updateBadge() {
    if (!('setAppBadge' in navigator)) return;
    const n = dueItems().length;
    try {
      if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
    } catch (e) { /* badge is best-effort */ }
  }

  function notifyEnabled() {
    return localStorage.getItem(NOTIFY_KEY) === '1' &&
      'Notification' in window && Notification.permission === 'granted';
  }

  async function toggleNotify() {
    if (notifyEnabled()) {
      localStorage.setItem(NOTIFY_KEY, '0');
      App.showToast(i18n.t('notifyOff'), 'info');
    } else {
      if (!('Notification' in window)) { App.showToast(i18n.t('notifyUnsupported'), 'error'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { App.showToast(i18n.t('notifyDenied'), 'error'); return; }
      localStorage.setItem(NOTIFY_KEY, '1');
      App.showToast(i18n.t('notifyOn'), 'success');
    }
    if (typeof Library !== 'undefined') Library.render();
  }

  // One local notification per day, fired when the app opens with due cards.
  // (True background push would need a server; this is the account-less version.)
  function maybeNotify() {
    if (!notifyEnabled()) return;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(NOTIFIED_KEY) === today) return;
    const n = dueItems().length;
    if (!n) return;
    localStorage.setItem(NOTIFIED_KEY, today);
    try {
      new Notification('FlashMind', { body: i18n.t('dueReminder', { n }) });
    } catch (e) { /* some platforms only allow SW notifications — skip */ }
  }

  function init() {
    updateBadge();
    setTimeout(maybeNotify, 1500);
  }

  return { init, start, updateBadge, dueItems, notifyEnabled, toggleNotify };
})();
