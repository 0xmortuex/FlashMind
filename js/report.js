// ===== Progress report =====
// A factual one-week summary for a parent or teacher, built only from what is
// stored on this device (no AI call): days studied, cards reviewed and how many
// were remembered, exam results, the topics that need work, how video-lesson
// questions went and the exam countdowns, across every deck. It can be copied
// as text, sent through the system share sheet or printed.
const Report = (() => {
  const DAY = 86400000;
  const WEAK_BELOW = 0.65;   // share of right answers under which a topic is "weak"
  const WEAK_MIN = 3;        // answers needed before a topic is judged

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Everything the report says. decks: Decks.list(); stats: Stats.snapshot(); dueByDeck: { deckId: due cards }.
  function build(decks, stats, now, goal, dueByDeck) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const t = now - i * DAY;
      const e = (stats.days || {})[dayKey(t)] || {};
      days.push({ day: dayKey(t), t, reviews: e.reviews || 0, gotit: e.gotit || 0, focus: e.focus || 0 });
    }
    const reviews = days.reduce((n, d) => n + d.reviews, 0);
    const gotit = days.reduce((n, d) => n + d.gotit, 0);
    const out = {
      from: days[0].t, to: now, days,
      studiedDays: days.filter(d => d.reviews > 0 || d.focus > 0).length,
      reviews, remembered: reviews ? Math.round(gotit / reviews * 100) : null,
      focusMinutes: days.reduce((n, d) => n + d.focus, 0),
      goal: goal || 0, goalDays: goal ? days.filter(d => d.reviews >= goal).length : 0,
      exams: (stats.exams || []).filter(e => now - e.t < 7 * DAY).map(e => ({ title: e.title || '', pct: e.pct, grade: e.grade || '' })),
      weak: [], lessons: [], decks: []
    };
    (decks || []).forEach(deck => {
      const data = deck.data || {};
      const weekStart = now - 7 * DAY;
      const cardsWeek = (deck.rlog || []).filter(e => Array.isArray(e) && e[1] * 60000 >= weekStart).length;
      // Topics: right answers per question category, from the per-question history.
      const cats = {};
      (data.quiz || []).forEach(q => {
        const s = (deck.qstats || {})[q.id];
        if (!s || !q.category) return;
        const c = cats[q.category] = cats[q.category] || { ok: 0, n: 0 };
        c.ok += s.ok || 0; c.n += s.n || 0;
      });
      Object.keys(cats).forEach(topic => {
        const c = cats[topic];
        if (c.n >= WEAK_MIN && c.ok / c.n < WEAK_BELOW) out.weak.push({ topic, deck: data.title || deck.title || '', pct: Math.round(c.ok / c.n * 100), n: c.n });
      });
      (data.lessons || []).forEach(l => {
        const counts = { right: 0, wrong: 0, lost: 0, skipped: 0 };
        // A slide that was practised afterwards was still answered wrong first.
        Object.values(l.checks || {}).forEach(v => { if (v === 'practised') counts.wrong++; else if (v in counts) counts[v]++; });
        if (counts.right + counts.wrong + counts.lost + counts.skipped) out.lessons.push({ deck: data.title || deck.title || '', title: l.title, ...counts });
      });
      let daysToExam = null;
      if (deck.examDate) {
        const t = new Date(deck.examDate + 'T00:00:00').getTime();
        if (Number.isFinite(t) && t >= now - DAY) daysToExam = Math.max(0, Math.ceil((t - now) / DAY));
      }
      out.decks.push({ title: data.title || deck.title || '', cards: (data.flashcards || []).length, due: (dueByDeck || {})[deck.id] || 0, cardsWeek, examDate: deck.examDate || '', daysToExam });
    });
    out.weak.sort((a, b) => a.pct - b.pct || b.n - a.n);
    out.weak = out.weak.slice(0, 6);
    out.decks.sort((a, b) => b.cardsWeek - a.cardsWeek);
    return out;
  }

  function dateText(t, opts) {
    return new Date(t).toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-GB', opts);
  }

  // The report as plain text, to paste into a message.
  function toText(r) {
    const T = i18n.t;
    const L = [];
    L.push(T('repTitle'));
    L.push(`${dateText(r.from, { day: 'numeric', month: 'short' })} – ${dateText(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`);
    L.push('');
    L.push(T('repStudied', { d: r.studiedDays, c: r.reviews }) + (r.remembered !== null ? ' ' + T('repRemembered', { p: r.remembered }) : ''));
    if (r.focusMinutes) L.push(T('repFocus', { m: r.focusMinutes }));
    if (r.goal) L.push(T('repGoal', { d: r.goalDays, g: r.goal }));
    L.push(T('repByDay') + ': ' + r.days.map(d => `${dateText(d.t, { weekday: 'short' })} ${d.reviews}`).join(', '));
    if (r.exams.length) { L.push(''); L.push(T('repExams') + ':'); r.exams.forEach(e => L.push(`- ${e.title || T('repExam')}: ${e.pct}/100${e.grade ? ' (' + e.grade + ')' : ''}`)); }
    if (r.weak.length) { L.push(''); L.push(T('repWeak') + ':'); r.weak.forEach(w => L.push(`- ${w.topic}${w.deck ? ' (' + w.deck + ')' : ''}: ${T('repWeakLine', { p: w.pct, n: w.n })}`)); }
    if (r.lessons.length) { L.push(''); L.push(T('repLessons') + ':'); r.lessons.forEach(l => L.push(`- ${l.title}: ${T('repLessonLine', { r: l.right, w: l.wrong, l: l.lost })}`)); }
    const countdown = r.decks.filter(d => d.daysToExam !== null);
    if (countdown.length) { L.push(''); L.push(T('repCountdown') + ':'); countdown.forEach(d => L.push(`- ${d.title}: ${T('repDaysLeft', { n: d.daysToExam })}`)); }
    if (r.decks.length) { L.push(''); L.push(T('repDecks') + ':'); r.decks.slice(0, 8).forEach(d => L.push(`- ${d.title}: ${T('repDeckLine', { w: d.cardsWeek, due: d.due })}`)); }
    return L.join('\n');
  }

  function toHtml(r) {
    const T = i18n.t;
    const max = Math.max(1, ...r.days.map(d => d.reviews));
    const section = (title, body) => body ? `<section class="rep-sec"><h4>${esc(title)}</h4>${body}</section>` : '';
    const list = items => items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '';
    const countdown = r.decks.filter(d => d.daysToExam !== null);
    return `<p class="rep-range">${esc(dateText(r.from, { day: 'numeric', month: 'short' }))} – ${esc(dateText(r.to, { day: 'numeric', month: 'short', year: 'numeric' }))}</p>
      <p class="rep-lead"><strong>${esc(T('repStudied', { d: r.studiedDays, c: r.reviews }))}</strong>${r.remembered !== null ? ' ' + esc(T('repRemembered', { p: r.remembered })) : ''}${r.focusMinutes ? '<br>' + esc(T('repFocus', { m: r.focusMinutes })) : ''}${r.goal ? '<br>' + esc(T('repGoal', { d: r.goalDays, g: r.goal })) : ''}</p>
      <div class="rep-days" role="img" aria-label="${esc(T('repByDay') + ': ' + r.days.map(d => `${dateText(d.t, { weekday: 'short' })} ${d.reviews}`).join(', '))}">${r.days.map(d => `<span class="rep-day"><span class="rep-bar" style="height:${Math.round(d.reviews / max * 100)}%"></span><small>${esc(dateText(d.t, { weekday: 'short' }))}</small><b>${d.reviews}</b></span>`).join('')}</div>` +
      section(T('repExams'), list(r.exams.map(e => `${esc(e.title || T('repExam'))}: <strong>${e.pct}/100</strong>${e.grade ? ' (' + esc(e.grade) + ')' : ''}`))) +
      section(T('repWeak'), list(r.weak.map(w => `<strong>${esc(w.topic)}</strong>${w.deck ? ' <small>(' + esc(w.deck) + ')</small>' : ''}: ${esc(T('repWeakLine', { p: w.pct, n: w.n }))}`))) +
      section(T('repLessons'), list(r.lessons.map(l => `${esc(l.title)}: ${esc(T('repLessonLine', { r: l.right, w: l.wrong, l: l.lost }))}`))) +
      section(T('repCountdown'), list(countdown.map(d => `<strong>${esc(d.title)}</strong>: ${esc(T('repDaysLeft', { n: d.daysToExam }))}`))) +
      section(T('repDecks'), list(r.decks.slice(0, 8).map(d => `${esc(d.title)}: ${esc(T('repDeckLine', { w: d.cardsWeek, due: d.due }))}`)));
  }

  function current() {
    const due = {};
    (typeof Decks !== 'undefined' ? Decks.dueAcrossDecks() : []).forEach(x => { due[x.deckId] = (due[x.deckId] || 0) + 1; });
    return build(typeof Decks !== 'undefined' ? Decks.list() : [], Stats.snapshot(), Date.now(), Stats.goal(), due);
  }

  // ----- Modal -----

  let modal = null, release = null, last = null;

  function close() {
    if (!modal) return;
    if (release) { release(); release = null; }
    modal.remove();
    modal = null;
    document.body.classList.remove('printing-report');
  }

  function open() {
    close();
    const T = i18n.t;
    last = current();
    modal = document.createElement('div');
    modal.className = 'report-backdrop';
    modal.innerHTML = `<div class="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div class="report-head"><h3 id="report-title">${esc(T('repTitle'))}</h3><button class="btn-icon" data-report-act="close" aria-label="${esc(T('repClose'))}">&times;</button></div>
      <div class="report-body">${toHtml(last)}</div>
      <div class="report-actions">
        <button class="btn-primary" data-report-act="copy">${esc(T('repCopy'))}</button>
        <button class="btn-ghost" data-report-act="send"${typeof navigator.share === 'function' ? '' : ' hidden'}>${esc(T('repSend'))}</button>
        <button class="btn-ghost" data-report-act="print">${esc(T('repPrint'))}</button>
      </div></div>`;
    document.body.appendChild(modal);
    if (typeof FX !== 'undefined' && FX.trapFocus) release = FX.trapFocus(modal.querySelector('.report-modal'));
  }

  async function copy() {
    try { await navigator.clipboard.writeText(toText(last)); App.showToast(i18n.t('repCopied'), 'success'); }
    catch (err) { App.showToast(i18n.t('failedCopy') + ' ' + err.message, 'error'); }
  }

  async function send() {
    try { await navigator.share({ title: i18n.t('repTitle'), text: toText(last) }); }
    catch (err) { if (err.name !== 'AbortError') App.showToast(i18n.t('shareFailed') + ' ' + err.message, 'error'); } // closing the sheet is not an error
  }

  function print() {
    document.body.classList.add('printing-report');
    window.print();
    document.body.classList.remove('printing-report');
  }

  // The Stats tab card that opens the report.
  function statsCard() {
    const T = i18n.t;
    return `<div class="stat-card rep-card"><h3 class="stat-card-title">&#128196; ${esc(T('repCardTitle'))}</h3>
      <p class="plan-pitch">${esc(T('repCardText'))}</p>
      <button class="btn-ghost" data-report-act="open">${esc(T('repOpen'))}</button></div>`;
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-report-act]');
      if (b) {
        const act = b.dataset.reportAct;
        if (act === 'open') open();
        else if (act === 'close') close();
        else if (act === 'copy') copy();
        else if (act === 'send') send();
        else if (act === 'print') print();
        return;
      }
      if (modal && e.target === modal) close(); // a click on the dimmed backdrop
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal) close(); });
  }

  return { init, build, toText, toHtml, statsCard, open, close };
})();
