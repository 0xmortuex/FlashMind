// ===== Parser Module =====
const Parser = (() => {

  function cleanJSON(raw) {
    let str = raw.trim();
    // Remove markdown fences
    str = str.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return str;
  }

  function repairJSON(str) {
    // Remove markdown fences if present
    str = str.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Walk the string, tracking string state and brace/bracket depth
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }

    // If we ended mid-string, close it
    if (inString) str += '"';

    // Drop any trailing partial token after the last complete value:
    // remove trailing comma, colon, or partial property name like ", "key
    // Keep stripping until we hit a digit, letter, ", ], }, or end
    str = str.replace(/,\s*$/, '');
    // Strip a trailing partial string-key like  ,"key (no closing colon yet)
    str = str.replace(/,\s*"[^"]*$/, '');

    // Close any unclosed arrays/objects in correct order
    for (let i = 0; i < openBrackets; i++) str += ']';
    for (let i = 0; i < openBraces; i++) str += '}';

    return str;
  }

  function safeParseJSON(raw) {
    const cleaned = cleanJSON(raw);
    try {
      return JSON.parse(cleaned);
    } catch (e1) {
      try {
        const repaired = repairJSON(cleaned);
        return JSON.parse(repaired);
      } catch (e2) {
        // Last resort: try repairing the original raw text
        try {
          return JSON.parse(repairJSON(raw));
        } catch (e3) {
          throw new Error('Could not parse response: ' + e1.message);
        }
      }
    }
  }

  function parseGenerate(raw) {
    const data = safeParseJSON(raw);

    // Validate top-level structure
    if (!data || !data.title || !data.notes) {
      throw new Error('Invalid response structure');
    }

    // Notes — be tolerant
    data.notes.summary = data.notes.summary || '';
    if (!Array.isArray(data.notes.sections)) data.notes.sections = [];

    // Flashcards — drop any malformed entries instead of throwing
    if (!Array.isArray(data.flashcards)) data.flashcards = [];
    data.flashcards = data.flashcards.filter(card => card && card.front && card.back);
    data.flashcards.forEach((card, i) => {
      card.id = card.id || i + 1;
      card.difficulty = card.difficulty || 'medium';
      card.category = card.category || 'General';
    });

    if (data.flashcards.length === 0) {
      throw new Error('No flashcards generated');
    }

    // Quiz — drop malformed entries
    if (!Array.isArray(data.quiz)) data.quiz = [];
    data.quiz = data.quiz.filter(q => {
      if (!q || !q.question) return false;
      if (q.type === 'open-ended') return true;
      // multiple-choice needs options array
      return Array.isArray(q.options) && q.options.length >= 2;
    });
    data.quiz.forEach((q, i) => {
      q.id = q.id || i + 1;
      q.type = q.type || 'multiple-choice';
      if (q.type === 'open-ended') {
        q.correctAnswer = q.correctAnswer || '';
        q.keyPoints = Array.isArray(q.keyPoints) ? q.keyPoints : [];
        q.maxPoints = q.maxPoints || 3;
      } else {
        q.type = 'multiple-choice';
        if (typeof q.correct !== 'number') q.correct = 0;
        q.explanation = q.explanation || '';
      }
    });

    if (data.quiz.length === 0) {
      throw new Error('No quiz questions generated');
    }

    // Optional fields
    data.notes.importantDates = data.notes.importantDates || [];
    data.notes.commonMistakes = data.notes.commonMistakes || [];
    data.notes.diagrams = Array.isArray(data.notes.diagrams) ? data.notes.diagrams : [];

    // Validate diagrams
    data.notes.diagrams.forEach((d, i) => {
      d.title = d.title || `Diagram ${i + 1}`;
      d.type = d.type || 'flowchart';
      d.nodes = Array.isArray(d.nodes) ? d.nodes : [];
      d.connections = Array.isArray(d.connections) ? d.connections : [];
      d.nodes.forEach(n => {
        n.id = String(n.id || '');
        n.label = n.label || '';
        n.type = n.type || 'process';
      });
    });

    return data;
  }

  function parseChat(raw) {
    const data = safeParseJSON(raw);

    if (data.type === 'flashcards' && Array.isArray(data.flashcards)) {
      data.flashcards = data.flashcards.filter(c => c && c.front && c.back);
      return data;
    }

    if (data.type === 'quiz' && Array.isArray(data.quiz)) {
      data.quiz = data.quiz.filter(q => q && q.question);
      return data;
    }

    return {
      answer: data.answer || cleanJSON(raw),
      tip: data.tip || null,
      followUps: Array.isArray(data.followUps) ? data.followUps : []
    };
  }

  function parseGrade(raw) {
    const data = safeParseJSON(raw);
    return {
      score: typeof data.score === 'number' ? data.score : 0,
      maxScore: data.maxScore || 3,
      feedback: data.feedback || 'Unable to evaluate.',
      missedPoints: Array.isArray(data.missedPoints) ? data.missedPoints : []
    };
  }

  return { parseGenerate, parseChat, parseGrade, repairJSON, safeParseJSON };
})();
