// Builds data/meb/index.json and data/meb/topics.json from the downloaded MEB
// manifests. Metadata only: every entry points at the ORIGINAL official URL,
// no PDF is copied into the repo.
//
//   node scripts/build-meb-index.mjs <meb-data-dir> [out-dir] [--sets <sets-dir>]
//
// <meb-data-dir> must contain ods/manifest.json, ods/manifest2.json and
// ogm/manifest.json; ogm/yazili/manifest.json (OGM "Yazılıya Hazırlanıyorum"
// sample written exams) and ogm/kazanim/manifest.json (Kazanım Kavrama
// activities) and ogm/kazanim-bazli/manifest.json (Kazanım Bazlı Kazanım Kavrama
// Etkinlikleri, one record per outcome) are read when present. out-dir defaults
// to data/meb in this repo.
// --sets <sets-dir>: <sets-dir>/<id>.json are the ready-made study sets (see
// js/mebsets.js). An entry that has one gets set:1, sz (file size, KB) and
// nc / nq / ns (cards, questions, note sections) counted from the set itself;
// a file whose id is not in the index, or that is not a valid set, throws.
// <id>.alias.json ({"alias":"<primaryId>","version":"B"}) marks an edition that
// shares another entry's set: it gets set:1, alias:<primaryId>, ver and the
// primary's counts; the primary must be a full set in the same directory.
// Without --sets the entries carry none of these fields.
// OGM yazılı / kazanım records ({grade, course, title, url, localFile, sizeBytes})
// become x 'ogm-yazili' / 'ogm-kazanim' with the stated grade and subject and no
// year (the site states none). Their id is the first 8 hex of the sha1 of the
// pdf file name (basename of localFile), not of the URL; a record without a
// public url is skipped and listed in stats.noPublicUrl. The kazanım-bazlı records
// (grade from gradeNo, file addresses in fileUrls, several outcomes may share one
// file) give one 'ogm-kazanim-bazli' entry per distinct file address, titled with
// the first record's activity.
// MEBİ (mebi.eba.gov.tr) is deliberately NOT read: its two public calendars sit
// under a path robots.txt disallows, and the rest needs a student login, so the
// app only links to the site.
//
// ---- What is kept / dropped -------------------------------------------------
//  * dropped: status failed|blocked (manifest2), personnel/driver/civil-servant
//    exams (PERSONNEL_RE), entries without a URL. A non-MEB host throws.
//  * deduped by URL (final URL after redirects when known; manifest2 wins).
//  * x (exam type) comes from the manifest's own examType, mapped by TYPES.
//
// ---- Grade / subject inference: names only, never guessed -------------------
// The manifests' own `grades` / `subject` fields are NOT trusted: grades holds
// "all" for most files, session numbers for Açık öğretim (1,2,3), and 1 for a
// file named 11sinifB; subject is a coarse bucket ("Sosyal / Tarih-Cografya"
// on an exam calendar). They are ignored. Only these explicit rules apply, and
// anything they do not cover stays unknown (g = [], s = ''):
//   konu-soru PDF   <subj><grade>[_n].pdf   cog9 -> Coğrafya 9, fiz11 -> Fizik 11
//                   (subject tokens in KONU_SUBJECTS, grade must be 5..12; the
//                   row title must not name a different subject, else both are
//                   dropped). Names such as turkce2.xlsx / ankmeb4 / cydem_ing5_2
//                   carry no reliable grade: left unknown.
//   lise tekrar     <grade>_<subj>_<n>.pdf   11_fiz_3 -> Fizik 11 (grade 9..12,
//   testleri        subject tokens in TEKRAR_SUBJECTS; "sos" is ambiguous
//                   Sosyoloji/Sosyal Bilgiler so only its grade is kept)
//   bursluluk       <a>[_<b>]_sinif   5_sinifA -> [5], 9_10sinifB -> [9,10]
//   ortak yazılı    <grade>S_/<grade>M-/<grade>_ prefix (7S_Turkce..., 10_mat_...),
//                   grade 5..12 without leading zero; subject only from the
//                   words turkce/tde/mat/matematik
//   any entry       title or page title starting "N.Sınıf" -> [N]
//   LGS             [8] (it is the 8th-grade exam); sözel/sayısal from the
//                   file name -> s 'LGS Sözel' / 'LGS Sayısal' (the two LGS sections,
//                   not curriculum subjects)
//   YKS/YDT books   grade [11,12] (the site lists them as "YKS (11-12)"); subject
//                   from the book's own subject field when it is a plain
//                   subject, 'İngilizce' for the YDT books
//   everything else (Açık öğretim, Dört beceri, kılavuz, takvim) -> unknown
// An entry that is still without a grade afterwards gets one from facts the
// source itself states: a konu-soru PDF/workbook from the sheet names of its
// tables ("9. SINIF", "5. sınıf" -> [9] / [5]; one grade per table), else from
// the grade list of its own study set (meta.grade: ints, numeric strings or a
// level label such as "Açık Lise 9-12"). Unreadable meta.grade throws; a set
// without one leaves the grade unknown.
//
// ---- topics.json ------------------------------------------------------------
// A konu-soru PDF holds one table per exam scenario (up to ~30). Shipping every
// table takes ~1 MB because kazanım texts are long, so each PDF is aggregated:
// rows = [topic, mean question count per table], over its n readable tables
// (tables with <2 usable rows, e.g. a lone subject total, are dropped; header
// fragments shorter than 14 chars with no digit are dropped; topic text is cut
// at 150 chars; at most 30 rows, heaviest first - PastPaper.normalizeTopics
// keeps 30 anyway).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TR = 'tr';
const MB = 1048576;

