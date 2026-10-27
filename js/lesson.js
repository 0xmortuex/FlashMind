// ===== Video lessons =====
// A narrated slide lesson per topic. The AI writes a short storyboard (title,
// bullets, optional formula and diagram, narration per slide); the player
// shows it like a video — slide stage with transitions, narration through
// the browser's speech synthesis (one utterance per slide, next slide on its
// onEnd), captions, speed, a progress bar with slide markers and keyboard
// controls. Storyboards are saved on the set (data.lessons). Browser speech
// can't be recorded, so "download" is a printable/PDF slide handout.
const VideoLesson = (() => {
  const RATES = [0.75, 1, 1.25, 1.5, 2];
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
  let rate = 1;
  let captions = true;
  try {
    rate = parseFloat(localStorage.getItem('flashmind_video_rate')) || 1;
    captions = localStorage.getItem('flashmind_video_cc') !== '0';
  } catch (e) {}

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }
  const ttsOk = () => typeof TTS !== 'undefined' && TTS.supported();

  function lesson() {
    const data = App.getStudyData();
    return data && (data.lessons || []).find(l => l.id === lessonId) || null;
  }

  // Estimated seconds per slide (speech synthesis reports no progress).
  function duration(slide) {
    const words = String(slide.narration || '').split(/\s+/).filter(Boolean).length;
    return Math.max(2.5, words / (WPS * rate)) + 0.6;
  }

  // ----- Storyboards -----

  // Offline lesson straight from the notes (no AI call).
  function fromNotes(data, sectionIdx) {
    const T = i18n.t;
    const n = data.notes || {};
    const all = n.sections || [];
    const secs = Number.isInteger(sectionIdx) && all[sectionIdx] ? [all[sectionIdx]] : all.slice(0, 9);
    const slides = [{ title: Number.isInteger(sectionIdx) && all[sectionIdx] ? all[sectionIdx].title : data.title, bullets: [], narration: n.summary || data.title }];
    secs.forEach(s => {
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

  function prompt(data, topic, focus) {
    const diagrams = ((data.notes && data.notes.diagrams) || []).map((g, i) => `${i}: ${g.title}`).slice(0, 10);
    const tree = mapTree(data);
    const branches = tree ? (tree.children || []).map(c => c.label).slice(0, 12) : [];
    return `Write the storyboard of a short narrated video lesson (6-10 slides) that teaches ${topic ? `"${topic}"` : 'the main ideas of this study material'} to a student revising for an exam. ` +
      'Slide 1 is a title slide with a hook; then build the idea step by step with a concrete example; the last slide recaps the 3 key takeaways. ' +
      'Each slide: "title" (max 8 words), "bullets": 1-3 short points (max 12 words each; may be empty on the title slide), optional "formula": one key formula in LaTeX without $ delimiters, ' +
      'optional "diagram" to show an existing picture: ' + (diagrams.length ? `{"kind":"notes","index":N} for one of these notes diagrams [${diagrams.join('; ')}], or ` : '') +
      (branches.length ? `{"kind":"map","label":"..."} for one of these mind-map branches [${branches.join('; ')}]. ` : 'none available. ') +
      '"narration": what the teacher says over the slide, 2-4 natural spoken sentences (30-70 words), formulas said in words, no markdown. ' +
      'Write it in the language of the material. ' + (focus ? `Focus especially on: ${focus}. ` : '') +
      'Return ONLY JSON, no other text: {"title":"lesson title","slides":[{"title":"...","bullets":["..."],"formula":"E = mc^2","narration":"..."}]}';
  }

  async function generate(topicIdx, focus) {
    const data = App.getStudyData();
    if (!data || busy) return;
    const sec = Number.isInteger(topicIdx) ? (data.notes.sections || [])[topicIdx] : null;
    busy = true;
    refresh();
    try {
      const ctx = App.getOriginalText();
      const raw = await API.chat(prompt(data, sec ? sec.title : '', focus), sec ? `${sec.title}\n${sec.content}\n\n${ctx}`.slice(0, 40000) : ctx);
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
    data.lessons = list.concat([l]).slice(-8);
    App.persistActiveDeck();
    lessonId = l.id;
    mode = 'player';
    index = 0;
  }

  // ----- Rendering -----

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    if (forData !== data) { stop(); forData = data; mode = 'list'; lessonId = null; index = 0; }
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
          <span class="vl-card-meta"><strong>${esc(l.title)}</strong><span>${T('vlSlides', { n: l.slides.length })} · ~${Math.max(1, Math.round(l.slides.reduce((s, x) => s + duration(x), 0) / 60))} ${T('vlMin')}</span></span>
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
    host.innerHTML = `<div class="vl-wrap">
      <div class="vl-top">
        <button class="btn-ghost" data-vl-act="list">&larr; ${T('vlAll')}</button>
        <h3 class="vl-name">${esc(l.title)}</h3>
      </div>
      <div class="vl-player${captions ? ' cc-on' : ''}" data-vl-player tabindex="0" aria-roledescription="${esc(T('vlPlayerRole'))}" aria-label="${esc(l.title)}">
        <div class="vl-stage" data-vl-stage><div class="vl-caption" data-vl-caption aria-live="polite"></div></div>
        <div class="vl-bar">
          <div class="vl-progress" data-vl-seek role="slider" aria-label="${esc(T('vlProgress'))}" aria-valuemin="1" aria-valuemax="${l.slides.length}" aria-valuenow="${index + 1}">
            <div class="vl-progress-fill" data-vl-fill></div>${marks}
          </div>
          <div class="vl-controls">
            <button class="vl-btn" data-vl-act="prev" aria-label="${esc(T('vlPrev'))}" title="${esc(T('vlPrev'))} (←)">&#9198;</button>
            <button class="vl-btn vl-btn-main" data-vl-act="toggle" aria-label="${esc(T('vlPlay'))}" title="${esc(T('vlPlay'))} (Space)">&#9654;</button>
            <button class="vl-btn" data-vl-act="next" aria-label="${esc(T('vlNext'))}" title="${esc(T('vlNext'))} (→)">&#9197;</button>
            <span class="vl-count" data-vl-count></span>
            <span class="vl-spacer"></span>
            <button class="vl-btn vl-rate" data-vl-act="rate" title="${esc(T('vlSpeed'))}">${rate}&times;</button>
            <button class="vl-btn vl-cc${captions ? ' on' : ''}" data-vl-act="cc" aria-pressed="${captions}" title="${esc(T('vlCaptions'))} (C)">CC</button>
            <button class="vl-btn" data-vl-act="full" aria-label="${esc(T('vlFull'))}" title="${esc(T('vlFull'))} (F)">&#x26F6;</button>
          </div>
        </div>
      </div>
      ${ttsOk() ? '' : `<p class="vl-note">${T('vlNoTtsPlayer')}</p>`}
      <ol class="vl-outline">${l.slides.map((s, i) => `<li><button class="vl-outline-item" data-vl-go="${i}">${esc(s.title)}</button></li>`).join('')}</ol>
      <div class="vl-foot">
        <button class="btn-ghost" data-vl-act="print">&#128438; ${T('vlPrint')}</button>
        <button class="btn-ghost" data-vl-act="copy">${T('vlCopyScript')}</button>
      </div>
      <p class="vl-note">${T('vlVideoNote')}</p>
    </div>`;
    showSlide(0);
    syncControls();
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
    const s = l.slides[index];
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
    const within = ended ? duration(l.slides[index]) : Math.min(spent, duration(l.slides[index]) * 0.97);
    fill.style.width = ((before + within) / total * 100).toFixed(2) + '%';
    // Captions follow the narration by estimated time, one sentence group at a time.
    const frac = ended ? 1 : within / duration(l.slides[index]);
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
    const s = l.slides[index];
    const done = () => {
      if (my !== token || !playing) return;
      // Short beat between slides, then the next one.
      timer = setTimeout(() => {
        if (my !== token || !playing) return;
        if (index < l.slides.length - 1) go(index + 1);
        else { playing = false; ended = true; elapsed = duration(s) * 1000; syncControls(); drawProgress(); }
      }, 450);
    };
    if (ttsOk()) {
      TTS.speak(s.narration, cancelled => {
        if (my !== token) return;
        if (cancelled) { playing = false; syncControls(); return; }
        done();
      }, { rate });
    } else {
      // No speech: advance on the estimated reading time.
      timer = setTimeout(done, duration(s) * 1000);
    }
  }

  function play() {
    const l = lesson();
    if (!l) return;
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
    const to = Math.max(0, Math.min(l.slides.length - 1, i));
    const dir = to > index ? 1 : to < index ? -1 : 0;
    token++;
    clearTimeout(timer);
    if (playing && ttsOk()) TTS.stop();
    index = to;
    showSlide(dir);
    if (playing) speakCurrent();
  }

  function stop() {
    cancelAnimationFrame(progRaf);
    clearTimeout(timer);
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
      if (open) { stop(); lessonId = open.dataset.vlOpen; mode = 'player'; index = 0; refresh(); return; }
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
        rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] || 1;
        try { localStorage.setItem('flashmind_video_rate', String(rate)); } catch (err) {}
        btn.innerHTML = rate + '&times;';
        if (playing) { if (ttsOk()) { token++; TTS.stop(); } speakCurrent(); }
      }
      else if (act === 'cc') setCaptions(!captions);
      else if (act === 'full') toggleFull();
      else if (act === 'list') { stop(); mode = 'list'; refresh(); }
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
    document.addEventListener('keydown', e => {
      if (!playerVisible() || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (document.querySelector('.shortcuts-backdrop[style*="flex"]')) return;
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); playing ? pause() : play(); }
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') { e.preventDefault(); go(index + 1); }
      else if (k === 'ArrowLeft' || k === 'j' || k === 'J') { e.preventDefault(); go(index - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(Infinity); }
      else if (k === 'c' || k === 'C') setCaptions(!captions);
      else if (k === 'f' || k === 'F') toggleFull();
    });
  }

  function setCaptions(on) {
    captions = on;
    try { localStorage.setItem('flashmind_video_cc', on ? '1' : '0'); } catch (err) {}
    const p = host && host.querySelector('[data-vl-player]');
    if (p) p.classList.toggle('cc-on', on);
    const b = host && host.querySelector('[data-vl-act="cc"]');
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }

  return { init, render, stop, fromNotes, isPlaying: () => playing, _index: () => index };
})();
