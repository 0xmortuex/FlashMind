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
  for (const file of ['parser', 'decks', 'stats', 'api', 'sources', 'planner', 'adaptive', 'insights', 'memory', 'predictor', 'concepts', 'coach']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), ctx);
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
