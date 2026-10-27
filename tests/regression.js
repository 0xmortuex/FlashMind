// Dependency-free regression coverage for data boundaries and persistence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function modules(initial = {}, extras = {}) {
  const storage = new Map(Object.entries(initial));
  const ctx = vm.createContext({
    console, TextDecoder, TextEncoder, Response, ReadableStream,
    i18n: { t: k => k, getLang: () => 'en' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    App: { showToast() {} }, ...extras
  });
  for (const file of ['simspec', 'parser', 'decks', 'stats', 'api', 'sources', 'planner', 'adaptive', 'insights', 'pastpaper', 'paperreview']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), ctx);
  return { ctx, storage, run: code => vm.runInContext(code, ctx) };
}

test('repair closes nested arrays and objects in actual nesting order', () => {
  const { run } = modules();
  assert.equal(run(`Parser.safeParseJSON('{"items":[{"front":"x"').items[0].front`), 'x');
  assert.equal(run(`Parser.safeParseJSON('["a","b"').length`), 2);
});
test('repair removes incomplete keys and dangling string escapes', () => {
  const { ctx, run } = modules();
  ctx.raw = '{"a":1,"next":';
  assert.equal(run('Parser.safeParseJSON(raw).a'), 1);
  ctx.raw = '{"a":"hello\\';
  assert.equal(run('Parser.safeParseJSON(raw).a'), 'hello');
});
test('normalization preserves valid IDs, deduplicates IDs and rejects malformed entries', () => {
  const { run } = modules();
  const result = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({notes:{sections:[null, {keyTerms:[null],bulletPoints:'bad'}],diagrams:[null,{}]},flashcards:[null,{id:8,front:'Q',back:'A'},{id:8,front:'Q2',back:'A2',difficulty:'" onclick="alert(1)'},{id:1,front:'Q3',back:'A3'}],quiz:[{question:'bad',options:['a','b'],correct:1.5},{question:'tf',type:'true-false',correct:'false'}]}))`));
  assert.equal(result.flashcards[0].id, 8);
  assert.equal(new Set(result.flashcards.map(c => c.id)).size, 3);
  assert.equal(result.flashcards[2].id, 1);
  assert.equal(result.flashcards[1].difficulty, 'medium');
  assert.equal(result.quiz.length, 1);
  assert.equal(result.quiz[0].correct, false);
  assert.deepEqual(result.notes.sections[0].keyTerms, []);
});
test('chat cards receive defaults and grades remain within bounds', () => {
  const { run } = modules();
  assert.equal(run(`Parser.parseChat('{"type":"flashcards","flashcards":[{"front":"q","back":"a"}]}').flashcards[0].difficulty`), 'medium');
  assert.equal(run(`Parser.parseGrade('{"score":20,"maxScore":3}').score`), 3);
  assert.equal(run(`Parser.parseGrade('{"score":-4,"maxScore":0}').score`), 0);
});
test('CSV preserves hash-prefixed lines inside quoted multiline fields', () => {
  const { ctx, run } = modules();
  ctx.csv = 'front,back\n"Q\n# heading","A"';
  assert.equal(run('Parser.parseCSVCards(csv)[0].front'), 'Q\n# heading');
});
test('invalid stored deck maps recover and remote null maps do not throw', () => {
  const { run } = modules({ flashmind_decks_v1: '{"decks":null}' });
  assert.equal(run('Decks.list().length'), 0);
  assert.equal(run('Decks.mergeRemote({decks:null})'), false);
  assert.equal(run('Decks.get("__proto__")'), null);
});
test('storage failure never evicts an older deck or pushes stale data', () => {
  const { run } = modules();
  run(`Decks.save({title:'one'},''); Decks.save({title:'two'},''); localStorage.setItem = () => { throw new Error('quota'); }; Decks.save({title:'three'},'');`);
  assert.equal(run('Decks.list().length'), 3);
});
test('mistake changes advance the deck timestamp used by sync', () => {
  const { run } = modules();
  assert.equal(run(`const d = Decks.save({title:'one'},''); const before = d.updatedAt; Decks.addMistakes([{question:'q'}]); const added = d.updatedAt; Decks.resolveMistakes([{question:'q'}]); added > before && d.updatedAt > added`), true);
});
test('remote decks without schedules remain reviewable and unsafe IDs are rejected', () => {
  const { run } = modules();
  assert.equal(run(`Decks.mergeRemote({decks:{d1:{id:'d1',updatedAt:1,data:{title:'one'}}}}); Decks.setActive('d1'); Decks.review(1,5).reps`), 1);
  assert.equal(run(`Decks.mergeRemote(JSON.parse('{"decks":{"x":{"id":"__proto__","updatedAt":2,"data":{}}}}'))`), false);
});
test('stats merges higher success counts at equal review counts and deduplicates exams', () => {
  const { run, storage } = modules({ flashmind_stats_v1: '{"days":{"2026-09-01":{"reviews":4,"gotit":1}},"exams":[]}' });
  run(`Stats.mergeRemote({days:{'2026-09-01':{reviews:4,gotit:3}},exams:[{t:1,pct:80},{t:1,pct:80},{t:2,pct:'<img>'}]})`);
  const data = JSON.parse(storage.get('flashmind_stats_v1'));
  assert.equal(data.days['2026-09-01'].gotit, 3);
  assert.equal(data.exams.length, 1);
});
test('malformed stats maps and exam collections cannot crash merge', () => {
  const { run } = modules({ flashmind_stats_v1: '{"days":null}' });
  assert.doesNotThrow(() => run(`Stats.mergeRemote({days:{x:null},exams:{}})`));
});
test('SSE consumes no-space data fields and a final line without a newline', async () => {
  const { run } = modules({}, { fetch: async () => new Response('data:{"choices":[{"delta":{"content":"one"}}]}\ndata: {"choices":[{"delta":{"content":"two"}}]}', { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.equal(await run(`API.generateStream('',{}, {})`), 'onetwo');
});
test('SSE surfaces provider errors instead of returning partial success', async () => {
  const { run } = modules({}, { fetch: async () => new Response('data: {"error":{"message":"provider failed"}}\n') });
  await assert.rejects(run(`API.generateStream('',{}, {})`), /provider failed/);
});

test('normalization keeps sources, mind map, audio and referenced media only', () => {
  const { run } = modules();
  const d = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({
    title: 't',
    notes: { summary: '', mindmap: { label: 'root', children: [{ label: 'a', detail: 'why', children: [null, { label: '' }] }] } },
    sources: [{ name: 'Bio.pdf', kind: 'pdf', text: 'cells' }, { name: 'empty', text: '  ' }, { id: '__proto__', text: 'x', kind: 'evil' }],
    audio: { format: 'deep', lines: [{ speaker: 'B', text: 'hi' }, { speaker: 'Z', text: 'yo' }, { text: '' }] },
    media: { m1: 'data:image/jpeg;base64,AAAA', m2: 'data:image/jpeg;base64,BBBB', m3: 'javascript:alert(1)' },
    flashcards: [
      { front: 'q', back: 'a', occlusion: { media: 'm1', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], target: 0 } },
      { front: 'q2', back: 'a2', occlusion: { media: 'm3', rects: [], target: 3 } }
    ]
  }))`));
  assert.equal(d.notes.mindmap.children.length, 1);
  assert.equal(d.notes.mindmap.children[0].children.length, 0);
  assert.equal(d.sources.length, 2);
  assert.equal(d.sources[1].kind, 'paste');
  assert.notEqual(d.sources[1].id, '__proto__');
  assert.deepEqual(d.audio.lines.map(l => l.speaker), ['B', 'A']);
  assert.deepEqual(Object.keys(d.media), ['m1']);
  assert.equal(d.flashcards[0].occlusion.mode, 'all');
  assert.equal(d.flashcards[1].occlusion, undefined);
});
test('bare LaTeX backslashes in model JSON are repaired, valid escapes kept', () => {
  const { ctx, run } = modules();
  // Model output with bare backslashes: \( \) and \a are not legal JSON escapes.
  ctx.raw = String.raw`{"a":"\(x^2\) and \alpha","b":"line\nbreak"}`;
  const out = JSON.parse(run('JSON.stringify(Parser.safeParseJSON(raw))'));
  assert.equal(out.a, String.raw`\(x^2\) and \alpha`);
  assert.equal(out.b, 'line\nbreak');
});
test('chat citations are parsed from strings or quote objects', () => {
  const { run } = modules();
  assert.equal(run(`Parser.parseChat('{"answer":"x","citations":["one",{"quote":"two"},5,""]}').citations.join('|')`), 'one|two');
  assert.equal(run(`Parser.parseChat('{"answer":"x"}').citations.length`), 0);
});
test('an exam date pulls reviews forward to the day before the exam', () => {
  const { run } = modules();
  const ok = run(`
    const day = 86400000, now = Date.now();
    const d = Decks.save({ title: 'x', flashcards: [{ id: 1, front: 'q', back: 'a' }] }, '');
    const exam = new Date(now + 3 * day);
    const key = exam.getFullYear() + '-' + String(exam.getMonth() + 1).padStart(2, '0') + '-' + String(exam.getDate()).padStart(2, '0');
    Decks.setExamDate(d.id, key);
    // A long-stability card would normally be due weeks later.
    Decks.getActive().srs[1] = { stab: 40, diff: 3, reps: 4, lapses: 0, due: now, last: now - 30 * day };
    const s = Decks.review(1, 5);
    s.due <= Decks.examStart(key) - day && s.due > now;
  `);
  assert.equal(ok, true);
  assert.equal(run(`Decks.capForExam('', 123, 1)`), 123);
});
test('the exam plan spreads unseen cards over the days before the final review day', () => {
  const { run } = modules();
  const p = JSON.parse(run(`
    const day = 86400000, now = Date.now();
    const cards = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, front: 'q' + i, back: 'a' }));
    const exam = new Date(now + 6 * day);
    const key = exam.getFullYear() + '-' + String(exam.getMonth() + 1).padStart(2, '0') + '-' + String(exam.getDate()).padStart(2, '0');
    JSON.stringify(Planner.plan({ examDate: key, data: { flashcards: cards }, srs: { 1: { stab: 5, reps: 1, due: now - 1, last: now - day, first: now - day } } }, now));
  `));
  assert.equal(p.daysLeft, 6);
  assert.equal(p.unseen, 9);
  assert.equal(p.newPerDay, 2);
  assert.equal(p.dueNow, 1);
  assert.equal(p.schedule.reduce((n, d) => n + d.newCards, 0), 9);
  assert.equal(p.schedule[5].final, true);
  assert.equal(p.schedule[5].newCards, 0);
  assert.ok(p.readiness > 0 && p.readiness < 100);
});
test('quotes are verified against sources and notes; invented ones are not', () => {
  const { run } = modules();
  run(`globalThis.data = Parser.normalizeStudyData({ title: 't',
    notes: { summary: 'Mitochondria are the powerhouse of the cell.' },
    sources: [{ id: 's1', name: 'Bio', kind: 'pdf', text: 'Chapter 2.\\nPhotosynthesis happens in the  chloroplasts, mainly in the leaves of green plants during the day.' }] })`);
  assert.equal(run(`Sources.locate('photosynthesis happens in the chloroplasts', data).source.id`), 's1');
  assert.equal(run(`Sources.locate('Photosynthesis happens in the chloroplasts, mainly in the leaves of green plants at night.', data).exact`), false);
  assert.equal(run(`Sources.locate('the powerhouse of the cell', data).source.id`), '__notes');
  assert.equal(run(`Sources.locate('Plants photosynthesize using moonlight exclusively', data)`), null);
  assert.equal(run(`const h = Sources.locate('happens in the chloroplasts', data); data.sources[0].text.slice(h.start, h.end)`), 'happens in the  chloroplasts');
});
test('combined generation input labels every source and respects the budget', () => {
  const { run } = modules();
  const out = run(`Sources.forGeneration([Sources.make('A', 'pdf', 'x'.repeat(20000)), Sources.make('B', 'url', 'short text')])`);
  assert.ok(out.length <= 15000);
  assert.ok(out.includes('=== Source 1: A ===') && out.includes('=== Source 2: B ===\nshort text'));
});
test('multi-source decks keep material in sources, not the legacy text field', () => {
  const { run } = modules();
  assert.equal(run(`Decks.save({ title: 't', sources: [{ name: 'a', text: 'abc' }] }, 'legacy text').originalText`), '');
  assert.equal(run(`Decks.save({ title: 'u' }, 'legacy text').originalText`), 'legacy text');
});
test('focus minutes count as a study day and survive sync merges', () => {
  const { run, storage } = modules();
  run(`Stats.recordFocus(25)`);
  assert.equal(run(`Stats.streak()`), 1);
  assert.equal(run(`Stats.focusMinutes(7)`), 25);
  const k = Object.keys(JSON.parse(storage.get('flashmind_stats_v1')).days)[0];
  run(`Stats.mergeRemote({ days: { '${k}': { reviews: 0, gotit: 0, focus: 50 } }, exams: [] })`);
  assert.equal(run(`Stats.focusMinutes(1)`), 50);
});

