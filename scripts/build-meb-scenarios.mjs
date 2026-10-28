// Builds data/meb/scen/ for the "Senaryolar" tab of the MEB library (js/mebscen.js).
//
//   node scripts/build-meb-scenarios.mjs <meb-data-dir> [out-dir]
//
// <meb-data-dir> holds scenarios/<fileId>.json (the parsed 2026-2027 "Konu Soru
// Dağılım Tablosu" workbooks, see scenarios/README.md) and banks/<bank>.json (the
// study banks, one per subject+grade sheet). out-dir defaults to data/meb in this
// repo; everything is written under <out-dir>/scen/:
//   index.json         one entry per scenario (a national exam without scenarios gets one entry: n 0, national 1):
//                      fileId, si (sheet index), sheet (its name), ei (exam index), n, subject, grade, variant, exam, total,
//                      kazanimCount, d (question counts of the asked kazanım in table order, for the bar),
//                      bank (bank id or null), hasBank, national
//   spec/<fileId>.json what ScenarioSet.compose needs: kazanım texts, exams, scenarios, items
//   bank/<bank>.json  a bank without the fields the spec already has (unit, topic, outcome, code)
// A bank is copied only if it passes ScenarioSet.validateBank for the whole sheet (every kazanım present
// with a note, a question pool at least as large as its biggest scenario count, every question valid) and,
// when <meb-data-dir>/tools/validate-bank.mjs exists, that validator too. A bank that fails is skipped and
// reported; its scenarios show "study bank coming". Files in scen/ that this run did not write are removed,
// so the output depends only on the input.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ScenarioSet = vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'js', 'scenarioset.js'), 'utf8') + '\nScenarioSet', { TextEncoder });

const SKIP = /^(index|summary)\.json$/;

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { throw new Error(`cannot read ${file}: ${err.message}`); }
  try { return JSON.parse(raw.replace(/^﻿/, '')); } catch (err) { throw new Error(`${file}: ${err.message}`); }
}

// files: [{ fileId, data }] scenario workbooks; banks: [{ name, data }]. Returns
// { index, specs: Map fileId -> spec, banks: Map bankId -> slim bank, skipped: [{name, reason}] }.
export function build({ files, banks }) {
  const specs = new Map(), index = [], skipped = [], out = new Map(), byKey = new Map();
  for (const f of files.slice().sort((a, b) => a.fileId.localeCompare(b.fileId))) {
    const d = f.data;
    if (d.fileId !== f.fileId) throw new Error(`${f.fileId}: file says fileId ${d.fileId}`);
    specs.set(f.fileId, ScenarioSet.validateSpec({
      fileId: d.fileId, subject: d.subject, schoolYear: d.schoolYear, sourceUrl: d.sourceUrl,
      sheets: d.sheets.map(s => ({
        sheet: s.sheet, grade: s.grade, course: s.course, variant: s.variant || '',
        kazanimlar: s.kazanimlar.map(k => ({ id: k.id, code: k.code, unit: k.unit, topic: k.topic, outcome: k.outcome })),
        exams: s.exams.map(e => ({
          exam: e.exam,
          ...(e.scenarios.length ? {} : { notes: [].concat(e.notes || []).join(' ') }),
          scenarios: e.scenarios.map(sc => ({ n: sc.n, total: sc.total, items: sc.items.map(it => ({ id: it.id, count: it.count })) }))
        }))
      }))
    }));
  }

  // One bank per sheet; a bank that does not match a sheet or fails validation is skipped, never half used.
  for (const b of banks) {
    const m = (b.data && b.data.meta) || {};
    const fail = reason => skipped.push({ name: b.name, reason });
    const spec = specs.get(m.fileId);
    const sheet = spec && spec.sheets.find(s => s.sheet === m.sheet);
    if (!m.bank || m.kind !== 'bank') { fail('meta.bank / meta.kind missing'); continue; }
    if (!sheet) { fail(`no sheet "${m.sheet}" in file ${m.fileId}`); continue; }
    try { ScenarioSet.validateBank(b.data, { ...sheet, fileId: spec.fileId }); } catch (err) { fail(err.message); continue; }
    const key = m.fileId + '|' + m.sheet;
    if (byKey.has(key)) throw new Error(`two banks for ${key}: ${byKey.get(key)} and ${m.bank}`);
    byKey.set(key, m.bank);
    out.set(m.bank, {
      meta: { bank: m.bank, fileId: m.fileId, sheet: m.sheet, subject: m.subject, grade: m.grade },
      summary: b.data.summary, mindmap: b.data.mindmap, commonMistakes: b.data.commonMistakes, studyTips: b.data.studyTips,
      kazanimlar: b.data.kazanimlar.filter(k => sheet.kazanimlar.some(x => x.id === k.id)).map(k => ({ id: k.id, note: k.note, cards: k.cards, questions: k.questions }))
    });
  }

  for (const spec of specs.values()) {
    spec.sheets.forEach((sheet, si) => sheet.exams.forEach((exam, ei) => {
      const bank = byKey.get(spec.fileId + '|' + sheet.sheet) || null;
      const base = { fileId: spec.fileId, si, sheet: sheet.sheet, ei, subject: spec.subject, grade: sheet.grade, variant: sheet.variant, exam: exam.exam, bank, hasBank: !!bank };
      if (!exam.scenarios.length) { index.push({ ...base, n: 0, total: 0, kazanimCount: 0, d: [], national: 1 }); return; }
      exam.scenarios.forEach((sc, k) => {
        const rows = ScenarioSet.distribution(sheet, ei, k).rows.filter(r => r.count);
        index.push({ ...base, n: sc.n, total: sc.total, kazanimCount: rows.length, d: rows.map(r => r.count), national: 0 });
      });
    }));
  }
  return { index, specs, banks: out, skipped };
}

