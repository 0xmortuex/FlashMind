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
      : 'Write an engaging two-host audio overview (a podcast-style conversation) of this study material for a student revising for an exam. ' +
        'Host A explains and leads; host B is curious, asks the questions a student would ask, reacts, and adds examples. ' +
        'Cover the most important ideas, one memorable analogy or example, a common mistake to avoid, and end with a quick recap of the 3 key takeaways. ' +
        'About 650 words in 18-30 short turns that alternate naturally.';
    return base + ' Spoken style only: no markdown, no lists, no stage directions, no emojis; say formulas and symbols in words. ' +
      'Write it in the language of the material. ' +
      (focus ? `Focus especially on: ${focus}. ` : '') +
      'Return ONLY JSON, no other text: {"type":"audio","title":"episode title","lines":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]}';
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
        </div>` : `<p class="audio-notts">${T('audioNoTts')}</p>`}
      </div>
      <div class="audio-transcript" role="list">
        ${script.lines.map((l, i) => `<button class="audio-line speaker-${l.speaker}${i === index ? ' current' : ''}" data-audio-line="${i}" role="listitem">
          <span class="audio-speaker">${l.speaker === 'B' ? T('audioHostB') : T('audioHostA')}</span>
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

  function voices() {
    const list = typeof TTS !== 'undefined' ? TTS.voicesForLang() : [];
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
    playing = true;
    const my = ++token;
    const line = script.lines[index];
    const v = voices()[line.speaker === 'B' ? 'B' : 'A'];
    refresh();
    scrollCurrent();
    TTS.speak(line.text, cancelled => {
      if (my !== token) return;
      if (cancelled) { playing = false; refresh(); return; }
      playFrom(index + 1);
    }, { voice: v.voice, pitch: v.pitch, rate });
  }

  function scrollCurrent() {
    const cur = host && host.querySelector('.audio-line.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', behavior: FX.reduced() ? 'auto' : 'smooth' });
  }

  function pause() {
    token++;
    playing = false;
    if (typeof TTS !== 'undefined') TTS.stop();
    refresh();
  }

  function stop() {
    if (!playing) return;
    token++;
    playing = false;
    if (typeof TTS !== 'undefined') TTS.stop();
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
      const raw = await API.chat(prompt(format, focus), App.getOriginalText() || JSON.stringify({ title: data.title, notes: data.notes }));
      const obj = Parser.safeParseJSON(raw);
      const lines = obj && Array.isArray(obj.lines) ? obj.lines : [];
      if (App.getStudyData() !== data) return;
      const clean = Parser.normalizeStudyData({ title: data.title, audio: { format, title: obj && obj.title, lines, createdAt: Date.now() } }).audio;
      if (!clean) throw new Error('empty script');
      if (format === 'brief') clean.lines.forEach(l => { l.speaker = 'A'; });
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
    const text = data.audio.lines.map(l => `${l.speaker === 'B' ? T('audioHostB') : T('audioHostA')}: ${l.text}`).join('\n\n');
    navigator.clipboard.writeText((data.audio.title || data.title) + '\n\n' + text)
      .then(() => App.showToast(T('audioCopied'), 'success'))
      .catch(() => App.showToast(T('failedCopy'), 'error'));
  }

  function init() {
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      const fmt = e.target.closest('[data-audio-format]');
      if (fmt) { format = fmt.dataset.audioFormat; refresh(); return; }
      const line = e.target.closest('[data-audio-line]');
      if (line) { token++; playFrom(parseInt(line.dataset.audioLine, 10)); return; }
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
      else if (act === 'copy') copy();
      else if (act === 'new' && data) { stop(); delete data.audio; App.persistActiveDeck(); index = 0; refresh(); }
    });
  }

  return { init, render, stop, recapScript, generateFor, voices, isPlaying: () => playing };
})();
