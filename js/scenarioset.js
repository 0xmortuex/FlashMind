// ===== MEB scenario notebooks =====
// MEB's 2026-2027 "Konu Soru Dağılım Tablosu" says, per course/grade, exam and
// SCENARIO, how many questions each kazanım gets. ScenarioSet.compose turns one
// scenario plus the course's study BANK (notes, cards and a question pool per
// kazanım, data/meb/scen/bank/<bank>.json) into a normal study set: notes for
// the kazanım the scenario asks (heaviest first), their cards, the scenario
// EXAM (exactly `count` questions per kazanım, seeded pick so a scenario always
// gets the same exam; flag scenarioExam) and the rest of the pool as "Ek
// alıştırma". Pure, no DOM; js/mebscen.js fetches the files and opens the set.
//
// composeCourse turns a whole sheet + its bank into one "all topics" notebook (every kazanım, every bank question).
//
// Spec shapes (written by scripts/build-meb-scenarios.mjs):
//   fileSpec  { fileId, subject, schoolYear, sourceUrl, sheets: [sheet] }
//   sheet     { sheet, grade, course, variant, kazanimlar: [{id, code, unit, topic, outcome}],
//               exams: [{ exam, notes, scenarios: [{ n, total, items: [{id, count}] }] }] }
// compose() takes the sheet with fileId / subject / schoolYear / sourceUrl
// copied onto it (withFile). All text it writes is Turkish: it is the exam's language.
const ScenarioSet = (() => {
  const YEAR = '2026-2027';
  const MAX_BYTES = 350 * 1024;   // a composed notebook shares ~5 MB of localStorage with every other deck
  const STUDY_MINUTES = 120;
  const DIFF_PATTERN = ['medium', 'easy', 'hard', 'medium', 'easy'];   // exam mix: 40 % medium, 40 % easy, 20 % hard

  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = v => (typeof v === 'string' ? v : '');
  const list = v => (Array.isArray(v) ? v : []);
  const bytes = v => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length;
  const pct1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

  // ---------- seeded random ----------
  function seedOf(s) {   // FNV-1a
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {   // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- spec helpers ----------
  const withFile = (fileSpec, sheetIdx) => {
    const sheet = fileSpec && fileSpec.sheets && fileSpec.sheets[sheetIdx];
    if (!sheet) throw new Error(`Spec ${fileSpec && fileSpec.fileId}: no sheet ${sheetIdx}`);
    return { ...sheet, fileId: fileSpec.fileId, subject: fileSpec.subject, schoolYear: fileSpec.schoolYear || YEAR, sourceUrl: fileSpec.sourceUrl };
  };

  // Short topic name used for categories, cards and the topic profile. A sheet
  // without a topic column (Türkçe 5-7, İngilizce...) falls back to the outcome text.
  function label(k) {
    const t = str(k.topic).replace(/\s+/g, ' ').trim();
    const o = str(k.outcome).replace(/^\s*[^\s]+\s+/, '').replace(/\s+/g, ' ').trim();
    return (t || o || str(k.code)).slice(0, 120);
  }

  // Largest question count each kazanım has in any scenario of the sheet.
  function maxCounts(sheet) {
    const out = {};
    list(sheet.exams).forEach(ex => list(ex.scenarios).forEach(s => list(s.items).forEach(it => { out[it.id] = Math.max(out[it.id] || 0, it.count); })));
    return out;
  }

  function pickScenario(sheet, examIdx, scenarioIdx) {
    const exam = list(sheet.exams)[examIdx];
    if (!exam) throw new Error(`${sheet.sheet}: no exam ${examIdx}`);
    if (!list(exam.scenarios).length) throw new Error(`${exam.exam}: ülke geneli ortak yazılı, senaryo yok`);
    const sc = exam.scenarios[scenarioIdx];
    if (!sc) throw new Error(`${exam.exam}: no scenario ${scenarioIdx}`);
    return { exam, sc };
  }

  // Every row of the table for one scenario: { id, code, unit, topic, label, outcome, count, pct, w } in
  // table order (count 0 included), the units with their share, and the total.
  function distribution(sheet, examIdx, scenarioIdx) {
    const { sc } = pickScenario(sheet, examIdx, scenarioIdx);
    const kz = list(sheet.kazanimlar);
    const byId = new Map(kz.map(k => [k.id, k]));
    const counts = new Map();
    list(sc.items).forEach(it => {
      if (!byId.has(it.id)) throw new Error(`Scenario ${sc.n}: kazanım ${it.id} is not in the sheet`);
      if (counts.has(it.id)) throw new Error(`Scenario ${sc.n}: kazanım ${it.id} listed twice`);
      if (!Number.isInteger(it.count) || it.count < 1) throw new Error(`Scenario ${sc.n}: bad count for ${it.id}`);
      counts.set(it.id, it.count);
    });
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total !== sc.total) throw new Error(`Scenario ${sc.n}: items add up to ${total}, the table says ${sc.total}`);
    const rows = kz.map(k => {
      const count = counts.get(k.id) || 0;
      return { id: k.id, code: k.code, unit: k.unit, topic: k.topic, outcome: k.outcome, label: label(k), count, pct: total ? count / total * 100 : 0 };
    });
    const units = [];
    rows.filter(r => r.count).forEach(r => {
      let u = units.find(x => x.unit === r.unit);
      if (!u) units.push(u = { unit: r.unit, count: 0, pct: 0 });
      u.count += r.count;
      u.pct = u.count / total * 100;
    });
    units.sort((a, b) => b.count - a.count);
    return { total, rows, units };
  }

  // [{name, count}] for PastPaper.saveProfile (same-named topics are merged there).
  const profileTopics = (sheet, examIdx, scenarioIdx) => distribution(sheet, examIdx, scenarioIdx).rows.filter(r => r.count).map(r => ({ name: r.label, count: r.count }));

  // ---------- validation ----------
  // Throws when the file cannot be composed from. checkPools also demands, for
  // every kazanım, a question pool as large as its biggest count in ANY scenario.
  function validateSpec(fileSpec) {
    if (!obj(fileSpec) || !fileSpec.fileId || !Array.isArray(fileSpec.sheets) || !fileSpec.sheets.length) throw new Error('scenario spec has no sheets');
    fileSpec.sheets.forEach((sheet, i) => {
      if (!Array.isArray(sheet.kazanimlar) || !sheet.kazanimlar.length) throw new Error(`${fileSpec.fileId} sheet ${i}: no kazanım`);
      const ids = new Set(sheet.kazanimlar.map(k => k.id));
      if (ids.size !== sheet.kazanimlar.length) throw new Error(`${fileSpec.fileId} sheet ${i}: duplicate kazanım id`);
      list(sheet.exams).forEach((ex, ei) => list(ex.scenarios).forEach((s, si) => distribution(sheet, ei, si)));
    });
    return fileSpec;
  }

  // The same rules Parser.normalizeStudyData applies: a question it would drop must never be in the exam block.
  function questionOk(q) {
    if (!obj(q) || !str(q.question).trim()) return false;
    if (q.type === 'open-ended') return true;
    if (q.type === 'true-false') return typeof q.correct === 'boolean';
    if (q.type === 'fill-blank') return list(q.answers).some(a => typeof a === 'string' && a.trim());
    if (q.type === 'matching') return list(q.pairs).filter(p => obj(p) && str(p.left).trim() && str(p.right).trim()).length >= 2;
    return Array.isArray(q.options) && q.options.length >= 2 && q.options.every(o => typeof o === 'string') && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length;
  }

  // ids = the kazanım a scenario needs; without it every kazanım of the sheet must be there
  // with a question pool as large as its biggest count in ANY scenario (what the generator demands).
  function validateBank(bank, sheet, ids) {
    if (!obj(bank) || !Array.isArray(bank.kazanimlar)) throw new Error('bank has no kazanimlar');
    const m = bank.meta || {};
    if (m.fileId && sheet.fileId && m.fileId !== sheet.fileId) throw new Error(`bank ${m.bank} belongs to file ${m.fileId}, not ${sheet.fileId}`);
    if (m.sheet && m.sheet !== sheet.sheet) throw new Error(`bank ${m.bank} is for sheet "${m.sheet}", not "${sheet.sheet}"`);
    const byId = new Map(bank.kazanimlar.map(k => [k.id, k]));
    const max = maxCounts(sheet);
    sheet.kazanimlar.forEach(k => {
      if (ids && !ids.has(k.id)) return;
      const b = byId.get(k.id);
      if (!b) throw new Error(`Bank ${m.bank || ''} has no kazanım ${k.id}`);
      if (!obj(b.note) || !str(b.note.content).trim()) throw new Error(`Bank ${m.bank || ''}: kazanım ${k.id} has no note`);
      list(b.questions).forEach((q, i) => { if (!questionOk(q)) throw new Error(`Bank ${m.bank || ''}: kazanım ${k.id} question ${i} is not a valid question`); });
      if (!ids && list(b.questions).length < (max[k.id] || 0)) throw new Error(`Bank ${m.bank || ''}: kazanım ${k.id} has ${list(b.questions).length} questions, a scenario asks ${max[k.id]}`);
    });
    return bank;
  }

  // ---------- question pick ----------
  // `count` indices out of the pool, easy/medium/hard in a 2:2:1 rhythm where the pool allows it.
  function pickIndices(pool, count, rand) {
    const buckets = { easy: [], medium: [], hard: [] };
    pool.forEach((q, i) => buckets[buckets[q.difficulty] ? q.difficulty : 'medium'].push(i));
    Object.keys(buckets).forEach(d => { buckets[d] = shuffled(buckets[d], rand); });
    const chosen = [];
    for (let s = 0; s < count; s++) {
      let d = DIFF_PATTERN[s % DIFF_PATTERN.length];
      if (!buckets[d].length) d = ['medium', 'easy', 'hard'].find(x => buckets[x].length);
      chosen.push(buckets[d].pop());
    }
    return { chosen: chosen.sort((a, b) => a - b), rest: shuffled([].concat(buckets.easy, buckets.medium, buckets.hard), rand) };
  }

  // Whole numbers that add up to `total`, in proportion to w (largest remainder).
  function split(total, w) {
    const sum = w.reduce((a, b) => a + b, 0);
    const exact = w.map(x => x / sum * total);
    const out = exact.map(Math.floor);
    let left = total - out.reduce((a, b) => a + b, 0);
    exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return out;
  }

  // ---------- text ----------
  function summaryText(sheet, exam, sc, dist, order, bank, minutes) {
    const T = dist.total, K = order.length, zero = dist.rows.length - K;
    const lines = [
      `${sheet.subject} ${sheet.grade}. sınıf · ${exam.exam} · Senaryo ${sc.n} (MEB ${sheet.schoolYear} Konu Soru Dağılım Tablosu).`,
      `Bu senaryoda toplam ${T} soru ve ${K} kazanım var${zero ? `; diğer ${zero} kazanım bu senaryoda sorulmuyor` : ''}.`,
      '', 'Ünite ağırlıkları:',
      ...dist.units.map(u => `- ${u.unit}: ${u.count} soru (%${pct1(u.pct)})`),
      '', 'Kazanım ağırlıkları ve çalışma sırası (soru sayısına göre, en çok sorulandan başla):',
      ...order.map((r, i) => `${i + 1}. ${r.code} · ${r.label}: ${r.count} soru (%${pct1(r.pct)})`),
      '', `${STUDY_MINUTES} dakikalık çalışma planı (ağırlıkla orantılı):`,
      ...order.map((r, i) => `- ${r.code}: ${minutes[i]} dk`),
      '', `Bu defterdeki “Senaryo sınavı” bloğu tablodaki gibi tam ${T} soru içerir; “Ek alıştırma” bloğu aynı kazanımlardan ek sorular verir.`
    ];
    const bs = str(bank.summary).trim();
    if (bs) lines.push('', 'Ders özeti:', bs);
    return lines.join('\n');
  }

  function sectionOf(r, b) {
    const n = b.note;
    const content = [`Bu senaryoda ${r.count} soru.`, `Kazanım: ${str(r.outcome).trim()}`, '', n.content.trim()];
    if (str(n.example).trim()) content.push('', 'Örnek: ' + n.example.trim());
    if (str(n.examTip).trim()) content.push('', 'Sınavda nasıl sorulur: ' + n.examTip.trim());
    return {
      title: `${r.code} · ${str(n.title).trim() || r.label}`,
      content: content.join('\n'),
      bulletPoints: list(n.bulletPoints).filter(x => typeof x === 'string'),
      keyTerms: list(n.keyTerms)
    };
  }

  // The official table rows of this scenario, as the source Ask AI reads.
  function tableText(sheet, exam, sc, dist) {
    const rows = dist.rows.filter(r => r.count);
    return [
      `MEB ${sheet.schoolYear} Konu Soru Dağılım Tablosu · ${sheet.subject} · ${str(sheet.course) || sheet.grade + '. sınıf'}${sheet.variant ? ' (' + sheet.variant + ')' : ''}`,
      `${exam.exam} · Senaryo ${sc.n} · toplam ${dist.total} soru, ${rows.length} kazanım`,
      '', 'Ünite | Kazanım kodu | Konu | Öğrenme çıktısı | Soru sayısı',
      ...rows.map(r => `${r.unit} | ${r.code} | ${str(r.topic) || '-'} | ${str(r.outcome).replace(/\s+/g, ' ').trim()} | ${r.count}`),
      '', 'Bu senaryoda sorulmayan kazanımlar: ' + (dist.rows.filter(r => !r.count).map(r => r.code).join(', ') || 'yok'),
      sheet.sourceUrl ? 'Kaynak: ' + sheet.sourceUrl : ''
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  }

  // ---------- compose ----------
  // examIdx / scenarioIdx are positions in sheet.exams / exam.scenarios.
  // opts: { maxBytes } (default 350 KB; Infinity keeps every extra question).
  function compose(bank, sheet, examIdx, scenarioIdx, opts) {
    const o = opts || {};
    const maxBytes = o.maxBytes == null ? MAX_BYTES : o.maxBytes;
    const { exam, sc } = pickScenario(sheet, examIdx, scenarioIdx);
    const dist = distribution(sheet, examIdx, scenarioIdx);
    const weighted = dist.rows.filter(r => r.count);
    validateBank(bank, sheet, new Set(weighted.map(r => r.id)));
    const byId = new Map(bank.kazanimlar.map(k => [k.id, k]));
    if (!weighted.length) throw new Error(`Senaryo ${sc.n} has no questions`);
    const order = weighted.slice().sort((a, b) => b.count - a.count);   // stable: ties keep table order
    const minutes = split(STUDY_MINUTES, order.map(r => r.count));

    const examQs = [], extraBy = new Map();
    weighted.forEach(r => {
      const pool = list(byId.get(r.id).questions);
      if (pool.length < r.count) throw new Error(`${r.code}: Senaryo ${sc.n} bu kazanımdan ${r.count} soru istiyor, bankada ${pool.length} soru var (${bank.meta && bank.meta.bank || ''})`);
      const rand = rng(seedOf([sheet.fileId, sheet.sheet, exam.exam, sc.n, r.id].join('|')));
      const { chosen, rest } = pickIndices(pool, r.count, rand);
      chosen.forEach(i => examQs.push({ ...pool[i], category: 'Senaryo sınavı: ' + r.label, scenarioExam: true }));
      extraBy.set(r.id, rest.map(i => ({ i, q: { ...pool[i], category: 'Ek alıştırma: ' + r.label } })));
    });

    const sections = order.map(r => sectionOf(r, byId.get(r.id)));
    const skipped = dist.rows.filter(r => !r.count);
    if (skipped.length) sections.push({
      title: 'Bu senaryoda sorulmayan konular',
      content: 'Bu senaryoda aşağıdaki kazanımlardan soru yoktur. Diğer senaryolarda çıkabilir; zamanın kalırsa göz at.',
      bulletPoints: skipped.map(r => `${r.code} · ${r.label}`),
      keyTerms: []
    });
    const tips = list(bank.studyTips).filter(x => typeof x === 'string');
    if (tips.length) sections.push({ title: 'Çalışma ipuçları', content: '', bulletPoints: tips, keyTerms: [] });

    const cards = [];
    order.forEach(r => list(byId.get(r.id).cards).forEach(c => cards.push({ ...c, category: r.label })));

    const title = `${sheet.subject} ${sheet.grade} · ${exam.exam.replace(/ Sınav$/, '')} · Senaryo ${sc.n}`;
    const base = {
      title,
      notes: {
        summary: summaryText(sheet, exam, sc, dist, order, bank, minutes),
        sections,
        commonMistakes: list(bank.commonMistakes).filter(x => typeof x === 'string'),
        ...(bank.mindmap ? { mindmap: bank.mindmap } : {})
      },
      flashcards: cards,
      quiz: examQs,
      sources: [{ id: 'tablo', name: `Konu soru dağılım tablosu · ${exam.exam} · Senaryo ${sc.n}`, kind: 'paste', text: tableText(sheet, exam, sc, dist), enabled: true, addedAt: 0 }],
      meta: {
        kind: 'scenario', fileId: sheet.fileId, bank: str(bank.meta && bank.meta.bank), sheet: sheet.sheet,
        subject: sheet.subject, grade: sheet.grade, exam: exam.exam, scenario: sc.n, schoolYear: sheet.schoolYear || YEAR,
        ...(sheet.sourceUrl ? { sourceUrl: sheet.sourceUrl } : {})
      }
    };

    // Extras: round-robin over the kazanım (heaviest first) so a trimmed notebook still covers all of them.
    const room = maxBytes - bytes({ ...base, meta: { ...base.meta, counts: { exam: 99999, extra: 99999, trimmed: 99999, kazanim: 99999 } } });
    if (room < 0) throw new Error(`${title}: the exam block alone is ${Math.round(-room / 1024)} KB over the ${Math.round(maxBytes / 1024)} KB limit`);
    const queues = order.map(r => extraBy.get(r.id).slice());
    const kept = new Set();
    let used = 0, total = 0, full = false;
    const totalExtras = queues.reduce((n, q) => n + q.length, 0);
    for (let round = 0; !full && total < totalExtras; round++) {
      for (const q of queues) {
        if (round >= q.length) continue;
        const cost = bytes(q[round].q) + 1;
        if (used + cost > room) { full = true; break; }
        used += cost; total++;
        kept.add(q[round].q);
      }
    }
    const extras = [];
    weighted.forEach(r => extraBy.get(r.id).filter(e => kept.has(e.q)).sort((a, b) => a.i - b.i).forEach(e => extras.push(e.q)));
    base.quiz = examQs.concat(extras);
    base.meta.counts = { exam: examQs.length, extra: extras.length, trimmed: totalExtras - extras.length, kazanim: weighted.length };
    return base;
  }

  // ---------- whole course ----------
  // One entry per exam of the sheet: { exam, n, national, notes, by: Map id -> { min, max } } where min / max
  // are the question counts the kazanım gets over the exam's scenarios (0 in a scenario that skips it).
  function examWeights(sheet) {
    return list(sheet.exams).map((exam, ei) => {
      const scs = list(exam.scenarios), by = new Map(sheet.kazanimlar.map(k => [k.id, { min: scs.length ? Infinity : 0, max: 0 }]));
      scs.forEach((sc, si) => distribution(sheet, ei, si).rows.forEach(r => {
        const w = by.get(r.id);
        w.min = Math.min(w.min, r.count);
        w.max = Math.max(w.max, r.count);
      }));
      return { exam: exam.exam, n: scs.length, national: !scs.length, notes: str(exam.notes), by };
    });
  }
  const range = w => (w.min === w.max ? `${w.max}` : `${w.min}–${w.max}`);

  function courseSummary(sheet, weights, bank, counts) {
    const lines = [
      `${sheet.subject} ${sheet.grade}. sınıf · bütün ders (MEB ${sheet.schoolYear} Konu Soru Dağılım Tablosu).`,
      `Bu defterde dersin tüm ${counts.kazanim} kazanımının notu, ${counts.cards} kart ve ${counts.questions} soru var; sorular kazanıma göre gruplanmıştır (“Konu: …”).${counts.trimmed ? ` Defter boyutu sınırı nedeniyle bankadaki ${counts.questions + counts.trimmed} sorudan ${counts.trimmed} ek soru çıkarıldı.` : ''}`
    ];
    const bs = str(bank.summary).trim();
    if (bs) lines.push('', 'Ders özeti:', bs);
    weights.forEach(w => {
      lines.push('', w.national
        ? `${w.exam}: MEB konuları yayımladı ama soru sayılarını henüz yayımlamadı; bu yüzden tüm dersi çalış.${w.notes ? ' ' + w.notes : ''}`
        : `${w.exam}: ${w.n} senaryo. Kazanım başına soru sayısı (senaryolar arasında en az–en çok):`);
      if (w.national) return;
      let unit = null;
      sheet.kazanimlar.forEach(k => {
        if (k.unit !== unit) { unit = k.unit; lines.push(`${str(unit) || '-'}:`); }
        lines.push(`- ${k.code} · ${label(k)}: ${range(w.by.get(k.id))} soru`);
      });
    });
    return lines.join('\n');
  }

  function courseTableText(sheet, weights) {
    const exams = weights.filter(w => !w.national);
    return [
      `MEB ${sheet.schoolYear} Konu Soru Dağılım Tablosu · ${sheet.subject} · ${str(sheet.course) || sheet.grade + '. sınıf'}${sheet.variant ? ' (' + sheet.variant + ')' : ''}`,
      `${sheet.kazanimlar.length} kazanım · ${weights.map(w => w.national ? `${w.exam} (soru sayıları yayımlanmadı)` : `${w.exam} (${w.n} senaryo)`).join(' · ')}`,
      '', 'Ünite | Kazanım kodu | Konu | Öğrenme çıktısı' + exams.map(w => ' | ' + w.exam + ' (en az–en çok)').join(''),
      ...sheet.kazanimlar.map(k => [str(k.unit) || '-', k.code, str(k.topic) || '-', str(k.outcome).replace(/\s+/g, ' ').trim(), ...exams.map(w => range(w.by.get(k.id)))].join(' | ')),
      sheet.sourceUrl ? '\nKaynak: ' + sheet.sourceUrl : ''
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  }

  // The whole course as one notebook: every kazanım of the sheet (notes in table = unit / code order, each
  // with its examTip), all cards, ALL bank questions grouped by kazanım (category "Konu: <topic>") and the
  // bank's mind map, common mistakes and tips. The summary says which exams weigh which kazanım.
  // sheet = a spec sheet with the file's fields copied on (withFile). opts: { maxBytes } as in compose.
  // Over the limit, only extras go: every kazanım keeps as many questions as its biggest scenario asks
  // (at least one, a seeded mixed-difficulty pick); the rest are dropped one per kazanım per round, the
  // lowest-weight kazanım first, until the notebook fits. meta.counts.trimmed says how many were dropped.
  function composeCourse(bank, sheet, opts) {
    const o = opts || {};
    const maxBytes = o.maxBytes == null ? MAX_BYTES : o.maxBytes;
    validateBank(bank, sheet);
    const byId = new Map(bank.kazanimlar.map(k => [k.id, k]));
    const weights = examWeights(sheet);
    const max = maxCounts(sheet);

    const pools = sheet.kazanimlar.map(k => {
      const pool = list(byId.get(k.id).questions);
      const rand = rng(seedOf([sheet.fileId, sheet.sheet, 'course', k.id].join('|')));
      const { chosen } = pickIndices(pool, Math.min(pool.length, Math.max(1, max[k.id] || 0)), rand);
      return { k, pool, core: new Set(chosen) };
    });
    // Drop order: one extra per kazanım per round, lowest weight first, the last pool question first.
    const rank = pools.slice().sort((a, b) => (max[a.k.id] || 0) - (max[b.k.id] || 0) || sheet.kazanimlar.indexOf(b.k) - sheet.kazanimlar.indexOf(a.k));
    const left = new Map(pools.map(p => [p, p.pool.map((q, i) => i).filter(i => !p.core.has(i))]));
    const order = [];
    for (let more = true; more;) {
      more = false;
      rank.forEach(p => { const l = left.get(p); if (l.length) { order.push([p, l.pop()]); more = true; } });
    }

    const cards = [];
    sheet.kazanimlar.forEach(k => list(byId.get(k.id).cards).forEach(c => cards.push({ ...c, category: label(k) })));
    const sections = sheet.kazanimlar.map(k => {
      const n = byId.get(k.id).note;
      const content = [`Ünite: ${str(k.unit) || '-'}`, `Kazanım: ${str(k.outcome).trim()}`];
      const asked = weights.filter(w => !w.national && w.by.get(k.id).max).map(w => `${w.exam} ${range(w.by.get(k.id))} soru`);
      if (asked.length) content.push('Sınavlarda: ' + asked.join('; ') + '.');
      content.push('', n.content.trim());
      if (str(n.example).trim()) content.push('', 'Örnek: ' + n.example.trim());
      if (str(n.examTip).trim()) content.push('', 'Sınavda nasıl sorulur: ' + n.examTip.trim());
      return { title: `${k.code} · ${str(n.title).trim() || label(k)}`, content: content.join('\n'), bulletPoints: list(n.bulletPoints).filter(x => typeof x === 'string'), keyTerms: list(n.keyTerms) };
    });
    const tips = list(bank.studyTips).filter(x => typeof x === 'string');
    if (tips.length) sections.push({ title: 'Çalışma ipuçları', content: '', bulletPoints: tips, keyTerms: [] });

    const title = `${sheet.subject} ${sheet.grade} · Tüm konular · Bütün ders`;
    // dropped = how many of `order` are left out.
    const assemble = dropped => {
      const gone = new Set(order.slice(0, dropped).map(([p, i]) => p.pool[i]));
      const quiz = [];
      pools.forEach(p => p.pool.forEach(q => { if (!gone.has(q)) quiz.push({ ...q, category: 'Konu: ' + label(p.k) }); }));
      const counts = { kazanim: sheet.kazanimlar.length, cards: cards.length, questions: quiz.length, trimmed: dropped };
      return {
        title,
        notes: {
          summary: courseSummary(sheet, weights, bank, counts),
          sections,
          commonMistakes: list(bank.commonMistakes).filter(x => typeof x === 'string'),
          ...(bank.mindmap ? { mindmap: bank.mindmap } : {})
        },
        flashcards: cards,
        quiz,
        sources: [{ id: 'tablo', name: `Konu soru dağılım tablosu · ${sheet.subject} ${sheet.grade}. sınıf`, kind: 'paste', text: courseTableText(sheet, weights), enabled: true, addedAt: 0 }],
        meta: {
          kind: 'course', fileId: sheet.fileId, bank: str(bank.meta && bank.meta.bank), sheet: sheet.sheet,
          subject: sheet.subject, grade: sheet.grade, schoolYear: sheet.schoolYear || YEAR, counts,
          ...(sheet.sourceUrl ? { sourceUrl: sheet.sourceUrl } : {})
        }
      };
    };
    if (bytes(assemble(order.length)) > maxBytes) throw new Error(`${title}: notes, cards and the questions scenarios can ask are ${Math.round(bytes(assemble(order.length)) / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB limit`);
    let lo = 0, hi = order.length;   // fewest drops that fit
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bytes(assemble(mid)) <= maxBytes) hi = mid; else lo = mid + 1; }
    return assemble(lo);
  }

  return { compose, composeCourse, examWeights, validateSpec, validateBank, questionOk, distribution, profileTopics, maxCounts, label, withFile, pickScenario, pickIndices, split, seedOf, YEAR, MAX_BYTES };
})();
