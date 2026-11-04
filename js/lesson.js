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
    story: 'Teach it through a story or an everyday analogy that the whole lesson builds on.',
    eli5: 'Explain it like the student is five: tiny everyday words, comparisons with toys, food, games and sports, one small idea per slide and lots of mini examples. ' +
      'Near the end, connect every idea back to the real terms and formulas of the material, so the student can still answer exam questions with them.',
    gossip: 'Tell it like juicy office gossip: the concepts, substances, numbers or people are coworkers with drama ("you will NOT believe what Oxygen did next..."), ' +
      'spilled as the tea slide by slide, playful and dramatic. Every fact, number and formula must stay exactly correct and each idea must still be clearly taught; ' +
      'keep it school-appropriate (no romance, no insults), and the recap slide states the facts plainly.',
    history: 'Teach it through its history: who worked it out, when and where, what problem they were trying to solve, which experiment or mistake led to the idea, ' +
      'and how it grew into what the student learns today. Use only real people, dates and events you are sure of, never invent them; still teach the method and give worked examples.'
  };
  const PERSP_LABEL = { simple: 'vlPerSimple', examples: 'vlPerExamples', exam: 'vlPerExam', short: 'vlPerShort', steps: 'vlPerSteps', story: 'vlPerStory', eli5: 'vlPerEli5', gossip: 'vlPerGossip', history: 'vlPerHistory' };
  // How new lessons are told by default (chosen on the video page, kept on this device). '' = the standard example-led lesson.
  const STYLE_KEY = 'flashmind_video_style';
  const STYLES = ['', 'examples', 'eli5', 'gossip', 'history', 'story', 'steps', 'exam'];
  function lessonStyle() {
    try { const v = localStorage.getItem(STYLE_KEY) || ''; return STYLES.includes(v) ? v : ''; } catch (e) { return ''; }
  }
  function setLessonStyle(v) {
    try { localStorage.setItem(STYLE_KEY, STYLES.includes(v) ? v : ''); } catch (e) {}
  }
  // How long new lessons are, in minutes (kept on this device). Long lessons are written in parts of about PART_MIN minutes.
  const LENGTH_KEY = 'flashmind_video_minutes';
  const LENGTHS = [10, 20, 30];
  const PART_MIN = 5;
  function lessonMinutes() {
    try { const v = parseInt(localStorage.getItem(LENGTH_KEY), 10); return LENGTHS.includes(v) ? v : 10; } catch (e) { return 10; }
  }
  function setLessonMinutes(v) {
    try { localStorage.setItem(LENGTH_KEY, String(LENGTHS.includes(v) ? v : 10)); } catch (e) {}
  }
  const WPS = 2.6; // spoken words per second at rate 1 (duration estimate)
  let host = null;
  let forData = null;
  let mode = 'list';     // 'list' | 'player'
  let lessonId = null;
  let index = 0;
  let playing = false;
  let ended = false;     // reached the end of the last slide
  let busy = false;
  let busyStep = null;   // { d, t }: AI calls done / total while a long lesson is being written
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
  let startAt = 0;       // where in the current slide (0..1) the narration started: a seek or resume starts at a caption's sentence
  let scrub = null;      // { id } while a finger or mouse button is held on the progress bar
  let heardFrac = null; // how much of the current slide's narration the voice has spoken (null = unknown, estimate)
  let checkpoint = null; // { i, picked } while a "Did you get this?" card is open (picked = chosen option or null)
  let noVoice = '';      // language ('tr'/'en') the text needs but the device has no voice for
  let showOrig = false;  // showing the original of a revised slide
  let panel = null;      // open panel over the player: 'help' | 'version' | 'voice' | 'ask'
  let pendingAsk = '';   // what the student just asked, shown while the answer is on its way
  let askThread = null;  // { i, turns: [{ q, a }] }: the conversation about one check question, kept while its card is open
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
    if (!next.image && old.image) { next.image = old.image; if (old.img) next.img = old.img; }
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
    return SimSpec.sanitizeLesson({ title: slides[0].title, topic: slides[0].title, slides, createdAt: Date.now(), v: LESSON_V });
  }

  function mapTree(data) {
    if (data.notes && data.notes.mindmap) return data.notes.mindmap;
    return typeof Mindmap !== 'undefined' ? Mindmap.fromNotes(data) : null;
  }

  // What the lesson is written from: the notes (the teaching) first, the source text
  // only as a short reference (see material.js).
  const materialFor = (data, sec) => Material.forStudy(data, sec);

  // part (optional): { k, n, outline: [{ title, goals }], minutes } — write only part k of a long lesson planned by planPrompt.
  function prompt(data, topic, focus, style, part) {
    const diagrams = ((data.notes && data.notes.diagrams) || []).map((g, i) => `${i}: ${g.title}`).slice(0, 10);
    const tree = mapTree(data);
    const branches = tree ? (tree.children || []).map(c => c.label).slice(0, 12) : [];
    const what = topic ? `"${topic}"` : 'the main ideas of this study material';
    const first = part && part.k === 0, last = part && part.k === part.n - 1;
    const scope = !part
      ? `Write the storyboard of a narrated video lesson (10-16 slides, about 6-10 minutes) that teaches ${what} to a student revising for an exam. `
      : `Write PART ${part.k + 1} of ${part.n} of a long narrated video lesson (about ${part.minutes} minutes in total) that teaches ${what} to a student revising for an exam. ` +
        `The whole lesson is planned like this: ${part.outline.map((o, j) => `${j + 1}. ${o.title} (${o.goals.join('; ')})`).join(' | ')}. ` +
        `This part covers ONLY part ${part.k + 1}: "${part.outline[part.k].title}". Do not teach what the other parts cover, but you may refer back to earlier parts. ` +
        'This part has 9-12 slides and about 5 minutes of narration (700-850 words in total). ';
    const shape = !part
      ? 'Slide 1 is a title slide with a hook; then build the idea step by step: explain each idea, show a worked example with the numbers, point out the typical mistake, and connect it to everyday life where it fits; the last slide recaps the 3-4 key takeaways. '
      : (first ? 'Slide 1 is the title slide of the whole lesson with a hook, then this part begins. ' : 'No title slide and no welcome: the first slide opens with one sentence that bridges from the previous part, then teaches. ') +
        'Build the idea step by step: explain each idea, show worked examples with the numbers, point out the typical mistakes, and connect it to everyday life where it fits. ' +
        (last ? 'The last slide recaps the 4-6 key takeaways of the WHOLE lesson. ' : 'The last slide sums up this part in 2-3 points (not a recap of the whole lesson). ');
    return scope + Material.SUBJECT_RULE + shape +
      'Examples carry the lesson: every new idea gets at least one concrete example (real numbers, real substances, real situations the student knows), at least half of the slides are built around an example, ' +
      'and a worked example says each step out loud and why it is done. Prefer examples like the ones in the material and in exam questions. ' +
      'Each slide: "title" (max 8 words), "bullets": 1-3 short points (max 12 words each; may be empty on the title slide), optional "formula": one key formula in LaTeX without $ delimiters, ' +
      'optional "diagram" to show an existing picture: ' + (diagrams.length ? `{"kind":"notes","index":N} for one of these notes diagrams [${diagrams.join('; ')}], or ` : '') +
      (branches.length ? `{"kind":"map","label":"..."} for one of these mind-map branches [${branches.join('; ')}]. ` : 'none available. ') +
      'optional "image": a real photo or drawing of the ONE concrete thing this slide is about (a substance, object, apparatus, organism, place, building, person or event you can see), ' +
      '{"wiki":"the exact title of the English Wikipedia article about exactly that thing, e.g. Carbon dioxide, Erlenmeyer flask, Mitochondrion, Marie Curie","alt":"what the picture shows, in the language of the material"}. ' +
      'The article must be about that very thing, not a broader subject (not "Chemistry", not "Mole (unit)" for a calculation). ' +
      'Add an image on at most one slide in three, and NEVER on slides about calculations, formulas, definitions, rules, numbers, steps or exam tips, nor on slides with a "diagram". If unsure, leave it out. ' +
      '"narration": what the teacher says over the slide, spoken like a teacher talking to the student: 3-6 short natural sentences (50-110 words), explaining why and not only what, formulas and symbols said in words (e.g. "x kare", "a bölü b" or "x squared", "a over b"), no markdown, no LaTeX, no symbols. ' +
      (part ? 'On 1-2 slides of this part (never its first or last slide) add "check":' : 'On 2-4 slides in the middle of the lesson (never the first or the last) add "check":') + ' the quick question a teacher asks to see whether the student got THAT slide: ' +
      '{"q":"one clear question","options":["...","...","..."],"correct":0,"why":"one short sentence that explains the right answer"} with 3 options, exactly one correct, plausible wrong ones, and the correct option in varying positions. ' +
      'Write everything in the same language as the material (if it is Turkish, write natural spoken Turkish). ' + (part ? 'At most 12 slides. ' : 'At most 16 slides. ') + (focus ? `Focus especially on: ${focus}. ` : '') +
      (style ? `${style} (this overrides the slide count above). ` : '') +
      'Return ONLY JSON, no other text: {"title":"lesson title","slides":[{"title":"...","bullets":["..."],"formula":"E = mc^2","image":{"wiki":"...","alt":"..."},"narration":"..."}]}';
  }

  // Written from the notes, with "did you get this?" questions (lessons made before this carry no v or v 1).
  const LESSON_V = 3; // 3: longer lessons with real pictures

  // One new lesson for `sec` (or the whole set) of ANY deck's data; no screen involved. Throws on a bad answer.
  // The plan of a long lesson: its title and `n` parts of about PART_MIN minutes, each with what it teaches.
  function planPrompt(topic, focus, style, n, minutes) {
    return `Plan a long narrated video lesson of about ${minutes} minutes that teaches ${topic ? `"${topic}"` : 'the main ideas of this study material'} to a student revising for an exam. ` +
      Material.SUBJECT_RULE +
      `Split it into exactly ${n} parts of about ${PART_MIN} minutes each that build on each other, from the basics up to exam-level questions; ` +
      'together they cover the whole topic without repeating each other. Each part has a short title and 2-4 goals: what it explains and which worked examples it shows. ' +
      'Write in the same language as the material. ' + (focus ? `Focus especially on: ${focus}. ` : '') + (style ? `The lesson will be told like this: ${style} ` : '') +
      'Return ONLY JSON, no other text: {"title":"lesson title","parts":[{"title":"...","goals":["...","..."]}]}';
  }

  // One AI call whose JSON must pass `accept`; an unusable answer or a dropped request gets one more try.
  async function chatJson(question, context, accept) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = accept(Parser.safeParseJSON(await API.chat(question, context)));
        if (out) return out;
        last = new Error(i18n.t('vlInvalid'));
      } catch (err) {
        last = err; // the raw error: callers (refresh.js) recognise rate limits by its message
        if (/429|rate limit|too many/i.test(String(err && err.message))) break; // the limit will not lift in a second
      }
    }
    throw last;
  }

  // Write a new lesson in the chosen style and length. onStep(done, total) before each AI call of a long lesson.
  // `single`: one AI call, a standard-length lesson (used when many lessons are rewritten at once).
  async function write(data, sec, focus, onStep, single) {
    const key = lessonStyle(), style = key ? PERSP_PROMPT[key] : '';
    const minutes = lessonMinutes(), n = Math.max(1, Math.round(minutes / PART_MIN));
    const topic = sec ? sec.title : '';
    const material = materialFor(data, sec);
    const meta = { id: undefined, topic: sec ? sec.title : data.title, createdAt: Date.now(), v: LESSON_V, ...(key ? { label: i18n.t(PERSP_LABEL[key]).slice(0, 60) } : {}) };
    if (single) {
      const one = await chatJson(prompt(data, topic, focus, style), material, o => o && Array.isArray(o.slides) ? o : null);
      const l1 = SimSpec.sanitizeLesson({ ...one, ...meta });
      if (!l1) throw new Error(i18n.t('vlInvalid'));
      return l1;
    }
    if (onStep) onStep(0, n + 1);
    const plan = await chatJson(planPrompt(topic, focus, style, n, minutes), material, o => {
      // The AI wrote the lesson itself instead of a plan: use it rather than fail.
      if (o && !Array.isArray(o.parts) && Array.isArray(o.slides) && o.slides.length >= 2) return { whole: o };
      const parts = o && Array.isArray(o.parts) ? o.parts.filter(x => x && typeof x.title === 'string' && x.title.trim()).map(x => ({
        title: x.title.trim().slice(0, 120), goals: (Array.isArray(x.goals) ? x.goals : []).filter(g => typeof g === 'string').map(g => g.slice(0, 200)).slice(0, 4)
      })) : [];
      return parts.length ? { title: typeof o.title === 'string' ? o.title : '', parts: parts.slice(0, n) } : null;
    });
    if (plan.whole) {
      const lw = SimSpec.sanitizeLesson({ ...plan.whole, ...meta });
      if (!lw) throw new Error(i18n.t('vlInvalid'));
      return lw;
    }
    const slides = [];
    for (let k = 0; k < plan.parts.length; k++) {
      if (onStep) onStep(k + 1, plan.parts.length + 1);
      const part = await chatJson(prompt(data, topic, focus, style, { k, n: plan.parts.length, outline: plan.parts, minutes }), material,
        o => o && Array.isArray(o.slides) && o.slides.filter(x => x && typeof x === 'object').length >= 2 ? o.slides.filter(x => x && typeof x === 'object').slice(0, 14) : null);
      if (plan.parts.length > 1) part[0] = { ...part[0], chapter: plan.parts[k].title };
      slides.push(...part);
    }
    const l = SimSpec.sanitizeLesson({ title: plan.title || (slides[0] && slides[0].title), slides, ...meta });
    if (!l) throw new Error(i18n.t('vlInvalid'));
    return l;
  }

  const outdatedLessons = data => (data.lessons || []).filter(l => (l.v || 1) < LESSON_V);

  // Replaces the lessons written by an older pipeline with one new lesson per topic they covered.
  // Nothing is replaced unless every new lesson was written. onStep(topic) before each AI call.
  async function refreshOld(data, onStep) {
    const old = outdatedLessons(data);
    const topics = [...new Set(old.map(l => l.topic))];
    const made = [];
    for (const topic of topics) {
      if (onStep) onStep(topic);
      made.push(await write(data, (data.notes.sections || []).find(s => s.title === topic), '', null, true));
    }
    const list = (data.lessons || []).filter(l => !old.includes(l));
    made.forEach(l => {
      const ids = new Set(list.map(x => x.id));
      let k = list.length + 1;
      l.id = 'v' + k;
      while (ids.has(l.id)) l.id = 'v' + (++k);
      list.push(l);
    });
    data.lessons = list;
    return { replaced: old.length, made: made.length };
  }

  async function generate(topicIdx, focus) {
    const data = App.getStudyData();
    if (!data || busy) return;
    const sec = Number.isInteger(topicIdx) ? (data.notes.sections || [])[topicIdx] : null;
    busy = true;
    busyStep = null;
    refresh();
    try {
      const l = await write(data, sec, focus, (d, t) => { busyStep = { d, t }; refresh(); });
      if (App.getStudyData() !== data) return;
      save(data, l);
      App.showToast(i18n.t('vlReady'), 'success');
    } catch (err) {
      App.showToast(i18n.t('vlFailed') + ' ' + err.message, 'error');
    } finally {
      busy = false;
      busyStep = null;
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
      'If the student\'s words are about the check question after the slide (it may use a different example), never call it off-topic: make the slide teach what is needed to answer it. ' +
      'Keep it correct and about the same topic. "title" max 8 words, "bullets": 1-3 short points (may be empty), optional "formula": LaTeX without $ delimiters, ' +
      '"narration": spoken like a teacher talking to the student: 2-5 short natural sentences (40-90 words), formulas and symbols said in words, no markdown, no LaTeX. ' +
      'Write it in the same language as the lesson. Return ONLY JSON, no other text: {"title":"...","bullets":["..."],"formula":"","narration":"..."}';
    const chk = l.slides[index].check;
    const context = `Lesson: ${l.title}\n${near(index - 1, 'Previous slide')}Slide to rewrite: ${slide(l.slides[index].orig || l.slides[index])}\n${near(index + 1, 'Next slide')}\n` +
      (chk ? `Check question asked after this slide: ${JSON.stringify({ q: chk.q, options: chk.options, correct: chk.options[chk.correct] })}\n` : '') +
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

  // "I have a question" about the check question itself: the tutor answers in the panel and the question card stays open.
  async function answerCheckQuestion(text) {
    const data = App.getStudyData(), l = lesson();
    const at = checkpoint;
    if (!data || !l || !at || panelBusy) return;
    const c = view(l, at.i).check;
    if (!c) return;
    const my = ++reqToken;
    lastReq = { kind: 'ask', choice: 'question', text };
    if (!askThread || askThread.i !== at.i) askThread = { i: at.i, turns: [] };
    const thread = askThread;
    const earlier = thread.turns.slice(-6);
    panelBusy = true;
    panelErr = '';
    pendingAsk = text;
    drawPanel();
    const s = view(l, at.i);
    const answered = at.picked !== null;
    const question = 'A student watching a narrated video lesson was asked a multiple-choice check question and has a question ABOUT THAT CHECK QUESTION. ' +
      (text ? `The student asks: "${text}". ` : 'The student does not understand the check question. ') +
      (earlier.length ? 'This is a follow-up in the same conversation (see "Conversation so far" in the context): build on your earlier answers, resolve what "it", "that" or "why" refer to from them, and do not repeat what you already said unless asked. ' : '') +
      'Answer the student directly, like a patient teacher: explain what the question is asking and how to work it out step by step. ' +
      'The check question may use a different example than the slide; that is fine, never call it off-topic or tell the student not to mix things up, just help. ' +
      (answered ? 'The student has already answered, so you may name the correct option and explain why. '
        : 'The student has not answered yet: guide them to the method and do not reveal which option is correct unless they explicitly ask for the answer. ') +
      'Max 120 words, plain text, no markdown, formulas written simply (e.g. n = m / M). Write in the same language as the lesson. ' +
      'Return ONLY JSON, no other text: {"answer":"..."}';
    const context = `Lesson: ${l.title}\nSlide: ${JSON.stringify({ title: s.title, bullets: s.bullets, formula: s.formula || '', narration: s.narration })}\n` +
      `Check question: ${JSON.stringify({ q: c.q, options: c.options, correct: c.options[c.correct], why: c.why || '' })}\n` +
      (answered ? `The student picked: ${JSON.stringify(c.options[at.picked])}\n` : '') +
      (earlier.length ? `Conversation so far:\n${earlier.map(t => `Student: ${t.q || '(did not understand the question)'}\nTeacher: ${t.a}`).join('\n')}\n` : '') +
      `Study material:\n${materialFor(data, (data.notes.sections || []).find(x => x.title === l.topic))}`.slice(0, 12000);
    try {
      const out = await askJson(question, context, obj => obj && typeof obj.answer === 'string' && obj.answer.trim() ? obj.answer.trim() : null, my);
      if (!out || my !== reqToken) return;
      panelBusy = false;
      pendingAsk = '';
      thread.turns.push({ q: text, a: out });
      drawPanel();
      const box = host && host.querySelector('.vl-ask-thread');
      if (box) box.scrollTop = box.scrollHeight;
    } catch (err) {
      failPanel(my, err);
    }
  }

  // The 'ask' panel's "Ask" button: about the question (answered here) or about the video (the slide is rewritten).
  function askGo() {
    const about = host && host.querySelector('input[name="vl-ask-about"]:checked');
    const text = panelText('#vl-ask-text');
    if (about && about.value === 'slide') {
      const l = lesson();
      if (checkpoint && l) saveCheck(l, checkpoint.i, 'lost');
      hideCheckpoint();
      panel = 'help';
      rewriteSlide('', text);
    } else {
      answerCheckQuestion(text);
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
        obj => SimSpec.sanitizeLesson({ ...obj, id: undefined, topic: l.topic, base: l.base || l.id, label, createdAt: Date.now(), v: LESSON_V }), my);
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
        <span class="vl-label" id="vl-length-label">${T('vlLength')}</span>
        <div class="vl-chips vl-length" role="radiogroup" aria-labelledby="vl-length-label">${LENGTHS.map(m => `<button class="vl-chip" role="radio" aria-checked="${lessonMinutes() === m}" data-vl-length="${m}" ${busy ? 'disabled' : ''}>${T('vlLengthMin', { n: m })}</button>`).join('')}</div>
        <p class="vl-note">${T('vlLengthNote')}</p>
        <span class="vl-label" id="vl-style-label">${T('vlStyle')}</span>
        <div class="vl-chips vl-style" role="radiogroup" aria-labelledby="vl-style-label">${STYLES.map(k => `<button class="vl-chip" role="radio" aria-checked="${lessonStyle() === k}" data-vl-style="${k}" ${busy ? 'disabled' : ''}>${esc(T(k ? PERSP_LABEL[k] : 'vlStyleStandard'))}</button>`).join('')}</div>
        <div class="vl-new-actions">
          <button class="btn-primary" data-vl-act="generate" ${busy ? 'disabled' : ''}>${busy ? (busyStep ? (busyStep.d === 0 ? T('vlPlanning') : T('vlWritingPart', { k: busyStep.d, n: busyStep.t - 1 })) : T('vlWriting')) : '&#10024; ' + T('vlGenerate')}</button>
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
    const many = l.slides.length > 24; // a long lesson: one mark per part, not per slide
    const marks = l.slides.map((s, i) => {
      const left = acc / total * 100;
      acc += duration(s);
      if (many && i > 0 && !s.chapter) return '';
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
            <div class="vl-preview" data-vl-preview hidden aria-hidden="true">
              <div class="vl-stage vl-preview-stage" data-vl-preview-stage></div>
              <div class="vl-preview-cap" data-vl-preview-cap></div>
              <div class="vl-preview-time" data-vl-preview-time></div>
            </div>
          </div>
          <div class="vl-controls">
            <button class="vl-btn" data-vl-act="prev" aria-label="${esc(T('vlPrev'))}" title="${esc(T('vlPrev'))} (←)">&#9198;</button>
            <button class="vl-btn vl-btn-main" data-vl-act="toggle" aria-label="${esc(T('vlPlay'))}" title="${esc(T('vlPlay'))} (Space)">&#9654;</button>
            <button class="vl-btn" data-vl-act="next" aria-label="${esc(T('vlNext'))}" title="${esc(T('vlNext'))} (→)">&#9197;</button>
            <span class="vl-time" data-vl-time></span>
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
      <p class="vl-note vl-voicenote" data-vl-voicenote role="status" hidden></p>
      <p class="vl-note" data-vl-silentnote ${ttsOk() && !silent ? 'hidden' : ''}>${T('vlNoTtsPlayer')}</p>
      <ol class="vl-outline">${l.slides.map((s, i) => `<li><button class="vl-outline-item" data-vl-go="${i}">${esc(s.title)}</button></li>`).join('')}</ol>
      <div class="vl-foot">
        <button class="btn-ghost" data-vl-act="save-voice">&#11015;&#65039; ${T('vlSaveVoice')}</button>
        <button class="btn-ghost" data-vl-act="print">&#128438; ${T('vlPrint')}</button>
        <button class="btn-ghost" data-vl-act="copy">${T('vlCopyScript')}</button>
      </div>
      <p class="vl-note">${T('vlVideoNote')}</p>
    </div>`;
    showSlide(0);
    syncControls();
    drawPanel();  loadPictures(l);
  }

  // ----- Panels over the player, voice notice, revised-slide bar -----

  function chips(map, labels, attr) {
    return Object.keys(map).map(k => `<button class="vl-chip" ${attr}="${k}">${esc(i18n.t(labels[k]))}</button>`).join('');
  }

  // The questions and answers so far about the open check question (plus the one being asked).
  function askThreadHtml() {
    const T = i18n.t;
    const turns = askThread && checkpoint && askThread.i === checkpoint.i ? askThread.turns : [];
    const rows = turns.map(t => `<p class="vl-ask-q">${esc(t.q || T('vlAskNoText'))}</p><p class="vl-ask-answer">${esc(t.a)}</p>`);
    if (panelBusy && panel === 'ask') rows.push(`<p class="vl-ask-q">${esc(pendingAsk || T('vlAskNoText'))}</p>`);
    return rows.length ? `<div class="vl-ask-thread" role="log" aria-live="polite">${rows.join('')}</div>` : '';
  }

  function panelHtml() {
    const T = i18n.t;
    const l = lesson();
    if (panelBusy) {
      return (panel === 'ask' ? askThreadHtml() : '') + `<div class="vl-panel-busy" role="status"><span class="vl-spin" aria-hidden="true"></span><span>${T(panel === 'version' ? 'vlPerMaking' : panel === 'ask' ? 'vlAskThinking' : 'vlFixing')}</span>
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
    if (panel === 'ask') {
      const thread = askThreadHtml();
      if (thread) {
        return `<h4 class="vl-panel-title" tabindex="-1">&#128172; ${T('vlAskAnswerTitle')}</h4>
        ${thread}
        <label class="vl-label" for="vl-ask-text">${T('vlAskFollow')}</label>
        <textarea id="vl-ask-text" class="editor-input" rows="2" maxlength="300" placeholder="${esc(T('vlAskFollowHolder'))}"></textarea>
        <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="ask-go">${T('vlAskGo')}</button><button class="btn-ghost" data-vl-act="ask-new">${T('vlAskMore')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
      }
      return `<h4 class="vl-panel-title" tabindex="-1">&#128172; ${T('vlAskTitle')}</h4>
        <div class="vl-ask-about" role="radiogroup" aria-label="${esc(T('vlAskAbout'))}">
          <label class="vl-check"><input type="radio" name="vl-ask-about" value="question" checked> ${T('vlAskAboutQuestion')}</label>
          <label class="vl-check"><input type="radio" name="vl-ask-about" value="slide"> ${T('vlAskAboutSlide')}</label>
        </div>
        <label class="vl-label" for="vl-ask-text">${T('vlFixText')}</label>
        <textarea id="vl-ask-text" class="editor-input" rows="2" maxlength="300" placeholder="${esc(T('vlAskHolder'))}"></textarea>
        <div class="vl-panel-actions"><button class="btn-primary" data-vl-act="ask-go">${T('vlAskGo')}</button><button class="btn-ghost" data-vl-act="panel-close">${T('vlClose')}</button></div>`;
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
    el.setAttribute('aria-label', i18n.t(panel === 'version' ? 'vlAnother' : panel === 'voice' ? 'vlVoiceBtn' : panel === 'ask' ? 'vlAskTitle' : 'vlHelpTitle'));
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
    pendingAsk = '';
    drawPanel();
  }

  // Closing (or cancelling) drops a running AI request: its answer is ignored.
  function closePanel() {
    reqToken++;
    panel = null;
    panelBusy = false;
    panelErr = '';
    pendingAsk = '';
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
    startAt = 0; heardFrac = 1; // the narration is over: the bar stays at the end of the slide
    drawProgress();
    checkpoint = { i, picked: null };
    askThread = null; // a new question card starts a new conversation
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
    if (panel === 'ask') closePanel();
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

  // "I have a question": the student says whether it is about the check question or the video.
  // The question card stays open so they can still answer it after reading the reply.
  function askAboutSlide() {
    if (panel === 'ask') { closePanel(); return; }
    openPanel('ask');
    const t = host && host.querySelector('#vl-ask-text');
    if (t) t.focus({ preventScroll: true });
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
  // The slides are marked "practised" so they stop being offered (the coach would otherwise suggest them forever).
  function addPractice(data, items) {
    if (!items.length) return;
    const T = i18n.t;
    const have = new Set((data.flashcards || []).map(c => c.front));
    const cards = [], qs = [];
    items.forEach(({ l, i }) => {
      const c = l.slides[i].check;
      const cat = l.topic || l.title;
      if (!have.has(c.q)) { have.add(c.q); cards.push({ front: c.q, back: [c.options[c.correct], c.why].filter(Boolean).join(' — '), difficulty: 'medium', category: cat }); }
      qs.push({ type: 'multiple-choice', question: c.q, options: c.options.slice(), correct: c.correct, explanation: c.why || c.options[c.correct], difficulty: 'medium', category: cat, src: 'lesson-check' });
      l.checks = { ...l.checks, [i]: 'practised' };
    });
    if (cards.length) Flashcards.addCards(cards);
    Quiz.addQuestions(qs);
    App.persistActiveDeck();
    drawWeak();
    App.showToast(T('vlWeakAdded', { c: cards.length, q: qs.length }), 'success');
    App.switchTab('quiz');
    Quiz.startQuiz(qs);
  }

  // From the lesson's own bar.
  function practiseWeak() {
    const l = lesson();
    if (l) addPractice(App.getStudyData(), weakSlides(l).map(i => ({ l, i })));
  }

  // Every weak slide of every lesson in the open deck (the coach's "fix your weak spots").
  function practiseAllWeak() {
    const data = App.getStudyData();
    if (data) addPractice(data, (data.lessons || []).flatMap(l => weakSlides(l).map(i => ({ l, i }))));
  }

  // A lasting note under the player when the natural voice is not the one speaking, and why.
  function drawVoiceNote(text) {
    const el = host && host.querySelector('[data-vl-voicenote]');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  // Keep this lesson's natural-voice clips on the device so it plays without a connection.
  let savingVoice = false;
  async function saveVoice(btn) {
    const l = lesson();
    const T = i18n.t;
    if (!l || savingVoice) return;
    if (!TTS.naturalOn()) { App.showToast(T('vlSaveNeedsNatural'), 'error'); return; }
    savingVoice = true;
    const label = btn.innerHTML;
    try {
      const r = await TTS.saveForOffline(l.slides.map(s => s.narration), {
        lang: lessonLang(l),
        onProgress: (d, n) => { btn.textContent = T('vlSavingVoice', { d, n }); },
        onWait: s => { btn.textContent = T('vlVoiceWaiting', { s }); }
      });
      App.showToast(T('vlVoiceSaved', { n: r.clips, mb: (r.bytes / 1048576).toFixed(1) }), 'success');
    } catch (err) {
      App.showToast(T('vlSaveVoiceFailed') + ' ' + err.message, 'error');
    } finally {
      savingVoice = false;
      btn.innerHTML = label;
    }
  }

  // "Preparing voice…" next to the controls while a natural-voice clip downloads.
  // `secs` (when the voice service asked us to wait) turns the label into a countdown.
  function setVoiceBusy(on, secs) {
    voiceWait = !!on;
    const el = host && host.querySelector('[data-vl-voicestatus]');
    if (el) el.textContent = on ? (secs ? i18n.t('vlVoiceWaiting', { s: secs }) : i18n.t('vlVoiceLoading')) : '';
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
    const pic = diagram ? '' : figureHtml(s, i);
    const kind = i === 0 && !pic ? ' vl-cover' : diagram || pic ? ' vl-has-diagram' : '';
    return `<div class="vl-slide-inner${kind}">
      <span class="vl-slide-num">${i + 1} / ${n}</span>
      <div class="vl-text">
        <h2 class="vl-slide-title">${esc(s.title)}</h2>
        ${s.bullets.length ? `<ul class="vl-bullets">${s.bullets.map((b, k) => `<li style="--d:${k}">${esc(b)}</li>`).join('')}</ul>` : ''}
        ${s.formula ? `<div class="vl-formula">${esc('$$' + s.formula + '$$')}</div>` : ''}
      </div>
      ${diagram ? `<div class="vl-diagram">${diagram}</div>` : pic}
    </div>`;
  }

  // ----- Real pictures (Wikipedia / Wikimedia Commons) -----

  // The slide's picture, a placeholder while it is being looked up, or nothing.
  function figureHtml(s, i) {
    if (!s.image || (s.img && s.img.none)) return '';
    if (!s.img || s.img.v !== PIC_V) return `<div class="vl-diagram"><figure class="vl-figure pending" data-vl-fig="${i}" aria-hidden="true"></figure></div>`;
    const credit = s.img.credit || 'Wikimedia Commons';
    return `<div class="vl-diagram"><figure class="vl-figure" data-vl-fig="${i}">
      <button class="vl-fig-hide" data-vl-act="hide-pic" aria-label="${esc(i18n.t('vlPicHide'))}" title="${esc(i18n.t('vlPicHide'))}">&#10005;</button>
      <img src="${esc(s.img.src)}" alt="${esc(s.image.alt || s.title)}" referrerpolicy="no-referrer" loading="lazy">
      <figcaption>${s.img.page ? `<a href="${esc(s.img.page)}" target="_blank" rel="noopener noreferrer">${esc(credit)}</a>` : esc(credit)}</figcaption>
    </figure></div>`;
  }

  const PIC_V = 2; // pictures found by the current, stricter lookup; older ones are looked up again
  const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=960&iiextmetadatafilter=Artist|LicenseShortName';
  const textOf = html => { try { return (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } };
  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  // The first usable picture among Commons API pages (in search order).
  function firstPicture(json) {
    const pages = Object.values((json && json.query && json.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const pg of pages) {
      const ii = pg.imageinfo && pg.imageinfo[0];
      if (!ii || !/^image\/(jpeg|png|svg\+xml|webp|gif)$/.test(ii.mime || '') || (ii.width && ii.width < 180)) continue;
      const src = ii.thumburl || ii.url;
      if (!/^https:\/\/upload\.wikimedia\.org\//.test(src || '')) continue;
      const meta = ii.extmetadata || {};
      const who = textOf(meta.Artist && meta.Artist.value).slice(0, 80);
      const lic = textOf(meta.LicenseShortName && meta.LicenseShortName.value).slice(0, 40);
      return { src, page: ii.descriptionurl || '', credit: [who, lic].filter(Boolean).join(' · ') || 'Wikimedia Commons' };
    }
    return null;
  }
  // Look up one picture: the Wikipedia article's main picture, else a Commons search.
  // Words of a title that a matching picture's file name should share (accents removed, short and filler words dropped).
  const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  const FILLER = new Set(['the', 'and', 'for', 'with', 'from', 'unit', 'list', 'type', 'types']);
  function sharesName(title, file) {
    const f = fold(file).replace(/[^a-z0-9]+/g, ' ');
    const words = fold(title).replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !FILLER.has(w));
    return words.some(w => f.includes(w.length > 6 ? w.slice(0, 6) : w));
  }

  // Look up one picture: the main picture of the English Wikipedia article about exactly this thing,
  // kept only when the file is plainly about that article (its name shares the article's words).
  // No free-text search: it returned loosely related pictures that did not fit the slides.
  async function findPicture(req) {
    if (!req.wiki) return null;
    const j = await getJson('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages|pageprops&piprop=name&ppprop=disambiguation&titles=' + encodeURIComponent(req.wiki));
    const pg = Object.values((j.query && j.query.pages) || {})[0];
    if (!pg || pg.missing !== undefined || (pg.pageprops && pg.pageprops.disambiguation !== undefined) || !pg.pageimage) return null;
    if (!sharesName(pg.title || req.wiki, pg.pageimage)) return null;
    const hit = firstPicture(await getJson(COMMONS + '&titles=' + encodeURIComponent('File:' + pg.pageimage)));
    return hit ? { ...hit, v: PIC_V } : null;
  }


  // Find the pictures of a lesson's slides one at a time, keep them with the lesson, and show each as it arrives.
  const picturing = new Set();
  async function loadPictures(l) {
    if (!l || picturing.has(l) || typeof fetch === 'undefined') return;
    picturing.add(l);
    try {
      const order = l.slides.map((_, k) => k).sort((a, b) => Math.abs(a - index) - Math.abs(b - index)); // the slide on screen first
      for (const k of order) {
        const sl = l.slides[k];
        if (!sl || !sl.image || sl.diagram || (sl.img && (sl.img.none || sl.img.v === PIC_V))) continue;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        let hit = null;
        try { hit = await findPicture(sl.image); } catch (e) { continue; } // network trouble: try again next time
        sl.img = hit || { none: true, v: PIC_V };
        App.persistActiveDeck();
        if (lesson() === l) refreshFigure(l, k);
      }
    } finally {
      picturing.delete(l);
    }
  }

  // Swap the placeholder of slide k (if it is on screen) for its picture.
  function refreshFigure(l, k) {
    const fig = host && host.querySelector(`.vl-stage [data-vl-slide="${k}"] [data-vl-fig="${k}"]`);
    if (!fig) return;
    const slideEl = fig.closest('[data-vl-slide]');
    const inner = slideEl && slideEl.querySelector('.vl-slide-inner');
    if (!inner) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = slideHtml(App.getStudyData(), view(l, k), k, l.slides.length);
    const fresh = tmp.firstElementChild;
    const oldDiagram = fig.closest('.vl-diagram');
    const newDiagram = fresh.querySelector('.vl-diagram');
    if (newDiagram) oldDiagram.replaceWith(newDiagram); else { oldDiagram.remove(); inner.className = fresh.className; }
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
    startAt = 0;
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

  // How far into the current slide we are (0..1). The voice's real position when it reports one
  // (it speaks slower or faster than the estimate), otherwise the estimate. While the first clip
  // downloads nothing has been said yet, so it holds where the narration starts.
  function slideFrac() {
    const l = lesson();
    if (!l) return 0;
    if (ended) return 1;
    const rest = 1 - startAt;
    if (heardFrac !== null) return Math.max(startAt, heardFrac); // the voice reports its place in the whole narration
    if (voiceWait) return startAt;
    const spent = (elapsed + (playing ? performance.now() - slideStart : 0)) / 1000;
    return startAt + Math.min(spent / duration(l.slides[index]), rest * 0.97);
  }

  // Seconds as m:ss.
  function clock(secs) {
    const t = Math.max(0, Math.round(secs));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function drawProgress() {
    const l = lesson();
    const fill = host && host.querySelector('[data-vl-fill]');
    if (!l || !fill) return;
    const total = l.slides.reduce((s, x) => s + duration(x), 0);
    const before = l.slides.slice(0, index).reduce((s, x) => s + duration(x), 0);
    const heard = playing && ttsOk() ? TTS.progress() : null;
    if (heard !== null) heardFrac = heard;
    const frac = slideFrac();
    const at = before + frac * duration(l.slides[index]);
    fill.style.width = (at / total * 100).toFixed(2) + '%';
    const time = host.querySelector('[data-vl-time]');
    if (time) time.textContent = `${clock(at)} / ${clock(total)}`;
    const seek = host.querySelector('[data-vl-seek]');
    if (seek) seek.setAttribute('aria-valuetext', `${clock(at)} / ${clock(total)}`);
    // Captions follow the narration, one sentence group at a time.
    const i = chunkAt(capChunks, frac);
    if (i !== capShown) {
      capShown = i;
      const cap = host.querySelector('[data-vl-caption]');
      if (cap) cap.textContent = capChunks[i] ? capChunks[i].text : '';
    }
  }

  // Which caption piece is on screen at `frac` of the slide.
  function chunkAt(chunks, frac) {
    let i = 0;
    while (i < chunks.length - 1 && chunks[i].end <= frac) i++;
    return i;
  }

  // Where the caption piece that is on screen at `frac` begins (narration restarts at a sentence, not mid-word).
  function chunkStart(frac) {
    const i = chunkAt(capChunks, frac);
    return i > 0 ? capChunks[i - 1].end : 0;
  }

  // The slide and the point within it (0..1) at `f` of the whole lesson.
  function locate(l, f) {
    const total = l.slides.reduce((s, x) => s + duration(x), 0);
    const t = Math.max(0, Math.min(1, f)) * total;
    let acc = 0;
    for (let i = 0; i < l.slides.length; i++) {
      const d = duration(l.slides[i]);
      if (t < acc + d || i === l.slides.length - 1) return { i, w: Math.max(0, Math.min(0.999, (t - acc) / d)), t };
      acc += d;
    }
    return { i: 0, w: 0, t: 0 };
  }

  // Jump to `f` of the whole lesson: that slide, from the start of the sentence being said there.
  function seekTo(f) {
    const l = lesson();
    if (!l) return;
    const { i, w } = locate(l, f);
    go(i, w);
  }

  // The preview over the progress bar: the slide, its caption and the time at the pointer.
  let previewFor = -1;
  function showPreview(clientX) {
    const l = lesson(), data = App.getStudyData();
    const bar = host && host.querySelector('[data-vl-seek]');
    const box = host && host.querySelector('[data-vl-preview]');
    if (!l || !bar || !box) return;
    const r = bar.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const { i, w, t } = locate(l, f);
    if (previewFor !== i || box.hidden) {
      previewFor = i;
      const s = view(l, i);
      box.querySelector('[data-vl-preview-stage]').innerHTML = `<div class="vl-slide in">${slideHtml(data, s, i, l.slides.length)}</div>`;
    }
    const chunks = captionChunks(view(l, i).narration);
    const c = chunks[chunkAt(chunks, w)];
    box.querySelector('[data-vl-preview-cap]').textContent = c ? c.text : '';
    let ch = '';
    for (let j = i; j >= 0; j--) if (l.slides[j].chapter) { ch = l.slides[j].chapter; break; }
    box.querySelector('[data-vl-preview-time]').textContent = `${clock(t)} · ${ch ? ch + ' › ' : ''}${i + 1}. ${view(l, i).title}`;
    box.hidden = false;
    const half = box.offsetWidth / 2;
    box.style.left = Math.max(half, Math.min(r.width - half, f * r.width)) + 'px';
  }

  function hidePreview() {
    const box = host && host.querySelector('[data-vl-preview]');
    if (box) box.hidden = true;
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
    // From a seek or a resume the voice starts at that point of the WHOLE narration (TTS `from`): the
    // natural voice then reuses the clip it already has instead of asking the voice service again.
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
      // If the natural voice is off for now (daily limit, no key), say so up front instead of silently using the device voice.
      const off = TTS.naturalOn() ? TTS.naturalBlockedReason() : '';
      drawVoiceNote(off ? i18n.t('vlVoiceBlocked', { why: off }) : '');
      TTS.speak(s.narration, cancelled => {
        setVoiceBusy(false);
        if (my !== token) return;
        if (cancelled) { playing = false; syncControls(); return; }
        done();
      }, {
        rate, lang: lessonLang(l), natural: true, from: startAt,
        onNoVoice: lang => { playing = false; noVoice = lang; syncControls(); drawNotice(); },
        // The voice service is busy: count down to the next try instead of switching voices in the middle of the lesson.
        onWait: secs => { if (my === token) setVoiceBusy(true, secs); },
        // It could not be reached: the device voice reads the rest of this part, and the note says why.
        onFallback: err => {
          if (my !== token) return;
          drawVoiceNote(i18n.t(TTS.naturalBlockedReason() ? 'vlVoiceBlocked' : 'vlVoiceFellBack', { why: err && err.message ? err.message : String(err) }));
        },
        onLoading: on => {
          if (my !== token) return;
          setVoiceBusy(on);
          // The slide's clock starts when its audio does, not while the clip downloads.
          if (!on && !heard) {
            heard = true; slideStart = performance.now(); elapsed = 0;
            // The first clip is here: now have the next slide's audio ready so the lesson does not stall between slides
            // (asking for both at once would double the requests, and the voice service's allowance is small).
            if (index < l.slides.length - 1) TTS.prefetch(view(l, index + 1).narration, { lang: lessonLang(l) });
          }
        }
      });
    } else {
      // No speech: advance on the estimated reading time.
      timer = setTimeout(done, duration(s) * (1 - startAt) * 1000);
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
    resumePoint();
    syncControls();
    drawProgress();
  }

  // Playback picks up at the start of the sentence that was being said.
  function resumePoint() {
    if (ended) return;
    startAt = chunkStart(slideFrac());
    heardFrac = null;
    elapsed = 0;
  }

  // `at` (0..1): where in the slide to start; it is rounded back to the start of that sentence.
  function go(i, at) {
    const l = lesson();
    if (!l) return;
    hideCheckpoint();
    const to = Math.max(0, Math.min(l.slides.length - 1, i));
    const dir = to > index ? 1 : to < index ? -1 : 0;
    token++;
    clearTimeout(timer);
    if (playing && ttsOk()) TTS.stop();
    if (to !== index || !at) {
      index = to;
      showOrig = false;
      showSlide(dir);
    } else {
      ended = false; // a seek within the slide on screen: no new slide transition
    }
    startAt = at ? chunkStart(at) : 0;
    heardFrac = null;
    elapsed = 0;
    slideStart = performance.now();
    drawProgress();
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
    // Progress bar: hover (or hold and drag) shows the slide at that point, release jumps there.
    const barX = e => { const bar = host && host.querySelector('[data-vl-seek]'); if (!bar) return 0; const r = bar.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
    document.addEventListener('pointerdown', e => {
      const bar = host && e.target.closest && e.target.closest('[data-vl-seek]');
      if (!bar || !host.contains(bar) || e.target.closest('[data-vl-go]') || e.button > 0) return;
      e.preventDefault();
      scrub = { id: e.pointerId };
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      showPreview(e.clientX);
    });
    document.addEventListener('pointermove', e => {
      if (!host) return;
      const bar = host.querySelector('[data-vl-seek]');
      if (!bar) return;
      if (scrub ? scrub.id === e.pointerId : e.pointerType === 'mouse' && bar.contains(e.target)) showPreview(e.clientX);
      else hidePreview();
    });
    const endScrub = (e, apply) => {
      if (!scrub || scrub.id !== e.pointerId) return;
      scrub = null;
      hidePreview();
      if (apply) seekTo(barX(e));
    };
    document.addEventListener('pointerup', e => endScrub(e, true));
    document.addEventListener('pointercancel', e => endScrub(e, false));
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
      const len = e.target.closest('[data-vl-length]');
      if (len) { setLessonMinutes(+len.dataset.vlLength); host.querySelectorAll('[data-vl-length]').forEach(b => b.setAttribute('aria-checked', String(b === len))); return; }
      const sty = e.target.closest('[data-vl-style]');
      if (sty) { setLessonStyle(sty.dataset.vlStyle); host.querySelectorAll('[data-vl-style]').forEach(b => b.setAttribute('aria-checked', String(b === sty))); return; }
      const persp = e.target.closest('[data-vl-persp]');
      if (persp) { makeVersion(persp.dataset.vlPersp, panelText('#vl-persp-text')); return; }
      const goBtn = e.target.closest('[data-vl-go]');
      if (goBtn) { go(+goBtn.dataset.vlGo); return; }
      const btn = e.target.closest('[data-vl-act]');
      if (!btn) return;
      const act = btn.dataset.vlAct;
      if (act === 'toggle') playing ? pause() : play();
      else if (act === 'next') go(index + 1);
      else if (act === 'prev') go(index - 1);
      else if (act === 'rate') {
        setRate(RATES.find(r => r > rate + 0.001) || RATES[0]);
        if (playing) { if (ttsOk()) { token++; TTS.stop(); } resumePoint(); speakCurrent(); }
      }
      else if (act === 'cc') setCaptions(!captions);
      else if (act === 'full') toggleFull();
      else if (act === 'list') { stop(); resetUi(); mode = 'list'; refresh(); }
      else if (act === 'help') openPanel('help');
      else if (act === 'version') openPanel('version');
      else if (act === 'voice') openPanel('voice');
      else if (act === 'panel-close' || act === 'panel-cancel') closePanel();
      else if (act === 'panel-retry') { if (lastReq && lastReq.kind === 'version') makeVersion(lastReq.choice, lastReq.text); else if (lastReq && lastReq.kind === 'ask') answerCheckQuestion(lastReq.text); else if (lastReq) rewriteSlide(lastReq.choice, lastReq.text); }
      else if (act === 'ask-go') askGo();
      else if (act === 'hide-pic') {
        const l = lesson(), k = +btn.closest('[data-vl-fig]').dataset.vlFig;
        if (l && l.slides[k]) { l.slides[k].img = { none: true, v: PIC_V }; App.persistActiveDeck(); refreshFigure(l, k); }
      }
      else if (act === 'ask-new') { askThread = null; drawPanel(); }
      else if (act === 'fix-go') rewriteSlide('', panelText('#vl-fix-text'));
      else if (act === 'check-next' || act === 'check-skip') continueAfterCheck();
      else if (act === 'check-again') explainAgain();
      else if (act === 'check-ask') askAboutSlide();
      else if (act === 'weak-practice') practiseWeak();
      else if (act === 'save-voice') saveVoice(btn);
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
    askThread = null;
    pendingAsk = '';
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

  return { refreshOld, outdatedLessons, practiseAllWeak, init, render, stop, fromNotes, isPlaying: () => playing, _index: () => index, _test: { versionsOf, trimLessons, reviseSlide, undoSlide, paragraphSlides, materialFor, prompt, weakSlides } };
})();
