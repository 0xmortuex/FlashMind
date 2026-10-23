// ===== Math rendering (KaTeX) =====
// Formulas written as $...$, $$...$$, \( ... \) or \[ ... \] anywhere in the
// study UI (notes, cards, exam, chat) are typeset with KaTeX. The library is
// only fetched the first time a delimiter actually appears, and a single
// MutationObserver catches every module's re-render, so no module has to
// call this explicitly.
const MathRender = (() => {
  const VERSION = '0.16.9';
  const CDN = `https://cdnjs.cloudflare.com/ajax/libs/KaTeX/${VERSION}/`;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'NOSCRIPT']);
  const QUICK = /\$|\\\(|\\\[/;
  let libPromise = null;
  let failed = false;
  let pending = new Set();
  let scheduled = false;

  function loadLib() {
    if (window.katex) return Promise.resolve(window.katex);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = CDN + 'katex.min.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = CDN + 'katex.min.js';
      s.onload = () => window.katex ? resolve(window.katex) : reject(new Error('KaTeX missing'));
      s.onerror = () => { failed = true; libPromise = null; reject(new Error('Could not load KaTeX')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // Split a string into text and math segments. Inline $...$ follows the
  // pandoc rule so prices ("$5 and $10") stay text: no space just inside
  // the dollars and no digit right after the closing one.
  function split(text) {
    const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]*?[^\s$\\])\$(?!\d)|\$(?!\s)([^\s$\\])\$(?!\d)/g;
    const out = [];
    let last = 0, m;
    while ((m = re.exec(text))) {
      const display = m[1] !== undefined || m[2] !== undefined;
      const tex = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      if (!tex || !tex.trim()) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ tex: repairTex(tex), display });
      last = re.lastIndex;
    }
    if (!out.length) return null;
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  // A model that forgot to double its backslashes inside JSON turns "\frac"
  // into a form-feed + "rac", "\times" into a tab + "imes", etc. Inside math
  // those control characters can only have been a lost backslash.
  function repairTex(tex) {
    return tex.replace(/\f/g, '\\f').replace(/\t/g, '\\t').replace(/\x08/g, '\\b').replace(/\r(?=[a-zA-Z])/g, '\\r');
  }

  function textNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!QUICK.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        for (let p = node.parentNode; p && p !== document.body; p = p.parentNode) {
          if (p.nodeType !== 1) continue;
          if (SKIP.has(p.tagName) || p.isContentEditable || p.classList.contains('katex') || p.classList.contains('no-math')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  function renderNode(katex, node) {
    const parts = split(node.nodeValue);
    if (!parts || !node.parentNode) return;
    const frag = document.createDocumentFragment();
    parts.forEach(p => {
      if (p.text !== undefined) { frag.appendChild(document.createTextNode(p.text)); return; }
      const span = document.createElement('span');
      span.className = p.display ? 'math-display' : 'math-inline';
      try {
        katex.render(p.tex, span, { displayMode: p.display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
      } catch (e) {
        span.textContent = p.tex;
      }
      frag.appendChild(span);
    });
    node.parentNode.replaceChild(frag, node);
  }

  async function typeset(root) {
    if ((failed && !window.katex) || !root) return;
    const nodes = textNodes(root).filter(n => split(n.nodeValue));
    if (!nodes.length) return;
    let katex;
    try { katex = await loadLib(); } catch (e) { return; }
    nodes.forEach(n => { if (n.isConnected) renderNode(katex, n); });
  }

  function flush() {
    scheduled = false;
    const roots = [...pending];
    pending = new Set();
    // Drop roots nested inside other pending roots.
    roots.filter(r => r.isConnected && !roots.some(o => o !== r && o.contains(r))).forEach(r => typeset(r));
  }

  function queue(node) {
    const root = node.nodeType === 1 ? node : node.parentNode;
    if (!root || root.closest && root.closest('.katex')) return;
    pending.add(root);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }

  function init() {
    if (!('MutationObserver' in window)) return;
    new MutationObserver(records => {
      records.forEach(r => {
        if (r.type === 'characterData') { if (QUICK.test(r.target.nodeValue || '')) queue(r.target); return; }
        r.addedNodes.forEach(n => {
          if ((n.nodeType === 1 || n.nodeType === 3) && QUICK.test(n.textContent || '')) queue(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Offline when the library was first needed: try again once back online.
    window.addEventListener('online', () => { if (failed) { failed = false; typeset(document.body); } });
    typeset(document.body);
  }

  return { init, typeset, split };
})();
