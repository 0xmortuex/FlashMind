// ===== Concept map across all decks =====
// Builds one concept graph over the whole library: concepts come from the
// notes' key terms, section titles and card/question categories; cards and
// questions attach to every concept they mention (across decks). Each
// concept gets a mastery score from FSRS recall, exam history (qstats) and
// filed mistakes. Edges: "part of" (term → its section/topic), prerequisite
// edges inferred client-side (A's definition mentions B ⇒ A needs B), and
// optional AI edges (prerequisites + related concepts, batched API.chat).
// Only the AI edges are stored — library-level, synced with the decks — the
// rest is derived on demand and memoised.
const ConceptMap = (() => {
  const KEY = 'flashmind_concepts_v1';
  const MAX_EDGES = 600;
  const MAX_SHOWN = 36;
  const WEAK = 0.6;

  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  const norm = s => String(s == null ? '' : s).normalize('NFC').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim().slice(0, 60);
  const safeKey = k => typeof k === 'string' && k.length > 0 && k.length <= 60 && !['__proto__', 'constructor', 'prototype'].includes(k);

  // ----- Stored AI edges: { e: [[a, b, 'p'|'r', t]], cleared } -----
  let store = null;
  function sanitize(raw) {
    const out = { e: [], cleared: 0 };
    if (!record(raw)) return out;
    out.cleared = Number.isFinite(raw.cleared) && raw.cleared > 0 ? raw.cleared : 0;
    const seen = new Set();
    (Array.isArray(raw.e) ? raw.e : []).forEach(x => {
      if (!Array.isArray(x) || !safeKey(x[0]) || !safeKey(x[1]) || x[0] === x[1] || !['p', 'r'].includes(x[2])) return;
      const t = Number.isFinite(x[3]) ? x[3] : 0;
      if (t <= out.cleared) return;
      const k = x[0] + '\u0001' + x[1] + '\u0001' + x[2];
      if (seen.has(k)) return;
      seen.add(k);
      out.e.push([x[0], x[1], x[2], t]);
    });
    out.e = out.e.slice(-MAX_EDGES);
    return out;
  }
  function load() {
    if (store) return store;
    try { store = sanitize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { store = sanitize(null); }
    return store;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* non-fatal */ }
    if (typeof Sync !== 'undefined' && Sync.schedulePush) Sync.schedulePush();
  }
  function addEdges(list, t) {
    load();
    store = sanitize({ e: store.e.concat(list.map(x => [x[0], x[1], x[2], t])), cleared: store.cleared });
    persist();
  }
  // Device sync: union of edges, newest "cleared" wins.
  function mergeRemote(raw) {
    load();
    let remote;
    try { remote = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return false; }
    if (!record(remote)) return false;
    const before = JSON.stringify(store);
    const r = sanitize(remote);
    store = sanitize({ e: store.e.concat(r.e).sort((a, b) => a[3] - b[3]), cleared: Math.max(store.cleared, r.cleared) });
    const changed = JSON.stringify(store) !== before;
    if (changed) try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* non-fatal */ }
    return changed;
  }
  function clearAi() { load(); store = { e: [], cleared: Date.now() }; persist(); }

  // ----- Graph (pure) -----
  // decks: [{id, data, srs, qstats, mistakes}], edges: stored AI edges.
  function build(decks, edges) {
    const nodes = new Map();
    const node = (label, kind) => {
      const key = norm(label);
      if (!safeKey(key) || key.length < 2) return null;
      let n = nodes.get(key);
      if (!n) { n = { key, label: String(label).trim().slice(0, 60), kind, decks: [], cards: [], qs: [], def: '' }; nodes.set(key, n); }
      if (kind === 'term') n.kind = 'term';
      return n;
    };
    const addDeck = (n, id) => { if (n && !n.decks.includes(id)) n.decks.push(id); };
    const edgeMap = new Map();
    const edge = (a, b, type, src) => {
      if (!a || !b || a === b) return;
      const k = a + '\u0001' + b + '\u0001' + type;
      if (!edgeMap.has(k)) edgeMap.set(k, { a, b, type, src });
    };
    // 1) Concepts: key terms (with definitions) and section titles.
    (decks || []).forEach(d => {
      const notes = d.data && d.data.notes;
      (notes && Array.isArray(notes.sections) ? notes.sections : []).forEach(sec => {
        const topic = sec.title ? node(sec.title, 'topic') : null;
        addDeck(topic, d.id);
        (Array.isArray(sec.keyTerms) ? sec.keyTerms : []).forEach(kt => {
          const n = kt && kt.term ? node(kt.term, 'term') : null;
          if (!n) return;
          addDeck(n, d.id);
          if (!n.def && kt.definition) n.def = String(kt.definition).slice(0, 240);
          if (topic) edge(n.key, topic.key, 'part', 'notes');
        });
      });
    });
    const terms = [...nodes.values()].filter(n => n.kind === 'term' && n.key.length >= 3);
    const mentions = text => {
      const t = norm(text);
      return terms.filter(n => t.includes(n.key));
    };
    // 2) Cards and questions attach to their category topic + every term
    //    they mention — in any deck, which is what links decks together.
    (decks || []).forEach(d => {
      const data = d.data || {};
      (Array.isArray(data.flashcards) ? data.flashcards : []).forEach(c => {
        const ref = [d.id, c.id];
        const topic = c.category ? node(c.category, 'topic') : null;
        const hits = mentions((c.front || '') + ' ' + (c.back || ''));
        if (topic) { topic.cards.push(ref); addDeck(topic, d.id); }
        hits.forEach(n => { n.cards.push(ref); addDeck(n, d.id); if (topic) edge(n.key, topic.key, 'part', 'cards'); });
      });
      (Array.isArray(data.quiz) ? data.quiz : []).forEach(q => {
        const ref = [d.id, q.id];
        const topic = q.category ? node(q.category, 'topic') : null;
        const hits = mentions((q.question || '') + ' ' + (Array.isArray(q.options) ? q.options.join(' ') : ''));
        if (topic) { topic.qs.push(ref); addDeck(topic, d.id); }
        hits.forEach(n => { n.qs.push(ref); addDeck(n, d.id); });
      });
    });
    // 3) Prerequisites from definitions: if A's definition uses term B, you
    //    need B to understand A.
    terms.forEach(a => {
      if (!a.def) return;
      const def = norm(a.def);
      terms.forEach(b => { if (b !== a && b.key.length >= 3 && def.includes(b.key) && !a.key.includes(b.key)) edge(a.key, b.key, 'pre', 'def'); });
    });
    // 4) AI edges (only between concepts that still exist).
    ((edges && edges.e) || []).forEach(x => {
      if (nodes.has(x[0]) && nodes.has(x[1])) edge(x[0], x[1], x[2] === 'p' ? 'pre' : 'rel', 'ai');
    });
    return { nodes, edges: [...edgeMap.values()] };
  }

  // Mastery 0..1 from evidence (null when there is none), plus miss count.
  // ctx: { decks: Map id→deck, now, c }
  function mastery(n, ctx) {
    let sw = 0, sv = 0, misses = 0, unseenW = 0;
    const add = (v, w) => { sv += v * w; sw += w; };
    n.cards.forEach(([did, cid]) => {
      const d = ctx.decks.get(did);
      const s = d && d.srs ? d.srs[cid] : null;
      if (s && s.reps && s.stab) {
        add(Decks.retrievability(Math.max(0, (ctx.now - (s.last || ctx.now)) / 864e5), s.stab, ctx.c || 1), 1);
        if ((s.lapses || 0) >= 2) { add(0, 0.5); misses++; }
      } else { add(0, 0.3); unseenW += 0.3; }
    });
    n.qs.forEach(([did, qid]) => {
      const d = ctx.decks.get(did);
      const st = d && d.qstats ? d.qstats[qid] : null;
      if (st && st.n) { add((st.ok + 1) / (st.n + 2), Math.min(st.n, 3)); if (st.last === 0) misses++; }
    });
    n.decks.forEach(did => {
      const d = ctx.decks.get(did);
      (d && Array.isArray(d.mistakes) ? d.mistakes : []).forEach(m => {
        const hit = n.kind === 'term' ? norm(m.question).includes(n.key) : norm(m.category) === n.key;
        if (hit) { add(0, 1); misses++; }
      });
    });
    // Only never-seen cards: not studied yet, so unknown rather than weak.
    return { m: sw > unseenW ? sv / sw : null, w: sw - unseenW, misses };
  }

  // Score every node; find weak concepts and prerequisite gaps.
  function analyse(graph, decks, now, c) {
    const ctx = { decks: new Map((decks || []).map(d => [d.id, d])), now: now == null ? Date.now() : now, c: c || 1 };
    const score = new Map();
    graph.nodes.forEach((n, k) => score.set(k, mastery(n, ctx)));
    const weak = [...graph.nodes.values()]
      .filter(n => { const s = score.get(n.key); return s.m !== null && s.m < WEAK && s.w >= 1; })
      .sort((a, b) => (score.get(a.key).m - score.get(b.key).m) || a.key.localeCompare(b.key));
    const gaps = [];
    graph.edges.forEach(e => {
      if (e.type !== 'pre') return;
      const A = score.get(e.a), B = score.get(e.b);
      if (!A || !B || A.m === null || B.m === null) return;
      if (A.m < 0.7 && B.m < 0.7 && (A.misses > 0 || A.m < 0.5)) {
        gaps.push({ a: e.a, b: e.b, ma: A.m, mb: B.m, src: e.src, score: (1 - A.m) * (1 - B.m) * (1 + 0.2 * Math.min(A.misses, 5)) });
      }
    });
    gaps.sort((x, y) => (y.score - x.score) || x.a.localeCompare(y.a));
    return { score, weak, gaps };
  }

  // Deterministic force layout for the shown subset (pure).
  function layout(keys, edges, W, H) {
    const n = keys.length;
    const idx = new Map(keys.map((k, i) => [k, i]));
    const pos = keys.map((k, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = (i % 2 ? 0.42 : 0.3) * Math.min(W, H);
      return { x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a) };
    });
    const links = edges.filter(e => idx.has(e.a) && idx.has(e.b)).map(e => [idx.get(e.a), idx.get(e.b)]);
    const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.42;
    for (let it = 0; it < 220; it++) {
      const temp = (1 - it / 220) * 18 + 0.5;
      const disp = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) { dx = 0.01 * (i - j); dy = 0.01; d = 0.015; }
        const f = (k * k) / d;
        disp[i].x += dx / d * f; disp[i].y += dy / d * f;
        disp[j].x -= dx / d * f; disp[j].y -= dy / d * f;
      }
      links.forEach(([i, j]) => {
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const f = (d * d) / k;
        disp[i].x -= dx / d * f; disp[i].y -= dy / d * f;
        disp[j].x += dx / d * f; disp[j].y += dy / d * f;
      });
      for (let i = 0; i < n; i++) {
        // Gravity keeps disconnected nodes from drifting to the borders.
        disp[i].x += (W / 2 - pos[i].x) * 0.9; disp[i].y += (H / 2 - pos[i].y) * 1.2;
        const d = Math.max(0.01, Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2));
        pos[i].x = Math.min(W - 40, Math.max(40, pos[i].x + disp[i].x / d * Math.min(d, temp)));
        pos[i].y = Math.min(H - 24, Math.max(24, pos[i].y + disp[i].y / d * Math.min(d, temp)));
      }
    }
    // Stretch the result to fill the frame (labels need the room).
    const xs = pos.map(p => p.x), ys = pos.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const fit = (v, a, b, lo, hi) => b - a < 1 ? (lo + hi) / 2 : lo + (v - a) / (b - a) * (hi - lo);
    return pos.map(p => ({ x: Math.round(fit(p.x, x0, x1, 60, W - 60)), y: Math.round(fit(p.y, y0, y1, 24, H - 34)) }));
  }

  // ----- Memo -----
  let memo = null;
  function current() {
    const decks = Decks.list();
    const P = typeof Memory !== 'undefined' ? (Memory.current() || Memory.defaults()) : { c: 1 };
    const sig = decks.map(d => d.id + ':' + (d.updatedAt || 0)).join(',') + '|' + load().e.length + '|' + P.c + '|' + new Date().toDateString();
    if (memo && memo.sig === sig) return memo;
    const graph = build(decks, load());
    const an = analyse(graph, decks, Date.now(), P.c);
    memo = { sig, graph, an, decks, view: null };
    return memo;
  }

  // ----- UI -----
  let selected = null, aiBusy = false;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const pct = m => Math.round(m * 100);
  const cls = m => m === null ? 'unknown' : m >= 0.75 ? 'good' : m >= WEAK ? 'mid' : 'bad';

  function shownKeys(cur) {
    const { graph, an } = cur;
    const keys = [];
    const push = k => { if (k && graph.nodes.has(k) && !keys.includes(k) && keys.length < MAX_SHOWN) keys.push(k); };
    an.gaps.slice(0, 8).forEach(g => { push(g.a); push(g.b); });
    an.weak.slice(0, 12).forEach(n => push(n.key));
    [...graph.nodes.values()]
      .sort((a, b) => (an.score.get(b.key).w - an.score.get(a.key).w) || a.key.localeCompare(b.key))
      .forEach(n => push(n.key));
    return keys.sort();
  }

  function svgHtml(cur) {
    const W = 520, H = 420;
    if (!cur.view) {
      const keys = shownKeys(cur);
      const set = new Set(keys);
      const edges = cur.graph.edges.filter(e => set.has(e.a) && set.has(e.b));
      cur.view = { keys, edges, pos: layout(keys, edges, W, H) };
    }
    const { keys, edges, pos } = cur.view;
    const at = new Map(keys.map((k, i) => [k, pos[i]]));
    const gapSet = new Set(cur.an.gaps.map(g => g.a + '\u0001' + g.b));
    let lines = '';
    edges.forEach(e => {
      const p = at.get(e.a), q = at.get(e.b);
      const gap = e.type === 'pre' && gapSet.has(e.a + '\u0001' + e.b);
      // Prerequisite arrows point from the prerequisite to what needs it.
      const [s, t] = e.type === 'pre' ? [q, p] : [p, q];
      lines += `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" class="cm-edge ${e.type}${gap ? ' gap' : ''}"${e.type === 'pre' ? ' marker-end="url(#cm-arrow)"' : ''}/>`;
    });
    let dots = '';
    keys.forEach((k, i) => {
      const n = cur.graph.nodes.get(k), s = cur.an.score.get(k);
      const r = Math.round(Math.min(14, 6 + Math.sqrt(s.w) * 1.6));
      const p = pos[i];
      const weak = s.m !== null && s.m < WEAK;
      dots += `<g class="cm-node ${cls(s.m)}${weak ? ' weak' : ''}${selected === k ? ' sel' : ''}${n.kind === 'topic' ? ' topic' : ''}" data-cm-node="${esc(k)}" tabindex="0" role="button" aria-label="${esc(n.label)} ${s.m === null ? '' : pct(s.m) + '%'}">
        <circle cx="${p.x}" cy="${p.y}" r="${r}"/>
        <text x="${p.x}" y="${p.y + r + 12}" text-anchor="middle">${esc(short(n.label, 18))}</text>
        <title>${esc(n.label)}${s.m === null ? '' : ' — ' + pct(s.m) + '%'}</title></g>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="cm-svg" role="img" aria-label="${esc(i18n.t('cmTitle'))}">
      <defs><marker id="cm-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="cm-arrow"/></marker></defs>
      ${lines}${dots}</svg>`;
  }

  function detailHtml(cur) {
    const T = i18n.t;
    const n = selected && cur.graph.nodes.get(selected);
    if (!n) return `<p class="cm-hint">${T('cmClickHint')}</p>`;
    const s = cur.an.score.get(n.key);
    const titles = n.decks.map(id => { const d = cur.decks.find(x => x.id === id); return d && d.data ? d.data.title : ''; }).filter(Boolean);
    const needs = cur.graph.edges.filter(e => e.type === 'pre' && e.a === n.key).map(e => cur.graph.nodes.get(e.b).label);
    return `<div class="cm-detail-head"><strong>${esc(n.label)}</strong>
        <span class="cm-badge ${cls(s.m)}">${s.m === null ? T('cmUnknown') : pct(s.m) + '%'}</span></div>
      ${n.def ? `<p class="cm-def">${esc(n.def)}</p>` : ''}
      <p class="cm-meta">${T('cmMeta', { c: n.cards.length, q: n.qs.length })}${titles.length ? ' &middot; ' + esc(titles.slice(0, 3).join(', ')) : ''}</p>
      ${needs.length ? `<p class="cm-meta">${T('cmNeeds')}: ${esc(needs.slice(0, 5).join(', '))}</p>` : ''}
      <div class="cm-actions">
        ${n.cards.length ? `<button class="btn-primary" data-cm-act="study" data-key="${esc(n.key)}">${T('cmStudy', { n: n.cards.length })}</button>` : ''}
        <button class="btn-ghost" data-cm-act="ask" data-key="${esc(n.key)}">&#128172; ${T('cmAsk')}</button>
      </div>`;
  }

  function statsCard() {
    if (typeof Decks === 'undefined') return '';
    const T = i18n.t;
    const cur = current();
    if (cur.graph.nodes.size < 3) return '';
    const label = k => esc(cur.graph.nodes.get(k).label);
    const gaps = cur.an.gaps.slice(0, 3).map(g => `<li class="cm-gap" data-cm-node="${esc(g.a)}" role="button" tabindex="0">
        ${T('cmGapLine', { a: label(g.a), b: label(g.b), pa: pct(g.ma), pb: pct(g.mb) })}</li>`).join('');
    const weak = cur.an.weak.slice(0, 8).map(n => `<button class="cm-chip bad" data-cm-node="${esc(n.key)}">${esc(short(n.label, 28))} <small>${pct(cur.an.score.get(n.key).m)}%</small></button>`).join('');
    const ai = load().e.length;
    return `<div class="stat-card cm-card" id="concept-card">
      <div class="cm-card-head">
        <h3 class="stat-card-title">&#128376;&#65039; ${T('cmTitle')}</h3>
        <span class="cm-tools">
          <button class="btn-ghost" data-cm-act="ai" ${aiBusy ? 'disabled' : ''}>&#10024; ${aiBusy ? T('cmAiBusy') : T(ai ? 'cmAiAgain' : 'cmAi')}</button>
          ${ai ? `<button class="btn-ghost" data-cm-act="clear" title="${T('cmClearHint')}">&#10005;</button>` : ''}
        </span>
      </div>
      <p class="cm-sub">${T('cmSub', { n: cur.graph.nodes.size, d: cur.decks.length, e: cur.graph.edges.filter(e => e.type === 'pre').length })}</p>
      ${gaps ? `<div class="cm-gaps-title">&#9888;&#65039; ${T('cmGapsTitle')}</div><ul class="cm-gaps">${gaps}</ul>` : `<p class="cm-hint">${T(cur.an.weak.length ? 'cmNoGaps' : 'cmNoWeak')}</p>`}
      ${weak ? `<div class="cm-chips">${weak}</div>` : ''}
      <div class="cm-map">${svgHtml(cur)}</div>
      <div class="cm-legend"><span><i class="cm-key bad"></i>${T('cmWeak')}</span><span><i class="cm-key mid"></i>${T('cmShaky')}</span><span><i class="cm-key good"></i>${T('cmStrong')}</span><span><i class="cm-key unknown"></i>${T('cmUnknown')}</span><span>&#10140; ${T('cmPreLegend')}</span></div>
      <div class="cm-detail" id="cm-detail">${detailHtml(cur)}</div>
    </div>`;
  }

  function rerenderCard() {
    const el = document.getElementById('concept-card');
    if (!el) return;
    const html = statsCard();
    if (html) el.outerHTML = html;
  }

  function select(key) {
    selected = key;
    const cur = current();
    document.querySelectorAll('.cm-node').forEach(g => g.classList.toggle('sel', g.dataset.cmNode === key));
    const d = document.getElementById('cm-detail');
    if (d) d.innerHTML = detailHtml(cur);
  }

  function studyCards(key) {
    const cur = current();
    const n = cur.graph.nodes.get(key);
    if (!n) return;
    const active = Decks.getActive();
    const items = [];
    n.cards.forEach(([did, cid]) => {
      const d = Decks.get(did);
      const c = d && d.data && (d.data.flashcards || []).find(x => x.id === cid);
      if (!c) return;
      items.push(active && active.id === did ? Object.assign({}, c) : Object.assign({}, c, { _deckId: did, _deckTitle: d.data.title || '' }));
    });
    Flashcards.startQueue(items);
  }

  function askTutor(key) {
    const cur = current();
    const n = cur.graph.nodes.get(key);
    if (!n) return;
    const active = Decks.getActive();
    const deckId = active && n.decks.includes(active.id) ? active.id : (n.decks[0] || (active && active.id));
    if (!deckId) return;
    if (!active || active.id !== deckId) App.openDeck(deckId);
    const gap = cur.an.gaps.find(g => g.a === key);
    App.switchTab('chat');
    Chat.sendMessage(gap
      ? i18n.t('cmAskGapPrompt', { a: n.label, b: cur.graph.nodes.get(gap.b).label })
      : i18n.t('cmAskPrompt', { a: n.label }));
  }

  // AI pass: batches of concept labels → prerequisite/related pairs by index.
  async function aiLink() {
    if (aiBusy) return;
    const cur = current();
    const all = [...cur.graph.nodes.values()]
      .sort((a, b) => (cur.an.score.get(b.key).w - cur.an.score.get(a.key).w) || a.key.localeCompare(b.key))
      .slice(0, 130);
    if (all.length < 3) return;
    aiBusy = true;
    rerenderCard();
    const hubs = all.slice(0, 10);
    const rest = all.slice(10);
    const batches = [];
    for (let i = 0; i < Math.max(1, rest.length); i += 40) batches.push(hubs.concat(rest.slice(i, i + 40)));
    let added = 0;
    try {
      for (const batch of batches.slice(0, 3)) {
        const list = batch.map((n, i) => `${i + 1}. ${n.label}`).join('\n');
        const prompt = 'These are concepts from a student\'s study decks (possibly different subjects). Find prerequisite relations ' +
          '(to understand A you must first understand B) and strong "related" links, including across subjects. Use only the numbers. ' +
          'At most 40 pairs in total, only confident ones.\nReturn ONLY JSON, no other text: {"pre":[[A,B]],"rel":[[A,B]]}\n\n' + list;
        const raw = await API.chat(prompt, '');
        // Tolerate a sentence of prose before the JSON object.
        const text = String(raw || ''), at = text.indexOf('{');
        const out = Parser.safeParseJSON(at > 0 ? text.slice(at) : text) || {};
        const pairs = [];
        const take = (arr, t) => (Array.isArray(arr) ? arr : []).slice(0, 40).forEach(p => {
          if (!Array.isArray(p)) return;
          const a = batch[Number(p[0]) - 1], b = batch[Number(p[1]) - 1];
          if (a && b && a !== b) pairs.push([a.key, b.key, t]);
        });
        take(out.pre, 'p'); take(out.rel, 'r');
        if (pairs.length) { addEdges(pairs, Date.now()); added += pairs.length; }
      }
      App.showToast(i18n.t('cmAiDone', { n: added }), added ? 'success' : 'info');
    } catch (e) {
      App.showToast(i18n.t('chatError'), 'error');
    } finally {
      aiBusy = false;
      memo = null;
      rerenderCard();
    }
  }

  function open() {
    App.switchTab('stats');
    setTimeout(() => {
      const el = document.getElementById('concept-card');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else App.showToast(i18n.t('cmEmpty'), 'info');
    }, 80);
  }

  function init() {
    const act = e => {
      const b = e.target.closest('[data-cm-act]');
      if (b) {
        const a = b.dataset.cmAct;
        if (a === 'study') studyCards(b.dataset.key);
        else if (a === 'ask') askTutor(b.dataset.key);
        else if (a === 'ai') aiLink();
        else if (a === 'clear') { clearAi(); memo = null; rerenderCard(); }
        return true;
      }
      const n = e.target.closest('[data-cm-node]');
      if (n) { select(n.dataset.cmNode); return true; }
      return false;
    };
    document.addEventListener('click', act);
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-cm-node]') && !e.target.closest('button')) {
        e.preventDefault(); act(e);
      }
    });
  }

  return { init, build, analyse, mastery, layout, sanitize, mergeRemote, statsCard, open, current, norm };
})();