test('"sure" + Got it schedules as FSRS Easy, further out than a plain Got it', () => {
  const { run } = modules();
  const due = run(`
    Decks.save({ title: 'x', flashcards: [{ id: 1, front: 'a', back: 'b' }, { id: 2, front: 'c', back: 'd' }] }, '');
    const good = Decks.review(1, 5).due, easy = Decks.review(2, 6).due;
    JSON.stringify({ good, easy });
  `);
  const { good, easy } = JSON.parse(due);
  assert.ok(easy > good);
});
test('confidence is tallied per level and sure-but-wrong cards are listed as overconfident', () => {
  const { run } = modules();
  const cal = JSON.parse(run(`
    const d = Decks.save({ title: 'x', flashcards: [{ id: 1, front: 'a', back: 'b' }, { id: 2, front: 'c', back: 'd' }] }, '');
    Decks.recordConfidence(null, 1, 'sure', true);
    Decks.recordConfidence(null, 2, 'sure', false);
    Decks.recordConfidence(null, 2, 'guess', true);
    Decks.recordConfidence(null, 2, 'bogus', true);
    JSON.stringify(Insights.calibration(Decks.getActive()));
  `));
  assert.deepEqual(cal.levels.sure, [1, 1]);
  assert.deepEqual(cal.levels.guess, [1, 0]);
  assert.deepEqual(cal.over.map(o => o.id), ['2']);
});
test('adaptive practice favours missed and unseen questions over mastered ones', () => {
  const { run } = modules();
  const counts = JSON.parse(run(`
    const qs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, question: 'q' + i, category: i < 6 ? 'A' : 'B' }));
    const stats = {};
    for (let i = 1; i <= 6; i++) stats[i] = { n: 3, ok: 3, last: 1 };   // topic A mastered
    stats[7] = { n: 2, ok: 0, last: 0 };                                // missed
    let seed = 1; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const c = {};
    for (let r = 0; r < 300; r++) Adaptive.pick(qs, stats, 4, { rand }).forEach(q => { c[q.id] = (c[q.id] || 0) + 1; });
    JSON.stringify(c);
  `));
  assert.ok((counts[7] || 0) > (counts[1] || 0) * 3, JSON.stringify(counts));
  assert.ok((counts[10] || 0) > (counts[2] || 0), JSON.stringify(counts));
});
test('score prediction needs history and reflects per-question accuracy', () => {
  const { run } = modules();
  assert.equal(run(`Adaptive.predict([{ id: 1 }], { 1: { n: 1, ok: 1 } })`), null);
  const p = JSON.parse(run(`
    const qs = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, category: i < 5 ? 'Strong' : 'Weak' }));
    const st = {}; for (let i = 1; i <= 5; i++) st[i] = { n: 4, ok: 4 }; for (let i = 6; i <= 8; i++) st[i] = { n: 4, ok: 0 };
    JSON.stringify(Adaptive.predict(qs, st));
  `));
  assert.ok(p.pct > 30 && p.pct < 70, JSON.stringify(p));
  assert.equal(p.coverage, 80);
  assert.equal(p.weakest[0], 'Weak');
});
test('answer-check verdicts are kept when valid and dropped when malformed', () => {
  const { run } = modules();
  const d = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({ title: 't',
    flashcards: [{ front: 'a', back: 'b', check: { v: 'wrong', p: 'nope', f: 'c', t: 5 } }, { front: 'x', back: 'y', check: { v: 'evil' } }],
    quiz: [{ question: 'q', options: ['a', 'b'], correct: 0, check: { v: 'ambiguous', p: 1 } }] }))`));
  assert.deepEqual(d.flashcards[0].check, { v: 'wrong', p: 'nope', f: 'c', t: 5 });
  assert.equal(d.flashcards[1].check, undefined);
  assert.equal(d.quiz[0].check.v, 'ambiguous');
  assert.equal(d.quiz[0].check.p, '');
});
test('mistakes can be tagged with a cause, and exam answers build per-question history', () => {
  const { run } = modules();
  const out = JSON.parse(run(`
    Decks.save({ title: 'x' }, '');
    Decks.addMistakes([{ type: 'multiple-choice', question: 'Q1' }]);
    Decks.tagMistake({ type: 'multiple-choice', question: 'Q1' }, 'careless');
    Decks.recordAnswers([{ id: 3, ok: false }, { id: 3, ok: true }, { id: '__proto__', ok: true }]);
    JSON.stringify({ m: Decks.getMistakes()[0].mtype, s: Decks.getActive().qstats });
  `));
  assert.equal(out.m, 'careless');
  assert.deepEqual(out.s['3'], { n: 2, ok: 1, last: 1, t: out.s['3'].t });
  assert.equal(Object.keys(out.s).length, 1);
});

// ----- Exams from real papers -----
test('past-paper analysis applies the booklet answer key and marks AI-solved questions', () => {
  const { ctx, run } = modules();
  ctx.raw = JSON.stringify({
    style: { formats: { mc: 3, 'open-ended': 1, bogus: 9 }, optionCount: 9, length: 'long', difficulty: 'weird' },
    topics: [{ name: 'Hücre Bölünmeleri', count: 2 }, { name: 'hücre bölünmeleri', count: 1 }, { name: 'Kalıtım', count: 1 }, { name: '' }],
    questions: [
      { number: 1, question: 'Mitoz kaç evrede?', options: ['1', '2', '3', '4', '5'], correct: 0, keyed: 'ai', topic: 'Hücre Bölünmeleri' },
      { number: '2', question: 'Mayoz?', options: ['a', 'b', 'c', 'd', 'e'], correct: 'B', topic: 'Kalıtım' },
      { number: 3, type: 'open-ended', question: 'Açıklayınız.', correctAnswer: 'x', keyed: 'ai' },
      { number: 4, question: 'no options' }
    ]
  });
  const out = JSON.parse(run(`const k = PastPaper.parseAnswerKey('...\\nCEVAP ANAHTARI\\n1-C 2.A 3) E 5-D'); JSON.stringify({ k, a: PastPaper.parseAnalysis(raw, k.key) })`));
  assert.deepEqual(out.k.key, { 1: 'C', 2: 'A', 3: 'E', 5: 'D' });
  const a = out.a;
  assert.equal(a.style.formats['multiple-choice'], 3);
  assert.equal(a.style.formats['open-ended'], 1);
  assert.equal(a.style.optionCount, 6);
  assert.equal(a.style.difficulty, 'medium');
  assert.equal(a.topics.length, 2);
  assert.equal(a.topics[0].count, 3);
  assert.equal(a.questions.length, 3);
  assert.equal(a.questions[0].correct, 2);           // booklet key "1-C" overrides the AI
  assert.equal(a.questions[0].aiKeyed, undefined);
  assert.equal(a.questions[0].category, 'Hücre Bölünmeleri');
  assert.equal(a.questions[1].correct, 0);           // booklet "2.A"
  assert.equal(a.questions[2].aiKeyed, true);        // open-ended solved by the AI
  assert.equal(a.questions[0].id, undefined);
  assert.equal(a.questions[0].src, 'paper');
});
test('answer key needs at least three entries after a key heading', () => {
  const { run } = modules();
  assert.equal(run(`Object.keys(PastPaper.parseAnswerKey('1-C 2-A 3-B 4-D').key).length`), 0);
  assert.equal(run(`Object.keys(PastPaper.parseAnswerKey('Cevap anahtarı: 1-C 2-A').key).length`), 0);
  assert.equal(run(`Object.keys(PastPaper.parseAnswerKey('Answer key 1.B 2.C 3.D 4.Cevap').key).length`), 3);
});
test('chunk analyses merge into one style profile with normalized topic weights', () => {
  const { run } = modules();
  const m = JSON.parse(run(`JSON.stringify(PastPaper.mergeAnalyses([
    { style: { formats: { 'multiple-choice': 8, 'true-false': 0, 'fill-blank': 0, matching: 0, 'open-ended': 0 }, optionCount: 5, length: 'long', difficulty: 'hard', notes: 'Senaryolu' },
      topics: [{ name: 'Optik', count: 6 }], patterns: ['Grafik yorumlama'], questions: [{ type: 'true-false', question: 'q', correct: true }] },
    { style: { formats: { 'multiple-choice': 2, 'true-false': 0, 'fill-blank': 0, matching: 0, 'open-ended': 2 }, optionCount: 4, length: 'short', difficulty: 'easy', notes: '' },
      topics: [{ name: 'optik', count: 1 }, { name: 'Dalgalar', count: 3 }], patterns: ['grafik yorumlama', 'Tablo okuma'], questions: [] }
  ]))`));
  assert.equal(m.style.formats['multiple-choice'], 10);
  assert.equal(m.style.formats['open-ended'], 2);
  assert.equal(m.style.optionCount, 5);   // the part with more questions wins the vote
  assert.equal(m.style.length, 'long');
  assert.equal(m.style.notes, 'Senaryolu');
  assert.deepEqual(m.topics.map(t => [t.name, t.weight]), [['Optik', 0.7], ['Dalgalar', 0.3]]);
  assert.deepEqual(m.patterns, ['Grafik yorumlama', 'Tablo okuma']);
  assert.equal(m.questions.length, 1);
});
test('a pasted konu dağılımı is parsed line by line', () => {
  const { ctx, run } = modules();
  ctx.txt = '10. Sınıf Biyoloji Konu Dağılımı\n1. Hücre Bölünmeleri ...... 4\nKalıtımın Genel İlkeleri - %40 \nEkosistem Ekolojisi: 2 soru\nToplam 10\n\nnot a row';
  const t = JSON.parse(run('JSON.stringify(PastPaper.parseDistribution(txt))'));
  assert.deepEqual(t.map(x => x.name), ['Kalıtımın Genel İlkeleri', 'Hücre Bölünmeleri', 'Ekosistem Ekolojisi']);
  assert.equal(t[1].count, 4);
  assert.equal(Math.round(t.reduce((s, x) => s + x.weight, 0) * 100), 100);
});
test('topic weights boost adaptive picks for heavy topics, explainably clamped', () => {
  const { ctx, run } = modules();
  ctx.profile = { topics: [{ name: 'Optik', weight: 0.6 }, { name: 'Dalgalar', weight: 0.3 }, { name: 'Basınç', weight: 0.1 }] };
  run('var boost = PastPaper.topicBoost(profile)');
  assert.equal(run(`boost({ category: 'optik' })`), 1.8);
  assert.equal(run(`boost({ category: 'Dalgalar ve Ses' })`), 0.9);   // containment match
  assert.equal(run(`boost({ category: 'Basinc' })`), 0.5);            // accent-insensitive, clamped at 0.5×
  assert.equal(run(`boost({ category: 'Kimya' })`), 1);               // not in the distribution
  assert.equal(run(`PastPaper.topicBoost({ topics: [{ name: 'x', weight: 1 }] })`), null);
  // With a deterministic rand the first pick follows the weights.
  const first = run(`(() => {
    const qs = [{ id: 1, category: 'Basınç' }, { id: 2, category: 'Optik' }];
    return Adaptive.pick(qs, {}, 1, { rand: () => 0.3, topicBoost: boost })[0].id;
  })()`);
  assert.equal(first, 2);
  const noBoost = run(`Adaptive.pick([{ id: 1, category: 'Basınç' }, { id: 2, category: 'Optik' }], {}, 1, { rand: () => 0.3 })[0].id`);
  assert.equal(noBoost, 1);
});
test('generation slots follow topic weights and the paper format mix', () => {
  const { run } = modules();
  const slots = JSON.parse(run(`JSON.stringify(PastPaper.planSlots(10, {
    topics: [{ name: 'A', weight: 0.5 }, { name: 'B', weight: 0.3 }, { name: 'C', weight: 0.2 }],
    style: { formats: { 'multiple-choice': 8, 'open-ended': 2 } } }))`));
  assert.equal(slots.length, 10);
  const count = (k, v) => slots.filter(s => s[k] === v).length;
  assert.deepEqual([count('topic', 'A'), count('topic', 'B'), count('topic', 'C')], [5, 3, 2]);
  assert.deepEqual([count('type', 'multiple-choice'), count('type', 'open-ended')], [8, 2]);
  assert.deepEqual(run('JSON.stringify(PastPaper.allocate(3, [0, 0]))'), '[2,1]');
});
test('the deck-level paper profile is sanitized and survives a reload', () => {
  const { run, storage } = modules();
  run(`Decks.save({ title: 'Fizik' }, ''); PastPaper.saveProfile({ style: { formats: { 'multiple-choice': 5 } }, topics: [{ name: 'Optik', count: 2 }, { name: '<b>x</b>', count: 1 }], topicsFrom: 'evil', patterns: [1, 'p'], source: 'kitapcik.pdf' })`);
  const again = modules(Object.fromEntries(storage));
  const p = JSON.parse(again.run('JSON.stringify(PastPaper.getProfile())'));
  assert.equal(p.style.formats['multiple-choice'], 5);
  assert.equal(p.topicsFrom, 'paper');
  assert.deepEqual(p.patterns, ['p']);
  assert.equal(p.topics.length, 2);
  assert.equal(again.run('PastPaper.sanitizeProfile({ style: {} , topics: [] })'), null);
  assert.equal(again.run('PastPaper.sanitizeProfile("x")'), null);
});
test('graded-paper review: parsing, lost marks per topic, fix-first list and notebook entries', () => {
  const { ctx, run } = modules();
  ctx.raw = JSON.stringify({ items: [
    { n: 1, topic: 'Optik', question: 'Q1', given: 'a', wrong: true, lost: 4, max: 10, correct: 'b', concept: 'Kırılma', mtype: 'concept' },
    { n: 2, topic: 'Optik', question: 'Q2', given: 'c', wrong: true, lost: '2', max: 10, correct: 'd', concept: 'kırılma', mtype: 'nope' },
    { n: 3, topic: 'Dalgalar', question: 'Q3', given: 'e', wrong: 'true', correct: 'f', concept: 'Rezonans', mtype: 'careless',
      options: ['x', 'y', 'z'], correctIndex: 1 },
    { n: 4, topic: 'Dalgalar', question: 'Q4', given: 'ok', wrong: false, max: 10 },
    { question: '' }, null
  ] });
  const out = JSON.parse(run('const it = PaperReview.parseReview(raw); JSON.stringify({ it, rep: PaperReview.buildReport(it), m: PaperReview.toMistakes(it) })'));
  assert.equal(out.it.length, 4);
  assert.equal(out.it[1].mtype, 'concept');           // unknown type → concept
  assert.equal(out.it[2].lost, 1);                    // wrong without readable marks counts 1
  assert.equal(out.rep.totalLost, 7);
  assert.equal(out.rep.totalMax, 0);                  // not every question shows its max
  assert.deepEqual(out.rep.topics.map(t => [t.topic, t.lost]), [['Optik', 6], ['Dalgalar', 1]]);
  assert.equal(out.rep.fixes[0].concept, 'Kırılma');  // grouped case-insensitively
  assert.equal(out.rep.fixes[0].n, 2);
  assert.equal(out.rep.wrongN, 3);
  assert.equal(out.m.length, 3);
  assert.equal(out.m[0].type, 'open-ended');
  assert.equal(out.m[0]._given, 'a');
  assert.equal(out.m[0].correctAnswer, 'b');
  assert.equal(out.m[2].type, 'multiple-choice');
  assert.equal(out.m[2].correct, 1);
  assert.equal(out.m[2].mtype, 'careless');
  // Notebook entries are valid exam questions after normalization.
  assert.equal(run(`Parser.normalizeStudyData({ quiz: PaperReview.toMistakes(PaperReview.parseReview(raw)) }).quiz.length`), 3);
  assert.equal(run(`PaperReview.batches('--- Page 1 ---\\na\\n\\n--- Page 2 ---\\nb').length`), 1);
});

test('lab expression evaluator follows maths precedence and supports the whitelisted functions', () => {
  const { run } = modules();
  const ev = (src, scope) => run(`SimSpec.evaluate(${JSON.stringify(src)}, ${JSON.stringify(scope || {})})`);
  assert.equal(ev('1+2*3^2'), 19);
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('2x + 3(x-1)', { x: 2 }), 7);
  assert.ok(Math.abs(ev('2pi') - 2 * Math.PI) < 1e-12);
  assert.ok(Math.abs(ev('sin(pi/2) + cos(0) + sqrt(16) + ln(e) + exp(0) + abs(-1)') - 9) < 1e-12);
  assert.equal(ev('max(1, 5, 3) - min(4, 2)'), 3);
  assert.equal(ev('x > 1 and x < 5', { x: 3 }), 1);
  assert.equal(ev('not (x > 1) or x == 0', { x: 3 }), 0);
  assert.equal(ev('if(x > 1, 10, 20)', { x: 0 }), 20);
  assert.equal(ev('0.1 + 0.2 == 0.3'), 1);
  assert.equal(ev('3×4−1'), 11);
  assert.equal(ev('2**3'), 8);
  assert.equal(ev('1/0'), Infinity);
});
test('lab expression evaluator rejects anything that is not plain maths', () => {
  const { run } = modules();
  const bad = ['alert(1)', 'constructor', '__proto__', 'toString', 'hasOwnProperty(1)', 'x.constructor', 'Math.PI', 'this', 'window',
    '"a"', "'a'", '`a`', 'a[0]', 'x=1', 'x => x', '{}', 'eval("1")', 'Function("return 1")()', 'globalThis', 'process.exit()',
    '1+', '(1', 'sin()', 'min()', 'sin(1,2)', 'y', '1;2', '1 ? 2 : 3', '('.repeat(30) + '1' + ')'.repeat(30), '1' + '+1'.repeat(200), ''];
  for (const src of bad) {
    const r = JSON.parse(run(`JSON.stringify(SimSpec.compile(${JSON.stringify(src)}, ['x']))`));
    assert.equal(r.ok, false, 'should reject: ' + src);
    assert.equal(typeof r.error, 'string');
  }
  // Allowed names come only from the caller's whitelist.
  assert.equal(run(`SimSpec.compile('a + b', ['a']).ok`), false);
  assert.equal(run(`SimSpec.compile('a + b', ['a', 'b']).ok`), true);
});
test('lab specs are validated strictly and keep only safe, consistent parts', () => {
  const { run } = modules();
  const lab = JSON.parse(run(`JSON.stringify(SimSpec.sanitizeLab({
    template: 'motion', title: 'Pendulum', goal: 'Double the period',
    params: [{ id: 'L', label: 'Length', min: 0.1, max: 4, step: 0.05, value: 9, unit: 'm' }, { id: 'sin', min: 0, max: 1 }, { id: 'L', min: 0, max: 2 }, { id: 'bad', min: 5, max: 1 }, { id: '__proto__', min: 0, max: 1 }],
    derived: [{ id: 'T', expr: '2*pi*sqrt(L/9.8)', unit: 's' }, { id: 'U', expr: 'alert(T)' }, { id: 'V', expr: 'nope * 2' }],
    motion: { kind: 'pendulum', x: 'L*sin(0.3*cos(2*pi*t/T))', y: '-L*cos(0.3*cos(2*pi*t/T))', tEnd: '2*T' },
    challenges: [{ text: 'Make T = 2 s', check: 'abs(T-2) < 0.05' }, { text: 'evil', check: 'window.close()' }, { text: '', check: 'T > 1' }],
    solved: [0, 5, 'x']
  }))`));
  assert.deepEqual(lab.params.map(p => p.id), ['L']);
  assert.equal(lab.params[0].value, 4); // clamped into range
  assert.deepEqual(lab.derived.map(d => d.id), ['T']);
  assert.equal(lab.challenges.length, 1);
  assert.deepEqual(lab.solved, [0]);
  // Unknown template, missing template block, or no valid challenge → rejected.
  assert.equal(run(`SimSpec.sanitizeLab({ template: 'script', params: [{ id: 'a', min: 0, max: 1 }], challenges: [{ text: 'x', check: 'a > 0' }] })`), null);
  assert.equal(run(`SimSpec.sanitizeLab({ template: 'graph', params: [{ id: 'a', min: 0, max: 1 }], challenges: [{ text: 'x', check: 'a > 0' }] })`), null);
  assert.equal(run(`SimSpec.sanitizeLab({ template: 'graph', params: [{ id: 'a', min: 0, max: 1 }], graph: { curves: [{ expr: 'a*x' }] }, challenges: [{ text: 'x', check: 'document' }] })`), null);
  assert.equal(run(`SimSpec.sanitizeLab({ template: 'circuit', params: [{ id: 'V', min: 1, max: 9 }], circuit: { source: 'V', resistors: ['R9'] }, challenges: [{ text: 'x', check: 'I > 0' }] })`), null);
});
test('lab runtime computes derived values, circuits and challenge completion', () => {
  const { run } = modules();
  const out = JSON.parse(run(`JSON.stringify((() => {
    const lab = SimSpec.sanitizeLab({ template: 'circuit',
      params: [{ id: 'V', min: 1, max: 24, step: 1, value: 12 }, { id: 'R1', min: 0, max: 100, step: 1, value: 10 }, { id: 'R2', min: 1, max: 100, step: 1, value: 20 }],
      circuit: { source: 'V', resistors: ['R1', 'R2'], layout: 'series' },
      derived: [{ id: 'mA', expr: 'I*1000' }],
      challenges: [{ text: 'open', check: 'series == 1 and I == 0' }, { text: '1 A', check: 'abs(I-1) < 0.01' }] });
    const rt = SimSpec.runtime(lab);
    const s1 = rt.scope(null, { layout: 'series', off: {} });
    const s2 = rt.scope({ R1: 4, R2: 8 }, { layout: 'series', off: {} });
    const s3 = rt.scope(null, { layout: 'series', off: { R2: true } });
    const s4 = rt.scope(null, { layout: 'parallel', off: { R2: true } });
    return { minR1: lab.params[1].min, I1: s1.get('I'), mA: s1.get('mA'), c2: rt.checks(s2), c3: rt.checks(s3), I4: s4.get('I'), Req4: s4.get('Req') };
  })())`));
  assert.ok(out.minR1 > 0);
  assert.ok(Math.abs(out.I1 - 0.4) < 1e-12);
  assert.ok(Math.abs(out.mA - 400) < 1e-9);
  assert.deepEqual(out.c2, [false, true]);
  assert.deepEqual(out.c3, [true, false]);
  assert.ok(Math.abs(out.I4 - 1.2) < 1e-12 && out.Req4 === 10);
});
test('labs and lesson storyboards survive normalization; malformed ones are dropped', () => {
  const { run } = modules();
  const d = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({ title: 't',
    labs: [{ template: 'graph', title: 'G', params: [{ id: 'a', min: 0, max: 2, value: 1 }], graph: { x: { min: -1, max: 1 }, curves: [{ expr: 'a*x^2' }] }, challenges: [{ text: 'c', check: 'a > 1.5' }] }, { template: 'evil' }, null],
    lessons: [{ title: 'L', slides: [{ title: 'One', bullets: ['a', 'b', 'c', 'd'], narration: 'Hi', formula: '$E=mc^2$', diagram: { kind: 'notes', index: 0 } }, { title: 'Two', bullets: [], narration: 'Bye', diagram: { kind: 'html', index: 0 } }] }, { title: 'one slide', slides: [{ title: 'x', narration: 'y' }] }]
  }))`));
  assert.equal(d.labs.length, 1);
  assert.equal(d.labs[0].graph.curves[0].expr, 'a*x^2');
  assert.equal(d.lessons.length, 1);
  assert.equal(d.lessons[0].slides[0].bullets.length, 3);
  assert.equal(d.lessons[0].slides[0].formula, 'E=mc^2');
  assert.deepEqual(d.lessons[0].slides[0].diagram, { kind: 'notes', index: 0 });
  assert.equal(d.lessons[0].slides[1].diagram, undefined);
  const empty = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({ title: 't', labs: 'x', lessons: {} }))`));
  assert.equal('labs' in empty || 'lessons' in empty, false);
});
