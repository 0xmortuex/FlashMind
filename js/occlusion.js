// ===== Image Occlusion =====
// Turn a labelled diagram (anatomy, maps, cell parts, circuits...) into
// flashcards: draw boxes over the labels, and each box becomes a card that
// asks "what is hidden here?". The image is stored once per set in
// data.media and every card points at it with its own target box.
// Modes: "hide all" masks every box and asks for one; "hide one" masks only
// the asked box.
const Occlusion = (() => {
  const MAX_SIDE = 900; // keeps a set's images well inside the 2 MB sync limit
  let el = null, releaseTrap = null;
  let image = null;     // data URL being edited
  let rects = [];       // [{x,y,w,h,label}] in 0..1 image coordinates
  let selected = -1;
  let mode = 'all';
  let draw = null;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // ----- Card rendering (grid + study mode) -----

  function mediaFor(card) {
    let media = null;
    if (card._deckId && typeof Decks !== 'undefined') {
      const deck = Decks.get(card._deckId);
      media = deck && deck.data && deck.data.media;
    } else if (typeof App !== 'undefined' && App.getStudyData()) {
      media = App.getStudyData().media;
    }
    const src = media && card.occlusion ? media[card.occlusion.media] : null;
    return typeof src === 'string' && /^data:image\//.test(src) ? src : null;
  }

  function html(card, side) {
    const o = card && card.occlusion;
    const src = o ? mediaFor(card) : null;
    if (!src) return '';
    const boxes = o.rects.map((r, i) => {
      let cls;
      if (i === o.target) cls = side === 'back' ? 'revealed' : 'target';
      else if (o.mode === 'all') cls = 'other';
      else return '';
      const style = `left:${(r.x * 100).toFixed(2)}%;top:${(r.y * 100).toFixed(2)}%;width:${(r.w * 100).toFixed(2)}%;height:${(r.h * 100).toFixed(2)}%`;
      return `<span class="occl-box ${cls}" style="${style}">${cls === 'target' ? '?' : ''}</span>`;
    }).join('');
    return `<span class="occl"><img src="${esc(src)}" alt="" draggable="false">${boxes}</span>`;
  }

  // ----- Editor -----

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'shortcuts-backdrop';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.addEventListener('keydown', e => {
      if (!el || el.style.display === 'none') return;
      if (e.key === 'Escape') close();
      const tag = (e.target.tagName || '').toLowerCase();
      if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'input' && selected >= 0) {
        e.preventDefault();
        removeRect(selected);
      }
    });
  }

  function open() {
    if (!App.getStudyData()) return;
    build();
    image = null; rects = []; selected = -1;
    try { mode = localStorage.getItem('flashmind_occl_mode') === 'one' ? 'one' : 'all'; } catch (e) { mode = 'all'; }
    renderEditor();
    el.style.display = 'flex';
    releaseTrap = FX.trapFocus(el);
  }

  function close() {
    if (!el) return;
    el.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function renderEditor() {
    const T = i18n.t;
    el.innerHTML = `<div class="shortcuts-card occl-editor" role="dialog" aria-modal="true" aria-labelledby="occl-title">
      <h3 id="occl-title">&#128444;&#65039; ${T('occlTitle')}</h3>
      ${image ? `
        <p class="occl-hint">${T('occlDrawHint')}</p>
        <div class="occl-editor-body">
          <div class="occl-stage" id="occl-stage">
            <img src="${esc(image)}" alt="" draggable="false">
            ${rects.map((r, i) => `<span class="occl-edit-box${i === selected ? ' selected' : ''}" data-occl-box="${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"><span class="occl-edit-num">${i + 1}</span></span>`).join('')}
          </div>
          <div class="occl-side">
            <label class="editor-label">${T('occlPrompt')}</label>
            <input type="text" class="editor-input" id="occl-prompt" value="${esc(el._prompt || T('occlDefaultPrompt'))}">
            <div class="occl-modes">
              <button class="timer-option${mode === 'all' ? ' active' : ''}" data-occl-mode="all" title="${esc(T('occlModeAllHint'))}">${T('occlModeAll')}</button>
              <button class="timer-option${mode === 'one' ? ' active' : ''}" data-occl-mode="one" title="${esc(T('occlModeOneHint'))}">${T('occlModeOne')}</button>
            </div>
            <div class="occl-list">${rects.length ? rects.map((r, i) => `<div class="occl-row${i === selected ? ' selected' : ''}">
                <span class="occl-row-num">${i + 1}</span>
                <input type="text" class="editor-input" data-occl-label="${i}" value="${esc(r.label)}" placeholder="${esc(T('occlLabelHolder'))}">
                <button class="btn-icon" data-occl-del="${i}" aria-label="${esc(T('remove'))}">&times;</button>
              </div>`).join('') : `<p class="occl-empty">${T('occlNoBoxes')}</p>`}</div>
          </div>
        </div>` : `
        <p class="occl-hint">${T('occlIntro')}</p>
        <button class="dropzone occl-pick" id="occl-pick" type="button">&#128247; ${T('occlPick')}</button>`}
      <input type="file" id="occl-file" accept="image/*" hidden>
      <div class="editor-actions">
        ${image ? `<button class="btn-ghost" id="occl-change">${T('occlChange')}</button>` : ''}
        <span class="editor-actions-spacer"></span>
        <button class="btn-ghost" id="occl-cancel">${T('cancel')}</button>
        ${image ? `<button class="btn-primary" id="occl-save" ${rects.length ? '' : 'disabled'}>${T('occlCreate', { n: rects.length })}</button>` : ''}
      </div>
    </div>`;
    bindEditor();
  }

  function bindEditor() {
    const q = s => el.querySelector(s);
    const file = q('#occl-file');
    const pick = () => file.click();
    if (q('#occl-pick')) q('#occl-pick').addEventListener('click', pick);
    if (q('#occl-change')) q('#occl-change').addEventListener('click', pick);
    q('#occl-cancel').addEventListener('click', close);
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try {
        image = await downscale(file.files[0]);
        rects = []; selected = -1;
        renderEditor();
      } catch (e) { App.showToast(i18n.t('imageFailed'), 'error'); }
    });
    if (!image) return;
    const prompt = q('#occl-prompt');
    prompt.addEventListener('input', () => { el._prompt = prompt.value; });
    q('#occl-save').addEventListener('click', save);
    el.querySelectorAll('[data-occl-mode]').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.occlMode;
      try { localStorage.setItem('flashmind_occl_mode', mode); } catch (e) {}
      renderEditor();
    }));
    el.querySelectorAll('[data-occl-label]').forEach(inp => {
      inp.addEventListener('input', () => { rects[+inp.dataset.occlLabel].label = inp.value; });
      inp.addEventListener('focus', () => selectRect(+inp.dataset.occlLabel, false));
    });
    el.querySelectorAll('[data-occl-del]').forEach(b => b.addEventListener('click', () => removeRect(+b.dataset.occlDel)));
    setupDrawing(q('#occl-stage'));
  }

  function selectRect(i, rerender = true) {
    selected = i;
    if (rerender) { renderEditor(); return; }
    el.querySelectorAll('.occl-edit-box').forEach(b => b.classList.toggle('selected', +b.dataset.occlBox === i));
    el.querySelectorAll('.occl-row').forEach((r, k) => r.classList.toggle('selected', k === i));
  }

  function removeRect(i) {
    rects.splice(i, 1);
    selected = -1;
    renderEditor();
  }

  // Drag on the image to draw a box; a click on an existing box selects it.
  function setupDrawing(stage) {
    const pos = e => {
      const r = stage.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    stage.addEventListener('pointerdown', e => {
      const box = e.target.closest('[data-occl-box]');
      if (box) { selectRect(+box.dataset.occlBox); return; }
      e.preventDefault();
      const p = pos(e);
      const ghost = document.createElement('span');
      ghost.className = 'occl-edit-box drawing';
      stage.appendChild(ghost);
      draw = { start: p, ghost };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    });
    stage.addEventListener('pointermove', e => {
      if (!draw) return;
      const p = pos(e);
      const x = Math.min(p.x, draw.start.x), y = Math.min(p.y, draw.start.y);
      const w = Math.abs(p.x - draw.start.x), h = Math.abs(p.y - draw.start.y);
      Object.assign(draw.ghost.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
      draw.rect = { x, y, w, h };
    });
    const end = () => {
      if (!draw) return;
      const r = draw.rect;
      draw.ghost.remove();
      draw = null;
      // Ignore stray clicks: a box must be at least ~1.5% of each side.
      if (!r || r.w < 0.015 || r.h < 0.015) return;
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, label: '' });
      selected = rects.length - 1;
      renderEditor();
      const inp = el.querySelector(`[data-occl-label="${selected}"]`);
      if (inp) inp.focus();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  function downscale(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; // transparent PNG diagrams stay readable as JPEG
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // One card per box, all sharing the stored image.
  function buildCards(img, boxes, opts) {
    const data = App.getStudyData();
    if (!data || !img || !boxes.length) return 0;
    const key = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    data.media = Object.assign({}, data.media || {}, { [key]: img });
    const clean = boxes.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    const prompt = (opts.prompt || '').trim() || i18n.t('occlDefaultPrompt');
    const cards = boxes.map((r, i) => ({
      front: boxes.length > 1 ? `${prompt} (${i + 1}/${boxes.length})` : prompt,
      back: (r.label || '').trim() || `#${i + 1}`,
      difficulty: 'medium',
      category: opts.category || i18n.t('occlCategory'),
      occlusion: { media: key, rects: clean, target: i, mode: opts.mode === 'one' ? 'one' : 'all' }
    }));
    Flashcards.addCards(cards);
    return cards.length;
  }

  function save() {
    const prompt = (el.querySelector('#occl-prompt') || {}).value || '';
    const n = buildCards(image, rects, { prompt, mode });
    if (!n) return;
    el._prompt = '';
    close();
    App.showToast(i18n.t('occlCreated', { n }), 'success');
  }

  return { open, close, html, buildCards, mediaFor };
})();
