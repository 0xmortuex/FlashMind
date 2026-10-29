// ===== Study material for AI generators =====
// What video lessons, audio overviews and the AI mind map are written from: the
// set's teaching notes first. Library sets carry the exam paper itself as their
// source text; using that as the material makes the AI talk about the exam
// (how many questions come from which topic) instead of the subject. The source
// text only follows as a short, labelled reference.
const Material = (() => {
  const LIMIT = 40000, REFERENCE = 6000;

  // Said in every prompt that teaches or summarises the material.
  const SUBJECT_RULE = 'TEACH THE SUBJECT ITSELF: its concepts, definitions, rules, worked examples and the typical mistakes. The material may mention an exam, a question table or scoring: ' +
    'never spend time on how many questions come from which topic, on the exam format, timing or scoring; at most use it as a hint of which ideas matter most. ';

  function noteText(s) {
    const bullets = (s.bulletPoints || []).map(b => '- ' + b).join('\n');
    const terms = (s.keyTerms || []).map(k => `${k.term}: ${k.definition}`).join('\n');
    return [`## ${s.title || ''}`, s.content, bullets, terms, s.example ? 'Example: ' + s.example : ''].filter(Boolean).join('\n');
  }

  // The source text of THIS deck (not necessarily the open one: js/refresh.js works through the library).
  function sourceOf(data) {
    if (data === App.getStudyData()) return App.getOriginalText();
    return typeof Sources !== 'undefined' ? Sources.contextText(data) : '';
  }

  // `sec` limits the material to one notes section.
  function forStudy(data, sec) {
    const sections = (data.notes && data.notes.sections) || [];
    const taught = [sec ? '' : (data.notes && data.notes.summary) || '', ...(sec ? [sec] : sections).map(noteText)].filter(Boolean).join('\n\n');
    const hasSources = Array.isArray(data.sources) && data.sources.length > 0;
    const src = hasSources ? sourceOf(data) : '';
    if (!taught) return String(sourceOf(data) || '').slice(0, LIMIT);
    return (taught.slice(0, 32000) + (src ? `\n\nReference text (it may be an exam paper or a question table: never teach its format, only use it for facts about the subject):\n${src.slice(0, REFERENCE)}` : '')).slice(0, LIMIT);
  }

  return { forStudy, noteText, SUBJECT_RULE };
})();
