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
  for (const file of ['simspec', 'parser', 'decks', 'stats', 'api', 'sources', 'planner', 'adaptive', 'insights', 'pastpaper', 'mebindex', 'mebsets', 'scenarioset', 'mebscen', 'paperreview', 'memory', 'predictor', 'concepts', 'coach', 'live-core', 'class-core']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), ctx);
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

// ===== Study brain: memory model, predictor, concept map, coach =====
// Synthetic review history: cards reviewed on the default schedule while the
// "true" learner forgets with multiplier cTrue (deterministic LCG).
const SYNTH = `
function synthDeck(id, cTrue, nCards, seed) {
  let x = seed; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const DAY = 864e5, rlog = [], truth = { w: Decks.W.slice(0, 4), c: cTrue };
  for (let i = 0; i < nCards; i++) {
    let t = Date.UTC(2026, 0, 1) + i * 3600e3, sched = null, tru = null;
    for (let k = 0; k < 6; k++) {
      let g;
      if (!sched) g = rnd() < 0.2 ? 1 : 3;
      else g = rnd() < Math.pow(1 + 19 / 81 * ((t - tru.last) / DAY) / (tru.stab * cTrue), -0.5) ? 3 : 1;
      rlog.push([i + 1, Math.round(t / 60000), g, sched ? Math.round((t - sched.last) / DAY * 100) / 100 : 0, sched ? sched.stab : 0, sched ? sched.diff : 0]);
      sched = Decks.nextState(sched, g, t, null);
      tru = Decks.nextState(tru, g, t, truth);
      t += Decks.intervalDays(sched.stab, null) * DAY;
    }
  }
  return { id, rlog, data: { flashcards: [] }, srs: {} };
}`;
test('reviews are logged compactly per deck and the log is capped', () => {
  const { run } = modules();
  const out = JSON.parse(run(`
    Decks.save({ title: 'x', flashcards: [{ id: 1, front: 'a', back: 'b' }] }, '');
    Decks.review(1, 5); Decks.review(1, 1);
    const d = Decks.getActive();
    const first = JSON.stringify(d.rlog);
    for (let i = 0; i < 400; i++) Decks.review(1, 5);
    JSON.stringify({ first: JSON.parse(first), len: d.rlog.length });
  `));
  assert.equal(out.first.length, 2);
  assert.deepEqual(out.first[0].slice(2), [3, 0, 0, 0]);          // first review: no prior state
  assert.equal(out.first[1][2], 1);                               // grade Again
  assert.ok(out.first[1][4] > 0 && out.first[1][5] > 0);          // stability/difficulty before
  assert.equal(out.len, 300);
});
test('golden-section search finds the minimum of a unimodal function', () => {
  const { run } = modules();
  assert.ok(Math.abs(run(`Memory.golden(x => (x - 1.3) ** 2 + 2, -5, 5)`) - 1.3) < 1e-3);
});
test('memory model fit recovers slower and faster forgetting and is deterministic', () => {
  const { run } = modules();
  const out = JSON.parse(run(SYNTH + `
    const slow = Memory.sequences([synthDeck('a', 2, 70, 7)]);
    const fast = Memory.sequences([synthDeck('b', 0.5, 70, 11)]);
    const A = Memory.fit(slow), A2 = Memory.fit(slow), B = Memory.fit(fast);
    JSON.stringify({ A, A2, B });
  `));
  // Effective stability after a first "Good" (w3 × c) vs the default 3.71 days.
  assert.ok(out.A.w[2] * out.A.c > 5, 'slow forgetter ' + JSON.stringify(out.A));
  assert.ok(out.B.w[2] * out.B.c < 3, 'fast forgetter ' + JSON.stringify(out.B));
  assert.ok(out.A.c > 1 && out.B.c < 1);
  assert.ok(out.A.ll > out.A.llDefault && out.B.ll > out.B.llDefault);
  assert.deepEqual(out.A, out.A2);
});
test('personal params kick in only past the threshold and then drive scheduling and recall', () => {
  const { run } = modules();
  const out = JSON.parse(run(SYNTH + `
    const few = Memory.ensure([synthDeck('a', 2, 10, 3)]);
    const many = Memory.ensure([synthDeck('a', 2, 70, 7)]);
    Decks.save({ title: 'x', flashcards: [{ id: 1, front: 'a', back: 'b' }] }, '');
    const s = Decks.review(1, 5);
    JSON.stringify({ few, many, cur: Memory.current(), stab: s.stab, gap: (s.due - s.last) / 864e5,
      r: Decks.retrievability(10, 5), rDefault: Decks.retrievability(10, 5, 1) });
  `));
  assert.equal(out.few.fitted, false);
  assert.ok(out.few.n < 200);
  assert.equal(out.many.fitted, true);
  assert.equal(out.cur.c, out.many.c);
  assert.equal(out.stab, out.many.w[2]);
  assert.equal(out.gap, Math.max(1, Math.round(out.many.w[2] * out.many.c)));
  assert.ok(out.r > out.rDefault);
});
test('memory forecast: per-topic recall at the horizon, stop-now never beats keep-up', () => {
  const { run } = modules();
  const f = JSON.parse(run(`
    const now = Date.UTC(2026, 9, 1), DAY = 864e5;
    const deck = { id: 'd', examDate: '2026-10-13', data: { flashcards: [
      { id: 1, category: 'Cells' }, { id: 2, category: 'Cells' }, { id: 3, category: 'Genes' }, { id: 4, category: 'Genes' }] },
      srs: { 1: { stab: 2, diff: 5, reps: 2, last: now - DAY, due: now + DAY }, 2: { stab: 30, diff: 4, reps: 4, last: now - DAY, due: now + 29 * DAY },
             3: { stab: 1, diff: 7, reps: 1, last: now - 3 * DAY, due: now - 2 * DAY } } };
    JSON.stringify(Memory.forecast(deck, now + 12 * DAY, Memory.defaults(), now));
  `));
  assert.equal(f.total.n, 4);
  assert.equal(f.total.seen, 3);
  f.topics.forEach(t => assert.ok(t.keep >= t.stop - 1e-9, JSON.stringify(t)));
  const genes = f.topics.find(t => t.name === 'Genes');
  assert.ok(genes.stop < 0.5);                                   // one forgotten-ish card + one unseen
  assert.ok(genes.keep > 0.8);                                   // keeping up learns and reviews both
  assert.equal(f.topics[0].name, 'Genes');                       // weakest first
});
test('marks-per-minute ranking favours unlearned, heavily weighted material and respects the budget', () => {
  const { run } = modules();
  const r = JSON.parse(run(`
    const now = Date.UTC(2026, 9, 1), DAY = 864e5;
    const cards = [];
    for (let i = 1; i <= 40; i++) cards.push({ id: i, category: i <= 20 ? 'Heavy' : 'Light' });
    const quiz = [];
    for (let i = 1; i <= 10; i++) quiz.push({ id: i, category: i <= 8 ? 'Heavy' : 'Light' });
    const srs = {};
    for (let i = 1; i <= 40; i++) if (i % 2) srs[i] = { stab: 40, diff: 4, reps: 5, last: now - DAY, due: now + 39 * DAY };
    const deck = { id: 'd', examDate: '2026-10-11', data: { flashcards: cards, quiz }, srs };
    const a = Predictor.rank(deck, now, Memory.defaults(), 10), b = Predictor.rank(deck, now, Memory.defaults(), 10);
    JSON.stringify({ a, same: JSON.stringify(a) === JSON.stringify(b) });
  `));
  assert.ok(r.same);
  assert.equal(r.a.items[0].topic, 'Heavy');
  assert.equal(r.a.items[0].seen, false);
  for (let i = 1; i < r.a.items.length; i++) assert.ok(r.a.items[i - 1].mpm >= r.a.items[i].mpm);
  assert.ok(r.a.minutes >= 10 && r.a.minutes < 11);
  assert.ok(r.a.marks > 0);
  const strong = r.a.items.find(x => x.seen);
  assert.ok(strong.gain < 0.1);                                  // well-learned cards gain little
});
test('exam prediction gives an honest range that narrows with evidence', () => {
  const { run } = modules();
  const out = JSON.parse(run(`
    const now = Date.UTC(2026, 9, 1), DAY = 864e5;
    const mk = (answers) => {
      const quiz = [], qstats = {};
      for (let i = 1; i <= 10; i++) { quiz.push({ id: i, category: i <= 5 ? 'A' : 'B' }); if (answers) qstats[i] = { n: answers, ok: i <= 5 ? answers : Math.floor(answers / 2), t: now }; }
      const cards = [1, 2, 3, 4].map(id => ({ id, category: id <= 2 ? 'A' : 'B' }));
      const srs = { 1: { stab: 20, diff: 4, reps: 3, last: now - DAY, due: now + 19 * DAY }, 3: { stab: 3, diff: 6, reps: 2, last: now - DAY, due: now + 2 * DAY } };
      return { id: 'd', examDate: '2026-10-11', data: { flashcards: cards, quiz }, srs, qstats };
    };
    JSON.stringify({ few: Predictor.predict(mk(1), now, Memory.defaults()), lots: Predictor.predict(mk(6), now, Memory.defaults()),
      none: Predictor.predict({ id: 'x', data: {} }, now),
      blank: Predictor.predict(Object.assign(mk(0), { srs: {} }), now, Memory.defaults()) });
  `));
  assert.equal(out.none, null);
  assert.equal(out.blank.insufficient, true);                  // no evidence: no number shown
  assert.equal(out.few.insufficient, false);
  for (const p of [out.few, out.lots]) {
    assert.ok(p.low <= p.score && p.score <= p.high, JSON.stringify(p));
    assert.ok(p.stop <= p.score);
    assert.equal(p.topics[0].name, 'B');                         // weakest topic first
  }
  assert.ok(out.lots.high - out.lots.low < out.few.high - out.few.low);
  assert.equal(out.lots.daysLeft, 10);
});
test('concept graph links decks through shared terms and finds prerequisite gaps', () => {
  const { run } = modules();
  const out = JSON.parse(run(`
    const now = Date.UTC(2026, 9, 1), DAY = 864e5;
    const bio = { id: 'bio', data: { notes: { sections: [{ title: 'Cells', keyTerms: [
        { term: 'Mitosis', definition: 'Division of a cell nucleus after DNA replication.' },
        { term: 'DNA replication', definition: 'Copying the genome before division.' }] }] },
      flashcards: [{ id: 1, front: 'What is mitosis?', back: 'Nuclear division', category: 'Cells' },
                   { id: 2, front: 'When does DNA replication happen?', back: 'S phase', category: 'Cells' }],
      quiz: [{ id: 1, question: 'Mitosis produces?', options: ['2 cells', '4 cells'], category: 'Cells' }] },
      srs: { 1: { stab: 1, diff: 8, reps: 4, lapses: 3, last: now - 5 * DAY }, 2: { stab: 1, diff: 8, reps: 3, lapses: 2, last: now - 6 * DAY } },
      qstats: { 1: { n: 3, ok: 0, last: 0 } }, mistakes: [{ question: 'Mitosis produces?' }] };
    const chem = { id: 'chem', data: { flashcards: [{ id: 1, front: 'Which enzyme drives DNA replication?', back: 'Polymerase', category: 'Enzymes' }] }, srs: {} };
    const g = ConceptMap.build([bio, chem], ConceptMap.sanitize({ e: [['mitosis', 'cells', 'r', 5], ['__proto__', 'x', 'p', 1], ['a', 'a', 'p', 1]] }));
    const an = ConceptMap.analyse(g, [bio, chem], now, 1);
    JSON.stringify({ rep: g.nodes.get('dna replication'), edges: g.edges, gaps: an.gaps, weak: an.weak.map(n => n.key) });
  `));
  assert.deepEqual(out.rep.decks.sort(), ['bio', 'chem']);       // cross-deck link via the term
  assert.ok(out.edges.some(e => e.a === 'mitosis' && e.b === 'dna replication' && e.type === 'pre' && e.src === 'def'));
  assert.ok(out.edges.some(e => e.src === 'ai' && e.type === 'rel'));
  assert.equal(out.gaps[0].a, 'mitosis');
  assert.equal(out.gaps[0].b, 'dna replication');
  assert.ok(out.weak.includes('mitosis'));
});
test('stored concept edges are sanitized and merge as a union with deletions', () => {
  const { run, storage } = modules();
  run(`ConceptMap.mergeRemote({ e: [['a', 'b', 'p', 10], ['a', 'b', 'p', 11], ['constructor', 'b', 'p', 1], ['x', 'y', 'bad', 1]] })`);
  let st = JSON.parse(storage.get('flashmind_concepts_v1'));
  assert.deepEqual(st.e, [['a', 'b', 'p', 10]]);
  run(`ConceptMap.mergeRemote(JSON.stringify({ e: [['c', 'd', 'r', 20]], cleared: 15 }))`);
  st = JSON.parse(storage.get('flashmind_concepts_v1'));
  assert.deepEqual(st.e, [['c', 'd', 'r', 20]]);
  assert.equal(st.cleared, 15);
});
test('coach decision is deterministic and follows the situation', () => {
  const { run } = modules();
  const out = JSON.parse(run(`
    const now = Date.UTC(2026, 9, 1), DAY = 864e5;
    const base = { title: 'T', daysLeft: null, cards: 40, unseen: 0, due: 0, todayNew: 0, questions: 0, mistakes: 0,
      lastPractice: 0, sureN: 0, sureAcc: 1, over: 0, hasMap: true, gain20: 0 };
    const d = o => Object.assign({}, base, o);
    const dec = (decks, extra) => Coach.decide(Object.assign({ now, decks, caps: { voice: false }, recent: [] }, extra || {}));
    JSON.stringify({
      none: dec([]),
      rest: dec([d({ id: 'a' })]),
      review: dec([d({ id: 'a', due: 45 }), d({ id: 'b', unseen: 5 })]),
      examTomorrow: dec([d({ id: 'a', due: 45 }), d({ id: 'b', daysLeft: 1, gain20: 6 })]),
      mistakes: dec([d({ id: 'a', mistakes: 14 }), d({ id: 'b', due: 6 })]),
      adaptive: dec([d({ id: 'a', daysLeft: 6, questions: 30, lastPractice: now - 9 * DAY, gain20: 0.5 })]),
      voice: dec([d({ id: 'a', sureN: 20, sureAcc: 0.5, over: 4 })], { caps: { voice: true } }),
      over: dec([d({ id: 'a', sureN: 20, sureAcc: 0.5, over: 4 })]),
      map: dec([d({ id: 'a', unseen: 3 })], { recent: [{ k: 'new', d: 'a' }, { k: 'review', d: null }] }),
      again: dec([d({ id: 'a', due: 20 }), d({ id: 'b', unseen: 20 })], { recent: [{ k: 'review', d: null }] }),
      fresh: dec([d({ id: 'a', due: 20 }), d({ id: 'b', unseen: 20 })]),
      tie1: dec([d({ id: 'b', unseen: 20 }), d({ id: 'a', unseen: 20 })]),
      tie2: dec([d({ id: 'a', unseen: 20 }), d({ id: 'b', unseen: 20 })])
    });
  `));
  assert.equal(out.none.kind, 'none');
  assert.equal(out.rest.kind, 'rest');
  assert.equal(out.review.kind, 'review');
  assert.deepEqual([out.examTomorrow.kind, out.examTomorrow.deckId, out.examTomorrow.why.key], ['marks', 'b', 'coachWhyMarksUrgent']);
  assert.deepEqual([out.mistakes.kind, out.mistakes.deckId], ['mistakes', 'a']);
  assert.equal(out.adaptive.kind, 'adaptive');
  assert.equal(out.voice.kind, 'voice');
  assert.equal(out.over.kind, 'over');
  assert.equal(out.map.kind, 'mindmap');
  assert.equal(out.fresh.kind, 'review');
  assert.equal(out.again.kind, 'new');                           // just reviewed: don't repeat straight away
  assert.deepEqual(out.tie1, out.tie2);                          // input order doesn't matter
});
test('coach summary reads exam date, due load, practice age and calibration from a deck', () => {
  const { run } = modules();
  const s = JSON.parse(run(`
    const now = Date.now(), DAY = 864e5;
    const dt = new Date(now + 5 * DAY);
    const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    const deck = { id: 'd', examDate: key, data: { title: 'Bio', flashcards: [{ id: 1, category: 'A' }, { id: 2, category: 'A' }], quiz: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
      srs: { 1: { stab: 1, diff: 5, reps: 2, last: now - 3 * DAY, due: now - DAY } },
      qstats: { 1: { n: 1, ok: 1, t: now - 2 * DAY } }, mistakes: [{ question: 'q' }],
      calib: { 1: { sure: [1, 3], lastSureMiss: now } } };
    JSON.stringify(Coach.summarize(deck, now, null));
  `));
  assert.equal(s.daysLeft, 5);
  assert.equal(s.due, 1);
  assert.equal(s.unseen, 1);
  assert.equal(s.questions, 4);
  assert.equal(s.mistakes, 1);
  assert.equal(s.sureN, 4);
  assert.equal(s.sureAcc, 0.25);
  assert.equal(s.over, 1);
  assert.ok(s.gain20 > 0);
});

