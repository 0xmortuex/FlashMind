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
    if (!store.deleted || typeof store.deleted !== 'object') store.deleted = {};
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
    // Device sync rides every persist (debounced inside Sync).
    if (typeof Sync !== 'undefined' && Sync.schedulePush) Sync.schedulePush();
  }

  // Merge a remote deck store (device sync): per deck, newer updatedAt wins.
  // Deletions propagate via tombstones (store.deleted[id] = deletedAt): a
  // tombstone beats any deck edited before it, while an edit made after the
  // deletion revives the deck and drops the tombstone.
  function mergeRemote(remoteJson) {
    load();
    // Prune tombstones older than 90 days — they've long since propagated.
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    Object.keys(store.deleted).forEach(id => {
      if (store.deleted[id] < cutoff) delete store.deleted[id];
    });
    let remote;
    try { remote = typeof remoteJson === 'string' ? JSON.parse(remoteJson) : remoteJson; }
    catch (e) { return false; }
    if (!remote || typeof remote.decks !== 'object') return false;
    let changed = false;
    // Merge tombstone maps first: newest deletion time per deck id wins.
    Object.entries(remote.deleted || {}).forEach(([id, t]) => {
      if (!store.deleted[id] || t > store.deleted[id]) { store.deleted[id] = t; changed = true; }
    });
    Object.values(remote.decks).forEach(rd => {
      if (!rd || !rd.id) return;
      const tomb = store.deleted[rd.id];
      if (tomb && tomb >= (rd.updatedAt || 0)) return; // deleted elsewhere — handled below
      if (tomb) { delete store.deleted[rd.id]; changed = true; } // edited after deletion — revive
      const local = store.decks[rd.id];
      if (!local || (rd.updatedAt || 0) > (local.updatedAt || 0)) {
        store.decks[rd.id] = rd;
        changed = true;
      }
    });
    // Apply tombstones to local decks: a deletion beats older edits.
    Object.keys(store.decks).forEach(id => {
      if (store.deleted[id] && store.deleted[id] >= (store.decks[id].updatedAt || 0)) {
        delete store.decks[id];
        if (store.activeId === id) store.activeId = null;
        changed = true;
      }
    });
    if (changed) persist();
    return changed;
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
    store.deleted[id] = Date.now(); // tombstone so sync propagates the deletion
    if (store.activeId === id) store.activeId = null;
    persist();
  }

  function touch(id) {
    load();
    const deck = store.decks[id];
    if (deck) { deck.updatedAt = Date.now(); persist(); }
  }

  function rename(id, title) {
    load();
    const deck = store.decks[id];
    if (!deck || !title || !title.trim()) return null;
    deck.data = deck.data || {};
    deck.data.title = title.trim();
    deck.updatedAt = Date.now();
    persist();
    return deck;
  }

  // Assign a deck to a folder (empty/null clears it). Folders are plain
  // strings on the deck; the library groups by them at render time.
  function setFolder(id, folder) {
    load();
    const deck = store.decks[id];
    if (!deck) return null;
    const f = (folder || '').trim();
    if (f) deck.folder = f; else delete deck.folder;
    deck.updatedAt = Date.now();
    persist();
    return deck;
  }

  function folders() {
    load();
    const set = new Set();
    Object.values(store.decks).forEach(d => { if (d.folder) set.add(d.folder); });
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }

  // Merge deck `srcId` into `dstId`: cards/questions/notes/mistakes are
  // appended with fresh ids, and each moved card's FSRS state is remapped to
  // its new id so no scheduling progress is lost. The source deck is deleted
  // (tombstoned, so sync propagates the merge as a delete + an edit).
  function mergeInto(srcId, dstId) {
    load();
    const src = store.decks[srcId], dst = store.decks[dstId];
    if (!src || !dst || srcId === dstId) return null;
    const sd = src.data || {};
    const dd = dst.data = dst.data || {};
    dd.flashcards = Array.isArray(dd.flashcards) ? dd.flashcards : [];
    dd.quiz = Array.isArray(dd.quiz) ? dd.quiz : [];
    dst.srs = dst.srs || {};
    let maxId = dd.flashcards.reduce((m, c) => Math.max(m, c.id || 0), 0);
    (sd.flashcards || []).forEach(c => {
      const copy = JSON.parse(JSON.stringify(c));
      const oldId = copy.id;
      copy.id = ++maxId;
      dd.flashcards.push(copy);
      const s = (src.srs || {})[oldId];
      if (s) dst.srs[copy.id] = JSON.parse(JSON.stringify(s));
    });
    let maxQ = dd.quiz.reduce((m, q) => Math.max(m, q.id || 0), 0);
    (sd.quiz || []).forEach(q => {
      const copy = JSON.parse(JSON.stringify(q));
      copy.id = ++maxQ;
      dd.quiz.push(copy);
    });
    if (sd.notes && typeof sd.notes === 'object') {
      dd.notes = dd.notes || { summary: '' };
      if (sd.notes.summary) dd.notes.summary = [dd.notes.summary, sd.notes.summary].filter(Boolean).join('\n\n');
      ['sections', 'importantDates', 'commonMistakes', 'diagrams'].forEach(k => {
        if (Array.isArray(sd.notes[k]) && sd.notes[k].length) dd.notes[k] = (dd.notes[k] || []).concat(sd.notes[k]);
      });
    }
    if (Array.isArray(src.mistakes) && src.mistakes.length) {
      dst.mistakes = (Array.isArray(dst.mistakes) ? dst.mistakes : []).concat(src.mistakes);
    }
    dst.originalText = [dst.originalText, src.originalText].filter(Boolean).join('\n\n');
    dst.updatedAt = Date.now();
    delete store.decks[srcId];
    store.deleted[srcId] = Date.now();
    if (store.activeId === srcId) store.activeId = dstId;
    persist();
    return dst;
  }

  // Full copy including SRS progress, under a new id.
  function duplicate(id) {
    load();
    const src = store.decks[id];
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = newId();
    copy.createdAt = copy.updatedAt = Date.now();
    if (copy.data) copy.data.title = (copy.data.title || '') + (i18n.getLang() === 'tr' ? ' (kopya)' : ' (copy)');
    store.decks[copy.id] = copy;
    persist();
    return copy;
  }

  // ----- Mistake notebook (yanlış defteri) -----
  // Wrongly answered exam questions per deck, keyed by type+question text so
  // retakes and regenerated sets don't create duplicates. Answering the same
  // question correctly anywhere removes it from the notebook.

  function mistakeKey(q) {
    return (q.type || 'mc') + '|' + String(q.question || '').slice(0, 200);
  }

  function addMistakes(questions) {
    const deck = getActive();
    if (!deck || !questions || !questions.length) return;
    deck.mistakes = Array.isArray(deck.mistakes) ? deck.mistakes : [];
    const seen = new Set(deck.mistakes.map(mistakeKey));
    questions.forEach(q => {
      const k = mistakeKey(q);
      if (!seen.has(k)) { seen.add(k); deck.mistakes.push(JSON.parse(JSON.stringify(q))); }
    });
    persist();
  }

  function resolveMistakes(questions) {
    const deck = getActive();
    if (!deck || !Array.isArray(deck.mistakes) || !questions || !questions.length) return;
    const done = new Set(questions.map(mistakeKey));
    deck.mistakes = deck.mistakes.filter(q => !done.has(mistakeKey(q)));
    persist();
  }

  function getMistakes() {
    const deck = getActive();
    return deck && Array.isArray(deck.mistakes) ? deck.mistakes : [];
  }

  // ----- FSRS spaced repetition (replaces SM-2) -----
  // srs[cardId] = { stab (days), diff (1-10), reps, lapses, due (ms), last (ms) }
  // FSRS-4.5 with the published default weights. The three rating buttons map
  // to FSRS grades: Again=1, Hard=2, Got it=3 (Good). Requested retention is
  // 0.9, and with the FSRS-4.5 forgetting curve that makes the next interval
  // exactly the stability, which keeps the math pleasantly simple.
  // Legacy SM-2 entries ({ef, interval, ...}) migrate on first review.

  const DAY = 24 * 60 * 60 * 1000;
  const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
    1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
  const FACTOR = 19 / 81, DECAY = -0.5;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function initDifficulty(g) { return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10); }
  function retrievability(days, stab) { return Math.pow(1 + FACTOR * days / stab, DECAY); }

  function getSrs(cardId) {
    const deck = getActive();
    return deck ? deck.srs[cardId] || null : null;
  }

  function migrateSm2(s, now) {
    return {
      stab: Math.max(s.interval || 0.5, 0.1),
      diff: clamp(11 - (s.ef || 2.5) * 2, 1, 10),
      reps: s.reps || 1,
      lapses: 0,
      due: s.due || now,
      last: now - (s.interval || 0) * DAY
    };
  }

  // Apply a review. quality keeps the old public scale (again=1, hard=3,
  // gotit=5) so callers didn't have to change.
  function review(cardId, quality) {
    return applyReview(getActive(), cardId, quality);
  }

  // Same as review() but against an explicit deck — used by the cross-deck
  // "Today" queue, where the rated card may not belong to the active deck.
  function reviewIn(deckId, cardId, quality) {
    load();
    return applyReview(store.decks[deckId] || null, cardId, quality);
  }

  function applyReview(deck, cardId, quality) {
    if (!deck) return null;
    deck.srs = deck.srs || {};
    const g = quality >= 5 ? 3 : quality >= 3 ? 2 : 1; // FSRS grade
    const now = Date.now();
    let s = deck.srs[cardId] || null;
    if (s && s.ef !== undefined && s.stab === undefined) s = migrateSm2(s, now);

    if (!s || !s.reps) {
      // First review of this card.
      s = {
        stab: Math.max(W[g - 1], 0.1),
        diff: initDifficulty(g),
        reps: 1,
        lapses: g === 1 ? 1 : 0,
        due: 0,
        last: now
      };
    } else {
      const elapsed = Math.max(0, (now - (s.last || now)) / DAY);
      const R = retrievability(elapsed, s.stab);
      // Difficulty update with mean reversion toward initDifficulty(Easy).
      const d1 = s.diff - W[6] * (g - 3);
      s.diff = clamp(W[7] * initDifficulty(4) + (1 - W[7]) * d1, 1, 10);
      if (g === 1) {
        // Forgotten: post-lapse stability.
        s.stab = Math.max(0.1,
          W[11] * Math.pow(s.diff, -W[12]) * (Math.pow(s.stab + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
        s.lapses = (s.lapses || 0) + 1;
      } else {
        // Recalled: stability grows, dampened for Hard (W[15] < 1).
        const growth = Math.exp(W[8]) * (11 - s.diff) * Math.pow(s.stab, -W[9]) *
          (Math.exp(W[10] * (1 - R)) - 1) * (g === 2 ? W[15] : 1);
        s.stab = Math.min(36500, s.stab * (1 + growth));
      }
      s.reps += 1;
      s.last = now;
    }

    // At 0.9 requested retention the FSRS-4.5 curve gives interval = stability.
    s.due = g === 1 ? now : now + Math.max(1, Math.round(s.stab)) * DAY;
    deck.srs[cardId] = s;
    deck.updatedAt = Date.now();
    persist();
    return s;
  }

  // Every due card across the whole library, tagged with its deck — the
  // cross-deck "Today" queue. Never-seen cards are not "due".
  function dueAcrossDecks() {
    load();
    const now = Date.now();
    const out = [];
    Object.values(store.decks).forEach(deck => {
      const cards = deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
      cards.forEach(c => {
        const s = (deck.srs || {})[c.id];
        if (s && s.due <= now) out.push({ deckId: deck.id, deckTitle: (deck.data && deck.data.title) || '', card: c });
      });
    });
    return out;
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

  return {
    save, get, getActive, setActive, list, remove, touch, rename, duplicate,
    setFolder, folders, mergeInto,
    getSrs, review, reviewIn, dueCards, dueAcrossDecks, statusOf,
    addMistakes, resolveMistakes, getMistakes, mergeRemote
  };
})();
