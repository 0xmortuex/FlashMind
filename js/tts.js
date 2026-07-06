// ===== TTS Module =====
// Read-aloud via the browser's built-in speechSynthesis — no dependencies,
// supports the UI languages (tr-TR / en-US). Long text is chunked by sentence
// because Chrome silently stops long single utterances (~15s bug).
const TTS = (() => {
  let session = 0; // bumping this cancels any in-flight chunk queue

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

  // Split into ~220-char chunks on sentence boundaries.
  function chunk(text) {
    const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [String(text)];
    const chunks = [];
    let cur = '';
    parts.forEach(p => {
      if ((cur + p).length > 220 && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += p;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }

  function speak(text, onEnd) {
    if (!supported() || !text) { if (onEnd) onEnd(); return; }
    stop();
    const mySession = ++session;
    const tag = langTag();
    const voice = pickVoice(tag);
    const chunks = chunk(text);
    let idx = 0;

    function next() {
      if (mySession !== session) return; // cancelled
      if (idx >= chunks.length) { if (onEnd) onEnd(); return; }
      const u = new SpeechSynthesisUtterance(chunks[idx++]);
      u.lang = tag;
      if (voice) u.voice = voice;
      u.rate = 1;
      u.onend = next;
      u.onerror = () => { if (mySession === session && onEnd) onEnd(); };
      speechSynthesis.speak(u);
    }
    next();
  }

  function stop() {
    session++;
    if (supported()) speechSynthesis.cancel();
  }

  function isSpeaking() {
    return supported() && speechSynthesis.speaking;
  }

  return { supported, speak, stop, isSpeaking };
})();