test('camera frames go up only when they can help', () => {
  const { run } = modules();
  const send = o => run(`LiveCore.shouldSendFrame(${JSON.stringify(o)})`);
  assert.equal(send({ now: 1000, lastSent: 0, changed: false, speaking: false }), true);
  assert.equal(send({ now: 10000, lastSent: 1000, changed: false, speaking: false }), false);
  assert.equal(send({ now: 4000, lastSent: 1000, changed: true, speaking: false }), true);
  assert.equal(send({ now: 2000, lastSent: 1000, changed: true, speaking: false }), false);
  assert.equal(send({ now: 2100, lastSent: 1000, changed: true, speaking: true }), true);
  assert.equal(send({ now: 3000, lastSent: 1000, changed: false, speaking: true }), false);
  assert.equal(send({ now: 6100, lastSent: 1000, changed: false, speaking: true }), true);
  assert.equal(send({ now: 1600, lastSent: 1000, changed: false, speaking: true, speechStarted: true }), true);
  assert.equal(run('LiveCore.frameDiff(new Uint8Array([10,10]), new Uint8Array([10,30]))'), 10);
  assert.equal(run('LiveCore.frameDiff(new Uint8Array([1]), null)'), 255);
  assert.deepEqual(JSON.parse(run('JSON.stringify(LiveCore.frameSize(1280, 720))')), { w: 640, h: 360 });
  assert.deepEqual(JSON.parse(run('JSON.stringify(LiveCore.frameSize(720, 1280))')), { w: 360, h: 640 });
  assert.equal(run('LiveCore.isVoice(new Int16Array(512).fill(3000))'), true);
  assert.equal(run('LiveCore.isVoice(new Int16Array(512).fill(50))'), false);
});
test('lecture transcript fragments become timestamped segments and note chunks', () => {
  const { run } = modules();
  const segs = JSON.parse(run(`const s = []; LiveCore.addFragment(s, 'Bugün', 0); LiveCore.addFragment(s, ' hücreyi', 800); LiveCore.addFragment(s, 'işleyeceğiz', 1200); LiveCore.addFragment(s, 'Zar', 9000); JSON.stringify(s)`));
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'Bugün hücreyi işleyeceğiz');
  assert.equal(segs[1].at, 9000);
  assert.equal(run('LiveCore.clock(3725000)'), '1:02:05');
  assert.equal(run(`LiveCore.transcriptText([{at:65000,text:'a '}])`), '[1:05] a');
  const seg = (n, len) => Array.from({ length: n }, (_, i) => ({ at: i * 1000, end: i * 1000, text: 'x'.repeat(len) }));
  const chunk = (segsArr, opts) => JSON.parse(run(`JSON.stringify(LiveCore.nextChunk(${JSON.stringify(segsArr)}, 0, ${JSON.stringify(opts)}))`));
  assert.equal(chunk(seg(3, 300), { now: 60000, lastAt: 0 }), null);              // too early
  assert.deepEqual(chunk(seg(3, 300), { now: 300001, lastAt: 0 }), { from: 0, to: 3, chars: 903 });
  assert.equal(chunk(seg(1, 100), { now: 300001, lastAt: 0 }), null);              // too little
  assert.equal(chunk(seg(1, 100), { now: 1, lastAt: 0, final: true }).to, 1);      // the rest, at the end
  assert.equal(chunk(seg(30, 400), { now: 1, lastAt: 0 }).to, 14);                 // long: early, bounded
});
test('teacher cues and repetition are detected in Turkish and English', () => {
  const { run } = modules();
  const cues = JSON.parse(run(`JSON.stringify(LiveCore.detectCues('Arkadaşlar BU ÇOK ÖNEMLİ, sınavda kesin çıkar. Hücre zarına seçici geçirgen zar denir. Dikkat edin! Tekrar ediyorum. This will be on the exam, write that down.'))`));
  const types = cues.map(c => c.type);
  for (const t of ['important', 'exam', 'definition', 'attention', 'repeat']) assert.ok(types.includes(t), t);
  assert.equal(types.filter(t => t === 'exam').length, 2);
  assert.equal(JSON.parse(run(`JSON.stringify(LiveCore.detectCues('Bugün hava güzel, teneffüste görüşürüz.'))`)).length, 0);
  const rep = JSON.parse(run(`JSON.stringify(LiveCore.repeatedPhrases('mitoz bölünme önemli. mitoz bölünme iki hücre verir. yine mitoz bölünme ve ve ve ve'))`));
  assert.equal(rep[0].phrase, 'mitoz bölünme');
  assert.equal(rep[0].count, 3);
});
test('lecture chunk output is bounded and typed; the prompt carries cues and known cards', () => {
  const { ctx, run } = modules();
  ctx.raw = { sections: [{ title: 'T', content: 'c', bulletPoints: ['a', 5], keyTerms: [{ term: 'x' }] }, { title: '', content: 'no title' }],
    flashcards: [{ front: 'q', back: 'a', exam: true, difficulty: 'evil' }, { front: 'q2' }, ...Array(10).fill({ front: 'f', back: 'b' })],
    examAlerts: [{ point: 'p', quote: 'bu sınavda çıkar', why: 'nope' }, { quote: 'no point' }] };
  const out = JSON.parse(run('JSON.stringify(LiveCore.sanitizeChunk(raw))'));
  assert.equal(out.sections.length, 1);
  assert.deepEqual(out.sections[0].bulletPoints, ['a']);
  assert.deepEqual(out.sections[0].keyTerms, []);
  assert.equal(out.flashcards.length, 6);
  assert.deepEqual(out.flashcards[0], { front: 'q', back: 'a', difficulty: 'medium', exam: true });
  assert.deepEqual(out.examAlerts, [{ point: 'p', quote: 'bu sınavda çıkar', why: 'important' }]);
  assert.deepEqual(JSON.parse(run('JSON.stringify(LiveCore.sanitizeChunk(null))')), { sections: [], flashcards: [], examAlerts: [] });
  const prompt = run(`LiveCore.lecturePrompt({ transcript: '[0:01] metin', cues: [{ match: 'sınavda çıkar' }], repeated: [{ phrase: 'mitoz bölünme', count: 3 }], known: ['Eski kart'], lang: 'tr', part: 2 })`);
  assert.match(prompt, /part 2/);
  assert.match(prompt, /"sınavda çıkar"/);
  assert.match(prompt, /mitoz bölünme" \(3x\)/);
  assert.match(prompt, /- Eski kart/);
  assert.match(prompt, /Write in Turkish/);
  assert.match(prompt, /Return ONLY JSON/);
});
test('lecture transcripts survive normalization as a lecture source', () => {
  const { run } = modules();
  const d = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData({ title: 'x', sources: [{ id: 'slec', name: 'Ders', kind: 'lecture', text: '[0:01] merhaba' }], notes: { sections: [{ title: 'Sınav uyarıları', content: '', lectureAlerts: 'lec1' }] }, flashcards: [{ front: 'q', back: 'a', exam: true }] }))`));
  assert.equal(d.sources[0].kind, 'lecture');
  assert.equal(d.notes.sections[0].lectureAlerts, 'lec1');
  assert.equal(d.flashcards[0].exam, true);
});

test('class decks keep FSRS progress and history by content when the teacher pushes a new version', () => {
  const { run } = modules();
  const out = JSON.parse(run(`JSON.stringify(ClassCore.remapProgress(
    { data: { flashcards: [{ id: 1, front: 'Mitoz', back: 'a' }, { id: 2, front: 'Mayoz', back: 'b' }, { id: 3, front: 'Gone', back: 'c' }],
              quiz: [{ id: 1, question: 'Q one' }, { id: 2, question: 'Q two', type: 'true-false' }] },
      srs: { 1: { reps: 3 }, 2: { reps: 1 }, 3: { reps: 9 } }, qstats: { 1: { n: 2, ok: 1 }, 2: { n: 1, ok: 1 } }, calib: { 2: { sure: [1, 0] } } },
    { flashcards: [{ id: 1, front: 'New card', back: 'x' }, { id: 2, front: '  mitoz ', back: 'edited' }, { id: 3, front: 'Mayoz', back: 'b' }],
      quiz: [{ id: 1, question: 'Q two', type: 'true-false' }, { id: 2, question: 'Q one' }] }))`));
  assert.deepEqual(out.srs, { 2: { reps: 3 }, 3: { reps: 1 } });
  assert.deepEqual(out.qstats, { 1: { n: 1, ok: 1 }, 2: { n: 2, ok: 1 } });
  assert.deepEqual(out.calib, { 3: { sure: [1, 0] } });
});

test('upsertClassDeck refreshes the same deck, keeps progress and leaves the active deck alone', () => {
  const { run } = modules();
  const r = JSON.parse(run(`
    const mine = Decks.save({ title: 'mine', flashcards: [{ id: 1, front: 'f', back: 'b' }] }, '');
    const cls = { join: 'abcdefg', id: 'd1', ver: 1 };
    const a = Decks.upsertClassDeck(cls, { title: 'Class v1', flashcards: [{ id: 1, front: 'Mitoz', back: 'a' }] });
    Decks.reviewIn(a.id, 1, 5);
    const b = Decks.upsertClassDeck({ ...cls, ver: 2 }, { title: 'Class v2', flashcards: [{ id: 7, front: 'Other', back: 'z' }, { id: 8, front: 'Mitoz', back: 'a2' }] },
      (old, data) => ClassCore.remapProgress(old, data));
    const dup = Decks.duplicate(b.id);
    JSON.stringify({ same: a.id === b.id, title: b.data.title, ver: b.cls.ver, srs: Object.keys(b.srs), active: Decks.getActive().id === mine.id,
      count: Decks.list().length, dupCls: dup.cls === undefined });
  `));
  assert.deepEqual(r, { same: true, title: 'Class v2', ver: 2, srs: ['8'], active: true, count: 3, dupCls: true });
});

test('class progress report is small and aggregated per deck and topic', () => {
  const { ctx, run } = modules();
  ctx.now = 1_000_000;
  const r = JSON.parse(run(`JSON.stringify(ClassCore.buildReport([
    { cls: { join: 'abcdefg', id: 'd1' }, data: { flashcards: [{ id: 1 }, { id: 2 }], quiz: [{ id: 1, category: 'Hücre' }, { id: 2, category: 'Hücre' }, { id: 3 }] },
      srs: { 1: { reps: 2, due: now + 5 }, 2: { reps: 1, due: now - 5 }, 9: { reps: 1, due: now + 5 } },
      qstats: { 1: { n: 2, ok: 2 }, 2: { n: 2, ok: 0 }, 3: { n: 1, ok: 1 } }, mistakes: [{ category: 'Hücre' }, {}] },
    { cls: { join: 'other00', id: 'd2' }, data: { flashcards: [] } },
    { data: { flashcards: [] } }
  ], 'abcdefg', now))`));
  assert.deepEqual(r, { decks: { d1: { m: 50, seen: 2, n: 5, acc: 60, topics: { 'Hücre': [2, 4], General: [1, 1] }, mis: { 'Hücre': 1, General: 1 } } } });
});

test('dashboard aggregation finds weakest topics and students who are behind', () => {
  const { ctx, run } = modules();
  ctx.now = 30 * 86400000;
  ctx.students = [
    { sid: 'a', nick: 'Ayşe', t: ctx.now - 1000, r: { decks: { d1: { m: 80, topics: { Hücre: [9, 10], Mitoz: [2, 6] }, mis: { Mitoz: 2 } } } } },
    { sid: 'b', nick: 'Mert', t: ctx.now - 9 * 86400000, r: { decks: { d1: { m: 20, topics: { Hücre: [1, 4], Mitoz: [1, 4] }, mis: {} } } } },
    { sid: 'c', nick: 'Ece', t: 0, r: null }
  ];
  const agg = JSON.parse(run('JSON.stringify(ClassCore.aggregate(students, now))'));
  assert.deepEqual(agg.topics.map(t => t.name), ['Mitoz', 'Hücre']);
  assert.deepEqual(agg.weakest.map(t => [t.name, t.pct]), [['Mitoz', 30], ['Hücre', 71]]);
  assert.equal(agg.rows[0].cells.Mitoz.pct, 33);
  assert.equal(agg.avgMastery, 50);
  assert.deepEqual(agg.behind, [
    { sid: 'b', nick: 'Mert', why: ['inactive', 'lowMastery', 'lowAccuracy'] },
    { sid: 'c', nick: 'Ece', why: ['noReport'] }
  ]);
});

test('revision exam picks weak-topic questions round-robin; battles take MC and true/false only', () => {
  const { run } = modules();
  const rev = JSON.parse(run(`JSON.stringify(ClassCore.revisionQuestions([
    [{ id: 1, question: 'm1', category: 'Mitoz' }, { id: 2, question: 'm2', category: 'Mitoz' }, { id: 3, question: 'm3', category: 'Mitoz' }, { id: 4, question: 'h1', category: 'Hücre' }],
    [{ id: 1, question: 'm1', category: 'Mitoz' }, { id: 9, question: 'x', category: 'Other' }]
  ], ['Mitoz', 'Hücre'], 3, () => 0.5))`));
  assert.equal(rev.length, 3);
  assert.deepEqual(rev.map(q => q.id), [1, 2, 3]);
  assert.deepEqual(rev.map(q => q.category).sort(), ['Hücre', 'Mitoz', 'Mitoz']);
  const b = JSON.parse(run(`JSON.stringify(ClassCore.battleQuestions([
    { type: 'multiple-choice', question: 'q1', options: ['a', 'b', 'c'], correct: 2 },
    { type: 'true-false', question: 'q2', correct: false },
    { type: 'multiple-choice', question: 'q3', options: ['1', '2', '3', '4', '5', '6'], correct: 0 },
    { type: 'fill-blank', question: 'q4', answers: ['x'] },
    { type: 'open-ended', question: 'q5' }
  ], { t: 'Doğru', f: 'Yanlış' }, 50))`));
  assert.deepEqual(b, [{ q: 'q1', o: ['a', 'b', 'c'], c: 2 }, { q: 'q2', o: ['Doğru', 'Yanlış'], c: 1 }]);
});

// ---------- MEB library ----------
const mebItems = [
  { id: 'a1', t: 'LGS 2025 Sözel', g: [8], s: 'Sözel', x: 'lgs', y: '2024-2025', u: 'https://cdn.eba.gov.tr/a.pdf', p: '', mb: 3.4, src: 'ods' },
  { id: 'a2', t: 'LGS 2025 Sayısal', g: [8], s: 'Sayısal', x: 'lgs', y: '2024-2025', u: 'https://cdn.eba.gov.tr/b.pdf', p: '', mb: 4.1, src: 'ods' },
  { id: 'a3', t: 'Coğrafya · 1. Dönem', g: [9], s: 'Coğrafya', x: 'konu', y: '2025-2026', u: 'https://cdn.eba.gov.tr/c.pdf', p: 'https://odsgm.meb.gov.tr/www/x/icerik/1474', mb: 0.4, src: 'ods' },
  { id: 'a4', t: 'Bursluluk 9-10', g: [9, 10], s: '', x: 'bursluluk', y: '2025-2026', u: 'https://cdn.eba.gov.tr/d.pdf', p: '', mb: null, src: 'ods' },
  { id: 'a5', t: 'Açık öğretim 1. oturum', g: [], s: '', x: 'acik', y: '2025-2026', u: 'https://cdn.eba.gov.tr/e.pdf', p: '', mb: 2, src: 'ods' }
];
const mebIds = (run, f) => JSON.parse(run(`JSON.stringify(MebIndex.filterItems(items, ${JSON.stringify(f)}).map(i => i.id))`));

test('MEB library filters by grade, exam type, subject and accent-insensitive search', () => {
  const { ctx, run } = modules();
  ctx.items = mebItems;
  assert.deepEqual(mebIds(run, {}), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(mebIds(run, { grade: 8, type: 'lgs' }), ['a1', 'a2']);
  assert.deepEqual(mebIds(run, { grade: 9 }), ['a3', 'a4']);               // a range matches each grade in it
  assert.deepEqual(mebIds(run, { grade: 10 }), ['a4']);
  assert.deepEqual(mebIds(run, { grade: 12 }), []);                        // ungraded files never match a grade
  assert.deepEqual(mebIds(run, { subject: 'Sayısal' }), ['a2']);
  assert.deepEqual(mebIds(run, { q: 'cografya' }), ['a3']);                // Coğrafya without the ğ
  assert.deepEqual(mebIds(run, { q: 'ACIK ogretim' }), ['a5']);            // every word must match
  assert.deepEqual(mebIds(run, { q: 'lgs 2025 sozel' }), ['a1']);
  assert.deepEqual(mebIds(run, { q: 'konu 2026' }), ['a3']);               // exam type code and year are searchable
  assert.deepEqual(mebIds(run, { grade: 8, q: 'cografya' }), []);
});
test('MEB library facets only offer subjects and exam types that exist under the other filters', () => {
  const { ctx, run } = modules();
  ctx.items = mebItems;
  assert.deepEqual(JSON.parse(run(`JSON.stringify(MebIndex.subjectsFor(items, { grade: 8 }))`)), ['Sayısal', 'Sözel']);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(MebIndex.subjectsFor(items, { grade: 8, subject: 'Sözel' }))`)), ['Sayısal', 'Sözel']);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(MebIndex.typeCounts(items, { grade: 9 }))`)), { konu: 1, bursluluk: 1 });
});
test('MEB library data is validated: only https MEB/EBA links, unique ids, readable topic tables', () => {
  const { ctx, run } = modules();
  const table = { id: 'a3', g: [9], s: 'Coğrafya', term: '1. Dönem', n: 2, rows: [['COĞ.9.1.1. Doğa', 3], ['COĞ.9.2.1. Harita', 2]] };
  ctx.good = { items: mebItems, topics: [table] };
  assert.equal(run('MebIndex.validate(good.items, good.topics).topics.get("a3").n'), 2);
  const bad = (items, topics, re) => {
    ctx.bad = { items, topics };
    assert.throws(() => run('MebIndex.validate(bad.items, bad.topics)'), re);
  };
  bad([{ ...mebItems[0], u: 'https://evil.example/a.pdf' }], [], /official MEB link/);
  bad([{ ...mebItems[0], u: 'http://cdn.eba.gov.tr/a.pdf' }], [], /official MEB link/);
  bad([{ ...mebItems[0], u: 'https://cdn.eba.gov.tr.evil.example/a.pdf' }], [], /official MEB link/);
  bad([mebItems[0], mebItems[0]], [], /duplicate id/);
  bad([{ ...mebItems[0], g: ['8'] }], [], /grades/);
  bad(mebItems, [{ ...table, id: 'zzz' }], /bad table/);
  bad(mebItems, [{ ...table, rows: [['only one', 1]] }], /bad table/);
  bad({}, [], /not a list/);
});
test('MEB topic table becomes the deck topic profile; an existing profile needs confirmation', async () => {
  const table = { id: 'a3', g: [9], s: 'Coğrafya', term: '1. Dönem', n: 2, rows: [['COĞ.9.1.1. Doğa', 3], ['COĞ.9.2.1. Harita', 2], ['COĞ.9.3.1. İklim', 1]] };
  const toasts = [];
  let asked = 0, answer = true;
  const fetched = [];
  const { ctx, run } = modules({}, {
    App: { showToast: (m, k) => toasts.push(k + ':' + m) },
    confirm: () => { asked++; return answer; },
    fetch: async url => { fetched.push(url); return { ok: true, json: async () => (/index/.test(url) ? mebItems : [table]) }; }
  });
  await run('MebIndex.load()');
  await run('MebIndex.load()');
  assert.deepEqual(fetched, ['data/meb/index.json', 'data/meb/topics.json']);   // fetched once, lazily
  // No open deck: explicit error, nothing saved.
  assert.equal(run('MebIndex.applyProfile("a3")'), null);
  assert.match(toasts.pop(), /^error:mebNoDeck/);
  run(`Decks.save({ title: 'Coğrafya' }, '')`);
  const saved = JSON.parse(run('JSON.stringify(MebIndex.applyProfile("a3"))'));
  assert.equal(asked, 0);
  assert.equal(saved.topicsFrom, 'distribution');
  assert.deepEqual(saved.topics.map(t => t.name), ['COĞ.9.1.1. Doğa', 'COĞ.9.2.1. Harita', 'COĞ.9.3.1. İklim']);
  assert.equal(saved.topics[0].weight, 0.5);
  assert.equal(saved.source, 'Coğrafya · 1. Dönem');
  // The same normalisation as a pasted distribution, so topicBoost works on it.
  assert.equal(run(`PastPaper.topicBoost(PastPaper.getProfile())({ category: 'COĞ.9.1.1. Doğa' })`), 1.5);
  // Replacing an existing profile asks first; "cancel" keeps it and keeps the paper style.
  run(`PastPaper.saveProfile(Object.assign({}, PastPaper.getProfile(), { style: { formats: { 'multiple-choice': 5 } }, topics: [{ name: 'Eski A', count: 1 }, { name: 'Eski B', count: 1 }] }))`);
  answer = false;
  assert.equal(run('MebIndex.applyProfile("a3")'), null);
  assert.equal(asked, 1);
  assert.deepEqual(JSON.parse(run('JSON.stringify(PastPaper.getProfile().topics.map(t => t.name))')), ['Eski A', 'Eski B']);
  answer = true;
  run('MebIndex.applyProfile("a3")');
  assert.equal(asked, 2);
  assert.equal(run('PastPaper.getProfile().topics.length'), 3);
  assert.equal(run(`PastPaper.getProfile().style.formats['multiple-choice']`), 5);
  assert.throws(() => run('MebIndex.applyProfile("nope")'), /Unknown topic table/);
});
test('MEB library load fails loudly when the data cannot be fetched', async () => {
  const { run } = modules({}, { fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(run('MebIndex.load()'), /HTTP 404/);
  await assert.rejects(run('MebIndex.load()'), /HTTP 404/);   // not cached: Retry can succeed later
});

// ---------- MEB index generator ----------
const mebFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/meb-manifests.json'), 'utf8'));
const mebGen = () => import(require('node:url').pathToFileURL(path.join(__dirname, '../scripts/build-meb-index.mjs')).href);

test('MEB generator: slim entries with original URLs, deduped, failed/personnel/no-URL dropped', async () => {
  const { build } = await mebGen();
  const { index, topics, stats } = build(mebFixture);
  assert.deepEqual(stats.excluded, { status: 1, personnel: 1, noUrl: 2, dup: 3 });
  assert.equal(index.length, 14);
  const keys = ['id', 't', 'g', 's', 'x', 'y', 'u', 'p', 'mb', 'src'];
  for (const r of index) {
    assert.deepEqual(Object.keys(r), keys);
    assert.match(r.id, /^[0-9a-f]{8}$/);
    assert.match(r.u, /^https:\/\/([a-z0-9-]+\.)*(meb\.gov\.tr|eba\.gov\.tr)\//);
    assert.ok(r.t.length > 0 && r.t.length <= 160);
  }
  assert.equal(new Set(index.map(r => r.id)).size, index.length);
  assert.equal(new Set(index.map(r => r.u)).size, index.length);
  const byUrl = end => index.find(r => r.u.endsWith(end));
  // redirected short link is stored under its final official URL, once
  assert.ok(byUrl('/trlgs/a_2026_sayisal.pdf'));
  assert.equal(index.filter(r => /meb\.ai/.test(r.u)).length, 0);
  assert.equal(byUrl('/2025sozel.pdf').mb, 3.4);
  assert.equal(byUrl('/2025sozel.pdf').p, 'https://odsgm.meb.gov.tr/www/x/icerik/1446');
  assert.deepEqual(topics.map(t => t.id), [byUrl('/konusoru/cog9.pdf').id]);
});
test('MEB generator: OGM yazılı records become ogm-yazili entries, id from the pdf file name, no year', async () => {
  const { build } = await mebGen();
  const { index, stats } = build(mebFixture);
  const e = index.find(r => r.x === 'ogm-yazili');
  assert.deepEqual(e, { id: '675fa374', t: '10. Sınıf Biyoloji - 1. Dönem 1. Yazılı', g: [10], s: 'Biyoloji', x: 'ogm-yazili', y: '',
    u: 'https://ogm-large-cdn.eba.gov.tr/materyal/Etkilesimlikitap/88dbfe33-1cd4-4062-b37c-350fccd41ba3/pdf.pdf', p: 'https://ogmmateryal.eba.gov.tr/yaziliya-hazirlaniyorum', mb: 1.2, src: 'ogm' });
  assert.equal(index.filter(r => r.x === 'ogm-kazanim').length, 0);
  assert.deepEqual(stats.noPublicUrl, ['ogm-kazanim: 9. Sınıf Matematik - Kazanım Kavrama']);       // reported, not listed
  const kz = { grade: 9, course: 'Matematik', title: 'Kazanım', url: 'https://ogm-large-cdn.eba.gov.tr/k.pdf', localFile: 'C:\\k\\9_Matematik_k1.pdf', sizeBytes: 100000 };
  const k = build({ ogmKazanim: [kz] }).index[0];
  assert.deepEqual([k.x, k.g, k.s, k.y, k.mb, k.p], ['ogm-kazanim', [9], 'Matematik', '', 0.1, '']);
  assert.throws(() => build({ ogmYazili: [{ ...kz, url: 'https://evil.example/k.pdf' }] }), /not an official MEB\/EBA/);
  assert.throws(() => build({ ogmYazili: [{ ...kz, course: 'Mystery' }] }), /unknown course/);
  assert.throws(() => build({ ogmYazili: [{ ...kz, localFile: '' }] }), /missing localFile/);
  // The real kazanım manifest: file address in `fileUrl`, grade '10. Sinif', course without Turkish letters.
  const real = { grade: '10. Sinif', course: 'Turk Dili ve Edebiyati', title: '10. Sinif Turk Dili ve Edebiyati Kazanim Kavrama Etkilesimli Kitap', fileUrl: 'https://ogm-large-cdn.eba.gov.tr/materyal/k2.pdf', localFile: 'C:\\k\\10_turkdili_kazanim_kavrama_kitap.pdf', sizeBytes: 10485760 };
  const rk = build({ ogmKazanim: [real, { ...real, grade: '11. Sinif', course: 'Cografya', fileUrl: 'https://ogm-large-cdn.eba.gov.tr/materyal/k3.pdf', localFile: 'C:\\k\\11_cografya_kazanim_kavrama_kitap.pdf' }] }).index;
  assert.deepEqual(rk.map(r => [r.x, r.g, r.s, r.t]), [
    ['ogm-kazanim', [10], 'Türkçe / Edebiyat', '10. Sınıf Türkçe / Edebiyat - Kazanım Kavrama Etkileşimli Kitap (2017-2023 müfredatı)'],
    ['ogm-kazanim', [11], 'Coğrafya', '11. Sınıf Coğrafya - Kazanım Kavrama Etkileşimli Kitap']]);
  assert.throws(() => build({ ogmKazanim: [{ ...real, grade: 'onuncu' }] }), /bad grade/);
  const { ctx, run } = modules();
  ctx.d = { index: [e], types: null };
  assert.equal(run('MebIndex.validate(d.index, []).items.length'), 1);                              // passes the library's https + MEB/EBA check
  assert.ok(run('MebIndex.TYPES.includes("ogm-yazili") && MebIndex.TYPES.includes("ogm-kazanim")'));
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebIndex.typeCounts(d.index, {}))')), { 'ogm-yazili': 1 });
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebIndex.filterItems(d.index, { type: "ogm-yazili", grade: 10 }).map(i => i.id))')), ['675fa374']);
});
test('MEB generator: OGM kazanım-bazlı records give one entry per distinct file, id from the file name', async () => {
  const { build } = await mebGen();
  const { index, stats } = build(mebFixture);
  const kb = index.filter(r => r.x === 'ogm-kazanim-bazli');
  assert.equal(mebFixture.ogmKazanimBazli.length, 3);                                              // three records, two distinct files
  assert.deepEqual(kb.map(r => r.id).sort(), ['5e73c2cc', 'd9540c86']);
  const base = 'https://ogmmateryal.eba.gov.tr/panel/upload/yardimci-kitap/';
  const p = 'https://ogmmateryal.eba.gov.tr/kazanim-bazli-kazanim-kavrama-etkinlikleri';
  assert.deepEqual(kb.find(r => r.g[0] === 11), { id: 'd9540c86', t: '11. Sınıf Biyoloji - SOLUNUM SİSTEMİ', g: [11], s: 'Biyoloji', x: 'ogm-kazanim-bazli', y: '',
    u: base + 'ihxeahee10o.pdf', p, mb: 0.3, src: 'ogm' });                                          // shared pair: first record kept, 11th grade has no curriculum suffix
  assert.deepEqual(kb.find(r => r.g[0] === 9), { id: '5e73c2cc', t: '9. Sınıf Türkçe / Edebiyat - HİKAYE ÇÖZÜMLEME (2017-2023 müfredatı)', g: [9], s: 'Türkçe / Edebiyat', x: 'ogm-kazanim-bazli', y: '',
    u: base + 'hk9cozum01.pdf', p, mb: 0.3, src: 'ogm' });
  assert.equal(build({ ogmKazanimBazli: mebFixture.ogmKazanimBazli }).stats.excluded.dup, 1);       // the second outcome of the shared file
  const rec = mebFixture.ogmKazanimBazli[0];
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, fileUrls: ['https://evil.example/x.pdf'] }] }), /not an official MEB\/EBA/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, fileUrls: ['http://ogmmateryal.eba.gov.tr/x.pdf'] }] }), /not an official MEB\/EBA/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, course: 'Mystery' }] }), /unknown course/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, gradeNo: 'on' }] }), /bad grade/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, gradeNo: undefined }] }), /bad grade/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, localFile: '' }] }), /missing localFile/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, activityTitle: ' ' }] }), /missing activityTitle/);
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, fileUrls: 'x' }] }), /fileUrls is not an array/);
  // two different files claiming one local file name would share an id
  assert.throws(() => build({ ogmKazanimBazli: [rec, { ...rec, fileUrls: [base + 'other.pdf'] }] }), /id collision d9540c86/);
  // one record with two file addresses has one local file name, so the second would share the id
  assert.throws(() => build({ ogmKazanimBazli: [{ ...rec, fileUrls: [base + 'a.pdf', base + 'b.pdf'] }] }), /id collision/);
  assert.deepEqual(build({ ogmKazanimBazli: [{ ...rec, fileUrls: [] }] }).stats.noPublicUrl, ['ogm-kazanim-bazli: SOLUNUM SİSTEMİ']);
});
test('MEB generator infers grade and subject from explicit names only', async () => {
  const { build } = await mebGen();
  const { index } = build(mebFixture);
  const at = end => index.find(r => r.u.endsWith(end));
  const gs = end => [at(end).g, at(end).s, at(end).x];
  assert.deepEqual(gs('/2025sozel.pdf'), [[8], 'LGS Sözel', 'lgs']);
  assert.deepEqual(gs('/konusoru/cog9.pdf'), [[9], 'Coğrafya', 'konu']);                 // cog9
  assert.deepEqual(gs('/9_10sinifB.pdf'), [[9, 10], '', 'bursluluk']);                  // manifest said [1]
  assert.deepEqual(gs('/11_fiz_1.pdf'), [[11], 'Fizik', 'sinif']);
  assert.deepEqual(gs('/1_OTURUM_AOO.pdf'), [[], '', 'acik']);                           // manifest said grade 1 / Sosyal
  assert.deepEqual(gs('/27154611_lise.pdf'), [[], '', 'dort-beceri']);                   // manifest said Matematik
  assert.deepEqual(gs('/KSDT/ankmeb4.xlsx'), [[], 'Biyoloji', 'konu']);                  // subject from the row title, no grade
  assert.deepEqual(gs('/konusoru/fiz9.pdf'), [[], '', 'konu']);                          // file name says Fizik, title says Kimya: unknown
  assert.deepEqual(gs('/fizik.pdf'), [[11, 12], 'Fizik', 'yks']);
  assert.deepEqual(gs('/reading.pdf'), [[11, 12], 'İngilizce', 'yks']);
  assert.equal(at('/fizik.pdf').y, '');
  assert.equal(at('/reading.pdf').mb, null);
});
test('MEB generator: identical titles get a friendly suffix (unit, readable file-name words, else (2), (3)), never an opaque stem', async () => {
  const { disambiguate } = await mebGen();
  const run = (x, rows) => {
    const index = rows.map(([stem, unit], i) => ({ id: 'e' + i, t: 'Başlık', g: [9], s: 'Fizik', x }));
    disambiguate(index, new Map(rows.map(([stem, unit], i) => ['e' + i, { stem, unit: unit || '' }])));
    return index.map(r => r.t);
  };
  assert.deepEqual(run('ogm-kazanim-bazli', [['2mfwtdyc51h', 'Isı'], ['llwv3xo5fby', 'Elektrik']]), ['Başlık — Isı', 'Başlık — Elektrik']);
  assert.deepEqual(run('ogm-kazanim-bazli', [['2mfwtdyc51h', 'Isı'], ['llwv3xo5fby', 'Isı'], ['05prucgpsol', 'Isı']]), ['Başlık', 'Başlık (2)', 'Başlık (3)']);
  assert.deepEqual(run('ortak', [['7S_Turkce_Sabah_Cevap'], ['7S_Turkce_ogle_Cevap'], ['7S_Turkce_Mazeret_Sabah_Cevap']]), ['Başlık — Sabah', 'Başlık — Öğle', 'Başlık — Mazeret Sabah']);
  assert.deepEqual(run('konu', [['dkab_lise2'], ['dkab_orta3']]), ['Başlık — Lise', 'Başlık — Orta']);
  assert.deepEqual(run('lgs', [['a_2026_sayisal'], ['b_2026_sayisal']]), ['Başlık — A', 'Başlık — B']);
  assert.deepEqual(run('acik', [['6a60828016fd_x1y2z3q4w5'], ['9b60828016fd_x1y2z3q4w6']]), ['Başlık', 'Başlık (2)']);   // random-looking stems carry no words
  assert.deepEqual(run('konu', [['cydem_ing5_2'], ['cydem_ing6_2']]), ['Başlık', 'Başlık (2)']);                    // bare numbers say nothing
  assert.deepEqual(run('sinif', [['x']]), ['Başlık']);                                                              // a unique title is left alone
  // a long title keeps its suffix
  const long = [{ id: 'a', t: 'U'.repeat(158), g: [], s: '', x: 'ortak' }, { id: 'b', t: 'U'.repeat(158), g: [], s: '', x: 'ortak' }];
  disambiguate(long, new Map([['a', { stem: 'Sabah', unit: '' }], ['b', { stem: 'Ogle', unit: '' }]]));
  assert.ok(long.every(r => r.t.length <= 160) && long[0].t.endsWith(' — Sabah') && long[1].t.endsWith(' — Öğle'));
});
test('committed MEB index: no two titles of one type + grade + subject are identical and no title ends in an opaque file stem', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/meb/index.json'), 'utf8'));
  const keys = index.map(r => [r.x, r.g.join(','), r.s, r.t].join('|'));
  assert.equal(new Set(keys).size, keys.length);
  const opaque = r => { const m = r.t.match(/ — ([a-z0-9]{6,})$/); return !!m && /\d/.test(m[1]) && !/^[a-z]+\d{0,2}$/.test(m[1]) && !/^\d{4}[a-z]+$/.test(m[1]) && !/^\d[a-z]{3,}\d?$/.test(m[1]); };
  const bad = index.filter(opaque);
  console.log('      titles ending in a random-looking stem: ' + bad.length);
  assert.deepEqual(bad.map(r => r.t), []);
  assert.deepEqual(index.filter(r => r.x === 'ogm-kazanim-bazli' && / — /.test(r.t)).map(r => r.t), []);   // the OGM titles carry the activity name, ' (2)' or the unit, never a file stem
});
test('MEB generator: an entry without a grade takes it from its konu sheet names or its study set, never from a guess', async () => {
  const { build, setGrades } = await mebGen();
  assert.deepEqual(setGrades({ grade: [9, 10, 11, 12] }, 'x'), [9, 10, 11, 12]);
  assert.deepEqual(setGrades({ grade: ['10', '11'] }, 'x'), [10, 11]);
  assert.deepEqual(setGrades({ grade: ['Açık Lise 9-12'] }, 'x'), [9, 10, 11, 12]);
  assert.deepEqual(setGrades({}, 'x'), []);
  assert.throws(() => setGrades({ grade: ['lise'] }, 'x'), /cannot read meta.grade/);
  assert.throws(() => setGrades({ grade: 9 }, 'x'), /not a list/);
  const rec = (name, extra) => ({ title: 'Oturum', pageTitle: 'Açık öğretim', examType: 'Acik Ogretim', fileUrl: 'https://odsgm.meb.gov.tr/' + name + '.pdf', schoolYear: '2025-2026', sourcePage: 'https://odsgm.meb.gov.tr/p', ...extra });
  const id = name => build({ ods2: [rec(name)] }).index[0].id;
  const set = meta => ({ bytes: 10, data: { meta } });
  const sets = new Map([[id('a'), set({ grade: ['Açık Lise 9-12'] })], [id('b'), set({ grade: [7] })], [id('c'), set({})],
    [id('d'), { bytes: 10, data: {}, alias: id('b') }]]);
  const g = name => build({ ods2: [rec(name)], sets }).index[0].g;
  assert.deepEqual(g('a'), [9, 10, 11, 12]);
  assert.deepEqual(g('b'), [7]);
  assert.deepEqual(g('c'), []);                                       // the set states no grade: stays unknown
  assert.deepEqual(g('d'), [7]);                                      // an alias follows its primary
  assert.deepEqual(g('e'), []);                                       // no set
  assert.deepEqual(build({ ods2: [rec('a')] }).index[0].g, []);       // without --sets nothing changes
  assert.throws(() => build({ ods2: [rec('f')], sets: new Map([[id('f'), set({ grade: ['x'] })]]) }), /cannot read meta.grade/);
  // konu tables: the sheet names of the workbook
  const konu = sheets => ({ title: '1. Donem Konu Soru Dagilim Tablosu 2026-2027 - Biyoloji', pageTitle: '1. Dönem Konu Soru Dağılım Tabloları', examType: 'Ortak Yazili - Konu Soru Dagilim', fileUrl: 'https://cdn.eba.gov.tr/ankmeb11', schoolYear: '2026-2027',
    topicDistribution: sheets.map(sheet => ({ sheet, rows: [] })) });
  const kg = sheets => build({ ods2: [konu(sheets)] }).index[0].g;
  assert.deepEqual(kg(['9. SINIF', '10. SINIF', '11. SINIF', '12. SINIF T.C.INKILAP TARİHİ']), [9, 10, 11, 12]);
  assert.deepEqual(kg(['5. sınıf ', '6.sınıf']), [5, 6]);
  assert.deepEqual(kg(['Sayfa1']), []);
  assert.equal(build({ ods2: [konu(['9. SINIF', '10. SINIF'])] }).index[0].t.startsWith('9–10. sınıf'), true);
});
test('MEB library grade chip: single grade, contiguous range, list and unknown', () => {
  const words = { mebGradeN: 'Grade {n}', mebGradesN: 'Grades {n}', mebGradeNone: 'Grade not stated' };
  const { run } = modules({}, { i18n: { t: (k, p) => (words[k] || k).replace(/\{(\w+)\}/g, (_, a) => p[a]), getLang: () => 'en' } });
  const chip = g => run(`MebIndex.gradeLabel(${JSON.stringify(g)})`);
  assert.equal(chip([10]), 'Grade 10');
  assert.equal(chip([9, 10, 11, 12]), 'Grades 9–12');
  assert.equal(chip([11, 12]), 'Grades 11–12');
  assert.equal(chip([9, 11]), 'Grades 9, 11');
  assert.equal(chip([]), 'Grade not stated');
});
test('MEB library: a multi-grade entry is listed under every grade it covers', () => {
  const { ctx, run } = modules();
  ctx.items = [{ ...mebItems[0], id: 'm1', g: [9, 10, 11, 12], x: 'konu' }, { ...mebItems[1], id: 'm2', g: [] }];
  for (const grade of [9, 10, 11, 12]) assert.deepEqual(mebIds(run, { grade }), ['m1']);
  assert.deepEqual(mebIds(run, { grade: 8 }), []);
  assert.deepEqual(mebIds(run, {}), ['m1', 'm2']);                      // ungraded entries stay under "All grades"
});
test('MEB generator: subject, year, titles and grades from the sources that state them (set meta, URL folder, file names)', async () => {
  const { build } = await mebGen();
  const rec = (examType, file, extra) => ({ title: 'T', pageTitle: 'P', examType, fileUrl: 'https://cdn.eba.gov.tr/yardimcikaynaklar/' + file, schoolYear: '2025-2026', sourcePage: 'https://odsgm.meb.gov.tr/www/x/icerik/0', ...extra });
  const one = (r, sets) => build({ ods2: [r], sets }).index[0];
  // school year of a sinif file = its CDN folder, not the manifest's current year; no folder = not stated
  assert.equal(one(rec('Sinif Ici Olcme / Destek Materyal', '2022/01/11_sos_1.pdf')).y, '2021-2022');
  assert.equal(one(rec('Sinif Ici Olcme / Destek Materyal', '2024/11/x.pdf')).y, '2024-2025');
  assert.equal(one(rec('Sinif Ici Olcme / Destek Materyal', 'x.pdf')).y, '');
  const sos = one(rec('Sinif Ici Olcme / Destek Materyal', '2022/01/11_sos_1.pdf'));
  assert.deepEqual([sos.g, sos.s, sos.p], [[11], 'Sosyoloji', '']);                  // lise Tekrar Testi; /icerik/0 is a dead page
  // grade from the file name: publisher konu files, ita8; sinif booklets only when the title states none
  assert.deepEqual(one(rec('Ortak Yazili - Konu Soru Dagilim', 'cydem_ing5_2.pdf', { title: 'ÇYDEM-İngilizce' })).g, [5]);
  assert.deepEqual(one(rec('Ortak Yazili - Konu Soru Dagilim', 'turk7meb.pdf', { title: 'Türkçe MEB Yayınları' })).g, [7]);
  const ita = one(rec('Ortak Yazili - Konu Soru Dagilim', 'ita8.pdf', { title: 'T.C. İnkılap Tarihi ve Atatürkçülük' }));
  assert.deepEqual([ita.g, ita.s], [[8], 'İnkılap Tarihi']);
  assert.deepEqual(one(rec('Sinif Ici Olcme / Destek Materyal', 'matematik3.pdf', { title: 'Biçimlendirici Değerlendirme' })).g, [3]);
  assert.deepEqual(one(rec('Sinif Ici Olcme / Destek Materyal', 'turkce5.pdf', { title: '1.Sınıf Etkinlik Fasikülleri' })).g, [1]);
  // subject and title from the set; edition B swaps the booklet letter; LGS sections are 'LGS Sözel' / 'LGS Sayısal'
  const lgs = rec('LGS', '2026/05/b_2026_x.pdf');
  const id = one(lgs).id;
  const set = { bytes: 10, data: { title: 'LGS 2026 Sözel Bölüm - A Kitapçığı', meta: { subject: 'Sözel' } } };
  const e = one(lgs, new Map([[id, set]]));
  assert.deepEqual([e.s, e.t], ['LGS Sözel', 'LGS 2026 Sözel Bölüm - A Kitapçığı']);
  const two = build({ ods2: [lgs, rec('LGS', '2026/05/c_2026_x.pdf')], sets: new Map([[id, set], [one(rec('LGS', '2026/05/c_2026_x.pdf')).id, { bytes: 1, data: {}, alias: id, version: 'B' }]]) }).index;
  assert.ok(two.some(r => r.t === 'LGS 2026 Sözel Bölüm - B Kitapçığı'));
  assert.equal(one(rec('Ortak Yazili Sinav', 'x.pdf'), new Map([[one(rec('Ortak Yazili Sinav', 'x.pdf')).id, { bytes: 1, data: { meta: { subject: 'Çoklu ders (42 ders)' } } }]])).s, '');   // multi-subject stays blank
  const mat = one(rec('Ortak Yazili Sinav', 'y.pdf'), new Map([[one(rec('Ortak Yazili Sinav', 'y.pdf')).id, { bytes: 1, data: { meta: { subject: 'Türk Dili ve Edebiyatı' } } }]]));
  assert.equal(mat.s, 'Türkçe / Edebiyat');
  // Turkish letters come back in titles built from ASCII file names and headings; a cut heading is not a title
  const k = one(rec('Ortak Yazili - Kilavuz', 'Ulke_Geneli_Ortak_Yazili_Sinav_Takvimi.pdf', { title: 'MİLLÎ EĞİTİM BAKANLIĞI 2025-2026 1.…', pageTitle: 'MİLLÎ EĞİTİM BAKANLIĞI 2025-2026 1.…' }));
  assert.equal(k.t, 'Ülke Geneli Ortak Yazılı Sınav Takvimi');
  assert.match(one(rec('LGS', '2025/01/2025_YYlY_OrtaoYgYretime_GecYisY_Tercih_ve_YerlesYtirme_KYlavuzu.pdf')).t, /Ortaöğretime Geçiş Tercih ve Yerleştirme Kılavuzu$/);
});
test('committed MEB index: the library is usable out of the box (All years, every grade chip with files, no dead end)', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/meb/index.json'), 'utf8'));
  const { ctx, run } = modules();
  ctx.items = index;
  const n = f => JSON.parse(run(`JSON.stringify(MebIndex.filterItems(items, ${JSON.stringify(f)}).length)`));
  assert.equal(run('MebIndex.defaultYear(items)'), '');
  assert.equal(n({}), index.length);                                       // the default view lists everything
  for (const grade of [1, 5, 6, 7, 8, 9, 10, 11, 12]) assert.ok(n({ grade }) > 0, 'grade ' + grade);
  assert.ok(n({ q: 'edebiyat' }) > 90);                                    // was 2 while the 2026-2027 chip was the default
  assert.equal(n({ year: 'none' }), index.filter(r => !r.y).length);
  assert.ok(index.filter(r => !r.y).length > 300 && n({ year: 'none', type: 'ogm-yazili' }) === 74);
  assert.ok(index.every(r => r.x !== 'sinif' || r.y !== '2025-2026' || /\/2025\/|\/2026\//.test(r.u)));   // no old booklet labelled with the current year
  assert.equal(index.filter(r => r.set && /^(Sözel|Sayısal)$/.test(r.s)).length, 0);
});
test('MEB generator aggregates konu-soru tables and drops unusable rows', async () => {
  const { build } = await mebGen();
  const { topics } = build(mebFixture);
  assert.equal(topics.length, 1);
  assert.deepEqual(Object.keys(topics[0]), ['id', 'g', 's', 'term', 'n', 'rows']);
  assert.equal(topics[0].term, '1. Dönem');
  assert.equal(topics[0].n, 2);                 // the single "toplam" row table and the header fragment are dropped
  assert.deepEqual(topics[0].rows, [['COĞ.9.1.1. Doğa ve insan etkileşimini yorumlar', 3], ['COĞ.9.2.1. Harita bilgisini kullanır', 2], ['COĞ.9.3.1. İklim elemanlarını açıklar', 1]]);
});
test('MEB generator refuses non-MEB hosts and unknown exam types', async () => {
  const { build } = await mebGen();
  const rec = { title: 't', pageTitle: 't', examType: 'LGS', fileUrl: 'https://evil.example/a.pdf', sourcePage: 'https://odsgm.meb.gov.tr/x' };
  assert.throws(() => build({ ods2: [rec] }), /not an official MEB\/EBA/);
  assert.throws(() => build({ ods2: [{ ...rec, fileUrl: 'https://cdn.eba.gov.tr/a.pdf', examType: 'Mystery' }] }), /unknown examType/);
});
test('committed data/meb files match the generator contract and stay small', () => {
  const dir = path.join(__dirname, '../data/meb');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const topics = JSON.parse(fs.readFileSync(path.join(dir, 'topics.json'), 'utf8'));
  assert.ok(fs.statSync(path.join(dir, 'index.json')).size < 400 * 1024);
  assert.ok(fs.statSync(path.join(dir, 'topics.json')).size < 400 * 1024);
  assert.ok(index.length > 400 && topics.length > 100);
  const { ctx, run } = modules();
  ctx.d = { index, topics };
  assert.equal(run('MebIndex.validate(d.index, d.topics).items.length'), index.length);   // every link is an https MEB/EBA URL
  assert.ok(index.every(r => !/mebi\.eba\.gov\.tr/.test(r.u)));                        // MEBİ is only linked, never listed
  assert.ok(index.some(r => r.x === 'lgs' && r.g.includes(8)));
});

// ---------- MEB study sets ----------
const setIndex = [
  { ...mebItems[0], y: '2025-2026' },
  { ...mebItems[1], y: '2026-2027', set: 1, sz: 120, nc: 96, nq: 72, ns: 14 },
  { ...mebItems[2], y: '2024-2025', set: 1, sz: 40, nc: 1, nq: 0, ns: 1 },
  { ...mebItems[3], y: '' },
  { ...mebItems[4], y: '2026-2027' }
];
const fixtureSet = id => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/meb-set-' + id + '.json'), 'utf8'));

test('MEB library groups by school year: newest first, unstated last, opens on All years, "Year not stated" has its own chip', () => {
  const { ctx, run } = modules();
  ctx.items = setIndex;
  const ids = code => JSON.parse(run('JSON.stringify(' + code + '.map(i => i.id))'));
  assert.deepEqual(ids('MebIndex.sortByYear(items)'), ['a2', 'a5', 'a1', 'a3', 'a4']);   // stable inside a year, no year last
  assert.deepEqual(setIndex.map(i => i.id), ['a1', 'a2', 'a3', 'a4', 'a5']);               // input not mutated
  assert.equal(run('MebIndex.defaultYear(items)'), '');                                    // never a year chip that would hide year-less files
  assert.deepEqual(mebIds(run, { year: 'none' }), ['a4']);
  assert.deepEqual(mebIds(run, { year: '2026-2027' }), ['a2', 'a5']);
  assert.deepEqual(mebIds(run, { year: '2025-2026' }), ['a1']);
  assert.deepEqual(mebIds(run, { year: 'earlier' }), ['a3']);                             // a stated year before 2025-2026; unstated is not "earlier"
  assert.deepEqual(mebIds(run, {}), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(mebIds(run, { sets: true }), ['a2', 'a3']);
  assert.deepEqual(mebIds(run, { sets: true, year: 'earlier' }), ['a3']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebIndex.typeCounts(items, { year: "2026-2027" }))')), { lgs: 1, acik: 1 });
});
test('MEB library stats line: counts, singular forms, nothing for zero', () => {
  const { ctx, run } = modules({}, { i18n: { t: (k, p) => (p ? k + ':' + p.n : k), getLang: () => 'en' } });
  ctx.items = setIndex;
  assert.equal(run('MebIndex.statsLine(items[1])'), 'mebStatCards:96 · mebStatQuestions:72 · mebStatSections:14');
  assert.equal(run('MebIndex.statsLine(items[2])'), 'mebStatCardsOne:1 · mebStatSectionsOne:1');
  assert.equal(run('MebIndex.statsLine(items[0])'), '');
});
test('MEB library data validation covers the study set fields', () => {
  const { ctx, run } = modules();
  const bad = (items, re) => { ctx.bad = { items }; assert.throws(() => run('MebIndex.validate(bad.items, [])'), re); };
  ctx.good = { items: setIndex };
  assert.equal(run('MebIndex.validate(good.items, []).items.length'), 5);
  bad([{ ...setIndex[1], set: 2 }], /study set flag/);
  bad([{ ...setIndex[1], nc: -1 }], /bad nc/);
  bad([{ ...setIndex[1], sz: 1.5 }], /bad sz/);
  bad([{ ...setIndex[1], nc: 0, nq: 0 }], /without cards or questions/);
});

test('MebSets.prepare keeps provenance, trusts the index for id and link, and rejects unusable files', () => {
  const { ctx, run } = modules();
  ctx.entry = setIndex[0]; ctx.raw = fixtureSet('a1');
  const d = JSON.parse(run('JSON.stringify(MebSets.prepare(raw, entry))'));
  assert.equal(d.meta.fileId, 'a1');
  assert.equal(d.meta.sourceUrl, 'https://cdn.eba.gov.tr/a.pdf');                          // the index link, not the file's
  assert.equal(d.meta.schoolYear, '2026-2027');
  assert.deepEqual(d.meta.grade, [8]);
  assert.deepEqual([d.notes.sections.length, d.flashcards.length, d.quiz.length, d.sources.length], [2, 3, 2, 1]);
  assert.match(d.sources[0].text, /SENTINEL-OXYGEN-7421/);
  const bad = (mut, re) => { ctx.raw = mut(fixtureSet('a1')); assert.throws(() => run('MebSets.prepare(raw, entry)'), re); };
  bad(r => { r.meta.fileId = 'zzz'; return r; }, /another file/);
  bad(r => { r.sources = []; return r; }, /no source text/);
  bad(r => ({ title: 't', meta: r.meta, sources: r.sources }), /no notes, cards or questions/);
  bad(() => [], /not an object/);
  // A hostile link in the file never survives: Parser only keeps official https hosts.
  ctx.raw = fixtureSet('a1');
  assert.equal(run('Parser.normalizeStudyData(Object.assign({}, raw, { meta: { fileId: "a1", sourceUrl: "https://evil.example/x" } })).meta.sourceUrl'), undefined);
});
test('deck meta survives save and lookup; the source text lives in data.sources', () => {
  const { ctx, run } = modules();
  ctx.entry = setIndex[0]; ctx.raw = fixtureSet('a1');
  run('Decks.save(MebSets.prepare(raw, entry), "")');
  assert.equal(run('Decks.getActive().data.meta.fileId'), 'a1');
  assert.equal(run('MebSets.findDeck("a1").data.meta.sourceUrl'), 'https://cdn.eba.gov.tr/a.pdf');
  assert.equal(run('MebSets.findDeck("nope")'), null);
  assert.equal(run('Decks.getActive().originalText'), '');
  assert.match(run('Sources.contextText(Decks.getActive().data)'), /SENTINEL-OXYGEN-7421/);   // what App.getOriginalText hands to Ask AI
});

function openHarness(over = {}) {
  const log = { fetched: [], opened: [], closed: 0, asked: [] };
  const sets = { a1: fixtureSet('a1'), a2: fixtureSet('a2') };
  const { ctx, run } = modules({}, {
    fetch: async url => {
      log.fetched.push(url);
      if (over.status) return { ok: false, status: over.status };
      return { ok: true, json: async () => { if (over.gate) await over.gate; return sets[url.split('/').pop().replace('.json', '')]; } };
    },
    confirm: m => { log.asked.push(m); return over.answer !== false; },
    App: {
      showToast() {},
      mergeIntoDeck: (id, data) => vm.runInContext('Decks', ctx).save(data, '', null).id,
      openDeck: id => log.opened.push(id)
    }
  });
  run('PastPaper.close = () => {}');                      // no DOM here: the modal shells are null
  ctx.__closed = () => { log.closed++; };
  run('MebIndex.close = __closed');
  return { ctx, run, log };
}
test('MebSets.open fetches only that set, saves it as a new deck and opens it', async () => {
  const { ctx, run, log } = openHarness();
  ctx.e1 = setIndex[0];
  const id = await run('MebSets.open(e1)');
  assert.deepEqual(log.fetched, ['data/meb/sets/a1.json']);
  assert.deepEqual(log.opened, [id]);
  assert.equal(log.closed, 1);
  assert.equal(run('Decks.list().length'), 1);
  assert.equal(run('Decks.get("' + id + '").data.meta.fileId'), 'a1');
});
test('MebSets.open asks before duplicating: OK reopens the existing deck without a download, Cancel makes a fresh copy', async () => {
  const h = openHarness();
  h.ctx.e1 = setIndex[0];
  const first = await h.run('MebSets.open(e1)');
  h.log.fetched.length = 0;
  assert.equal(await h.run('MebSets.open(e1)'), first);                                     // OK -> the existing deck
  assert.equal(h.log.asked.length, 1);
  assert.equal(h.log.fetched.length, 0);
  assert.equal(h.run('Decks.list().length'), 1);
  const h2 = openHarness({ answer: false });
  h2.ctx.e1 = setIndex[0];
  const a = await h2.run('MebSets.open(e1)');
  const b = await h2.run('MebSets.open(e1)');                                                // Cancel -> a fresh copy
  assert.notEqual(a, b);
  assert.equal(h2.run('Decks.list().length'), 2);
  assert.equal(h2.log.fetched.length, 2);
});
test('MebSets.open fails loudly on HTTP errors and bad input, saves nothing, and can be retried', async () => {
  const bad = openHarness({ status: 404 });
  bad.ctx.e1 = setIndex[0];
  await assert.rejects(bad.run('MebSets.open(e1)'), /HTTP 404/);
  assert.equal(bad.run('Decks.list().length'), 0);
  assert.equal(bad.log.opened.length, 0);
  await assert.rejects(bad.run('MebSets.open(e1)'), /HTTP 404/);                             // a failed attempt does not wedge the loader
  await assert.rejects(bad.run('MebSets.open(null)'), /No library entry/);
  const mismatch = openHarness();
  mismatch.ctx.e2 = { ...setIndex[0], id: 'a2' };                                           // a2.json is a valid file for a2...
  assert.ok(await mismatch.run('MebSets.open(e2)'));
  mismatch.ctx.e3 = { ...setIndex[0], id: 'a3', u: 'https://cdn.eba.gov.tr/c.pdf' };         // ...but a3.json does not exist in the harness
  await assert.rejects(mismatch.run('MebSets.open(e3)'), /./);
  assert.equal(mismatch.run('Decks.list().length'), 1);
});
test('MebSets.open loads one set at a time', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { ctx, run, log } = openHarness({ gate });
  ctx.e1 = setIndex[0]; ctx.e2 = { ...setIndex[1] };
  const first = run('MebSets.open(e1)');
  await assert.rejects(run('MebSets.open(e2)'), /mebSetBusy/);
  const same = run('MebSets.open(e1)');                                                      // the same file joins the running load
  release();
  const [x, y] = await Promise.all([first, same]);
  assert.equal(x, y);
  assert.equal(log.fetched.length, 1);
});

// ---------- generator --sets ----------
test('MEB generator attachSets adds set/sz/nc/nq/ns only where a set exists', async () => {
  const { build, attachSets } = await mebGen();
  const { index } = build(mebFixture);
  const plain = JSON.stringify(index);
  const id = index[0].id;
  const set = { ...fixtureSet('a1'), meta: { ...fixtureSet('a1').meta, fileId: id } };
  attachSets(index, new Map([[id, { bytes: 2200, data: set }]]));
  assert.deepEqual(Object.keys(index[0]), ['id', 't', 'g', 's', 'x', 'y', 'u', 'p', 'mb', 'src', 'set', 'sz', 'nc', 'nq', 'ns']);
  assert.deepEqual([index[0].set, index[0].sz, index[0].nc, index[0].nq, index[0].ns], [1, 3, 3, 2, 2]);   // 2200 bytes -> 3 KB
  assert.equal(index.filter(r => r.set).length, 1);
  assert.equal(JSON.stringify(index.slice(1)), JSON.stringify(JSON.parse(plain).slice(1)));
  assert.throws(() => attachSets(index, new Map([['ffffffff', { bytes: 1, data: set }]])), /no entry in the index/);
  assert.throws(() => attachSets(index, new Map([[id, { bytes: 1, data: { ...set, meta: { fileId: 'other' } } }]])), /meta\.fileId/);
  assert.throws(() => attachSets(index, new Map([[id, { bytes: 1, data: { title: 'x' } }]])), /missing notes, flashcards or quiz/);
});
test('MEB generator attachSets attaches set info to an OGM yazılı entry', async () => {
  const { build, attachSets } = await mebGen();
  const { index } = build(mebFixture);
  const e = index.find(r => r.x === 'ogm-yazili');
  attachSets(index, new Map([[e.id, { bytes: 2200, data: { ...fixtureSet('a1'), meta: { fileId: e.id } } }]]));
  assert.deepEqual([e.set, e.sz, e.nc, e.nq, e.ns], [1, 3, 3, 2, 2]);
});
test('MEB generator CLI: --sets <dir> writes the study set fields into index.json', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const { build } = await mebGen();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meb-gen-'));
  try {
    for (const [f, v] of [['ods/manifest.json', mebFixture.ods1 || []], ['ods/manifest2.json', mebFixture.ods2 || []], ['ogm/manifest.json', mebFixture.ogm || []],
      ['ogm/yazili/manifest.json', mebFixture.ogmYazili || []], ['ogm/kazanim/manifest.json', mebFixture.ogmKazanim || []],
      ['ogm/kazanim-bazli/manifest.json', mebFixture.ogmKazanimBazli || []]]) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.writeFileSync(path.join(tmp, f), JSON.stringify(v));
    }
    const id = build(mebFixture).index[0].id;
    fs.mkdirSync(path.join(tmp, 'sets'));
    fs.writeFileSync(path.join(tmp, 'sets', id + '.json'), JSON.stringify({ ...fixtureSet('a1'), meta: { fileId: id } }));
    const script = path.join(__dirname, '../scripts/build-meb-index.mjs');
    const sh = (...args) => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
    sh(tmp, path.join(tmp, 'out'), '--sets', path.join(tmp, 'sets'));
    const withSets = JSON.parse(fs.readFileSync(path.join(tmp, 'out/index.json'), 'utf8'));
    assert.equal(withSets.filter(r => r.set).length, 1);
    assert.deepEqual([withSets[0].nc, withSets[0].nq, withSets[0].ns], [3, 2, 2]);
    sh(tmp, path.join(tmp, 'out2'));                                                         // default: no sets, no new fields
    assert.ok(JSON.parse(fs.readFileSync(path.join(tmp, 'out2/index.json'), 'utf8')).every(r => !('set' in r)));
    fs.writeFileSync(path.join(tmp, 'sets', 'deadbeef.json'), '{}');
    assert.throws(() => sh(tmp, path.join(tmp, 'out3'), '--sets', path.join(tmp, 'sets')), /no entry in the index/);
    assert.throws(() => sh(tmp, '--sets'), /--sets needs a directory/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---------- service worker ----------
test('sw.js precaches the new scripts but never a study set, and keeps only the last 12 cached sets', async () => {
  const swSource = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const ctx = vm.createContext({ self: { addEventListener() {}, location: { origin: 'https://x.test' } }, URL, console });
  vm.runInContext(swSource, ctx);
  const shell = vm.runInContext('SHELL', ctx);
  assert.ok(shell.includes('./js/mebsets.js') && shell.includes('./js/mebindex.js') && shell.includes('./css/meb.css'));
  assert.ok(!shell.some(u => /data\/meb\/sets/.test(u)));
  for (const u of shell.filter(u => u.startsWith('./js/') || u.startsWith('./css/'))) assert.ok(fs.existsSync(path.join(__dirname, '..', u)), u + ' is in SHELL but missing');
  assert.ok(/^flashmind-v(\d+)$/.test(vm.runInContext('CACHE', ctx)));
  const deleted = [];
  const keys = [{ url: 'https://x.test/index.html' }, { url: 'https://x.test/data/meb/index.json' }];
  for (let i = 0; i < 15; i++) keys.push({ url: `https://x.test/data/meb/sets/s${i}.json` });
  ctx.cache = { keys: async () => keys, delete: async r => { deleted.push(r.url); } };
  await vm.runInContext('trimSets(cache)', ctx);
  assert.deepEqual(deleted, [0, 1, 2].map(i => `https://x.test/data/meb/sets/s${i}.json`));   // the three oldest of fifteen; shell and index untouched
});

