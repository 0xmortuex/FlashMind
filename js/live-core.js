// ===== Live helpers (pure) =====
// Decision logic shared by the camera tutor (js/voice.js + js/camera.js) and
// the lecture companion (js/lecture.js), kept free of DOM and network so it
// can be unit-tested: when to send a camera frame, how a live transcript is
// split into timestamped segments and note-taking chunks, which teacher cues
// sound like exam material, and how the AI's chunk output is sanitized.
const LiveCore = (() => {
  // ----- Camera frames -----

  // Microphone level for one Int16 PCM chunk (0..1 RMS).
  function rms(int16) {
    if (!int16 || !int16.length) return 0;
    let sum = 0;
    for (let i = 0; i < int16.length; i++) { const v = int16[i] / 32768; sum += v * v; }
    return Math.sqrt(sum / int16.length);
  }
  const VOICE_RMS = 0.02;
  function isVoice(int16) { return rms(int16) >= VOICE_RMS; }

  // Mean absolute difference (0..255) between two grayscale thumbnails.
  function frameDiff(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 255;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }
  const CHANGE_THRESHOLD = 6;

  // Frames cost tokens on every turn, so they go up only when they can help:
  // right away when the student starts talking, ~1 fps while they talk and
  // the page changes (every 5 s if it doesn't), and when the page changes
  // while they are quiet (at most every 2.5 s). A still page in silence
  // sends nothing: the tutor already has that image.
  function shouldSendFrame({ now, lastSent, changed, speaking, speechStarted }) {
    if (!lastSent) return true;
    const since = now - lastSent;
    if (speechStarted && since >= 500) return true;
    if (speaking) return changed ? since >= 1000 : since >= 5000;
    return !!changed && since >= 2500;
  }

  // Output size: longest side `max` px, aspect kept.
  function frameSize(w, h, max = 640) {
    if (!(w > 0 && h > 0)) return { w: max, h: Math.round(max * 3 / 4) };
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  // ----- Transcript -----

  // Live transcription arrives in fragments. A fragment extends the last
  // segment unless there was a pause (or the segment is already long), so the
  // transcript reads as timestamped paragraphs. `at` is ms since the start.
  function addFragment(segments, text, at, opts = {}) {
    const t = String(text || '');
    if (!t.trim()) return segments;
    const gap = opts.gap || 2500, maxLen = opts.maxLen || 420;
    const last = segments[segments.length - 1];
    if (last && at - last.end < gap && last.text.length < maxLen) {
      last.text += /^\s/.test(t) || /\s$/.test(last.text) || /^[.,;:!?)]/.test(t) ? t : ' ' + t;
      last.end = at;
    } else segments.push({ at, end: at, text: t.trim() });
    return segments;
  }

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }

  function transcriptText(segments, from = 0, to = segments.length) {
    return segments.slice(from, to).map(s => `[${clock(s.at)}] ${s.text.trim()}`).join('\n');
  }

  // The next piece of transcript to turn into notes, or null when it should
  // keep growing: every `every` ms once there is enough to work with, early
  // when it gets long, and whatever is left when the lecture ends.
  function nextChunk(segments, from, { now, lastAt, final, every = 5 * 60000, minChars = 600, maxChars = 6000 }) {
    let chars = 0, end = from;
    while (end < segments.length && (chars === 0 || chars + segments[end].text.length <= maxChars)) chars += segments[end++].text.length + 1;
    if (end === from) return null;
    const full = end < segments.length || chars >= maxChars;
    if (full || (final && chars >= 40) || (now - lastAt >= every && chars >= minChars)) return { from, to: end, chars };
    return null;
  }

  // ----- Exam cues -----

  // Teacher phrases that usually mean "this will be asked". `exam` is the
  // strongest; the others are hints the note-taker weighs.
  const CUES = [
    ['exam', /sınavda\s+(?:kesin(?:likle)?\s+)?(?:çıkar|çıkacak|çıkabilir|sorulur|soracağım|sorarım|gelir|gelecek)|sınav(?:da|a)?\s+(?:için\s+)?(?:çok\s+)?önemli|sınav\s+sorusu|yazılıda\s+(?:çıkar|sorarım|soracağım|gelir)|on\s+the\s+(?:exam|test)|in\s+the\s+(?:exam|test)|exam\s+question|will\s+be\s+(?:asked|tested)/],
    ['important', /çok\s+önemli|(?:^|\s)bu\s+(?:çok\s+)?önemli|önemli\s+(?:bir\s+)?(?:nokta|konu)|altını\s+çiz|(?:this|that)\s+is\s+(?:really\s+|very\s+)?important|very\s+important|key\s+point|underline/],
    ['attention', /dikkat\s+(?:edin|et|çekerim)|unutmayın|aklınızda\s+(?:olsun|tutun)|iyi\s+(?:bilin|öğrenin)|ezberleyin|not\s+(?:alın|edin)|defterinize\s+yazın|pay\s+attention|remember\s+(?:this|that)|don'?t\s+forget|write\s+(?:this|that)\s+down|memori[sz]e/],
    ['definition', /(?:^|\s)(?:denir|adı\s+verilir|olarak\s+tanımlanır)(?=[\s.,;:!?]|$)|tanımı\s+(?:şu|şöyle)|\bis\s+defined\s+as|\bthe\s+definition\s+of|\bis\s+called\b/],
    ['repeat', /tekrar\s+ediyorum|bir\s+(?:daha|kez\s+daha)\s+söylüyorum|tekrar\s+söylüyorum|let\s+me\s+repeat|i'?ll\s+say\s+it\s+again/],
  ];

  function lower(text) {
    try { return String(text).toLocaleLowerCase('tr'); } catch (e) { return String(text).toLowerCase(); }
  }

  // [{ type, match, index }] in text order.
  function detectCues(text) {
    const src = lower(text);
    const out = [];
    CUES.forEach(([type, re]) => {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(src))) {
        if (!m[0]) { g.lastIndex++; continue; }
        out.push({ type, match: m[0].trim(), index: m.index });
      }
    });
    return out.sort((a, b) => a.index - b.index);
  }

  const STOP = new Set(('ve veya ile bir bu şu o da de mi mı mu mü ki için gibi daha çok en ne neden nasıl yani şimdi evet hayır ama fakat ' +
    'çünkü olarak olan olur oluyor var yok ben sen biz siz onlar bunu şunu onu burada şurada orada kadar sonra önce her hep ' +
    'the a an and or of to in on at is are was were be it this that these those we you they i so then now yes no but because as for with').split(' '));

  // Word groups the teacher keeps coming back to (repetition is a strong
  // "this matters" signal): 2–3 word phrases said at least `min` times.
  function repeatedPhrases(text, min = 3) {
    const words = lower(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const counts = new Map();
    for (const n of [3, 2]) {
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.join('').length < 8) continue;
        const k = g.join(' ');
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    const hits = [...counts.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    // Drop 2-word phrases already covered by a reported 3-word phrase.
    const out = [];
    hits.forEach(([k, c]) => { if (!out.some(o => o.phrase.includes(k))) out.push({ phrase: k, count: c }); });
    return out.slice(0, 5);
  }

  // ----- Note-taking prompt -----

  function lecturePrompt({ transcript, previous, cues, repeated, known, lang, part }) {
    const language = lang === 'tr' ? 'Turkish' : 'English';
    const hints = [];
    if (cues && cues.length) hints.push('Teacher cues heard in this part: ' + cues.slice(0, 12).map(c => `"${c.match}"`).join(', ') + '.');
    if (repeated && repeated.length) hints.push('Phrases the teacher repeated: ' + repeated.map(r => `"${r.phrase}" (${r.count}x)`).join(', ') + '.');
    return 'You take notes for a 10th-grade student sitting in class. Below is part ' + (part || 1) + ' of a live, automatic transcript of the teacher ' +
      '(it may contain recognition errors, chit-chat and classroom management: ignore those, and fix obvious mis-hearings from context). ' +
      'Turn only the teaching content into: up to 3 concise note sections, up to 6 flashcards that test key facts, definitions and formulas, ' +
      'and the moments that sound like exam material ("examAlerts": the teacher says it will be on the exam, stresses it as important, ' +
      'asks students to note or memorise it, repeats it, or dictates a definition). Mark a flashcard "exam": true when it covers an exam alert. ' +
      'Do not repeat cards the student already has. Write in ' + language + ' unless the lesson is clearly in another language; then use that language. ' +
      'If this part has no teaching content, return empty arrays.\n' +
      (hints.length ? hints.join('\n') + '\n' : '') +
      'Return ONLY JSON, no other text: {"sections":[{"title":"...","content":"2-4 sentences","bulletPoints":["..."],"keyTerms":[{"term":"...","definition":"..."}]}],' +
      '"flashcards":[{"front":"...","back":"...","difficulty":"easy|medium|hard","exam":false}],' +
      '"examAlerts":[{"point":"what will be asked, one sentence","quote":"the teacher\'s words, short","why":"exam|important|repeated|definition"}]}\n\n' +
      (known && known.length ? 'Cards the student already has (fronts):\n' + known.slice(-30).map(f => '- ' + String(f).slice(0, 120)).join('\n') + '\n\n' : '') +
      (previous ? 'End of the previous part (context only):\n"""' + String(previous).slice(-400) + '"""\n\n' : '') +
      'Transcript:\n"""\n' + transcript + '\n"""';
  }

  // Bounded, string-typed view of the model's chunk output.
  function sanitizeChunk(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
    const list = v => Array.isArray(v) ? v : [];
    const sections = list(o.sections).filter(s => s && typeof s === 'object').map(s => ({
      title: str(s.title, 140),
      content: str(s.content, 1500),
      bulletPoints: list(s.bulletPoints).map(b => str(b, 300)).filter(Boolean).slice(0, 8),
      keyTerms: list(s.keyTerms).filter(k => k && str(k.term, 80) && str(k.definition, 300)).slice(0, 6).map(k => ({ term: str(k.term, 80), definition: str(k.definition, 300) }))
    })).filter(s => s.title && (s.content || s.bulletPoints.length)).slice(0, 3);
    const flashcards = list(o.flashcards).filter(c => c && str(c.front, 300) && str(c.back, 600)).slice(0, 6).map(c => ({
      front: str(c.front, 300), back: str(c.back, 600),
      difficulty: ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium',
      exam: c.exam === true
    }));
    const examAlerts = list(o.examAlerts).filter(a => a && str(a.point, 300)).slice(0, 4).map(a => ({
      point: str(a.point, 300), quote: str(a.quote, 200),
      why: ['exam', 'important', 'repeated', 'definition'].includes(a.why) ? a.why : 'important'
    }));
    return { sections, flashcards, examAlerts };
  }

  return { rms, isVoice, frameDiff, CHANGE_THRESHOLD, shouldSendFrame, frameSize, addFragment, clock, transcriptText, nextChunk, detectCues, repeatedPhrases, lecturePrompt, sanitizeChunk };
})();
