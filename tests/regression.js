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
  for (const file of ['parser', 'decks', 'stats', 'api']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), ctx);
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