// ---------- alias set files ----------
test('MebSets.open follows one alias level, keeps the entry as the deck owner and shows the version letter', async () => {
  const sets = { a2: { alias: 'a1', version: 'B' }, a1: fixtureSet('a1'), a3: { alias: 'a2' }, a4: { alias: 'a4' } };
  const fetched = [];
  const { ctx, run } = modules({}, {
    fetch: async url => { fetched.push(url); const id = url.split('/').pop().replace('.json', ''); return sets[id] ? { ok: true, json: async () => sets[id] } : { ok: false, status: 404 }; },
    confirm: () => true,
    App: { showToast() {}, mergeIntoDeck: (id, data) => vm.runInContext('Decks', ctx).save(data, '', null).id, openDeck() {} }
  });
  run('PastPaper.close = () => {}; MebIndex.close = () => {}');
  ctx.e2 = { ...setIndex[0], id: 'a2', u: 'https://cdn.eba.gov.tr/b.pdf' };
  const id = await run('MebSets.open(e2)');
  assert.deepEqual(fetched, ['data/meb/sets/a2.json', 'data/meb/sets/a1.json']);
  const deck = JSON.parse(run('JSON.stringify(Decks.get("' + id + '").data)'));
  assert.equal(deck.meta.fileId, 'a2');                                                     // tied to the opened entry
  assert.equal(deck.meta.sourceUrl, 'https://cdn.eba.gov.tr/b.pdf');
  assert.match(deck.title, /\(B\)$/);
  assert.match(deck.sources[0].text, /SENTINEL-OXYGEN-7421/);
  ctx.e3 = { ...setIndex[0], id: 'a3' };                                                    // alias -> alias is refused
  await assert.rejects(run('MebSets.open(e3)'), /points to another alias/);
  ctx.e4 = { ...setIndex[0], id: 'a4' };
  await assert.rejects(run('MebSets.open(e4)'), /bad alias target/);
});
test('MEB generator marks alias entries with the primary id, version and its counts', async () => {
  const { build, attachSets } = await mebGen();
  const { index } = build(mebFixture);
  const [p, q] = [index[0].id, index[1].id];
  const set = { ...fixtureSet('a1'), meta: { fileId: p } };
  attachSets(index, new Map([[p, { bytes: 2200, data: set }], [q, { bytes: 40, data: { alias: p, version: 'B' }, alias: p, version: 'B' }]]));
  assert.deepEqual([index[1].set, index[1].alias, index[1].ver, index[1].nc, index[1].nq, index[1].ns, index[1].sz], [1, p, 'B', 3, 2, 2, 3]);
  assert.throws(() => attachSets(build(mebFixture).index, new Map([[q, { bytes: 40, data: {}, alias: p, version: 'B' }]])), /not a full set/);
  const ctxm = modules();
  ctxm.ctx.items = index;
  assert.equal(ctxm.run('MebIndex.validate(items, []).items.length'), index.length);
});

