// ===== Stats Module =====
// Records study activity (card reviews, exam results) and renders the Stats
// tab: streak, totals, a 14-day review bar chart, and exam history — all in
// dependency-free inline SVG.
const Stats = (() => {
  const KEY = 'flashmind_stats_v1';
  const MAX_EXAMS = 50;
  let data = null; // { days: {'YYYY-MM-DD': {reviews, gotit}}, exams: [{t, pct, grade, title}] }

  function load() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { data = null; }
    if (!data || typeof data.days !== 'object') data = { days: {}, exams: [] };
    if (!Array.isArray(data.exams)) data.exams = [];
    return data;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* non-fatal */ }
  }

  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ----- Recording -----

  function recordReview(rating) {
    load();
    const k = dayKey(Date.now());
    const day = data.days[k] || { reviews: 0, gotit: 0 };
    day.reviews += 1;
    if (rating === 'gotit') day.gotit += 1;
    data.days[k] = day;
    persist();
  }

  function recordExam(pct, grade, title) {
    load();
    data.exams.push({ t: Date.now(), pct, grade, title: title || '' });
    if (data.exams.length > MAX_EXAMS) data.exams = data.exams.slice(-MAX_EXAMS);
    persist();
  }

  // ----- Derived numbers -----

  function streak() {
    load();
    let n = 0;
    const d = new Date();
    // Today counts if studied; otherwise the streak may still be alive from
    // yesterday, so a quiet today doesn't zero it.
    if (!data.days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
    while (data.days[dayKey(d.getTime())]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function totalReviews() {
    load();
    return Object.values(data.days).reduce((s, d) => s + d.reviews, 0);
  }

  // ----- Rendering -----

  function esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function tile(value, label) {
    return `<div class="stat-tile"><span class="stat-tile-value">${value}</span><span class="stat-tile-label">${label}</span></div>`;
  }

  // Vertical bar chart of reviews for the last `days` days.
  function barChart(days) {
    load();
    const W = 560, H = 140, PAD = 4;
    const bw = (W - PAD * 2) / days;
    const series = [];
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const day = data.days[dayKey(d.getTime())];
      series.push({ n: day ? day.reviews : 0, label: (d.getMonth() + 1) + '/' + d.getDate() });
      d.setDate(d.getDate() + 1);
    }
    const max = Math.max(4, ...series.map(s => s.n));
    let bars = '';
    series.forEach((s, i) => {
      const h = s.n === 0 ? 2 : Math.max(3, (s.n / max) * (H - 34));
      const x = PAD + i * bw + bw * 0.15;
      const y = H - 22 - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="--i:${i}" class="${s.n ? 'stat-bar' : 'stat-bar empty'}"><title>${s.label}: ${s.n}</title></rect>`;
      if (s.n > 0) bars += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 5).toFixed(1)}" style="--i:${i}" class="stat-bar-num" text-anchor="middle">${s.n}</text>`;
      if (i === 0 || i === days - 1 || i === Math.floor(days / 2)) {
        bars += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 7}" class="stat-axis" text-anchor="middle">${s.label}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart" role="img">${bars}</svg>`;
  }

  // Line chart of the last exams' scores (0-100).
  function examChart(exams) {
    const W = 560, H = 140, PADX = 14, PADY = 16;
    const n = exams.length;
    if (n === 0) return '';
    const step = n > 1 ? (W - PADX * 2) / (n - 1) : 0;
    const pt = (e, i) => {
      const x = n > 1 ? PADX + i * step : W / 2;
      const y = PADY + (1 - e.pct / 100) * (H - PADY * 2);
      return [x, y];
    };
    let path = '', dots = '';
    exams.forEach((e, i) => {
      const [x, y] = pt(e, i);
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" style="--i:${i}" class="stat-dot"><title>${esc(e.title)}: ${e.pct}</title></circle>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart" role="img">
      <line x1="${PADX}" y1="${PADY}" x2="${W - PADX}" y2="${PADY}" class="stat-grid"/>
      <line x1="${PADX}" y1="${H - PADY}" x2="${W - PADX}" y2="${H - PADY}" class="stat-grid"/>
      ${n > 1 ? `<path d="${path}" pathLength="1" class="stat-line"/>` : ''}${dots}
    </svg>`;
  }

  function render() {
    load();
    const T = i18n.t;
    const container = document.getElementById('tab-stats');
    if (!container) return;

    const deck = Decks.getActive();
    const cards = deck && deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
    const due = Decks.dueCards(cards).length;
    const reviews = totalReviews();
    const exams = data.exams;

    if (reviews === 0 && exams.length === 0) {
      container.innerHTML = `
        <div class="stats-container">
          <div class="empty-state">
            <svg viewBox="0 0 72 72" fill="none">
              <rect x="10" y="34" width="10" height="24" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <rect x="31" y="22" width="10" height="36" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <rect x="52" y="42" width="10" height="16" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <path d="M12 24c8-10 18-12 26-8s14 2 22-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 5"/>
            </svg>
            <p>${T('noStatsYet')}</p>
          </div>
        </div>`;
      return;
    }

    const lastExams = exams.slice(-12);
    let examRows = '';
    exams.slice(-6).reverse().forEach(e => {
      const date = new Date(e.t).toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' });
      examRows += `<div class="exam-row"><span class="exam-row-title">${esc(e.title) || '—'}</span><span class="exam-row-date">${date}</span><span class="exam-row-grade">${esc(e.grade)}</span><span class="exam-row-pct">${e.pct}</span></div>`;
    });

    container.innerHTML = `
      <div class="stats-container">
        <div class="stat-tiles">
          ${tile(`<span class="flame">&#128293;</span> <span data-count="${streak()}">0</span>`, T('statStreak'))}
          ${tile(`<span data-count="${reviews}">0</span>`, T('statReviews'))}
          ${tile(`<span data-count="${due}">0</span>`, T('statDue'))}
          ${tile(`<span data-count="${exams.length}">0</span>`, T('statExams'))}
        </div>
        <div class="stat-card">
          <h3 class="stat-card-title">${T('reviewsLast14')}</h3>
          ${barChart(14)}
        </div>
        ${exams.length ? `
        <div class="stat-card">
          <h3 class="stat-card-title">${T('examHistory')}</h3>
          ${examChart(lastExams)}
          <div class="exam-rows">${examRows}</div>
        </div>` : ''}
      </div>`;

    // Bring the numbers to life: tiles cascade in and count up.
    container.querySelectorAll('.stat-tile').forEach((el, i) => el.style.setProperty('--i', i));
    container.querySelectorAll('[data-count]').forEach(el =>
      FX.countUp(el, parseInt(el.dataset.count, 10) || 0, { duration: 800 }));
  }

  return { recordReview, recordExam, render, streak };
})();
