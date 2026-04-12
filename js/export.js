// ===== Export Module =====
const Export = (() => {

  function copyNotesMd() {
    const data = App.getStudyData();
    if (!data) return;
    const { title, notes } = data;

    let md = `# ${title}\n\n`;
    md += `${notes.summary}\n\n`;

    notes.sections.forEach(section => {
      md += `## ${section.title}\n\n`;
      md += `${section.content}\n\n`;

      if (section.keyTerms && section.keyTerms.length > 0) {
        md += `### Key Terms\n\n`;
        section.keyTerms.forEach(t => {
          md += `- **${t.term}**: ${t.definition}\n`;
        });
        md += '\n';
      }

      if (section.bulletPoints && section.bulletPoints.length > 0) {
        section.bulletPoints.forEach(bp => {
          md += `- ${bp}\n`;
        });
        md += '\n';
      }
    });

    if (notes.importantDates && notes.importantDates.length > 0) {
      md += `## Important Dates\n\n`;
      notes.importantDates.forEach(d => md += `- ${d}\n`);
      md += '\n';
    }

    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      md += `## Common Mistakes\n\n`;
      notes.commonMistakes.forEach(m => md += `- ${m}\n`);
      md += '\n';
    }

    navigator.clipboard.writeText(md).then(() => {
      App.showToast('Notes copied as Markdown!', 'success');
    }).catch(() => {
      App.showToast('Failed to copy', 'error');
    });
  }

  function notesPdf() {
    const data = App.getStudyData();
    if (!data) return;
    const { title, notes } = data;

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>${title} — FlashMind Notes</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.7; }
        h1 { color: #7c3aed; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
        h2 { color: #5b21b6; margin-top: 24px; }
        .summary { background: #f5f3ff; padding: 12px 16px; border-radius: 8px; border-left: 3px solid #7c3aed; margin-bottom: 20px; }
        .key-term { margin: 4px 0; }
        .key-term strong { color: #0891b2; }
        .mistake { background: #fef2f2; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #ef4444; margin: 6px 0; }
        ul { padding-left: 20px; }
        @media print { body { margin: 20px; } }
      </style>
    </head><body>`;

    html += `<h1>${esc(title)}</h1>`;
    html += `<div class="summary">${esc(notes.summary)}</div>`;

    notes.sections.forEach(section => {
      html += `<h2>${esc(section.title)}</h2>`;
      html += `<p>${esc(section.content)}</p>`;

      if (section.keyTerms && section.keyTerms.length > 0) {
        section.keyTerms.forEach(t => {
          html += `<div class="key-term"><strong>${esc(t.term)}:</strong> ${esc(t.definition)}</div>`;
        });
      }

      if (section.bulletPoints && section.bulletPoints.length > 0) {
        html += '<ul>';
        section.bulletPoints.forEach(bp => html += `<li>${esc(bp)}</li>`);
        html += '</ul>';
      }
    });

    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      html += '<h2>Common Mistakes</h2>';
      notes.commonMistakes.forEach(m => html += `<div class="mistake">${esc(m)}</div>`);
    }

    html += `</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  function cardsCSV() {
    const data = App.getStudyData();
    if (!data) return;

    let csv = 'front,back,difficulty,category\n';
    data.flashcards.forEach(card => {
      csv += `"${csvEsc(card.front)}","${csvEsc(card.back)}","${card.difficulty}","${csvEsc(card.category)}"\n`;
    });

    downloadFile(csv, `${sanitize(data.title)}_flashcards.csv`, 'text/csv');
    App.showToast('Flashcards exported as CSV!', 'success');
  }

  function quizText() {
    const data = App.getStudyData();
    if (!data) return;

    let text = `${data.title} — Quiz\n${'='.repeat(40)}\n\n`;
    data.quiz.forEach((q, i) => {
      text += `${i + 1}. ${q.question}\n`;
      q.options.forEach((opt, j) => {
        const marker = j === q.correct ? ' ✓' : '';
        text += `   ${String.fromCharCode(65 + j)}. ${opt}${marker}\n`;
      });
      if (q.explanation) text += `   Explanation: ${q.explanation}\n`;
      text += '\n';
    });

    navigator.clipboard.writeText(text).then(() => {
      App.showToast('Quiz copied to clipboard!', 'success');
    }).catch(() => {
      App.showToast('Failed to copy', 'error');
    });
  }

  function allJSON() {
    const data = App.getStudyData();
    if (!data) return;

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${sanitize(data.title)}_study_set.json`, 'application/json');
    App.showToast('Study set exported as JSON!', 'success');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEsc(str) {
    return (str || '').replace(/"/g, '""');
  }

  function sanitize(str) {
    return (str || 'study').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { copyNotesMd, notesPdf, cardsCSV, quizText, allJSON };
})();