// ---------- MEB scenario notebooks ----------
const scenFx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scen-fixture.json'), 'utf8'));
const scenRun = (opts, mutate, ei = 0, si = 0) => {
  const { ctx, run } = modules();
  const bank = JSON.parse(JSON.stringify(scenFx.bank));
  if (mutate) mutate(bank);
  ctx.bank = bank; ctx.spec = scenFx.spec; ctx.opts = opts;
  return () => run(`JSON.stringify(ScenarioSet.compose(bank, ScenarioSet.withFile(spec, 0), ${ei}, ${si}, opts))`);
};
const scenCompose = (opts, mutate, ei, si) => JSON.parse(scenRun(opts, mutate, ei, si)());

test('scenario compose: exactly the table count per kazanım in the exam block, the rest of each pool as extras', () => {
  const set = scenCompose();                                              // Senaryo 1: FX.1 x1, FX.2 x3
  const exam = set.quiz.filter(q => q.scenarioExam), extra = set.quiz.filter(q => !q.scenarioExam);
  assert.equal(exam.length, 4);
  assert.deepEqual(exam.map(q => q.category), ['Senaryo sınavı: Hücre Yapısı', 'Senaryo sınavı: Doku Çeşitleri', 'Senaryo sınavı: Doku Çeşitleri', 'Senaryo sınavı: Doku Çeşitleri']);
  assert.equal(extra.filter(q => q.category === 'Ek alıştırma: Hücre Yapısı').length, 8 - 1);
  assert.equal(extra.filter(q => q.category === 'Ek alıştırma: Doku Çeşitleri').length, 6 - 3);
  assert.equal(extra.length, 10);                                         // FX.3 / FX.4 are not asked in this scenario: no extras for them
  assert.ok(set.quiz.slice(0, 4).every(q => q.scenarioExam) && set.quiz.slice(4).every(q => !q.scenarioExam));   // exam block first
  const texts = set.quiz.map(q => q.question);
  assert.equal(new Set(texts).size, texts.length);                        // no question twice
  assert.deepEqual(set.meta.counts, { exam: 4, extra: 10, trimmed: 0, kazanim: 2 });
});
test('scenario compose: the pick is deterministic and mixes difficulties', () => {
  const a = scenCompose(), b = scenCompose();
  assert.deepEqual(a, b);
  const s2 = scenCompose(undefined, null, 0, 1);                          // Senaryo 2: FX.1 x3
  const fx1 = s2.quiz.filter(q => q.scenarioExam && /Hücre/.test(q.category)).map(q => q.difficulty).sort();
  assert.deepEqual(fx1, ['easy', 'hard', 'medium']);                      // 3 asked out of a pool of easy/medium/hard: one of each
  assert.notDeepEqual(s2.quiz.filter(q => q.scenarioExam).map(q => q.question), a.quiz.filter(q => q.scenarioExam).map(q => q.question));
});
test('scenario compose: a pool smaller than the count, an unknown item and a bad total throw clear errors', () => {
  const err = (mutate, ei, si, opts) => scenRun(opts, mutate, ei, si);
  assert.throws(err(b => { b.kazanimlar[0].questions = b.kazanimlar[0].questions.slice(0, 2); }, 0, 1), /FX\.1: Senaryo 2 bu kazanımdan 3 soru istiyor, bankada 2 soru var/);
  assert.throws(err(b => { b.kazanimlar.splice(1, 1); }, 0, 0), /has no kazanım FX\.2/);
  assert.throws(err(b => { b.kazanimlar[1].note.content = ' '; }, 0, 0), /FX\.2 has no note/);
  assert.throws(err(b => { b.kazanimlar[1].questions[0].correct = 9; }, 0, 0), /not a valid question/);
  assert.throws(err(b => { b.meta.sheet = '10. SINIF'; }, 0, 0), /is for sheet "10\. SINIF"/);
  assert.throws(err(null, 1, 0), /ülke geneli ortak yazılı, senaryo yok/);
  assert.throws(err(null, 0, 7), /no scenario 7/);
  assert.throws(err(null, 5, 0), /no exam 5/);
  // A kazanım this scenario does not ask may be missing from the bank without blocking it.
  assert.equal(JSON.parse(err(b => { b.kazanimlar.splice(2, 2); }, 0, 0)()).meta.counts.exam, 4);
  const { ctx, run } = modules();
  ctx.spec = JSON.parse(JSON.stringify(scenFx.spec)); ctx.spec.sheets[0].exams[0].scenarios[0].total = 9;
  assert.throws(() => run('ScenarioSet.validateSpec(spec)'), /add up to 4, the table says 9/);
  ctx.spec = JSON.parse(JSON.stringify(scenFx.spec)); ctx.spec.sheets[0].exams[0].scenarios[0].items[0].id = 'NOPE';
  assert.throws(() => run('ScenarioSet.validateSpec(spec)'), /kazanım NOPE is not in the sheet/);
  ctx.bank = scenFx.bank; ctx.sheet = { ...scenFx.spec.sheets[0], fileId: 'fx000001' };
  assert.equal(run('ScenarioSet.validateBank(bank, sheet) === bank'), true);   // whole-sheet check: every pool covers its biggest count
  ctx.bank = JSON.parse(JSON.stringify(scenFx.bank)); ctx.bank.kazanimlar[3].questions.length = 1;
  assert.throws(() => run('ScenarioSet.validateBank(bank, sheet)'), /kazanım FX\.4 has 1 questions, a scenario asks 2/);
});
test('scenario compose: kazanım with count 0 are left out of notes and cards and listed in the last section', () => {
  const set = scenCompose();
  assert.equal(set.notes.sections.filter(s => /^FX\.[34] ·/.test(s.title)).length, 0);
  const skipped = set.notes.sections.find(s => s.title === 'Bu senaryoda sorulmayan konular');
  assert.deepEqual(skipped.bulletPoints, ['FX.3 · Organ Sistemleri', 'FX.4 · Enerji dönüşümünü yorumlayabilme']);   // a missing topic falls back to the outcome text
  assert.deepEqual([...new Set(set.flashcards.map(c => c.category))], ['Doku Çeşitleri', 'Hücre Yapısı']);
  assert.equal(set.flashcards.length, 8);
});
test('scenario compose: sections and cards are ordered by question count, the exam keeps table order', () => {
  const set = scenCompose(undefined, null, 0, 1);                         // FX.1 x3, FX.2 x1, FX.4 x2
  assert.deepEqual(set.notes.sections.slice(0, 3).map(s => s.title.split(' · ')[0]), ['FX.1', 'FX.4', 'FX.2']);
  assert.match(set.notes.sections[0].content, /^Bu senaryoda 3 soru\./);
  assert.match(set.notes.sections[0].content, /Örnek: FX\.1 örneği/);
  assert.match(set.notes.sections[0].content, /Sınavda nasıl sorulur: FX\.1 sınav ipucu/);
  assert.deepEqual([...new Set(set.flashcards.map(c => c.category))], ['Hücre Yapısı', 'Enerji dönüşümünü yorumlayabilme', 'Doku Çeşitleri']);
  const order = [];
  set.quiz.filter(q => q.scenarioExam).forEach(q => { if (order[order.length - 1] !== q.category) order.push(q.category); });
  assert.deepEqual(order, ['Senaryo sınavı: Hücre Yapısı', 'Senaryo sınavı: Doku Çeşitleri', 'Senaryo sınavı: Enerji dönüşümünü yorumlayabilme']);
  assert.equal(set.quiz.filter(q => q.scenarioExam).length, 6);
});
test('scenario compose: the summary carries the computed numbers, the table source and the metadata', () => {
  const set = scenCompose(undefined, null, 0, 1);                         // total 6: FX.1 3 (50 %), FX.4 2 (33,3 %), FX.2 1 (16,7 %)
  const s = set.notes.summary;
  assert.match(s, /Biyoloji 9\. sınıf · 1\. Dönem 1\. Ortak Yazılı Sınav · Senaryo 2/);
  assert.match(s, /toplam 6 soru ve 3 kazanım var; diğer 1 kazanım bu senaryoda sorulmuyor/);
  assert.match(s, /- ÜNİTE 1: 4 soru \(%66,7\)\n- ÜNİTE 2: 2 soru \(%33,3\)/);
  assert.match(s, /1\. FX\.1 · Hücre Yapısı: 3 soru \(%50\)\n2\. FX\.4 · .*: 2 soru \(%33,3\)\n3\. FX\.2 · Doku Çeşitleri: 1 soru \(%16,7\)/);
  const mins = [...s.matchAll(/^- FX\.\d: (\d+) dk$/gm)].map(m => +m[1]);
  assert.deepEqual(mins, [60, 40, 20]);
  assert.equal(mins.reduce((a, b) => a + b, 0), 120);
  assert.match(s, /tam 6 soru içerir/);
  assert.match(s, /Ders özeti:\nBiyoloji 9 banka özeti\./);
  assert.equal(set.title, 'Biyoloji 9 · 1. Dönem 1. Ortak Yazılı · Senaryo 2');
  assert.deepEqual(set.meta, { kind: 'scenario', fileId: 'fx000001', bank: 'b-fx000001-9', sheet: '9. SINIF', subject: 'Biyoloji', grade: 9, exam: '1. Dönem 1. Ortak Yazılı Sınav', scenario: 2, schoolYear: '2026-2027', sourceUrl: scenFx.spec.sourceUrl, counts: set.meta.counts });
  const src = set.sources[0].text;
  assert.match(src, /ÜNİTE 1 \| FX\.1 \| Hücre Yapısı \| FX\.1\. Hücrenin yapısını açıklayabilme \| 3/);
  assert.match(src, /ÜNİTE 2 \| FX\.4 \| - \| FX\.4\. Enerji dönüşümünü yorumlayabilme \| 2/);
  assert.match(src, /toplam 6 soru, 3 kazanım/);
  assert.match(src, /sorulmayan kazanımlar: FX\.3/);
  assert.deepEqual(set.notes.commonMistakes, ['Hata 1', 'Hata 2']);
  assert.ok(set.notes.sections.some(x => x.title === 'Çalışma ipuçları'));
  assert.equal(set.notes.mindmap.label, 'Biyoloji 9');
});
test('scenario compose: a notebook over the size limit loses extras only, spread over every kazanım', () => {
  const full = scenCompose({ maxBytes: Infinity }, null, 0, 1);
  const size = o => Buffer.byteLength(JSON.stringify(o));
  const small = scenCompose({ maxBytes: size(full) - 1500 }, null, 0, 1);
  assert.ok(size(small) <= size(full) - 1500);
  assert.equal(small.quiz.filter(q => q.scenarioExam).length, 6);          // the exam is never trimmed
  assert.ok(small.meta.counts.trimmed > 0 && small.meta.counts.extra + small.meta.counts.trimmed === full.meta.counts.extra);
  assert.equal(small.meta.counts.extra, small.quiz.length - 6);
  assert.equal(new Set(small.quiz.filter(q => !q.scenarioExam).map(q => q.category)).size, 3);   // every asked kazanım still has extras
  assert.equal(full.meta.counts.trimmed, 0);
  assert.throws(scenRun({ maxBytes: 500 }, null, 0, 1), /the exam block alone is .* KB over the 0 KB limit/);
});
test('scenario compose output passes Parser.normalizeStudyData with its meta, exam flag and table source', () => {
  const { ctx, run } = modules();
  ctx.bank = scenFx.bank; ctx.spec = scenFx.spec;
  const d = JSON.parse(run('JSON.stringify(Parser.normalizeStudyData(ScenarioSet.compose(bank, ScenarioSet.withFile(spec, 0), 0, 0)))'));
  assert.equal(d.meta.kind, 'scenario'); assert.equal(d.meta.scenario, 1); assert.equal(d.meta.exam, '1. Dönem 1. Ortak Yazılı Sınav'); assert.equal(d.meta.sheet, '9. SINIF');
  assert.deepEqual(d.meta.grade, [9]);
  assert.equal(d.quiz.filter(q => q.scenarioExam).length, 4);
  assert.equal(d.sources.length, 1);
  assert.equal(d.notes.sections.length, 2 + 2);                           // FX.2, FX.1, the unasked topics, the study tips
});

