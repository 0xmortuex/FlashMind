// ===== MEB library =====
// Browses data/meb/index.json: official MEB exam files (LGS, Bursluluk, ortak
// yazılı, konu-soru tables, YKS/YDT books…) with links to the ORIGINAL files on
// MEB's servers — nothing is hosted or copied here. data/meb/topics.json holds
// the konu-soru dağılım tables; "Use as my exam's topic profile" writes one into
// the open deck's paperProfile through PastPaper.saveProfile, so Adaptive.pick's
// topicBoost weights practice by it. Both files are fetched on first open and a
// failure is shown, never papered over. Built by scripts/build-meb-index.mjs.
// The filter helpers at the top are pure (covered by regression tests).
const MebIndex = (() => {
  const INDEX_URL = 'data/meb/index.json';
  const TOPICS_URL = 'data/meb/topics.json';
  const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
  const TYPES = ['lgs', 'bursluluk', 'ortak', 'konu', 'yks', 'acik', 'sinif', 'kilavuz', 'dort-beceri'];
  const PAGE = 50;
  const OFFICIAL = /^https:\/\/([a-z0-9-]+\.)*(meb\.gov\.tr|eba\.gov\.tr)(\/|$)/i;

  // ---------- pure helpers ----------
  const norm = s => PastPaper.normName(s);

  // f = { grade: 5..12 | 0, type: '' | code, subject: '' | name, q: text }.
  // A grade filter keeps only files whose name states that grade; the search
  // text must match every word in the title, subject, year or exam type.
  function filterItems(items, f) {
    const o = f || {};
    const words = norm(o.q).split(' ').filter(Boolean);
    return items.filter(it => {
      if (o.grade && !it.g.includes(o.grade)) return false;
      if (o.type && it.x !== o.type) return false;
      if (o.subject && it.s !== o.subject) return false;
      if (!words.length) return true;
      const hay = norm([it.t, it.s, it.y, it.x].join(' '));
      return words.every(w => hay.includes(w));
    });
  }

  // Subjects present under the other filters, and exam types with their counts.
  function subjectsFor(items, f) {
    const set = new Set(filterItems(items, Object.assign({}, f, { subject: '' })).map(it => it.s).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }
  function typeCounts(items, f) {
    const out = {};
    filterItems(items, Object.assign({}, f, { type: '' })).forEach(it => { out[it.x] = (out[it.x] || 0) + 1; });
    return out;
  }

  // Throws on anything the UI could not render safely (including a link that is
  // not an https MEB/EBA address).
  function validate(items, topics) {
    if (!Array.isArray(items)) throw new Error('index.json is not a list');
    if (!Array.isArray(topics)) throw new Error('topics.json is not a list');
    const ids = new Set();
    items.forEach((it, i) => {
      const bad = m => { throw new Error(`index.json entry ${i}: ${m}`); };
      if (!it || typeof it !== 'object') bad('not an object');
      if (typeof it.id !== 'string' || !it.id || ids.has(it.id)) bad('missing or duplicate id');
      ids.add(it.id);
      if (typeof it.t !== 'string' || typeof it.x !== 'string' || typeof it.s !== 'string' || typeof it.y !== 'string') bad('missing text fields');
      if (!Array.isArray(it.g) || !it.g.every(Number.isInteger)) bad('bad grades');
      if (typeof it.u !== 'string' || !OFFICIAL.test(it.u)) bad('not an official MEB link: ' + it.u);
      if (it.p && !OFFICIAL.test(it.p)) bad('not an official MEB link: ' + it.p);
      if (it.mb != null && !(it.mb >= 0)) bad('bad size');
    });
    const map = new Map();
    topics.forEach((t, i) => {
      if (!t || !ids.has(t.id) || !Array.isArray(t.rows) || t.rows.length < 2 ||
          !t.rows.every(r => Array.isArray(r) && typeof r[0] === 'string' && r[1] > 0)) throw new Error(`topics.json entry ${i}: bad table`);
      map.set(t.id, t);
    });
    return { items, topics: map };
  }

  // A topics.json table as the {name, count} list PastPaper expects.
  const profileTopics = table => table.rows.map(([name, count]) => ({ name, count }));

  // ---------- data ----------
  let data = null, loading = null;

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = Promise.all([getJson(INDEX_URL), getJson(TOPICS_URL)])
        .then(([items, topics]) => { data = validate(items, topics); return data; })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  // ---------- topic profile ----------
  // Same storage path as a pasted konu dağılımı (PastPaper.useDistribution):
  // topics normalised by PastPaper, topicsFrom 'distribution', style kept.
  function applyProfile(id) {
    const table = data && data.topics.get(id);
    const item = data && data.items.find(it => it.id === id);
    if (!table || !item) throw new Error('Unknown topic table ' + id);
    if (typeof Decks === 'undefined' || !Decks.getActive()) { App.showToast(i18n.t('mebNoDeck'), 'error'); return null; }
    const old = PastPaper.getProfile();
    if (old && old.topics.length && !confirm(i18n.t('mebOverwrite', { n: old.topics.length, t: item.t }))) return null;
    const saved = PastPaper.saveProfile(Object.assign({}, old || {}, { topics: profileTopics(table), topicsFrom: 'distribution', source: item.t }));
    if (!saved) throw new Error('Topic profile was not saved');
    App.showToast(i18n.t('mebApplied', { n: saved.topics.length }), 'success');
    PastPaper.refresh();
    return saved;
  }

  // ---------- UI ----------
  const T = (k, p) => i18n.t(k, p);
  function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;'); }

  const modal = typeof document !== 'undefined' ? PastPaper.makeModal('meb-panel') : null;
  const state = { f: { grade: 0, type: '', subject: '', q: '' }, shown: PAGE };

  const gradeLabel = g => T('mebGradeN', { n: g.length > 1 ? g[0] + '–' + g[g.length - 1] : g[0] });

  function rowHtml(it) {
    const table = data.topics.get(it.id);
    const chips = [T('mebType_' + it.x), it.g.length ? gradeLabel(it.g) : '', it.s, it.y, it.mb != null ? T('mebSizeMb', { n: it.mb }) : '']
      .filter(Boolean).map(c => `<span class="meb-chip">${esc(c)}</span>`).join('');
    const preview = table ? `<details class="meb-topics"><summary>${T('mebTopicsPreview', { n: table.n })}</summary>
        <ul>${table.rows.slice(0, 8).map(r => `<li><span>${esc(r[0])}</span><b>${r[1]}</b></li>`).join('')}</ul>
        <p class="meb-note">${T('mebTopicsNote')}</p></details>` : '';
    return `<li class="meb-row">
      <div class="meb-row-title">${esc(it.t)}</div>
      <div class="meb-chips">${chips}</div>
      ${preview}
      <div class="meb-actions">
        <a class="btn-primary meb-open" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">${T('mebOpenFile')} <span aria-hidden="true">&#8599;</span></a>
        ${it.p ? `<a class="meb-src" href="${esc(it.p)}" target="_blank" rel="noopener noreferrer">${T('mebSourcePage')}</a>` : ''}
        ${table ? `<button class="btn-ghost" data-meb-act="profile" data-id="${esc(it.id)}">&#9878;&#65039; ${T('mebUseProfile')}</button>` : ''}
      </div>
    </li>`;
  }

  function optionsHtml(pairs, current) {
    return pairs.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(current) ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  // Selects + list; the search box is left alone so typing keeps its focus.
  function renderResults() {
    const el = modal.el;
    if (!el || !data) return;
    const f = state.f;
    const counts = typeCounts(data.items, f);
    const subjects = subjectsFor(data.items, f);
    if (f.subject && !subjects.includes(f.subject)) f.subject = '';
    el.querySelector('#meb-grade').innerHTML = optionsHtml([[0, T('mebAllGrades')], ...GRADES.map(g => [g, T('mebGradeN', { n: g })])], f.grade);
    el.querySelector('#meb-type').innerHTML = optionsHtml([['', T('mebAllTypes')], ...TYPES.filter(x => counts[x] || f.type === x).map(x => [x, `${T('mebType_' + x)} (${counts[x] || 0})`])], f.type);
    el.querySelector('#meb-subject').innerHTML = optionsHtml([['', T('mebAllSubjects')], ...subjects.map(s => [s, s])], f.subject);
    const hits = filterItems(data.items, f);
    const shown = hits.slice(0, state.shown);
    el.querySelector('#meb-count').textContent = T('mebCount', { n: hits.length });
    el.querySelector('#meb-list').innerHTML = hits.length
      ? `<ul class="meb-list">${shown.map(rowHtml).join('')}</ul>` +
        (hits.length > shown.length ? `<button class="btn-ghost meb-more" data-meb-act="more">${T('mebShowMore', { n: hits.length - shown.length })}</button>` : '')
      : `<p class="meb-empty">${T('mebNone')}</p>`;
  }

  function shell(body) {
    modal.show(`
      <div class="chk-head"><h3>&#128218; ${T('mebTitle')}</h3><button class="btn-icon" data-ex-close aria-label="${esc(T('close'))}">&times;</button></div>
      <div class="ex-scroll">${body}</div>`);
  }

  function renderReady() {
    shell(`
      <p class="chk-intro">${T('mebIntro')}</p>
      <p class="meb-tip">&#128161; ${T('mebTip')}</p>
      <div class="meb-filters">
        <input type="search" id="meb-q" class="meb-q" value="${esc(state.f.q)}" placeholder="${esc(T('mebSearch'))}" aria-label="${esc(T('mebSearch'))}">
        <select id="meb-grade" aria-label="${esc(T('mebAllGrades'))}"></select>
        <select id="meb-type" aria-label="${esc(T('mebAllTypes'))}"></select>
        <select id="meb-subject" aria-label="${esc(T('mebAllSubjects'))}"></select>
      </div>
      <div class="meb-count" id="meb-count" aria-live="polite"></div>
      <p class="meb-note">${T('mebNoGradeNote')}</p>
      <div id="meb-list"></div>
      <p class="meb-foot">${T('mebFoot')} <a class="meb-src" href="https://mebi.eba.gov.tr" target="_blank" rel="noopener noreferrer">mebi.eba.gov.tr &#8599;</a></p>`);
    renderResults();
  }

  function renderState(html) { shell(`<div class="meb-state" id="meb-state">${html}</div>`); }

  async function open() {
    if (!modal) return;
    if (data) { renderReady(); return; }
    renderState(`<div class="spinner" aria-hidden="true"></div> ${T('mebLoading')}`);
    try {
      await load();
      if (modal.isOpen()) renderReady();
    } catch (err) {
      if (modal.isOpen()) renderState(`<p class="meb-error" role="alert">${esc(T('mebLoadFail', { e: err && err.message ? err.message : String(err) }))}</p>
        <button class="btn-ghost" data-meb-act="open">${T('mebRetry')}</button>`);
    }
  }

  function init() {
    // Capture phase: Escape closes only this screen, not the past-paper modal under it.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.isOpen()) { e.stopImmediatePropagation(); modal.close(); }
    }, true);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-meb-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.mebAct;
      if (act === 'open') open();
      else if (act === 'more') { state.shown += PAGE; renderResults(); }
      else if (act === 'profile') applyProfile(b.dataset.id);
    });
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'meb-q') { state.f.q = e.target.value; state.shown = PAGE; renderResults(); }
    });
    document.addEventListener('change', e => {
      const t = e.target;
      if (!t || !modal.el || !modal.el.contains(t)) return;
      if (t.id === 'meb-grade') state.f.grade = parseInt(t.value, 10) || 0;
      else if (t.id === 'meb-type') state.f.type = t.value;
      else if (t.id === 'meb-subject') state.f.subject = t.value;
      else return;
      state.shown = PAGE;
      renderResults();
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  return { filterItems, subjectsFor, typeCounts, validate, profileTopics, GRADES, TYPES, load, open, applyProfile };
})();
