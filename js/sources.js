// ===== Sources =====
// A deck can be built from several pieces of material (a PDF, a web page, a
// YouTube transcript, pasted notes...). Each one is kept as a source on the
// study set (data.sources) so it can be toggled in or out of the AI context,
// re-read in a viewer, and used to verify citations: a quote the AI claims
// came from your material is looked up in the actual text, and anything that
// can't be found is flagged instead of being trusted.
const Sources = (() => {
  const GEN_BUDGET = 15000;     // the generator's input limit
  const CONTEXT_BUDGET = 30000; // per AI request (chat, audio, mind map)
  const KIND_ICON = { paste: '📝', pdf: '📄', url: '🌐', youtube: '▶️', image: '📷', file: '📎' };
  let staged = [];              // input-view tray, before generation
  let pasteMeta = null;         // where the paste box text came from (URL fetch)

  // ----- Model -----

  function make(name, kind, text) {
    return {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(name || '').trim().slice(0, 160) || i18n.t('srcUntitled'),
      kind: KIND_ICON[kind] ? kind : 'paste',
      text: String(text || '').slice(0, 60000),
      enabled: true,
      addedAt: Date.now()
    };
  }

  function kindFromName(name) {
    if (/\.pdf$/i.test(name)) return 'pdf';
    if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(name)) return 'image';
    return 'file';
  }

  function kindFromUrl(url) {
    return /(?:youtube\.com|youtu\.be)\//i.test(url) ? 'youtube' : 'url';
  }

  function nameFromUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/$/, '');
      return (u.hostname.replace(/^www\./, '') + (path && path.length < 60 ? path : '')).slice(0, 120);
    } catch (e) { return url.slice(0, 120); }
  }

  // Pasted text gets a name from its first line.
  function nameFromText(text) {
    const first = String(text).trim().split(/\n/)[0].trim();
    return first.length > 48 ? first.slice(0, 45).trim() + '…' : (first || i18n.t('srcPasted'));
  }

  // Trim a set of texts to fit `budget` characters in total, giving each a
  // share proportional to its length (small sources are kept whole).
  function fit(list, budget) {
    const total = list.reduce((n, s) => n + s.text.length, 0);
    if (total <= budget) return list.map(s => s.text);
    const out = new Array(list.length);
    let left = budget;
    const order = list.map((s, i) => i).sort((a, b) => list[a].text.length - list[b].text.length);
    order.forEach((i, k) => {
      const share = Math.floor(left / (order.length - k));
      out[i] = list[i].text.slice(0, share);
      left -= out[i].length;
    });
    return out;
  }

  function joinWithHeaders(list, budget) {
    const overhead = list.reduce((n, s) => n + s.name.length + 20, 0);
    const texts = fit(list, Math.max(1000, budget - overhead));
    return list.map((s, i) => `=== Source ${i + 1}: ${s.name} ===\n${texts[i]}`).join('\n\n');
  }

  // Combined generator input for several staged sources.
  function forGeneration(list) {
    if (list.length === 1) return list[0].text.slice(0, GEN_BUDGET);
    return joinWithHeaders(list, GEN_BUDGET);
  }

  // AI context for the open set: enabled sources only.
  function contextText(data) {
    const list = data && Array.isArray(data.sources) ? data.sources.filter(s => s.enabled !== false) : [];
    if (!list.length) return '';
    return joinWithHeaders(list, CONTEXT_BUDGET);
  }

  // Older decks only stored one source string; surface it as a source so the
  // bar, viewer and citations work for them too. Topic prompts aren't material.
  function adoptLegacy(data, originalText) {
    if (!data || (Array.isArray(data.sources) && data.sources.length)) return false;
    const text = String(originalText || '').replace(/\n\n\[(Difficulty|Formatting) instruction:[^\]]*\]/g, '').trim();
    if (!text || /^Generate comprehensive study materials about:/.test(text)) return false;
    data.sources = [Object.assign(make(i18n.t('srcOriginal'), 'paste', text), { addedAt: 0 })];
    return true;
  }

  // ----- Text matching (citations + passage lookup) -----

  // Lowercased letters/digits with single spaces, plus a map from each
  // normalized char back to its index in the original text.
  function norm(text) {
    let out = '';
    const map = [];
    let space = true;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i].toLocaleLowerCase('tr')[0];
      if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; map.push(i); space = false; }
      else if (!space) { out += ' '; map.push(i); space = true; }
    }
    return { out, map };
  }

  const normCache = new WeakMap();
  function normOf(src) {
    let n = normCache.get(src);
    if (!n || n.text !== src.text) { n = Object.assign(norm(src.text), { text: src.text }); normCache.set(src, n); }
    return n;
  }

  // Everything a quote may legitimately come from: the sources, and the
  // generated notes (decks without stored material are grounded in those).
  function candidates(data) {
    const list = data && Array.isArray(data.sources) ? data.sources.slice() : [];
    if (data && data.notes) {
      const n = data.notes;
      const parts = [n.summary];
      (n.sections || []).forEach(s => {
        parts.push(s.title, s.content);
        (s.keyTerms || []).forEach(k => parts.push(k.term + ': ' + k.definition));
        (s.bulletPoints || []).forEach(b => parts.push(b));
      });
      (n.importantDates || []).forEach(d => parts.push(d));
      (n.commonMistakes || []).forEach(m => parts.push(m));
      const notesSrc = data._notesSource && data._notesSource.text === parts.filter(Boolean).join('\n')
        ? data._notesSource
        : { id: '__notes', name: i18n.t('tabNotes'), kind: 'notes', text: parts.filter(Boolean).join('\n') };
      Object.defineProperty(data, '_notesSource', { value: notesSrc, configurable: true, enumerable: false, writable: true });
      list.push(notesSrc);
    }
    return list;
  }

  // Find a quote in the material. Exact (normalized) matches win; otherwise
  // a quote counts as found when at least half of its 5-word shingles appear
  // in one source (minor paraphrase / punctuation drift).
  function locate(quote, data) {
    const q = norm(String(quote || '')).out.trim();
    if (q.length < 6) return null;
    const list = candidates(data);
    for (const src of list) {
      const n = normOf(src);
      const idx = n.out.indexOf(q);
      if (idx >= 0) return { source: src, start: n.map[idx], end: n.map[idx + q.length - 1] + 1, exact: true };
    }
    const words = q.split(' ');
    if (words.length < 6) return null;
    const shingles = [];
    for (let i = 0; i + 5 <= words.length; i++) shingles.push(words.slice(i, i + 5).join(' '));
    let best = null;
    list.forEach(src => {
      const n = normOf(src);
      let hits = 0, first = -1, last = -1;
      shingles.forEach(sh => {
        const at = n.out.indexOf(sh);
        if (at >= 0) { hits++; if (first < 0 || at < first) first = at; last = Math.max(last, at + sh.length); }
      });
      const ratio = hits / shingles.length;
      if (ratio >= 0.5 && (!best || ratio > best.ratio)) {
        best = { source: src, start: n.map[first], end: n.map[Math.min(last, n.map.length) - 1] + 1, exact: false, ratio };
      }
    });
    return best;
  }

  const STOP = new Set(('the and for are but not you all any can her was one our out has have this that with from they will what when where which there their about into than then them these those been were also such more most other some only over very your '
    + 've bir bu da de ile için gibi daha çok olan olarak ama veya ise ki ne mi en her şu o ya hem kadar sonra önce göre arasında').split(' '));

  // Best supporting passage (2–3 sentences) in the sources for a piece of the
  // notes: rare-term overlap scoring, no AI call.
  function bestPassage(query, data) {
    const list = data && Array.isArray(data.sources) ? data.sources : [];
    if (!list.length) return null;
    const terms = [...new Set(norm(query).out.split(' ').filter(w => w.length >= 4 && !STOP.has(w)))];
    if (!terms.length) return null;
    let best = null;
    list.forEach(src => {
      const text = src.text;
      const sentences = [];
      const re = /[^.!?\n]+[.!?]*\s*/g;
      let m;
      while ((m = re.exec(text))) { if (m[0].trim()) sentences.push({ start: m.index, end: m.index + m[0].length }); }
      for (let i = 0; i < sentences.length; i++) {
        let j = i, len = 0;
        while (j < sentences.length && len < 320) { len += sentences[j].end - sentences[j].start; j++; }
        const start = sentences[i].start, end = sentences[j - 1].end;
        const window = norm(text.slice(start, end)).out;
        let score = 0;
        terms.forEach(t => { if (window.includes(t)) score += Math.min(3, t.length / 3); });
        if (!best || score > best.score) best = { source: src, start, end, score };
      }
    });
    return best && best.score > 2 ? best : null;
  }

  // ----- Shared rendering -----

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function icon(kind) { return KIND_ICON[kind] || (kind === 'notes' ? '🗒️' : '📎'); }

  // Citation chips under an AI answer: verified quotes link to the source.
  function citationsHtml(citations, data) {
    if (!citations || !citations.length) return '';
    const T = i18n.t;
    const rows = citations.map(q => {
      const hit = locate(q, data);
      const short = q.length > 180 ? q.slice(0, 177) + '…' : q;
      if (!hit) {
        return `<div class="citation unverified" title="${esc(T('citeUnverifiedHint'))}">
          <span class="citation-badge">&#9888; ${T('citeUnverified')}</span>
          <span class="citation-quote">“${esc(short)}”</span></div>`;
      }
      return `<button class="citation${hit.exact ? '' : ' partial'}" data-src-act="view" data-src="${esc(hit.source.id)}" data-start="${hit.start}" data-end="${hit.end}">
        <span class="citation-badge">${icon(hit.source.kind)} ${esc(hit.source.name)}${hit.exact ? '' : ' ≈'}</span>
        <span class="citation-quote">“${esc(short)}”</span></button>`;
    }).join('');
    return `<div class="citations"><div class="citations-label">${T('citeLabel')}</div>${rows}</div>`;
  }

  // Sources bar at the top of the Notes tab.
  function barHtml(data) {
    const T = i18n.t;
    const list = data && Array.isArray(data.sources) ? data.sources : [];
    const chips = list.map(s => `<span class="source-chip${s.enabled === false ? ' off' : ''}">
        <label class="source-chip-toggle" title="${esc(T('srcToggleHint'))}">
          <input type="checkbox" data-src-act="toggle" data-src="${esc(s.id)}" ${s.enabled === false ? '' : 'checked'}>
        </label>
        <button class="source-chip-name" data-src-act="view" data-src="${esc(s.id)}" title="${esc(s.name)}">${icon(s.kind)} ${esc(s.name)}</button>
        <button class="source-chip-x" data-src-act="remove" data-src="${esc(s.id)}" aria-label="${esc(T('srcRemove'))}" title="${esc(T('srcRemove'))}">&times;</button>
      </span>`).join('');
    return `<div class="sources-bar">
      <span class="sources-bar-label">${T('srcBarLabel', { n: list.length })}</span>
      ${chips}
      <button class="btn-ghost source-add" data-src-act="add">+ ${T('srcAdd')}</button>
    </div>`;
  }

  // ----- Viewer -----

  let viewerEl = null, releaseTrap = null;

  function openViewer(id, start, end) {
    const data = App.getStudyData();
    const src = candidates(data).find(s => s.id === id);
    if (!src) return;
    const T = i18n.t;
    if (!viewerEl) {
      viewerEl = document.createElement('div');
      viewerEl.className = 'shortcuts-backdrop';
      viewerEl.style.display = 'none';
      document.body.appendChild(viewerEl);
      viewerEl.addEventListener('click', e => { if (e.target === viewerEl || e.target.closest('[data-src-close]')) closeViewer(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && viewerEl.style.display !== 'none') closeViewer(); });
    }
    const s = Number.isFinite(start) && start >= 0 ? start : -1;
    const e = s >= 0 && Number.isFinite(end) && end > s ? Math.min(end, src.text.length) : -1;
    const body = s >= 0 && e > 0
      ? esc(src.text.slice(0, s)) + '<mark class="source-mark">' + esc(src.text.slice(s, e)) + '</mark>' + esc(src.text.slice(e))
      : esc(src.text);
    viewerEl.innerHTML = `<div class="shortcuts-card source-viewer" role="dialog" aria-modal="true" aria-labelledby="source-viewer-title">
      <div class="source-viewer-head">
        <h3 id="source-viewer-title">${icon(src.kind)} ${esc(src.name)}</h3>
        <span class="source-viewer-meta">${T('srcChars', { n: src.text.length.toLocaleString() })}</span>
        <button class="btn-icon" data-src-close aria-label="${esc(T('close'))}">&times;</button>
      </div>
      <div class="source-text no-math">${body}</div>
    </div>`;
    viewerEl.style.display = 'flex';
    releaseTrap = FX.trapFocus(viewerEl);
    const mark = viewerEl.querySelector('.source-mark');
    if (mark) requestAnimationFrame(() => mark.scrollIntoView({ block: 'center' }));
  }

  function closeViewer() {
    if (!viewerEl) return;
    viewerEl.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  // ----- Study-side actions -----

  function toggle(id, on) {
    const data = App.getStudyData();
    const src = data && (data.sources || []).find(s => s.id === id);
    if (!src) return;
    src.enabled = on;
    App.persistActiveDeck();
    const chip = document.querySelector(`.source-chip input[data-src="${CSS.escape(id)}"]`);
    if (chip) chip.closest('.source-chip').classList.toggle('off', !on);
  }

  function remove(id) {
    const data = App.getStudyData();
    if (!data || !Array.isArray(data.sources)) return;
    const src = data.sources.find(s => s.id === id);
    if (!src || !confirm(i18n.t('srcRemoveConfirm', { name: src.name }))) return;
    data.sources = data.sources.filter(s => s.id !== id);
    App.persistActiveDeck();
    Notes.render(data);
    App.showToast(i18n.t('srcRemoved'), 'info');
  }

  // ----- Input-view tray -----

  function stage(name, kind, text) {
    text = String(text || '').trim();
    if (!text) { App.showToast(i18n.t('noInput'), 'error'); return false; }
    if (staged.some(s => s.text === text)) { App.showToast(i18n.t('srcAlready'), 'info'); return false; }
    staged.push(make(name, kind, text));
    renderTray();
    App.showToast(i18n.t('srcStaged', { n: staged.length }), 'success');
    return true;
  }

  function unstage(id) {
    staged = staged.filter(s => s.id !== id);
    renderTray();
  }

  function clearTray() { staged = []; renderTray(); }

  function renderTray() {
    const tray = document.getElementById('source-tray');
    if (!tray) return;
    if (!staged.length) { tray.style.display = 'none'; tray.innerHTML = ''; return; }
    const T = i18n.t;
    const total = staged.reduce((n, s) => n + s.text.length, 0);
    tray.style.display = '';
    tray.innerHTML = `<div class="source-tray-head">
        <span>${T('srcTrayTitle', { n: staged.length })}</span>
        <span class="source-tray-size">${T('srcChars', { n: total.toLocaleString() })}${total > GEN_BUDGET ? ' · ' + T('srcTrayTrim') : ''}</span>
      </div>
      <div class="source-tray-list">${staged.map(s => `<span class="source-chip">
        <span class="source-chip-name static">${icon(s.kind)} ${esc(s.name)}</span>
        <button class="source-chip-x" data-tray-remove="${esc(s.id)}" aria-label="${esc(T('srcRemove'))}">&times;</button>
      </span>`).join('')}</div>
      <p class="source-tray-hint">${T('srcTrayHint')}</p>`;
  }

  // Name/kind of whatever is in the paste box right now.
  function setPasteMeta(meta) { pasteMeta = meta; }
  function currentPasteSource(text) {
    if (pasteMeta && pasteMeta.text === text) return { name: pasteMeta.name, kind: pasteMeta.kind };
    return { name: nameFromText(text), kind: 'paste' };
  }

  function init() {
    document.addEventListener('click', e => {
      const trayX = e.target.closest('[data-tray-remove]');
      if (trayX) { unstage(trayX.dataset.trayRemove); return; }
      const btn = e.target.closest('[data-src-act]');
      if (!btn || btn.tagName === 'INPUT') return;
      const act = btn.dataset.srcAct;
      if (act === 'view') openViewer(btn.dataset.src, parseInt(btn.dataset.start, 10), parseInt(btn.dataset.end, 10));
      else if (act === 'remove') remove(btn.dataset.src);
      else if (act === 'add') { const add = document.getElementById('add-material-btn'); if (add) add.click(); }
    });
    document.addEventListener('change', e => {
      const box = e.target.closest('input[data-src-act="toggle"]');
      if (box) toggle(box.dataset.src, box.checked);
    });
  }

  return {
    init, make, kindFromName, kindFromUrl, nameFromUrl, nameFromText, forGeneration, contextText, adoptLegacy,
    locate, bestPassage, citationsHtml, barHtml, openViewer, stage, staged: () => staged.slice(), clearTray,
    setPasteMeta, currentPasteSource, norm, GEN_BUDGET
  };
})();
