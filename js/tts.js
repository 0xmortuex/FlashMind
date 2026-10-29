// ===== TTS Module =====
// Read-aloud via the browser's built-in speechSynthesis — no dependencies.
// The voice follows the language OF THE TEXT (Turkish study material read in
// an English-UI app must not go to an en-US voice), detected per sentence
// chunk; the UI language is only the fallback when a chunk is undetermined.
// Long text is chunked by sentence because Chrome silently stops long single
// utterances (~15s bug).
const TTS = (() => {
  let session = 0; // bumping this cancels any in-flight chunk queue
  let pendingEnd = null; // onEnd of the utterance queue currently speaking
  const VOICE_KEY = 'flashmind_tts_voices'; // { tr: voiceURI, en: voiceURI } — the student's choice per language
  const RATE_KEY = 'flashmind_tts_rate';
  const DEFAULT_RATE = 0.95;
  const TAGS = { tr: 'tr-TR', en: 'en-US' };
  const warned = {};

  function supported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  function uiLang() {
    return i18n.getLang() === 'tr' ? 'tr' : 'en';
  }

  function langTag(lang) {
    return TAGS[lang] || TAGS[uiLang()];
  }

  // ----- Language detection -----

  const TR_WORDS = new Set(('ve bir bu için ile de da olan olarak gibi çok daha ise ancak her veya kadar sonra ne mi mı değil var yok ki ya ama hem şu o ben sen biz siz onlar ' +
    'olur olduğu oldu edilir edilen yapılır yapar eder arasında üzerinde içinde göre ayrıca çünkü bunun bunu bunlar şey nasıl neden hangi kendi tüm bütün en az fakat yani örneğin ' +
    'dir dır tir tır dur dür bulunur denir denilir sağlar eşittir toplam fark oran sayı değer').split(/\s+/));
  const EN_WORDS = new Set(('the and is are of to in that for with as this it on by an be was were which from or at not have has can will their its these those when then than also there ' +
    'what how why because each other into more most such only between about both if so but you your we our they them his her').split(/\s+/));

  // 'tr', 'en', or null when the text gives no evidence either way.
  function detectLang(text) {
    const s = String(text || '').replace(/İ/g, 'i').toLowerCase();
    let tr = (s.match(/[çğış]/g) || []).length * 2 + (s.match(/[öü]/g) || []).length;
    let en = 0;
    (s.match(/[a-zçğışöü]+/g) || []).forEach(w => {
      if (TR_WORDS.has(w)) tr += 2;
      if (EN_WORDS.has(w)) en += 2;
    });
    if (tr === en) return null;
    return tr > en ? 'tr' : 'en';
  }

  // ----- Voices -----

  function allVoices() {
    return supported() ? (speechSynthesis.getVoices() || []) : [];
  }

  // Higher is better. Natural/online/neural voices sound far better than the
  // old "Desktop" or espeak ones that browsers often list first.
  function voiceScore(v, tag) {
    const n = v.name || '';
    let s = v.lang && v.lang.replace('_', '-') === tag ? 100 : 0;
    if (/online|natural|neural/i.test(n)) s += 60;
    if (/google/i.test(n)) s += 35;
    if (/\b(emel|yelda|tolga|filiz|selin|ahmet|cem|seda|aria|jenny|guy|samantha|daniel)\b/i.test(n)) s += 20;
    if (/desktop/i.test(n)) s -= 15;
    if (/compact/i.test(n)) s -= 30;
    if (/espeak/i.test(n)) s -= 60;
    return s;
  }

  // Every installed voice for a language, best first (exact locale before
  // prefix match). Without `lang` it is the UI language.
  function voicesForLang(lang) {
    if (!supported()) return [];
    const tag = langTag(lang), prefix = tag.slice(0, 2);
    return allVoices()
      .filter(v => v.lang && v.lang.slice(0, 2).toLowerCase() === prefix)
      .map((v, i) => ({ v, i, s: voiceScore(v, tag) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map(x => x.v);
  }

  function savedVoices() {
    try { return JSON.parse(localStorage.getItem(VOICE_KEY)) || {}; } catch (e) { return {}; }
  }

  // The voice the student chose for this language if it is still installed,
  // else the best ranked one.
  function pickVoice(lang) {
    lang = lang || uiLang();
    const list = voicesForLang(lang);
    return list.find(v => v.voiceURI === savedVoices()[lang]) || list[0] || null;
  }

  // The student's own choice only (null = automatic).
  function savedVoiceFor(lang) {
    return voicesForLang(lang).find(v => v.voiceURI === savedVoices()[lang]) || null;
  }

  // voice = null forgets the choice (automatic).
  function setVoice(lang, voice) {
    const m = savedVoices();
    if (voice) m[lang] = voice.voiceURI; else delete m[lang];
    try { localStorage.setItem(VOICE_KEY, JSON.stringify(m)); } catch (e) {}
  }

  function getRate() {
    try { return parseFloat(localStorage.getItem(RATE_KEY)) || DEFAULT_RATE; } catch (e) { return DEFAULT_RATE; }
  }

  function setRate(r) {
    try { localStorage.setItem(RATE_KEY, String(r)); } catch (e) {}
  }

  // True when the device lists voices but none speaks `lang`. An empty list
  // means the browser has not loaded them yet, which is not "missing".
  function missingVoice(lang) {
    return supported() && allVoices().length > 0 && voicesForLang(lang).length === 0;
  }

  // ----- Speakable text -----

  const GREEK = {
    tr: { alpha: 'alfa', beta: 'beta', gamma: 'gama', delta: 'delta', theta: 'teta', lambda: 'lambda', mu: 'mü', sigma: 'sigma', omega: 'omega', pi: 'pi', phi: 'fi', epsilon: 'epsilon', rho: 'ro' },
    en: { alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', theta: 'theta', lambda: 'lambda', mu: 'mu', sigma: 'sigma', omega: 'omega', pi: 'pi', phi: 'phi', epsilon: 'epsilon', rho: 'rho' }
  };
  const WORDS = {
    tr: { frac: 'bölü', sqrt: 'karekök', root: 'dereceden kök', sq: 'kare', cube: 'küp', pow: 'üzeri', sub: 'indis', plus: 'artı', minus: 'eksi', eq: 'eşittir', ne: 'eşit değildir', le: 'küçük eşit', ge: 'büyük eşit', lt: 'küçüktür', gt: 'büyüktür', times: 'çarpı', div: 'bölü', pm: 'artı eksi', approx: 'yaklaşık olarak eşittir', inf: 'sonsuz', sum: 'toplam', int: 'integral', to: 'verir', deg: 'derece', degC: 'derece Santigrat', pct: 'yüzde', in: 'elemanıdır', union: 'birleşim', inter: 'kesişim', lim: 'limit' },
    en: { frac: 'over', sqrt: 'square root of', root: 'th root of', sq: 'squared', cube: 'cubed', pow: 'to the power of', sub: 'sub', plus: 'plus', minus: 'minus', eq: 'equals', ne: 'is not equal to', le: 'is less than or equal to', ge: 'is greater than or equal to', lt: 'is less than', gt: 'is greater than', times: 'times', div: 'divided by', pm: 'plus or minus', approx: 'is approximately equal to', inf: 'infinity', sum: 'sum', int: 'integral', to: 'gives', deg: 'degrees', degC: 'degrees Celsius', pct: 'percent', in: 'belongs to', union: 'union', inter: 'intersection', lim: 'limit' }
  };
  const ABBR = {
    tr: { 'vb.': 've benzeri', 'vs.': 'vesaire', 'örn.': 'örneğin', 'bkz.': 'bakınız', 'yy.': 'yüzyıl', 'sn.': 'saniye', 'dk.': 'dakika', 'M.Ö.': 'milattan önce', 'M.S.': 'milattan sonra', 'T.C.': 'Türkiye Cumhuriyeti', 'Dr.': 'Doktor', 'Prof.': 'Profesör', 'yak.': 'yaklaşık', 'Sf.': 'sayfa' },
    en: { 'e.g.': 'for example', 'i.e.': 'that is', 'etc.': 'et cetera', 'vs.': 'versus', 'approx.': 'approximately', 'Dr.': 'Doctor', 'Prof.': 'Professor', 'Fig.': 'Figure' }
  };
  const ABBR_ALL = [...new Set([...Object.keys(ABBR.tr), ...Object.keys(ABBR.en)])];
  const ABBR_RE = new RegExp('(^|[\\s(])(' + ABBR_ALL.map(a => a.replace(/\./g, '\\.')).join('|') + ')(?=\\s|$|[,;)])', 'gi');
  const DOT = '․'; // keeps an abbreviation's dot from ending the sentence chunk

  // Speech-friendly text in `lang`: markdown, LaTeX and symbols are spoken as
  // words (or dropped), never read out as "$", "backslash" or braces.
  function speakable(text, lang) {
    lang = lang || detectLang(text) || uiLang();
    const W = WORDS[lang] || WORDS.en;
    const G = GREEK[lang] || GREEK.en;
    const sp = w => ' ' + w + ' ';
    let s = String(text).split(DOT).join('.');
    // Markdown remnants
    s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\*\*|__|~~|`+/g, '')
      .replace(/(^|[\s(])\*(?=\S)/g, '$1')
      .replace(/(\S)\*(?=[\s).,;:!?]|$)/g, '$1');
    // Abbreviations
    const ab = ABBR[lang] || {};
    s = s.replace(ABBR_RE, (m, pre, a) => {
      const key = Object.keys(ab).find(k => k.toLowerCase() === a.toLowerCase());
      if (!key) return m;
      const cap = a[0] !== a[0].toLowerCase();
      return pre + (cap ? ab[key][0].toUpperCase() + ab[key].slice(1) : ab[key]);
    });
    // Math delimiters and LaTeX; a hyphen inside a formula is a minus
    s = s.replace(/\$\$?([^$]+)\$\$?|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (m, a, b, c) => ' ' + (a || b || c).replace(/-/g, '−') + ' ')
      .replace(/\\[()[\]]|\$+/g, ' ')
      .replace(/\\left|\\right|\\displaystyle|\\Big|\\big/g, '')
      .replace(/\\(?:text|mathrm|mathbf|mathit|textbf|operatorname|mathbb)\s*\{([^{}]*)\}/g, ' $1 ')
      .replace(/\\[,;:! ]|\\quad|\\qquad/g, ' ')
      .replace(/\\%/g, '%')
      .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
      .replace(/\\circ/g, '°');
    for (let k = 0; k < 3; k++) {
      s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ` $1 ${W.frac} $2 `)
        .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, ` $1 ${W.root} $2 `)
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, ` ${W.sqrt} $1 `)
        .replace(/\\sqrt\s*([a-zA-Z0-9])/g, ` ${W.sqrt} $1 `);
    }
    s = s.replace(/√\s*\(([^)]*)\)/g, ` ${W.sqrt} $1 `).replace(/√\s*(\w+)/g, ` ${W.sqrt} $1 `);
    // Superscripts / subscripts
    s = s.replace(/²/g, '^2').replace(/³/g, '^3')
      .replace(/\^\s*\{?\s*2\s*\}?(?![\d.])/g, sp(W.sq))
      .replace(/\^\s*\{?\s*3\s*\}?(?![\d.])/g, sp(W.cube))
      .replace(/\^\s*\{([^{}]*)\}/g, ` ${W.pow} $1 `)
      .replace(/\^\s*(-?\w)/g, ` ${W.pow} $1 `);
    // Chemical subscripts (CO_2, H_{12}) are spoken in sequence; others get "indis".
    s = s.replace(/([A-Za-z0-9)\]])_(\{[^{}]*\}|\w)/g, (m, pre, sub) => {
      const body = sub.replace(/[{}]/g, '');
      return /[A-Z)]/.test(pre) ? `${pre} ${body} ` : `${pre} ${W.sub} ${body} `;
    });
    // Commands with a spoken equivalent, then Greek letters, then the bare name.
    const cmd = { times: W.times, cdot: W.times, div: W.div, pm: W.pm, leq: W.le, le: W.le, geq: W.ge, ge: W.ge, neq: W.ne, ne: W.ne, approx: W.approx, infty: W.inf, sum: W.sum, int: W.int, to: W.to, rightarrow: W.to, Rightarrow: W.to, in: W.in, cup: W.union, cap: W.inter, lim: W.lim };
    s = s.replace(/\\([a-zA-Z]+)/g, (m, name) => {
      if (cmd[name]) return sp(cmd[name]);
      return G[name.toLowerCase()] ? sp(G[name.toLowerCase()]) : ' ' + name + ' ';
    });
    // Unicode and plain symbols
    const pct = lang === 'tr' ? `${W.pct} $1 ` : `$1 ${W.pct} `;
    s = s.replace(/[×·⋅]/g, sp(W.times)).replace(/÷/g, sp(W.div)).replace(/±/g, sp(W.pm))
      .replace(/≤|<=/g, sp(W.le)).replace(/≥|>=/g, sp(W.ge)).replace(/≠/g, sp(W.ne)).replace(/≈/g, sp(W.approx))
      .replace(/∞/g, sp(W.inf)).replace(/∑/g, sp(W.sum)).replace(/∫/g, sp(W.int)).replace(/[→⟶⇒]/g, sp(W.to))
      .replace(/∈/g, sp(W.in)).replace(/∪/g, sp(W.union)).replace(/∩/g, sp(W.inter))
      .replace(/[πΠ]/g, ' pi ').replace(/Δ/g, sp(G.delta)).replace(/α/g, sp(G.alpha)).replace(/β/g, sp(G.beta))
      .replace(/θ/g, sp(G.theta)).replace(/λ/g, sp(G.lambda)).replace(/μ/g, sp(G.mu)).replace(/σ/g, sp(G.sigma)).replace(/ω/g, sp(G.omega))
      .replace(/°\s*C\b/g, sp(W.degC)).replace(/°/g, sp(W.deg))
      .replace(/(\d+(?:[.,]\d+)?)\s*%/g, pct).replace(/%\s*(\d+(?:[.,]\d+)?)/g, pct).replace(/%/g, sp(W.pct))
      .replace(/−/g, sp(W.minus))
      .replace(/(\d+(?:[.,]\d+)?|\b[a-zA-Z]\b|\))\s+-\s+(?=\d|\b[a-zA-Z]\b|\()/g, `$1 ${W.minus} `)
      .replace(/([=(]\s*)-(?=\d)/g, `$1${W.minus} `)
      .replace(/\+/g, sp(W.plus))
      .replace(/(\w)\s*\*\s*(\w)/g, `$1 ${W.times} $2`)
      .replace(/=/g, sp(W.eq))
      .replace(/\s<\s/g, sp(W.lt)).replace(/\s>\s/g, sp(W.gt))
      .replace(/(\d|\b[a-zA-Z])\s*\/\s*(\d+|[a-zA-Z])(?![\w])/g, `$1 ${W.div} $2`);
    // Whatever is left of the TeX markup
    return s.replace(/\\/g, ' ').replace(/[{}^_]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  // Split into ~`max`-char chunks on sentence boundaries (220 for device voices).
  function chunk(text, max = 220) {
    const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [String(text)];
    const chunks = [];
    let cur = '';
    parts.forEach(p => {
      while (p.length > max) {
        if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
        const space = p.lastIndexOf(' ', max);
        const end = space > 0 ? space : max;
        chunks.push(p.slice(0, end).trim());
        p = p.slice(end).trimStart();
      }
      if ((cur + p).length > max && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += p;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }

  // One entry per utterance: { text, lang }. Language is detected per sentence
  // and neighbouring sentences of one language are chunked together. An
  // undetermined sentence keeps the previous one's language, the first one falls
  // back to `hint`, then the language of the whole text, then the UI language.
  function plan(text, hint, max) {
    const protectedText = String(text).replace(ABBR_RE, (m, pre, a) => pre + a.split('.').join(DOT)).replace(/\s+/g, ' ');
    let prev = hint || detectLang(text) || uiLang();
    const groups = [];
    (protectedText.match(/[^.!?…]+[.!?…]*/g) || [protectedText]).forEach(sent => {
      const lang = detectLang(sent) || prev;
      prev = lang;
      const last = groups[groups.length - 1];
      if (last && last.lang === lang) last.text += sent; else groups.push({ lang, text: sent });
    });
    return groups.flatMap(g => chunk(g.text, max).map(c => ({ text: speakable(c, g.lang), lang: g.lang }))).filter(p => p.text);
  }

  function notifyMissing(lang) {
    if (warned[lang] || typeof App === 'undefined' || !App.showToast) return;
    warned[lang] = true;
    App.showToast(i18n.t('ttsNoVoice', { lang: i18n.t(lang === 'tr' ? 'ttsLangTr' : 'ttsLangEn') }), 'error');
  }

  // ----- Natural voice (Gemini TTS through the flashmind-tts worker) -----
  // Opt-in per call (opts.natural) so read-aloud of every flashcard does not
  // spend the server quota. Clips are fetched a passage at a time and played
  // through one shared <audio> element (an element the student's tap has
  // unlocked keeps playing the following clips on iOS, which refuses new ones
  // outside a tap). If a clip cannot be fetched the student is told why and
  // the rest of the text is read with the device voice.

  const NATURAL_KEY = 'flashmind_tts_natural'; // '0' = the student turned it off
  const NVOICE_KEY = 'flashmind_tts_nvoice';
  const NVOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
  const NATURAL_CHUNK = 600;
  const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const clips = new Map(); // "voice|text" -> Promise<Blob>, newest last
  let audioEl = null;
  let audioUrl = null;
  let naturalBlocked = ''; // set when the server says it has no key: no point asking again this page load
  let lastFailToast = 0;
  let progressFn = null; // () => fraction (0-1) of the text spoken so far, or null when unknown

  function naturalOn() {
    try { return localStorage.getItem(NATURAL_KEY) !== '0'; } catch (e) { return true; }
  }

  function setNatural(on) {
    try { localStorage.setItem(NATURAL_KEY, on ? '1' : '0'); } catch (e) {}
  }

  function naturalVoice() {
    try { const v = localStorage.getItem(NVOICE_KEY); return NVOICES.includes(v) ? v : NVOICES[0]; } catch (e) { return NVOICES[0]; }
  }

  function setNaturalVoice(v) {
    if (!NVOICES.includes(v)) return;
    try { localStorage.setItem(NVOICE_KEY, v); } catch (e) {}
  }

  // True when natural speech can be tried right now.
  // (Offline is allowed: clips saved on the device still play; an unsaved one fails with a clear message.)
  function naturalAvailable() {
    return naturalOn() && !naturalBlocked && typeof API !== 'undefined';
  }

  // ----- Clips saved on the device (Cache Storage) -----

  const CLIP_CACHE = 'flashmind-tts-v1';

  // Where this clip lives in the cache, or null when the browser cannot store it.
  async function clipStore(text, voice) {
    if (typeof caches === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) return null;
    const cache = await caches.open(CLIP_CACHE);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(voice + '|' + text));
    const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
    return { cache, key: 'https://flashmind.invalid/tts/' + hex };
  }

  // A saved clip if there is one, else a fresh one from the worker (which is then saved).
  async function loadClip(text, voice) {
    let store = null;
    try { store = await clipStore(text, voice); } catch (e) { store = null; } // storage blocked: the clip still plays, it just is not kept
    if (store) {
      const hit = await store.cache.match(store.key);
      if (hit) return hit.blob();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(i18n.t('ttsOffline'));
    const blob = await API.tts(text, voice);
    if (store) {
      try { await store.cache.put(store.key, new Response(blob, { headers: { 'Content-Type': 'audio/wav' } })); } catch (e) { /* storage full: playback does not need it; saveForOffline checks */ }
    }
    return blob;
  }

  // Fetch and keep every clip of these texts so they play offline. onProgress(done, total) after each clip.
  // Throws when the browser has no clip storage or a clip could not be stored.
  async function saveForOffline(texts, opts) {
    const o = opts || {};
    const voice = o.nvoice || naturalVoice();
    const passages = [...new Set(texts.flatMap(t => plan(t, o.lang, NATURAL_CHUNK).map(q => q.text)))];
    let saved = 0, bytes = 0;
    for (const text of passages) {
      const store = await clipStore(text, voice);
      if (!store) throw new Error(i18n.t('ttsNoCache'));
      const blob = await patiently(() => loadClip(text, voice), () => true, o.onWait);
      if (!(await store.cache.match(store.key))) throw new Error(i18n.t('ttsCacheFull'));
      saved++; bytes += blob.size || 0;
      if (o.onProgress) o.onProgress(saved, passages.length);
    }
    return { clips: saved, bytes };
  }

  // What the voice service has told us: busy for now (429 per minute), used up for the day (429 per day), or no key (503).
  let limitedAt = 0;
  function noteRefusal(err) {
    if (!err) return;
    if (err.status === 429) limitedAt = Date.now();
    if (err.quota === 'day' || err.status === 503) naturalBlocked = err.message; // waiting cannot help: stop asking until the page is reloaded
  }
  const recentlyLimited = () => Date.now() - limitedAt < 60000;

  // Why the natural voice is switched off for now ('' when it is not).
  function naturalBlockedReason() {
    return naturalBlocked;
  }

  function fetchClip(text, voice) {
    const key = voice + '|' + text;
    if (!clips.has(key)) {
      const p = loadClip(text, voice);
      p.catch(err => { clips.delete(key); noteRefusal(err); }); // a failed clip is retried next time
      clips.set(key, p);
      if (clips.size > 24) clips.delete(clips.keys().next().value);
    }
    return clips.get(key);
  }

  // A busy service (429 per minute, 502, a dropped connection) gets another try after a wait, counting down
  // through onWait(secondsLeft), instead of the voice changing in the middle of a lesson. A used-up daily quota,
  // a missing key, an offline device and a cancelled playback are not retried.
  let retryWaits = [10, 25, 45]; // seconds before each retry
  const transient = err => !!err && err.quota !== 'day' && (err.status === 429 || err.status === 502 || err instanceof TypeError);

  async function pauseFor(secs, alive, onWait) {
    const end = Date.now() + secs * 1000;
    while (alive()) {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) return;
      if (onWait) onWait(left);
      await new Promise(r => setTimeout(r, Math.min(1000, Math.max(0, end - Date.now()))));
    }
  }

  async function patiently(get, alive, onWait) {
    for (let attempt = 0; ; attempt++) {
      try { return await get(); } catch (err) {
        if (!transient(err) || attempt >= retryWaits.length || !alive()) throw err;
        await pauseFor(Number.isFinite(err.retryAfter) ? Math.min(Math.max(err.retryAfter, 1), 60) : retryWaits[attempt], alive, onWait);
        if (!alive()) throw err;
      }
    }
  }

  // Start fetching the first clip of a passage the student is about to hear (the next
  // slide). Only one, and not while the service is pushing back, so a lesson does not
  // use up the per-minute allowance. Failures are not reported here: the real
  // playback asks again and reports them.
  function prefetch(text, opts) {
    const o = opts || {};
    if (!text || !naturalAvailable() || recentlyLimited()) return;
    const first = plan(text, o.lang, NATURAL_CHUNK)[0];
    if (first) fetchClip(first.text, o.nvoice || naturalVoice()).catch(() => {});
  }

  // Call from a tap handler: lets the shared element play later without a tap.
  function unlockAudio() {
    if (!audioEl) audioEl = new Audio();
    if (audioEl.src) return;
    audioEl.src = SILENCE;
    audioEl.play().catch(() => { /* locked: the clip's own play() reports it */ });
  }

  function releaseAudio() {
    if (audioEl) { audioEl.onended = null; audioEl.onerror = null; audioEl.pause(); }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  }

  function notifyNaturalFailed(err) {
    if (typeof App === 'undefined' || !App.showToast || Date.now() - lastFailToast < 30000) return;
    lastFailToast = Date.now();
    App.showToast(i18n.t('ttsNaturalFailed', { why: err && err.message ? err.message : String(err) }), 'error');
  }

  // onEnd(cancelled) runs once: when the text finishes, or with `true` when
  // another speak()/stop() cuts it off. opts: { lang (fallback), voice, pitch,
  // rate, natural, nvoice, onNoVoice(lang), onLoading(bool), onWait(secondsLeft), onFallback(err) }. If a language of
  // the text has no installed voice nothing is spoken (never the wrong-language
  // voice): onNoVoice(lang) is called, or a toast explains it, and onEnd(false) runs.
  function speak(text, onEnd, opts) {
    const o = opts || {};
    const useNatural = !!o.natural && naturalAvailable();
    if ((!supported() && !useNatural) || !text) { if (onEnd) onEnd(false); return; }
    stop();
    const mySession = ++session;
    const finish = () => {
      if (mySession !== session) return;
      const cb = pendingEnd;
      pendingEnd = null;
      if (cb) cb(false);
    };
    pendingEnd = onEnd || null;

    // Device voices, from queue[start]. Refuses (never the wrong language) when a language has no voice.
    function speakDevice(queue, start, track) {
      const rest = queue.slice(start);
      const lens = rest.map(q => q.text.length);
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      let cur = 0, charAt = 0, tracked = false;
      // Word-boundary events give the real position; a voice without them reports null (the caller estimates).
      if (track) progressFn = () => tracked ? Math.min(1, (lens.slice(0, cur).reduce((a, b) => a + b, 0) + charAt) / total) : null;
      const absent = [...new Set(rest.map(q => q.lang))].find(missingVoice);
      if (!supported() || absent) {
        if (absent) { if (o.onNoVoice) o.onNoVoice(absent); else notifyMissing(absent); }
        finish();
        return;
      }
      let idx = 0;
      const next = () => {
        if (mySession !== session) return; // cancelled
        if (idx >= rest.length) { finish(); return; }
        const q = rest[idx++];
        cur = idx - 1;
        charAt = 0;
        const u = new SpeechSynthesisUtterance(q.text);
        u.onboundary = e => { tracked = true; charAt = e.charIndex || 0; };
        u.lang = langTag(q.lang);
        // A caller-chosen voice only counts when it speaks this chunk's language.
        const voice = o.voice && o.voice.lang && o.voice.lang.slice(0, 2).toLowerCase() === q.lang ? o.voice : pickVoice(q.lang);
        if (voice) u.voice = voice;
        u.rate = o.rate || getRate();
        u.pitch = o.pitch || 1;
        u.onend = next;
        u.onerror = finish;
        speechSynthesis.speak(u);
      };
      next();
    }

    if (!useNatural) { speakDevice(plan(text, o.lang), 0, true); return; }

    const queue = plan(text, o.lang, NATURAL_CHUNK);
    const lens = queue.map(q => q.text.length);
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const voiceName = o.nvoice || naturalVoice();
    const loading = on => { if (o.onLoading && mySession === session) o.onLoading(on); };
    unlockAudio();
    let idx = 0;
    const fallBack = (err, from) => {
      if (mySession !== session) return;
      loading(false);
      progressFn = null; // the device voice reads the rest; the caller estimates until it reports its own position
      noteRefusal(err);
      if (o.onFallback) o.onFallback(err);
      notifyNaturalFailed(err);
      // The device voices read the rest of the text in their own, smaller chunks.
      speakDevice(plan(queue.slice(from).map(q => q.text).join(' '), o.lang), 0);
    };
    const step = async () => {
      if (mySession !== session) return;
      if (idx >= queue.length) { finish(); return; }
      const at = idx++;
      let blob;
      loading(true);
      try { blob = await patiently(() => fetchClip(queue[at].text, voiceName), () => mySession === session, s => { if (o.onWait && mySession === session) o.onWait(s); }); } catch (err) { fallBack(err, at); return; }
      if (mySession !== session) return;
      loading(false);
      if (queue[idx] && !recentlyLimited()) fetchClip(queue[idx].text, voiceName).catch(() => {}); // prefetch; a failure resurfaces on its own turn
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
      audioEl.onended = step;
      audioEl.onerror = () => fallBack(new Error('audio could not be played'), at);
      audioEl.src = audioUrl;
      audioEl.defaultPlaybackRate = audioEl.playbackRate = o.rate || getRate(); // a new src resets the rate to the default
      // Position in the whole text: the finished passages plus how far this clip has played.
      const done = lens.slice(0, at).reduce((a, b) => a + b, 0);
      progressFn = () => Math.min(1, (done + (audioEl.duration > 0 ? Math.min(1, audioEl.currentTime / audioEl.duration) : 0) * lens[at]) / total);
      try { await audioEl.play(); } catch (err) { fallBack(err, at); }
    };
    step();
  }

  // Fraction (0-1) of the text being spoken that has been heard, or null when it is not known.
  function progress() {
    return progressFn ? progressFn() : null;
  }

  function stop() {
    session++;
    progressFn = null;
    const cb = pendingEnd;
    pendingEnd = null;
    releaseAudio();
    if (supported()) speechSynthesis.cancel();
    if (cb) cb(true);
  }

  function isSpeaking() {
    return (!!audioEl && !!audioUrl && !audioEl.paused && !audioEl.ended) || (supported() && speechSynthesis.speaking);
  }

  return {
    supported, speak, stop, isSpeaking, voicesForLang, speakable, detectLang, pickVoice, savedVoiceFor, setVoice, getRate, setRate, missingVoice, langTag,
    naturalOn, setNatural, naturalVoice, setNaturalVoice, naturalAvailable, naturalBlockedReason, prefetch, NVOICES, progress, saveForOffline,
    _setRetryWaits: a => { retryWaits = a; },
    _reset: () => { naturalBlocked = ''; limitedAt = 0; clips.clear(); retryWaits = [10, 25, 45]; } // tests only
  };
})();
