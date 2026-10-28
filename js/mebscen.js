// ===== MEB scenarios (Senaryolar tab of the MEB library) =====
// data/meb/scen/index.json lists every scenario of MEB's 2026-2027 "Konu Soru
// Dağılım Tablosu" (built by scripts/build-meb-scenarios.mjs). Opening one
// fetches that course's spec (data/meb/scen/spec/<fileId>.json) and, if it is
// built, its study bank (bank/<bank>.json), composes the notebook with
// ScenarioSet.compose and saves it as a NEW deck through App.mergeIntoDeck, like
// any imported set. A failure is thrown to the row (with Retry), never papered
// over. Every course with a bank also offers "All topics — whole course"
// (ScenarioSet.composeCourse): all its outcomes, cards and questions in one
// notebook; that is also what a national exam without a scenario table points to.
// Scenarios whose bank is not built yet say so. The helpers at the
// top are pure (covered by regression tests).
const MebScen = (() => {
  const BASE = 'data/meb/scen/';
  const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

  // ---------- pure helpers ----------
  const keyOf = e => `${e.fileId}.${e.si}.${e.ei}.${e.n}`;
  const courseKey = s => 'course.' + s.key;

  // Throws on anything the UI could not render or open safely.
  function validateIndex(items) {
    if (!Array.isArray(items)) throw new Error('scen index is not a list');
    const keys = new Set();
    items.forEach((e, i) => {
      const bad = m => { throw new Error(`scen index entry ${i}: ${m}`); };
      if (!e || typeof e !== 'object') bad('not an object');
      if (!/^[a-zA-Z0-9_-]+$/.test(e.fileId || '')) bad('bad fileId');
      if (![e.si, e.ei, e.n, e.grade, e.total, e.kazanimCount].every(Number.isInteger) || e.si < 0 || e.ei < 0 || e.n < 0 || e.total < 0) bad('bad numbers');
      if (typeof e.subject !== 'string' || !e.subject || typeof e.exam !== 'string' || !e.exam || typeof e.sheet !== 'string' || typeof e.variant !== 'string') bad('missing text fields');
      if (e.bank != null && (typeof e.bank !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(e.bank))) bad('bad bank id');
      if (e.hasBank !== !!e.bank) bad('hasBank does not match bank');
      if (!Array.isArray(e.d) || !e.d.every(c => Number.isInteger(c) && c > 0)) bad('bad distribution');
      if (e.national) { if (e.n !== 0 || e.total || e.d.length) bad('a national exam has no scenario'); }
      else if (e.n < 1 || e.d.length !== e.kazanimCount || e.d.reduce((a, b) => a + b, 0) !== e.total) bad('distribution does not add up');
      if (keys.has(keyOf(e))) bad('duplicate ' + keyOf(e));
      keys.add(keyOf(e));
    });
    return items;
  }

  // Courses (a sheet = one subject in one grade) with their exams and scenarios, subject then grade order.
  function sheetsOf(items) {
    const map = new Map();
    items.forEach(e => {
      const k = e.fileId + '.' + e.si;
      let s = map.get(k);
      if (!s) map.set(k, s = { key: k, fileId: e.fileId, si: e.si, sheet: e.sheet, subject: e.subject, grade: e.grade, variant: e.variant, bank: e.bank, exams: [] });
      let ex = s.exams.find(x => x.ei === e.ei);
      if (!ex) s.exams.push(ex = { ei: e.ei, exam: e.exam, national: !!e.national, scenarios: [] });
      if (!e.national) ex.scenarios.push(e);
    });
    return [...map.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'tr') || a.variant.localeCompare(b.variant, 'tr') || a.grade - b.grade);
  }

  // f = { grade: 0 | 5..12, subject: '' | name }
  const filterSheets = (sheets, f) => sheets.filter(s => (!f.grade || s.grade === f.grade) && (!f.subject || s.subject === f.subject));
  const subjectsOf = (sheets, grade) => [...new Set(filterSheets(sheets, { grade, subject: '' }).map(s => s.subject))].sort((a, b) => a.localeCompare(b, 'tr'));
  const gradesOf = sheets => GRADES.filter(g => sheets.some(s => s.grade === g));

  // The grade of the open deck when it states one (decks made from MEB files do), else 0.
  function activeGrade() {
    const deck = typeof Decks !== 'undefined' ? Decks.getActive() : null;
    const g = deck && deck.data && deck.data.meta && Array.isArray(deck.data.meta.grade) ? deck.data.meta.grade[0] : 0;
    return GRADES.includes(g) ? g : 0;
  }

  // The saved notebook made from this scenario, if any.
  function findDeck(e) {
    return Decks.list().find(d => {
      const m = d.data && d.data.meta;
      return m && m.kind === 'scenario' && m.fileId === e.fileId && m.sheet === e.sheet && m.exam === e.exam && m.scenario === e.n;
    }) || null;
  }

  // The saved whole-course notebook of this course (a sheet from sheetsOf), if any.
  function findCourseDeck(s) {
    return Decks.list().find(d => {
      const m = d.data && d.data.meta;
      return m && m.kind === 'course' && m.fileId === s.fileId && m.sheet === s.sheet;
    }) || null;
  }

  // Composed set -> study data; the exam block must survive normalisation with exactly the table's count.
  function prepare(set, e) {
    const data = Parser.normalizeStudyData(set);
    const exam = data.quiz.filter(q => q.scenarioExam).length;
    if (exam !== e.total) throw new Error(`scenario exam has ${exam} questions, the table says ${e.total}`);
    if (!data.notes.sections.length || !data.flashcards.length) throw new Error('scenario notebook has no notes or cards');
    if (!data.sources || !data.sources.length) throw new Error('scenario notebook has no table source');
    return data;
  }

  // The whole-course notebook must keep every kazanım note and every composed question.
  function prepareCourse(set) {
    const data = Parser.normalizeStudyData(set);
    const c = set.meta.counts;
    if (data.quiz.length !== c.questions) throw new Error(`course notebook has ${data.quiz.length} questions, composed ${c.questions}`);
    if (data.notes.sections.length < c.kazanim) throw new Error(`course notebook has ${data.notes.sections.length} note sections for ${c.kazanim} outcomes`);
    if (!data.flashcards.length) throw new Error('course notebook has no cards');
    if (!data.sources || !data.sources.length) throw new Error('course notebook has no table source');
    return data;
  }

  // ---------- data ----------
  let data = null, loading = null;
  const specs = new Map(), banks = new Map();

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = getJson(BASE + 'index.json')
        .then(items => { validateIndex(items); data = { items, sheets: sheetsOf(items) }; return data; })
        .finally(() => { loading = null; });
    }
    return loading;
  }
  // Cached per page load; a failed download is not cached, so Retry can succeed.
  async function cached(map, url) {
    if (!map.has(url)) map.set(url, await getJson(url));
    return map.get(url);
  }
  const getSpec = fileId => cached(specs, BASE + 'spec/' + encodeURIComponent(fileId) + '.json');
  const getBank = id => cached(banks, BASE + 'bank/' + encodeURIComponent(id) + '.json');

  async function located(e) {
    const spec = await getSpec(e.fileId);
    const sheet = ScenarioSet.withFile(spec, e.si);
    const k = (sheet.exams[e.ei] ? sheet.exams[e.ei].scenarios : []).findIndex(s => s.n === e.n);
    if (k < 0) throw new Error(`scenario ${e.n} of ${e.exam} is not in the spec`);
    return { sheet, k };
  }

  // ---------- open / profile ----------
  let opening = null; // { key, promise }

  function show(deckId) {
    if (typeof MebIndex !== 'undefined') MebIndex.close();
    PastPaper.close();
    App.openDeck(deckId);
  }

  // Resolves to the deck id that was opened, or null when nothing was opened.
  async function open(e) {
    if (!e || !e.fileId || e.national) throw new Error('No scenario given');
    if (!e.bank) throw new Error(i18n.t('scenSoon'));
    const key = keyOf(e);
    if (opening) {
      if (opening.key === key) return opening.promise;
      throw new Error(i18n.t('scenBusy'));
    }
    const existing = findDeck(e);
    if (existing && confirm(i18n.t('scenExists', { t: existing.data.title }))) { show(existing.id); return existing.id; }
    const promise = (async () => {
      const [{ sheet, k }, bank] = await Promise.all([located(e), getBank(e.bank)]);
      const id = App.mergeIntoDeck(null, prepare(ScenarioSet.compose(bank, sheet, e.ei, k), e));
      show(id);
      return id;
    })();
    opening = { key, promise };
    try { return await promise; } finally { opening = null; }
  }

  // s = a sheet from sheetsOf. Resolves to the deck id that was opened, or null.
  async function openCourse(s) {
    if (!s || !s.fileId) throw new Error('No course given');
    if (!s.bank) throw new Error(i18n.t('scenSoon'));
    const key = courseKey(s);
    if (opening) {
      if (opening.key === key) return opening.promise;
      throw new Error(i18n.t('scenBusy'));
    }
    const existing = findCourseDeck(s);
    if (existing && confirm(i18n.t('scenExists', { t: existing.data.title }))) { show(existing.id); return existing.id; }
    const promise = (async () => {
      const [spec, bank] = await Promise.all([getSpec(s.fileId), getBank(s.bank)]);
      const id = App.mergeIntoDeck(null, prepareCourse(ScenarioSet.composeCourse(bank, ScenarioSet.withFile(spec, s.si))));
      show(id);
      return id;
    })();
    opening = { key, promise };
    try { return await promise; } finally { opening = null; }
  }

  const titleOf = e => `${e.subject} ${e.grade} · ${e.exam} · ${i18n.t('scenRowTitle', { n: e.n })}`;

  async function applyProfile(e) {
    const { sheet, k } = await located(e);
    return MebIndex.storeProfile(ScenarioSet.profileTopics(sheet, e.ei, k), titleOf(e));
  }

  // ---------- UI ----------
  const T = (k, p) => i18n.t(k, p);
  function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;'); }

  // busy: { key, act } of the running request; err: { key, msg } of the last failure.
  const state = { host: null, f: { grade: 0, subject: '' }, touched: false, sel: '', ei: -1, busy: null, err: null };

  const sheetLabel = s => `${s.subject}${s.variant ? ' · ' + s.variant : ''} · ${T('mebGradeN', { n: s.grade })}${s.bank ? '' : ' · ' + T('scenSoon')}`;

  function rowHtml(e) {
    const key = keyOf(e);
    const busy = state.busy && state.busy.key === key, failed = state.err && state.err.key === key;
    const dis = state.busy ? ' disabled' : '';
    const bar = e.d.map(c => `<i style="flex:${c}"></i>`).join('');
    return `<li class="scen-row" data-row="${esc(key)}">
      <div class="scen-row-head"><span class="scen-row-title">${T('scenRowTitle', { n: e.n })}</span>
        <span class="scen-stats">${T('scenQuestions', { n: e.total })} · ${T('scenKazanim', { n: e.kazanimCount })}</span></div>
      <span class="scen-bar" role="img" aria-label="${esc(T('scenBarLabel', { d: e.d.join(' + ') }))}">${bar}</span>
      ${failed ? `<p class="meb-error" role="alert">${esc(T('scenFail', { e: state.err.msg }))}</p>` : ''}
      <div class="meb-actions">
        ${e.bank
          ? `<button class="btn-primary scen-open-btn" data-scen-act="open" data-key="${esc(key)}"${dis}${busy && state.busy.act === 'open' ? ' aria-busy="true"' : ''}>
              ${busy && state.busy.act === 'open' ? `<span class="spinner" aria-hidden="true"></span> ${T('mebSetOpening')}` : `&#127891; ${T(failed ? 'mebRetry' : 'scenOpen')}`}</button>`
          : `<span class="meb-soon">${T('scenSoon')}</span>`}
        <button class="btn-ghost" data-scen-act="profile" data-key="${esc(key)}"${dis}>&#9878;&#65039; ${T('scenUseProfile')}</button>
      </div>
    </li>`;
  }

  // "All topics — whole course" for a course with a bank (not a scenario row: it has no table count).
  function courseHtml(s) {
    const key = courseKey(s);
    const busy = state.busy && state.busy.key === key, failed = state.err && state.err.key === key;
    return `<ul class="meb-list"><li class="scen-course" data-row="${esc(key)}">
      <div class="scen-row-head"><span class="scen-row-title">${T('scenCourseTitle')}</span></div>
      <p class="meb-note">${T('scenCourseText')}</p>
      ${failed ? `<p class="meb-error" role="alert">${esc(T('scenFail', { e: state.err.msg }))}</p>` : ''}
      <div class="meb-actions">${courseButton(s, busy, failed)}</div>
    </li></ul>`;
  }
  function courseButton(s, busy, failed) {
    return `<button class="btn-primary scen-open-btn" data-scen-act="course" data-key="${esc(s.key)}"${state.busy ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>
      ${busy ? `<span class="spinner" aria-hidden="true"></span> ${T('mebSetOpening')}` : `&#127891; ${T(failed ? 'mebRetry' : 'scenCourseOpen')}`}</button>`;
  }

  function chip(attr, value, label, pressed) {
    return `<button type="button" class="meb-fchip" ${attr}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  }

  // Repairs the selection after a filter change: the picked course must still be listed, an exam picked.
  function settle() {
    const list = filterSheets(data.sheets, state.f);
    if (!list.some(s => s.key === state.sel)) { state.sel = list.length ? list[0].key : ''; state.ei = -1; }
    const sheet = list.find(s => s.key === state.sel);
    if (sheet && !sheet.exams.some(x => x.ei === state.ei)) state.ei = sheet.exams.length ? sheet.exams[0].ei : -1;
    return { list, sheet };
  }

  function paint() {
    const host = state.host;
    if (!host || !data) return;
    const { list, sheet } = settle();
    const f = state.f;
    const exam = sheet && sheet.exams.find(x => x.ei === state.ei);
    host.innerHTML = `
      <p class="chk-intro">${T('scenIntro')}</p>
      <div class="meb-yearbar scen-chips" role="group" aria-label="${esc(T('scenGrade'))}">
        ${chip('data-scen-grade', 0, T('mebAllGrades'), f.grade === 0)}${gradesOf(data.sheets).map(g => chip('data-scen-grade', g, T('mebGradeN', { n: g }), f.grade === g)).join('')}
      </div>
      <div class="meb-yearbar scen-chips" role="group" aria-label="${esc(T('scenSubject'))}">
        ${chip('data-scen-subject', '', T('mebAllSubjects'), f.subject === '')}${subjectsOf(data.sheets, f.grade).map(s => chip('data-scen-subject', s, s, f.subject === s)).join('')}
      </div>
      ${list.length ? `<label class="scen-pick"><span>${T('scenSheet')}</span>
        <select id="scen-sheet">${list.map(s => `<option value="${esc(s.key)}"${s.key === state.sel ? ' selected' : ''}>${esc(sheetLabel(s))}</option>`).join('')}</select></label>
      <div class="meb-yearbar" role="group" aria-label="${esc(T('scenExam'))}">
        ${sheet.exams.map(x => chip('data-scen-exam', x.ei, x.exam + (x.national ? ' · ' + T('scenNationalShort') : ''), x.ei === state.ei)).join('')}
      </div>
      <div class="meb-count" aria-live="polite">${exam && !exam.national ? T('scenCount', { n: exam.scenarios.length }) : ''}</div>
      ${sheet.bank ? courseHtml(sheet) : ''}
      ${exam && exam.national
        ? `<p class="scen-national">${T('scenNational')}</p><p class="meb-note">${T('scenNationalNote')}</p>${sheet.bank ? `<div class="meb-actions">${courseButton(sheet, false, false)}</div>` : `<span class="meb-soon">${T('scenSoon')}</span>`}`
        : `<ul class="meb-list">${exam.scenarios.map(rowHtml).join('')}</ul>`}`
        : `<p class="meb-empty">${T('scenNone')}</p>`}`;
  }

  function renderState(host, html) { host.innerHTML = `<div class="meb-state">${html}</div>`; }

  async function render(host) {
    state.host = host;
    if (data) { initFilters(); paint(); return; }
    renderState(host, `<div class="spinner" aria-hidden="true"></div> ${T('scenLoading')}`);
    try {
      await load();
      initFilters();
      if (state.host === host && host.isConnected) paint();
    } catch (err) {
      if (state.host === host && host.isConnected) renderState(host, `<p class="meb-error" role="alert">${esc(T('scenLoadFail', { e: err && err.message ? err.message : String(err) }))}</p>
        <button class="btn-ghost" data-scen-act="retry">${T('mebRetry')}</button>`);
    }
  }

  // Until the user picks a grade or subject themselves, the open deck's grade narrows the list (when it
  // has one and MEB has scenarios for it); with no such deck, everything is listed.
  function initFilters() {
    if (state.touched) return;
    const g = activeGrade();
    state.f.grade = g && data.sheets.some(s => s.grade === g) ? g : 0;
    state.f.subject = '';
  }

  async function run(key, act, work) {
    if (state.busy) return;
    state.busy = { key, act };
    state.err = null;
    paint();
    try {
      await work();
    } catch (err) {
      state.err = { key, msg: err && err.message ? err.message : String(err) };
    } finally {
      state.busy = null;
    }
    // On a successful open the library is already closed; otherwise show the outcome in place.
    if (state.host && state.host.isConnected) {
      paint();
      state.host.querySelector(`[data-row="${CSS.escape(key)}"] [data-scen-act="${act}"]`)?.focus();
    }
  }

  function init() {
    document.addEventListener('click', ev => {
      const host = state.host;
      if (!host || !host.isConnected || !host.contains(ev.target)) return;
      const g = ev.target.closest('[data-scen-grade]'), s = ev.target.closest('[data-scen-subject]'), x = ev.target.closest('[data-scen-exam]');
      if (g || s) state.touched = true;
      if (g) { state.f.grade = parseInt(g.dataset.scenGrade, 10) || 0; if (!subjectsOf(data.sheets, state.f.grade).includes(state.f.subject)) state.f.subject = ''; paint(); return; }
      if (s) { state.f.subject = s.dataset.scenSubject; paint(); return; }
      if (x) { state.ei = parseInt(x.dataset.scenExam, 10); paint(); return; }
      const b = ev.target.closest('[data-scen-act]');
      if (!b || b.disabled) return;
      if (b.dataset.scenAct === 'retry') { render(host); return; }
      if (b.dataset.scenAct === 'course') {
        const s = data.sheets.find(x => x.key === b.dataset.key);
        if (!s) throw new Error('Unknown course ' + b.dataset.key);
        run(courseKey(s), 'course', () => openCourse(s));
        return;
      }
      const e = data.items.find(it => keyOf(it) === b.dataset.key);
      if (!e) throw new Error('Unknown scenario ' + b.dataset.key);
      if (b.dataset.scenAct === 'open') run(b.dataset.key, 'open', () => open(e));
      else if (b.dataset.scenAct === 'profile') run(b.dataset.key, 'profile', () => applyProfile(e));
    });
    document.addEventListener('change', ev => {
      if (ev.target && ev.target.id === 'scen-sheet' && state.host && state.host.contains(ev.target)) { state.sel = ev.target.value; state.ei = -1; paint(); }
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  return { validateIndex, sheetsOf, filterSheets, subjectsOf, gradesOf, activeGrade, findDeck, prepare, prepareCourse, findCourseDeck, keyOf, courseKey, load, open, openCourse, applyProfile, render };
})();
