// ===== Study Search — keyword search across notes + exam =====
const Search = (() => {
  let input, results, clearBtn, container, debounce;

  function init() {
    input = document.getElementById('study-search-input');
    results = document.getElementById('study-search-results');
    clearBtn = document.getElementById('study-search-clear');
    container = document.getElementById('study-search');
    if (!input) return;
    input.placeholder = i18n.t('searchPlaceholder');
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      clearBtn.style.display = input.value ? '' : 'none';
      debounce = setTimeout(run, 140);
    });
    clearBtn.addEventListener('click', () => { reset(); input.focus(); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') reset(); });
    document.addEventListener('click', e => {
      if (container && !container.contains(e.target)) close();
    });
  }

  function reset() { clearTimeout(debounce); if (input) input.value = ''; if (clearBtn) clearBtn.style.display = 'none'; close(); }
  function close() { if (results) { results.style.display = 'none'; results.innerHTML = ''; } }
  function norm(s) { return String(s == null ? '' : s).toLocaleLowerCase('tr'); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;'); }

  // Build the searchable index from the active study set.
  function collect() {
    const d = App.getStudyData();
    if (!d) return [];
    const items = [];
    const notes = d.notes || {};
    if (notes.summary) items.push({ src: 'notes', label: i18n.t('summaryLabel'), text: notes.summary });
    (notes.sections || []).forEach(s => {
      if (s.title) items.push({ src: 'notes', label: s.title, text: s.title });
      if (s.content) items.push({ src: 'notes', label: s.title || '', text: s.content });
      (s.bulletPoints || []).forEach(b => items.push({ src: 'notes', label: s.title || '', text: b }));
      (s.keyTerms || []).forEach(k => items.push({ src: 'notes', label: s.title || '', text: `${k.term}: ${k.definition}` }));
    });
    (notes.importantDates || []).forEach(t => items.push({ src: 'notes', label: i18n.t('datesLabel'), text: t }));
    (notes.commonMistakes || []).forEach(t => items.push({ src: 'notes', label: i18n.t('mistakesLabel'), text: t }));

    (d.quiz || []).forEach(q => {
      let answer = '', extra = '';
      if (q.type === 'multiple-choice') { answer = (q.options || [])[q.correct] || ''; extra = (q.options || []).join(' '); }
      else if (q.type === 'true-false') { answer = q.correct ? i18n.t('tfTrue') : i18n.t('tfFalse'); }
      else if (q.type === 'fill-blank') { answer = (q.answers || []).join(' / '); extra = answer; }
      else if (q.type === 'matching') { answer = (q.pairs || []).map(p => `${p.left} → ${p.right}`).join('; '); extra = answer; }
      else if (q.type === 'open-ended') { answer = q.correctAnswer || ''; }
      items.push({ src: 'exam', label: examTypeLabel(q.type), text: q.question, answer, extra });
    });
    return items;
  }

  function examTypeLabel(type) {
    return type === 'true-false' ? i18n.t('typeTf')
      : type === 'fill-blank' ? i18n.t('typeFill')
      : type === 'matching' ? i18n.t('typeMatch')
      : type === 'open-ended' ? i18n.t('writtenAnswer')
      : i18n.t('typeMc');
  }

  function run() {
    const raw = input.value.trim();
    if (raw.length < 2) { close(); return; }
    const q = norm(raw);
    const hits = collect().filter(it =>
      norm(it.text).includes(q) || (it.answer && norm(it.answer).includes(q)) || (it.extra && norm(it.extra).includes(q))
    ).slice(0, 40);
    render(hits, raw);
  }

  // Highlight the matched span inside a windowed snippet.
  function highlight(text, query) {
    text = String(text ?? '');
    const i = norm(text).indexOf(norm(query));
    if (i < 0) return esc(text.slice(0, 140)) + (text.length > 140 ? '…' : '');
    const start = Math.max(0, i - 50);
    const before = (start > 0 ? '…' : '') + text.slice(start, i);
    const match = text.slice(i, i + query.length);
    const afterEnd = i + query.length + 90;
    const after = text.slice(i + query.length, afterEnd) + (afterEnd < text.length ? '…' : '');
    return esc(before) + '<mark>' + esc(match) + '</mark>' + esc(after);
  }

  function render(hits, raw) {
    if (!hits.length) {
      results.innerHTML = `<div class="search-empty">${i18n.t('searchNoResults')}</div>`;
      results.style.display = 'block';
      return;
    }
    const notes = hits.filter(h => h.src === 'notes');
    const exam = hits.filter(h => h.src === 'exam');
    let html = '';
    if (notes.length) {
      html += `<div class="search-group-label">${i18n.t('searchInNotes')} (${notes.length})</div>`;
      notes.forEach((h, i) => {
        html += `<div class="search-result" data-jump="${esc(h.text.slice(0, 60))}">
          <span class="search-tag">${esc(h.label)}</span>
          <span class="search-snippet">${highlight(h.text, raw)}</span></div>`;
      });
    }
    if (exam.length) {
      html += `<div class="search-group-label">${i18n.t('searchInExam')} (${exam.length})</div>`;
      exam.forEach(h => {
        html += `<div class="search-result exam">
          <span class="search-tag">${esc(h.label)}</span>
          <span class="search-snippet">${highlight(h.text, raw)}</span>
          ${h.answer ? `<span class="search-answer"><b>${i18n.t('searchAnswer')}</b> ${highlight(h.answer, raw)}</span>` : ''}</div>`;
      });
    }
    results.innerHTML = html;
    results.style.display = 'block';
    results.querySelectorAll('.search-result[data-jump]').forEach(el => {
      el.addEventListener('click', () => jumpToNotes(el.dataset.jump));
    });
  }

  // Switch to the Notes tab and scroll/flash the matching element.
  function jumpToNotes(snippet) {
    close();
    App.switchTab('notes');
    const needle = norm(snippet);
    setTimeout(() => {
      const root = document.getElementById('tab-notes');
      if (!root) return;
      let target = null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (node.children.length === 0 && norm(node.textContent).includes(needle.slice(0, 30))) { target = node; break; }
        node = walker.nextNode();
      }
      if (!target && norm(root.textContent).includes(needle.slice(0, 20))) target = root;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('search-flash');
        setTimeout(() => target.classList.remove('search-flash'), 1600);
      }
    }, 80);
  }

  return { init, reset };
})();
