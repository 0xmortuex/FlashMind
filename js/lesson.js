// ===== Video lessons =====
// A narrated slide lesson per topic. The AI writes a short storyboard (title,
// bullets, optional formula and diagram, narration per slide); the player
// shows it like a video — slide stage with transitions, narration through
// the browser's speech synthesis (one utterance per slide, next slide on its
// onEnd), captions, speed, a progress bar with slide markers and keyboard
// controls. Storyboards are saved on the set (data.lessons). Browser speech
// can't be recorded, so "download" is a printable/PDF slide handout.
// "I didn't understand" rewrites one slide with the AI (the original is kept,
// undo restores it); "Another version" regenerates the whole lesson from a
// different angle and saves it next to the original (data.lessons keeps 8).
const VideoLesson = (() => {
  const RATES = [0.75, 0.95, 1.25, 1.5, 2];
  const MAX_LESSONS = 8;
  // Instructions for the AI, per quick choice.
  const FIX_PROMPT = {
    simple: 'Explain this slide much more simply, in plain everyday words.',
    example: 'Keep the idea but teach it with a different, concrete example.',
    steps: 'Go through it step by step, one small step at a time.',
    analogy: 'Explain it with an everyday analogy the student knows from daily life.'
  };
  const FIX_LABEL = { simple: 'vlFixSimple', example: 'vlFixExample', steps: 'vlFixSteps', analogy: 'vlFixAnalogy' };
  const PERSP_PROMPT = {
    simple: 'Make this version for complete beginners: plain everyday words, no jargon, define every term, go slowly.',
    examples: 'Teach mainly through worked examples: after each idea give a concrete example with numbers.',
    exam: 'Make this version exam-focused: the key definitions, formulas, typical question types, common mistakes and quick tips.',
    short: 'Make this version much shorter: about 2 minutes in total, only 4-5 slides with 2-3 short sentences of narration each.',
    steps: 'Teach it as a step-by-step procedure: number the steps in the slide titles and work one example through them.',
    story: 'Teach it through a story or an everyday analogy that the whole lesson builds on.'
  };
  const PERSP_LABEL = { simple: 'vlPerSimple', examples: 'vlPerExamples', exam: 'vlPerExam', short: 'vlPerShort', steps: 'vlPerSteps', story: 'vlPerStory' };
  const WPS = 2.6; // spoken words per second at rate 1 (duration estimate)
  let host = null;
  let forData = null;
  let mode = 'list';     // 'list' | 'player'
  let lessonId = null;
  let index = 0;
  let playing = false;
  let ended = false;     // reached the end of the last slide
  let busy = false;
  let token = 0;
  let timer = 0;
  let progRaf = 0;
  let slideStart = 0;    // performance.now() when the current slide began (while playing)
  let elapsed = 0;       // ms spent on the current slide before the last pause
  let capChunks = [];
  let capShown = -1;
  let rate = 0.95;
  let captions = true;
  let silent = false;    // the student chose to continue without a voice
  let voiceWait = false; // a natural-voice clip is downloading
  let heardFrac = null; // how much of the current slide's narration the voice has spoken (null = unknown, estimate)
  let checkpoint = null; // { i, picked } while a "Did you get this?" card is open (picked = chosen option or null)
  let noVoice = '';      // language ('tr'/'en') the text needs but the device has no voice for
  let showOrig = false;  // showing the original of a revised slide
  let panel = null;      // open panel over the player: 'help' | 'version' | 'voice'
  let panelBusy = false; // an AI request is running for the panel
  let panelErr = '';
  let lastReq = null;    // the request to repeat on "Try again"
  let reqToken = 0;      // bumping this cancels the in-flight AI request
  const undoStack = [];  // slides replaced by a revision: { id, i, slide }
  try {
    rate = parseFloat(localStorage.getItem('flashmind_video_rate')) || 0.95;
    captions = localStorage.getItem('flashmind_video_cc') !== '0';
  } catch (e) {}

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }
  const ttsOk = () => typeof TTS !== 'undefined' && (TTS.supported() || TTS.naturalAvailable());

  function lesson() {
    const data = App.getStudyData();
    return data && (data.lessons || []).find(l => l.id === lessonId) || null;
  }

  // Estimated seconds per slide (speech synthesis reports no progress).
  function duration(slide) {
    const words = String(slide.narration || '').split(/\s+/).filter(Boolean).length;
    return Math.max(2.5, words / (WPS * rate)) + 0.6;
  }

  // The slide as shown and spoken: the original while "Show original" is on.
  function view(l, i) {
    const s = l.slides[i];
    return showOrig && s.orig ? s.orig : s;
  }

  // Language of the lesson's own text (not the app language); null if undetermined.
  function lessonLang(l) {
    return typeof TTS !== 'undefined' ? TTS.detectLang(l.title + '. ' + l.slides.map(s => s.narration).join(' ')) : null;
  }

  // ----- Versions and slide revisions (pure, tested) -----

  // Lessons that are versions of the same original, oldest first.
  function versionsOf(list, l) {
    const fam = l.base || l.id;
    return list.filter(x => (x.base || x.id) === fam);
  }

  // At most MAX_LESSONS: drop the oldest other version first, never the new
  // lesson or the original it was made from.
  function trimLessons(list, keep) {
    const out = list.slice();
    while (out.length > MAX_LESSONS) {
      let i = out.findIndex(x => x.base && x.id !== keep.id);
      if (i < 0) i = out.findIndex(x => x.id !== keep.id && x.id !== keep.base);
      out.splice(i, 1);
    }
    return out;
  }

  // Put a revised slide in place; the first original is kept on the slide and
  // the replaced slide goes on the undo stack.
  function reviseSlide(l, i, rev, stack) {
    const old = l.slides[i];
    const { orig, ...plain } = old;
    const next = { ...rev, orig: orig || plain };
    if (!next.diagram && old.diagram) next.diagram = old.diagram;
    stack.push({ id: l.id, i, slide: old });
    l.slides[i] = next;
    return next;
  }

  // Undo the last revision of slide i (or, after a reload, restore its original).
  function undoSlide(l, i, stack) {
    let k = stack.length - 1;
    while (k >= 0 && !(stack[k].id === l.id && stack[k].i === i)) k--;
    const prev = k >= 0 ? stack.splice(k, 1)[0].slide : l.slides[i].orig;
    if (!prev) return false;
    l.slides[i] = prev;
    return true;
  }

  // Notes in a teacher's voice have no bullets or key terms: the paragraphs of
  // `content` are the narration, cut into slides of about 30-70 words.
  function paragraphSlides(content) {
    const words = t => t.split(/\s+/).filter(Boolean).length;
    const pieces = [];
    String(content || '').split(/\n+/).map(p => p.trim()).filter(Boolean).forEach(p => {
      if (words(p) <= 70) { pieces.push(p); return; }
      let cur = '';
      (p.match(/[^.!?…]+[.!?…]*\s*/g) || [p]).forEach(sent => {
        if (cur && words(cur + sent) > 70) { pieces.push(cur.trim()); cur = ''; }
        cur += sent;
      });
      if (cur.trim()) pieces.push(cur.trim());
    });
    const out = [];
    pieces.forEach(p => {
      const last = out.length - 1;
      if (last >= 0 && (words(out[last]) < 30 || words(p) < 30) && words(out[last] + ' ' + p) <= 70) out[last] += ' ' + p;
      else out.push(p);
    });
    return out;
  }

  // ----- Storyboards -----

  // Offline lesson straight from the notes (no AI call).
  function fromNotes(data, sectionIdx) {
    const T = i18n.t;
    const n = data.notes || {};
    const all = n.sections || [];
    const secs = Number.isInteger(sectionIdx) && all[sectionIdx] ? [all[sectionIdx]] : all.slice(0, 9);
    const slides = [{ title: Number.isInteger(sectionIdx) && all[sectionIdx] ? all[sectionIdx].title : data.title, bullets: [], narration: n.summary || data.title }];
    // Teacher-voice notes (no bullets / key terms): the paragraphs are the narration.
    const teacher = secs.some(s => s.content) && secs.every(s => !(s.bulletPoints || []).length && !(s.keyTerms || []).length);
    if (teacher) {
      secs.forEach(s => paragraphSlides(s.content).forEach((p, k) => slides.push({ title: k ? `${s.title} · ${k + 1}` : s.title, bullets: [], narration: p })));
      slides.splice(11);
    } else secs.forEach(s => {
      const bullets = (s.bulletPoints || []).slice(0, 3);
      if (!bullets.length) (s.keyTerms || []).slice(0, 3).forEach(k => bullets.push(`${k.term}: ${k.definition}`));
      slides.push({ title: s.title, bullets, narration: [s.content, ...(s.keyTerms || []).slice(0, 2).map(k => `${k.term}: ${String(k.definition).replace(/[.!?…\s]+$/, '')}.`)].filter(Boolean).join(' ') || s.title });
    });
    if (!Number.isInteger(sectionIdx)) {
      (n.diagrams || []).slice(0, 2).forEach((g, i) => slides.push({ title: g.title, bullets: [], diagram: { kind: 'notes', index: i }, narration: g.description || g.title }));
    }
    const mistakes = (n.commonMistakes || []).slice(0, 3);
    slides.push({ title: T('vlRecap'), bullets: mistakes.length ? mistakes : secs.slice(0, 3).map(s => s.title), narration: mistakes.length ? T('commonMistakes') + '. ' + mistakes.join('. ') : T('vlRecapSay', { title: data.title }) });
    return SimSpec.sanitizeLesson({ title: slides[0].title, topic: slides[0].title, slides, createdAt: Date.now() });
  }

  function mapTree(data) {
    if (data.notes && data.notes.mindmap) return data.notes.mindmap;
    return typeof Mindmap !== 'undefined' ? Mindmap.fromNotes(data) : null;
  }

  // What the lesson is written from: the notes (the teaching) first, the source text
  // only as a short reference (see material.js).
  const materialFor = (data, sec) => Material.forStudy(data, sec);

  function prompt(data, topic, focus, style) {
    const diagrams = ((data.notes && data.notes.diagrams) || []).map((g, i) => `${i}: ${g.title}`).slice(0, 10);
    const tree = mapTree(data);
    const branches = tree ? (tree.children || []).map(c => c.label).slice(0, 12) : [];
    return `Write the storyboard of a short narrated video lesson (6-10 slides) that teaches ${topic ? `"${topic}"` : 'the main ideas of this study material'} to a student revising for an exam. ` +
      Material.SUBJECT_RULE +
      'Slide 1 is a title slide with a hook; then build the idea step by step with a concrete example; the last slide recaps the 3 key takeaways. ' +
      'Each slide: "title" (max 8 words), "bullets": 1-3 short points (max 12 words each; may be empty on the title slide), optional "formula": one key formula in LaTeX without $ delimiters, ' +
      'optional "diagram" to show an existing picture: ' + (diagrams.length ? `{"kind":"notes","index":N} for one of these notes diagrams [${diagrams.join('; ')}], or ` : '') +
      (branches.length ? `{"kind":"map","label":"..."} for one of these mind-map branches [${branches.join('; ')}]. ` : 'none available. ') +
      '"narration": what the teacher says over the slide, spoken like a teacher talking to the student: 2-4 short natural sentences (30-70 words), formulas and symbols said in words (e.g. "x kare", "a bölü b" or "x squared", "a over b"), no markdown, no LaTeX, no symbols. ' +
      'On 2-4 slides in the middle of the lesson (never the first or the last) add "check": the quick question a teacher asks to see whether the student got THAT slide: ' +
      '{"q":"one clear question","options":["...","...","..."],"correct":0,"why":"one short sentence that explains the right answer"} with 3 options, exactly one correct, plausible wrong ones, and the correct option in varying positions. ' +
      'Write everything in the same language as the material (if it is Turkish, write natural spoken Turkish). At most 10 slides. ' + (focus ? `Focus especially on: ${focus}. ` : '') +
      (style ? `${style} (this overrides the slide count above). ` : '') +
      'Return ONLY JSON, no other text: {"title":"lesson title","slides":[{"title":"...","bullets":["..."],"formula":"E = mc^2","narration":"..."}]}';
  }

  async function generate(topicIdx, focus) {
    const data = App.getStudyData();
    if (!data || busy) return;
    const sec = Number.isInteger(topicIdx) ? (data.notes.sections || [])[topicIdx] : null;
    busy = true;
    refresh();
    try {
      const raw = await API.chat(prompt(data, sec ? sec.title : '', focus), materialFor(data, sec));
      const obj = Parser.safeParseJSON(raw);
      if (App.getStudyData() !== data) return;
      const l = SimSpec.sanitizeLesson({ ...(obj || {}), id: undefined, topic: sec ? sec.title : data.title, createdAt: Date.now() });
      if (!l) throw new Error(i18n.t('vlInvalid'));
      save(data, l);
      App.showToast(i18n.t('vlReady'), 'success');
    } catch (err) {
      App.showToast(i18n.t('vlFailed') + ' ' + err.message, 'error');
    } finally {
      busy = false;
      refresh();
    }
  }

  function save(data, l) {
    const list = data.lessons || [];
    const ids = new Set(list.map(x => x.id));
    let k = list.length + 1;
    l.id = 'v' + k;
    while (ids.has(l.id)) l.id = 'v' + (++k);
    data.lessons = trimLessons(list.concat([l]), l);
    App.persistActiveDeck();
    lessonId = l.id;
    mode = 'player';
    index = 0;
    silent = false; // a new lesson speaks again, whatever the student chose in the last one
  }

  // ----- AI edits: rewrite one slide, make another version -----

  function aiError(err) {
    const T = i18n.t;
    const m = String((err && err.message) || err);
    if (/429|rate limit|too many|try again/i.test(m)) return new Error(T('vlRateLimit'));
    if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request/i.test(m)) return new Error(T('vlOffline'));
    return new Error(m);
  }

  // One API.chat call whose answer must pass `accept` (returns the usable
  // value or null). Unusable JSON gets one retry, then an explicit error.
  // Resolves null when `my` is no longer the live request (cancelled).
  async function askJson(question, context, accept, my) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      try { raw = await API.chat(question, context); } catch (err) { throw aiError(err); }
      if (my !== reqToken) return null;
      let out = null;
      try { out = accept(Parser.safeParseJSON(raw)); } catch (e) { out = null; }
      if (out) return out;
    }
    throw new Error(i18n.t('vlInvalid'));
  }

  function failPanel(my, err) {
    if (my !== reqToken) return;
    panelBusy = false;
    panelErr = err.message + ' ' + i18n.t('vlKept');
    drawPanel();
  }

  // "I didn't understand": the AI rewrites the current slide.
  async function rewriteSlide(choice, text) {
    const data = App.getStudyData(), l = lesson();
    if (!data || !l || panelBusy) return;
    const my = ++reqToken, i = index;
    lastReq = { kind: 'help', choice, text };
    panelBusy = true;
    panelErr = '';
    drawPanel();
    const slide = x => JSON.stringify({ title: x.title, bullets: x.bullets, formula: x.formula || '', narration: x.narration });
    const near = (k, name) => l.slides[k] ? `${name}: ${slide(l.slides[k].orig || l.slides[k])}\n` : '';
    const question = 'A student watching a narrated video lesson did not understand ONE slide. Rewrite only that slide so the student understands it. ' +
      (choice ? FIX_PROMPT[choice] + ' ' : '') + (text ? `The student says what is unclear: "${text}". ` : '') +
      'Keep it correct and about the same topic. "title" max 8 words, "bullets": 1-3 short points (may be empty), optional "formula": LaTeX without $ delimiters, ' +
      '"narration": spoken like a teacher talking to the student: 2-5 short natural sentences (40-90 words), formulas and symbols said in words, no markdown, no LaTeX. ' +
      'Write it in the same language as the lesson. Return ONLY JSON, no other text: {"title":"...","bullets":["..."],"formula":"","narration":"..."}';
    const context = `Lesson: ${l.title}\n${near(index - 1, 'Previous slide')}Slide to rewrite: ${slide(l.slides[index].orig || l.slides[index])}\n${near(index + 1, 'Next slide')}\n` +
      `Study material:\n${materialFor(data, (data.notes.sections || []).find(s => s.title === l.topic))}`.slice(0, 12000);
    try {
      const rev = await askJson(question, context, obj => SimSpec.sanitizeSlide(obj), my);
      if (!rev || my !== reqToken) return;
      if (App.getStudyData() !== data || lesson() !== l) { panelBusy = false; return; }
      // The question stays, so the student is asked again after the new explanation.
      if (l.slides[i].check && !rev.check) rev.check = l.slides[i].check;
      reviseSlide(l, i, rev, undoStack);
      App.persistActiveDeck();
      panel = null;
      panelBusy = false;
      showOrig = false;
      renderPlayer(data);
      App.showToast(i18n.t('vlSlideReady'), 'success');
      play();
    } catch (err) {
      failPanel(my, err);
    }
  }

  function undoRevision() {
    const l = lesson();
    if (!l || !undoSlide(l, index, undoStack)) return;
    pause();
    App.persistActiveDeck();
    showOrig = false;
    renderPlayer(App.getStudyData());
    App.showToast(i18n.t('vlUndone'), 'success');
  }

  // "Another version of this video": regenerate the whole lesson from the same
  // material and save it next to the original.
  async function makeVersion(key, text) {
    const T = i18n.t;
    const data = App.getStudyData(), l = lesson();
    if (!data || !l || panelBusy) return;
    const my = ++reqToken;
    lastReq = { kind: 'version', choice: key, text };
    panelBusy = true;
    panelErr = '';
    drawPanel();
    const label = (key ? T(PERSP_LABEL[key]) : T('vlPerCustom') + ': ' + text).slice(0, 60);
    const style = [key ? PERSP_PROMPT[key] : '', text ? `The student asks for this kind of version: "${text}".` : ''].filter(Boolean).join(' ');
    const sec = (data.notes.sections || []).find(s => s.title === l.topic);
    try {
      const nl = await askJson(prompt(data, sec ? sec.title : '', '', style), materialFor(data, sec),
        obj => SimSpec.sanitizeLesson({ ...obj, id: undefined, topic: l.topic, base: l.base || l.id, label, createdAt: Date.now() }), my);
      if (!nl || my !== reqToken) return;
      if (App.getStudyData() !== data) { panelBusy = false; return; }
      stop();
      save(data, nl);
      panel = null;
      panelBusy = false;
      refresh();
      App.showToast(T('vlPerReady'), 'success');
    } catch (err) {
      failPanel(my, err);
    }
  }

  // ----- Rendering -----

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    if (forData !== data) { stop(); resetUi(); forData = data; mode = 'list'; lessonId = null; index = 0; }
    if (mode === 'player' && lesson() && !busy) { renderPlayer(data); return; }
    stop();
    mode = 'list';
    host.innerHTML = listHtml(data);
  }

  function listHtml(data) {
    const T = i18n.t;
    const lessons = data.lessons || [];
    const sections = (data.notes && data.notes.sections) || [];
    const cards = lessons.map(l => `<div class="vl-card">
        <button class="vl-card-play" data-vl-open="${esc(l.id)}" aria-label="${esc(T('vlPlayLesson', { title: l.title }))}">
          <span class="vl-card-thumb" aria-hidden="true">&#9654;</span>
          <span class="vl-card-meta"><strong>${esc(l.title)}</strong><span>${l.label ? esc(l.label) + ' · ' : ''}${T('vlSlides', { n: l.slides.length })} · ~${Math.max(1, Math.round(l.slides.reduce((s, x) => s + duration(x), 0) / 60))} ${T('vlMin')}</span></span>
        </button>
        <button class="btn-icon" data-vl-del="${esc(l.id)}" aria-label="${esc(T('vlDelete'))}" title="${esc(T('vlDelete'))}">&#128465;</button>
      </div>`).join('');
    return `<div class="vl-wrap vl-setup">
      <h3 class="vl-setup-title">&#127916; ${T('vlTitle')}</h3>
      <p class="vl-setup-text">${T('vlIntro')}</p>
      ${cards ? `<div class="vl-cards">${cards}</div>` : ''}
      <div class="vl-new">
        <label class="vl-label" for="vl-topic">${T('vlTopic')}</label>
        <select id="vl-topic" class="editor-input" ${busy ? 'disabled' : ''}>
          <option value="">${esc(T('vlWholeSet'))}</option>
          ${sections.map((s, i) => `<option value="${i}">${esc(s.title || T('vlSection', { n: i + 1 }))}</option>`).join('')}
        </select>
        <input type="text" class="editor-input" id="vl-focus" maxlength="200" placeholder="${esc(T('vlFocusHolder'))}" ${busy ? 'disabled' : ''}>
        <div class="vl-new-actions">
          <button class="btn-primary" data-vl-act="generate" ${busy ? 'disabled' : ''}>${busy ? T('vlWriting') : '&#10024; ' + T('vlGenerate')}</button>
          <button class="btn-ghost" data-vl-act="quick" ${busy ? 'disabled' : ''}>&#128214; ${T('vlQuick')}</button>
        </div>
      </div>
      ${ttsOk() ? '' : `<p class="vl-note">${T('vlNoTts')}</p>`}
    </div>`;
  }

  function renderPlayer(data) {
    const T = i18n.t;
    const l = lesson();
    index = Math.min(index, l.slides.length - 1);
    const total = l.slides.reduce((s, x) => s + duration(x), 0);
    let acc = 0;
    const marks = l.slides.map((s, i) => {
      const left = acc / total * 100;
      acc += duration(s);
      return `<button class="vl-mark" style="left:${left.toFixed(2)}%" data-vl-go="${i}" aria-label="${esc(T('vlGoSlide', { n: i + 1, title: s.title }))}" title="${esc((i + 1) + '. ' + s.title)}"></button>`;
    }).join('');
    const versions = versionsOf(data.lessons || [], l);
    host.innerHTML = `<div class="vl-wrap">
      <div class="vl-top">
        <button class="btn-ghost" data-vl-act="list">&larr; ${T('vlAll')}</button>
        <h3 class="vl-name">${esc(l.title)}</h3>
      </div>
      <div class="vl-versions">
        ${versions.length > 1 ? `<select class="editor-input vl-version" data-vl-version aria-label="${esc(T('vlVersion'))}">${versions.map((v, k) => `<option value="${esc(v.id)}"${v.id === l.id ? ' selected' : ''}>${k + 1}. ${esc(v.label || T('vlOriginal'))}</option>`).join('')}</select>` : ''}
        <button class="btn-ghost" data-vl-act="version">&#128257; ${T('vlAnother')}</button>
      </div>
      <div class="vl-player${captions ? ' cc-on' : ''}" data-vl-player tabindex="0" aria-roledescription="${esc(T('vlPlayerRole'))}" aria-label="${esc(l.title)}">
        <div class="vl-stage" data-vl-stage>
          <button class="vl-confused" data-vl-act="help" title="${esc(T('vlConfused'))} (H)">&#129300; ${T('vlConfused')}</button>
          <div class="vl-caption" data-vl-caption aria-live="polite"></div>
        </div>
        <div class="vl-bar">
          <div class="vl-progress" data-vl-seek role="slider" aria-label="${esc(T('vlProgress'))}" aria-valuemin="1" aria-valuemax="${l.slides.length}" aria-valuenow="${index + 1}">
            <div class="vl-progress-fill" data-vl-fill></div>${marks}
          </div>
          <div class="vl-controls">
            <button class="vl-btn" data-vl-act="prev" aria-label="${esc(T('vlPrev'))}" title="${esc(T('vlPrev'))} (←)">&#9198;</button>
            <button class="vl-btn vl-btn-main" data-vl-act="toggle" aria-label="${esc(T('vlPlay'))}" title="${esc(T('vlPlay'))} (Space)">&#9654;</button>
            <button class="vl-btn" data-vl-act="next" aria-label="${esc(T('vlNext'))}" title="${esc(T('vlNext'))} (→)">&#9197;</button>
            <span class="vl-count" data-vl-count></span>
            <span class="vl-voice-status" data-vl-voicestatus role="status"></span>
            <span class="vl-spacer"></span>
            ${ttsOk() ? `<button class="vl-btn" data-vl-act="voice" aria-label="${esc(T('vlVoiceBtn'))}" title="${esc(T('vlVoiceBtn'))}">&#128266;</button>` : ''}
            <button class="vl-btn vl-rate" data-vl-act="rate" title="${esc(T('vlSpeed'))}">${rate}&times;</button>
            <button class="vl-btn vl-cc${captions ? ' on' : ''}" data-vl-act="cc" aria-pressed="${captions}" title="${esc(T('vlCaptions'))} (C)">CC</button>
            <button class="vl-btn" data-vl-act="full" aria-label="${esc(T('vlFull'))}" title="${esc(T('vlFull'))} (F)">&#x26F6;</button>
          </div>
        </div>
        <div class="vl-checkpoint" data-vl-check hidden></div>
        <div class="vl-panel" data-vl-panel hidden></div>
      </div>
      <div class="vl-revbar" data-vl-revbar hidden></div>
      <div class="vl-weak" data-vl-weak${weakSlides(l).length ? '' : ' hidden'}>${weakHtml(l)}</div>
      <div class="vl-notice" data-vl-notice role="alert" ${noVoice ? '' : 'hidden'}>${noticeHtml()}</div>
      <p class="vl-note" data-vl-silentnote ${ttsOk() && !silent ? 'hidden' : ''}>${T('vlNoTtsPlayer')}</p>
      <ol class="vl-outline">${l.slides.map((s, i) => `<li><button class="vl-outline-item" data-vl-go="${i}">${esc(s.title)}</button></li>`).join('')}</ol>
      <div class="vl-foot">
        <button class="btn-ghost" data-vl-act="print">&#128438; ${T('vlPrint')}</button>
        <button class="btn-ghost" data-vl-act="copy">${T('vlCopyScript')}</button>
      </div>
      <p class="vl-note">${T('vlVideoNote')}</p>
    </div>`;
    showSlide(0);
    syncControls();
    drawPanel();
  }

  // ----- Panels over the player, voice notice, revised-slide bar -----

  function chips(map, labels, attr) {
    return Object.keys(map).map(k => `<button class="vl-chip" ${attr}="${k}">${esc(i18n.t(labels[k]))}</button>`).join('');
  }

  function panelHtml() {
    const T = i18n.t;
    const l = lesson();
    if (panelBusy) {
      return `<div class="vl-panel-busy" role="status"><span class="vl-spin" aria-hidden="true"></span><span>${T(panel === 'version' ? 'vlPerMaking' : 'vlFixing')}</span>
        <button class="btn-ghost" data-vl-act="panel-cancel">${T('vlCancel')}</button></div>`;
    }
    if (panelErr) {
      return `<p class="vl-panel-error" role="alert">${esc(panelErr)}</p>
        <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="panel-retry">${T('vlRetry')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
    }
    if (panel === 'voice') {
      const lang = (l && lessonLang(l)) || (i18n.getLang() === 'tr' ? 'tr' : 'en');
      const list = TTS.voicesForLang(lang), saved = TTS.savedVoiceFor(lang);
      const none = !list.length && TTS.missingVoice(lang);
      const natural = TTS.naturalOn();
      return `<h4 class="vl-panel-title" tabindex="-1">${T('vlVoiceBtn')}</h4>
        <label class="vl-check"><input type="checkbox" data-vl-natural${natural ? ' checked' : ''}> ${T('vlNatural')}</label>
        <p class="vl-note">${T('vlNaturalNote')}</p>
        ${natural ? `<label class="vl-label" for="vl-nvoice">${T('vlNaturalVoice')}</label>
        <select id="vl-nvoice" class="editor-input" data-vl-nvoice>${TTS.NVOICES.map(v => `<option value="${v}"${TTS.naturalVoice() === v ? ' selected' : ''}>${v}</option>`).join('')}</select>` : ''}
        <label class="vl-label" for="vl-voice">${natural ? T('vlVoiceDevice') : T('vlVoice')}</label>
        <select id="vl-voice" class="editor-input" data-vl-voice="${lang}"${none ? ' disabled' : ''}>
          <option value="">${esc(T('vlVoiceAuto'))}</option>
          ${list.map(v => `<option value="${esc(v.voiceURI)}"${saved && saved.voiceURI === v.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
        </select>
        ${none ? `<p class="vl-note">${esc(T('vlVoiceNone', { lang: T(lang === 'tr' ? 'ttsLangTr' : 'ttsLangEn') }))}</p>` : ''}
        <label class="vl-label" for="vl-speed">${T('vlVoiceSpeed')}: <output data-vl-speed-out>${rate}&times;</output></label>
        <input id="vl-speed" class="vl-speed" type="range" min="0.75" max="1.25" step="0.05" value="${Math.min(1.25, Math.max(0.75, rate))}" data-vl-speed>
        <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="voice-test">&#128266; ${T('vlVoiceTest')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
    }
    if (panel === 'version') {
      return `<h4 class="vl-panel-title" tabindex="-1">&#128257; ${T('vlAnother')}</h4>
        <div class="vl-chips">${chips(PERSP_PROMPT, PERSP_LABEL, 'data-vl-persp')}</div>
        <label class="vl-label" for="vl-persp-text">${T('vlPerText')}</label>
        <textarea id="vl-persp-text" class="editor-input" rows="2" maxlength="300" placeholder="${esc(T('vlPerHolder'))}"></textarea>
        <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="persp-go">${T('vlPerGo')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
    }
    return `<h4 class="vl-panel-title" tabindex="-1">${T('vlHelpTitle')}</h4>
      <div class="vl-chips">${chips(FIX_PROMPT, FIX_LABEL, 'data-vl-fix')}</div>
      <label class="vl-label" for="vl-fix-text">${T('vlFixText')}</label>
      <textarea id="vl-fix-text" class="editor-input" rows="2" maxlength="300" placeholder="${esc(T('vlFixHolder'))}"></textarea>
      <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="fix-go">${T('vlFixGo')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
  }

  function drawPanel() {
    const el = host && host.querySelector('[data-vl-panel]');
    if (!el) return;
    el.hidden = !panel;
    el.innerHTML = panel ? panelHtml() : '';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', i18n.t(panel === 'version' ? 'vlAnother' : panel === 'voice' ? 'vlVoiceBtn' : 'vlHelpTitle'));
    const focus = el.querySelector('.vl-panel-title, .vl-panel-error, .vl-panel-busy button');
    if (panel && focus) focus.focus({ preventScroll: true });
  }

  function openPanel(kind) {
    if (panel === kind) { closePanel(); return; }
    if (kind === 'help' || kind === 'voice') pause();
    reqToken++;
    panel = kind;
    panelBusy = false;
    panelErr = '';
    drawPanel();
  }

  // Closing (or cancelling) drops a running AI request: its answer is ignored.
  function closePanel() {
    reqToken++;
    panel = null;
    panelBusy = false;
    panelErr = '';
    drawPanel();
    const p = host && host.querySelector('[data-vl-player]');
    if (p) p.focus({ preventScroll: true });
  }

  function noticeHtml() {
    if (!noVoice) return '';
    const T = i18n.t;
    const name = T(noVoice === 'tr' ? 'ttsLangTr' : 'ttsLangEn');
    return `<strong>${esc(T('vlNoVoiceTitle', { lang: name }))}</strong>
      <p>${esc(T('vlNoVoiceHow', { lang: name }))}</p>
      <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="silent">${T('vlSilent')}</button><button class="btn-ghost" data-vl-act="recheck">${T('vlRecheck')}</button></div>`;
  }

  // ----- "Did you get this?" checkpoints -----
  // A slide with a `check` question pauses the lesson after its narration. The
  // student answers (or skips), may ask for the slide to be explained again or
  // type a question, then continues. Slides answered right or skipped are not
  // asked again on replay; wrong and "lost" ones are.

  const needsCheck = (l, i) => !!l.slides[i].check && !['right', 'skipped'].includes((l.checks || {})[i]);

  function saveCheck(l, i, result) {
    l.checks = { ...(l.checks || {}), [i]: result };
    App.persistActiveDeck();
    drawWeak();
  }

  function drawCheckpoint() {
    const el = host && host.querySelector('[data-vl-check]');
    if (!el) return;
    const l = lesson();
    const c = checkpoint && l && l.slides[checkpoint.i] && view(l, checkpoint.i).check;
    if (!c) { el.hidden = true; el.innerHTML = ''; return; }
    const T = i18n.t;
    const answered = checkpoint.picked !== null;
    const ok = checkpoint.picked === c.correct;
    el.innerHTML = `<div class="vl-check-card" role="group" aria-labelledby="vl-check-title">
      <strong class="vl-check-title" id="vl-check-title">&#9995; ${T('vlCheckTitle')}</strong>
      <p class="vl-check-q">${esc(c.q)}</p>
      <div class="vl-opts">${c.options.map((o, k) => {
        const state = !answered ? '' : k === c.correct ? ' right' : k === checkpoint.picked ? ' wrong' : '';
        return `<button class="vl-opt${state}" data-vl-opt="${k}"${answered ? ' disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>
      ${answered ? `<p class="vl-check-why" role="status"><strong>${ok ? '&#9989; ' + T('vlCheckRight') : '&#10060; ' + T('vlCheckWrong')}</strong> ${esc(c.why)}</p>` : ''}
      <div class="vl-check-actions">
        ${answered ? `<button class="btn-primary" data-vl-act="check-next">${T('vlCheckNext')}</button>` : `<button class="btn-ghost" data-vl-act="check-skip">${T('vlCheckGot')}</button>`}
        <button class="btn-ghost" data-vl-act="check-again">&#128257; ${T('vlCheckAgain')}</button>
        <button class="btn-ghost" data-vl-act="check-ask">&#128172; ${T('vlCheckAsk')}</button>
      </div></div>`;
    el.hidden = false;
    if (!answered) el.scrollIntoView({ block: 'nearest' });
  }

  function openCheckpoint(i) {
    pause();
    checkpoint = { i, picked: null };
    drawCheckpoint();
  }

  function hideCheckpoint() {
    if (!checkpoint) return;
    checkpoint = null;
    drawCheckpoint();
  }

  function pickOption(k) {
    const l = lesson();
    if (!checkpoint || checkpoint.picked !== null || !l) return;
    const c = view(l, checkpoint.i).check;
    if (!c || !c.options[k]) return;
    checkpoint.picked = k;
    saveCheck(l, checkpoint.i, k === c.correct ? 'right' : 'wrong');
    drawCheckpoint();
  }

  // Close the card and go on with the next slide (skipping counts as "I got it").
  function continueAfterCheck() {
    const l = lesson();
    if (!checkpoint || !l) return;
    const i = checkpoint.i;
    if (checkpoint.picked === null) saveCheck(l, i, 'skipped');
    hideCheckpoint();
    if (i >= l.slides.length - 1) { ended = true; elapsed = duration(l.slides[i]) * 1000; syncControls(); drawProgress(); return; }
    go(i + 1);
    play();
  }

  // "Explain it again": the slide is rewritten more simply, played, and checked again.
  function explainAgain() {
    const l = lesson();
    if (!checkpoint || !l) return;
    saveCheck(l, checkpoint.i, 'lost');
    hideCheckpoint();
    panel = 'help';
    panelBusy = false;
    panelErr = '';
    drawPanel();
    rewriteSlide('simple', '');
  }

  function askAboutSlide() {
    hideCheckpoint();
    openPanel('help');
  }

  // ----- Weak spots: slides answered wrong or marked "lost" become practice -----

  // Slide indexes the student found hard (they still carry their question).
  function weakSlides(l) {
    return Object.keys(l.checks || {}).filter(k => ['wrong', 'lost'].includes(l.checks[k]) && l.slides[+k] && l.slides[+k].check).map(Number).sort((a, b) => a - b);
  }

  function weakHtml(l) {
    const w = l ? weakSlides(l) : [];
    if (!w.length) return '';
    const T = i18n.t;
    return `<span class="vl-weak-text">&#127919; ${T('vlWeakTitle', { n: w.length })}</span>
      <button class="btn-primary" data-vl-act="weak-practice">${T('vlWeakGo')}</button>`;
  }

  function drawWeak() {
    const el = host && host.querySelector('[data-vl-weak]');
    if (!el) return;
    el.innerHTML = weakHtml(lesson());
    el.hidden = !el.innerHTML;
  }

  // One flashcard and one multiple-choice question per weak slide, then a quiz on them.
  function practiseWeak() {
    const l = lesson();
    if (!l) return;
    const T = i18n.t;
    const w = weakSlides(l);
    if (!w.length) return;
    const data = App.getStudyData();
    const have = new Set((data.flashcards || []).map(c => c.front));
    const cat = l.topic || l.title;
    const cards = [], qs = [];
    w.forEach(i => {
      const c = l.slides[i].check;
      if (!have.has(c.q)) cards.push({ front: c.q, back: [c.options[c.correct], c.why].filter(Boolean).join(' — '), difficulty: 'medium', category: cat });
      qs.push({ type: 'multiple-choice', question: c.q, options: c.options.slice(), correct: c.correct, explanation: c.why || c.options[c.correct], difficulty: 'medium', category: cat, src: 'lesson-check' });
    });
    if (cards.length) Flashcards.addCards(cards);
    Quiz.addQuestions(qs);
    App.showToast(T('vlWeakAdded', { c: cards.length, q: qs.length }), 'success');
    App.switchTab('quiz');
    Quiz.startQuiz(qs);
  }

  // "Preparing voice…" next to the controls while a natural-voice clip downloads.
  function setVoiceBusy(on) {
    voiceWait = !!on;
    const el = host && host.querySelector('[data-vl-voicestatus]');
    if (el) el.textContent = on ? i18n.t('vlVoiceLoading') : '';
    const p = host && host.querySelector('[data-vl-player]');
    if (p) p.classList.toggle('voice-loading', !!on);
  }

  function drawNotice() {
    const el = host && host.querySelector('[data-vl-notice]');
    if (!el) return;
    el.hidden = !noVoice;
    el.innerHTML = noticeHtml();
  }

  function syncRevbar() {
    const l = lesson();
    const el = host && host.querySelector('[data-vl-revbar]');
    if (!l || !el) return;
    const T = i18n.t;
    const revised = !!l.slides[index].orig;
    el.hidden = !revised;
    el.innerHTML = revised ? `<span>&#9998; ${T('vlRevised')}</span>
      <button class="btn-ghost" data-vl-act="orig" aria-pressed="${showOrig}">${T(showOrig ? 'vlShowRevised' : 'vlShowOrig')}</button>
      <button class="btn-ghost" data-vl-act="undo">&#8630; ${T('vlUndo')}</button>` : '';
  }

  function slideHtml(data, s, i, n) {
    let diagram = '';
    if (s.diagram && s.diagram.kind === 'notes') {
      const g = ((data.notes && data.notes.diagrams) || [])[s.diagram.index];
      if (g && typeof Notes !== 'undefined' && Notes.renderDiagram) diagram = Notes.renderDiagram(g);
    } else if (s.diagram && s.diagram.kind === 'map') {
      diagram = branchSvg(data, s.diagram.label);
    }
    const kind = i === 0 ? ' vl-cover' : diagram ? ' vl-has-diagram' : '';
    return `<div class="vl-slide-inner${kind}">
      <span class="vl-slide-num">${i + 1} / ${n}</span>
      <div class="vl-text">
        <h2 class="vl-slide-title">${esc(s.title)}</h2>
        ${s.bullets.length ? `<ul class="vl-bullets">${s.bullets.map((b, k) => `<li style="--d:${k}">${esc(b)}</li>`).join('')}</ul>` : ''}
        ${s.formula ? `<div class="vl-formula">${esc('$$' + s.formula + '$$')}</div>` : ''}
      </div>
      ${diagram ? `<div class="vl-diagram">${diagram}</div>` : ''}
    </div>`;
  }

  // A mind-map branch as a small radial diagram.
  function branchSvg(data, label) {
    const tree = mapTree(data);
    if (!tree) return '';
    const want = String(label).trim().toLowerCase();
    let node = null;
    const q = [[tree, 0]];
    while (q.length && !node) {
      const [n, d] = q.shift();
      if (String(n.label).trim().toLowerCase() === want) node = n;
      else if (d < 3) (n.children || []).forEach(c => q.push([c, d + 1]));
    }
    if (!node) return '';
    const kids = (node.children || []).slice(0, 6);
    const short = (s, k) => { s = String(s || '').replace(/\$+|\\[a-zA-Z]+|[{}_^]/g, '').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
    const CX = 300, CY = 170;
    let lines = '', nodes = '';
    kids.forEach((c, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(kids.length, 1);
      const x = CX + Math.cos(a) * 205, y = CY + Math.sin(a) * 118;
      lines += `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="vl-br-line"/>`;
      nodes += `<g class="vl-br-kid"><rect x="${(x - 82).toFixed(1)}" y="${(y - 18).toFixed(1)}" width="164" height="36" rx="18"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle">${esc(short(c.label, 22))}</text></g>`;
    });
    return `<svg class="vl-branch" viewBox="0 0 600 340" role="img" aria-label="${esc(node.label)}">${lines}${nodes}
      <g class="vl-br-root"><rect x="${CX - 100}" y="${CY - 24}" width="200" height="48" rx="24"/><text x="${CX}" y="${CY + 6}" text-anchor="middle">${esc(short(node.label, 24))}</text></g></svg>`;
  }

  // Swap the slide on the stage with a directional transition.
  function showSlide(dir) {
    const l = lesson(), data = App.getStudyData();
    const stage = host && host.querySelector('[data-vl-stage]');
    if (!l || !stage) return;
    const s = view(l, index);
    heardFrac = null;
    const el = document.createElement('div');
    el.className = 'vl-slide' + (dir > 0 ? ' from-right' : dir < 0 ? ' from-left' : '');
    el.dataset.vlSlide = String(index);
    el.innerHTML = slideHtml(data, s, index, l.slides.length);
    stage.querySelectorAll('.vl-slide').forEach(old => {
      if (old.classList.contains('leaving')) { old.remove(); return; }
      old.classList.add('leaving', dir < 0 ? 'to-right' : 'to-left');
      setTimeout(() => old.remove(), 500);
    });
    stage.insertBefore(el, stage.querySelector('[data-vl-caption]'));
    void el.offsetWidth;
    el.classList.add('in');
    capChunks = captionChunks(s.narration);
    capShown = -1;
    const count = host.querySelector('[data-vl-count]');
    if (count) count.textContent = `${index + 1} / ${l.slides.length}`;
    host.querySelectorAll('.vl-mark, .vl-outline-item').forEach(b => b.classList.toggle('current', +b.dataset.vlGo === index));
    host.querySelectorAll('.vl-mark').forEach(b => b.classList.toggle('past', +b.dataset.vlGo < index));
    const seek = host.querySelector('[data-vl-seek]');
    if (seek) seek.setAttribute('aria-valuenow', String(index + 1));
    elapsed = 0;
    ended = false;
    slideStart = performance.now();
    syncRevbar();
    drawProgress();
  }

  function syncControls() {
    if (!host) return;
    const T = i18n.t;
    const b = host.querySelector('[data-vl-act="toggle"]');
    if (b) {
      b.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
      b.setAttribute('aria-label', playing ? T('vlPause') : T('vlPlay'));
      b.title = (playing ? T('vlPause') : T('vlPlay')) + ' (Space)';
    }
    const p = host.querySelector('[data-vl-player]');
    if (p) p.classList.toggle('playing', playing);
  }

  function drawProgress() {
    const l = lesson();
    const fill = host && host.querySelector('[data-vl-fill]');
    if (!l || !fill) return;
    const total = l.slides.reduce((s, x) => s + duration(x), 0);
    const before = l.slides.slice(0, index).reduce((s, x) => s + duration(x), 0);
    const spent = (elapsed + (playing ? performance.now() - slideStart : 0)) / 1000;
    // The voice's real position when it reports one (it speaks slower or faster than the estimate); otherwise the estimate.
    const heard = playing && ttsOk() ? TTS.progress() : null;
    if (heard !== null) heardFrac = heard;
    // While the first clip downloads nothing has been said yet: hold at the start instead of racing ahead.
    const within = ended ? duration(l.slides[index]) : heardFrac !== null ? heardFrac * duration(l.slides[index]) : voiceWait ? 0 : Math.min(spent, duration(l.slides[index]) * 0.97);
    fill.style.width = ((before + within) / total * 100).toFixed(2) + '%';
    // Captions follow the narration, one sentence group at a time.
    const frac = ended ? 1 : heardFrac !== null ? heardFrac : within / duration(l.slides[index]);
    // (frac is 0 while waiting for the voice, so the first caption stays up.)
    let i = 0;
    while (i < capChunks.length - 1 && capChunks[i].end < frac) i++;
    if (i !== capShown) {
      capShown = i;
      const cap = host.querySelector('[data-vl-caption]');
      if (cap) cap.textContent = capChunks[i] ? capChunks[i].text : '';
    }
  }

  // Narration split into caption-sized pieces with their share of the time.
  function captionChunks(text) {
    const parts = String(text || '').replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*\s*/g) || [String(text || '')];
    const out = [];
    let cur = '';
    parts.forEach(p => {
      if (cur && (cur + p).length > 130) { out.push(cur.trim()); cur = ''; }
      cur += p;
    });
    if (cur.trim()) out.push(cur.trim());
    const total = out.reduce((n, c) => n + c.length, 0) || 1;
    let acc = 0;
    return out.map(c => { acc += c.length; return { text: c, end: acc / total }; });
  }

  function progressLoop() {
    cancelAnimationFrame(progRaf);
    const tick = () => {
      if (!playing) return;
      if (!host || !host.isConnected || host.offsetParent === null) { pause(); return; }
      drawProgress();
      progRaf = requestAnimationFrame(tick);
    };
    progRaf = requestAnimationFrame(tick);
  }

  // ----- Playback -----

  function speakCurrent() {
    const l = lesson();
    if (!l) return;
    const my = ++token;
    clearTimeout(timer);
    slideStart = performance.now();
    elapsed = 0;
    heardFrac = null;
    const s = view(l, index);
    const done = () => {
      if (my !== token || !playing) return;
      // A slide with a question stops here until the student answers.
      if (needsCheck(l, index)) { openCheckpoint(index); return; }
      // Short beat between slides, then the next one.
      timer = setTimeout(() => {
        if (my !== token || !playing) return;
        if (index < l.slides.length - 1) go(index + 1);
        else { playing = false; ended = true; elapsed = duration(s) * 1000; syncControls(); drawProgress(); }
      }, 450);
    };
    if (ttsOk() && !silent) {
      // The narration is spoken in the language of the lesson, whatever the app language.
      if (noVoice) { noVoice = ''; drawNotice(); }
      let heard = false;
      TTS.speak(s.narration, cancelled => {
        setVoiceBusy(false);
        if (my !== token) return;
        if (cancelled) { playing = false; syncControls(); return; }
        done();
      }, {
        rate, lang: lessonLang(l), natural: true,
        onNoVoice: lang => { playing = false; noVoice = lang; syncControls(); drawNotice(); },
        onLoading: on => {
          if (my !== token) return;
          setVoiceBusy(on);
          // The slide's clock starts when its audio does, not while the clip downloads.
          if (!on && !heard) { heard = true; slideStart = performance.now(); elapsed = 0; }
        }
      });
      // Have the next slide's audio ready so the lesson does not stall between slides.
      if (index < l.slides.length - 1) TTS.prefetch(view(l, index + 1).narration, { lang: lessonLang(l) });
    } else {
      // No speech: advance on the estimated reading time.
      timer = setTimeout(done, duration(s) * 1000);
    }
  }

  function play() {
    const l = lesson();
    if (!l) return;
    if (checkpoint) { continueAfterCheck(); return; } // pressing play on the question card skips it
    if (playing) return;
    if (ended) { index = 0; showSlide(-1); }
    playing = true;
    syncControls();
    speakCurrent();
    progressLoop();
  }

  function pause() {
    if (!playing) return;
    token++;
    clearTimeout(timer);
    elapsed += performance.now() - slideStart;
    playing = false;
    if (ttsOk()) TTS.stop();
    syncControls();
    drawProgress();
  }

  function go(i) {
    const l = lesson();
    if (!l) return;
    hideCheckpoint();
    const to = Math.max(0, Math.min(l.slides.length - 1, i));
    const dir = to > index ? 1 : to < index ? -1 : 0;
    token++;
    clearTimeout(timer);
    if (playing && ttsOk()) TTS.stop();
    index = to;
    showOrig = false;
    showSlide(dir);
    if (playing) speakCurrent();
  }

  function stop() {
    cancelAnimationFrame(progRaf);
    clearTimeout(timer);
    hideCheckpoint();
    if (!playing) return;
    token++;
    playing = false;
    if (ttsOk()) TTS.stop();
    syncControls();
  }

  function toggleFull() {
    const p = host && host.querySelector('[data-vl-player]');
    if (!p) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (p.requestFullscreen) p.requestFullscreen().catch(() => {});
  }

  // ----- Export -----

  async function printSlides() {
    const l = lesson(), data = App.getStudyData();
    if (!l || !data) return;
    const T = i18n.t;
    const w = window.open('', '_blank');
    if (!w) { App.showToast(T('vlPopup'), 'error'); return; }
    // Typeset formulas here first, then copy the result into the print window.
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px';
    tmp.innerHTML = l.slides.map((s, i) => `<section class="page">${slideHtml(data, s, i, l.slides.length)}<div class="say"><strong>${esc(T('vlNarration'))}:</strong> ${esc(s.narration)}</div></section>`).join('');
    document.body.appendChild(tmp);
    try { if (typeof MathRender !== 'undefined') await MathRender.typeset(tmp); } catch (e) {}
    const body = tmp.innerHTML;
    tmp.remove();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(l.title)} — FlashMind</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; margin: 24px; }
        h1 { color: #7c3aed; font-size: 22px; }
        .page { border: 1px solid #ddd; border-radius: 10px; padding: 22px 26px; margin: 0 0 18px; page-break-inside: avoid; break-inside: avoid; }
        .vl-slide-num { font-size: 12px; color: #888; }
        .vl-slide-title { color: #5b21b6; margin: 4px 0 10px; font-size: 22px; }
        .vl-bullets { margin: 0 0 10px 18px; padding: 0; } .vl-bullets li { margin: 4px 0; }
        .vl-formula { font-size: 18px; margin: 10px 0; }
        .vl-diagram svg { max-width: 100%; height: auto; max-height: 260px; display: block; margin: 8px auto; }
        .diagram-title { font-size: 14px; } .diagram-description { font-size: 12px; color: #666; }
        .vl-branch line { stroke: #999; } .vl-branch rect { fill: #f5f3ff; stroke: #7c3aed; } .vl-branch text { fill: #1a1a2e; font-size: 13px; }
        .diagram-svg text { fill: #1a1a2e; }
        .say { margin-top: 12px; padding-top: 10px; border-top: 1px dashed #ccc; font-size: 13px; color: #444; line-height: 1.5; }
        @media print { body { margin: 10mm; } }
      </style></head><body><h1>${esc(l.title)}</h1>${body}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 600);
  }

  function copyScript() {
    const l = lesson();
    if (!l) return;
    const text = l.title + '\n\n' + l.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.narration}`).join('\n\n');
    navigator.clipboard.writeText(text)
      .then(() => App.showToast(i18n.t('vlCopied'), 'success'))
      .catch(() => App.showToast(i18n.t('failedCopy'), 'error'));
  }

  function refresh() {
    const data = App.getStudyData();
    if (data && host && host.isConnected) render(null, data);
  }

  // ----- Events -----

  function playerVisible() {
    return mode === 'player' && host && host.isConnected && host.offsetParent !== null && !!host.querySelector('[data-vl-player]');
  }

  function init() {
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      const open = e.target.closest('[data-vl-open]');
      if (open) { stop(); resetUi(); lessonId = open.dataset.vlOpen; mode = 'player'; index = 0; refresh(); return; }
      const del = e.target.closest('[data-vl-del]');
      if (del) {
        const data = App.getStudyData();
        if (!data || !confirm(i18n.t('vlDeleteConfirm'))) return;
        data.lessons = (data.lessons || []).filter(l => l.id !== del.dataset.vlDel);
        if (!data.lessons.length) delete data.lessons;
        App.persistActiveDeck();
        refresh();
        return;
      }
      const opt = e.target.closest('[data-vl-opt]');
      if (opt) { pickOption(+opt.dataset.vlOpt); return; }
      const fix = e.target.closest('[data-vl-fix]');
      if (fix) { rewriteSlide(fix.dataset.vlFix, panelText('#vl-fix-text')); return; }
      const persp = e.target.closest('[data-vl-persp]');
      if (persp) { makeVersion(persp.dataset.vlPersp, panelText('#vl-persp-text')); return; }
      const goBtn = e.target.closest('[data-vl-go]');
      if (goBtn) { go(+goBtn.dataset.vlGo); return; }
      const seek = e.target.closest('[data-vl-seek]');
      if (seek) {
        const l = lesson();
        const r = seek.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const total = l.slides.reduce((s, x) => s + duration(x), 0);
        let acc = 0, i = 0;
        for (; i < l.slides.length - 1; i++) { acc += duration(l.slides[i]); if (acc / total > f) break; }
        go(i);
        return;
      }
      const btn = e.target.closest('[data-vl-act]');
      if (!btn) return;
      const act = btn.dataset.vlAct;
      if (act === 'toggle') playing ? pause() : play();
      else if (act === 'next') go(index + 1);
      else if (act === 'prev') go(index - 1);
      else if (act === 'rate') {
        setRate(RATES.find(r => r > rate + 0.001) || RATES[0]);
        if (playing) { if (ttsOk()) { token++; TTS.stop(); } speakCurrent(); }
      }
      else if (act === 'cc') setCaptions(!captions);
      else if (act === 'full') toggleFull();
      else if (act === 'list') { stop(); resetUi(); mode = 'list'; refresh(); }
      else if (act === 'help') openPanel('help');
      else if (act === 'version') openPanel('version');
      else if (act === 'voice') openPanel('voice');
      else if (act === 'panel-close' || act === 'panel-cancel') closePanel();
      else if (act === 'panel-retry') { if (lastReq && lastReq.kind === 'version') makeVersion(lastReq.choice, lastReq.text); else if (lastReq) rewriteSlide(lastReq.choice, lastReq.text); }
      else if (act === 'fix-go') rewriteSlide('', panelText('#vl-fix-text'));
      else if (act === 'check-next' || act === 'check-skip') continueAfterCheck();
      else if (act === 'check-again') explainAgain();
      else if (act === 'check-ask') askAboutSlide();
      else if (act === 'weak-practice') practiseWeak();
      else if (act === 'persp-go') {
        const text = panelText('#vl-persp-text');
        if (text) makeVersion('', text); else host.querySelector('#vl-persp-text').focus();
      }
      else if (act === 'voice-test') testVoice();
      else if (act === 'orig') { showOrig = !showOrig; if (playing) pause(); showSlide(0); }
      else if (act === 'undo') undoRevision();
      else if (act === 'silent') { silent = true; noVoice = ''; drawNotice(); host.querySelector('[data-vl-silentnote]').hidden = false; play(); }
      else if (act === 'recheck') { noVoice = ''; drawNotice(); play(); }
      else if (act === 'print') printSlides();
      else if (act === 'copy') copyScript();
      else if (act === 'quick') {
        const data = App.getStudyData();
        const sel = host.querySelector('#vl-topic');
        const idx = sel && sel.value !== '' ? parseInt(sel.value, 10) : null;
        const l = data && fromNotes(data, idx);
        if (!l) { App.showToast(i18n.t('vlInvalid'), 'error'); return; }
        save(data, l);
        refresh();
      }
      else if (act === 'generate') {
        const sel = host.querySelector('#vl-topic'), f = host.querySelector('#vl-focus');
        generate(sel && sel.value !== '' ? parseInt(sel.value, 10) : null, f ? f.value.trim().slice(0, 200) : '');
      }
    });
    document.addEventListener('change', e => {
      if (!host || !host.contains(e.target)) return;
      if (e.target.matches('[data-vl-version]')) {
        stop();
        resetUi();
        lessonId = e.target.value;
        index = 0;
        refresh();
      } else if (e.target.matches('[data-vl-voice]')) {
        const lang = e.target.dataset.vlVoice;
        TTS.setVoice(lang, TTS.voicesForLang(lang).find(v => v.voiceURI === e.target.value) || null);
      } else if (e.target.matches('[data-vl-natural]')) {
        TTS.setNatural(e.target.checked);
        drawPanel();
      } else if (e.target.matches('[data-vl-nvoice]')) {
        TTS.setNaturalVoice(e.target.value);
      }
    });
    document.addEventListener('input', e => {
      if (!host || !host.contains(e.target) || !e.target.matches('[data-vl-speed]')) return;
      setRate(parseFloat(e.target.value));
    });
    document.addEventListener('keydown', e => {
      if (!playerVisible() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && panel) { closePanel(); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (document.querySelector('.shortcuts-backdrop[style*="flex"]')) return;
      const k = e.key;
      if (panel || checkpoint) return;
      if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); playing ? pause() : play(); }
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') { e.preventDefault(); go(index + 1); }
      else if (k === 'ArrowLeft' || k === 'j' || k === 'J') { e.preventDefault(); go(index - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(Infinity); }
      else if (k === 'c' || k === 'C') setCaptions(!captions);
      else if (k === 'f' || k === 'F') toggleFull();
      else if (k === 'h' || k === 'H') openPanel('help');
    });
  }

  function panelText(sel) {
    const el = host && host.querySelector(sel);
    return el ? el.value.trim().slice(0, 300) : '';
  }

  function setRate(r) {
    rate = r;
    try { localStorage.setItem('flashmind_video_rate', String(rate)); } catch (err) {}
    if (!host) return;
    const b = host.querySelector('[data-vl-act="rate"]');
    if (b) b.innerHTML = rate + '&times;';
    const out = host.querySelector('[data-vl-speed-out]');
    if (out) out.innerHTML = rate + '&times;';
  }

  // Speaks a short sample with the chosen voice and speed, in the lesson's language.
  function testVoice() {
    const l = lesson();
    if (!l || !ttsOk()) return;
    pause();
    const lang = lessonLang(l) || (i18n.getLang() === 'tr' ? 'tr' : 'en');
    TTS.speak(lang === 'tr' ? 'Merhaba! Ders anlatımı bu sesle okunacak. Beni net anlayabiliyor musun?' : 'Hello! The lesson will be read with this voice. Can you hear me clearly?', () => setVoiceBusy(false), { rate, lang, natural: true, onLoading: setVoiceBusy });
  }

  // Forget panels, notices and "show original" when leaving a lesson.
  function resetUi() {
    reqToken++;
    checkpoint = null;
    panel = null;
    panelBusy = false;
    panelErr = '';
    noVoice = '';
    silent = false; // "continue silently" applies to the lesson the student chose it in
    showOrig = false;
  }

  function setCaptions(on) {
    captions = on;
    try { localStorage.setItem('flashmind_video_cc', on ? '1' : '0'); } catch (err) {}
    const p = host && host.querySelector('[data-vl-player]');
    if (p) p.classList.toggle('cc-on', on);
    const b = host && host.querySelector('[data-vl-act="cc"]');
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }

  return { init, render, stop, fromNotes, isPlaying: () => playing, _index: () => index, _test: { versionsOf, trimLessons, reviseSlide, undoSlide, paragraphSlides, materialFor, prompt, weakSlides } };
})();