export const TYPES = {
  'LGS': 'lgs',
  'Bursluluk (IOKBS)': 'bursluluk',
  'Ortak Yazili Sinav': 'ortak',
  'Ortak Yazili - Konu Soru Dagilim': 'konu',
  'Acik Ogretim': 'acik',
  'Sinif Ici Olcme / Destek Materyal': 'sinif',
  'Ortak Yazili - Kilavuz': 'kilavuz',
  'Sinav Takvimi': 'kilavuz',
  'Dort Beceride Turkce Dil Sinavi': 'dort-beceri'
};
const OGM_PREP = { 'ogm-yazili': 'https://ogmmateryal.eba.gov.tr/yaziliya-hazirlaniyorum', 'ogm-kazanim': '', 'ogm-kazanim-bazli': 'https://ogmmateryal.eba.gov.tr/kazanim-bazli-kazanim-kavrama-etkinlikleri' };
const TYPE_LABEL = { lgs: 'LGS', bursluluk: 'Bursluluk (İOKBS)', ortak: 'Ortak yazılı', acik: 'Açık öğretim' };

const TDE = 'Türkçe / Edebiyat';
const KONU_SUBJECTS = {
  turk: TDE, tde: TDE, mat: 'Matematik', fen: 'Fen Bilimleri', sos: 'Sosyal Bilgiler', dkab: 'Din Kültürü',
  ita: 'İnkılap Tarihi', ing: 'İngilizce', ingg: 'İngilizce', fiz: 'Fizik', kim: 'Kimya', biyo: 'Biyoloji',
  cog: 'Coğrafya', tar: 'Tarih', fel: 'Felsefe'
};
const TEKRAR_SUBJECTS = {
  tde: TDE, mat: 'Matematik', fiz: 'Fizik', kim: 'Kimya', biyo: 'Biyoloji', cog: 'Coğrafya', tar: 'Tarih',
  din: 'Din Kültürü', fel: 'Felsefe', psi: 'Psikoloji', man: 'Mantık'
};
const WORD_SUBJECTS = { turkce: TDE, matematik: 'Matematik', hayatbilgisi: 'Hayat Bilgisi', fenbilimleri: 'Fen Bilimleri', sosyalbilgiler: 'Sosyal Bilgiler' };
// What a manifest row title may say about its subject (used only to veto a file-name guess).
const TITLE_SUBJECTS = [
  [/t[üu]rk[çc]e|t[üu]rk dili/i, TDE], [/matematik/i, 'Matematik'], [/fen bilimleri/i, 'Fen Bilimleri'],
  [/sosyal bilgiler/i, 'Sosyal Bilgiler'], [/din k[üu]lt/i, 'Din Kültürü'], [/ink[ıi]lap/i, 'İnkılap Tarihi'],
  [/ingilizce/i, 'İngilizce'], [/fizik/i, 'Fizik'], [/kimya/i, 'Kimya'], [/biyoloji/i, 'Biyoloji'],
  [/co[ğg]rafya/i, 'Coğrafya'], [/tarih/i, 'Tarih'], [/felsefe/i, 'Felsefe']
];
const OGM_SUBJECTS = {
  'Biyoloji': 'Biyoloji', 'Coğrafya': 'Coğrafya', 'Felsefe': 'Felsefe', 'Felsefe Grubu': 'Felsefe Grubu', 'Fizik': 'Fizik',
  'Kimya': 'Kimya', 'Matematik': 'Matematik', 'Tarih': 'Tarih', 'Türkçe': TDE, 'Türk Dili ve Edebiyatı': TDE, 'İngilizce': 'İngilizce'
};

const PERSONNEL_RE = /personel|s[üu]r[üu]c[üu]|şoför|sofor|ehliyet|memur|g[öo]revde\s+y[üu]kselme|[üu]nvan|mebbis|y[öo]netici\s+atama/i;
const HOST_RE = /(^|\.)(meb\.gov\.tr|eba\.gov\.tr)$/;

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const fold = s => clean(s).toLocaleLowerCase(TR).replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
const sha = u => crypto.createHash('sha1').update(u).digest('hex').slice(0, 8);

function stemOf(url) {
  const last = new URL(url).pathname.split('/').pop();
  const dec = decodeURIComponent(last);
  return dec.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/^(?:[0-9a-f]{14,}|\d{6,8})_/i, '');
}
const gradeOk = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

