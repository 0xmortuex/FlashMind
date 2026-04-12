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

    // Validate quiz
    if (!Array.isArray(data.quiz) || data.quiz.length === 0) {
      throw new Error('No quiz questions generated');
    }
    data.quiz.forEach((q, i) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Invalid quiz question at index ${i}`);
      }
      q.id = q.id || i + 1;
      if (typeof q.correct !== 'number') q.correct = 0;
      q.explanation = q.explanation || '';
    });

    // Defaults for optional fields
    data.notes.importantDates = data.notes.importantDates || [];
    data.notes.commonMistakes = data.notes.commonMistakes || [];

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

  return { parseGenerate, parseChat };
})();
