// ===== Parser Module =====
const Parser = (() => {

  function cleanJSON(raw) {
    let str = raw.trim();
    // Remove markdown fences
    if (str.startsWith('```')) {
      str = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return str;
  }

  function parseGenerate(raw) {
    const cleaned = cleanJSON(raw);
    const data = JSON.parse(cleaned);

    // Validate structure
    if (!data.title || !data.notes || !data.flashcards || !data.quiz) {
      throw new Error('Invalid response structure');
    }

    // Validate notes
    if (!data.notes.summary || !Array.isArray(data.notes.sections)) {
      throw new Error('Invalid notes structure');
    }

    // Validate flashcards
    if (!Array.isArray(data.flashcards) || data.flashcards.length === 0) {
      throw new Error('No flashcards generated');
    }
    data.flashcards.forEach((card, i) => {
      if (!card.front || !card.back) {
        throw new Error(`Invalid flashcard at index ${i}`);
      }
      card.id = card.id || i + 1;
      card.difficulty = card.difficulty || 'medium';
      card.category = card.category || 'General';
    });

    // Validate quiz — support both multiple-choice and open-ended
    if (!Array.isArray(data.quiz) || data.quiz.length === 0) {
      throw new Error('No quiz questions generated');
    }
    data.quiz.forEach((q, i) => {
      q.id = q.id || i + 1;
      q.type = q.type || 'multiple-choice';

      if (q.type === 'open-ended') {
        if (!q.question) throw new Error(`Invalid open-ended question at index ${i}`);
        q.correctAnswer = q.correctAnswer || '';
        q.keyPoints = Array.isArray(q.keyPoints) ? q.keyPoints : [];
        q.maxPoints = q.maxPoints || 3;
      } else {
        // multiple-choice
        q.type = 'multiple-choice';
        if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
          throw new Error(`Invalid quiz question at index ${i}`);
        }
        if (typeof q.correct !== 'number') q.correct = 0;
        q.explanation = q.explanation || '';
      }
    });

    // Defaults for optional fields
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
    const cleaned = cleanJSON(raw);
    const data = JSON.parse(cleaned);

    if (data.type === 'flashcards' && Array.isArray(data.flashcards)) {
      return data;
    }

    if (data.type === 'quiz' && Array.isArray(data.quiz)) {
      return data;
    }

    // Regular answer
    return {
      answer: data.answer || cleaned,
      tip: data.tip || null,
      followUps: Array.isArray(data.followUps) ? data.followUps : []
    };
  }

  function parseGrade(raw) {
    const cleaned = cleanJSON(raw);
    const data = JSON.parse(cleaned);
    return {
      score: typeof data.score === 'number' ? data.score : 0,
      maxScore: data.maxScore || 3,
      feedback: data.feedback || 'Unable to evaluate.',
      missedPoints: Array.isArray(data.missedPoints) ? data.missedPoints : []
    };
  }

  return { parseGenerate, parseChat, parseGrade };
})();