// Sorted grades from a set's meta.grade; [] when it states none.
export function setGrades(meta, id) {
  const raw = meta && meta.grade;
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`${id}.json: meta.grade is not a list`);
  const out = new Set();
  for (const v of raw) {
    const t = clean(v), range = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    const [a, b] = /^\d{1,2}$/.test(t) ? [+t, +t] : range ? [+range[1], +range[2]] : [NaN, NaN];
    if (!gradeOk(a, 1, 12) || !gradeOk(b, a, 12)) throw new Error(`${id}.json: cannot read meta.grade value "${t}"`);
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

// Grades named by the sheets of a konu-soru workbook's tables ("9. SINIF", "12. sınıf T.C. ...").
function sheetGrades(tables) {
  const out = new Set();
  for (const t of tables || []) {
    const m = fold(t && t.sheet).match(/^(\d{1,2})\s*\.?\s*sinif/);
    if (m && gradeOk(+m[1], 1, 12)) out.add(+m[1]);
  }
  return [...out].sort((x, y) => x - y);
}

// Edition B of a set: its booklet letter replaces the primary's ("A Kitapçığı" -> "B Kitapçığı"), else (B) is appended.
const versioned = (title, v) => (/A Kitapçığı/.test(title) ? title.replace(/A Kitapçığı/, v + ' Kitapçığı') : title + ' (' + v + ')');

// Subject of an entry from its study set's meta.subject: only a plain, known subject counts
// ("Çoklu ders", "Karma (tüm dersler)" stay blank).
function setSubject(meta) {
  const f = fold(meta && meta.subject);
  if (f === 'turkce' || f === 'turk dili ve edebiyati') return TDE;
  if (f === 'sozel') return 'LGS Sözel';
  if (f === 'sayisal') return 'LGS Sayısal';
  if (/^din kulturu/.test(f)) return 'Din Kültürü';
  return [...Object.values(KONU_SUBJECTS), ...Object.values(TEKRAR_SUBJECTS), 'Sosyoloji', 'Hayat Bilgisi'].find(v => fold(v) === f) || '';
}

// School year a file was published in, from its CDN folder (.../2022/01/x.pdf: Sep-Dec starts a year, Jan-Aug ends one); '' without a folder.
function yearOfUrl(url) {
  const m = new URL(url).pathname.match(/\/(\d{4})\/(\d{2})\//);
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  const y = +m[1];
  return +m[2] >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// grade array + subject for one record, by the rules documented above.
export function infer(rec, x, stem) {
  const pageTitle = clean(rec.pageTitle), title = clean(rec.title);
  let g = [], s = '', stemGrade = 0;
  const low = stem.toLowerCase();
  if (x === 'konu') {
    const m = low.match(/^([a-z]+)(\d{1,2})(?:_\d+)?$/);
    if (m && KONU_SUBJECTS[m[1]] && gradeOk(+m[2], 5, 12)) { g = [+m[2]]; s = KONU_SUBJECTS[m[1]]; }
    // cydem_ing5_2, turk7meb: the publisher files state the grade right after the subject.
    const pub = low.match(/^cydem_(ing|almanca)(\d)_\d$/) || low.match(/^(turk)(\d)(?:meb|hecce|ozgun)(?:_\d)?$/);
    if (pub && gradeOk(+pub[2], 5, 8)) g = [+pub[2]];
    const named = [...new Set(TITLE_SUBJECTS.filter(([re]) => re.test(fold(title))).map(([, v]) => v))];
    if (s && named.length && !named.includes(s)) { g = []; s = ''; }
    else if (!s && named.length === 1) s = named[0];
  } else if (x === 'sinif') {
    const m = low.match(/^(\d{1,2})_([a-z]+)_/);
    if (m && TEKRAR_SUBJECTS[m[2]] && gradeOk(+m[1], 9, 12)) { g = [+m[1]]; s = TEKRAR_SUBJECTS[m[2]]; }
    else if (m && m[2] === 'sos' && gradeOk(+m[1], 9, 12)) { g = [+m[1]]; s = 'Sosyoloji'; }   // the lise Tekrar Testi PDFs are Sosyoloji
    else {
      s = WORD_SUBJECTS[low.replace(/[^a-z]/g, '')] || '';
      const w = low.match(/^[a-z]+(\d)$/);
      if (s && w) stemGrade = +w[1];   // matematik1, hayatbilgisi3: used only when the title states no grade
    }
  } else if (x === 'bursluluk') {
    const m = low.match(/^(\d{1,2})(?:_(\d{1,2}))?_?sinif/);
    if (m) {
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (gradeOk(a, 1, 12) && gradeOk(b, a, 12) && b - a <= 1) g = a === b ? [a] : [a, b];
    }
  } else if (x === 'ortak') {
    const m = low.match(/^([1-9]\d?)(?:s|m|mat)?(?:[_-]|$)/);
    if (m && gradeOk(+m[1], 5, 12)) g = [+m[1]];
    const toks = low.split(/[_\-\s.]+/);
    if (toks.includes('turkce') || toks.includes('tde')) s = TDE;
    else if (toks.some(t => t === 'mat' || t === 'matematik' || /^\d+mat$/.test(t))) s = 'Matematik';
  } else if (x === 'lgs') {
    g = [8];
    if (/sozel/i.test(stem)) s = 'LGS Sözel'; else if (/sayisal/i.test(stem)) s = 'LGS Sayısal';
  }
  if (!g.length) {
    const m = (title + ' ' + pageTitle).match(/(?:^|\s)(\d{1,2})\s*\.\s*s[ıi]n[ıi]f/i);
    if (m && gradeOk(+m[1], 1, 12)) g = [+m[1]];
  }
  if (!g.length && gradeOk(stemGrade, 1, 8)) g = [stemGrade];
  return { g, s };
}

function shorten(s, n) {
  s = clean(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n).replace(/\s+\S*$/, '');
  return (cut || s.slice(0, n)) + '…';
}
const termOf = pageTitle => { const m = clean(pageTitle).match(/(\d)\s*\.\s*d[öo]nem/i); return m ? m[1] + '. Dönem' : ''; };

// The manifests and file names drop the Turkish letters; these words get them back (whole words only).
const ACCENTS = {
  yazili: 'yazılı', sinav: 'sınav', sinavi: 'sınavı', sinavlar: 'sınavlar', sinavlari: 'sınavları', sinif: 'sınıf', siniflar: 'sınıflar',
  ogretim: 'öğretim', ogretmen: 'öğretmen', ogrenci: 'öğrenci', ogrenme: 'öğrenme', ogle: 'öğle', donem: 'dönem', ulke: 'ülke', egitim: 'eğitim',
  turkce: 'türkçe', cografya: 'coğrafya', kilavuz: 'kılavuz', kilavuzu: 'kılavuzu', sikca: 'sıkça', gecis: 'geçiş', yerlestirme: 'yerleştirme',
  ortaogretim: 'ortaöğretim', ilkogretim: 'ilköğretim', calisma: 'çalışma', sorulari: 'soruları', sayisal: 'sayısal', sozel: 'sözel',
  basvuru: 'başvuru', yili: 'yılı', kurumlari: 'kurumları', inkilap: 'inkılap', degerlendirme: 'değerlendirme', olcme: 'ölçme', kitabi: 'kitabı',
  fasikulleri: 'fasikülleri', surec: 'süreç', hazirlik: 'hazırlık', aralik: 'aralık', yerlesme: 'yerleşme', ogretmenegitimi: 'öğretmen eğitimi'
};
const STEM_TITLES = [[/OrtaoYgYretime/, '2025 Ortaöğretime Geçiş Tercih ve Yerleştirme Kılavuzu']];   // a broken PDF file name
const LETTER = 'A-Za-zÇĞİÖŞÜçğıöşüÂâ';
function accent(str) {
  return str.replace(new RegExp('(?<![' + LETTER + '])[A-Za-z]+(?![' + LETTER + '])', 'g'), w => {
    const to = ACCENTS[w.toLowerCase()];
    if (!to) return w;
    return w === w.toUpperCase() && w.length > 1 ? to.toLocaleUpperCase(TR) : w[0] === w[0].toUpperCase() ? to[0].toLocaleUpperCase(TR) + to.slice(1) : to;
  });
}

function titleFor(rec, x, g, s, stem) {
  const pageTitle = clean(rec.pageTitle);
  let base = clean(rec.title).replace(/\s*-\s*$/, '');
  let tail = '';
  const kt = x === 'konu' && base.match(/^\d\.\s*Donem Konu Soru Dagilim Tablosu \d{4}-\d{4}\s*-\s*(.+)$/i);
  if (kt) base = kt[1];
  if (x === 'ortak' && /mazeret/i.test(pageTitle)) base += ' (mazeret)';
  if (x === 'lgs' || !base || fold(base) === fold(pageTitle) || (TYPE_LABEL[x] && base.length > 60)) {
    base = TYPE_LABEL[x] ? TYPE_LABEL[x] + (rec.schoolYear ? ' ' + rec.schoolYear : '') : shorten(pageTitle, 70);
    tail = stem.replace(/_+/g, ' ').trim();
    const fix = STEM_TITLES.find(([re]) => re.test(tail));
    if (fix) tail = fix[1];
  }
  // A page heading the site itself cut with '…' is no title: the file name says more.
  if (base.includes('…')) { base = stem.replace(/_+/g, ' ').trim(); tail = ''; }
  const nb = fold(base);
  const front = [];
  if (g.length && x !== 'lgs' && !new RegExp('(^|\\D)' + g[0] + '\\s*\\.?\\s*sinif').test(nb)) front.push(g.length === 1 ? g[0] + '. sınıf' : g[0] + '–' + g[g.length - 1] + '. sınıf');
  if (s && !nb.includes(fold(s).split(/[ /]/)[0])) front.push(s);
  const term = x === 'konu' ? termOf(pageTitle) : '';
  const head = [...front, base, term].filter(Boolean).join(' · ');
  return shorten(accent(tail ? head + ' — ' + tail : head), 160);
}

// One decimal; anything under 0.1 MB reads as 0.1.
const sizeMb = bytes => (Number.isFinite(bytes) && bytes > 0 ? Math.max(0.1, Math.round(bytes / MB * 10) / 10) : null);

function checkUrl(u, what) {
  let url;
  try { url = new URL(u); } catch { throw new Error(`${what}: invalid URL ${u}`); }
  if (url.protocol !== 'https:' || !HOST_RE.test(url.hostname)) throw new Error(`${what}: not an official MEB/EBA https URL: ${u}`);
  return url.href;
}

function ogmSubject(r) {
  if (/^YDT/i.test(r.grade)) return 'İngilizce';
  if (OGM_SUBJECTS[r.subject]) return OGM_SUBJECTS[r.subject];
  if (/^Din K[üu]lt/i.test(r.subject)) return 'Din Kültürü';
  return '';
}
function ogmTitle(r) {
  const parts = clean(r.title).split(' | ');
  return shorten(parts.slice(1).join(' · ') || clean(r.title), 160);
}

const TOPIC_MAX = 150, ROWS_MAX = 30;
function cleanRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const name = clean(r && r.topic);
    const count = Number(r && r.count);
    if (!name || !(count > 0)) continue;
    if (name.length < 14 && !/\d/.test(name)) continue; // table header fragments
    out.push([shorten(name, TOPIC_MAX), count]);
  }
  return out;
}
function aggregateTopics(tables) {
  const kept = (tables || []).map(t => cleanRows(t && t.rows)).filter(r => r.length >= 2);
  if (!kept.length) return null;
  const sum = new Map();
  for (const rows of kept) {
    const seen = new Map();
    rows.forEach(([n, c]) => seen.set(n, (seen.get(n) || 0) + c));
    seen.forEach((c, n) => sum.set(n, (sum.get(n) || 0) + c));
  }
  const rows = [...sum].map(([n, c]) => [n, Math.max(0.01, Math.round(c / kept.length * 100) / 100)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], TR)).slice(0, ROWS_MAX);
  return { n: kept.length, rows };
}

