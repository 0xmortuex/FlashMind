// ===== TTS Module =====
// Read-aloud via the browser's built-in speechSynthesis — no dependencies,
// supports the UI languages (tr-TR / en-US). Long text is chunked by sentence
// because Chrome silently stops long single utterances (~15s bug).
const TTS = (() => {
  let session = 0; // bumping this cancels any in-flight chunk queue
  let pendingEnd = null; // onEnd of the utterance queue currently speaking

  function supported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  function langTag() {
    return i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US';
  }

  function pickVoice(tag) {
    const voices = speechSynthesis.getVoices() || [];
    const prefix = tag.slice(0, 2);
    return voices.find(v => v.lang === tag) || voices.find(v => v.lang && v.lang.startsWith(prefix)) || null;
  }

  // Every installed voice for the UI language, exact locale first (used to
  // give the two audio-overview hosts different voices).
  function voicesForLang() {
    if (!supported()) return [];
    const tag = langTag(), prefix = tag.slice(0, 2);
    const voices = speechSynthesis.getVoices() || [];
    return voices.filter(v => v.lang === tag).concat(voices.filter(v => v.lang !== tag && v.lang && v.lang.startsWith(prefix)));
  }

  // Speech-friendly text: formula delimiters and LaTeX commands are noise.
  function speakable(text) {
    return String(text)
      .replace(/\\[()[\]]|\$+/g, ' ')
      .replace(/\\(frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, '$2 / $3')
      .replace(/\\(cdot|times)/g, ' × ')
      .replace(/\\([a-zA-Z]+)/g, '$1')
      .replace(/[{}^_]/g, ' ');
  }

  // Split into ~220-char chunks on sentence boundaries.
  function chunk(text) {
    const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [String(text)];
    const chunks = [];
    let cur = '';
    parts.forEach(p => {
      while (p.length > 220) {
        if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
        const space = p.lastIndexOf(' ', 220);
        const end = space > 0 ? space : 220;
        chunks.push(p.slice(0, end).trim());
        p = p.slice(end).trimStart();
      }
      if ((cur + p).length > 220 && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += p;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }

  // onEnd(cancelled) runs once: when the text finishes, or with `true` when
  // another speak()/stop() cuts it off. opts: { voice, pitch, rate }.
  function speak(text, onEnd, opts) {
    if (!supported() || !text) { if (onEnd) onEnd(false); return; }
    stop();
    const mySession = ++session;
    const tag = langTag();
    const o = opts || {};
    const voice = o.voice || pickVoice(tag);
    const chunks = chunk(speakable(text));
    let idx = 0;
    pendingEnd = onEnd || null;
    const finish = () => {
      if (mySession !== session) return;
      const cb = pendingEnd;
      pendingEnd = null;
      if (cb) cb(false);
    };

    function next() {
      if (mySession !== session) return; // cancelled
      if (idx >= chunks.length) { finish(); return; }
      const u = new SpeechSynthesisUtterance(chunks[idx++]);
      u.lang = tag;
      if (voice) u.voice = voice;
      u.rate = o.rate || 1;
      u.pitch = o.pitch || 1;
      u.onend = next;
      u.onerror = finish;
      speechSynthesis.speak(u);
    }
    next();
  }

  function stop() {
    session++;
    const cb = pendingEnd;
    pendingEnd = null;
    if (supported()) speechSynthesis.cancel();
    if (cb) cb(true);
  }

  function isSpeaking() {
    return supported() && speechSynthesis.speaking;
  }

  return { supported, speak, stop, isSpeaking, voicesForLang, speakable };
})();
