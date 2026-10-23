// ===== Mind Map =====
// Interactive, collapsible concept map of the study set. The default map is
// built instantly from the notes' structure (sections → key terms / points,
// no API call); "Rebuild with AI" asks for a richer concept map that is
// stored on the set (notes.mindmap). Click a node to expand it and read its
// explanation; drag to pan, buttons to zoom.
const Mindmap = (() => {
  const ROW = 42, NODE_H = 32, GAP_X = 56, MAX_LABEL = 34;
  let host = null;        // pane element the map renders into
  let tree = null;        // current tree (with layout fields)
  let expanded = new Set();
  let selected = '0';
  let zoom = 1;
  let busy = false;
  let forData = null;     // study set the expansion state belongs to

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
  function textWidth(s) {
    if (!measureCtx) {
      const c = document.createElement('canvas');
      measureCtx = c.getContext('2d');
      measureCtx.font = '500 13px Inter, sans-serif';
    }
    return measureCtx ? measureCtx.measureText(s).width : s.length * 7;
  }

  function prepare(node, path, depth, branch) {
    node._path = path;
    node._depth = depth;
    node._branch = branch;
    // Truncate until the label fits the node's maximum width.
    const pad = (depth === 0 ? 36 : 26) + (node.children.length && depth > 0 ? 22 : 0);
    const maxText = (depth === 0 ? 300 : 240) - pad;
    let n = depth === 0 ? 48 : MAX_LABEL;
    let text = short(plain(node.label), n);
    while (n > 6 && textWidth(text) > maxText) text = short(plain(node.label), --n);
    node._text = text;
    node._w = Math.ceil(textWidth(text)) + pad;
    node.children.forEach((c, i) => prepare(c, path + '.' + i, depth + 1, depth === 0 ? i % 8 : branch));
  }

  function layout() {
    const visible = [];
    let nextY = 0;
    const walk = node => {
      visible.push(node);
      const open = node.children.length && expanded.has(node._path);
      node._open = !!open;
      if (!open) { node._y = nextY; nextY += ROW; return; }
      node.children.forEach(walk);
      node._y = (node.children[0]._y + node.children[node.children.length - 1]._y) / 2;
    };
    walk(tree);
    const colW = [];
    visible.forEach(n => { colW[n._depth] = Math.max(colW[n._depth] || 0, n._w); });
    const colX = [0];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP_X;
    visible.forEach(n => { n._x = colX[n._depth]; });
    const width = colX[colX.length - 1] + colW[colW.length - 1];
    return { visible, width, height: Math.max(nextY, ROW) };
  }

  function find(path) {
    let node = tree;
    if (!node || path === '0') return node;
    for (const i of path.split('.').slice(1)) { node = node && node.children[+i]; }
    return node || null;
  }

  // ----- Rendering -----

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function svgHtml() {
    const { visible, width, height } = layout();
    const PAD = 24;
    const W = width + PAD * 2, H = height + PAD * 2 - (ROW - NODE_H);
    let links = '', nodes = '';
    visible.forEach(n => {
      const cy = PAD + n._y + NODE_H / 2;
      if (n._open) {
        n.children.forEach(c => {
          const x1 = PAD + n._x + n._w, y1 = cy;
          const x2 = PAD + c._x, y2 = PAD + c._y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          links += `<path class="mm-link branch-${c._branch}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
        });
      }
      const x = PAD + n._x, y = PAD + n._y;
      const cls = `mm-node branch-${n._depth === 0 ? 'root' : n._branch}${n._path === selected ? ' selected' : ''}${n._depth === 0 ? ' root' : ''}`;
      nodes += `<g class="${cls}" data-mm="${n._path}" tabindex="0" role="treeitem" aria-expanded="${n.children.length ? n._open : 'false'}" aria-label="${esc(n.label)}">
        <rect x="${x}" y="${y}" width="${n._w}" height="${NODE_H}" rx="${n._depth === 0 ? 16 : 9}"/>
        <text x="${x + 12}" y="${y + NODE_H / 2 + 4.5}">${esc(n._text)}</text>
        ${n.children.length && n._depth > 0 ? `<g class="mm-toggle"><circle cx="${x + n._w - 13}" cy="${y + NODE_H / 2}" r="8.5"/><text x="${x + n._w - 13}" y="${y + NODE_H / 2 + 4}" text-anchor="middle">${n._open ? '−' : n.children.length}</text></g>` : ''}
        <title>${esc(n.label)}</title>
      </g>`;
    });
    return `<svg class="mm-svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * zoom)}" height="${Math.round(H * zoom)}" role="tree" xmlns="http://www.w3.org/2000/svg">${links}${nodes}</svg>`;
  }

  function detailHtml() {
    const node = find(selected) || tree;
    const T = i18n.t;
    const trail = [];
    let path = '0';
    selected.split('.').slice(1).forEach(i => { trail.push(find(path).label); path += '.' + i; });
    return `<div class="mm-detail">
      ${trail.length ? `<div class="mm-trail">${trail.map(esc).join(' › ')}</div>` : ''}
      <h4 class="mm-detail-title">${esc(node.label)}</h4>
      ${node.detail ? `<p class="mm-detail-text">${esc(node.detail)}</p>` : ''}
      <div class="mm-detail-actions">
        <button class="btn-ghost" data-mm-act="ask">&#128172; ${T('mmAsk')}</button>
        ${node.children.length ? `<button class="btn-ghost" data-mm-act="toggle">${expanded.has(selected) ? T('mmCollapse') : T('mmExpand')}</button>` : ''}
      </div>
    </div>`;
  }

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    const T = i18n.t;
    if (forData !== data) {
      forData = data;
      expanded = new Set(['0']);
      selected = '0';
      zoom = 1;
    }
    tree = JSON.parse(JSON.stringify(source(data)));
    tree.children = tree.children || [];
    const fix = n => { n.children = Array.isArray(n.children) ? n.children : []; n.children.forEach(fix); };
    fix(tree);
    prepare(tree, '0', 0, 0);
    const isAi = !!(data.notes && data.notes.mindmap);
    host.innerHTML = `<div class="mm-wrap">
      <div class="mm-toolbar">
        <span class="mm-kind">${isAi ? '&#10024; ' + T('mmAiMap') : '&#128203; ' + T('mmOutlineMap')}</span>
        <span class="mm-tools">
          <button class="btn-icon" data-mm-act="zoom-out" aria-label="${T('mmZoomOut')}" title="${T('mmZoomOut')}">&minus;</button>
          <button class="btn-icon" data-mm-act="zoom-in" aria-label="${T('mmZoomIn')}" title="${T('mmZoomIn')}">+</button>
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
  }

  function redraw() {
    if (!host || !tree) return;
    const canvas = host.querySelector('.mm-canvas');
    const detail = host.querySelector('.mm-detail');
    if (!canvas || !detail) return;
    const sl = canvas.scrollLeft, st = canvas.scrollTop;
    canvas.innerHTML = svgHtml();
    canvas.scrollLeft = sl; canvas.scrollTop = st;
    detail.outerHTML = detailHtml();
  }

  function setAll(open) {
    const walk = n => { if (n.children.length) { if (open) expanded.add(n._path); else expanded.delete(n._path); } n.children.forEach(walk); };
    walk(tree);
    expanded.add('0');
    redraw();
  }

  function clickNode(path) {
    const node = find(path);
    if (!node) return;
    if (node.children.length && path !== '0') {
      if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
    }
    selected = path;
    redraw();
  }

  let panning = null;
  function bind() {
    const canvas = host.querySelector('.mm-canvas');
    canvas.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-mm]') || e.button !== 0) return;
      panning = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop };
      canvas.classList.add('panning');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    });
    canvas.addEventListener('pointermove', e => {
      if (!panning) return;
      canvas.scrollLeft = panning.sl - (e.clientX - panning.x);
      canvas.scrollTop = panning.st - (e.clientY - panning.y);
    });
    const end = () => { panning = null; canvas.classList.remove('panning'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
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
    const parent = selected.includes('.') ? find(selected.slice(0, selected.lastIndexOf('.'))) : null;
    App.switchTab('chat');
    Chat.sendMessage(i18n.t('mmAskPrompt', { x: node.label, y: parent ? parent.label : (tree && tree.label) || '' }));
  }

  function init() {
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      const nodeEl = e.target.closest('[data-mm]');
      if (nodeEl) { clickNode(nodeEl.dataset.mm); return; }
      const btn = e.target.closest('[data-mm-act]');
      if (!btn) return;
      const act = btn.dataset.mmAct;
      if (act === 'zoom-in') { zoom = Math.min(2, zoom + 0.2); redraw(); }
      else if (act === 'zoom-out') { zoom = Math.max(0.4, zoom - 0.2); redraw(); }
      else if (act === 'expand-all') setAll(true);
      else if (act === 'collapse-all') setAll(false);
      else if (act === 'ai') buildAi();
      else if (act === 'outline') useOutline();
      else if (act === 'ask') ask();
      else if (act === 'toggle') clickNode(selected);
    });
    document.addEventListener('keydown', e => {
      const nodeEl = e.target.closest && e.target.closest('[data-mm]');
      if (!nodeEl || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const path = nodeEl.dataset.mm;
      clickNode(path);
      const again = host && host.querySelector(`[data-mm="${path}"]`);
      if (again) again.focus();
    });
  }

  return { init, render, fromNotes, buildAi };
})();
