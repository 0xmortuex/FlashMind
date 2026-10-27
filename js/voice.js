// ===== Voice Tutor (Gemini Live) =====
// Talk to a tutor out loud about the open study set. The worker mints a
// single-use Gemini Live token that is already locked to the tutor setup
// (mode, language, and this set's material), so the browser connects to
// Gemini directly without ever holding the API key. Microphone audio goes up
// as 16 kHz PCM; the tutor's 24 kHz PCM audio plays back gaplessly; both
// sides are transcribed live into the panel.
const Voice = (() => {
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  let el = null, releaseTrap = null;
  let mode = 'quiz';
  let session = null; // { ws, capture, playback, stream, timer, endsAt, muted, lines, current }
  let state = 'idle';  // idle | connecting | live | ended
  let micId = '';      // chosen microphone (deviceId); '' = system default
  let mics = [];       // [{ id, label }]
  let camChoice = 'environment'; // 'environment' | 'user' | a camera deviceId
  let cams = [];       // [{ id, label }]
  try { micId = localStorage.getItem('flashmind_voice_mic') || ''; } catch (e) {}
  try { camChoice = localStorage.getItem('flashmind_voice_cam') || 'environment'; } catch (e) {}

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function supported() {
    return typeof WebSocket !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      typeof AudioWorkletNode !== 'undefined';
  }

  // ----- Panel -----

  function open(m) {
    if (!App.getStudyData()) return;
    if (!el) build();
    if (['quiz', 'explain', 'talk'].includes(m) && state !== 'live' && state !== 'connecting') mode = m;
    if (state !== 'live' && state !== 'connecting') { state = 'idle'; }
    render();
    el.style.display = 'flex';
    releaseTrap = FX.trapFocus(el);
    refreshMics();
    refreshCams();
  }

  function close() {
    stop();
    if (!el) return;
    el.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function build() {
    el = document.createElement('div');
    el.className = 'shortcuts-backdrop';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target === el) { close(); return; }
      const m = e.target.closest('[data-voice-mode]');
      if (m && state !== 'live' && state !== 'connecting') { mode = m.dataset.voiceMode; render(); return; }
      const b = e.target.closest('[data-voice-act]');
      if (!b) return;
      const act = b.dataset.voiceAct;
      if (act === 'start') start();
      else if (act === 'stop') stop();
      else if (act === 'mute') toggleMute();
      else if (act === 'pause') pause();
      else if (act === 'resume') resume();
      else if (act === 'continue') start(lastLines);
      else if (act === 'close') close();
      else if (act === 'copy') copyTranscript();
      else if (act === 'again') { state = 'idle'; render(); }
      else if (act === 'camera') toggleCamera();
      else if (act === 'flip') flipCamera();
      else if (act === 'lecture' && typeof Lecture !== 'undefined') { close(); Lecture.open(); }
    });
    el.addEventListener('change', e => {
      if (e.target.id === 'voice-cam-select') {
        camChoice = e.target.value;
        try { localStorage.setItem('flashmind_voice_cam', camChoice); } catch (err) {}
        return;
      }
      if (e.target.id !== 'voice-mic-select') return;
      micId = e.target.value;
      try { localStorage.setItem('flashmind_voice_mic', micId); } catch (err) {}
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.style.display !== 'none') close(); });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshMics);
      navigator.mediaDevices.addEventListener('devicechange', refreshCams);
    }
  }

  function render() {
    const T = i18n.t;
    const modeBtn = (key, icon) => `<button class="voice-mode${mode === key ? ' active' : ''}" data-voice-mode="${key}" aria-pressed="${mode === key}">
      <span class="voice-mode-icon">${icon}</span><span class="voice-mode-title">${T('voiceMode_' + key)}</span><span class="voice-mode-hint">${T('voiceModeHint_' + key)}</span></button>`;
    const live = state === 'live' || state === 'connecting';
    const paused = !!(session && session.paused);
    el.innerHTML = `<div class="shortcuts-card voice-panel" role="dialog" aria-modal="true" aria-labelledby="voice-title">
      <div class="voice-head">
        <h3 id="voice-title">&#127897;&#65039; ${T('voiceTitle')}</h3>
        <button class="btn-icon" data-voice-act="close" aria-label="${esc(T('close'))}">&times;</button>
      </div>
      ${state === 'idle' ? `
        <p class="voice-intro">${T('voiceIntro')}</p>
        ${supported() ? `<div class="voice-modes voice-modes-4">${modeBtn('quiz', '&#10067;')}${modeBtn('explain', '&#127891;')}${modeBtn('talk', '&#128172;')}${modeBtn('solve', '&#128247;')}</div>
          <label class="voice-mic">
            <span class="voice-mic-label">&#127908; ${T('voiceMic')}</span>
            <select class="editor-select" id="voice-mic-select">${micOptions()}</select>
          </label>
          ${mode === 'solve' && typeof Camera !== 'undefined' && Camera.supported() ? `<label class="voice-mic">
            <span class="voice-mic-label">&#128247; ${T('voiceCam')}</span>
            <select class="editor-select" id="voice-cam-select">${camOptions()}</select>
          </label>
          <p class="voice-note">${T('voiceSolveNote')}</p>` : ''}
          <button class="btn-primary voice-start" data-voice-act="start">&#127908; ${T('voiceStart')}</button>
          <p class="voice-note">${T('voiceNote')}</p>
          ${typeof Lecture !== 'undefined' ? `<button class="voice-lecture-link" data-voice-act="lecture">&#127979; ${T('lecFromVoice')}</button>` : ''}`
        : `<p class="voice-note">${T('voiceUnsupported')}</p>`}` : `
        <div class="voice-status ${state}${paused ? ' paused' : ''}" id="voice-status">
          <span class="voice-orb" aria-hidden="true"><span></span></span>
          <span class="voice-status-text" id="voice-status-text">${state === 'connecting' ? T('voiceConnecting') : state === 'ended' ? T('voiceEnded') : paused ? T('voicePaused') : T('voiceListening')}</span>
          ${live ? `<span class="voice-timer" id="voice-timer"></span>` : ''}
        </div>
        ${live && session && session.solve ? `<div class="voice-cam" id="voice-cam-slot">
            ${session.camera ? `<span class="voice-cam-info" id="voice-cam-info">${camInfo()}</span>` : `<span class="voice-cam-off">${session.camPending ? T('voiceCamStarting') : T('voiceCamOff')}</span>`}
            <div class="voice-cam-tools">
              <button class="btn-ghost" data-voice-act="camera" aria-pressed="${!!session.camera}">${session.camera ? '&#128683; ' + T('voiceCamTurnOff') : '&#128247; ' + T('voiceCamTurnOn')}</button>
              ${session.camera && cams.length > 1 ? `<button class="btn-ghost" data-voice-act="flip" aria-label="${esc(T('voiceCamFlip'))}">&#128260;</button>` : ''}
            </div>
          </div>` : ''}
        <div class="voice-transcript" id="voice-transcript" aria-live="polite">${transcriptHtml()}</div>
        <div class="voice-controls">
          ${live ? `${state === 'live' ? (paused
              ? `<button class="btn-primary" data-voice-act="resume">&#9654; ${T('voiceResume')}</button>`
              : `<button class="btn-ghost" data-voice-act="pause">&#10074;&#10074; ${T('voicePause')}</button>`) : ''}
            <button class="btn-ghost" data-voice-act="mute" id="voice-mute"${paused ? ' disabled' : ''}>${session && session.muted ? '&#127908; ' + T('voiceUnmute') : '&#128263; ' + T('voiceMute')}</button>
            <button class="btn-primary voice-end" data-voice-act="stop">${T('voiceEnd')}</button>`
          : `<button class="btn-ghost" data-voice-act="copy">${T('voiceCopy')}</button>
            ${lastLines.length ? `<button class="btn-primary" data-voice-act="continue">&#9654; ${T('voiceContinue')}</button>` : ''}
            <button class="${lastLines.length ? 'btn-ghost' : 'btn-primary'}" data-voice-act="again">${T('voiceAgain')}</button>`}
        </div>
        ${paused ? `<p class="voice-note">${T('voicePausedNote')}</p>` : ''}${state === 'ended' && lastLines.length ? `<p class="voice-note">${T('voiceContinueNote')}</p>` : ''}
        </div>`}
    </div>`;
    // The preview element survives re-renders: move it into the new slot.
    const slot = el.querySelector('#voice-cam-slot');
    if (slot && session && session.camera) slot.insertBefore(session.camera.video, slot.firstChild);
    updateTimer();
  }

  function camInfo() {
    return session && session.frames ? i18n.t('voiceCamSent', { n: session.frames }) : i18n.t('voiceCamReady');
  }

  function camOptions() {
    const T = i18n.t;
    let html = `<option value="environment"${camChoice === 'environment' ? ' selected' : ''}>${esc(T('voiceCamBack'))}</option>` +
      `<option value="user"${camChoice === 'user' ? ' selected' : ''}>${esc(T('voiceCamFront'))}</option>`;
    cams.forEach((c, i) => {
      html += `<option value="${esc(c.id)}"${c.id === camChoice ? ' selected' : ''}>${esc(c.label || T('voiceCamN', { n: i + 1 }))}</option>`;
    });
    return html;
  }

  async function refreshCams() {
    if (typeof Camera === 'undefined') return;
    cams = (await Camera.list()).filter(c => c.label); // unlabeled = no permission yet; facing options cover that
    if (camChoice !== 'environment' && camChoice !== 'user' && !cams.some(c => c.id === camChoice)) camChoice = 'environment';
    const sel = el && el.querySelector('#voice-cam-select');
    if (sel) sel.innerHTML = camOptions();
  }

  function micOptions() {
    const T = i18n.t;
    let html = `<option value="">${esc(T('voiceMicDefault'))}</option>`;
    mics.forEach((m, i) => {
      html += `<option value="${esc(m.id)}"${m.id === micId ? ' selected' : ''}>${esc(m.label || T('voiceMicN', { n: i + 1 }))}</option>`;
    });
    return html;
  }

  // Device labels are only exposed after microphone permission is granted,
  // so the list is refreshed after each session starts and on device changes.
  async function refreshMics() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      mics = devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(d => ({ id: d.deviceId, label: d.label }));
    } catch (e) { mics = []; }
    if (micId && !mics.some(m => m.id === micId)) micId = '';
    const sel = el && el.querySelector('#voice-mic-select');
    if (sel) sel.innerHTML = micOptions();
  }

  function transcriptHtml() {
    const lines = session ? session.lines : lastLines;
    if (!lines.length) return `<p class="voice-empty">${i18n.t('voiceTranscriptEmpty')}</p>`;
    return lines.map(l => `<div class="voice-line ${l.who}"><span class="voice-who">${l.who === 'tutor' ? i18n.t('voiceTutor') : i18n.t('voiceYou')}</span><span class="voice-said">${esc(l.text)}</span></div>`).join('');
  }

  let lastLines = [];

  // Live transcription arrives in fragments; consecutive fragments from the
  // same speaker extend one line.
  function addTranscript(who, text) {
    if (!session || !text) return;
    const last = session.lines[session.lines.length - 1];
    if (last && last.who === who && !last.done) last.text += text;
    else session.lines.push({ who, text: text.replace(/^\s+/, ''), done: false });
    const box = el && el.querySelector('#voice-transcript');
    if (box) { box.innerHTML = transcriptHtml(); box.scrollTop = box.scrollHeight; }
  }

  function setStatus(key) {
    const s = el && el.querySelector('#voice-status-text');
    if (s) s.textContent = i18n.t(key);
    const wrap = el && el.querySelector('#voice-status');
    if (wrap) wrap.classList.toggle('speaking', key === 'voiceSpeaking');
  }

  function updateTimer() {
    const t = el && el.querySelector('#voice-timer');
    if (!t || !session || !session.endsAt) return;
    const left = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
    t.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }

  // ----- Session -----

  // `carry` (the transcript of an ended session) continues that
  // conversation on a fresh connection instead of starting over.
  async function start(carry) {
    const data = App.getStudyData();
    if (!data || state === 'connecting' || state === 'live') return;
    if (typeof Lecture !== 'undefined' && Lecture.isActive()) { App.showToast(i18n.t('lecBusy'), 'info'); return; }
    if (typeof TTS !== 'undefined') TTS.stop();
    if (typeof AudioOverview !== 'undefined') AudioOverview.stop();
    const previous = Array.isArray(carry) ? carry.map(l => Object.assign({}, l, { done: true })) : [];
    const s = session = { lines: previous.slice(), carried: previous, muted: false, paused: false, solve: mode === 'solve' && typeof Camera !== 'undefined' && Camera.supported() };
    state = 'connecting';
    render();
    // The panel can be closed while any of these awaits is pending: release
    // what arrived late instead of attaching it to a session that's gone.
    const stale = () => session !== s;
    try {
      // Audio contexts must be created inside the click that started this.
      const playback = await startPlayback();
      if (stale()) { playback.ctx.close().catch(() => {}); return; }
      s.playback = playback;
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (micId) audio.deviceId = { exact: micId };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (err) {
        // The saved microphone was unplugged: fall back to the default one.
        if (!micId || err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError') throw err;
        delete audio.deviceId;
        micId = '';
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
      if (stale()) { stream.getTracks().forEach(t => t.stop()); return; }
      s.stream = stream;
      refreshMics(); // labels become available once permission is granted
      // The camera runs alongside the token request; a refusal leaves the
      // session voice-only (the student can read steps out loud).
      if (s.solve) startCamera(s);
      const { token, model, maxMinutes } = await API.liveToken(mode, data.title, App.getOriginalText());
      if (stale()) return;
      s.endsAt = Date.now() + (maxMinutes || 15) * 60 * 1000;
      connect(token, model);
    } catch (err) {
      if (stale()) return;
      const T = i18n.t;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      App.showToast(denied ? T('voiceMicDenied') : T('voiceFailed') + ' ' + (err && err.message || ''), 'error');
      teardown('idle');
    }
  }

  async function startPlayback() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule('js/worklets/voice-playback.js');
    const node = new AudioWorkletNode(ctx, 'voice-playback');
    node.connect(ctx.destination);
    node.port.onmessage = e => { if (state === 'live') setStatus(e.data === 'playing' ? 'voiceSpeaking' : 'voiceListening'); };
    return { ctx, node };
  }

  async function startCapture() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule('js/worklets/voice-capture.js');
    const node = new AudioWorkletNode(ctx, 'voice-capture');
    const source = ctx.createMediaStreamSource(session.stream);
    source.connect(node);
    node.port.onmessage = e => {
      if (!session || session.muted || session.paused || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;
      if (session.solve && LiveCore.isVoice(new Int16Array(e.data))) {
        const now = Date.now();
        if (!session.voiceAt || now - session.voiceAt > 1500) session.speechStartAt = now;
        session.voiceAt = now;
      }
      send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: toBase64(e.data) } } });
    };
    return { ctx, node, source };
  }

  function connect(token, model) {
    const ws = new WebSocket(WS_URL + '?access_token=' + encodeURIComponent(token));
    session.ws = ws;
    ws.onopen = () => {
      // The token already locks this configuration; the setup message only
      // has to name the model.
      send({ setup: { model: 'models/' + model } });
    };
    ws.onmessage = e => handleMessage(e.data);
    ws.onerror = () => { if (state === 'connecting') App.showToast(i18n.t('voiceFailed'), 'error'); };
    ws.onclose = e => {
      if (state === 'connecting' && e.reason) App.showToast(i18n.t('voiceFailed') + ' ' + e.reason, 'error');
      if (session && session.ws === ws) teardown('ended');
    };
  }

  async function handleMessage(raw) {
    if (!session) return;
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : await new Response(raw).text()); }
    catch (e) { return; }
    if (msg.setupComplete) {
      state = 'live';
      session.capture = await startCapture().catch(err => {
        App.showToast(i18n.t('voiceFailed') + ' ' + err.message, 'error');
        teardown('ended');
        return null;
      });
      if (!session) return;
      session.timer = setInterval(() => {
        updateTimer();
        if (session && Date.now() >= session.endsAt) { App.showToast(i18n.t('voiceTimeUp'), 'info'); stop(); }
      }, 1000);
      if (session.solve) session.frameTimer = setInterval(frameTick, 500);
      render();
      // Let the tutor open the conversation, or pick up a continued one.
      send({ clientContent: { turns: [{ role: 'user', parts: [{ text: kickoff(session.carried) }] }], turnComplete: true } });
      return;
    }
    if (msg.goAway) { App.showToast(i18n.t('voiceTimeUp'), 'info'); return; }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted && session.playback) session.playback.node.port.postMessage('clear');
    ((sc.modelTurn && sc.modelTurn.parts) || []).forEach(p => {
      if (p.inlineData && p.inlineData.data && session.playback) session.playback.node.port.postMessage(pcm16ToFloat(p.inlineData.data));
    });
    if (sc.inputTranscription && sc.inputTranscription.text) addTranscript('you', sc.inputTranscription.text);
    if (sc.outputTranscription && sc.outputTranscription.text) addTranscript('tutor', sc.outputTranscription.text);
    if (sc.turnComplete || sc.generationComplete) {
      const last = session.lines[session.lines.length - 1];
      if (last) last.done = true;
    }
  }

  function send(obj) {
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(obj));
  }

  function applyMic() {
    if (session && session.stream) session.stream.getAudioTracks().forEach(t => { t.enabled = !session.muted && !session.paused; });
    if (session && session.camera) session.camera.setEnabled(!session.paused);
  }

  function toggleMute() {
    if (!session) return;
    session.muted = !session.muted;
    applyMic();
    render();
  }

  // Pause freezes the tutor mid-sentence (its audio stays queued) and stops
  // sending the microphone; the connection stays open, so Continue carries on
  // from the same point. Gemini still closes the connection when the
  // session's time runs out — then Continue reconnects with the transcript.
  function pause() {
    if (!session || state !== 'live' || session.paused) return;
    session.paused = true;
    applyMic();
    if (session.playback) session.playback.ctx.suspend().catch(() => {});
    render();
  }

  function resume() {
    if (!session || !session.paused) return;
    session.paused = false;
    applyMic();
    render();
    if (session.playback) {
      session.playback.ctx.resume().catch(() => {});
      session.playback.node.port.postMessage('status'); // re-sync "speaking" / "listening"
    }
  }

  // First message of a session. A continued session gets the earlier
  // transcript (most recent part, bounded) so the tutor resumes, not restarts.
  function kickoff(previous) {
    if (!previous || !previous.length) return 'Start the session now.';
    let transcript = previous.map(l => `${l.who === 'tutor' ? 'Tutor' : 'Student'}: ${l.text.trim()}`).join('\n');
    if (transcript.length > 6000) transcript = '…' + transcript.slice(-6000);
    return 'We are continuing a session that was paused and reconnected. Do not greet again or restart; ' +
      'briefly say you are picking up where you left off, then continue from the last point.\n\nTranscript so far:\n' + transcript;
  }

  function stop() {
    if (session) teardown('ended');
  }

  // Release everything (socket, mic, audio graphs, timer) and show `next`.
  function teardown(next) {
    const s = session;
    session = null;
    if (s) {
      lastLines = s.lines;
      clearInterval(s.timer);
      clearInterval(s.frameTimer);
      if (s.camera) s.camera.stop();
      s.camera = null;
      if (s.stream) s.stream.getTracks().forEach(t => t.stop());
      [s.capture, s.playback].forEach(a => { if (a && a.ctx && a.ctx.state !== 'closed') a.ctx.close().catch(() => {}); });
      if (s.ws) {
        s.ws.onclose = null;
        s.ws.onmessage = null;
        if (s.ws.readyState <= 1) s.ws.close(1000, 'done');
      }
    }
    state = next === 'idle' ? 'idle' : 'ended';
    if (el && el.style.display !== 'none') render();
  }

  // ----- Camera ("show your work") -----

  async function startCamera(s, choice) {
    s.camPending = true;
    if (el && el.style.display !== 'none' && session === s) render();
    try {
      const cam = await Camera.open(choice || camChoice);
      if (session !== s) { cam.stop(); return; } // the session ended meanwhile
      s.camera = cam;
      s.lastFrame = 0;
      s.lastThumb = null;
      cam.setEnabled(!s.paused);
      refreshCams();
    } catch (err) {
      if (session !== s) return;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      App.showToast(denied ? i18n.t('voiceCamDenied') : i18n.t('voiceCamFailed') + ' ' + (err && err.message || ''), 'error');
    }
    s.camPending = false;
    if (session === s && el && el.style.display !== 'none') render();
  }

  function stopCamera() {
    if (!session || !session.camera) return;
    session.camera.stop();
    session.camera = null;
    render();
  }

  function toggleCamera() {
    if (!session || !session.solve || session.camPending) return;
    if (session.camera) stopCamera();
    else startCamera(session);
  }

  // Switch between the phone's back and front camera (or the next camera).
  function flipCamera() {
    if (!session || !session.camera || session.camPending) return;
    const s = session;
    let next;
    if (cams.length > 2) {
      const cur = s.camera.stream.getVideoTracks()[0];
      const curId = cur && cur.getSettings ? cur.getSettings().deviceId : '';
      const i = cams.findIndex(c => c.id === curId);
      next = cams[(i + 1) % cams.length].id;
    } else next = s.camera.facing === 'user' ? 'environment' : 'user';
    s.camera.stop();
    s.camera = null;
    camChoice = next;
    try { localStorage.setItem('flashmind_voice_cam', camChoice); } catch (e) {}
    startCamera(s, next);
  }

  // Twice a second: decide whether the current camera frame is worth sending.
  let frameBusy = false;
  async function frameTick() {
    const s = session;
    if (!s || !s.camera || s.paused || state !== 'live' || frameBusy || !s.ws || s.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const thumb = s.camera.sample();
    if (!thumb) return;
    const changed = LiveCore.frameDiff(thumb, s.lastThumb) >= LiveCore.CHANGE_THRESHOLD;
    const speaking = !!s.voiceAt && now - s.voiceAt < 1200;
    const speechStarted = !!s.speechStartAt && s.speechStartAt > s.lastFrame;
    if (!LiveCore.shouldSendFrame({ now, lastSent: s.lastFrame, changed, speaking, speechStarted })) return;
    frameBusy = true;
    try {
      const data = await s.camera.jpeg(0.7);
      if (!data || session !== s || s.paused || !s.camera) return;
      send({ realtimeInput: { video: { mimeType: 'image/jpeg', data } } });
      s.lastFrame = now;
      s.lastThumb = thumb;
      s.frames = (s.frames || 0) + 1;
      const info = el && el.querySelector('#voice-cam-info');
      if (info) info.textContent = camInfo();
      const v = s.camera.video;
      v.classList.remove('snap'); void v.offsetWidth; v.classList.add('snap');
    } finally { frameBusy = false; }
  }

  function copyTranscript() {
    const T = i18n.t;
    const text = lastLines.map(l => `${l.who === 'tutor' ? T('voiceTutor') : T('voiceYou')}: ${l.text.trim()}`).join('\n');
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => App.showToast(T('voiceCopied'), 'success'))
      .catch(() => App.showToast(T('failedCopy'), 'error'));
  }

  // ----- PCM helpers -----

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function pcm16ToFloat(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
    return out;
  }

  function init() {
    const btn = document.getElementById('voice-open-btn');
    if (!btn) return;
    btn.querySelector('.btn-label').textContent = i18n.t('voiceOpen');
    btn.addEventListener('click', open);
  }

  return { init, open, close, start, stop, supported, isActive: () => state === 'live' || state === 'connecting' };
})();
