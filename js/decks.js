// ===== Decks Module =====
// Multi-deck library persisted in localStorage. Each deck holds a full study
// set (notes/flashcards/quiz), its source text, and per-card SM-2 state.
const Decks = (() => {
  const STORE_KEY = 'flashmind_decks_v1';
  // Legacy single-set keys (pre-library versions) — migrated on first load.
  const LEGACY_DATA = 'flashmind_data';
  const LEGACY_TEXT = 'flashmind_text';

  let store = null; // { decks: {id: deck}, activeId }

  function load() {
    if (store) return store;
    try {
      store = JSON.parse(localStorage.getItem(STORE_KEY)) || null;
    } catch (e) { store = null; }
    if (!store || typeof store.decks !== 'object') store = { decks: {}, activeId: null };
    migrateLegacy();
    return store;
  }

  function migrateLegacy() {
    const legacy = localStorage.getItem(LEGACY_DATA);
    if (!legacy) return;
    try {
      const data = JSON.parse(legacy);
      if (data && data.title) {
        const deck = createDeck(data, localStorage.getItem(LEGACY_TEXT) || '');
        store.activeId = deck.id;
        persist();
      }
    } catch (e) { /* corrupt legacy data — drop it */ }
    localStorage.removeItem(LEGACY_DATA);
    localStorage.removeItem(LEGACY_TEXT);
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      // Quota exceeded — drop the oldest non-active deck and retry once.
      const oldest = list().filter(d => d.id !== store.activeId).pop();
      if (oldest) {
        delete store.decks[oldest.id];
        try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e2) { /* give up */ }
      }
    }
  }

  function newId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function createDeck(data, originalText) {
    load();
    const now = Date.now();
    const deck = { id: newId(), createdAt: now, updatedAt: now, data, originalText: originalText || '', srs: {} };
    store.decks[deck.id] = deck;
    return deck;
  }

  // ----- Public API -----

  // Save a study set. If `deckId` matches an existing deck it's updated in
  // place (append flow); otherwise a new deck is created. Returns the deck.
  function save(data, originalText, deckId) {
    load();
    let deck = deckId && store.decks[deckId];
    if (deck) {
      deck.data = data;
      deck.originalText = originalText || deck.originalText;
      deck.updatedAt = Date.now();
    } else {
      deck = createDeck(data, originalText);
    }
    store.activeId = deck.id;
    persist();
    return deck;
  }

  function get(id) { load(); return store.decks[id] || null; }
  function getActive() { load(); return store.activeId ? store.decks[store.activeId] : null; }
  function setActive(id) { load(); if (store.decks[id]) { store.activeId = id; persist(); } }

  // Decks sorted most-recently-updated first.
  function list() {
    load();
    return Object.values(store.decks).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function remove(id) {
    load();
    delete store.decks[id];
    if (store.activeId === id) store.activeId = null;
    persist();
  }

  function touch(id) {
    load();
    const deck = store.decks[id];
    if (deck) { deck.updatedAt = Date.now(); persist(); }
  }

  // ----- SM-2 spaced repetition -----
  // srs[cardId] = { ef, reps, interval (days), due (ms epoch) }

  const DAY = 24 * 60 * 60 * 1000;

  function getSrs(cardId) {
    const deck = getActive();
    return deck ? deck.srs[cardId] || null : null;
  }

  // Apply an SM-2 review. quality: 0-5 (again=1, hard=3, gotit=5).
  function review(cardId, quality) {
    const deck = getActive();
    if (!deck) return null;
    const s = deck.srs[cardId] || { ef: 2.5, reps: 0, interval: 0, due: 0 };
    if (quality < 3) {
      s.reps = 0;
      s.interval = 0;
      s.due = Date.now(); // failed — stays due now
    } else {
      s.reps += 1;
      if (s.reps === 1) s.interval = 1;
      else if (s.reps === 2) s.interval = 6;
      else s.interval = Math.round(s.interval * s.ef);
      s.ef = Math.max(1.3, s.ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      s.due = Date.now() + s.interval * DAY;
    }
    deck.srs[cardId] = s;
    deck.updatedAt = Date.now();
    persist();
    return s;
  }

  // Cards due for review right now (never-seen cards are not "due").
  function dueCards(cards) {
    const deck = getActive();
    if (!deck) return [];
    const now = Date.now();
    return (cards || []).filter(c => {
      const s = deck.srs[c.id];
      return s && s.due <= now;
    });
  }

  // Session status derived from SRS: known & not due => mastered,
  // seen & due => reviewing, never seen => unseen.
  function statusOf(cardId) {
    const s = getSrs(cardId);
    if (!s || s.reps === 0 && !s.due) return 'unseen';
    if (s.due > Date.now()) return 'mastered';
    return 'reviewing';
  }

  return { save, get, getActive, setActive, list, remove, touch, getSrs, review, dueCards, statusOf };
})();
