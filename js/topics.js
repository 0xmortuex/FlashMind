// ===== Topics =====
// Every notes section title is a button that opens a small menu with exactly
// three choices: bookmark the topic, ask the AI about it, or hear a short
// audio overview of just that section. Bookmarks (data.bookmarks) and the
// generated overviews (data.topicAudio, keyed by topic id) live on the study
// set, so they persist, sync and export with it. The "Saved topics" list in
// the notes header scrolls back to a bookmarked topic.
const Topics = (() => {
  let pop = null;          // the open popover element (menu or saved list)
  let popBackdrop = null;
  let popTrigger = null;
  let aud = null;          // the one overview being written/played: { id, idx, status, error, index, playing, token }
  let tokenSeq = 0;

  const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;'); };

  function sectionOf(data, idx) {
    const s = data && data.notes && data.notes.sections && data.notes.sections[idx];
    if (!s) throw new Error(i18n.t('topicGone'));
    return s;
  }

  // Stable per-section id (index + title), short enough for the normalizer's id pattern.
  function topicId(section, idx) {
    let h = 5381;
    const s = idx + '|' + section.title;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 't' + h.toString(36);
  }

  function sectionText(section) {
    const parts = [section.title, section.content];
    (section.keyTerms || []).forEach(k => parts.push(`${k.term}: ${k.definition}`));
    (section.bulletPoints || []).forEach(b => parts.push(b));
    return parts.filter(Boolean).join('\n');
  }

  function bookmarkFor(data, id) {
    return (data.bookmarks || []).find(b => b.id === id) || null;
  }

  // ----- Markup used by Notes.render -----

  function titleHtml(data, idx) {
    const section = data.notes.sections[idx];
    const on = !!bookmarkFor(data, topicId(section, idx));
    return `<button type="button" class="topic-btn${on ? ' bookmarked' : ''}" data-topic="${idx}" aria-haspopup="menu" aria-expanded="false" title="${esc(i18n.t('topicMenuHint'))}">` +
      `<span class="topic-btn-text">${esc(section.title)}</span>` +
      `<span class="topic-mark" aria-hidden="true">&#9733;</span><span class="topic-chev" aria-hidden="true">&#9662;</span></button>`;
  }

  function savedBtnHtml(data) {
    const n = (data.bookmarks || []).length;
    return `<button type="button" class="btn-ghost topic-saved-btn" aria-haspopup="menu" aria-expanded="false">&#128278; ${esc(i18n.t('topicSaved'))} <span class="topic-saved-count">${n}</span></button>`;
  }

  // ----- Popover (desktop: anchored menu, mobile: bottom sheet via CSS) -----

  function closePop(restoreFocus) {
    if (!pop) return;
    pop.remove(); popBackdrop.remove();
    if (popTrigger) {
      popTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) popTrigger.focus();
    }
    pop = popBackdrop = popTrigger = null;
  }

  function openPop(trigger, className, label, html) {
    closePop(false);
    popTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    popBackdrop = document.createElement('div');
    popBackdrop.className = 'topic-backdrop';
    popBackdrop.addEventListener('mousedown', () => closePop(true));
    pop = document.createElement('div');
    pop.className = 'topic-menu ' + className;
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', label);
    pop.innerHTML = html;
    document.body.append(popBackdrop, pop);
    const r = trigger.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    const first = pop.querySelector('[role="menuitem"]');
    if (first) first.focus();
  }

  function openMenu(btn) {
    const T = i18n.t;
    const data = App.getStudyData();
    const idx = +btn.dataset.topic;
    const section = sectionOf(data, idx);
    const saved = !!bookmarkFor(data, topicId(section, idx));
    const item = (act, icon, text, extra) => `<button type="button" class="topic-item" role="menuitem" data-topic-act="${act}" data-topic="${idx}"${extra || ''}><span class="topic-item-icon" aria-hidden="true">${icon}</span><span>${text}</span></button>`;
    openPop(btn, 'topic-actions', section.title,
      item('bookmark', '&#128278;', saved ? `${esc(T('topicBookmarked'))} &middot; ${esc(T('topicRemove'))}` : esc(T('topicBookmark')), ` aria-pressed="${saved}"`) +
      item('ask', '&#128172;', esc(T('topicAsk'))) +
      item('audio', '&#127911;', esc(T('topicAudio'))));
  }

  function openSaved(btn) {
    const T = i18n.t;
    const data = App.getStudyData();
    const list = data.bookmarks || [];
    const html = list.length
      ? list.map(b => `<button type="button" class="topic-item" role="menuitem" data-topic-act="goto" data-topic-id="${esc(b.id)}"><span class="topic-item-icon" aria-hidden="true">&#128278;</span><span>${esc(b.title)}</span></button>`).join('')
      : `<p class="topic-empty">${esc(T('topicSavedNone'))}</p>`;
    openPop(btn, 'topic-saved', T('topicSaved'), html);
  }

  function onMenuKey(e) {
    if (!pop) return;
    if (e.key === 'Escape') { e.preventDefault(); closePop(true); return; }
    if (e.key === 'Tab') { closePop(false); return; }
    const items = [...pop.querySelectorAll('[role="menuitem"]')];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    let to = null;
    if (e.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') to = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    if (to !== null) { e.preventDefault(); items[to].focus(); }
  }

  // ----- Bookmark -----

  function refreshBookmarkUi(data) {
    const root = document.getElementById('tab-notes');
    if (!root) return;
    root.querySelectorAll('.topic-btn').forEach(b => {
      b.classList.toggle('bookmarked', !!bookmarkFor(data, topicId(sectionOf(data, +b.dataset.topic), +b.dataset.topic)));
    });
    root.querySelectorAll('.topic-saved-count').forEach(c => { c.textContent = (data.bookmarks || []).length; });
  }

  function toggleBookmark(idx) {
    const data = App.getStudyData();
    const section = sectionOf(data, idx);
    const id = topicId(section, idx);
    const had = bookmarkFor(data, id);
    if (had) data.bookmarks = data.bookmarks.filter(b => b.id !== id);
    else data.bookmarks = (data.bookmarks || []).concat({ id, title: section.title, sectionIndex: idx, createdAt: Date.now() });
    if (!data.bookmarks.length) delete data.bookmarks;
    App.persistActiveDeck();
    refreshBookmarkUi(data);
    App.showToast(i18n.t(had ? 'topicRemoved' : 'topicSavedToast'), 'success');
  }

  function gotoTopic(id) {
    const data = App.getStudyData();
    const b = bookmarkFor(data, id);
    const sections = data.notes.sections;
    let idx = sections.findIndex((s, i) => topicId(s, i) === id);
    if (idx < 0 && b) idx = sections.findIndex(s => s.title === b.title);
    if (idx < 0) throw new Error(i18n.t('topicGone'));
    if (typeof Notes !== 'undefined') Notes.showView('notes');
    const el = document.querySelector(`#tab-notes .topic-btn[data-topic="${idx}"]`);
    if (!el) throw new Error(i18n.t('topicGone'));
    const sec = el.closest('.notes-section');
    sec.classList.add('in');
    sec.scrollIntoView({ block: 'start', behavior: typeof FX !== 'undefined' && FX.reduced() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    sec.classList.add('topic-flash');
    setTimeout(() => sec.classList.remove('topic-flash'), 1600);
  }

  // ----- Ask AI -----

  function ask(idx) {
    const data = App.getStudyData();
    const section = sectionOf(data, idx);
    // The prompt wrapper follows the UI language; the topic title stays as written.
    Chat.askAbout(i18n.t('topicAskPrompt', { title: section.title }), sectionText(section));
  }

  // ----- Audio overview of one section -----

  function friendlyError(err) {
    const T = i18n.t, m = String((err && err.message) || err);
    if (/429|rate.?limit|too many|quota/i.test(m)) return T('topicErrRate');
    if (err instanceof TypeError || /failed to fetch|networkerror|load failed|unreachable|HTTP 5\d\d/i.test(m)) return T('topicErrNet');
    return T('audioFailed') + ' ' + m;
  }

  function boxFor(idx) { return document.querySelector(`#tab-notes [data-topic-audio-box="${idx}"]`); }

  function renderAudio() {
    if (!aud) return;
    const box = boxFor(aud.idx);
    if (!box) return;
    const T = i18n.t;
    const data = App.getStudyData();
    const script = data.topicAudio && data.topicAudio[aud.id];
    box.hidden = false;
    if (aud.status === 'loading') {
      box.innerHTML = `<div class="topic-audio-status"><span class="topic-spin" aria-hidden="true"></span> ${esc(T('topicAudioWriting'))}</div>`;
    } else if (aud.status === 'error') {
      box.innerHTML = `<div class="topic-audio-status topic-audio-error" role="alert"><span>${esc(aud.error)}</span>
        <button type="button" class="btn-ghost" data-topic-audio-act="retry">${esc(T('topicRetry'))}</button>
        <button type="button" class="btn-ghost" data-topic-audio-act="close">${esc(T('close'))}</button></div>`;
    } else {
      const ttsOk = typeof TTS !== 'undefined' && TTS.supported();
      box.innerHTML = `<div class="topic-audio-player">
        <div class="topic-audio-head"><strong>&#127911; ${esc(script.title || T('topicAudio'))}</strong>
          <span class="topic-audio-count"></span></div>
        ${ttsOk ? `<div class="topic-audio-controls">
          <button type="button" class="audio-play" data-topic-audio-act="${aud.playing ? 'pause' : 'play'}" aria-label="${esc(aud.playing ? T('audioPause') : T('audioPlay'))}">${aud.playing ? '&#10074;&#10074;' : '&#9654;'}</button>
          <button type="button" class="btn-ghost" data-topic-audio-act="stop">&#9632; ${esc(T('topicStop'))}</button>
          <button type="button" class="btn-ghost" data-topic-audio-act="close">${esc(T('close'))}</button></div>`
          : `<p class="audio-notts">${esc(T('audioNoTts'))}</p><button type="button" class="btn-ghost" data-topic-audio-act="close">${esc(T('close'))}</button>`}
        <details class="topic-audio-script"><summary>${esc(T('topicTranscript'))}</summary>
          ${script.lines.map((l, i) => `<p class="topic-audio-line speaker-${l.speaker}" data-topic-line="${i}"><span class="audio-speaker">${esc(l.speaker === 'B' ? T('audioHostB') : T('audioHostA'))}</span> ${esc(l.text)}</p>`).join('')}
        </details></div>`;
      paintLine(box, script.lines.length);
    }
  }

  function paintLine(box, total) {
    const c = box.querySelector('.topic-audio-count');
    if (c) c.textContent = i18n.t('audioLine', { i: Math.min(aud.index + 1, total), n: total });
    box.querySelectorAll('.topic-audio-line').forEach((p, i) => p.classList.toggle('current', aud.playing && i === aud.index));
  }

  function stopSpeech() {
    if (aud) { aud.token = ++tokenSeq; aud.playing = false; }
    if (typeof TTS !== 'undefined') TTS.stop();
  }

  function playFrom(i) {
    const data = App.getStudyData();
    const script = aud && data.topicAudio && data.topicAudio[aud.id];
    if (!script || typeof TTS === 'undefined' || !TTS.supported()) return;
    if (i >= script.lines.length) { aud.playing = false; aud.index = 0; renderAudio(); return; }
    aud.index = Math.max(0, i);
    const was = aud.playing;
    aud.playing = true;
    const my = aud.token = ++tokenSeq;
    const line = script.lines[aud.index];
    const v = AudioOverview.voices()[line.speaker === 'B' ? 'B' : 'A'];
    const bx = boxFor(aud.idx);
    if (!was) renderAudio(); else if (bx) paintLine(bx, script.lines.length);
    TTS.speak(line.text, cancelled => {
      if (!aud || my !== aud.token) return;
      if (cancelled) { aud.playing = false; renderAudio(); return; }
      playFrom(aud.index + 1);
    }, { voice: v.voice, pitch: v.pitch, rate: 1 });
  }

  async function startAudio(idx) {
    const data = App.getStudyData();
    const section = sectionOf(data, idx);
    const id = topicId(section, idx);
    if (typeof AudioOverview !== 'undefined') AudioOverview.stop();
    stopSpeech();
    const old = aud && aud.idx !== idx ? boxFor(aud.idx) : null;
    if (old) { old.hidden = true; old.innerHTML = ''; }
    const my = ++tokenSeq;
    aud = { id, idx, status: 'loading', error: '', index: 0, playing: false, token: my };
    if (data.topicAudio && data.topicAudio[id]) { aud.status = 'ready'; playFrom(0); return; }
    renderAudio();
    try {
      const script = await AudioOverview.generateFor(sectionText(section), section.title);
      if (!aud || aud.token !== my || App.getStudyData() !== data) return;
      data.topicAudio = Object.assign({}, data.topicAudio, { [id]: script });
      App.persistActiveDeck();
      aud.status = 'ready';
      playFrom(0);
    } catch (err) {
      if (!aud || aud.token !== my || App.getStudyData() !== data) return;
      aud.status = 'error';
      aud.error = friendlyError(err);
      if (!boxFor(idx)) App.showToast(aud.error, 'error'); // the notes were re-rendered meanwhile
      renderAudio();
    }
  }

  function closeAudio() {
    if (!aud) return;
    const box = boxFor(aud.idx);
    stopSpeech();
    if (box) { box.hidden = true; box.innerHTML = ''; }
    aud = null;
  }

  function onAudioAct(act) {
    if (!aud) return;
    if (act === 'play') playFrom(aud.index);
    else if (act === 'pause') { stopSpeech(); renderAudio(); }
    else if (act === 'stop') { stopSpeech(); aud.index = 0; renderAudio(); }
    else if (act === 'retry') startAudio(aud.idx);
    else if (act === 'close') closeAudio();
  }

  // Called by Notes.render: the old DOM is gone, so drop popovers and playback.
  function reset() {
    closePop(false);
    if (aud) { stopSpeech(); aud = null; }
  }

  function guard(fn) {
    try { return fn(); } catch (err) { App.showToast(err.message, 'error'); }
  }

  function init() {
    document.addEventListener('click', e => {
      const audioBtn = e.target.closest('[data-topic-audio-act]');
      if (audioBtn) { guard(() => onAudioAct(audioBtn.dataset.topicAudioAct)); return; }
      const act = e.target.closest('[data-topic-act]');
      if (act && pop && pop.contains(act)) {
        const idx = +act.dataset.topic;
        const kind = act.dataset.topicAct;
        const id = act.dataset.topicId;
        closePop(kind === 'bookmark' || kind === 'goto');
        guard(() => {
          if (kind === 'bookmark') toggleBookmark(idx);
          else if (kind === 'ask') ask(idx);
          else if (kind === 'audio') startAudio(idx);
          else if (kind === 'goto') gotoTopic(id);
        });
        return;
      }
      const btn = e.target.closest('.topic-btn');
      if (btn) { guard(() => (pop && popTrigger === btn ? closePop(false) : openMenu(btn))); return; }
      const saved = e.target.closest('.topic-saved-btn');
      if (saved) { guard(() => (pop && popTrigger === saved ? closePop(false) : openSaved(saved))); }
    });
    document.addEventListener('keydown', onMenuKey);
  }

  return { init, reset, titleHtml, savedBtnHtml, topicId };
})();
