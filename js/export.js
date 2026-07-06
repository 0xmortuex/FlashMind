// ===== Export Module =====
const Export = (() => {

  function copyNotesMd() {
    const data = App.getStudyData();
    if (!data) return;
    const { title, notes } = data;

    let md = `# ${title}\n\n${notes.summary}\n\n`;
    notes.sections.forEach(section => {
      md += `## ${section.title}\n\n${section.content}\n\n`;
      if (section.keyTerms && section.keyTerms.length > 0) {
        md += `### ${i18n.t('keyTerms')}\n\n`;
        section.keyTerms.forEach(t => { md += `- **${t.term}**: ${t.definition}\n`; });
        md += '\n';
      }
      if (section.bulletPoints && section.bulletPoints.length > 0) {
        section.bulletPoints.forEach(bp => { md += `- ${bp}\n`; });
        md += '\n';
      }
    });
    if (notes.importantDates && notes.importantDates.length > 0) {
      md += `## ${i18n.t('importantDates')}\n\n`;
      notes.importantDates.forEach(d => md += `- ${d}\n`);
      md += '\n';
    }
    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      md += `## ${i18n.t('commonMistakes')}\n\n`;
      notes.commonMistakes.forEach(m => md += `- ${m}\n`);
      md += '\n';
    }

    navigator.clipboard.writeText(md).then(() => {
      App.showToast(i18n.t('notesCopied'), 'success');
    }).catch(() => { App.showToast(i18n.t('failedCopy'), 'error'); });
  }

  function notesPdf() {
    const data = App.getStudyData();
    if (!data) return;
    const { title, notes } = data;

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>${title} — FlashMind</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.7; }
        h1 { color: #7c3aed; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
        h2 { color: #5b21b6; margin-top: 24px; }
        .summary { background: #f5f3ff; padding: 12px 16px; border-radius: 8px; border-left: 3px solid #7c3aed; margin-bottom: 20px; }
        .key-term { margin: 4px 0; } .key-term strong { color: #0891b2; }
        .mistake { background: #fef2f2; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #ef4444; margin: 6px 0; }
        ul { padding-left: 20px; }
        @media print { body { margin: 20px; } }
      </style></head><body>`;

    html += `<h1>${esc(title)}</h1><div class="summary">${esc(notes.summary)}</div>`;
    notes.sections.forEach(section => {
      html += `<h2>${esc(section.title)}</h2><p>${esc(section.content)}</p>`;
      if (section.keyTerms && section.keyTerms.length > 0) {
        section.keyTerms.forEach(t => { html += `<div class="key-term"><strong>${esc(t.term)}:</strong> ${esc(t.definition)}</div>`; });
      }
      if (section.bulletPoints && section.bulletPoints.length > 0) {
        html += '<ul>';
        section.bulletPoints.forEach(bp => html += `<li>${esc(bp)}</li>`);
        html += '</ul>';
      }
    });
    if (notes.commonMistakes && notes.commonMistakes.length > 0) {
      html += `<h2>${i18n.t('commonMistakes')}</h2>`;
      notes.commonMistakes.forEach(m => html += `<div class="mistake">${esc(m)}</div>`);
    }
    html += `</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  // Printable exam sheet: questions formatted per type, then the answer key
  // on its own page — same open-window + print flow as notesPdf.
  function examPdf() {
    const data = App.getStudyData();
    if (!data || !data.quiz || !data.quiz.length) return;
    const T = i18n.t;
    const L = String.fromCharCode; // 65+i → A..E

    let qHtml = '', keyHtml = '';
    data.quiz.forEach((q, i) => {
      const n = i + 1;
      qHtml += `<div class="q"><p class="stem"><strong>${n}.</strong> ${esc(q.question)}</p>`;
      if (q.type === 'multiple-choice') {
        qHtml += '<ol class="opts">' + q.options.map((o, j) => `<li><span class="letter">${L(65 + j)})</span> ${esc(o)}</li>`).join('') + '</ol>';
        keyHtml += `<div><strong>${n}.</strong> ${L(65 + q.correct)}) ${esc(q.options[q.correct])}</div>`;
      } else if (q.type === 'true-false') {
        qHtml += `<p class="tf">( ) ${esc(T('tfTrue'))} &nbsp;&nbsp; ( ) ${esc(T('tfFalse'))}</p>`;
        keyHtml += `<div><strong>${n}.</strong> ${q.correct ? esc(T('tfTrue')) : esc(T('tfFalse'))}</div>`;
      } else if (q.type === 'fill-blank') {
        keyHtml += `<div><strong>${n}.</strong> ${esc((q.answers || []).join(' / '))}</div>`;
      } else if (q.type === 'matching') {
        const rights = q.pairs.map(p => p.right).sort(() => Math.random() - 0.5);
        qHtml += '<table class="match"><tr>' +
          `<td>${q.pairs.map((p, j) => `${j + 1}. ${esc(p.left)} — ___`).join('<br>')}</td>` +
          `<td>${rights.map((r, j) => `${L(65 + j)}) ${esc(r)}`).join('<br>')}</td></tr></table>`;
        keyHtml += `<div><strong>${n}.</strong> ${q.pairs.map(p => esc(p.left) + ' → ' + esc(p.right)).join('; ')}</div>`;
      } else { // open-ended
        qHtml += '<div class="lines"></div>';
        keyHtml += `<div><strong>${n}.</strong> ${esc(q.correctAnswer || '')}</div>`;
      }
      qHtml += '</div>';
    });

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>${esc(data.title)} — ${esc(T('examTitle'))}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 720px; margin: 36px auto; padding: 0 20px; color: #16182a; line-height: 1.55; font-size: 14px; }
        h1 { font-size: 20px; color: #5b21b6; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
        .meta { display: flex; justify-content: space-between; color: #555; margin: 10px 0 24px; font-size: 13px; }
        .q { margin-bottom: 18px; break-inside: avoid; }
        .stem { margin: 0 0 6px; }
        .opts { list-style: none; padding-left: 18px; margin: 0; }
        .opts li { margin: 2px 0; }
        .letter { font-weight: 600; margin-right: 4px; }
        .tf { padding-left: 18px; }
        .match { width: 100%; padding-left: 18px; } .match td { vertical-align: top; width: 50%; }
        .lines { height: 84px; margin: 6px 0 0 18px; background: repeating-linear-gradient(to bottom, transparent, transparent 27px, #bbb 27px, #bbb 28px); }
        .key { page-break-before: always; }
        .key h2 { font-size: 17px; color: #5b21b6; }
        .key div { margin: 5px 0; }
        @media print { body { margin: 16px auto; } }
      </style></head><body>
      <h1>${esc(data.title)} — ${esc(T('examTitle'))}</h1>
      <div class="meta"><span>${esc(T('profileSetName'))}: ______________________</span><span>${esc(T('score'))} ______ / 100</span></div>
      ${qHtml}
      <div class="key"><h2>${esc(T('answerKey'))}</h2>${keyHtml}</div>
      </body></html>`;

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
    App.showToast(i18n.t('cardsExported'), 'success');
  }

  function quizText() {
    const data = App.getStudyData();
    if (!data) return;
    let text = `${data.title} — Quiz\n${'='.repeat(40)}\n\n`;
    data.quiz.forEach((q, i) => {
      text += `${i + 1}. ${q.question}\n`;
      if (q.type === 'open-ended') {
        text += `   ${i18n.t('modelAnswer')} ${q.correctAnswer}\n`;
      } else {
        q.options.forEach((opt, j) => {
          const marker = j === q.correct ? ' \u2713' : '';
          text += `   ${String.fromCharCode(65 + j)}. ${opt}${marker}\n`;
        });
        if (q.explanation) text += `   Explanation: ${q.explanation}\n`;
      }
      text += '\n';
    });
    navigator.clipboard.writeText(text).then(() => {
      App.showToast(i18n.t('quizCopied'), 'success');
    }).catch(() => { App.showToast(i18n.t('failedCopy'), 'error'); });
  }

  function allJSON() {
    const data = App.getStudyData();
    if (!data) return;
    downloadFile(JSON.stringify(data, null, 2), `${sanitize(data.title)}_study_set.json`, 'application/json');
    App.showToast(i18n.t('jsonExported'), 'success');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEsc(str) { return (str || '').replace(/"/g, '""'); }
  function sanitize(str) { return (str || 'study').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50); }
  function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  return { copyNotesMd, notesPdf, examPdf, cardsCSV, quizText, allJSON, downloadFile, sanitize };
})();
