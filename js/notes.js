// ===== Notes Module =====
const Notes = (() => {
  let container;
  let view = 'notes'; // 'notes' | 'map' | 'audio' | 'labs' | 'video'

  function init() {
    if (container) return;
    container = document.getElementById('tab-notes');
    container.addEventListener('click', e => {
      const v = e.target.closest('[data-notes-view]');
      if (v) { showView(v.dataset.notesView); return; }
      const src = e.target.closest('[data-section-src]');
      if (src) toggleSectionSource(+src.dataset.sectionSrc);
    });
  }

  function render(data) {
    if (reading) { TTS.stop(); reading = false; }
    if (typeof Topics !== 'undefined') Topics.reset();
    if (!container) init();
    const T = i18n.t;
    const { title, notes } = data;
    const scen = !!(data.meta && (data.meta.kind === 'scenario' || data.meta.kind === 'course'));   // MEB scenario and whole-course notebooks keep their line breaks

    let html = `<div class="notes-container">`;

    // Sources the set was built from + the Notes / Mind map / Audio switcher.
    if (typeof Sources !== 'undefined' && Array.isArray(data.sources) && data.sources.length) html += Sources.barHtml(data);
    const viewBtn = (v, icon, label) => `<button class="notes-view-btn${view === v ? ' active' : ''}" data-notes-view="${v}" role="tab" aria-selected="${view === v}">${icon} ${label}</button>`;
    html += `<div class="notes-viewbar" role="tablist">
      ${viewBtn('notes', '&#128221;', T('viewNotes'))}
      ${typeof Mindmap !== 'undefined' ? viewBtn('map', '&#129504;', T('viewMindmap')) : ''}
      ${typeof AudioOverview !== 'undefined' ? viewBtn('audio', '&#127911;', T('viewAudio')) : ''}
      ${typeof Labs !== 'undefined' ? viewBtn('labs', '&#129514;', T('viewLabs')) : ''}
      ${typeof VideoLesson !== 'undefined' ? viewBtn('video', '&#127916;', T('viewVideo')) : ''}
    </div>`;
    html += `<div class="notes-pane" data-pane="notes"${view === 'notes' ? '' : ' hidden'}>`;

    // Header
    html += `<div class="notes-header">
      <h1 class="notes-title">${esc(title)}</h1>
      ${data.meta && data.meta.sourceUrl ? `<a class="meb-srclink" href="${escSvg(data.meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">${T('mebSrcLink')} <span aria-hidden="true">&#8599;</span></a>` : ''}
      ${typeof Topics !== 'undefined' ? Topics.savedBtnHtml(data) : ''}
      <div class="notes-summary${scen ? ' scen-text' : ''}">${esc(notes.summary)}</div>
    </div>`;

    // Sections (scroll-revealed with a slight cascade — see FX.observe below)
    const hasSources = Array.isArray(data.sources) && data.sources.length > 0;
    notes.sections.forEach((section, idx) => {
      html += `<div class="notes-section reveal" style="--i:${idx % 3}">
        <h2 class="notes-section-title">${typeof Topics !== 'undefined' ? Topics.titleHtml(data, idx) : esc(section.title)}${hasSources ? `<button class="section-src-btn" data-section-src="${idx}" title="${T('srcShowPassage')}">&#128206; ${T('srcSource')}</button>` : ''}</h2>
        <div class="topic-audio" data-topic-audio-box="${idx}" aria-live="polite" hidden></div>
        <div class="section-src" data-section-src-box="${idx}" hidden></div>
        <p class="notes-section-content${scen ? ' scen-text' : ''}">${esc(section.content)}</p>`;

      if (section.keyTerms && section.keyTerms.length > 0) {
        html += `<div class="key-terms">
          <div class="key-terms-title">${T('keyTerms')}</div>`;
        section.keyTerms.forEach(term => {
          html += `<div class="key-term">
            <span class="key-term-name">${esc(term.term)}:</span>
            <span class="key-term-def">${esc(term.definition)}</span>
          </div>`;
        });
        html += `</div>`;
      }

      if (section.bulletPoints && section.bulletPoints.length > 0) {
        html += `<ul class="notes-bullets">`;
        section.bulletPoints.forEach(bp => { html += `<li>${esc(bp)}</li>`; });
        html += `</ul>`;
      }

      html += `</div>`;

      // Insert diagrams between sections
      if (notes.diagrams && notes.diagrams.length > 0) {
        const diagramIdx = Math.floor(idx / 2);
        if (idx % 2 === 1 && diagramIdx < notes.diagrams.length) {
          html += renderDiagram(notes.diagrams[diagramIdx]);
        }
      }
    });

    // Remaining diagrams
    if (notes.diagrams && notes.diagrams.length > 0) {
      const insertedCount = Math.min(Math.floor(notes.sections.length / 2), notes.diagrams.length);
      for (let i = insertedCount; i < notes.diagrams.length; i++) {
        html += renderDiagram(notes.diagrams[i]);
      }
    }

    if (notes.importantDates && notes.importantDates.length > 0) {
      html += `<div class="notes-dates reveal"><h3 class="notes-dates-title">${T('importantDates')}</h3>`;
      notes.importantDates.forEach(d => { html += `<div class="date-item">${esc(d)}</div>`; });
      html += `</div>`;
    }

    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      html += `<div class="notes-mistakes reveal"><h3 class="notes-mistakes-title">${T('commonMistakes')}</h3>`;
      notes.commonMistakes.forEach(m => { html += `<div class="mistake-item">${esc(m)}</div>`; });
      html += `</div>`;
    }

    html += `<div class="notes-actions">
      <button class="btn-ghost" onclick="Export.copyNotesMd()">${T('copyNotes')}</button>
      <button class="btn-ghost" onclick="Export.notesPdf()">${T('downloadPdf')}</button>
      ${(typeof TTS !== 'undefined' && TTS.supported()) ? `<button class="btn-ghost" id="notes-tts-btn" onclick="Notes.readAloud(this)">&#128266; ${T('readAloud')}</button>` : ''}
    </div>`;

    html += `</div>`; // notes pane
    html += `<div class="notes-pane" data-pane="map"${view === 'map' ? '' : ' hidden'}></div>`;
    html += `<div class="notes-pane" data-pane="audio"${view === 'audio' ? '' : ' hidden'}></div>`;
    html += `<div class="notes-pane" data-pane="labs"${view === 'labs' ? '' : ' hidden'}></div>`;
    html += `<div class="notes-pane" data-pane="video"${view === 'video' ? '' : ' hidden'}></div>`;
    html += `</div>`;
    container.innerHTML = html;
    if (typeof FX !== 'undefined') FX.observe(container);
    renderPane(data);
  }

  // Mind map / audio panes render lazily, only while visible.
  function renderPane(data) {
    if (view === 'map' && typeof Mindmap !== 'undefined') Mindmap.render(container.querySelector('[data-pane="map"]'), data);
    if (view === 'audio' && typeof AudioOverview !== 'undefined') AudioOverview.render(container.querySelector('[data-pane="audio"]'), data);
    if (typeof Labs !== 'undefined') { if (view === 'labs') Labs.render(container.querySelector('[data-pane="labs"]'), data); else Labs.stop(); }
    if (typeof VideoLesson !== 'undefined') { if (view === 'video') VideoLesson.render(container.querySelector('[data-pane="video"]'), data); else VideoLesson.stop(); }
  }

  function showView(v) {
    if (!container) init();
    view = ['notes', 'map', 'audio', 'labs', 'video'].includes(v) ? v : 'notes';
    container.querySelectorAll('.notes-view-btn').forEach(b => {
      const on = b.dataset.notesView === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    container.querySelectorAll('.notes-pane').forEach(p => { p.hidden = p.dataset.pane !== view; });
    const data = App.getStudyData();
    if (data) renderPane(data);
  }

  // Inline "where does this come from?" passage for a notes section.
  function toggleSectionSource(idx) {
    const box = container.querySelector(`[data-section-src-box="${idx}"]`);
    const data = App.getStudyData();
    if (!box || !data) return;
    if (!box.hidden) { box.hidden = true; return; }
    const section = data.notes.sections[idx];
    const hit = section && Sources.bestPassage(section.title + ' ' + section.content + ' ' + (section.bulletPoints || []).join(' '), data);
    const T = i18n.t;
    box.innerHTML = hit
      ? `<blockquote class="section-src-quote no-math">${esc(hit.source.text.slice(hit.start, hit.end).trim())}</blockquote>
         <button class="btn-ghost" data-src-act="view" data-src="${esc(hit.source.id)}" data-start="${hit.start}" data-end="${hit.end}">${esc(T('srcOpenIn', { name: hit.source.name.length > 32 ? hit.source.name.slice(0, 31) + '…' : hit.source.name }))}</button>`
      : `<p class="section-src-none">${T('srcNoPassage')}</p>`;
    box.hidden = false;
  }

  // ===== SVG Diagram Rendering =====
  function renderDiagram(diagram) {
    if (!diagram.nodes || diagram.nodes.length === 0) return '';
    const nodes = diagram.nodes;
    const connections = diagram.connections || [];
    const nodeW = 140, nodeH = 50, gapX = 60, gapY = 20, padX = 30, padY = 40;
    const maxPerRow = 4;
    const rows = [];
    for (let i = 0; i < nodes.length; i += maxPerRow) rows.push(nodes.slice(i, i + maxPerRow));

    const svgW = Math.min(nodes.length, maxPerRow) * (nodeW + gapX) - gapX + padX * 2;
    const svgH = rows.length * (nodeH + gapY + 40) - gapY + padY * 2;

    const positions = Object.create(null);
    rows.forEach((row, rowIdx) => {
      const rowWidth = row.length * (nodeW + gapX) - gapX;
      const offsetX = (svgW - rowWidth) / 2;
      row.forEach((node, colIdx) => {
        positions[node.id] = {
          x: offsetX + colIdx * (nodeW + gapX),
          y: padY + rowIdx * (nodeH + gapY + 40),
          cx: offsetX + colIdx * (nodeW + gapX) + nodeW / 2,
          cy: padY + rowIdx * (nodeH + gapY + 40) + nodeH / 2
        };
      });
    });

    const nodeColors = {
      input: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.08)' },
      process: { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.08)' },
      output: { stroke: '#fbbf24', fill: 'rgba(251,191,36,0.08)' }
    };

    const arrowId = `arrow-${diagram.title.replace(/\W/g, '')}`;
    let svg = `<div class="diagram-container">
      <h3 class="diagram-title">${esc(diagram.title)}</h3>
      <div class="diagram-wrapper">
        <svg viewBox="0 0 ${svgW} ${svgH}" class="diagram-svg" xmlns="http://www.w3.org/2000/svg">
          <defs><marker id="${arrowId}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#7a8299"/></marker></defs>`;

    connections.forEach(conn => {
      const from = positions[conn.from], to = positions[conn.to];
      if (!from || !to) return;
      let fromRowIdx = -1, toRowIdx = -1;
      rows.forEach((row, ri) => {
        if (row.find(n => n.id === conn.from)) fromRowIdx = ri;
        if (row.find(n => n.id === conn.to)) toRowIdx = ri;
      });
      let x1, y1, x2, y2;
      if (fromRowIdx === toRowIdx) {
        x1 = from.cx < to.cx ? from.x + nodeW : from.x;
        x2 = from.cx < to.cx ? to.x : to.x + nodeW;
        y1 = from.cy; y2 = to.cy;
      } else {
        x1 = from.cx; y1 = from.y + nodeH; x2 = to.cx; y2 = to.y;
      }
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7a8299" stroke-width="1.5" marker-end="url(#${arrowId})" ${fromRowIdx !== toRowIdx ? 'stroke-dasharray="4 3"' : ''}/>`;
    });

    nodes.forEach(node => {
      const pos = positions[node.id];
      if (!pos) return;
      const colors = nodeColors[node.type] || nodeColors.process;
      svg += `<rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="8" ry="8" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2"/>`;
      const label = node.label || '';
      if (label.length > 18) {
        const mid = Math.ceil(label.length / 2);
        const breakIdx = label.lastIndexOf(' ', mid);
        const l1 = breakIdx > 0 ? label.substring(0, breakIdx) : label.substring(0, mid);
        const l2 = breakIdx > 0 ? label.substring(breakIdx + 1) : label.substring(mid);
        svg += `<text x="${pos.cx}" y="${pos.cy - 6}" text-anchor="middle" fill="#e8ecf4" font-size="12" font-family="Inter, sans-serif">${escSvg(l1)}</text>`;
        svg += `<text x="${pos.cx}" y="${pos.cy + 10}" text-anchor="middle" fill="#e8ecf4" font-size="12" font-family="Inter, sans-serif">${escSvg(l2)}</text>`;
      } else {
        svg += `<text x="${pos.cx}" y="${pos.cy + 4}" text-anchor="middle" fill="#e8ecf4" font-size="12" font-family="Inter, sans-serif">${escSvg(label)}</text>`;
      }
    });

    svg += `</svg></div>`;
    if (diagram.description) svg += `<p class="diagram-description">${esc(diagram.description)}</p>`;
    svg += `</div>`;
    return svg;
  }

  // ===== Read aloud (TTS) =====
  let reading = false;

  function readAloud(btn) {
    const T = i18n.t;
    if (reading) {
      TTS.stop();
      reading = false;
      btn.innerHTML = '&#128266; ' + T('readAloud');
      return;
    }
    const data = App.getStudyData();
    if (!data) return;
    const parts = [data.title, data.notes.summary];
    (data.notes.sections || []).forEach(s => { parts.push(s.title); parts.push(s.content); });
    reading = true;
    btn.innerHTML = '&#9209;&#65039; ' + T('stopReading');
    TTS.speak(parts.filter(Boolean).join('. '), () => {
      reading = false;
      btn.innerHTML = '&#128266; ' + T('readAloud');
    });
  }

  function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function escSvg(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { init, render, readAloud, showView, renderDiagram };
})();