// ---------- scenario library (index, loader, profile) ----------
const scenEntries = (() => {
  const base = { fileId: 'fx000001', si: 0, sheet: '9. SINIF', subject: 'Biyoloji', grade: 9, variant: '', bank: 'b-fx000001-9', hasBank: true };
  return [
    { ...base, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 1, total: 4, kazanimCount: 2, d: [1, 3], national: 0 },
    { ...base, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 2, total: 6, kazanimCount: 3, d: [3, 1, 2], national: 0 },
    { ...base, ei: 1, exam: '1. Dönem 2. Ortak Yazılı Sınav', n: 0, total: 0, kazanimCount: 0, d: [], national: 1 },
    { fileId: 'fx000002', si: 1, sheet: '10. SINIF', subject: 'Fizik', grade: 10, variant: '4 saat', bank: null, hasBank: false, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 1, total: 2, kazanimCount: 1, d: [2], national: 0 }
  ];
})();
test('MebScen.validateIndex rejects entries the UI could not open safely', () => {
  const { ctx, run } = modules();
  ctx.good = scenEntries;
  assert.equal(run('MebScen.validateIndex(good).length'), 4);
  const bad = (mut, re) => { ctx.bad = scenEntries.map(e => ({ ...e })); mut(ctx.bad); assert.throws(() => run('MebScen.validateIndex(bad)'), re); };
  bad(l => { l[0].fileId = '../x'; }, /bad fileId/);
  bad(l => { l[0].d = [1, 2]; }, /does not add up/);
  bad(l => { l[0].hasBank = false; }, /hasBank/);
  bad(l => { l[3].bank = '../b'; l[3].hasBank = true; }, /bad bank id/);
  bad(l => { l[2].total = 3; }, /national exam has no scenario/);
  bad(l => { l[1].n = l[0].n; }, /duplicate/);
  bad(l => { l[0].grade = '9'; }, /bad numbers/);
  assert.throws(() => run('MebScen.validateIndex({})'), /not a list/);
});
test('MebScen groups the index into courses and filters by grade and subject', () => {
  const { ctx, run } = modules();
  ctx.items = scenEntries;
  run('var sheets = MebScen.sheetsOf(items)');
  assert.deepEqual(JSON.parse(run('JSON.stringify(sheets.map(s => [s.key, s.subject, s.grade, s.exams.map(x => [x.ei, x.national, x.scenarios.length])]))')),
    [['fx000001.0', 'Biyoloji', 9, [[0, false, 2], [1, true, 0]]], ['fx000002.1', 'Fizik', 10, [[0, false, 1]]]]);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebScen.filterSheets(sheets, { grade: 10, subject: "" }).map(s => s.key))')), ['fx000002.1']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebScen.filterSheets(sheets, { grade: 0, subject: "Biyoloji" }).map(s => s.key))')), ['fx000001.0']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebScen.subjectsOf(sheets, 9))')), ['Biyoloji']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(MebScen.gradesOf(sheets))')), [9, 10]);
  // The default grade is the open deck's, when it states one.
  assert.equal(run('MebScen.activeGrade()'), 0);
  run(`Decks.save({ title: 'x', meta: { fileId: 'f', grade: [10] } }, '')`);
  assert.equal(run('MebScen.activeGrade()'), 10);
  run(`Decks.save({ title: 'y', meta: { fileId: 'f', grade: [3] } }, '')`);
  assert.equal(run('MebScen.activeGrade()'), 0);                           // a grade MEB has no ortak yazılı for is ignored
});
const scenLoader = (extra = {}) => {
  const fetched = [];
  let fail = false, answer = true, asked = 0;
  const toasts = [];
  const files = { 'data/meb/scen/spec/fx000001.json': scenFx.spec, 'data/meb/scen/bank/b-fx000001-9.json': scenFx.bank };
  const env = modules({}, {
    fetch: async url => { fetched.push(url); return fail || !files[url] ? { ok: false, status: 503 } : { ok: true, json: async () => JSON.parse(JSON.stringify(files[url])) }; },
    confirm: () => { asked++; return answer; },
    App: { showToast: (m, k) => toasts.push(k + ':' + m), mergeIntoDeck: (id, data) => vm.runInContext('Decks', env.ctx).save(data, '', null).id, openDeck() {} },
    ...extra
  });
  env.run('PastPaper.close = () => {}; MebIndex.close = () => {}');
  return { ...env, fetched, toasts, setFail: v => { fail = v; }, setAnswer: v => { answer = v; }, asked: () => asked };
};
test('MebScen.open composes the scenario into a new deck, fetching spec and bank once', async () => {
  const L = scenLoader();
  L.ctx.e = scenEntries[1];
  const id = await L.run('MebScen.open(e)');
  assert.deepEqual(L.fetched, ['data/meb/scen/spec/fx000001.json', 'data/meb/scen/bank/b-fx000001-9.json']);
  const deck = JSON.parse(L.run(`JSON.stringify(Decks.get("${id}").data)`));
  assert.equal(deck.title, 'Biyoloji 9 · 1. Dönem 1. Ortak Yazılı · Senaryo 2');
  assert.equal(deck.quiz.filter(q => q.scenarioExam).length, 6);
  assert.equal(deck.meta.scenario, 2);
  // The same scenario again: the confirm opens the existing deck, nothing is fetched or created.
  const again = await L.run('MebScen.open(e)');
  assert.equal(again, id); assert.equal(L.run('Decks.list().length'), 1); assert.equal(L.fetched.length, 2); assert.equal(L.asked(), 1);
  // Declined: a second copy, from the cached spec and bank. Another scenario is its own deck without asking.
  L.setAnswer(false);
  const copy = await L.run('MebScen.open(e)');
  assert.notEqual(copy, id); assert.equal(L.run('Decks.list().length'), 2); assert.equal(L.fetched.length, 2);
  L.ctx.e1 = scenEntries[0];
  await L.run('MebScen.open(e1)');
  assert.equal(L.run('Decks.list().length'), 3); assert.equal(L.asked(), 2);
  // The library's own findDeck for the same file id ignores scenario notebooks.
  assert.equal(L.run('MebSets.findDeck("fx000001")'), null);
});
test('MebScen.open fails loudly: no bank, a national exam, a failed download (retry works), a busy loader', async () => {
  const L = scenLoader();
  L.ctx.nobank = scenEntries[3]; L.ctx.nat = scenEntries[2]; L.ctx.e = scenEntries[0]; L.ctx.e2 = scenEntries[1];
  await assert.rejects(L.run('MebScen.open(nobank)'), /scenSoon/);
  await assert.rejects(L.run('MebScen.open(nat)'), /No scenario given/);
  L.setFail(true);
  await assert.rejects(L.run('MebScen.open(e)'), /HTTP 503/);
  assert.equal(L.run('Decks.list().length'), 0);
  L.setFail(false);
  await L.run('MebScen.open(e)');
  assert.equal(L.run('Decks.list().length'), 1);
  const first = L.run('MebScen.open(e2)');
  await assert.rejects(L.run('MebScen.open(e)'), /scenBusy/);
  L.setAnswer(false);
  await first;
});
const courseCompose = (opts, mutate) => {
  const { ctx, run } = modules();
  const bank = JSON.parse(JSON.stringify(scenFx.bank));
  if (mutate) mutate(bank);
  ctx.bank = bank; ctx.spec = scenFx.spec; ctx.opts = opts;
  return JSON.parse(run('JSON.stringify(ScenarioSet.composeCourse(bank, ScenarioSet.withFile(spec, 0), opts))'));
};
test('course compose: every kazanım with its note and examTip, all cards, ALL bank questions grouped by kazanım', () => {
  const set = courseCompose();
  assert.equal(set.title, 'Biyoloji 9 · Tüm konular · Bütün ders');
  assert.equal(set.notes.sections.length, 4 + 1);                         // 4 kazanım in table order + the study tips
  assert.deepEqual(set.notes.sections.slice(0, 4).map(s => s.title.split(' · ')[0]), ['FX.1', 'FX.2', 'FX.3', 'FX.4']);
  assert.ok(set.notes.sections.slice(0, 4).every(s => /Sınavda nasıl sorulur: /.test(s.content) && /Ünite: ÜNİTE/.test(s.content)));
  assert.equal(set.flashcards.length, 16);
  assert.equal(set.quiz.length, 8 + 6 + 3 + 4);                           // every question of the bank, nothing dropped
  assert.deepEqual([...new Set(set.quiz.map(q => q.category))], ['Konu: Hücre Yapısı', 'Konu: Doku Çeşitleri', 'Konu: Organ Sistemleri', 'Konu: Enerji dönüşümünü yorumlayabilme']);   // one contiguous group each, table order
  assert.deepEqual(['Hücre Yapısı', 'Doku Çeşitleri', 'Organ Sistemleri'].map(l => set.quiz.filter(q => q.category === 'Konu: ' + l).length), [8, 6, 3]);
  assert.ok(set.quiz.every(q => !q.scenarioExam));
  assert.equal(new Set(set.quiz.map(q => q.question)).size, set.quiz.length);
  assert.ok(set.notes.mindmap && set.notes.commonMistakes.length === 2);
  assert.deepEqual(set.meta.counts, { kazanim: 4, cards: 16, questions: 21, trimmed: 0 });
  assert.deepEqual([set.meta.kind, set.meta.fileId, set.meta.sheet, set.meta.grade, set.meta.bank], ['course', 'fx000001', '9. SINIF', 9, 'b-fx000001-9']);
  assert.equal(set.sources.length, 1);
  assert.match(set.sources[0].text, /FX\.4 \| - \| FX\.4\. Enerji dönüşümünü yorumlayabilme \| 0–2/);
});
test('course compose: the summary says how many scenarios and which question counts every exam gives each kazanım', () => {
  const s = courseCompose().notes.summary;
  assert.match(s, /tüm 4 kazanımının notu, 16 kart ve 21 soru/);
  assert.match(s, /1\. Dönem 1\. Ortak Yazılı Sınav: 2 senaryo/);
  assert.match(s, /- FX\.1 · Hücre Yapısı: 1–3 soru/);                    // scenario 1 asks 1, scenario 2 asks 3
  assert.match(s, /- FX\.2 · Doku Çeşitleri: 1–3 soru/);
  assert.match(s, /- FX\.3 · Organ Sistemleri: 0 soru/);                  // never asked
  assert.match(s, /- FX\.4 · Enerji dönüşümünü yorumlayabilme: 0–2 soru/);    // scenario 1 skips it
  assert.match(s, /1\. Dönem 2\. Ortak Yazılı Sınav: MEB konuları yayımladı ama soru sayılarını henüz yayımlamadı/);
  assert.match(s, /Ders özeti:/);
  const sec = courseCompose().notes.sections;
  assert.match(sec[0].content, /Sınavlarda: 1\. Dönem 1\. Ortak Yazılı Sınav 1–3 soru\./);
  assert.ok(!/Sınavlarda:/.test(sec[2].content));                         // FX.3 is asked by no scenario
});
test('course compose is deterministic and passes Parser.normalizeStudyData with every question', () => {
  assert.deepEqual(courseCompose(), courseCompose());
  const { ctx, run } = modules();
  ctx.bank = scenFx.bank; ctx.spec = scenFx.spec;
  const d = JSON.parse(run('JSON.stringify(Parser.normalizeStudyData(ScenarioSet.composeCourse(bank, ScenarioSet.withFile(spec, 0))))'));
  assert.equal(d.quiz.length, 21); assert.equal(d.flashcards.length, 16); assert.equal(d.meta.kind, 'course'); assert.deepEqual(d.meta.grade, [9]);
  assert.equal(d.meta.counts.questions, 21);
});
test('course compose: over the size limit only extra questions go, lowest weight first, one per kazanım per round', () => {
  const full = courseCompose();
  const size = v => Buffer.byteLength(JSON.stringify(v));
  const one = courseCompose({ maxBytes: size(full) - 1 });
  assert.equal(one.meta.counts.trimmed, 1);
  assert.equal(one.quiz.length, 20);
  assert.equal(one.quiz.filter(q => q.category === 'Konu: Organ Sistemleri').length, 2);   // FX.3 has the lowest weight: its extra goes first
  assert.match(one.notes.summary, /bankadaki 21 sorudan 1 ek soru çıkarıldı/);
  // every kazanım keeps the questions its biggest scenario asks (FX.1 3, FX.2 3, FX.3 at least 1, FX.4 2)
  let lo = 0;
  for (let cap = size(full); cap > 0; cap -= 400) {
    let set;
    try { set = courseCompose({ maxBytes: cap }); } catch (err) { assert.match(err.message, /over the .* KB limit/); lo = cap; break; }
    const by = c => set.quiz.filter(q => q.category === 'Konu: ' + c).length;
    assert.ok(by('Hücre Yapısı') >= 3 && by('Doku Çeşitleri') >= 3 && by('Organ Sistemleri') >= 1 && by('Enerji dönüşümünü yorumlayabilme') >= 2);
    assert.ok(size(set) <= cap);
    assert.equal(set.notes.sections.length, 5); assert.equal(set.flashcards.length, 16);          // notes and cards are never trimmed
  }
  assert.ok(lo > 0);
  assert.throws(() => courseCompose({ maxBytes: 1000 }), /over the 1 KB limit/);
});
test('course compose fails loudly on a bank that lacks a kazanım or has a pool smaller than a scenario asks', () => {
  assert.throws(() => courseCompose(undefined, b => { b.kazanimlar.pop(); }), /has no kazanım FX\.4/);
  assert.throws(() => courseCompose(undefined, b => { b.kazanimlar[0].questions.length = 2; }), /FX\.1 has 2 questions, a scenario asks 3/);
  assert.throws(() => courseCompose(undefined, b => { b.kazanimlar[1].note.content = ''; }), /FX\.2 has no note/);
});
test('MebScen.openCourse composes the whole course into its own deck, keyed by file and sheet', async () => {
  const L = scenLoader();
  L.run('var sheets = MebScen.sheetsOf(' + JSON.stringify(scenEntries) + ')');
  L.ctx.s = L.run('sheets[0]'); L.ctx.nobank = L.run('sheets[1]');
  const id = await L.run('MebScen.openCourse(s)');
  assert.deepEqual(L.fetched, ['data/meb/scen/spec/fx000001.json', 'data/meb/scen/bank/b-fx000001-9.json']);
  const deck = JSON.parse(L.run(`JSON.stringify(Decks.get("${id}").data)`));
  assert.equal(deck.title, 'Biyoloji 9 · Tüm konular · Bütün ders');
  assert.equal(deck.quiz.length, 21);
  assert.equal(deck.meta.kind, 'course');
  // Again: the confirm opens the existing deck. Declined: a copy. A scenario deck of the same sheet is not the course deck.
  assert.equal(await L.run('MebScen.openCourse(s)'), id); assert.equal(L.asked(), 1); assert.equal(L.fetched.length, 2);
  L.setAnswer(false);
  const copy = await L.run('MebScen.openCourse(s)');
  assert.notEqual(copy, id); assert.equal(L.run('Decks.list().length'), 2);
  L.ctx.e = scenEntries[0];
  await L.run('MebScen.open(e)');
  assert.equal(L.run('Decks.list().length'), 3); assert.equal(L.asked(), 2);
  assert.equal(L.run('MebScen.findCourseDeck(s).data.meta.kind'), 'course');
  assert.equal(L.run('MebScen.findDeck(e).data.meta.kind'), 'scenario');
  assert.equal(L.run('MebSets.findDeck("fx000001")'), null);                  // neither is the file's own study set
  await assert.rejects(L.run('MebScen.openCourse(nobank)'), /scenSoon/);
  L.setFail(true);
  L.ctx.s2 = { ...L.run('sheets[0]'), key: 'fx000001.9', si: 0, sheet: '9. SINIF', bank: 'b-other' };
  await assert.rejects(L.run('MebScen.openCourse(s2)'), /HTTP 503/);
});
test('MebScen.open on full storage keeps the deck in memory and shows the existing save-failed toast', async () => {
  const L = scenLoader();
  L.run(`localStorage.setItem = () => { throw new Error('quota'); }`);
  L.ctx.e = scenEntries[0];
  const id = await L.run('MebScen.open(e)');
  assert.ok(L.toasts.some(t => /^error:Could not save: browser storage is full/.test(t)));
  assert.equal(L.run(`Decks.get("${id}").data.quiz.length`) > 0, true);
});
test('MebScen.applyProfile saves the scenario table as the deck topic profile', async () => {
  const L = scenLoader();
  L.ctx.e = scenEntries[1];
  assert.equal(await L.run('MebScen.applyProfile(e)'), null);              // no open deck: explicit toast, nothing saved
  assert.match(L.toasts.pop(), /^error:mebNoDeck/);
  L.run(`Decks.save({ title: 'Biyoloji' }, '')`);
  const saved = JSON.parse(JSON.stringify(await L.run('MebScen.applyProfile(e)')));
  assert.equal(saved.topicsFrom, 'distribution');
  assert.deepEqual(saved.topics.map(t => [t.name, t.count]), [['Hücre Yapısı', 3], ['Enerji dönüşümünü yorumlayabilme', 2], ['Doku Çeşitleri', 1]]);
  assert.equal(saved.source, 'Biyoloji 9 · 1. Dönem 1. Ortak Yazılı Sınav · scenRowTitle');
  // The scenario exam's own categories match those topic names, so adaptive practice weights them.
  assert.equal(L.run(`PastPaper.topicBoost(PastPaper.getProfile())({ category: 'Senaryo sınavı: Hücre Yapısı' })`), 1.5);
  assert.equal(L.asked(), 0);
});

