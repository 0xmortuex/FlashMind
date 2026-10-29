// ===== Update old videos and audio =====
// Video lessons and audio overviews are written by the AI and kept on the
// device, so the ones made before the pipeline was fixed (no "did you get
// this?" questions, written from the exam paper instead of the notes) stay as
// they were. This replaces them, for THIS school year's library sets only:
// last year's past papers are left alone. It works through the sets one at a
// time (each new video or audio overview is one AI request and the service
// allows about 30 an hour), and stops with a clear message when the limit or
// the connection is gone; sets already done are not redone.
const Refresh = (() => {
  const YEAR = '2026-2027';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // A library set of this school year: tagged with it, or an OGM written exam
  // (its paper prints no year; those are this term's).
  function thisYear(deck) {
    const m = deck && deck.data && deck.data.meta;
    return !!m && (m.schoolYear === YEAR || (!m.schoolYear && m.examType === 'ogm-yazili'));
  }

  function outdated(deck) {
    const d = deck.data || {};
    return { videos: VideoLesson.outdatedLessons(d).length, audio: AudioOverview.isOutdated(d) };
  }

  // This year's sets that still hold old content, and how many earlier-year sets are being left alone.
  function scan() {
    const todo = [];
    let leftAlone = 0;
    (Decks.list() || []).forEach(deck => {
      const o = outdated(deck);
      if (!o.videos && !o.audio) return;
      if (thisYear(deck)) todo.push({ id: deck.id, title: (deck.data && deck.data.title) || deck.title || '', ...o });
      else if (deck.data && deck.data.meta) leftAlone++;
    });
    return { todo, leftAlone };
  }

  // 'rate' | 'offline' | null: the failures that mean "stop and try later" rather than "this set failed".
  function stopReason(err) {
    const m = String((err && err.message) || err);
    if (/429|rate limit|too many/i.test(m)) return 'rate';
    if (err instanceof TypeError || /failed to fetch|networkerror|load failed|offline/i.test(m)) return 'offline';
    return null;
  }

  // Updates the sets in `ids`, one after another. hooks: onDeck(item, i, n), onStep(text), onResult(item, ok, why), cancelled().
  // Returns { ok, failed, stopped } where stopped is 'rate' | 'offline' | 'cancel' | null.
  async function run(ids, hooks) {
    const h = hooks || {};
    const T = i18n.t;
    let ok = 0, failed = 0;
    const items = scan().todo.filter(x => ids.includes(x.id));
    for (let i = 0; i < items.length; i++) {
      if (h.cancelled && h.cancelled()) return { ok, failed, stopped: 'cancel' };
      const item = items[i];
      const deck = Decks.get(item.id);
      const active = Decks.getActive();
      const open = !!active && active.id === item.id;
      const data = open ? App.getStudyData() : deck.data; // the open deck's live data is a separate object from the stored one
      const keep = () => { if (open) App.persistActiveDeck(); else Decks.touch(item.id); };
      if (h.onDeck) h.onDeck(item, i, items.length);
      try {
        if (item.videos) {
          await VideoLesson.refreshOld(data, topic => h.onStep && h.onStep(T('rfStep', { t: topic || item.title })));
          keep(); // the new videos are saved even if the audio fails below
        }
        if (item.audio) {
          if (h.onStep) h.onStep(T('rfStepAudio'));
          await AudioOverview.refreshOld(data);
          keep();
        }
        ok++;
        if (h.onResult) h.onResult(item, true, '');
      } catch (err) {
        const why = stopReason(err);
        if (why) return { ok, failed, stopped: why };
        failed++;
        if (h.onResult) h.onResult(item, false, err.message);
      }
    }
    return { ok, failed, stopped: null };
  }

  // ----- Screen -----

  let modal = null, release = null, running = false, cancel = false;

  function close() {
    if (running) return;
    if (release) { release(); release = null; }
    if (modal) { modal.remove(); modal = null; }
  }

  function listHtml(s) {
    const T = i18n.t;
    if (!s.todo.length) return `<p>${esc(T('rfNothing'))}</p>`;
    return `<ul class="rf-list">${s.todo.map(x => `<li><label><input type="checkbox" data-rf-id="${esc(x.id)}" checked> <span class="rf-title">${esc(x.title)}</span></label>
      <small>${esc([x.videos ? T('rfVideos', { n: x.videos }) : '', x.audio ? T('rfAudio') : ''].filter(Boolean).join(' · '))}</small>
      <span class="rf-state" data-rf-state="${esc(x.id)}" role="status"></span></li>`).join('')}</ul>`;
  }

  function open() {
    close();
    const T = i18n.t;
    const s = scan();
    modal = document.createElement('div');
    modal.className = 'report-backdrop';
    modal.innerHTML = `<div class="report-modal" role="dialog" aria-modal="true" aria-labelledby="rf-title">
      <div class="report-head"><h3 id="rf-title">${esc(T('rfTitle'))}</h3><button class="btn-icon" data-rf-act="close" aria-label="${esc(T('rfClose'))}">&times;</button></div>
      <div class="report-body">
        <p>${esc(T('rfIntro', { y: YEAR }))}</p>
        ${listHtml(s)}
        ${s.leftAlone ? `<p class="rf-note">${esc(T('rfLeftAlone', { n: s.leftAlone }))}</p>` : ''}
        <p class="rf-progress" data-rf-progress role="status" aria-live="polite"></p>
      </div>
      <div class="report-actions">
        <button class="btn-primary" data-rf-act="start"${s.todo.length ? '' : ' disabled'}>${esc(T('rfUpdate', { n: s.todo.length }))}</button>
        <button class="btn-ghost" data-rf-act="stop" hidden>${esc(T('rfStop'))}</button>
        <button class="btn-ghost" data-rf-act="close">${esc(T('rfClose'))}</button>
      </div></div>`;
    document.body.appendChild(modal);
    if (typeof FX !== 'undefined' && FX.trapFocus) release = FX.trapFocus(modal.querySelector('.report-modal'));
  }

  function chosen() {
    return [...modal.querySelectorAll('[data-rf-id]:checked')].map(b => b.dataset.rfId);
  }

  async function start() {
    if (running || !modal) return;
    const ids = chosen();
    if (!ids.length) return;
    const T = i18n.t;
    running = true; cancel = false;
    const startBtn = modal.querySelector('[data-rf-act="start"]'), stopBtn = modal.querySelector('[data-rf-act="stop"]');
    const progress = modal.querySelector('[data-rf-progress]');
    startBtn.disabled = true; stopBtn.hidden = false; stopBtn.disabled = false;
    modal.querySelectorAll('[data-rf-id]').forEach(b => { b.disabled = true; });
    const state = (id, text, cls) => { const el = modal && modal.querySelector(`[data-rf-state="${CSS.escape(id)}"]`); if (el) { el.textContent = text; el.className = 'rf-state ' + (cls || ''); } };
    const r = await run(ids, {
      cancelled: () => cancel,
      onDeck: (item, i, n) => { state(item.id, '…', 'busy'); progress.textContent = T('rfRunning', { t: item.title, i: i + 1, n }); },
      onStep: text => { progress.textContent = text; },
      onResult: (item, ok, why) => state(item.id, ok ? '✓' : '✗ ' + why, ok ? 'ok' : 'bad')
    });
    running = false;
    if (!modal) return;
    stopBtn.hidden = true;
    progress.textContent = r.stopped === 'rate' ? T('rfPausedRate') : r.stopped === 'offline' ? T('rfPausedOffline') : r.stopped === 'cancel' ? T('rfStopped') : T('rfDone', { ok: r.ok, fail: r.failed });
    const remaining = new Set(scan().todo.map(x => x.id));
    const left = ids.filter(id => remaining.has(id)).length;
    startBtn.textContent = T('rfUpdate', { n: left });
    startBtn.disabled = !left;
    modal.querySelectorAll('[data-rf-id]').forEach(b => { b.disabled = false; b.checked = remaining.has(b.dataset.rfId); });
    const tab = document.getElementById('tab-stats');
    if (typeof Stats !== 'undefined' && tab && tab.classList.contains('active')) Stats.render();
    if (r.ok) App.showToast(T('rfDone', { ok: r.ok, fail: r.failed }), r.failed ? 'info' : 'success');
  }

  // The Stats tab card, only when there is something to update.
  function statsCard() {
    const T = i18n.t;
    if (typeof Decks === 'undefined' || typeof VideoLesson === 'undefined' || typeof AudioOverview === 'undefined') return '';
    const s = scan();
    if (!s.todo.length) return '';
    return `<div class="stat-card rf-card"><h3 class="stat-card-title">&#128260; ${esc(T('rfCardTitle'))}</h3>
      <p class="plan-pitch">${esc(T('rfCardText', { n: s.todo.length }))}</p>
      <button class="btn-ghost" data-rf-act="open">${esc(T('rfOpen'))}</button></div>`;
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-rf-act]');
      if (b) {
        const act = b.dataset.rfAct;
        if (act === 'open') open();
        else if (act === 'close') close();
        else if (act === 'start') start();
        else if (act === 'stop') { cancel = true; b.disabled = true; }
        return;
      }
      if (modal && !running && e.target === modal) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !running) close(); });
  }

  return { init, scan, run, thisYear, statsCard, open, close, YEAR };
})();
