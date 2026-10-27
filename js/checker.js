// ===== Answer Checker =====
// AI-generated cards and exam answers can be wrong, and a wrong card you
// memorize costs marks. The checker sends every card and question (with its
// keyed answer) back to the AI together with the source material, in batches,
// and asks for a strict verdict per item: ok / wrong / unsupported /
// ambiguous, with a short reason and a corrected answer. Verdicts are stored
// on the items (item.check) so flags survive reloads and sync; flagged items
// get a badge, and a review panel offers apply-fix / ignore / delete.
const Checker = (() => {
  const BATCH = 20;
  const AUTO_KEY = 'flashmind_autocheck';
  let running = false;
  let progress = null; // { done, total }
  let el = null, releaseTrap = null;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function autoEnabled() {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; }
  }
  function setAuto(on) {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) { /* non-fatal */ }
  }

  // The keyed answer of a question, as text.
  function answerText(q) {
    if (q.type === 'multiple-choice') return (q.options || [])[q.correct] || '';
    if (q.type === 'true-false') return q.correct ? 'True' : 'False';
    if (q.type === 'fill-blank') return (q.answers || []).join(' / ');
    if (q.type === 'matching') return (q.pairs || []).map(p => p.left + ' → ' + p.right).join('; ');
    return q.correctAnswer || '';
  }

  function questionText(q) {
    if (q.type === 'multiple-choice') return q.question + '\nOptions: ' + (q.options || []).map((o, i) => String.fromCharCode(65 + i) + ') ' + o).join(' | ');
    return q.question;
  }

  // Everything checkable in a set, as { ref, kind, item, q, a }.
  function itemsOf(data, onlyUnchecked) {
    const out = [];
    (data.flashcards || []).forEach(c => {
      if (c.occlusion) return; // image cards: nothing textual to verify
      if (onlyUnchecked && c.check) return;
      out.push({ ref: 'c' + c.id, kind: 'card', item: c, q: c.front, a: c.back });
    });
    (data.quiz || []).forEach(q => {
      if (onlyUnchecked && q.check) return;
      out.push({ ref: 'q' + q.id, kind: 'question', item: q, q: questionText(q), a: answerText(q) });
    });
    return out;
  }

  function prompt(batch) {
    const items = batch.map(x => `[${x.ref}] ${x.kind === 'card' ? 'Flashcard' : 'Exam question'}: ${x.q}\nKeyed answer: ${x.a}`).join('\n\n');
    return 'You are a strict fact-checker for exam study material. For EACH item below, check whether the keyed answer is correct, ' +
      'using the study material first and well-established knowledge second. Verdicts: "ok" (correct and answerable), ' +
      '"wrong" (the keyed answer is factually incorrect), "unsupported" (cannot be confirmed from the material and is doubtful), ' +
      '"ambiguous" (the question is unclear or has more than one defensible answer). For anything not "ok", give a one-sentence ' +
      'problem and, when possible, a corrected answer in "fix" (for a multiple-choice question, the text of the correct option). ' +
      'Be conservative: only flag real problems, not style. Write problem and fix in the language of the material.\n' +
      'Return ONLY JSON, no other text: {"type":"verify","results":[{"ref":"c1","verdict":"ok","problem":"","fix":""}]} ' +
      'with one result per item, in order.\n\nItems:\n' + items;
  }

  // Run the checker over the open set. `onlyUnchecked` skips items with an
  // existing verdict (used by the automatic post-generation check).
  async function run(onlyUnchecked) {
    const data = App.getStudyData();
    if (!data || running) return null;
    const all = itemsOf(data, onlyUnchecked);
    if (!all.length) { if (!onlyUnchecked) App.showToast(i18n.t('chkNothing'), 'info'); return { issues: 0 }; }
    running = true;
    progress = { done: 0, total: all.length };
    refreshViews();
    let issues = 0, failed = 0;
    const context = App.getOriginalText();
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      try {
        const raw = await API.chat(prompt(batch), context);
        if (App.getStudyData() !== data) break; // another set was opened
        const obj = Parser.safeParseJSON(raw);
        const results = obj && Array.isArray(obj.results) ? obj.results : [];
        const byRef = {};
        results.forEach(r => { if (r && typeof r.ref === 'string') byRef[r.ref] = r; });
        batch.forEach((x, k) => {
          const r = byRef[x.ref] || results[k];
          if (!r) return;
          const v = ['ok', 'wrong', 'unsupported', 'ambiguous'].includes(r.verdict) ? r.verdict : 'ok';
          x.item.check = { v, p: String(r.problem || '').slice(0, 400), f: String(r.fix || '').slice(0, 600), t: Date.now() };
          if (v !== 'ok') issues++;
        });
      } catch (err) {
        failed += batch.length;
      }
      progress.done = Math.min(all.length, i + batch.length);
      refreshViews();
    }
    running = false;
    progress = null;
    if (App.getStudyData() === data) App.persistActiveDeck();
    refreshViews();
    const T = i18n.t;
    if (failed && failed === all.length) App.showToast(T('chkFailed'), 'error');
    else App.showToast(issues ? T('chkIssues', { n: issues }) : T('chkClean', { n: all.length - failed }), issues ? 'info' : 'success');
    return { issues, failed };
  }

  function flagged(data) {
    return itemsOf(data || App.getStudyData() || {}, false).filter(x => x.item.check && x.item.check.v !== 'ok');
  }

  function refreshViews() {
    if (typeof Flashcards !== 'undefined') Flashcards.render(false);
    const quizTab = document.getElementById('tab-quiz');
    if (quizTab && typeof Quiz !== 'undefined' && Quiz.isIdle && Quiz.isIdle()) Quiz.renderReady();
    if (el && el.style.display !== 'none') renderPanel();
  }

  // Header controls for the Flashcards and Exam tabs.
  function toolbarHtml(kind) {
    const T = i18n.t;
    const data = App.getStudyData();
    if (!data) return '';
    const n = flagged(data).filter(x => kind === 'any' || x.kind === kind).length;
    if (running && progress) return `<span class="chk-progress">&#128737;&#65039; ${T('chkRunning', { d: progress.done, n: progress.total })}</span>`;
    return `<button class="btn-ghost chk-btn" data-chk-act="run">&#128737;&#65039; ${T('chkBtn')}</button>` +
      (n ? `<button class="btn-ghost chk-flagged" data-chk-act="review">&#9888;&#65039; ${T('chkFlagged', { n })}</button>` : '');
  }

  function badge(item) {
    const c = item && item.check;
    if (!c || c.v === 'ok') return '';
    return `<span class="chk-badge ${c.v}" title="${esc(i18n.t('chkV_' + c.v) + (c.p ? ': ' + c.p : ''))}">&#9888;</span>`;
  }

  // ----- Review panel -----

  function open() {
    if (!el) {
      el = document.createElement('div');
      el.className = 'shortcuts-backdrop';
      el.style.display = 'none';
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        if (e.target === el || e.target.closest('[data-chk-close]')) { close(); return; }
        const b = e.target.closest('[data-chk-fix],[data-chk-ignore],[data-chk-del]');
        if (b) act(b);
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.style.display !== 'none') close(); });
    }
    renderPanel();
    el.style.display = 'flex';
    releaseTrap = FX.trapFocus(el);
  }

  function close() {
    if (!el) return;
    el.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function canFix(x) {
    if (!x.item.check || !x.item.check.f) return false;
    if (x.kind === 'card') return true;
    const t = x.item.type;
    if (t === 'open-ended' || t === 'fill-blank') return true;
    if (t === 'multiple-choice') return optionIndex(x.item, x.item.check.f) >= 0;
    if (t === 'true-false') return /^(true|false|doğru|yanlış)$/i.test(x.item.check.f.trim());
    return false;
  }

  function optionIndex(q, text) {
    const n = s => String(s).toLocaleLowerCase('tr').replace(/^[a-e]\)\s*/, '').trim();
    return (q.options || []).findIndex(o => n(o) === n(text));
  }

  function renderPanel() {
    const T = i18n.t;
    const list = flagged();
    el.innerHTML = `<div class="shortcuts-card chk-panel" role="dialog" aria-modal="true" aria-labelledby="chk-title">
      <div class="chk-head"><h3 id="chk-title">&#128737;&#65039; ${T('chkTitle')}</h3><button class="btn-icon" data-chk-close aria-label="${esc(T('close'))}">&times;</button></div>
      ${list.length ? `<p class="chk-intro">${T('chkIntro', { n: list.length })}</p>` : `<p class="chk-intro">${T('chkNone')}</p>`}
      <div class="chk-list">${list.map(x => `<div class="chk-item ${x.item.check.v}">
        <div class="chk-item-head"><span class="chk-verdict ${x.item.check.v}">${T('chkV_' + x.item.check.v)}</span><span class="chk-kind">${x.kind === 'card' ? T('tabFlashcards') : T('tabQuiz')}</span></div>
        <p class="chk-q">${esc(x.kind === 'card' ? x.item.front : x.item.question)}</p>
        <p class="chk-a"><b>${T('chkKeyed')}</b> ${esc(x.a)}</p>
        ${x.item.check.p ? `<p class="chk-problem">${esc(x.item.check.p)}</p>` : ''}
        ${x.item.check.f ? `<p class="chk-fix"><b>${T('chkSuggested')}</b> ${esc(x.item.check.f)}</p>` : ''}
        <div class="chk-actions">
          ${canFix(x) ? `<button class="btn-primary" data-chk-fix="${esc(x.ref)}">${T('chkApply')}</button>` : ''}
          <button class="btn-ghost" data-chk-ignore="${esc(x.ref)}">${T('chkIgnore')}</button>
          <button class="btn-ghost editor-danger" data-chk-del="${esc(x.ref)}">${T('chkDelete')}</button>
        </div>
      </div>`).join('')}</div>
    </div>`;
  }

  function act(btn) {
    const data = App.getStudyData();
    if (!data) return;
    const ref = btn.dataset.chkFix || btn.dataset.chkIgnore || btn.dataset.chkDel;
    const x = itemsOf(data, false).find(i => i.ref === ref);
    if (!x) return;
    if (btn.dataset.chkFix) {
      const fix = x.item.check.f.trim();
      if (x.kind === 'card') x.item.back = fix;
      else if (x.item.type === 'open-ended') x.item.correctAnswer = fix;
      else if (x.item.type === 'fill-blank') x.item.answers = [fix];
      else if (x.item.type === 'multiple-choice') x.item.correct = optionIndex(x.item, fix);
      else if (x.item.type === 'true-false') x.item.correct = /^(true|doğru)$/i.test(fix);
      x.item.check = { v: 'ok', fixed: true, t: Date.now() };
      App.showToast(i18n.t('chkApplied'), 'success');
    } else if (btn.dataset.chkIgnore) {
      x.item.check = { v: 'ok', ignored: true, t: Date.now() };
    } else {
      if (!confirm(i18n.t('chkDeleteConfirm'))) return;
      const arr = x.kind === 'card' ? data.flashcards : data.quiz;
      const i = arr.indexOf(x.item);
      if (i >= 0) arr.splice(i, 1);
      if (x.kind === 'question' && typeof Quiz !== 'undefined') Quiz.setQuestions(data.quiz);
    }
    App.persistActiveDeck();
    refreshViews();
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-chk-act]');
      if (!b) return;
      if (b.dataset.chkAct === 'run') run(false);
      else if (b.dataset.chkAct === 'review') open();
    });
  }

  return { init, run, open, flagged, toolbarHtml, badge, autoEnabled, setAuto, answerText, isRunning: () => running };
})();
