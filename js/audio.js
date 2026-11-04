// ===== Audio Overview =====
// A podcast-style recap of the study set to listen to on the go. The AI
// writes a script (two hosts in conversation, or one host for the brief
// format); playback uses the browser's own speech synthesis with a different
// voice (or pitch) per host. "Quick recap" reads the notes with no AI call.
// The script is saved on the set (data.audio) so it can be replayed offline.
const AudioOverview = (() => {
  const RATES = [0.8, 1, 1.25, 1.5];
  let host = null;
  let forData = null;
  let format = 'deep';
  let busy = false;
  let playing = false;
  let index = 0;
  let token = 0;
  let rate = 1;
  // One-on-one deep dive: { at, ask, text, busy, listening, err } while it is the student's turn to speak.
  let turn = null;
  let rec = null; // the running speech recognition
  try { rate = parseFloat(localStorage.getItem('flashmind_audio_rate')) || 1; } catch (e) {}

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // Offline recap built from the notes.
  function recapScript(data) {
    const T = i18n.t;
    const n = data.notes || {};
    const lines = [{ speaker: 'A', text: T('audioRecapIntro', { title: data.title }) }];
    if (n.summary) lines.push({ speaker: 'A', text: n.summary });
    (n.sections || []).forEach(s => {
      lines.push({ speaker: 'A', text: [s.title, s.content].filter(Boolean).join('. ') });
      (s.keyTerms || []).forEach(k => lines.push({ speaker: 'A', text: `${k.term}: ${k.definition}` }));
    });
    if ((n.commonMistakes || []).length) lines.push({ speaker: 'A', text: T('commonMistakes') + '. ' + n.commonMistakes.join('. ') });
    lines.push({ speaker: 'A', text: T('audioRecapOutro') });
    return { format: 'recap', title: data.title, lines, createdAt: Date.now() };
  }

  function prompt(fmt, focus) {
    const base = fmt === 'brief'
      ? 'Write a short single-host audio briefing (like a teacher recording a 2-minute revision note) of this study material for a student revising for an exam. ' +
        'About 280 words in 6-10 short paragraphs, all with "speaker":"A". Open with what the topic is, cover only the must-know ideas, end with the 3 key takeaways.'
      : 'Write a one-on-one spoken revision conversation between a host and the student who is listening, face to face, about this study material, for a student revising for an exam. ' +
        'Every line is the host ("speaker":"A") talking directly to the student ("you", in Turkish "sen"), warm and natural like a good tutor sitting across the table. ' +
        'The host explains the most important ideas with concrete examples, one memorable analogy and a common mistake to avoid, and ends with the 3 key takeaways. ' +
        'Every 3-4 lines the host asks the student a short question and waits for the answer: mark that line "ask": true and end it with the question ' +
        '(check understanding, ask them to predict, or to explain something back in their own words). The line after a question must work whatever the student said: ' +
        'do not assume their answer; give the right answer and the reason ("Let\'s check: ..."). ' +
        'About 650 words in 16-26 lines, 5-7 of them questions.';
    return base + ' ' + Material.SUBJECT_RULE + 'Spoken style only: no markdown, no lists, no stage directions, no emojis; say formulas and symbols in words. ' +
      'Write it in the language of the material. ' +
      (focus ? `Focus especially on: ${focus}. ` : '') +
      'Return ONLY JSON, no other text: ' + (fmt === 'brief'
        ? '{"type":"audio","title":"episode title","lines":[{"speaker":"A","text":"..."}]}'
        : '{"type":"audio","title":"episode title","lines":[{"speaker":"A","text":"..."},{"speaker":"A","text":"... ?","ask":true}]}');
  }

  // ----- Rendering -----

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    if (forData !== data) { stop(); forData = data; index = 0; }
    const T = i18n.t;
    const script = data.audio;
    if (!script || busy) { host.innerHTML = setupHtml(); return; }
    const total = script.lines.length;
    const ttsOk = typeof TTS !== 'undefined' && TTS.supported();
    host.innerHTML = `<div class="audio-wrap">
      <div class="audio-player${playing ? ' playing' : ''}">
        <div class="audio-cover" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="audio-meta">
          <span class="audio-kind">${T(script.format === 'brief' ? 'audioBrief' : script.format === 'recap' ? 'audioRecap' : 'audioDeep')}</span>
          <h3 class="audio-title">${esc(script.title || data.title)}</h3>
          <div class="audio-progress"><span style="width:${total ? (Math.min(index, total) / total) * 100 : 0}%"></span></div>
          <span class="audio-count">${T('audioLine', { i: Math.min(index + 1, total), n: total })}</span>
        </div>
        ${ttsOk ? `<div class="audio-controls">
          <button class="btn-icon" data-audio-act="prev" aria-label="${T('audioPrev')}" title="${T('audioPrev')}">&#9198;</button>
          <button class="audio-play" data-audio-act="${playing ? 'pause' : 'play'}" aria-label="${playing ? T('audioPause') : T('audioPlay')}">${playing ? '&#10074;&#10074;' : '&#9654;'}</button>
          <button class="btn-icon" data-audio-act="next" aria-label="${T('audioNext')}" title="${T('audioNext')}">&#9197;</button>
          <button class="btn-ghost audio-rate" data-audio-act="rate" title="${T('audioSpeed')}">${rate}&times;</button>
          ${script.talk ? `<button class="btn-ghost audio-hand" data-audio-act="hand" ${turn ? 'disabled' : ''}>&#9995; ${T('audioRaiseHand')}</button>` : ''}
        </div>` : `<p class="audio-notts">${T('audioNoTts')}</p>`}
      </div>
      ${turn ? turnHtml() : ''}
      <div class="audio-transcript" role="list">
        ${script.lines.map((l, i) => `<button class="audio-line speaker-${l.speaker}${i === index ? ' current' : ''}${l.ask ? ' ask' : ''}" data-audio-line="${i}" role="listitem">
          <span class="audio-speaker">${speakerName(script, l)}</span>
          <span class="audio-text">${esc(l.text)}</span>
        </button>`).join('')}
      </div>
      <div class="audio-footer">
        <button class="btn-ghost" data-audio-act="copy">${T('audioCopy')}</button>
        <button class="btn-ghost" data-audio-act="new">${T('audioNew')}</button>
      </div>
    </div>`;
  }

  function setupHtml() {
    const T = i18n.t;
    const opt = (key, icon, title, hint) => `<button class="audio-format${format === key ? ' active' : ''}" data-audio-format="${key}" aria-pressed="${format === key}">
      <span class="audio-format-icon">${icon}</span>
      <span class="audio-format-title">${title}</span>
      <span class="audio-format-hint">${hint}</span>
    </button>`;
    return `<div class="audio-wrap audio-setup">
      <h3 class="audio-setup-title">&#127911; ${T('audioTitle')}</h3>
      <p class="audio-setup-text">${T('audioIntro')}</p>
      <div class="audio-formats">
        ${opt('deep', '&#127897;&#65039;', T('audioDeep'), T('audioDeepHint'))}
        ${opt('brief', '&#9201;&#65039;', T('audioBrief'), T('audioBriefHint'))}
        ${opt('recap', '&#128214;', T('audioRecap'), T('audioRecapHint'))}
      </div>
      <input type="text" class="editor-input audio-focus" id="audio-focus" placeholder="${esc(T('audioFocusHolder'))}" ${format === 'recap' ? 'disabled' : ''}>
      <button class="btn-primary audio-generate" data-audio-act="generate" ${busy ? 'disabled' : ''}>${busy ? T('audioWriting') : T('audioGenerate')}</button>
    </div>`;
  }

  function refresh() {
    const data = App.getStudyData();
    if (data && host && host.isConnected) render(null, data);
  }

  // ----- Playback -----

  // The script's own language picks the voices (not the app language).
  function scriptLang(script) {
    return typeof TTS !== 'undefined' ? TTS.detectLang(script.lines.map(l => l.text).join(' ')) : null;
  }

  function voices(lang) {
    const list = typeof TTS !== 'undefined' ? TTS.voicesForLang(lang) : [];
    const a = list[0] || null;
    const b = list.find(v => v !== a && !/compact/i.test(v.name)) || null;
    // One voice only: tell the hosts apart by pitch.
    return { A: { voice: a, pitch: 1 }, B: b ? { voice: b, pitch: 1 } : { voice: a, pitch: 1.3 } };
  }

  function playFrom(i) {
    const data = App.getStudyData();
    const script = data && data.audio;
    // Another deck was opened while the pane was hidden: stop, don't read its script.
    if (forData && data !== forData) { playing = false; return; }
    if (!script || typeof TTS === 'undefined' || !TTS.supported()) { playing = false; return; }
    if (i >= script.lines.length) { playing = false; index = 0; refresh(); return; }
    index = Math.max(0, i);
    if (turn) closeTurn();
    // The student's own lines are shown, not read out.
    if (script.lines[index].speaker === 'U') { playFrom(index + 1); return; }
    playing = true;
    const my = ++token;
    const line = script.lines[index];
    const lang = scriptLang(script);
    const v = voices(lang)[line.speaker === 'B' ? 'B' : 'A'];
    refresh();
    scrollCurrent();
    TTS.speak(line.text, cancelled => {
      if (my !== token) return;
      if (cancelled) { playing = false; refresh(); return; }
      // A question the student has not answered yet: wait for their answer.
      const next = script.lines[index + 1];
      if (script.talk && line.ask && !(next && next.speaker === 'U')) { openTurn(index, line.text); return; }
      playFrom(index + 1);
    }, { voice: v.voice, pitch: v.pitch, rate, lang });
  }

  function speakerName(script, l) {
    const T = i18n.t;
    if (l.speaker === 'U') return T('audioYou');
    if (script.talk) return T('audioHost');
    return l.speaker === 'B' ? T('audioHostB') : T('audioHostA');
  }

  // ----- One-on-one: the student's turn -----

  function turnHtml() {
    const T = i18n.t;
    const canListen = !!SpeechRec();
    const status = turn.busy ? T('audioThinking') : turn.listening ? T('audioListening') : turn.err || '';
    return `<div class="audio-turn" role="group" aria-label="${esc(T('audioYourTurn'))}">
      <strong class="audio-turn-title">&#127897;&#65039; ${T('audioYourTurn')}</strong>
      ${turn.ask ? `<p class="audio-turn-q">${esc(turn.ask)}</p>` : ''}
      <div class="audio-turn-row">
        ${canListen ? `<button class="btn-ghost audio-mic${turn.listening ? ' on' : ''}" data-audio-act="listen" aria-pressed="${!!turn.listening}" ${turn.busy ? 'disabled' : ''}>&#127908; ${T(turn.listening ? 'audioStopListening' : 'audioListen')}</button>` : ''}
        <input type="text" class="editor-input audio-say" id="audio-say" maxlength="400" autocomplete="off" placeholder="${esc(T(canListen ? 'audioSayHolder' : 'audioSayHolderType'))}" value="${esc(turn.text || '')}" ${turn.busy ? 'disabled' : ''}>
        <button class="btn-primary" data-audio-act="say" ${turn.busy ? 'disabled' : ''}>${T('audioSend')}</button>
        <button class="btn-ghost" data-audio-act="skip" ${turn.busy ? 'disabled' : ''}>${T(turn.ask ? 'audioSkip' : 'audioBack')}</button>
      </div>
      <span class="audio-turn-status" role="status">${esc(status)}</span>
    </div>`;
  }

  const SpeechRec = () => (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;

  // It is the student's turn after line `at` (a host question, or a raised hand).
  function openTurn(at, ask) {
    stopListening();
    turn = { at, ask: ask || '', text: '' };
    playing = false;
    refresh();
    const input = host && host.querySelector('#audio-say');
    if (input) input.focus({ preventScroll: true });
    if (SpeechRec()) listen(); // talk out loud, like across a table (typing stays possible)
  }

  function closeTurn() {
    stopListening();
    turn = null;
  }

  function listen() {
    const R = SpeechRec();
    if (!R || !turn || turn.busy) return;
    stopListening();
    const data = App.getStudyData();
    const lang = (data && data.audio && scriptLang(data.audio)) || (i18n.getLang() === 'tr' ? 'tr' : 'en');
    const r = new R();
    rec = r;
    r.lang = lang === 'tr' ? 'tr-TR' : 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let said = '';
    r.onresult = e => {
      said = Array.from(e.results).map(x => x[0].transcript).join(' ').trim();
      if (turn) turn.text = said;
      const input = host && host.querySelector('#audio-say');
      if (input) input.value = said;
    };
    r.onerror = e => { if (rec !== r || !turn) return; turn.err = e && (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? i18n.t('audioNoMic') : e && e.error === 'no-speech' ? i18n.t('audioNoSpeech') : ''; };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      if (!turn) return;
      turn.listening = false;
      if (said) send(said); else refresh();
    };
    turn.listening = true;
    turn.err = '';
    try { r.start(); } catch (err) { rec = null; turn.listening = false; turn.err = i18n.t('audioNoMic'); }
    refresh();
  }

  function stopListening() {
    const r = rec;
    rec = null;
    if (r) { try { r.onend = null; r.abort(); } catch (e) {} }
    if (turn) turn.listening = false;
  }

  // The student said something: put it in the conversation, let the host answer, say it, and go on with the script.
  async function send(text) {
    const data = App.getStudyData();
    const script = data && data.audio;
    text = String(text || '').trim().slice(0, 400);
    if (!script || !turn || turn.busy || !text) return;
    stopListening();
    const at = turn.at, ask = turn.ask;
    turn.busy = true;
    turn.text = text;
    turn.err = '';
    script.lines.splice(at + 1, 0, { speaker: 'U', text });
    App.persistActiveDeck();
    index = at + 1;
    refresh();
    const said = script.lines.slice(Math.max(0, at - 10), at + 2).map(l => (l.speaker === 'U' ? 'Student: ' : 'Host: ') + l.text).join('\n');
    const question = 'You are the host of a one-on-one spoken revision session, talking face to face with a student about the study material. ' +
      (ask ? `You just asked: "${ask}". The student answered: "${text}". React to THAT answer like a warm tutor: say plainly whether it is right, partly right or wrong, ` +
          'give the correct idea with the reason in simple words, and praise what was good. '
        : `The student interrupted you and said: "${text}". Answer that directly and clearly, with a short example if it helps. `) +
      'Do not continue the lesson yourself and do not ask a new question: the lesson goes on after your reply. ' +
      '1-4 short spoken sentences, at most 80 words, no markdown, no lists, no emojis; say formulas and symbols in words. Talk to the student as "you" (in Turkish "sen"). ' +
      'Write it in the same language as the conversation. Return ONLY JSON, no other text: {"say":"..."}';
    const context = `Conversation so far:\n${said}\n\nStudy material:\n${(Material.forStudy(data) || JSON.stringify({ title: data.title, notes: data.notes })).slice(0, 10000)}`;
    let reply = '';
    try {
      const raw = await API.chat(question, context);
      const obj = Parser.safeParseJSON(raw);
      reply = obj && typeof obj.say === 'string' ? obj.say.trim() : (typeof raw === 'string' && !/^\s*[{[]/.test(raw) ? raw.trim() : '');
    } catch (err) {
      reply = '';
    }
    if (App.getStudyData() !== data || !turn || turn.at !== at) return;
    if (!reply) {
      // The host could not answer: keep what the student said, let them try again or go on.
      turn.busy = false;
      turn.text = '';
      turn.at = at + 1;
      turn.err = i18n.t('audioReplyFailed');
      refresh();
      return;
    }
    script.lines.splice(at + 2, 0, { speaker: 'A', text: reply.slice(0, 1200), reply: true });
    App.persistActiveDeck();
    closeTurn();
    playFrom(at + 2);
  }

  function scrollCurrent() {
    const cur = host && host.querySelector('.audio-line.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', behavior: FX.reduced() ? 'auto' : 'smooth' });
  }

  function pause() {
    closeTurn();
    token++;
    playing = false;
    if (typeof TTS !== 'undefined') TTS.stop();
    refresh();
  }

  function stop() {
    closeTurn();
    if (!playing) return;
    token++;
    playing = false;
    if (typeof TTS !== 'undefined') TTS.stop();
  }

  // Written from the notes (scripts made before this carry no v or v 1).
  const AUDIO_V = 2;

  // A new script for ANY deck's data; no screen involved. Throws on a bad answer.
  async function write(data, fmt, focus) {
    const raw = await API.chat(prompt(fmt, focus || ''), Material.forStudy(data) || JSON.stringify({ title: data.title, notes: data.notes }));
    const obj = Parser.safeParseJSON(raw);
    const lines = obj && Array.isArray(obj.lines) ? obj.lines : [];
    const clean = Parser.normalizeStudyData({ title: data.title, audio: { format: fmt, title: obj && obj.title, lines, createdAt: Date.now(), v: AUDIO_V } }).audio;
    if (!clean) throw new Error('empty script');
    if (fmt === 'brief') clean.lines.forEach(l => { l.speaker = 'A'; delete l.ask; });
    if (fmt === 'deep') { clean.talk = true; clean.lines.forEach(l => { l.speaker = 'A'; }); }
    return clean;
  }

  // A script written by an older pipeline (the offline recap is built from the notes and never outdated).
  const isOutdated = data => !!(data.audio && data.audio.format !== 'recap' && (data.audio.v || 1) < AUDIO_V);

  // Replaces an outdated script with a new one in the same format.
  async function refreshOld(data) {
    if (!isOutdated(data)) return { replaced: 0 };
    data.audio = await write(data, data.audio.format);
    return { replaced: 1 };
  }

  async function generate() {
    const data = App.getStudyData();
    if (!data || busy) return;
    const focusEl = host && host.querySelector('#audio-focus');
    const focus = focusEl ? focusEl.value.trim().slice(0, 200) : '';
    stop();
    if (format === 'recap') {
      data.audio = recapScript(data);
      App.persistActiveDeck();
      index = 0;
      refresh();
      return;
    }
    busy = true;
    refresh();
    try {
      const clean = await write(data, format, focus);
      if (App.getStudyData() !== data) return;
      data.audio = clean;
      App.persistActiveDeck();
      index = 0;
      App.showToast(i18n.t('audioReady'), 'success');
    } catch (err) {
      App.showToast(i18n.t('audioFailed') + ' ' + err.message, 'error');
    } finally {
      busy = false;
      refresh();
    }
  }

  // A short two-host overview of ONE section (js/topics.js caches and plays it). Throws when the AI call or the script fails.
  async function generateFor(sectionText, title) {
    const ask = 'Write a short two-host audio overview (about 2 minutes spoken, a conversation between host A who explains and host B who is curious) of ONLY the topic "' + title + '" from the study material below. ' +
      'Cover what it is, the must-know ideas, one example or analogy, and end with the key takeaways. About 280 words in 8-14 short turns that alternate naturally. ' +
      'Spoken style only: no markdown, no lists, no stage directions, no emojis; say formulas and symbols in words. Write it in the language of the material. ' +
      'Return ONLY JSON, no other text: {"type":"audio","title":"episode title","lines":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]}';
    const raw = await API.chat(ask, sectionText);
    const obj = Parser.safeParseJSON(raw);
    const clean = Parser.normalizeStudyData({ title, audio: { format: 'brief', title: obj && obj.title, lines: obj && Array.isArray(obj.lines) ? obj.lines : [], createdAt: Date.now() } }).audio;
    if (!clean) throw new Error('empty script');
    return clean;
  }

  function copy() {
    const data = App.getStudyData();
    if (!data || !data.audio) return;
    const T = i18n.t;
    const text = data.audio.lines.map(l => `${speakerName(data.audio, l)}: ${l.text}`).join('\n\n');
    navigator.clipboard.writeText((data.audio.title || data.title) + '\n\n' + text)
      .then(() => App.showToast(T('audioCopied'), 'success'))
      .catch(() => App.showToast(T('failedCopy'), 'error'));
  }

  function init() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target || e.target.id !== 'audio-say' || !host || !host.contains(e.target)) return;
      e.preventDefault();
      send(e.target.value);
    });
    document.addEventListener('input', e => { if (turn && e.target && e.target.id === 'audio-say') turn.text = e.target.value; });
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      const fmt = e.target.closest('[data-audio-format]');
      if (fmt) { format = fmt.dataset.audioFormat; refresh(); return; }
      const line = e.target.closest('[data-audio-line]');
      if (line) { token++; closeTurn(); playFrom(parseInt(line.dataset.audioLine, 10)); return; }
      const btn = e.target.closest('[data-audio-act]');
      if (!btn) return;
      const act = btn.dataset.audioAct;
      const data = App.getStudyData();
      if (act === 'play') playFrom(index);
      else if (act === 'pause') pause();
      else if (act === 'next') { token++; playFrom(index + 1); }
      else if (act === 'prev') { token++; playFrom(Math.max(0, index - 1)); }
      else if (act === 'rate') {
        rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] || 1;
        try { localStorage.setItem('flashmind_audio_rate', String(rate)); } catch (err) {}
        if (playing) { token++; playFrom(index); } else refresh();
      }
      else if (act === 'generate') generate();
      else if (act === 'hand') { const sc = data && data.audio; if (!sc) return; token++; if (typeof TTS !== 'undefined') TTS.stop(); openTurn(Math.min(index, sc.lines.length) - 1, ''); } // before the cut-off line, which is said again afterwards
      else if (act === 'listen') { if (turn && turn.listening) { const r = rec; if (r) { try { r.stop(); } catch (err) {} } } else listen(); }
      else if (act === 'say') { const inp = host.querySelector('#audio-say'); send(inp ? inp.value : ''); }
      else if (act === 'skip') { const at = turn ? turn.at : index; closeTurn(); playFrom(at + 1); }
      else if (act === 'copy') copy();
      else if (act === 'new' && data) { stop(); delete data.audio; App.persistActiveDeck(); index = 0; refresh(); }
    });
  }

  return { refreshOld, isOutdated, init, render, stop, recapScript, generateFor, voices, isPlaying: () => playing };
})();
