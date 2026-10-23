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
  for (const file of ['parser', 'decks', 'stats', 'api', 'sources', 'planner']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), ctx);
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
