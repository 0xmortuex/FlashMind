// ===== Notes Module =====
const Notes = (() => {
  let container;

  function init() {
    container = document.getElementById('tab-notes');
  }

  function render(data) {
    if (!container) init();
    const { title, notes } = data;

    let html = `<div class="notes-container">`;

    // Header
    html += `<div class="notes-header">
      <h1 class="notes-title">${esc(title)}</h1>
      <div class="notes-summary">${esc(notes.summary)}</div>
    </div>`;

    // Sections
    notes.sections.forEach(section => {
      html += `<div class="notes-section">
        <h2 class="notes-section-title">${esc(section.title)}</h2>
        <p class="notes-section-content">${esc(section.content)}</p>`;

      // Key Terms
      if (section.keyTerms && section.keyTerms.length > 0) {
        html += `<div class="key-terms">
          <div class="key-terms-title">Key Terms</div>`;
        section.keyTerms.forEach(term => {
          html += `<div class="key-term">
            <span class="key-term-name">${esc(term.term)}:</span>
            <span class="key-term-def">${esc(term.definition)}</span>
          </div>`;
        });
        html += `</div>`;
      }

      // Bullet Points
      if (section.bulletPoints && section.bulletPoints.length > 0) {
        html += `<ul class="notes-bullets">`;
        section.bulletPoints.forEach(bp => {
          html += `<li>${esc(bp)}</li>`;
        });
        html += `</ul>`;
      }

      html += `</div>`;
    });

    // Important Dates
    if (notes.importantDates && notes.importantDates.length > 0) {
      html += `<div class="notes-dates">
        <h3 class="notes-dates-title">Important Dates</h3>`;
      notes.importantDates.forEach(d => {
        html += `<div class="date-item">${esc(d)}</div>`;
      });
      html += `</div>`;
    }

    // Common Mistakes
    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      html += `<div class="notes-mistakes">
        <h3 class="notes-mistakes-title">Common Mistakes</h3>`;
      notes.commonMistakes.forEach(m => {
        html += `<div class="mistake-item">${esc(m)}</div>`;
      });
      html += `</div>`;
    }

    // Actions
    html += `<div class="notes-actions">
      <button class="btn-ghost" onclick="Export.copyNotesMd()">Copy Notes</button>
      <button class="btn-ghost" onclick="Export.notesPdf()">Download as PDF</button>
    </div>`;

    html += `</div>`;

    container.innerHTML = html;
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, render };
})();
