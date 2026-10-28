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
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }

    // If we ended mid-string, close it
    if (inString) {
      if (escaped) str = str.slice(0, -1);
      str += '"';
    }

    // Drop any trailing partial token after the last complete value:
    // remove trailing comma, colon, or partial property name like ", "key
    // Keep stripping until we hit a digit, letter, ", ], }, or end
    str = str.replace(/,\s*$/, '');
    // Strip a trailing partial string-key like  ,"key (no closing colon yet)
    str = str.replace(/,\s*"[^"]*$/, '');

    // Close any unclosed arrays/objects in correct order
    if (stack[stack.length - 1] === '}') str = str.replace(/,\s*"[^"\\]*"\s*:?\s*$/, '');
    str = str.replace(/:\s*$/, ':null');
    str += stack.reverse().join('');

    return str;
  }

  // Models writing LaTeX sometimes emit a bare backslash ("\(" or "\alpha")
  // that is not a legal JSON escape. Double every backslash that does not
  // start a valid escape so the string survives parsing verbatim.
  function fixEscapes(str) {
    return str.replace(/\\(?!$)(\\|["\/bfnrt]|u[0-9a-fA-F]{4})?/g, (m, ok) => ok ? m : '\\\\');
  }

  function safeParseJSON(raw) {
    const cleaned = cleanJSON(raw);
    try {
      return JSON.parse(cleaned);
    } catch (e1) {
      try {
        return JSON.parse(fixEscapes(cleaned));
      } catch (e1b) { /* fall through to structural repair */ }
      try {
        const repaired = repairJSON(fixEscapes(cleaned));
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

  function parseGenerate(raw, { requireFlashcards = true, requireQuiz = true } = {}) {
    const parsed = safeParseJSON(raw);
    if (!parsed || typeof parsed.title !== 'string' || !parsed.notes) throw new Error('Invalid response structure');
    const data = normalizeStudyData(parsed);
    if (requireFlashcards && !data.flashcards.length) throw new Error('No flashcards generated');
    if (requireQuiz && !data.quiz.length) throw new Error('No quiz questions generated');
    return data;
  }

  function parseChat(raw) {
    const data = safeParseJSON(raw);
    if (!data || typeof data !== 'object') throw new Error('Invalid chat response');

    if (data.type === 'flashcards' && Array.isArray(data.flashcards)) {
      data.flashcards = normalizeStudyData(data).flashcards;
      return data;
    }

    if (data.type === 'quiz' && Array.isArray(data.quiz)) {
      data.quiz = normalizeStudyData(data).quiz;
      return data;
    }

    return {
      answer: data.answer || cleanJSON(raw),
      tip: data.tip || null,
      followUps: Array.isArray(data.followUps) ? data.followUps : [],
      // Verbatim supporting quotes requested by the chat grounding hint.
      citations: (Array.isArray(data.citations) ? data.citations : [])
        .map(c => typeof c === 'string' ? c : (c && typeof c.quote === 'string' ? c.quote : ''))
        .map(c => c.trim()).filter(Boolean).slice(0, 5)
    };
  }

  function parseGrade(raw) {
    const data = safeParseJSON(raw);
    if (!data || typeof data !== 'object') throw new Error('Invalid grade response');
    const maxScore = Number.isFinite(data.maxScore) && data.maxScore > 0 ? data.maxScore : 3;
    return {
      score: Number.isFinite(data.score) ? Math.min(maxScore, Math.max(0, data.score)) : 0,
      maxScore,
      feedback: data.feedback || 'Unable to evaluate.',
      missedPoints: Array.isArray(data.missedPoints) ? data.missedPoints : []
    };
  }

  // ===== CSV / TSV flashcard import =====
  // Accepts our own CSV export, Anki TSV exports, or any front/back sheet.
  // Delimiter is auto-detected (tab wins if present); quoted fields with
  // embedded delimiters/newlines and doubled quotes are handled.
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(f => f.trim())) rows.push(row);
    return rows;
  }

  function parseCSVCards(text) {
    const src = String(text || '').replace(/^﻿/, '');
    // Anki exports may carry "#separator:tab"-style header comments.
    const body = src.replace(/^(?:#[^\r\n]*(?:\r?\n|$))+/, '');
    const delim = body.split('\n', 1)[0].includes('\t') ? '\t' : ',';
    let rows = parseDelimited(body, delim);
    if (!rows.length) return [];
    // Drop a header row like front,back[,difficulty,category].
    if (/^(front|question|ön|soru)$/i.test((rows[0][0] || '').trim())) rows = rows.slice(1);
    const DIFF = ['easy', 'medium', 'hard'];
    return rows
      .filter(r => (r[0] || '').trim() && (r[1] || '').trim())
      .map((r, i) => ({
        id: i + 1,
        front: r[0].trim(),
        back: r[1].trim(),
        difficulty: DIFF.includes((r[2] || '').trim().toLowerCase()) ? r[2].trim().toLowerCase() : 'medium',
        category: (r[3] || '').trim() || 'Imported'
      }));
  }

  // One boundary for imports, shares, generated content and saved decks.
  // Preserve valid IDs so existing review schedules keep their identity.
  function normalizeStudyData(input) {
    const obj = v => v && typeof v === 'object' && !Array.isArray(v);
    const str = v => typeof v === 'string' ? v : '';
    const list = v => Array.isArray(v) ? v : [];
    const strings = v => list(v).filter(x => typeof x === 'string');
    const ids = items => {
      const reserved = new Set(items.map(x => String(x.id)));
      const used = new Set();
      let next = 1;
      return items.map(x => {
        let id = x.id;
        if (!((Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id))) || used.has(String(id))) {
          while (reserved.has(String(next)) || used.has(String(next))) next++;
          id = next++;
        }
        used.add(String(id));
        return { ...x, id };
      });
    };
    const d = obj(input) ? input : {};
    const n = obj(d.notes) ? d.notes : { summary: str(d.notes) };
    const unit = v => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
    // Image-occlusion cards point at a shared image in `media` plus a set of
    // rectangles in 0..1 image coordinates; anything malformed is dropped.
    const occlusion = o => {
      if (!obj(o) || typeof o.media !== 'string') return null;
      const rects = list(o.rects).filter(obj).map(r => ({ x: unit(r.x), y: unit(r.y), w: unit(r.w), h: unit(r.h) }))
        .filter(r => r.x !== null && r.y !== null && r.w > 0 && r.h > 0).slice(0, 40);
      const target = Number.isInteger(o.target) && o.target >= 0 && o.target < rects.length ? o.target : -1;
      return target < 0 ? null : { media: o.media, rects, target, mode: o.mode === 'one' ? 'one' : 'all' };
    };
    // Answer-checker verdicts stored on cards and questions.
    const check = c => {
      if (!obj(c) || !['ok', 'wrong', 'unsupported', 'ambiguous'].includes(c.v)) return null;
      const out = { v: c.v, p: str(c.p).slice(0, 400), f: str(c.f).slice(0, 600), t: Number.isFinite(c.t) ? c.t : 0 };
      if (c.fixed === true) out.fixed = true;
      if (c.ignored === true) out.ignored = true;
      return out;
    };
    const withCheck = item => {
      if ('check' in item) { const c = check(item.check); if (c) item.check = c; else delete item.check; }
      return item;
    };
    const flashcards = ids(list(d.flashcards).filter(c => obj(c) && str(c.front).trim() && str(c.back).trim()).map(c => {
      const card = { ...c, difficulty: ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium', category: str(c.category) || 'General' };
      if ('occlusion' in card) { const o = occlusion(card.occlusion); if (o) card.occlusion = o; else delete card.occlusion; }
      return withCheck(card);
    }));
    // Shared images, kept only while a card still references them.
    const used = new Set(flashcards.filter(c => c.occlusion).map(c => c.occlusion.media));
    const media = {};
    if (obj(d.media)) Object.keys(d.media).forEach(k => {
      if (used.has(k) && /^[a-zA-Z0-9_-]+$/.test(k) && k !== '__proto__' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(str(d.media[k]))) media[k] = d.media[k];
    });
    // Material the set was built from (multi-source decks).
    const sources = list(d.sources).filter(x => obj(x) && str(x.text).trim()).slice(0, 30).map((x, i) => ({
      id: /^[a-zA-Z0-9_-]+$/.test(str(x.id)) && !['__proto__', 'constructor', 'prototype', '__notes'].includes(x.id) ? x.id : 's' + (i + 1),
      name: str(x.name).trim().slice(0, 160) || 'Source ' + (i + 1),
      kind: ['paste', 'pdf', 'url', 'youtube', 'image', 'file', 'lecture'].includes(x.kind) ? x.kind : 'paste',
      text: str(x.text).slice(0, 60000),
      enabled: x.enabled !== false,
      addedAt: Number.isFinite(x.addedAt) ? x.addedAt : 0
    }));
    const seenSrc = new Set();
    sources.forEach((x, i) => { if (seenSrc.has(x.id)) x.id = 's' + (i + 1) + '_' + i; seenSrc.add(x.id); });
    // Where a ready-made MEB set came from (js/mebsets.js); the link is kept only if it is an official https MEB/EBA address.
    const meta = obj(d.meta) && str(d.meta.fileId).trim() ? {
      fileId: str(d.meta.fileId).trim().slice(0, 64),
      ...(/^https:\/\/([a-z0-9-]+\.)*(meb\.gov\.tr|eba\.gov\.tr)(\/|$)/i.test(str(d.meta.sourceUrl)) ? { sourceUrl: str(d.meta.sourceUrl) } : {}),
      ...Object.fromEntries(['subject', 'schoolYear', 'examType', 'kind', 'bank', 'sheet', 'exam'].filter(k => str(d.meta[k])).map(k => [k, str(d.meta[k]).slice(0, 80)])),
      ...(Number.isInteger(d.meta.scenario) && d.meta.scenario > 0 ? { scenario: d.meta.scenario } : {}),
      ...(Number.isInteger(d.meta.grade) || Array.isArray(d.meta.grade) ? { grade: [].concat(d.meta.grade).filter(Number.isInteger).slice(0, 8) } : {}),
      ...(obj(d.meta.counts) ? { counts: Object.fromEntries(Object.entries(d.meta.counts).filter(([k, v]) => Number.isFinite(v) && /^[a-zA-Z]{1,12}$/.test(k)).slice(0, 8)) } : {})
    } : null;
    // Mind map tree: { label, detail?, children[] }, bounded in depth and size.
    let nodeBudget = 400;
    const tree = (n, depth) => {
      if (!obj(n) || !str(n.label).trim() || depth > 6 || nodeBudget-- <= 0) return null;
      const out = { label: str(n.label).trim().slice(0, 140), children: list(n.children).map(c => tree(c, depth + 1)).filter(Boolean) };
      if (str(n.detail).trim()) out.detail = str(n.detail).trim().slice(0, 600);
      return out;
    };
    // Audio overview script: [{ speaker: 'A'|'B', text }].
    const audio = obj(d.audio) ? {
      format: ['deep', 'brief', 'recap'].includes(d.audio.format) ? d.audio.format : 'deep',
      title: str(d.audio.title).slice(0, 200),
      lines: list(d.audio.lines).filter(l => obj(l) && str(l.text).trim()).slice(0, 200)
        .map(l => ({ speaker: l.speaker === 'B' ? 'B' : 'A', text: str(l.text).trim().slice(0, 2000) })),
      createdAt: Number.isFinite(d.audio.createdAt) ? d.audio.createdAt : 0
    } : null;
    const mindmap = tree(n.mindmap, 0);
    // Interactive labs and video-lesson storyboards (validated in js/simspec.js).
    const labs = typeof SimSpec !== 'undefined' ? SimSpec.sanitizeLabs(d.labs) : [];
    const lessons = typeof SimSpec !== 'undefined' ? SimSpec.sanitizeLessons(d.lessons) : [];
    const quiz = ids(list(d.quiz).filter(obj).map(q => {
      q = withCheck({ ...q, question: str(q.question), explanation: str(q.explanation) });
      if (!q.question.trim()) return null;
      if (q.type === 'open-ended') return { ...q, correctAnswer: str(q.correctAnswer), keyPoints: strings(q.keyPoints), maxPoints: Number.isFinite(q.maxPoints) && q.maxPoints > 0 ? q.maxPoints : 3 };
      if (q.type === 'true-false') {
        if (typeof q.correct === 'string') {
          if (/^(true|doğru|dogru|d|t|1|yes|evet)$/i.test(q.correct.trim())) q.correct = true;
          else if (/^(false|yanlış|yanlis|y|f|0|no|hayır|hayir)$/i.test(q.correct.trim())) q.correct = false;
        }
        return typeof q.correct === 'boolean' ? q : null;
      }
      if (q.type === 'fill-blank') {
        q.answers = strings(Array.isArray(q.answers) ? q.answers : [q.answer]).filter(a => a.trim());
        return q.answers.length ? q : null;
      }
      if (q.type === 'matching') {
        q.pairs = list(q.pairs).filter(p => obj(p) && str(p.left).trim() && str(p.right).trim());
        return q.pairs.length >= 2 ? q : null;
      }
      if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(o => typeof o === 'string')) return null;
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) return null;
      return { ...q, type: 'multiple-choice' };
    }).filter(Boolean));
    return {
      title: str(d.title).trim() || i18n.t('importedSet'),
      notes: {
        summary: str(n.summary),
        sections: list(n.sections).filter(obj).map(s => ({ ...s, title: str(s.title), content: str(s.content), bulletPoints: strings(s.bulletPoints), keyTerms: list(s.keyTerms).filter(k => obj(k) && str(k.term) && str(k.definition)) })),
        importantDates: strings(n.importantDates), commonMistakes: strings(n.commonMistakes),
        diagrams: list(n.diagrams).filter(obj).map((g, i) => ({ ...g, title: str(g.title) || `Diagram ${i + 1}`, nodes: list(g.nodes).filter(obj).map(v => ({ ...v, id: String(v.id ?? ''), label: str(v.label), type: ['input', 'process', 'output'].includes(v.type) ? v.type : 'process' })), connections: list(g.connections).filter(obj).map(c => ({ from: String(c.from ?? ''), to: String(c.to ?? '') })) })),
        ...(mindmap ? { mindmap } : {})
      }, flashcards, quiz,
      ...(sources.length ? { sources } : {}),
      ...(meta ? { meta } : {}),
      ...(Object.keys(media).length ? { media } : {}),
      ...(audio && audio.lines.length ? { audio } : {}),
      ...(labs.length ? { labs } : {}),
      ...(lessons.length ? { lessons } : {})
    };
  }

  return { parseGenerate, parseChat, parseGrade, repairJSON, safeParseJSON, parseCSVCards, normalizeStudyData };
})();
