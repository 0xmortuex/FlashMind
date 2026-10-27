// ===== Lecture companion =====
// Sit in class with the phone on the desk: the teacher is transcribed live,
// and every few minutes the new part of the transcript becomes note sections,
// flashcards and "exam alerts" (the teacher says it will be asked, stresses
// it, repeats it, dictates a definition) that are appended to a deck as the
// lesson goes. The transcript itself is stored as one of the deck's sources.
//
// Transcription: Gemini Live input transcription through a transcription-only
// token (works in every browser, handles Turkish well, mic picker). A Live
// session lasts at most 15 minutes, so a fresh token and connection take over
// shortly before that, with audio buffered across the switch. When the Live
// path isn't available, the browser's own speech recognition is the fallback.
const Lecture = (() => {
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const MAX_MS = 90 * 60000;        // hard stop
  const CHUNK_EVERY = 5 * 60000;    // notes cadence
  const RENEW_BEFORE = 90 * 1000;   // reconnect this long before a session's end
  const FLUSH_AFTER = 25 * 1000;    // force transcription out when it stalls
  const BUFFER_MAX = 60 * 50;       // ~60 s of 20 ms-ish chunks kept while reconnecting
  let el = null, pill = null, releaseTrap = null;
  let view = 'setup';               // setup | live | finishing | done
  let lec = null;                   // the running (or last) lecture
  let target = 'new';               // 'open' | 'new'
  let engine = 'gemini';            // 'gemini' | 'browser'
  let lessonLang = null;
  let micId = '';
  let mics = [];                    // [{ id, label }]
  try { micId = localStorage.getItem('flashmind_voice_mic') || ''; } catch (e) {}
  try { engine = localStorage.getItem('flashmind_lecture_engine') === 'browser' ? 'browser' : 'gemini'; } catch (e) {}

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }
  const T = (k, p) => i18n.t(k, p);
  const SpeechRec = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const liveSupported = () => typeof WebSocket !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof AudioWorkletNode !== 'undefined';
  const isActive = () => !!lec && (view === 'live' || view === 'finishing');

  // ----- Panel -----

  function open() {
    if (!el) build();
    if (!isActive() && view !== 'done') {
      view = 'setup';
      target = App.getStudyData() ? 'open' : 'new';
    }
    if (!lessonLang) lessonLang = i18n.getLang() === 'tr' ? 'tr' : 'en';
    render();
    el.style.display = 'flex';
    releaseTrap = FX.trapFocus(el);
    updatePill();
  }

  // Hiding the panel keeps a running lecture going (a pill reopens it).
  function hide() {
    if (!el) return;
    el.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (view === 'done') view = 'setup';
    updatePill();
  }

  function build() {
    el = document.createElement('div');
    el.className = 'shortcuts-backdrop';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target === el) { hide(); return; }
      const t = e.target.closest('[data-lec-target]');
      if (t && view === 'setup') { target = t.dataset.lecTarget; render(); return; }
      const b = e.target.closest('[data-lec-act]');
      if (!b) return;
      const act = b.dataset.lecAct;
      if (act === 'start') start();
      else if (act === 'pause') setPaused(true);
      else if (act === 'resume') setPaused(false);
      else if (act === 'stop') finish();
      else if (act === 'hide' || act === 'close') hide();
      else if (act === 'review') review();
      else if (act === 'copy') copyTranscript();
    });
    el.addEventListener('change', e => {
      const id = e.target.id;
      if (id === 'lec-engine') { engine = e.target.value; try { localStorage.setItem('flashmind_lecture_engine', engine); } catch (err) {} render(); }
      else if (id === 'lec-lang') lessonLang = e.target.value;
      else if (id === 'lec-mic') { micId = e.target.value; try { localStorage.setItem('flashmind_voice_mic', micId); } catch (err) {} }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.style.display !== 'none') hide(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isActive()) wakeLock(); });
  }

  function defaultTitle() {
    const d = new Date();
    const date = d.toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' });
    return T('lecDefaultTitle', { date });
  }

  function render() {
    if (!el) return;
    const data = App.getStudyData();
    let body = '';
    if (view === 'setup') body = setupHtml(data);
    else if (view === 'done') body = doneHtml();
    else body = liveHtml();
    el.innerHTML = `<div class="shortcuts-card voice-panel lec-panel" role="dialog" aria-modal="true" aria-labelledby="lec-title">
      <div class="voice-head">
        <h3 id="lec-title">&#127979; ${T('lecTitle')}</h3>
        <button class="btn-icon" data-lec-act="${isActive() ? 'hide' : 'close'}" aria-label="${esc(isActive() ? T('lecMinimize') : T('close'))}">${isActive() ? '&#8211;' : '&times;'}</button>
      </div>${body}</div>`;
    if (view === 'live' || view === 'finishing') { renderTranscript(); tick(true); }
  }

  function setupHtml(data) {
    const browserOk = !!SpeechRec();
    const geminiOk = liveSupported();
    if (!browserOk && !geminiOk) return `<p class="voice-note">${T('lecUnsupported')}</p>`;
    if (engine === 'gemini' && !geminiOk) engine = 'browser';
    if (engine === 'browser' && !browserOk) engine = 'gemini';
    if (target === 'open' && !data) target = 'new';
    return `
      <p class="voice-intro">${T('lecIntro')}</p>
      <div class="lec-targets" role="radiogroup" aria-label="${esc(T('lecSaveTo'))}">
        ${data ? `<button class="voice-mode${target === 'open' ? ' active' : ''}" data-lec-target="open" role="radio" aria-checked="${target === 'open'}">
          <span class="voice-mode-title">&#10133; ${T('lecToOpen')}</span><span class="voice-mode-hint">${esc(data.title)}</span></button>` : ''}
        <button class="voice-mode${target === 'new' ? ' active' : ''}" data-lec-target="new" role="radio" aria-checked="${target === 'new'}">
          <span class="voice-mode-title">&#128218; ${T('lecToNew')}</span><span class="voice-mode-hint">${T('lecToNewHint')}</span></button>
      </div>
      ${target === 'new' ? `<label class="voice-mic lec-row"><span class="voice-mic-label">${T('lecName')}</span>
        <input class="editor-select lec-name" id="lec-name" maxlength="120" value="${esc(defaultTitle())}"></label>` : ''}
      <div class="lec-opts">
        <label class="voice-mic lec-row"><span class="voice-mic-label">${T('lecLang')}</span>
          <select class="editor-select" id="lec-lang"><option value="tr"${lessonLang === 'tr' ? ' selected' : ''}>Türkçe</option><option value="en"${lessonLang === 'en' ? ' selected' : ''}>English</option></select></label>
        <label class="voice-mic lec-row"><span class="voice-mic-label">${T('lecEngine')}</span>
          <select class="editor-select" id="lec-engine">
            ${geminiOk ? `<option value="gemini"${engine === 'gemini' ? ' selected' : ''}>${esc(T('lecEngineGemini'))}</option>` : ''}
            ${browserOk ? `<option value="browser"${engine === 'browser' ? ' selected' : ''}>${esc(T('lecEngineBrowser'))}</option>` : ''}
          </select></label>
        ${engine === 'gemini' ? `<label class="voice-mic lec-row"><span class="voice-mic-label">&#127908; ${T('voiceMic')}</span>
          <select class="editor-select" id="lec-mic"><option value="">${esc(T('voiceMicDefault'))}</option>${mics.map((m, i) => `<option value="${esc(m.id)}"${m.id === micId ? ' selected' : ''}>${esc(m.label || T('voiceMicN', { n: i + 1 }))}</option>`).join('')}</select></label>` : ''}
      </div>
      <p class="voice-note">${engine === 'gemini' ? T('lecNoteGemini') : T('lecNoteBrowser')}</p>
      <button class="btn-primary voice-start" data-lec-act="start">&#9210; ${T('lecStart')}</button>
      <p class="voice-note">${T('lecNote')}</p>`;
  }

  function liveHtml() {
    const paused = lec && lec.paused;
    const finishing = view === 'finishing';
    return `
      <div class="voice-status lec-status ${finishing ? 'connecting' : paused ? 'paused' : 'live'}${lec && lec.reconnecting ? ' reconnecting' : ''}" id="lec-status">
        <span class="lec-rec" aria-hidden="true"></span>
        <span class="voice-status-text" id="lec-status-text"></span>
        <span class="voice-timer lec-elapsed" id="lec-elapsed"></span>
      </div>
      <div class="lec-counts" id="lec-counts"></div>
      <div class="lec-alerts" id="lec-alerts" aria-live="polite"></div>
      <div class="voice-transcript lec-transcript" id="lec-transcript" aria-live="off"></div>
      <p class="voice-note lec-next" id="lec-next"></p>
      <div class="voice-controls">
        ${finishing ? '' : `${paused
          ? `<button class="btn-primary" data-lec-act="resume">&#9654; ${T('voiceResume')}</button>`
          : `<button class="btn-ghost" data-lec-act="pause">&#10074;&#10074; ${T('voicePause')}</button>`}
          <button class="btn-ghost" data-lec-act="hide">${T('lecMinimize')}</button>
          <button class="btn-primary voice-end" data-lec-act="stop">&#9632; ${T('lecStop')}</button>`}
      </div>`;
  }

  function doneHtml() {
    const s = lec ? lec.stats : { sections: 0, cards: 0, alerts: 0 };
    const nothing = !lec || !lec.deckId;
    return `
      <div class="lec-summary">
        <div class="lec-summary-big">${nothing ? T('lecNothing') : T('lecSummary', { notes: s.sections, cards: s.cards, alerts: s.alerts })}</div>
        ${lec ? `<div class="lec-summary-sub">${T('lecSummaryTime', { time: LiveCore.clock(lec.activeMs) })}${lec.failed ? ' · ' + T('lecSummaryFailed', { n: lec.failed }) : ''}</div>` : ''}
        ${lec && lec.alerts.length ? `<ul class="lec-summary-alerts">${lec.alerts.map(a => `<li><span class="lec-chip exam">&#9888;&#65039;</span> ${esc(a.point)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="voice-controls">
        ${lec && lec.segments.length ? `<button class="btn-ghost" data-lec-act="copy">${T('voiceCopy')}</button>` : ''}
        ${nothing ? `<button class="btn-primary" data-lec-act="close">${T('close')}</button>` : `<button class="btn-primary" data-lec-act="review">${T('lecReview')}</button>`}
      </div>`;
  }

  function renderTranscript() {
    const box = el && el.querySelector('#lec-transcript');
    if (!box || !lec) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const segs = lec.segments.slice(-60);
    box.innerHTML = (segs.length || lec.interim ? segs.map(s => `<div class="lec-seg"><span class="lec-at">${LiveCore.clock(s.at)}</span><span>${esc(s.text)}</span></div>`).join('') +
      (lec.interim ? `<div class="lec-seg interim"><span class="lec-at"></span><span>${esc(lec.interim)}</span></div>` : '')
      : `<p class="voice-empty">${T('lecWaiting')}</p>`);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function renderAlerts() {
    const box = el && el.querySelector('#lec-alerts');
    if (!box || !lec) return;
    const chips = lec.alerts.map(a => `<span class="lec-chip exam" title="${esc(a.quote)}">&#9888;&#65039; ${esc(a.point)}</span>`)
      .concat(lec.cues.slice(-6).map(c => `<span class="lec-chip cue" title="${esc(T('lecCueHint'))}">&#128276; ${esc(c.snippet)} <small>${LiveCore.clock(c.at)}</small></span>`));
    box.innerHTML = chips.join('');
    box.style.display = chips.length ? '' : 'none';
  }

  // Once a second: clocks, counters, status, chunk scheduling, connection care.
  function tick(renderOnly) {
    if (!lec) return;
    const now = Date.now();
    if (!renderOnly && !lec.paused && view === 'live') {
      lec.activeMs += now - lec.lastTick;
      if (lec.activeMs >= MAX_MS) { App.showToast(T('lecMaxReached'), 'info'); finish(); return; }
    }
    lec.lastTick = now;
    if (!renderOnly && view === 'live') { maybeChunk(false); if (lec.engine === 'gemini') careForConnection(now); }
    updatePill();
    if (!el || el.style.display === 'none') return;
    const q = id => el.querySelector(id);
    const elapsed = q('#lec-elapsed');
    if (elapsed) elapsed.textContent = LiveCore.clock(lec.activeMs);
    const st = q('#lec-status-text');
    if (st) st.textContent = view === 'finishing' ? T('lecFinishing') : lec.paused ? T('voicePaused')
      : lec.reconnecting ? T('lecReconnecting') : lec.connecting ? T('voiceConnecting') : T('lecListening');
    const counts = q('#lec-counts');
    if (counts) counts.innerHTML = `<span><b>${lec.stats.sections}</b> ${T('lecNotes')}</span><span><b>${lec.stats.cards}</b> ${T('lecCards')}</span><span><b>${lec.stats.alerts}</b> ${T('lecAlerts')}</span>` +
      `<span class="lec-engine-badge">${lec.engine === 'gemini' ? 'Gemini' : T('lecEngineBrowserShort')}</span>`;
    const next = q('#lec-next');
    if (next) {
      const pendingChars = lec.segments.slice(lec.done).reduce((n, s) => n + s.text.length, 0);
      next.textContent = lec.busy ? T('lecProcessing')
        : view === 'finishing' ? '' : T('lecNextIn', { time: LiveCore.clock(Math.max(0, CHUNK_EVERY - (now - lec.lastChunkAt))), n: pendingChars });
    }
  }

  // ----- Floating pill while minimized -----

  function updatePill() {
    const show = isActive() && (!el || el.style.display === 'none');
    if (!show) { if (pill) pill.style.display = 'none'; return; }
    if (!pill) {
      pill = document.createElement('button');
      pill.className = 'lec-pill';
      pill.type = 'button';
      pill.addEventListener('click', open);
      document.body.appendChild(pill);
    }
    pill.style.display = '';
    pill.classList.toggle('paused', !!lec.paused);
    pill.innerHTML = `<span class="lec-rec" aria-hidden="true"></span> ${T('lecPill')} <b>${LiveCore.clock(lec.activeMs)}</b>${lec.alerts.length ? ` · &#9888;&#65039; ${lec.alerts.length}` : ''}`;
    pill.setAttribute('aria-label', T('lecPillAria', { time: LiveCore.clock(lec.activeMs) }));
  }

  // ----- Lecture lifecycle -----

  async function start() {
    if (isActive()) return;
    if (typeof Voice !== 'undefined' && Voice.isActive()) { App.showToast(T('lecBusy'), 'info'); return; }
    const data = App.getStudyData();
    const nameInput = el.querySelector('#lec-name');
    const title = (nameInput && nameInput.value.trim()) || (target === 'open' && data ? data.title : defaultTitle());
    const now = Date.now();
    lec = {
      id: 'lec' + now.toString(36),
      title, lang: lessonLang || 'tr', engine,
      target: target === 'open' && data ? 'open' : 'new',
      deckId: null,
      startedAt: now, lastTick: now, activeMs: 0, lastChunkAt: now,
      segments: [], done: 0, interim: '', cues: [], cueSeen: 0, alerts: [], known: [],
      stats: { sections: 0, cards: 0, alerts: 0 }, failed: 0, part: 0, busy: false, retryAt: 0,
      paused: false, connecting: true, reconnecting: false,
      buffer: [], conn: null, category: defaultTitle().slice(0, 60),
      sourceId: 's' + now.toString(36) + 'lec',
    };
    if (lec.target === 'open') lec.deckId = (Decks.getActive() || {}).id || null;
    if (lec.target === 'open' && !lec.deckId) lec.target = 'new';
    view = 'live';
    render();
    lec.timer = setInterval(() => tick(false), 1000);
    wakeLock();
    const l = lec;
    try {
      if (engine === 'gemini') await startGemini(l);
      else startBrowser(l);
    } catch (err) {
      if (lec !== l) return;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      if (denied) { App.showToast(T('voiceMicDenied'), 'error'); abort(); return; }
      // No Live token (not configured / offline): fall back to the browser.
      if (l.engine === 'gemini' && SpeechRec()) {
        App.showToast(T('lecFallback'), 'info');
        stopGemini(l);
        l.engine = 'browser';
        startBrowser(l);
        render();
        return;
      }
      App.showToast(T('lecFailed') + ' ' + (err && err.message || ''), 'error');
      abort();
    }
  }

  // Nothing worth keeping (failed to start): back to setup.
  function abort() {
    const l = lec;
    if (!l) return;
    clearInterval(l.timer);
    stopGemini(l);
    stopBrowser(l);
    releaseWake();
    lec = null;
    view = 'setup';
    render();
    updatePill();
  }

  function setPaused(on) {
    if (!lec || view !== 'live' || lec.paused === on) return;
    lec.paused = on;
    lec.lastTick = Date.now();
    if (lec.stream) lec.stream.getAudioTracks().forEach(t => { t.enabled = !on; });
    if (lec.engine === 'browser') { if (on) stopBrowser(lec, true); else startBrowser(lec); }
    render();
    updatePill();
  }

  // Stop listening, turn what's left into notes, show the summary.
  async function finish() {
    const l = lec;
    if (!l || view !== 'live') return;
    view = 'finishing';
    l.paused = false;
    clearInterval(l.timer);
    l.timer = setInterval(() => tick(true), 1000);
    // Give the last words a moment to arrive from the transcriber.
    if (l.engine === 'gemini' && l.conn && l.conn.live) sendTo(l.conn, { realtimeInput: { activityEnd: {} } });
    stopBrowser(l);
    if (l.stream) l.stream.getAudioTracks().forEach(t => { t.enabled = false; });
    render();
    await new Promise(r => setTimeout(r, l.engine === 'gemini' ? 1500 : 300));
    if (l.interim) { LiveCore.addFragment(l.segments, l.interim, l.activeMs); l.interim = ''; }
    stopGemini(l);
    releaseWake();
    while (lec === l && l.busy) await new Promise(r => setTimeout(r, 200));
    while (lec === l && await maybeChunk(true)) { /* drain */ }
    if (lec !== l) return;
    clearInterval(l.timer);
    // Make sure the full transcript is saved even if the last chunk failed.
    const chars = l.segments.reduce((n, x) => n + x.text.length, 0);
    if (l.deckId ? l.segments.length : chars >= 200) {
      try { l.deckId = App.mergeIntoDeck(l.deckId, { title: l.title, notes: { summary: '' }, flashcards: [], quiz: [] }, merged => decorate(l, merged)); } catch (e) {}
    }
    view = 'done';
    if (!el || el.style.display === 'none') open(); else render();
    updatePill();
  }

  function review() {
    const l = lec;
    hide();
    view = 'setup';
    if (!l || !l.deckId) return;
    if (Decks.get(l.deckId)) {
      App.openDeck(l.deckId);
      App.switchTab('flashcards');
    }
  }

  function copyTranscript() {
    if (!lec) return;
    const text = LiveCore.transcriptText(lec.segments);
    navigator.clipboard.writeText(text)
      .then(() => App.showToast(T('voiceCopied'), 'success'))
      .catch(() => App.showToast(T('failedCopy'), 'error'));
  }

  // ----- Transcript intake -----

  function onTranscript(l, text) {
    if (lec !== l || !text) return;
    l.lastTextAt = Date.now();
    LiveCore.addFragment(l.segments, text, l.activeMs);
    scanCues(l);
    renderTranscript();
  }

  // Cue phrases in the newest transcript become chips right away; the AI
  // pass later confirms (or not) what is really exam material.
  function scanCues(l) {
    const from = Math.max(0, l.cueSeen);
    const segs = l.segments;
    for (let i = from; i < segs.length; i++) {
      const s = segs[i];
      const found = LiveCore.detectCues(s.text).filter(c => c.type === 'exam' || c.type === 'important' || c.type === 'attention' || c.type === 'repeat');
      s.cueCount = s.cueCount || 0;
      found.slice(s.cueCount).forEach(c => {
        // One chip per moment: cues close together (or the same phrase said
        // again within a minute) are one alert.
        const near = l.cues.some(x => (x.seg === i && Math.abs(x.index - c.index) < 90) || (x.match === c.match && s.at - x.at < 60000));
        if (near) return;
        const a = Math.max(0, c.index - 30), b = Math.min(s.text.length, c.index + c.match.length + 40);
        l.cues.push({ type: c.type, match: c.match, at: s.at, seg: i, index: c.index, snippet: (a ? '…' : '') + s.text.slice(a, b).trim() + (b < s.text.length ? '…' : '') });
      });
      s.cueCount = Math.max(s.cueCount, found.length);
    }
    // The last segment can still grow, so it is re-scanned next time.
    l.cueSeen = Math.max(0, segs.length - 1);
    renderAlerts();
  }

  // ----- Notes from transcript chunks -----

  // Returns true when a chunk was processed (the caller may drain more).
  async function maybeChunk(final) {
    const l = lec;
    if (!l || l.busy || (!final && Date.now() < l.retryAt)) return false;
    // While listening, the last segment may still be growing: leave it.
    const segs = final ? l.segments : l.segments.slice(0, Math.max(l.done, l.segments.length - 1));
    const c = LiveCore.nextChunk(segs, l.done, { now: Date.now(), lastAt: l.lastChunkAt, final, every: CHUNK_EVERY });
    if (!c) return false;
    l.busy = true;
    tick(true);
    const transcript = LiveCore.transcriptText(l.segments, c.from, c.to);
    const cues = l.cues.filter(x => x.seg >= c.from && x.seg < c.to);
    const plain = l.segments.slice(c.from, c.to).map(s => s.text).join(' ');
    let ok = false;
    try {
      const raw = await API.chat(LiveCore.lecturePrompt({
        transcript,
        previous: c.from ? l.segments.slice(Math.max(0, c.from - 3), c.from).map(s => s.text).join(' ') : '',
        cues, repeated: LiveCore.repeatedPhrases(plain), known: l.known, lang: l.lang, part: l.part + 1,
      }), '');
      if (lec !== l) return false;
      const out = LiveCore.sanitizeChunk(Parser.safeParseJSON(raw));
      apply(l, out);
      ok = true;
    } catch (err) {
      l.failed++;
    }
    if (lec !== l) return false;
    l.busy = false;
    if (ok || final) {
      // A final chunk that fails is still covered by the stored transcript.
      l.done = c.to;
      l.part++;
      l.lastChunkAt = Date.now();
      l.cues = l.cues.filter(x => x.seg >= c.to);
    } else l.retryAt = Date.now() + 60000;
    renderAlerts();
    tick(true);
    return true;
  }

  function apply(l, out) {
    const examCat = T('lecExamCategory');
    const before = l.alerts.length;
    l.alerts.push(...out.examAlerts); // decorate() writes them into the deck
    const extra = {
      title: l.title,
      notes: { summary: '', sections: out.sections.map(s => Object.assign(s, { lecture: l.id })) },
      flashcards: out.flashcards.map(c => ({ front: c.front, back: c.back, difficulty: c.difficulty, category: c.exam ? examCat : l.category, ...(c.exam ? { exam: true } : {}) })),
      quiz: []
    };
    try {
      l.deckId = App.mergeIntoDeck(l.deckId, extra, merged => decorate(l, merged));
    } catch (err) {
      l.alerts.length = before; // not saved: the retry brings them back
      throw err;
    }
    out.flashcards.forEach(c => l.known.push(c.front));
    l.stats.sections += out.sections.length;
    l.stats.cards += out.flashcards.length;
    l.stats.alerts = l.alerts.length;
  }

  // Keep the lecture's transcript source and exam-alert section current.
  function decorate(l, merged) {
    const text = LiveCore.transcriptText(l.segments);
    merged.sources = Array.isArray(merged.sources) ? merged.sources : [];
    let src = merged.sources.find(s => s.id === l.sourceId);
    if (!src && text) {
      src = Sources.make(T('lecSourceName', { title: l.title }), 'lecture', '');
      src.id = l.sourceId;
      merged.sources.push(src);
    }
    if (src) src.text = text.slice(0, 60000);
    const sections = merged.notes.sections;
    const i = sections.findIndex(s => s.lectureAlerts === l.id);
    if (i >= 0) sections.splice(i, 1);
    if (l.alerts.length) {
      sections.push({
        title: T('lecAlertSection', { title: l.title }), content: T('lecAlertSectionIntro'),
        bulletPoints: l.alerts.map(a => a.point + (a.quote ? ` — “${a.quote}”` : '')), keyTerms: [], lectureAlerts: l.id
      });
    }
    if (l.target === 'new' && !merged.notes.summary) merged.notes.summary = T('lecDeckSummary', { title: l.title });
  }

  // ----- Engine: Gemini Live transcription -----

  async function startGemini(l) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (micId) audio.deviceId = { exact: micId };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
    catch (err) {
      if (!micId || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
      delete audio.deviceId;
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    }
    if (lec !== l) { stream.getTracks().forEach(t => t.stop()); return; }
    l.stream = stream;
    refreshMics();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    l.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule('js/worklets/voice-capture.js');
    if (lec !== l) { ctx.close().catch(() => {}); return; }
    const node = new AudioWorkletNode(ctx, 'voice-capture');
    ctx.createMediaStreamSource(stream).connect(node);
    node.port.onmessage = e => onAudio(l, e.data);
    await connect(l);
  }

  function onAudio(l, buf) {
    if (lec !== l || l.paused || view !== 'live') return;
    if (LiveCore.isVoice(new Int16Array(buf))) l.lastVoiceAt = Date.now();
    const msg = { realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: toBase64(buf) } } };
    if (l.conn && l.conn.live && !l.flushing) sendTo(l.conn, msg);
    else {
      // Between connections: keep the audio and send it once one is up.
      l.buffer.push(msg);
      if (l.buffer.length > BUFFER_MAX) l.buffer.shift();
    }
  }

  // Open a connection with a fresh token. The current one keeps running
  // until the new one is ready, so nothing is missed at the switch.
  async function connect(l) {
    if (l.connectingNow) return;
    l.connectingNow = true;
    try {
      const { token, model, maxMinutes } = await API.liveToken('lecture', l.title, '');
      if (lec !== l || view !== 'live') return;
      const conn = await openConn(l, token, model, maxMinutes);
      if (lec !== l || view !== 'live') { closeConn(conn); return; }
      // Switch over: the old connection gets a moment to deliver its last words.
      const old = l.conn;
      l.conn = conn;
      sendTo(conn, { realtimeInput: { activityStart: {} } });
      const queued = l.buffer.splice(0);
      queued.forEach(m => sendTo(conn, m));
      l.lastTextAt = Date.now();
      if (old) {
        if (old.live) sendTo(old, { realtimeInput: { activityEnd: {} } });
        l.retiring = (l.retiring || []).concat(old);
        setTimeout(() => { closeConn(old); l.retiring = l.retiring.filter(c => c !== old); }, 4000);
      }
      l.connecting = false;
      l.reconnecting = false;
      l.retries = 0;
      tick(true);
      if (el && el.style.display !== 'none') { const st = el.querySelector('#lec-status'); if (st) st.classList.remove('reconnecting'); }
    } finally {
      l.connectingNow = false;
    }
  }

  // Resolves with the connection once Gemini has accepted the setup.
  function openConn(l, token, model, maxMinutes) {
    const ws = new WebSocket(WS_URL + '?access_token=' + encodeURIComponent(token));
    const conn = { ws, live: false, endsAt: Date.now() + (maxMinutes || 15) * 60000, openedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const fail = err => { if (!conn.live) { closeConn(conn); reject(err); } };
      const timer = setTimeout(() => fail(new Error('connection timed out')), 15000);
      ws.onopen = () => sendTo(conn, { setup: { model: 'models/' + model } });
      ws.onerror = () => fail(new Error('connection failed'));
      ws.onclose = e => {
        if (!conn.live) { fail(new Error((e && e.reason) || 'connection closed')); return; }
        conn.live = false;
        if (lec === l && l.conn === conn) { l.conn = null; reconnectSoon(l); }
      };
      ws.onmessage = async e => {
        let msg;
        try { msg = JSON.parse(typeof e.data === 'string' ? e.data : await new Response(e.data).text()); } catch (err) { return; }
        if (msg.setupComplete && !conn.live) {
          clearTimeout(timer);
          conn.live = true;
          resolve(conn);
          return;
        }
        if (msg.goAway && lec === l && l.conn === conn) renew(l);
        const sc = msg.serverContent;
        if (sc && sc.inputTranscription && sc.inputTranscription.text) onTranscript(l, sc.inputTranscription.text);
        // Anything the model says is ignored: this session only transcribes.
      };
    });
  }

  function closeConn(conn) {
    if (!conn || !conn.ws) return;
    conn.live = false;
    conn.ws.onclose = null;
    conn.ws.onmessage = null;
    conn.ws.onerror = null;
    if (conn.ws.readyState <= 1) conn.ws.close(1000, 'done');
  }

  // Ahead of the session limit (or on the server's goAway): hand over to a
  // new connection. On failure the current one keeps going and a retry
  // follows shortly; if it closes first, reconnectSoon takes over.
  function renew(l) {
    if (l.connectingNow || l.renewing || Date.now() < (l.renewAfter || 0)) return;
    l.renewing = true;
    connect(l).catch(() => { l.renewAfter = Date.now() + 20000; }).finally(() => { l.renewing = false; });
  }

  // The connection dropped: retry with backoff while audio is buffered.
  function reconnectSoon(l) {
    if (lec !== l || view !== 'live' || l.retryTimer) return;
    l.reconnecting = true;
    l.retries = (l.retries || 0) + 1;
    tick(true);
    const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(5, l.retries - 1)));
    l.retryTimer = setTimeout(() => {
      l.retryTimer = null;
      if (lec !== l || view !== 'live' || (l.conn && l.conn.live)) return;
      connect(l).catch(() => {
        // After repeated failures, keep going on the browser's recognizer.
        if (l.retries >= 4 && SpeechRec() && lec === l) {
          App.showToast(T('lecFallback'), 'info');
          stopGemini(l);
          l.engine = 'browser';
          l.reconnecting = false;
          startBrowser(l);
          render();
        } else reconnectSoon(l);
      });
    }, wait);
  }

  function careForConnection(now) {
    const l = lec;
    const c = l.conn;
    if (!c || !c.live || l.paused) return;
    // Renew ahead of the session limit.
    if (now >= c.endsAt - RENEW_BEFORE) { renew(l); return; }
    // Transcription normally streams; if it stalls while someone is talking,
    // close the activity so the transcriber flushes, then open a new one.
    if (l.lastVoiceAt && now - l.lastVoiceAt < 3000 && now - (l.lastTextAt || c.openedAt) > FLUSH_AFTER) {
      l.lastTextAt = now;
      sendTo(c, { realtimeInput: { activityEnd: {} } });
      sendTo(c, { realtimeInput: { activityStart: {} } });
    }
  }

  function sendTo(conn, obj) {
    if (conn && conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(obj));
  }

  function stopGemini(l) {
    clearTimeout(l.retryTimer);
    l.retryTimer = null;
    closeConn(l.conn);
    (l.retiring || []).forEach(closeConn);
    l.conn = null;
    l.retiring = [];
    l.buffer = [];
    if (l.stream) l.stream.getTracks().forEach(t => t.stop());
    l.stream = null;
    if (l.ctx && l.ctx.state !== 'closed') l.ctx.close().catch(() => {});
    l.ctx = null;
  }

  // ----- Engine: browser speech recognition (fallback) -----

  function startBrowser(l) {
    const Rec = SpeechRec();
    if (!Rec) throw new Error('no speech recognition');
    const rec = new Rec();
    rec.lang = l.lang === 'tr' ? 'tr-TR' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onTranscript(l, ' ' + r[0].transcript);
        else interim += r[0].transcript;
      }
      if (lec === l) { l.interim = interim.trim(); renderTranscript(); }
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        l.recDenied = true;
        App.showToast(T('voiceMicDenied'), 'error');
      }
    };
    // Chrome ends recognition after silence or a network hiccup: restart.
    rec.onend = () => {
      if (lec !== l || l.rec !== rec) return;
      if (l.recDenied) { if (!l.segments.length) abort(); else finish(); return; }
      if (view === 'live' && !l.paused) setTimeout(() => { if (lec === l && l.rec === rec && view === 'live' && !l.paused) { try { rec.start(); } catch (err) {} } }, 250);
    };
    l.rec = rec;
    l.connecting = false;
    rec.start();
  }

  function stopBrowser(l, keep) {
    const rec = l.rec;
    if (!rec) return;
    if (!keep) l.rec = null;
    try { rec.stop(); } catch (e) {}
    if (keep) l.rec = null;
  }

  // ----- Misc -----

  async function refreshMics() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      mics = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(d => ({ id: d.deviceId, label: d.label }));
    } catch (e) { mics = []; }
  }

  // Keep the phone's screen on (and the mic alive) during the lesson.
  async function wakeLock() {
    if (!lec || !navigator.wakeLock || lec.wake) return;
    try {
      const l = lec;
      const w = await navigator.wakeLock.request('screen');
      if (lec !== l || !isActive()) { w.release().catch(() => {}); return; }
      l.wake = w;
      w.addEventListener('release', () => { if (l.wake === w) l.wake = null; });
    } catch (e) {}
  }
  function releaseWake() {
    if (lec && lec.wake) { lec.wake.release().catch(() => {}); lec.wake = null; }
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function init() {
    // Home: a "record a lecture" entry right above the input card.
    const card = document.querySelector('#input-view .input-card');
    if (card && !document.getElementById('lecture-open-btn')) {
      const row = document.createElement('div');
      row.className = 'lec-entry';
      row.innerHTML = `<button id="lecture-open-btn" type="button" class="lec-open-btn"><span class="lec-rec" aria-hidden="true"></span>
        <span class="lec-entry-text"><b>${esc(T('lecOpen'))}</b><small>${esc(T('lecEntryHint'))}</small></span><span aria-hidden="true">&#8250;</span></button>`;
      row.firstChild.addEventListener('click', open);
      card.parentNode.insertBefore(row, card);
    }
    refreshMics();
  }

  return { init, open, hide, finish, isActive };
})();