// ---- identical titles ---------------------------------------------------------
// Two entries of one type + grade + subject never share a title. The first of an
// identical group keeps the plain title; the rest are told apart by
//   ogm-kazanim-bazli  the unit name (rec.unit) when the group's units differ, else (2), (3) in file order
//   everything else    the words of the file name that the group does not share (Sabah, Öğle,
//                      lise, ortaokul, A, B...), else (2), (3) in file order
// An opaque file stem is never printed.
const FRIENDLY = {
  sabah: 'Sabah', ogle: 'Öğle', maz: 'Mazeret', mazeret: 'Mazeret', cevap: 'Cevap', cvp: 'Cevap', cev: 'Cevap',
  lise: 'Lise', ortaokul: 'Ortaokul', ilkokul: 'İlkokul', oturum: 'Oturum', ogretmen: 'Öğretmen', ogrenci: 'Öğrenci'
};
const wordsOf = stem => stem.split(/[_\-\s.()]+/).filter(Boolean).flatMap(tok => {
  // random-looking stems (letters, digit, letters, digit...) carry no words
  if (/\d[a-z]+\d/i.test(tok) && /^[a-z0-9]{8,}$/i.test(tok)) return [];
  return tok.match(/[A-Za-zÇĞİÖŞÜçğıöşü]+|\d+/g) || [];
});
const wordKey = w => fold(w);
const wordText = w => FRIENDLY[wordKey(w)] || (/^\d/.test(w) ? w : w[0].toLocaleUpperCase(TR) + w.slice(1).toLocaleLowerCase(TR));

