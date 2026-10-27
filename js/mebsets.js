// ===== MEB study sets =====
// A library entry with `set:1` has a ready-made study set at
// data/meb/sets/<id>.json (notes, cards, questions and the file's own text as a
// source). `open` fetches that one file on demand, validates it with
// Parser.normalizeStudyData and saves it as a NEW deck through the same path as
// any imported set (so FSRS, quiz, exam mode, mind map, sync and Ask AI all
// work), then opens it. A failure is thrown to the caller (the library shows it
// with a Retry), never papered over. Only one set loads at a time.
const MebSets = (() => {
  const BASE = 'data/meb/sets/';
  let loading = null; // { id, promise }

  // ---------- pure helpers ----------
  // Raw set file -> study data that remembers where it came from. The index
  // entry is the authority for the id and the official link.
  function prepare(raw, entry) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('study set is not an object');
    if (raw.meta && raw.meta.fileId && raw.meta.fileId !== entry.id) throw new Error(`study set belongs to another file (${raw.meta.fileId})`);
    const data = Parser.normalizeStudyData({ ...raw, meta: { ...raw.meta, fileId: entry.id, sourceUrl: entry.u } });
    const sections = data.notes.sections.length;
    if (!sections && !data.flashcards.length && !data.quiz.length) throw new Error('study set has no notes, cards or questions');
    if (!data.sources || !data.sources.length) throw new Error('study set has no source text');
    return data;
  }

  // The saved deck made from this library file, if any.
  function findDeck(fileId) {
    return Decks.list().find(d => d.data && d.data.meta && d.data.meta.fileId === fileId) || null;
  }

  // ---------- open ----------
  async function fetchSet(entry) {
    const res = await fetch(BASE + encodeURIComponent(entry.id) + '.json');
    if (!res.ok) throw new Error(`${BASE}${entry.id}.json: HTTP ${res.status}`);
    return res.json();
  }

  function show(deckId) {
    if (typeof MebIndex !== 'undefined') MebIndex.close();
    PastPaper.close();
    App.openDeck(deckId);
  }

  // Resolves to the deck id that was opened, or null when nothing was opened.
  async function open(entry) {
    if (!entry || !entry.id) throw new Error('No library entry given');
    if (loading) {
      if (loading.id === entry.id) return loading.promise;
      throw new Error(i18n.t('mebSetBusy'));
    }
    const existing = findDeck(entry.id);
    if (existing && confirm(i18n.t('mebSetExists', { t: existing.data.title }))) { show(existing.id); return existing.id; }
    const promise = (async () => {
      const data = prepare(await fetchSet(entry), entry);
      const id = App.mergeIntoDeck(null, data);
      show(id);
      return id;
    })();
    loading = { id: entry.id, promise };
    try { return await promise; } finally { loading = null; }
  }

  return { prepare, findDeck, open };
})();
