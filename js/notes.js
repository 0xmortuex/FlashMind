// ===== Notes Module =====
const Notes = (() => {
  let container;

  function init() {
    container = document.getElementById('tab-notes');
  }

  function render(data) {
    if (!container) init();
    const T = i18n.t;
    const { title, notes } = data;

    let html = `<div class="notes-container">`;

    // Header
    html += `<div class="notes-header">
      <h1 class="notes-title">${esc(title)}</h1>
      <div class="notes-summary">${esc(notes.summary)}</div>
    </div>`;

    // Sections
    notes.sections.forEach((section, idx) => {
      html += `<div class="notes-section">
        <h2 class="notes-section-title">${esc(section.title)}</h2>
        <p class="notes-section-content">${esc(section.content)}</p>`;

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
      html += `<div class="notes-dates"><h3 class="notes-dates-title">${T('importantDates')}</h3>`;
      notes.importantDates.forEach(d => { html += `<div class="date-item">${esc(d)}</div>`; });
      html += `</div>`;
    }

    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      html += `<div class="notes-mistakes"><h3 class="notes-mistakes-title">${T('commonMistakes')}</h3>`;
      notes.commonMistakes.forEach(m => { html += `<div class="mistake-item">${esc(m)}</div>`; });
      html += `</div>`;
    }

    html += `<div class="notes-actions">
      <button class="btn-ghost" onclick="Export.copyNotesMd()">${T('copyNotes')}</button>
      <button class="btn-ghost" onclick="Export.notesPdf()">${T('downloadPdf')}</button>
    </div>`;

    html += `</div>`;
    container.innerHTML = html;
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

    const positions = {};
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

  function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function escSvg(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { init, render };
})();