// ---------- scenario data generator ----------
const scenGen = () => import(require('node:url').pathToFileURL(path.join(__dirname, '../scripts/build-meb-scenarios.mjs')).href);
test('scenario generator: index, slim spec and slim bank from the fixture', async () => {
  const { build } = await scenGen();
  const r = build({ files: [{ fileId: 'fx000001', data: scenFx.spec }], banks: [{ name: 'b.json', data: scenFx.bank }] });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.index.map(e => [e.si, e.ei, e.n, e.total, e.kazanimCount, e.d, e.bank, e.hasBank, e.national, e.sheet]), [
    [0, 0, 1, 4, 2, [1, 3], 'b-fx000001-9', true, 0, '9. SINIF'],
    [0, 0, 2, 6, 3, [3, 1, 2], 'b-fx000001-9', true, 0, '9. SINIF'],
    [0, 1, 0, 0, 0, [], 'b-fx000001-9', true, 1, '9. SINIF']]);
  const spec = r.specs.get('fx000001');
  assert.deepEqual(Object.keys(spec.sheets[0].exams[0].scenarios[0].items[0]), ['id', 'count']);
  assert.match(spec.sheets[0].exams[1].notes, /Ülke Geneli/);
  assert.deepEqual(Object.keys(r.banks.get('b-fx000001-9').kazanimlar[0]), ['id', 'note', 'cards', 'questions']);
  assert.ok(!('outcome' in r.banks.get('b-fx000001-9').kazanimlar[0]));
});
test('scenario generator: a bank that cannot serve every scenario is skipped and reported, never half used', async () => {
  const { build } = await scenGen();
  const files = [{ fileId: 'fx000001', data: scenFx.spec }];
  const short = JSON.parse(JSON.stringify(scenFx.bank)); short.kazanimlar[0].questions.length = 2;
  let r = build({ files, banks: [{ name: 'short.json', data: short }] });
  assert.equal(r.banks.size, 0);
  assert.match(r.skipped[0].reason, /FX\.1 has 2 questions, a scenario asks 3/);
  assert.ok(r.index.every(e => e.bank === null && e.hasBank === false));
  const other = JSON.parse(JSON.stringify(scenFx.bank)); other.meta.sheet = '12. SINIF';
  assert.match(build({ files, banks: [{ name: 'o.json', data: other }] }).skipped[0].reason, /no sheet "12\. SINIF"/);
  assert.match(build({ files, banks: [{ name: 'n.json', data: { meta: { fileId: 'fx000001' } } }] }).skipped[0].reason, /meta\.bank/);
  assert.throws(() => build({ files, banks: [{ name: 'a.json', data: scenFx.bank }, { name: 'b.json', data: scenFx.bank }] }), /two banks for fx000001\|9\. SINIF/);
  assert.throws(() => build({ files: [{ fileId: 'zz', data: scenFx.spec }], banks: [] }), /file says fileId fx000001/);
});
test('scenario generator CLI is idempotent and drops files it did not write', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scen-gen-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scenarios')); fs.mkdirSync(path.join(tmp, 'banks'));
    fs.writeFileSync(path.join(tmp, 'scenarios/fx000001.json'), JSON.stringify(scenFx.spec));
    fs.writeFileSync(path.join(tmp, 'scenarios/index.json'), '[]');            // the flat index / summary are not workbooks
    fs.writeFileSync(path.join(tmp, 'banks/b-fx000001-9.json'), JSON.stringify(scenFx.bank));
    const script = path.join(__dirname, '../scripts/build-meb-scenarios.mjs'), out = path.join(tmp, 'out');
    const sh = () => execFileSync(process.execPath, [script, tmp, out], { stdio: 'pipe' }).toString();
    const snap = () => Object.fromEntries(['index.json', 'spec/fx000001.json', 'bank/b-fx000001-9.json'].map(f => [f, fs.readFileSync(path.join(out, 'scen', f), 'utf8')]));
    assert.match(sh(), /index\.json  3 entries \(2 with a bank, 1 national\)/);
    const first = snap();
    sh();
    assert.deepEqual(snap(), first);
    fs.writeFileSync(path.join(out, 'scen/bank/stale.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'banks/broken.json'), JSON.stringify({ meta: { bank: 'b-x', kind: 'bank', fileId: 'fx000001', sheet: 'none' } }));
    assert.match(sh(), /SKIPPED broken\.json: no sheet "none"/);
    assert.ok(!fs.existsSync(path.join(out, 'scen/bank/stale.json')));
    assert.deepEqual(snap(), first);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('every committed bank composes a whole-course notebook: all kazanım, all questions, under the size limit', () => {
  const dir = path.join(__dirname, '../data/meb/scen');
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const { ctx, run } = modules();
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const seen = new Set(), sizes = [], trimmed = [];
  for (const e of items) {
    if (!e.bank || seen.has(e.bank)) continue;
    seen.add(e.bank);
    ctx.spec = read(`spec/${e.fileId}.json`); ctx.bank = read(`bank/${e.bank}.json`);
    const sheet = ctx.spec.sheets[e.si];
    const set = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData(ScenarioSet.composeCourse(bank, ScenarioSet.withFile(spec, ${e.si}))))`));
    const all = ctx.bank.kazanimlar.reduce((n, k) => n + k.questions.length, 0);
    assert.equal(set.notes.sections.length, sheet.kazanimlar.length + (ctx.bank.studyTips.length ? 1 : 0), e.bank);
    assert.equal(set.quiz.length + set.meta.counts.trimmed, all, e.bank);
    if (set.meta.counts.trimmed) trimmed.push(e.bank);
    const kb = Buffer.byteLength(JSON.stringify(set)) / 1024;
    assert.ok(kb <= 350, `${e.bank} ${kb.toFixed(0)} KB`);
    sizes.push(kb);
  }
  assert.equal(seen.size, 62);
  console.log(`      whole-course notebooks: ${sizes.length}, ${Math.min(...sizes).toFixed(0)}-${Math.max(...sizes).toFixed(0)} KB, banks trimmed: ${trimmed.length ? trimmed.join(', ') : 'none'}`);
});

// ---------- service worker: scenario banks ----------
test('sw.js precaches the scenario scripts, never scenario data, and keeps the last 12 cached banks', async () => {
  const swSource = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const handlers = {}, puts = [], deleted = [];
  const keys = [{ url: 'https://x.test/data/meb/sets/s1.json' }, { url: 'https://x.test/data/meb/scen/index.json' }];
  for (let i = 0; i < 15; i++) keys.push({ url: `https://x.test/data/meb/scen/bank/b${i}.json` });
  const cache = { match: async () => undefined, put: async (r) => { puts.push(r.url); keys.push({ url: r.url }); }, keys: async () => keys, delete: async r => { deleted.push(r.url); } };
  const ctx = vm.createContext({
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.test' } }, URL, console,
    caches: { open: async () => cache }, fetch: async () => ({ status: 200, type: 'basic', clone() { return this; } })
  });
  vm.runInContext(swSource, ctx);
  const shell = vm.runInContext('SHELL', ctx);
  for (const f of ['./js/scenarioset.js', './js/mebscen.js', './js/i18n-scen.js']) assert.ok(shell.includes(f), f);
  assert.ok(!shell.some(u => /data\/meb\/scen/.test(u)));
  const wait = [];
  let reply;
  handlers.fetch({ request: { method: 'GET', url: 'https://x.test/data/meb/scen/bank/new.json', mode: 'cors' }, respondWith: p => { reply = p; }, waitUntil: p => wait.push(p) });
  await reply; await Promise.all(wait);
  assert.deepEqual(puts, ['https://x.test/data/meb/scen/bank/new.json']);
  assert.deepEqual(deleted, [0, 1, 2, 3].map(i => `https://x.test/data/meb/scen/bank/b${i}.json`));   // 16 banks cached, the 4 oldest go; sets and the index stay
});

test('every committed scenario with a bank composes: exact exam counts, valid index, notebook under the size limit', () => {
  const dir = path.join(__dirname, '../data/meb/scen');
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const { ctx, run } = modules();
  ctx.items = items;
  assert.equal(run('MebScen.validateIndex(items).length'), items.length);
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const specs = new Map(), banks = new Map();
  let composed = 0;
  for (const e of items) {
    assert.equal(e.hasBank, !!e.bank && fs.existsSync(path.join(dir, 'bank', e.bank + '.json')));
    if (!e.hasBank || e.national) continue;
    if (!specs.has(e.fileId)) specs.set(e.fileId, read(`spec/${e.fileId}.json`));
    if (!banks.has(e.bank)) banks.set(e.bank, read(`bank/${e.bank}.json`));
    ctx.spec = specs.get(e.fileId); ctx.bank = banks.get(e.bank);
    const k = ctx.spec.sheets[e.si].exams[e.ei].scenarios.findIndex(s => s.n === e.n);
    const set = JSON.parse(run(`JSON.stringify(Parser.normalizeStudyData(ScenarioSet.compose(bank, ScenarioSet.withFile(spec, ${e.si}), ${e.ei}, ${k})))`));
    assert.equal(set.quiz.filter(q => q.scenarioExam).length, e.total, `${e.bank} ${e.exam} S${e.n}`);
    assert.ok(Buffer.byteLength(JSON.stringify(set)) <= 350 * 1024, `${e.bank} S${e.n} over 350 KB`);
    composed++;
  }
  assert.ok(composed > 0);
});