const lines = arr => '[\n' + arr.map(x => JSON.stringify(x)).join(',\n') + '\n]\n';

// Writes `files` ({ name: text }) into dir and deletes every other .json there.
function sync(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.json') && !(name in files)) fs.rmSync(path.join(dir, name));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  }
}

function main(argv) {
  const [dir, outArg] = argv;
  if (!dir) throw new Error('usage: node scripts/build-meb-scenarios.mjs <meb-data-dir> [out-dir]');
  const out = path.resolve(outArg || path.join(here, '..', 'data', 'meb')), scen = path.join(out, 'scen');
  const sdir = path.join(dir, 'scenarios'), bdir = path.join(dir, 'banks');
  const files = fs.readdirSync(sdir).filter(n => n.endsWith('.json') && !SKIP.test(n)).map(n => ({ fileId: n.slice(0, -5), data: readJson(path.join(sdir, n)) }));
  const banks = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter(n => n.endsWith('.json')).map(n => ({ name: n, data: readJson(path.join(bdir, n)) })) : [];
  const { index, specs, banks: ok, skipped } = build({ files, banks });
  // The official validator, when the data directory has it, has the last word on a bank.
  const validator = path.join(dir, 'tools', 'validate-bank.mjs');
  if (fs.existsSync(validator)) {
    for (const id of [...ok.keys()]) {
      const name = banks.find(b => b.data.meta && b.data.meta.bank === id).name;
      const r = spawnSync(process.execPath, [validator, path.join(bdir, name)], { encoding: 'utf8' });
      if (r.status !== 0) { ok.delete(id); skipped.push({ name, reason: 'validate-bank.mjs: ' + (r.stdout.split('\n').find(l => /ERROR/.test(l)) || r.stderr || 'failed').trim() }); }
    }
    for (const e of index) if (e.bank && !ok.has(e.bank)) { e.bank = null; e.hasBank = false; }
  } else console.log('note: tools/validate-bank.mjs not found, only the built-in checks ran');
  const idx = lines(index), specFiles = {}, bankFiles = {};
  for (const [id, s] of specs) specFiles[id + '.json'] = JSON.stringify(s) + '\n';
  for (const [id, b] of ok) bankFiles[id + '.json'] = JSON.stringify(b) + '\n';
  fs.mkdirSync(scen, { recursive: true });
  fs.writeFileSync(path.join(scen, 'index.json'), idx);
  sync(path.join(scen, 'spec'), specFiles);
  sync(path.join(scen, 'bank'), bankFiles);
  const kb = t => (Buffer.byteLength(t) / 1024).toFixed(0);
  console.log(`index.json  ${index.length} entries (${index.filter(e => e.hasBank && !e.national).length} with a bank, ${index.filter(e => e.national).length} national), ${kb(idx)} KB`);
  console.log(`spec/       ${specs.size} files, ${kb(Object.values(specFiles).join(''))} KB`);
  console.log(`bank/       ${ok.size} banks, ${kb(Object.values(bankFiles).join(''))} KB`);
  for (const s of skipped) console.log(`SKIPPED ${s.name}: ${s.reason}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}
