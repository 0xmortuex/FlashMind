// ===== MEB library =====
// Browses data/meb/index.json: official MEB exam files (LGS, Bursluluk, ortak
// yazılı, konu-soru tables, YKS/YDT books…) with links to the ORIGINAL files on
// MEB's servers — nothing is hosted or copied here. data/meb/topics.json holds
// the konu-soru dağılım tables; "Use as my exam's topic profile" writes one into
// the open deck's paperProfile through PastPaper.saveProfile, so Adaptive.pick's
// topicBoost weights practice by it. Both files are fetched on first open and a
// failure is shown, never papered over. Built by scripts/build-meb-index.mjs.
// Entries with set:1 also open as a ready-made study set (js/mebsets.js).
// The filter helpers at the top are pure (covered by regression tests).
const MebIndex = (() => {
  const INDEX_URL = 'data/meb/index.json';
  const TOPICS_URL = 'data/meb/topics.json';
  const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
  const TYPES = ['lgs', 'bursluluk', 'ortak', 'konu', 'yks', 'acik', 'sinif', 'kilavuz', 'dort-beceri', 'ogm-yazili', 'ogm-kazanim', 'ogm-kazanim-bazli'];
  const PAGE = 50;
  const OFFICIAL = /^https:\/\/([a-z0-9-]+\.)*(meb\.gov\.tr|eba\.gov\.tr)(\/|$)/i;

  // ---------- pure helpers ----------
  const norm = s => PastPaper.normName(s);

  // School years are shown exactly as the index states them; these two are the
  // groups the library leads with. A file with no stated year sorts last and is
  // only listed under "All years".
  const YEAR_NOW = '2026-2027', YEAR_PREV = '2025-2026';
  const defaultYear = items => (items.some(it => it.y === YEAR_NOW) ? YEAR_NOW : '');
  // Newest school year first; the order inside a year is kept.
  const sortByYear = items => items.slice().sort((a, b) => (b.y || '').localeCompare(a.y || ''));

  // f = { grade: 5..12 | 0, type: '' | code, subject: '' | name, q: text,
  //       year: '' | YEAR_NOW | YEAR_PREV | 'earlier', sets: bool }.
  // A grade filter keeps only files whose name states that grade; the search
  // text must match every word in the title, subject, year or exam type.
  function filterItems(items, f) {
    const o = f || {};
    const words = norm(o.q).split(' ').filter(Boolean);
    return items.filter(it => {
      if (o.grade && !it.g.includes(o.grade)) return false;
      if (o.type && it.x !== o.type) return false;
      if (o.subject && it.s !== o.subject) return false;
      if (o.year === 'earlier' ? !(it.y && it.y < YEAR_PREV) : o.year && it.y !== o.year) return false;
      if (o.sets && !it.set) return false;
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
      if (it.set != null && it.set !== 1) bad('bad study set flag');
      ['sz', 'nc', 'nq', 'ns'].forEach(k => { if (it[k] != null && !(Number.isInteger(it[k]) && it[k] >= 0)) bad('bad ' + k); });
      if (it.set && !(it.nc > 0 || it.nq > 0)) bad('study set without cards or questions');
      if (it.alias != null && (typeof it.alias !== 'string' || !it.set || !items.some(o => o && o.id === it.alias))) bad('bad alias');
      if (it.ver != null && typeof it.ver !== 'string') bad('bad ver');
    });
    const map = new Map();
    topics.forEach((t, i) => {
      if (!t || !ids.has(t.id) || !Array.isArray(t.rows) || t.rows.length < 2 ||
          !t.rows.every(r => Array.isArray(r) && typeof r[0] === 'string' && r[1] > 0)) throw new Error(`topics.json entry ${i}: bad table`);
      map.set(t.id, t);
    });
    return { items, topics: map };
  }

  // '96 cards · 72 questions · 14 sections' from the counts the generator wrote.
  function statsLine(it) {
    const part = (n, k) => (n > 0 ? i18n.t(n === 1 ? k + 'One' : k, { n }) : '');
    return [part(it.nc, 'mebStatCards'), part(it.nq, 'mebStatQuestions'), part(it.ns, 'mebStatSections')].filter(Boolean).join(' · ');
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
        .then(([items, topics]) => { const v = validate(items, topics); v.items = sortByYear(v.items); data = v; return data; })
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
    return storeProfile(profileTopics(table), item.t);
  }

  // topics = [{name, count}], title = what the user sees in the overwrite question and as the profile's source.
  // Also used by the Senaryolar tab (js/mebscen.js).
  function storeProfile(topics, title) {
    if (typeof Decks === 'undefined' || !Decks.getActive()) { App.showToast(i18n.t('mebNoDeck'), 'error'); return null; }
    const old = PastPaper.getProfile();
    if (old && old.topics.length && !confirm(i18n.t('mebOverwrite', { n: old.topics.length, t: title }))) return null;
    const saved = PastPaper.saveProfile(Object.assign({}, old || {}, { topics, topicsFrom: 'distribution', source: title }));
    if (!saved) throw new Error('Topic profile was not saved');
    App.showToast(i18n.t('mebApplied', { n: saved.topics.length }), 'success');
    PastPaper.refresh();
    return saved;
  }

  // ---------- UI ----------
  const T = (k, p) => i18n.t(k, p);
  function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;'); }

  const modal = typeof document !== 'undefined' ? PastPaper.makeModal('meb-panel') : null;
  // busy: id of the study set being fetched; err: { id, msg } of the last failure.
  const state = { f: { grade: 0, type: '', subject: '', q: '', year: '', sets: false }, shown: PAGE, yearSet: false, busy: null, err: null, tab: 'files' };

  const gradeLabel = g => T('mebGradeN', { n: g.length > 1 ? g[0] + '–' + g[g.length - 1] : g[0] });

  function rowHtml(it) {
    const table = data.topics.get(it.id);
    const chips = `<span class="meb-chip meb-year${it.y ? '' : ' none'}">${esc(it.y || T('mebYearNone'))}</span>` +
      [T('mebType_' + it.x), it.ver ? T('mebVersionN', { v: it.ver }) : '', it.g.length ? gradeLabel(it.g) : '', it.s, it.mb != null ? T('mebSizeMb', { n: it.mb }) : '']
        .filter(Boolean).map(c => `<span class="meb-chip">${esc(c)}</span>`).join('');
    const busy = state.busy === it.id, failed = state.err && state.err.id === it.id;
    const setHtml = it.set ? `<div class="meb-set">
        ${failed ? `<p class="meb-error" role="alert">${esc(T('mebSetFail', { e: state.err.msg }))}</p>` : ''}
        <button class="btn-primary meb-set-btn" data-meb-act="set" data-id="${esc(it.id)}" title="${esc(T('mebSetSize', { n: it.sz || 0 }))}"${state.busy ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>
          ${busy ? `<span class="spinner" aria-hidden="true"></span> ${T('mebSetOpening')}` : `&#127891; ${T(failed ? 'mebRetry' : 'mebSetOpen')}`}</button>
        ${statsLine(it) ? `<span class="meb-stats">${esc(statsLine(it))}</span>` : ''}
      </div>` : `<p class="meb-soon">${T('mebSetSoon')}</p>`;
    const preview = table ? `<details class="meb-topics"><summary>${T('mebTopicsPreview', { n: table.n })}</summary>
        <ul>${table.rows.slice(0, 8).map(r => `<li><span>${esc(r[0])}</span><b>${r[1]}</b></li>`).join('')}</ul>
        <p class="meb-note">${T('mebTopicsNote')}</p></details>` : '';
    return `<li class="meb-row" data-row="${esc(it.id)}">
      <div class="meb-row-title">${esc(it.t)}</div>
      <div class="meb-chips">${chips}</div>
      ${setHtml}
      ${preview}
      <div class="meb-actions">
        <a class="${it.set ? 'btn-ghost' : 'btn-primary'} meb-open" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">${T('mebOpenFile')} <span aria-hidden="true">&#8599;</span></a>
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
    el.querySelectorAll('[data-meb-year]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mebYear === f.year)));
    el.querySelector('[data-meb-sets]').setAttribute('aria-pressed', String(f.sets));
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

  // Files = the indexed official files; Senaryolar = one notebook per ortak yazılı scenario (js/mebscen.js).
  function tabsHtml() {
    if (typeof MebScen === 'undefined') return '';
    return `<div class="meb-tabs" role="tablist">${[['files', T('mebTabFiles')], ['scen', T('scenTab')]]
      .map(([v, label]) => `<button type="button" class="meb-tab" role="tab" data-meb-tab="${v}" aria-selected="${state.tab === v}">${esc(label)}</button>`).join('')}</div>`;
  }

  function renderReady() {
    if (state.tab === 'scen' && typeof MebScen !== 'undefined') {
      shell(`${tabsHtml()}<div id="meb-scen"></div>`);
      MebScen.render(modal.el.querySelector('#meb-scen'));
      return;
    }
    shell(`
      ${tabsHtml()}
      <p class="chk-intro">${T('mebIntro')}</p>
      <p class="meb-tip">&#128161; ${T('mebTip')}</p>
      <div class="meb-filters">
        <input type="search" id="meb-q" class="meb-q" value="${esc(state.f.q)}" placeholder="${esc(T('mebSearch'))}" aria-label="${esc(T('mebSearch'))}">
        <select id="meb-grade" aria-label="${esc(T('mebAllGrades'))}"></select>
        <select id="meb-type" aria-label="${esc(T('mebAllTypes'))}"></select>
        <select id="meb-subject" aria-label="${esc(T('mebAllSubjects'))}"></select>
      </div>
      <div class="meb-yearbar" role="group" aria-label="${esc(T('mebYearLabel'))}">
        ${[['', T('mebYearAll')], [YEAR_NOW, YEAR_NOW], [YEAR_PREV, YEAR_PREV], ['earlier', T('mebYearEarlier')]]
          .map(([v, label]) => `<button type="button" class="meb-fchip" data-meb-year="${esc(v)}" aria-pressed="false">${esc(label)}</button>`).join('')}
        <button type="button" class="meb-fchip meb-fchip-sets" data-meb-sets aria-pressed="false">&#127891; ${T('mebSetsOnly')}</button>
      </div>
      <div class="meb-count" id="meb-count" aria-live="polite"></div>
      <p class="meb-note">${T('mebNoGradeNote')}</p>
      <div id="meb-list"></div>
      <p class="meb-foot">${T('mebFoot')} <a class="meb-src" href="https://mebi.eba.gov.tr" target="_blank" rel="noopener noreferrer">mebi.eba.gov.tr &#8599;</a></p>`);
    renderResults();
  }

  // The newest school year leads, until the user picks another.
  function defaultFilters() {
    if (state.yearSet) return;
    state.f.year = defaultYear(data.items);
    state.yearSet = true;
  }

  async function openSet(id) {
    const it = data && data.items.find(x => x.id === id);
    if (!it || !it.set) throw new Error('No study set for ' + id);
    if (state.busy) return;
    state.busy = id;
    state.err = null;
    refreshRow(id);
    try {
      await MebSets.open(it);
    } catch (err) {
      state.err = { id, msg: err && err.message ? err.message : String(err) };
    } finally {
      state.busy = null;
    }
    // On success the library is already closed; on failure show the error in place.
    if (modal.isOpen()) { refreshRow(id); modal.el.querySelector(`[data-row="${CSS.escape(id)}"] .meb-set-btn`)?.focus(); }
  }

  function refreshRow(id) {
    const it = data.items.find(x => x.id === id);
    const row = modal.el && modal.el.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (!it || !row) return;
    const keep = row.contains(document.activeElement) && document.activeElement.dataset.mebAct;
    row.outerHTML = rowHtml(it);
    if (keep) modal.el.querySelector(`[data-row="${CSS.escape(id)}"] [data-meb-act="${keep}"]`)?.focus();
  }

  function renderState(html) { shell(`<div class="meb-state" id="meb-state">${html}</div>`); }

  // opts.tab = 'scen' opens on the Senaryolar tab.
  async function open(opts) {
    if (!modal) return;
    if (opts && opts.tab) state.tab = opts.tab === 'scen' ? 'scen' : 'files';
    if (data) { defaultFilters(); renderReady(); return; }
    renderState(`<div class="spinner" aria-hidden="true"></div> ${T('mebLoading')}`);
    try {
      await load();
      defaultFilters();
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
      const tab = e.target.closest('[data-meb-tab]');
      if (tab && modal.el && modal.el.contains(tab)) { state.tab = tab.dataset.mebTab; renderReady(); modal.el.querySelector('[data-meb-tab][aria-selected="true"]')?.focus(); return; }
      const chip = e.target.closest('[data-meb-year], [data-meb-sets]');
      if (chip && modal.el && modal.el.contains(chip)) {
        if (chip.hasAttribute('data-meb-sets')) state.f.sets = !state.f.sets;
        else state.f.year = chip.dataset.mebYear;
        state.shown = PAGE;
        renderResults();
        return;
      }
      const b = e.target.closest('[data-meb-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.mebAct;
      if (act === 'open') open();
      else if (act === 'set') openSet(b.dataset.id);
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

  return {
    filterItems, subjectsFor, typeCounts, validate, profileTopics, sortByYear, defaultYear, statsLine, YEAR_NOW, YEAR_PREV, GRADES, TYPES,
    load, open, close: () => modal && modal.close(), applyProfile, storeProfile
  };
})();