function labelsFor(group, extra) {
  const kz = group[0].x === 'ogm-kazanim-bazli';
  if (kz) {
    const units = group.map(r => extra.get(r.id).unit);
    return units.every(Boolean) && new Set(units).size > 1 ? units : group.map(() => '');
  }
  const words = group.map(r => wordsOf(extra.get(r.id).stem));
  const shared = words[0].filter(w => words.every(ws => ws.some(v => wordKey(v) === wordKey(w)))).map(wordKey);
  return words.map(ws => {
    const own = [...new Map(ws.filter(w => !shared.includes(wordKey(w))).map(w => [wordKey(w), w])).values()];
    return own.filter(w => /^[^\d]+$/.test(w)).map(wordText).join(' ');   // bare numbers (5, 01) say nothing: ordinals instead
  });
}

// index = entries in file order; extra = Map id -> { stem, unit }.
export function disambiguate(index, extra) {
  const groups = new Map();
  index.forEach(r => {
    const k = [r.x, r.g.join(','), r.s, r.t].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const base = group[0].t, labels = labelsFor(group, extra), used = new Set();
    group.forEach((r, i) => {
      const head = labels[i] ? shorten(base, 160 - labels[i].length - 4) +' — ' + labels[i] : base;
      let t = head;
      for (let n = 2; used.has(t); n++) t = shorten(head, 160 - 6) + ' (' + n + ')';
      used.add(t);
      r.t = t;
    });
  }
  const seen = new Set();
  index.forEach(r => {
    const k = [r.x, r.g.join(','), r.s, r.t].join('|');
    if (seen.has(k)) throw new Error('title is still not unique: ' + r.t);
    seen.add(k);
  });
}

const ORDER = ['lgs', 'bursluluk', 'ortak', 'konu', 'yks', 'acik', 'sinif', 'kilavuz', 'dort-beceri', 'ogm-yazili', 'ogm-kazanim', 'ogm-kazanim-bazli'];

// OGM yazılı / kazanım record -> entry fields (id comes from the pdf file name).
function ogmPrep(rec, x) {
  const what = x + ' ' + clean(rec.title || rec.activityTitle);
  if (!rec.localFile) throw new Error(what + ': missing localFile (the id comes from the pdf file name)');
  // The kazanım manifest writes the grade as '9. Sinif' and the course without Turkish letters.
  const grade = x === 'ogm-kazanim-bazli' ? rec.gradeNo : typeof rec.grade === 'number' ? rec.grade : /^\d{1,2}\.\s*S[iıİI]n[iıİI]f$/i.test(clean(rec.grade)) ? parseInt(rec.grade, 10) : NaN;
  if (!gradeOk(grade, 1, 12)) throw new Error(what + ': bad grade ' + rec.grade);
  const subject = OGM_SUBJECTS[rec.course] || Object.entries(OGM_SUBJECTS).find(([k]) => fold(k) === fold(rec.course))?.[1];
  if (!subject) throw new Error(what + ': unknown course ' + rec.course);
  const id = crypto.createHash('sha1').update(path.win32.basename(rec.localFile)).digest('hex').slice(0, 8);
  // The kazanım manifest titles are ASCII; the page labels grades 9 and 10 as the 2017-2023 curriculum.
  if (x === 'ogm-kazanim-bazli' && !clean(rec.activityTitle)) throw new Error(what + ': missing activityTitle');
  const t = x === 'ogm-kazanim-bazli'
    ? shorten(`${grade}. Sınıf ${subject} - ${clean(rec.activityTitle)}${grade <= 10 ? ' (2017-2023 müfredatı)' : ''}`, 160)
    : x === 'ogm-kazanim'
    ? `${grade}. Sınıf ${subject} - Kazanım Kavrama Etkileşimli Kitap${grade <= 10 ? ' (2017-2023 müfredatı)' : ''}`
    : shorten(rec.title, 160);
  return { id, g: [grade], s: subject, t, p: rec.sourceUrl ? checkUrl(rec.sourceUrl, x + ' sourceUrl') : OGM_PREP[x] };
}

// Pure: manifests in, { index, topics, stats } out.
// sets (optional) = the readSets map: an entry without a grade takes its set's grade list.
export function build({ ods1 = [], ods2 = [], ogm = [], ogmYazili = [], ogmKazanim = [], ogmKazanimBazli = [], sets = new Map() }) {
  const stats = { excluded: { status: 0, personnel: 0, noUrl: 0, dup: 0 }, noPublicUrl: [] };
  const byUrl = new Map();
  const alias = new Map();
  const add = (rec, src, url, x) => {
    if (byUrl.has(url)) { stats.excluded.dup++; return; }
    byUrl.set(url, { rec, src, url, x });
  };
  const ods = (rec, fromTwo) => {
    const raw = rec.finalUrl || rec.fileUrl;
    if (!raw) { stats.excluded.noUrl++; return; }
    if (fromTwo && /^(failed|blocked)$/i.test(rec.status || '')) { stats.excluded.status++; return; }
    if (PERSONNEL_RE.test([rec.title, rec.pageTitle, raw].join(' '))) { stats.excluded.personnel++; return; }
    const x = TYPES[rec.examType];
    if (!x) throw new Error('unknown examType: ' + rec.examType);
    const url = checkUrl(raw, 'ods');
    if (rec.fileUrl && rec.finalUrl) alias.set(rec.fileUrl, url);
    add(rec, 'ods', url, x);
  };
  const dead = new Set();
  ods2.forEach(r => { if (/^(failed|blocked)$/i.test(r.status || '')) [r.fileUrl, r.finalUrl].forEach(u => u && dead.add(u)); });
  ods2.forEach(r => ods(r, true));
  // manifest 1 only adds what manifest 2 does not cover (short links resolve via alias)
  ods1.forEach(r => {
    if (r.fileUrl && dead.has(r.fileUrl)) { stats.excluded.status++; return; }
    if (r.fileUrl && alias.has(r.fileUrl)) { stats.excluded.dup++; return; }
    ods(r, false);
  });
  ogm.forEach(r => {
    if (!r.fileUrl) { stats.excluded.noUrl++; return; }
    if (PERSONNEL_RE.test([r.title, r.fileUrl].join(' '))) { stats.excluded.personnel++; return; }
    add(r, 'ogm', checkUrl(r.fileUrl, 'ogm'), 'yks');
  });

  [['ogm-yazili', ogmYazili], ['ogm-kazanim', ogmKazanim]].forEach(([x, recs]) => recs.forEach(r => {
    // The yazılı manifest names the file address `url`, the kazanım one `fileUrl`.
    const raw = r.url || r.fileUrl;
    if (!raw) { stats.noPublicUrl.push(x + ': ' + clean(r.title)); return; }
    add(r, 'ogm', checkUrl(raw, x), x);
  }));

  // The kazanım-bazlı manifest lists the file addresses in fileUrls; several records can point at one file.
  ogmKazanimBazli.forEach(r => {
    if (!Array.isArray(r.fileUrls)) throw new Error('ogm-kazanim-bazli ' + clean(r.activityTitle) + ': fileUrls is not an array');
    if (!r.fileUrls.length) stats.noPublicUrl.push('ogm-kazanim-bazli: ' + clean(r.activityTitle));
    r.fileUrls.forEach(u => add(r, 'ogm', checkUrl(u, 'ogm-kazanim-bazli'), 'ogm-kazanim-bazli'));
  });

  const index = [], topicsOut = [], ids = new Map(), extra = new Map();
  for (const { rec, src, url, x } of byUrl.values()) {
    const prep = x.startsWith('ogm-') ? ogmPrep(rec, x) : null;
    const id = prep ? prep.id : sha(url);
    if (ids.has(id)) throw new Error(`id collision ${id}: ${url} / ${ids.get(id)}`);
    ids.set(id, url);
    const stem = stemOf(url);
    let g, s, t, y, p;
    if (prep) {
      ({ g, s, t, p } = prep); y = '';
    } else if (src === 'ogm') {
      g = [11, 12]; s = ogmSubject(rec); t = ogmTitle(rec); y = ''; p = rec.sourceUrl ? checkUrl(rec.sourceUrl, 'ogm sourceUrl') : '';
    } else {
      ({ g, s } = infer(rec, x, stem));
      if (!g.length && x === 'konu') g = sheetGrades(rec.topicDistribution);
      const own = sets.get(id), primary = own && (own.alias ? sets.get(own.alias) : own);
      if (own && (!primary || !primary.data)) throw new Error(`${id}: alias target ${own.alias} is not in the sets directory`);
      const meta = primary && primary.data.meta;
      if (!g.length && own) g = setGrades(meta, own.alias || id);
      if (!s && own) s = setSubject(meta);
      t = titleFor(rec, x, g, s, stem);
      // A set knows what the file is (session, mazeret, kitapçık); the file name often does not.
      if (own && TYPE_LABEL[x] && clean(primary.data.title)) t = shorten(own.alias && own.version ? versioned(clean(primary.data.title), own.version) : clean(primary.data.title), 160);
      // sinif files carry the manifest's current school year, not the year they were published: take it from the URL folder.
      y = x === 'sinif' ? yearOfUrl(url) : /^\d{4}-\d{4}$/.test(rec.schoolYear || '') ? rec.schoolYear : '';
      p = rec.sourcePage && !/\/icerik\/0$/.test(rec.sourcePage) ? checkUrl(rec.sourcePage, 'ods sourcePage') : '';   // /icerik/0 is a dead page
    }
    index.push({ id, t, g, s, x, y, u: url, p, mb: sizeMb(rec.sizeBytes), src });
    extra.set(id, { stem, unit: clean(rec.unit) });
    if (x === 'konu' && Array.isArray(rec.topicDistribution)) {
      const agg = aggregateTopics(rec.topicDistribution);
      if (agg) topicsOut.push({ id, g, s, term: termOf(rec.pageTitle), n: agg.n, rows: agg.rows });
    }
  }
  disambiguate(index, extra);
  const rank = r => ORDER.indexOf(r.x);
  index.sort((a, b) => rank(a) - rank(b) || b.y.localeCompare(a.y) || (a.g[0] || 99) - (b.g[0] || 99) || a.t.localeCompare(b.t, TR) || a.id.localeCompare(b.id));
  const pos = new Map(index.map((r, i) => [r.id, i]));
  topicsOut.sort((a, b) => pos.get(a.id) - pos.get(b.id));
  return { index, topics: topicsOut, stats };
}

// Pure: adds set/sz/nc/nq/ns to the entries that have a set. `sets` maps an
// entry id to { bytes, data } (data = the parsed set file).
export function attachSets(index, sets) {
  const ids = new Set(index.map(r => r.id));
  for (const id of sets.keys()) if (!ids.has(id)) throw new Error(`set file ${id}.json has no entry in the index`);
  for (const r of index) {
    const s = sets.get(r.id);
    if (!s) continue;
    if (s.alias) {
      const p = sets.get(s.alias);
      if (!p || p.alias) throw new Error(`${r.id}.alias.json: ${s.alias} is not a full set in the sets directory`);
      if (!ids.has(s.alias)) throw new Error(`${r.id}.alias.json: ${s.alias} has no entry in the index`);
      const [x] = attachSets([{ id: s.alias }], new Map([[s.alias, p]])); // validates the primary and counts it
      Object.assign(r, { set: 1, sz: x.sz, nc: x.nc, nq: x.nq, ...(x.ns != null ? { ns: x.ns } : {}) });
      r.alias = s.alias;
      if (s.version) r.ver = s.version;
      continue;
    }
    const d = s.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${r.id}.json is not a study set object`);
    if (d.meta && d.meta.fileId && d.meta.fileId !== r.id) throw new Error(`${r.id}.json: meta.fileId is ${d.meta.fileId}`);
    if (!d.notes || !Array.isArray(d.flashcards) || !Array.isArray(d.quiz)) throw new Error(`${r.id}.json: missing notes, flashcards or quiz`);
    r.set = 1;
    r.sz = Math.max(1, Math.ceil(s.bytes / 1024));
    r.nc = d.flashcards.length;
    r.nq = d.quiz.length;
    if (Array.isArray(d.notes.sections)) r.ns = d.notes.sections.length;
  }
  return index;
}

function readSets(dir) {
  const sets = new Map();
  let names;
  try { names = fs.readdirSync(dir); } catch (err) { throw new Error(`cannot read sets dir ${dir}: ${err.message}`); }
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file);
    let data;
    try { data = JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); } catch (err) { throw new Error(`${file}: ${err.message}`); }
    const m = name.match(/^(.+).alias.json$/);
    if (m) {
      if (typeof data.alias !== 'string' || !data.alias) throw new Error(`${file}: missing "alias"`);
      sets.set(m[1], { bytes: raw.length, data, alias: data.alias, version: typeof data.version === 'string' ? data.version : '' });
    } else sets.set(name.slice(0, -5), { bytes: raw.length, data });
  }
  return sets;
}

const lines = arr => '[\n' + arr.map(x => JSON.stringify(x)).join(',\n') + '\n]\n';

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { throw new Error(`cannot read ${file}: ${err.message}`); }
  const v = JSON.parse(raw.replace(/^﻿/, ''));
  if (!Array.isArray(v)) throw new Error(`${file} is not a JSON array`);
  return v;
}

const readOptional = file => (fs.existsSync(file) ? readJson(file) : []);

function main(argv) {
  const args = argv.slice();
  const si = args.indexOf('--sets');
  let setsDir = '';
  if (si >= 0) {
    setsDir = args[si + 1];
    if (!setsDir || setsDir.startsWith('--')) throw new Error('--sets needs a directory');
    args.splice(si, 2);
  }
  const [dir, outArg] = args;
  if (!dir) throw new Error('usage: node scripts/build-meb-index.mjs <meb-data-dir> [out-dir] [--sets <sets-dir>]');
  const out = path.resolve(outArg || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'meb'));
  const sets = setsDir ? readSets(setsDir) : new Map();
  const { index, topics, stats } = build({
    ods1: readJson(path.join(dir, 'ods', 'manifest.json')),
    ods2: readJson(path.join(dir, 'ods', 'manifest2.json')),
    ogm: readJson(path.join(dir, 'ogm', 'manifest.json')),
    ogmYazili: readOptional(path.join(dir, 'ogm', 'yazili', 'manifest.json')),
    ogmKazanim: readOptional(path.join(dir, 'ogm', 'kazanim', 'manifest.json')),
    ogmKazanimBazli: readOptional(path.join(dir, 'ogm', 'kazanim-bazli', 'manifest.json')),
    sets
  });
  if (setsDir) attachSets(index, sets);
  fs.mkdirSync(out, { recursive: true });
  const a = lines(index), b = lines(topics);
  fs.writeFileSync(path.join(out, 'index.json'), a);
  fs.writeFileSync(path.join(out, 'topics.json'), b);
  const by = {};
  index.forEach(r => { by[r.x] = (by[r.x] || 0) + 1; });
  console.log(`index.json  ${index.length} entries, ${(Buffer.byteLength(a) / 1024).toFixed(0)} KB`, by);
  console.log(`topics.json ${topics.length} entries, ${(Buffer.byteLength(b) / 1024).toFixed(0)} KB`);
  if (setsDir) console.log('study sets', index.filter(r => r.set).length);
  if (stats.noPublicUrl.length) console.log('skipped, no public file URL:', stats.noPublicUrl);
  console.log('excluded', stats.excluded, '| unknown grade', index.filter(r => !r.g.length).length, '| unknown subject', index.filter(r => !r.s).length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}
