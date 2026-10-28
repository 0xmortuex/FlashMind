// ===== Mind Map =====
// Interactive, collapsible concept map of the study set. The default map is
// built instantly from the notes' structure (sections → key terms / points,
// no API call); "Rebuild with AI" asks for a richer concept map that is
// stored on the set (notes.mindmap). Click a node to expand it and read its
// explanation; drag to pan; zoom with the buttons, Ctrl/⌘ + wheel or a
// two-finger pinch; search highlights matches and opens their branches;
// "Focus" keeps only one branch open; arrow keys walk the tree.
const Mindmap = (() => {
  const H1 = 36, H2 = 54, GAP_Y = 12, GAP_X = 64, PAD = 28;
  const MIN_ZOOM = 0.3, MAX_ZOOM = 2.2;
  let host = null;        // pane element the map renders into
  let tree = null;        // current tree (with layout fields)
  let expanded = new Set();
  let selected = '0';
  let zoom = 1;
  let busy = false;
  let forData = null;     // study set the expansion state belongs to
  let query = '';         // search text
  let fresh = new Set();  // paths that were just revealed (they animate in once)
  let lastVisible = [];   // nodes shown by the last layout, top to bottom
  let lastSize = { w: 1, h: 1 };

  function short(s, n) {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }

  // SVG text can't hold typeset math: show formulas as readable plain text.
  function plain(s) {
    let out = String(s || '');
    for (let i = 0; i < 3; i++) out = out.replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, '$1');
    return out
      .replace(/\\(?:xrightarrow|rightarrow|to)(?:\{([^{}]*)\})?/g, (m, a) => a ? ` →(${a}) ` : ' → ')
      .replace(/\\(?:times|cdot)/g, '×')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/\$+|[{}]/g, '')
      .replace(/[_^]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Outline map straight from the generated notes.
  function fromNotes(data) {
    const T = i18n.t;
    const n = data.notes || {};
    const root = { label: data.title || T('importedSet'), detail: n.summary || '', children: [] };
    (n.sections || []).forEach(s => {
      const kids = [];
      (s.keyTerms || []).forEach(k => kids.push({ label: k.term, detail: k.definition, children: [] }));
      (s.bulletPoints || []).forEach(b => kids.push({ label: short(b, 48), detail: b, children: [] }));
      root.children.push({ label: s.title || '—', detail: s.content || '', children: kids });
    });
    if ((n.importantDates || []).length) {
      root.children.push({ label: T('importantDates'), children: n.importantDates.map(d => ({ label: short(d, 48), detail: d, children: [] })) });
    }
    if ((n.commonMistakes || []).length) {
      root.children.push({ label: T('commonMistakes'), children: n.commonMistakes.map(m => ({ label: short(m, 48), detail: m, children: [] })) });
    }
    return root;
  }

  function source(data) {
    return data.notes && data.notes.mindmap ? data.notes.mindmap : fromNotes(data);
  }

  // ----- Layout -----

  let measureCtx = null;
  let fontFamily = 'Inter, sans-serif'; // the page's own content font, read at each render
  let fontSize = 13;
  function textWidth(s, weight) {
    if (!measureCtx) {
      const c = document.createElement('canvas');
      measureCtx = c.getContext('2d');
    }
    if (!measureCtx) return s.length * 7;
    measureCtx.font = `${weight || 500} ${fontSize}px ${fontFamily}`;
    return measureCtx.measureText(s).width;
  }

  // Break `text` into at most two lines no wider than `max` px. Whatever does
  // not fit ends the second line with an ellipsis.
  function wrap(text, max, weight) {
    const words = text.split(' ');
    const lines = [''];
    let used = 0;
    for (const w of words) {
      const cur = lines[lines.length - 1];
      const cand = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(cand, weight) <= max) lines[lines.length - 1] = cand;
      else if (lines.length === 1) lines.push(w);
      else break;
      used++;
    }
    const cut = used < words.length;
    return lines.map((line, k) => {
      const ellipsis = cut && k === lines.length - 1;
      let t = line;
      while (t.length > 1 && textWidth(t + (ellipsis ? '…' : ''), weight) > max) t = t.slice(0, -1).trim();
      return ellipsis || t.length < line.length ? t.replace(/[\s,;:.]+$/, '') + '…' : t;
    });
  }

  function prepare(node, path, depth, branch) {
    node._path = path;
    node._depth = depth;
    node._branch = branch;
    const weight = depth === 0 ? 700 : depth === 1 ? 600 : 500;
    const padL = depth === 0 ? 20 : 24;
    const padR = node.children.length && depth > 0 ? 36 : 16;
    fontSize = depth === 0 ? 14 : 13; // the root is drawn larger
    node._lines = wrap(plain(node.label) || '—', depth === 0 ? 230 : depth === 1 ? 190 : 170, weight);
    node._w = Math.ceil(Math.max(...node._lines.map(l => textWidth(l, weight)))) + padL + padR + 4;
    if (depth === 0) node._w = Math.max(node._w, 130);
    node._h = (node._lines.length > 1 ? H2 : H1) + (depth === 0 ? 6 : 0);
    node._padL = padL;
    node.children.forEach((c, i) => prepare(c, path + '.' + i, depth + 1, depth === 0 ? i % 8 : branch));
  }

  function layout() {
    const visible = [];
    let nextY = 0;
    const walk = node => {
      visible.push(node);
      const open = node.children.length && expanded.has(node._path);
      node._open = !!open;
      if (!open) { node._y = nextY; nextY += node._h + GAP_Y; return; }
      node.children.forEach(walk);
      const first = node.children[0], last = node.children[node.children.length - 1];
      node._y = ((first._y + first._h / 2) + (last._y + last._h / 2)) / 2 - node._h / 2;
    };
    walk(tree);
    const minY = Math.min(...visible.map(n => n._y));
    visible.forEach(n => { n._y -= minY; });
    const colW = [];
    visible.forEach(n => { colW[n._depth] = Math.max(colW[n._depth] || 0, n._w); });
    const colX = [0];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP_X;
    visible.forEach(n => { n._x = colX[n._depth]; });
    const width = colX[colX.length - 1] + colW[colW.length - 1];
    const height = Math.max(...visible.map(n => n._y + n._h));
    lastVisible = visible;
    lastSize = { w: width + PAD * 2, h: height + PAD * 2 };
    return visible;
  }

  function find(path) {
    let node = tree;
    if (!node || path === '0') return node;
    for (const i of path.split('.').slice(1)) { node = node && node.children[+i]; }
    return node || null;
  }

  function parentPath(path) {
    return path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : null;
  }

  // ----- Search -----

  function norm(s) {
    return String(s || '').toLocaleLowerCase(i18n.getLang() === 'tr' ? 'tr' : 'en');
  }

  // Paths of the nodes whose title or explanation contains the search text.
  function matches() {
    const set = new Set();
    const q = norm(query).trim();
    if (!q || !tree) return set;
    const walk = n => {
      if (norm(plain(n.label)).includes(q) || norm(plain(n.detail)).includes(q)) set.add(n._path);
      n.children.forEach(walk);
    };
    walk(tree);
    return set;
  }

  // Open every branch that leads to a match.
  function revealMatches() {
    matches().forEach(p => {
      for (let i = p.indexOf('.'); i !== -1; i = p.indexOf('.', i + 1)) expanded.add(p.slice(0, i));
    });
  }

  // ----- Rendering -----

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function svgHtml() {
    const visible = layout();
    const W = lastSize.w, H = lastSize.h;
    const hits = matches();
    const searching = !!norm(query).trim();
    let links = '', nodes = '';
    visible.forEach(n => {
      if (n._open) {
        n.children.forEach(c => {
          const x1 = PAD + n._x + n._w, y1 = PAD + n._y + n._h / 2;
          const x2 = PAD + c._x, y2 = PAD + c._y + c._h / 2;
          const mx = (x1 + x2) / 2;
          const dim = searching && !hits.has(c._path);
          links += `<path class="mm-link branch-${c._branch} d${c._depth}${fresh.has(c._path) ? ' fresh' : ''}${dim ? ' dim' : ''}" pathLength="1" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
        });
      }
      const x = PAD + n._x, y = PAD + n._y;
      const root = n._depth === 0;
      const hit = hits.has(n._path);
      const cls = `mm-node branch-${root ? 'root' : n._branch} d${n._depth}${root ? ' root' : ''}${n._path === selected ? ' selected' : ''}${hit ? ' match' : ''}${searching && !hit ? ' dim' : ''}${fresh.has(n._path) ? ' fresh' : ''}`;
      const lineH = 16, first = y + n._h / 2 - ((n._lines.length - 1) * lineH) / 2 + 4.5;
      const tx = x + n._padL;
      const text = n._lines.map((l, i) => `<tspan x="${tx}" y="${first + i * lineH}">${esc(l)}</tspan>`).join('');
      const kids = n.children.length;
      nodes += `<g class="${cls}" data-mm="${n._path}" tabindex="0" role="treeitem" aria-expanded="${kids ? n._open : 'false'}" aria-label="${esc(plain(n.label))}">
        <rect class="mm-bg" x="${x}" y="${y}" width="${n._w}" height="${n._h}" rx="${root ? 20 : 14}"/>
        ${root ? `<rect class="mm-gloss" x="${x}" y="${y}" width="${n._w}" height="${n._h / 2}" rx="20"/>` : `<rect class="mm-bar" x="${x + 9}" y="${y + 9}" width="4" height="${n._h - 18}" rx="2"/>`}
        <text class="mm-label" x="${tx}" y="${first}">${text}</text>
        ${kids && !root ? `<g class="mm-toggle"><circle cx="${x + n._w - 18}" cy="${y + n._h / 2}" r="10"/><text x="${x + n._w - 18}" y="${y + n._h / 2 + 4}" text-anchor="middle">${n._open ? '−' : kids}</text></g>` : ''}
        <title>${esc(plain(n.label))}</title>
      </g>`;
    });
    fresh = new Set();
    return `<svg class="mm-svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * zoom)}" height="${Math.round(H * zoom)}" role="tree" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="mm-root-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--primary-hover)"/><stop offset="1" style="stop-color:color-mix(in srgb, var(--primary-hover) 62%, #000)"/></linearGradient></defs>
      ${links}${nodes}</svg>`;
  }

  function detailHtml() {
    const node = find(selected) || tree;
    const T = i18n.t;
    const trail = [];
    let path = '0';
    selected.split('.').slice(1).forEach(i => { trail.push(find(path).label); path += '.' + i; });
    const branch = node._depth === 0 ? 'root' : node._branch;
    return `<div class="mm-detail branch-${branch}">
      ${trail.length ? `<div class="mm-trail">${trail.map(esc).join(' › ')}</div>` : ''}
      <h4 class="mm-detail-title">${esc(node.label)}</h4>
      ${node.detail ? `<p class="mm-detail-text">${esc(node.detail)}</p>` : ''}
      <div class="mm-detail-actions">
        <button class="btn-ghost" data-mm-act="ask">&#128172; ${T('mmAsk')}</button>
        ${node.children.length ? `<button class="btn-ghost" data-mm-act="toggle">${expanded.has(selected) ? T('mmCollapse') : T('mmExpand')}</button>` : ''}
        ${node._depth > 0 && node.children.length ? `<button class="btn-ghost" data-mm-act="focus">&#127919; ${T('mmFocus')}</button>` : ''}
      </div>
    </div>`;
  }

  function countText() {
    if (!norm(query).trim()) return '';
    const n = matches().size;
    return n ? i18n.t('mmMatches', { n }) : i18n.t('mmNoMatches');
  }

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    const T = i18n.t;
    const opening = forData !== data;
    if (opening) {
      forData = data;
      expanded = new Set(['0']);
      selected = '0';
      zoom = 1;
      query = '';
      fresh = new Set();
    }
    tree = JSON.parse(JSON.stringify(source(data)));
    tree.children = tree.children || [];
    const fix = n => { n.children = Array.isArray(n.children) ? n.children : []; n.children.forEach(fix); };
    fix(tree);
    fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-content').trim() || fontFamily;
    prepare(tree, '0', 0, 0);
    const isAi = !!(data.notes && data.notes.mindmap);
    host.innerHTML = `<div class="mm-wrap">
      <div class="mm-toolbar">
        <span class="mm-kind">${isAi ? '&#10024; ' + T('mmAiMap') : '&#128203; ' + T('mmOutlineMap')}</span>
        <span class="mm-tools">
          <input type="search" class="mm-search" data-mm-search placeholder="${esc(T('mmSearch'))}" aria-label="${esc(T('mmSearch'))}" value="${esc(query)}" autocomplete="off">
          <span class="mm-count" data-mm-count role="status" aria-live="polite">${esc(countText())}</span>
          <button class="btn-icon" data-mm-act="zoom-out" aria-label="${T('mmZoomOut')}" title="${T('mmZoomOut')}">&minus;</button>
          <button class="btn-icon" data-mm-act="zoom-in" aria-label="${T('mmZoomIn')}" title="${T('mmZoomIn')}">+</button>
          <button class="btn-icon" data-mm-act="fit" aria-label="${T('mmFit')}" title="${T('mmFit')}">&#9635;</button>
          <button class="btn-icon" data-mm-act="full" aria-label="${T('mmFull')}" title="${T('mmFull')}">&#x26F6;</button>
          <button class="btn-ghost" data-mm-act="expand-all">${T('mmExpandAll')}</button>
          <button class="btn-ghost" data-mm-act="collapse-all">${T('mmCollapseAll')}</button>
          ${isAi ? `<button class="btn-ghost" data-mm-act="outline">${T('mmUseOutline')}</button>` : ''}
          <button class="btn-ghost mm-ai-btn" data-mm-act="ai" ${busy ? 'disabled' : ''}>${busy ? T('mmBuilding') : '&#10024; ' + (isAi ? T('mmRebuildAi') : T('mmBuildAi'))}</button>
        </span>
      </div>
      <div class="mm-canvas no-math">${svgHtml()}</div>
      ${detailHtml()}
    </div>`;
    bind();
    if (opening) { needCenter = true; centerOn('0'); }
  }

  // Scroll so the node is in the middle of the visible map (the root sits halfway down a tall tree).
  // A pane that is still hidden has no size yet: the canvas's ResizeObserver (see bind) retries.
  let needCenter = false;
  function centerOn(path) {
    const canvas = host && host.querySelector('.mm-canvas');
    const n = lastVisible.find(v => v._path === path);
    if (!canvas || !n || !canvas.clientHeight) return;
    canvas.scrollTop = Math.max(0, (PAD + n._y + n._h / 2) * zoom - canvas.clientHeight / 2);
    canvas.scrollLeft = 0;
    needCenter = false;
  }

  function redraw(focusPath) {
    if (!host || !tree) return;
    const canvas = host.querySelector('.mm-canvas');
    const detail = host.querySelector('.mm-detail');
    if (!canvas || !detail) return;
    const sl = canvas.scrollLeft, st = canvas.scrollTop;
    canvas.innerHTML = svgHtml();
    canvas.scrollLeft = sl; canvas.scrollTop = st;
    detail.outerHTML = detailHtml();
    const count = host.querySelector('[data-mm-count]');
    if (count) count.textContent = countText();
    if (focusPath) {
      const el = canvas.querySelector(`[data-mm="${focusPath}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  // Resize the existing drawing without rebuilding it (cheap enough for wheel and pinch).
  // `anchor` ({x, y} inside the canvas) is the point that stays under the cursor / fingers.
  function setZoom(z, anchor) {
    const canvas = host && host.querySelector('.mm-canvas');
    const svg = canvas && canvas.querySelector('.mm-svg');
    const old = zoom;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (!svg) return;
    svg.setAttribute('width', Math.round(lastSize.w * zoom));
    svg.setAttribute('height', Math.round(lastSize.h * zoom));
    if (anchor) {
      canvas.scrollLeft = (canvas.scrollLeft + anchor.x) * (zoom / old) - anchor.x;
      canvas.scrollTop = (canvas.scrollTop + anchor.y) * (zoom / old) - anchor.y;
    }
  }

  function fit() {
    const canvas = host && host.querySelector('.mm-canvas');
    if (!canvas) return;
    setZoom(Math.min(1.4, canvas.clientWidth / lastSize.w, canvas.clientHeight / lastSize.h));
    canvas.scrollLeft = 0; canvas.scrollTop = 0;
  }

  function setAll(open) {
    const walk = n => { if (n.children.length) { if (open) expanded.add(n._path); else expanded.delete(n._path); } n.children.forEach(walk); };
    walk(tree);
    expanded.add('0');
    redraw();
  }

  // Mark a node and its children as just revealed so they animate in once.
  function reveal(path) {
    const node = find(path);
    if (node) fresh = new Set(node.children.map(c => c._path).concat(path));
  }

  function clickNode(path) {
    const node = find(path);
    if (!node) return;
    if (node.children.length && path !== '0') {
      if (expanded.has(path)) expanded.delete(path); else { expanded.add(path); reveal(path); }
    }
    selected = path;
    redraw();
  }

  // Keep only the way to this node, and the node itself, open.
  function focusBranch(path) {
    const parts = path.split('.');
    expanded = new Set(parts.map((_, i) => parts.slice(0, i + 1).join('.')));
    reveal(path);
    selected = path;
    redraw(path);
  }

  // Arrow keys: ↓/↑ next/previous visible node, → first child (opening it), ← parent.
  function arrow(path, key) {
    const node = find(path);
    if (!node) return;
    let target = null;
    const i = lastVisible.findIndex(n => n._path === path);
    if (key === 'ArrowDown') target = lastVisible[i + 1];
    else if (key === 'ArrowUp') target = lastVisible[i - 1];
    else if (key === 'ArrowLeft') target = parentPath(path) ? find(parentPath(path)) : null;
    else if (key === 'ArrowRight' && node.children.length) {
      if (!expanded.has(path)) { expanded.add(path); reveal(path); }
      target = node.children[0];
    }
    if (!target) return;
    selected = target._path;
    redraw(selected);
    const el = host.querySelector(`[data-mm="${selected}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function toggleFull() {
    const wrap = host && host.querySelector('.mm-wrap');
    if (!wrap) return;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (!wrap.requestFullscreen) { App.showToast(i18n.t('mmFullFailed'), 'error'); return; }
    wrap.requestFullscreen().catch(err => App.showToast(i18n.t('mmFullFailed') + ' ' + err.message, 'error'));
  }

  // Drag to pan (mouse and touch), two fingers to zoom. A drag never counts as a click on a node.
  let suppressClick = false;
  function bind() {
    const canvas = host.querySelector('.mm-canvas');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (needCenter) centerOn('0'); }).observe(canvas);
    const ptrs = new Map();
    let pan = null, pinch = null;
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
        pan = null;
      } else if (ptrs.size === 1) {
        pan = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop, moved: false, id: e.pointerId };
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const r = canvas.getBoundingClientRect();
        setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top });
        suppressClick = true;
        return;
      }
      if (!pan || pan.id !== e.pointerId) return;
      if (!pan.moved && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 6) return;
      if (!pan.moved) {
        pan.moved = true;
        canvas.classList.add('panning');
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      }
      canvas.scrollLeft = pan.sl - (e.clientX - pan.x);
      canvas.scrollTop = pan.st - (e.clientY - pan.y);
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (pan && pan.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      if (pinch && ptrs.size < 2) { pinch = null; setTimeout(() => { suppressClick = false; }, 0); }
      if (!ptrs.size) { pan = null; canvas.classList.remove('panning'); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return; // a plain wheel scrolls the map
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
  }

  async function buildAi() {
    const data = App.getStudyData();
    if (!data || busy) return;
    busy = true;
    render(null, data);
    const prompt = 'Build a concept mind map of this study material. Return ONLY JSON, no other text: ' +
      '{"type":"mindmap","root":{"label":"central topic","detail":"one-sentence overview","children":[{"label":"main idea (max 5 words)","detail":"one-sentence explanation","children":[]}]}}. ' +
      'Rules: 4-7 main branches; each branch has 2-5 sub-nodes; at most 3 levels below the root; labels at most 6 words; ' +
      'every node has a short "detail" sentence; connect related ideas the way a teacher would draw them on the board. ' +
      'Write it in the language of the material.';
    try {
      const raw = await API.chat(prompt, App.getOriginalText() || JSON.stringify({ title: data.title, notes: data.notes }));
      const obj = Parser.safeParseJSON(raw);
      const root = obj && (obj.root || obj.mindmap || (obj.label ? obj : null));
      if (App.getStudyData() !== data) return;
      const clean = Parser.normalizeStudyData({ title: data.title, notes: { mindmap: root } }).notes.mindmap;
      if (!clean || !clean.children.length) throw new Error('empty map');
      data.notes.mindmap = clean;
      App.persistActiveDeck();
      forData = null; // fresh expansion state for the new tree
      App.showToast(i18n.t('mmAiDone'), 'success');
    } catch (err) {
      App.showToast(i18n.t('mmAiFailed') + ' ' + err.message, 'error');
    } finally {
      busy = false;
      if (App.getStudyData() === data) render(null, data);
    }
  }

  function useOutline() {
    const data = App.getStudyData();
    if (!data || !data.notes) return;
    delete data.notes.mindmap;
    App.persistActiveDeck();
    forData = null;
    render(null, data);
  }

  function ask() {
    const node = find(selected);
    if (!node) return;
    const parent = parentPath(selected) ? find(parentPath(selected)) : null;
    App.switchTab('chat');
    Chat.sendMessage(i18n.t('mmAskPrompt', { x: node.label, y: parent ? parent.label : (tree && tree.label) || '' }));
  }

  function init() {
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      if (suppressClick) { suppressClick = false; return; }
      const nodeEl = e.target.closest('[data-mm]');
      if (nodeEl) { clickNode(nodeEl.dataset.mm); return; }
      const btn = e.target.closest('[data-mm-act]');
      if (!btn) return;
      const act = btn.dataset.mmAct;
      if (act === 'zoom-in') setZoom(zoom + 0.2);
      else if (act === 'zoom-out') setZoom(zoom - 0.2);
      else if (act === 'fit') fit();
      else if (act === 'full') toggleFull();
      else if (act === 'expand-all') setAll(true);
      else if (act === 'collapse-all') setAll(false);
      else if (act === 'ai') buildAi();
      else if (act === 'outline') useOutline();
      else if (act === 'ask') ask();
      else if (act === 'toggle') clickNode(selected);
      else if (act === 'focus') focusBranch(selected);
    });
    document.addEventListener('dblclick', e => {
      if (!host || !host.contains(e.target)) return;
      const nodeEl = e.target.closest('[data-mm]');
      if (!nodeEl || nodeEl.dataset.mm === '0') return;
      const node = find(nodeEl.dataset.mm);
      if (node && node.children.length) focusBranch(nodeEl.dataset.mm);
    });
    document.addEventListener('input', e => {
      if (!host || !e.target.matches || !e.target.matches('[data-mm-search]') || !host.contains(e.target)) return;
      query = e.target.value;
      revealMatches();
      redraw();
    });
    document.addEventListener('keydown', e => {
      if (!host || !host.contains(e.target)) return;
      if (e.target.matches && e.target.matches('[data-mm-search]')) {
        if (e.key === 'Escape' && query) { e.preventDefault(); query = ''; e.target.value = ''; redraw(); }
        if (e.key === 'Enter') {
          const first = [...matches()][0];
          if (first) {
            e.preventDefault();
            selected = first;
            redraw();
            const el = host.querySelector(`[data-mm="${first}"]`);
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
          }
        }
        return;
      }
      const nodeEl = e.target.closest && e.target.closest('[data-mm]');
      if (!nodeEl) return;
      const path = nodeEl.dataset.mm;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickNode(path);
        const again = host && host.querySelector(`[data-mm="${path}"]`);
        if (again) again.focus();
      } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        arrow(path, e.key);
      }
    });
  }

  return { init, render, fromNotes, buildAi };
})();
