// ===== Class mode (teacher + students) =====
// Account-less, like device sync: a teacher creates a class and gets a
// private teacher code (bearer secret) plus a public join code. Students join
// with the join code and a nickname; the teacher's decks appear in their
// library as class decks and stay updated without losing the student's own
// FSRS progress. Students send small aggregated progress reports; the teacher
// sees a students × topics heatmap. Codes live only in this browser's
// localStorage — nothing identifies a student beyond the nickname.
const ClassMode = (() => {
  const KEY = 'flashmind_class_v1';
  const REPORT_EVERY = 30 * 60 * 1000;
  const T = (k, p) => i18n.t(k, p);
  let cfg = null;
  let modal = null, releaseTrap = null;
  let screen = null; // { name, join, ... }
  let dash = null; // last dashboard payload for the open teacher screen
  let busy = false;

  // ----- Local config -----
  function load() {
    if (!cfg) {
      try { cfg = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { cfg = {}; }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
      cfg.teach = Array.isArray(cfg.teach) ? cfg.teach.filter(c => c && typeof c.join === 'string' && typeof c.teacher === 'string') : [];
      cfg.member = Array.isArray(cfg.member) ? cfg.member.filter(c => c && typeof c.join === 'string' && typeof c.sid === 'string' && typeof c.key === 'string') : [];
      cfg.member.forEach(m => { if (!m.vers || typeof m.vers !== 'object') m.vers = {}; });
    }
    return cfg;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage full: codes stay in memory */ } }
  const teachOf = join => load().teach.find(c => c.join === join);
  const memberOf = join => load().member.find(c => c.join === join);

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function fmtDate(t) {
    return t ? new Date(t).toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' }) : '—';
  }
  function fmtDue(d) {
    const t = typeof Decks !== 'undefined' && Decks.examStart ? Decks.examStart(d) : null;
    return t ? fmtDate(t) : '';
  }
  function relTime(t) {
    if (!t) return T('clsNever');
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return T('justNow');
    if (s < 3600) return T('minsAgo', { n: Math.floor(s / 60) });
    if (s < 86400) return T('hoursAgo', { n: Math.floor(s / 3600) });
    return T('clsDaysAgo', { n: Math.floor(s / 86400) });
  }

  // ----- Home screen section -----
  function renderSection() {
    const wrap = document.getElementById('class-section');
    if (!wrap) return;
    load();
    wrap.style.display = 'block';
    const chips = cfg.teach.map(c => `
        <button class="cls-chip cls-chip-teach" data-cls-act="open-teacher" data-join="${esc(c.join)}">
          <span class="cls-chip-role">${T('clsTeacher')}</span><span class="cls-chip-name">${esc(c.name)}</span>
        </button>`).concat(cfg.member.map(c => `
        <button class="cls-chip" data-cls-act="open-student" data-join="${esc(c.join)}">
          <span class="cls-chip-role">${T('clsStudentAs', { nick: esc(c.nick) })}</span><span class="cls-chip-name">${esc(c.name)}</span>
        </button>`)).join('');
    wrap.innerHTML = `
      <div class="deck-library-head">
        <span class="deck-library-title">&#127979; ${T('clsSectionTitle')}</span>
      </div>
      <div class="cls-row">
        ${chips}
        <button class="btn-ghost cls-btn" data-cls-act="create">+ ${T('clsCreate')}</button>
        <button class="btn-ghost cls-btn" data-cls-act="join">${T('clsJoin')}</button>
        <button class="btn-ghost cls-btn" data-cls-act="battle-host">&#9876;&#65039; ${T('btlHost')}</button>
        <button class="btn-ghost cls-btn" data-cls-act="battle-join">${T('btlJoin')}</button>
      </div>`;
  }

  // Library card badge for decks that came from a class.
  function deckBadge(deck) {
    if (!deck || !deck.cls) return '';
    const m = memberOf(deck.cls.join);
    const name = m ? m.name : '';
    return `<span class="cls-badge" title="${esc(name)}">&#127979; ${T('clsBadge')}${deck.cls.due ? ' &middot; ' + esc(fmtDue(deck.cls.due)) : ''}</span>`;
  }

  // ----- Modal shell -----
  function buildModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'shortcuts-backdrop cls-backdrop';
    modal.style.display = 'none';
    modal.innerHTML = `<div class="shortcuts-card cls-card" role="dialog" aria-modal="true" aria-labelledby="cls-title">
      <button class="cls-close" data-cls-act="close" aria-label="${T('close')}">&times;</button>
      <div id="cls-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') closeModal();
    });
  }

  function open(next) {
    buildModal();
    screen = next;
    modal.style.display = 'flex';
    modal.querySelector('.cls-card').classList.toggle('cls-wide', next.name === 'teacher');
    render();
    if (releaseTrap) releaseTrap();
    releaseTrap = FX.trapFocus(modal.querySelector('.cls-card'));
  }

  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    screen = null;
    dash = null;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function render() {
    if (!modal || !screen) return;
    const body = modal.querySelector('#cls-body');
    const fn = { create: renderCreate, created: renderCreated, join: renderJoin, student: renderStudent, teacher: renderTeacher }[screen.name];
    body.innerHTML = fn ? fn() : '';
    if (screen.name === 'create' || screen.name === 'join') {
      const first = [...body.querySelectorAll('input')].find(i => !i.value) || body.querySelector('input');
      if (first) setTimeout(() => first.focus(), 30);
    }
  }

  // ----- Create / join -----
  function renderCreate() {
    return `<h3 id="cls-title">${T('clsCreate')}</h3>
      <p class="cls-desc">${T('clsCreateDesc')}</p>
      <label class="cls-label" for="cls-name">${T('clsName')}</label>
      <input id="cls-name" class="cls-input" maxlength="60" placeholder="${T('clsNamePh')}">
      <div class="cls-actions"><button class="btn-primary" data-cls-act="do-create"${busy ? ' disabled' : ''}>${T('clsCreateBtn')}</button></div>`;
  }

  function renderCreated() {
    const c = teachOf(screen.join);
    if (!c) return '';
    return `<h3 id="cls-title">${T('clsCreated', { name: esc(c.name) })}</h3>
      ${codeBlock(c)}
      <div class="cls-actions"><button class="btn-primary" data-cls-act="open-teacher" data-join="${esc(c.join)}">${T('clsOpenDash')}</button></div>`;
  }

  function joinLink(join) { return `${location.origin}${location.pathname}?class=${encodeURIComponent(join)}`; }

  function codeBlock(c) {
    return `<div class="cls-codes">
        <div class="cls-code-box">
          <span class="cls-code-label">${T('clsJoinCode')}</span>
          <span class="cls-code">${esc(c.join.toUpperCase())}</span>
          <button class="btn-ghost cls-mini" data-cls-act="copy" data-copy="${esc(joinLink(c.join))}">${T('clsCopyLink')}</button>
          <span class="cls-code-hint">${T('clsJoinHint')}</span>
        </div>
        <div class="cls-code-box cls-code-secret">
          <span class="cls-code-label">${T('clsTeacherCode')}</span>
          <span class="cls-code cls-code-small">${esc(c.teacher)}</span>
          <button class="btn-ghost cls-mini" data-cls-act="copy" data-copy="${esc(c.teacher)}">${T('copyLink')}</button>
          <span class="cls-code-hint">${T('clsTeacherHint')}</span>
        </div>
      </div>`;
  }

  function renderJoin() {
    return `<h3 id="cls-title">${T('clsJoin')}</h3>
      <p class="cls-desc">${T('clsJoinDesc')}</p>
      <label class="cls-label" for="cls-join-code">${T('clsJoinCode')}</label>
      <input id="cls-join-code" class="cls-input cls-input-code" maxlength="7" autocapitalize="characters" autocomplete="off" value="${esc((screen.code || '').toUpperCase())}">
      <label class="cls-label" for="cls-nick">${T('clsNick')}</label>
      <input id="cls-nick" class="cls-input" maxlength="24" autocomplete="nickname" placeholder="${T('clsNickPh')}">
      <p class="cls-privacy">&#128274; ${T('clsPrivacy')}</p>
      <div class="cls-actions">
        <button class="btn-ghost" data-cls-act="teacher-code">${T('clsHaveTeacherCode')}</button>
        <button class="btn-primary" data-cls-act="do-join"${busy ? ' disabled' : ''}>${T('clsJoinBtn')}</button>
      </div>`;
  }

  async function doCreate() {
    const name = (modal.querySelector('#cls-name').value || '').trim();
    if (!name) { App.showToast(T('clsNeedName'), 'error'); return; }
    await withBusy(async () => {
      const res = await API.classCall('classCreate', { name });
      load().teach.push({ join: res.join, teacher: res.teacher, name: res.name, created: Date.now() });
      save();
      renderSection();
      open({ name: 'created', join: res.join });
    });
  }

  async function doJoin() {
    const join = (modal.querySelector('#cls-join-code').value || '').trim().toLowerCase();
    const nick = (modal.querySelector('#cls-nick').value || '').trim();
    if (!/^[a-z2-9]{7}$/.test(join)) { App.showToast(T('clsBadCode'), 'error'); return; }
    if (!nick) { App.showToast(T('clsNeedNick'), 'error'); return; }
    if (memberOf(join)) { open({ name: 'student', join }); return; }
    await withBusy(async () => {
      const res = await API.classCall('classJoin', { join, nick });
      const m = { join, sid: res.sid, key: res.key, name: res.name, nick, vers: {}, joined: Date.now(), lastReport: 0 };
      load().member.push(m);
      save();
      const n = await applyItems(m, res.items || []);
      renderSection();
      App.showToast(T('clsJoined', { name: res.name, n }), 'success');
      open({ name: 'student', join });
    });
  }

  // Recover a class on a new device from its teacher code.
  async function enterTeacherCode() {
    const join = (prompt(T('clsJoinCode')) || '').trim().toLowerCase();
    if (!join) return;
    const teacher = (prompt(T('clsTeacherCode')) || '').trim().toLowerCase();
    if (!teacher) return;
    await withBusy(async () => {
      const res = await API.classCall('classDashboard', { join, teacher });
      if (!teachOf(join)) load().teach.push({ join, teacher, name: res.name, created: Date.now() });
      save();
      renderSection();
      open({ name: 'teacher', join });
    });
  }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    render();
    try { await fn(); }
    catch (e) { App.showToast(T('clsFailed') + ' ' + e.message, 'error'); }
    finally { busy = false; render(); }
  }

  // ----- Student side -----
  // Bring class decks up to date: fetch only items whose version moved.
  // Returns how many decks were added or updated.
  async function applyItems(m, items) {
    let changed = 0;
    const active = Decks.getActive();
    let activeTouched = false;
    for (const it of items) {
      if (!it || !it.id || (m.vers[it.id] || 0) >= it.ver) continue;
      let payload;
      try { payload = await API.classCall('classItem', { join: m.join, id: it.id }); } catch (e) { continue; }
      const data = payload && (payload.studyData || payload);
      if (!data || !data.title) continue;
      const cls = { join: m.join, id: it.id, ver: it.ver, due: it.due || null };
      const deck = Decks.upsertClassDeck(cls, data, (old, fresh) => {
        const kept = ClassCore.remapProgress(old, fresh);
        // Follow the teacher's due date unless the student set their own.
        if (it.due && (!old.examDate || (old.cls && old.examDate === old.cls.due))) kept.examDate = it.due;
        return kept;
      });
      if (it.due && !deck.examDate) Decks.setExamDate(deck.id, it.due);
      if (active && deck.id === active.id) activeTouched = true;
      m.vers[it.id] = it.ver;
      changed++;
    }
    save();
    if (changed && typeof App !== 'undefined' && App.refreshLibrary) App.refreshLibrary(activeTouched);
    return changed;
  }

  function dropMembership(join, msgKey) {
    const m = memberOf(join);
    if (!m) return;
    cfg.member = cfg.member.filter(x => x.join !== join);
    save();
    // The decks stay in the library as the student's own.
    Decks.list().forEach(d => { if (d.cls && d.cls.join === join) { delete d.cls; Decks.touch(d.id); } });
    renderSection();
    if (typeof Library !== 'undefined') Library.render();
    if (msgKey) App.showToast(T(msgKey, { name: m.name }), 'info');
  }

  async function refreshMember(m) {
    let st;
    try { st = await API.classCall('classState', { join: m.join, sid: m.sid, key: m.key }); }
    catch (e) {
      if (e.status === 404 || e.status === 410) dropMembership(m.join, 'clsGone');
      return 0;
    }
    if (st.closed) { dropMembership(m.join, 'clsClosedNote'); return 0; }
    if (st.member === false) { dropMembership(m.join, 'clsRemovedNote'); return 0; }
    m.name = st.name || m.name;
    m.items = (st.items || []).map(({ id, title, ver, due }) => ({ id, title, ver, due }));
    const n = await applyItems(m, st.items || []);
    if (n) App.showToast(T('clsUpdated', { n, name: m.name }), 'info');
    return n;
  }

  async function report(m, force) {
    const now = Date.now();
    if (!force && now - (m.lastReport || 0) < REPORT_EVERY) return false;
    const r = ClassCore.buildReport(Decks.list(), m.join, now);
    try {
      await API.classCall('classReport', { join: m.join, sid: m.sid, key: m.key, report: r });
      m.lastReport = now;
      save();
      return true;
    } catch (e) {
      if (e.status === 404) dropMembership(m.join, 'clsRemovedNote');
      else if (e.status === 429) { m.lastReport = now - REPORT_EVERY + 5 * 60 * 1000; save(); }
      if (force) throw e;
      return false;
    }
  }

  async function refreshAll() {
    for (const m of load().member.slice()) {
      await refreshMember(m);
      if (memberOf(m.join)) await report(m, false);
    }
  }

  function reportAll() {
    return Promise.all(load().member.slice().map(m => report(m, false).catch(() => false)));
  }

  function renderStudent() {
    const m = memberOf(screen.join);
    if (!m) return '';
    const decks = Decks.list().filter(d => d.cls && d.cls.join === m.join);
    const rows = decks.map(d => {
      const r = ClassCore.deckReport(d, Date.now());
      return `<li class="cls-item">
        <span class="cls-item-title">${esc(d.data.title)}</span>
        <span class="cls-item-meta">${T('clsMastery')}: ${r.m}%${r.acc != null ? ' &middot; ' + T('clsAccuracy') + ': ' + r.acc + '%' : ''}${d.cls.due ? ' &middot; ' + T('clsDue', { d: esc(fmtDue(d.cls.due)) }) : ''}</span>
        <button class="btn-ghost cls-mini" data-cls-act="open-deck" data-id="${esc(d.id)}">${T('clsOpen')}</button>
      </li>`;
    }).join('');
    return `<h3 id="cls-title">&#127979; ${esc(m.name)}</h3>
      <p class="cls-desc">${T('clsStudentAs', { nick: esc(m.nick) })} &middot; ${T('clsLastReport')}: ${esc(relTime(m.lastReport))}</p>
      ${rows ? `<ul class="cls-items">${rows}</ul>` : `<p class="cls-empty">${T('clsNoDecksYet')}</p>`}
      <p class="cls-privacy">&#128274; ${T('clsPrivacy')}</p>
      <div class="cls-actions">
        <button class="btn-ghost cls-danger" data-cls-act="leave" data-join="${esc(m.join)}">${T('clsLeave')}</button>
        <button class="btn-ghost" data-cls-act="refresh" data-join="${esc(m.join)}"${busy ? ' disabled' : ''}>&#10227; ${T('clsRefresh')}</button>
        <button class="btn-primary" data-cls-act="report-now" data-join="${esc(m.join)}"${busy ? ' disabled' : ''}>${T('clsSendNow')}</button>
      </div>`;
  }

  async function leave(join) {
    const m = memberOf(join);
    if (!m || !confirm(T('clsLeaveConfirm', { name: m.name }))) return;
    await withBusy(async () => {
      try { await API.classCall('classLeave', { join, sid: m.sid, key: m.key }); }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
      dropMembership(join, 'clsLeft');
      closeModal();
    });
  }

  // ----- Teacher side -----
  function pushable() {
    return Decks.list().filter(d => !d.cls && d.data && ((d.data.flashcards || []).length || (d.data.quiz || []).length));
  }

  // Strip heavy, personal-only parts before sending a deck to a class.
  function classPayload(data) {
    const out = JSON.parse(JSON.stringify(data));
    delete out.media; delete out.audio;
    if (JSON.stringify(out).length > 900000) delete out.sources;
    return out;
  }

  function heatColor(pct) {
    const hue = Math.round(Math.max(0, Math.min(100, pct)) * 1.2); // 0 red → 120 green
    return `hsl(${hue} 70% 45% / 0.85)`;
  }

  function renderTeacher() {
    const c = teachOf(screen.join);
    if (!c) return '';
    const items = (dash && dash.items) || c.items || [];
    const deckOpts = pushable().map(d => `<option value="${esc(d.id)}">${esc(d.data.title)}</option>`).join('');
    const itemRows = items.map(it => {
      const local = Decks.get(it.id);
      const stale = local && local.updatedAt > (it.t || 0);
      return `<li class="cls-item">
        <span class="cls-item-title">${esc(it.title)}</span>
        <span class="cls-item-meta">v${it.ver} &middot; ${T('cardsN', { n: it.cards || 0 })} &middot; ${T('questionsN', { n: it.qs || 0 })}${it.due ? ' &middot; ' + T('clsDue', { d: esc(fmtDue(it.due)) }) : ''}</span>
        ${stale ? `<button class="btn-ghost cls-mini" data-cls-act="repush" data-id="${esc(it.id)}" data-due="${esc(it.due || '')}">${T('clsUpdate')}</button>` : ''}
        <button class="btn-ghost cls-mini cls-danger" data-cls-act="unpush" data-id="${esc(it.id)}" aria-label="${T('clsUnpush')}" title="${T('clsUnpush')}">&times;</button>
      </li>`;
    }).join('');

    let board = `<p class="cls-empty">${busy && !dash ? T('clsLoading') : T('clsNoStudents')}</p>`;
    if (dash && dash.students.length) board = dashboardHtml(ClassCore.aggregate(dash.students, Date.now()));

    return `<h3 id="cls-title">&#127979; ${esc(c.name)} <span class="cls-teacher-tag">${T('clsTeacher')}</span></h3>
      ${codeBlock(c)}
      <section class="cls-section">
        <h4>${T('clsPushTitle')}</h4>
        <div class="cls-push-row">
          <select id="cls-push-deck" class="cls-input" aria-label="${T('clsPickDeck')}">${deckOpts || `<option value="">${T('clsNoLocalDecks')}</option>`}</select>
          <label class="cls-due-label">${T('clsDueOpt')} <input type="date" id="cls-push-due" class="cls-input cls-date"></label>
          <button class="btn-primary" data-cls-act="push"${busy || !deckOpts ? ' disabled' : ''}>${T('clsPush')}</button>
        </div>
        ${itemRows ? `<ul class="cls-items">${itemRows}</ul>` : ''}
      </section>
      <section class="cls-section">
        <div class="cls-section-head">
          <h4>${T('clsDashTitle')} ${dash ? `<span class="cls-count">${T('clsStudentsN', { n: dash.students.length })}</span>` : ''}</h4>
          <button class="btn-ghost cls-mini" data-cls-act="reload-dash"${busy ? ' disabled' : ''}>&#10227; ${T('clsRefresh')}</button>
        </div>
        ${board}
        <p class="cls-note">${T('clsDelayNote')}</p>
      </section>
      <div class="cls-actions">
        <button class="btn-ghost cls-danger" data-cls-act="close-class" data-join="${esc(c.join)}">${T('clsCloseClass')}</button>
        <button class="btn-ghost" data-cls-act="forget-class" data-join="${esc(c.join)}">${T('clsForget')}</button>
      </div>`;
  }

  function dashboardHtml(agg) {
    const topics = agg.topics.slice(0, 12);
    const weak = agg.weakest.length
      ? agg.weakest.map(t => `<span class="cls-weak-chip" style="--heat:${heatColor(t.pct)}">${esc(t.name)} <b>${t.pct}%</b></span>`).join('')
      : `<span class="cls-empty">${T('clsNoTopicData')}</span>`;
    const behind = agg.behind.length
      ? `<ul class="cls-behind">${agg.behind.map(b => `<li><b>${esc(b.nick)}</b> — ${b.why.map(w => T('clsWhy_' + w)).join(', ')}</li>`).join('')}</ul>`
      : `<p class="cls-empty">${T('clsNobodyBehind')}</p>`;
    const head = topics.map(t => `<th scope="col" class="cls-th-topic" title="${esc(t.name)}"><span>${esc(t.name)}</span></th>`).join('');
    const rows = agg.rows.map(r => `<tr>
        <th scope="row" class="cls-th-name">
          <span class="cls-nick">${esc(r.nick)}</span>
          <span class="cls-sub">${esc(relTime(r.t))}</span>
        </th>
        <td class="cls-td-num">${r.mastery == null ? '—' : r.mastery + '%'}</td>
        ${topics.map(t => {
          const c = r.cells[t.name];
          return c ? `<td class="cls-cell" style="--heat:${heatColor(c.pct)}" title="${esc(r.nick)} · ${esc(t.name)}: ${c.ok}/${c.n}">${c.pct}</td>` : '<td class="cls-cell cls-cell-empty">·</td>';
        }).join('')}
        <td><button class="cls-x" data-cls-act="remove-student" data-sid="${esc(r.sid)}" data-nick="${esc(r.nick)}" aria-label="${T('clsRemove')}" title="${T('clsRemove')}">&times;</button></td>
      </tr>`).join('');
    return `<div class="cls-summary">
        <div class="cls-stat"><span class="cls-stat-num">${agg.rows.length}</span><span>${T('clsStudents')}</span></div>
        <div class="cls-stat"><span class="cls-stat-num">${agg.avgMastery}%</span><span>${T('clsAvgMastery')}</span></div>
        <div class="cls-stat"><span class="cls-stat-num">${agg.behind.length}</span><span>${T('clsBehind')}</span></div>
      </div>
      <h5>${T('clsWeakest')}</h5>
      <div class="cls-weak">${weak}</div>
      <button class="btn-primary cls-revision-btn" data-cls-act="revision"${busy || !agg.weakest.length ? ' disabled' : ''}>&#127919; ${T('clsMakeRevision')}</button>
      <h5>${T('clsBehindTitle')}</h5>
      ${behind}
      <h5>${T('clsHeatmap')}</h5>
      <div class="cls-heat-wrap"><table class="cls-heat">
        <thead><tr><th scope="col">${T('clsStudent')}</th><th scope="col">${T('clsMastery')}</th>${head}<th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  async function loadDashboard() {
    const c = teachOf(screen && screen.join);
    if (!c) return;
    await withBusy(async () => {
      try {
        dash = await API.classCall('classDashboard', { join: c.join, teacher: c.teacher });
      } catch (e) {
        if (e.status === 410 || e.status === 404) { forget(c.join); closeModal(); }
        throw e;
      }
      c.name = dash.name || c.name;
      c.items = dash.items;
      save();
    });
  }

  async function push(deckId, due) {
    const c = teachOf(screen.join);
    const deck = Decks.get(deckId);
    if (!c || !deck) return;
    await withBusy(async () => {
      const res = await API.classCall('classPush', { join: c.join, teacher: c.teacher, id: deck.id, data: classPayload(deck.data), due: due || undefined });
      App.showToast(T('clsPushed', { title: deck.data.title, v: res.ver }), 'success');
    });
    await loadDashboard();
  }

  async function unpush(id) {
    const c = teachOf(screen.join);
    if (!c || !confirm(T('clsUnpushConfirm'))) return;
    await withBusy(() => API.classCall('classUnpush', { join: c.join, teacher: c.teacher, id }));
    await loadDashboard();
  }

  async function removeStudent(sid, nick) {
    const c = teachOf(screen.join);
    if (!c || !confirm(T('clsRemoveConfirm', { nick }))) return;
    await withBusy(() => API.classCall('classRemove', { join: c.join, teacher: c.teacher, sid }));
    if (dash) dash.students = dash.students.filter(s => s.sid !== sid);
    render();
  }

  function forget(join) {
    cfg.teach = load().teach.filter(c => c.join !== join);
    save();
    renderSection();
  }

  async function closeClass(join) {
    const c = teachOf(join);
    if (!c || !confirm(T('clsCloseConfirm', { name: c.name }))) return;
    await withBusy(async () => {
      await API.classCall('classClose', { join, teacher: c.teacher });
      forget(join);
      closeModal();
      App.showToast(T('clsClosedDone'), 'info');
    });
  }

  // One click: a revision exam on the class's weakest topics — existing class
  // questions on those topics plus a few new AI ones — saved to the teacher's
  // library and pushed to the class.
  async function makeRevision() {
    const c = teachOf(screen.join);
    if (!c || !dash) return;
    const agg = ClassCore.aggregate(dash.students, Date.now());
    const weak = agg.weakest.slice(0, 3).map(t => t.name);
    if (!weak.length) return;
    await withBusy(async () => {
      const quizzes = await Promise.all((dash.items || []).map(async it => {
        const local = Decks.get(it.id);
        if (local) return local.data.quiz || [];
        try { const p = await API.classCall('classItem', { join: c.join, id: it.id }); return ((p && p.studyData) || {}).quiz || []; }
        catch (e) { return []; }
      }));
      const questions = ClassCore.revisionQuestions(quizzes, weak, 12);
      try {
        const sample = questions.slice(0, 12).map(q => '- [' + ClassCore.topicOf(q) + '] ' + q.question).join('\n');
        const prompt = 'A class is weakest on these topics: ' + weak.join(', ') + '.\n' +
          'Generate 6 NEW exam questions for a revision exam on exactly these topics ' +
          '(multiple-choice with 5 options in Turkish YKS style, and true-false). ' +
          'Set each question\'s "category" to the topic it tests, spelled exactly as listed. ' +
          'Do not repeat the existing questions. Return them as a quiz.';
        const raw = await API.chat(prompt, ('Existing questions:\n' + sample).slice(0, 6000));
        const parsed = Parser.parseChat(raw);
        if (parsed && parsed.type === 'quiz' && Array.isArray(parsed.quiz)) questions.push(...parsed.quiz.slice(0, 8));
      } catch (e) { /* AI unavailable: the existing questions still make an exam */ }
      if (!questions.length) throw new Error(T('clsNoQuestions'));
      const data = Parser.normalizeStudyData({
        title: T('clsRevisionTitle', { topics: weak.join(', ') }).slice(0, 80),
        notes: { summary: T('clsRevisionSummary', { name: c.name, topics: weak.join(', ') }), sections: [] },
        flashcards: [],
        quiz: questions.map((q, i) => ({ ...q, id: i + 1 }))
      });
      const prev = Decks.getActive();
      const deck = Decks.save(data, '', null);
      if (prev) Decks.setActive(prev.id);
      if (typeof Library !== 'undefined') Library.render();
      const res = await API.classCall('classPush', { join: c.join, teacher: c.teacher, id: deck.id, data: classPayload(deck.data) });
      App.showToast(T('clsRevisionDone', { n: data.quiz.length, v: res.ver }), 'success');
    });
    await loadDashboard();
  }

  // ----- Events -----
  function onClick(e) {
    const btn = e.target.closest('[data-cls-act]');
    if (!btn) return;
    const act = btn.dataset.clsAct;
    const join = btn.dataset.join;
    switch (act) {
      case 'close': closeModal(); break;
      case 'create': open({ name: 'create' }); break;
      case 'join': open({ name: 'join' }); break;
      case 'do-create': doCreate(); break;
      case 'do-join': doJoin(); break;
      case 'teacher-code': enterTeacherCode(); break;
      case 'open-teacher': dash = null; open({ name: 'teacher', join }); loadDashboard(); break;
      case 'open-student': open({ name: 'student', join }); break;
      case 'open-deck': closeModal(); App.openDeck(btn.dataset.id); break;
      case 'refresh': { const m = memberOf(join); if (m) withBusy(() => refreshMember(m)); break; }
      case 'report-now': {
        const m = memberOf(join);
        if (m) withBusy(async () => { await report(m, true); App.showToast(T('clsReportSent'), 'success'); });
        break;
      }
      case 'leave': leave(join); break;
      case 'copy': navigator.clipboard.writeText(btn.dataset.copy).then(() => App.showToast(T('copied'), 'success')).catch(() => {}); break;
      case 'push': {
        const id = modal.querySelector('#cls-push-deck').value;
        if (id) push(id, modal.querySelector('#cls-push-due').value);
        break;
      }
      case 'repush': push(btn.dataset.id, btn.dataset.due); break;
      case 'unpush': unpush(btn.dataset.id); break;
      case 'reload-dash': loadDashboard(); break;
      case 'remove-student': removeStudent(btn.dataset.sid, btn.dataset.nick); break;
      case 'revision': makeRevision(); break;
      case 'close-class': closeClass(join); break;
      case 'forget-class':
        if (confirm(T('clsForgetConfirm'))) { forget(join); closeModal(); }
        break;
      case 'battle-host': if (typeof Battle !== 'undefined') Battle.openHost(); break;
      case 'battle-join': if (typeof Battle !== 'undefined') Battle.openJoin(); break;
    }
  }

  // ?class=CODE opens the join form with the code filled in.
  function checkLink() {
    const params = new URLSearchParams(location.search);
    const code = params.get('class');
    if (!code) return;
    params.delete('class');
    const qs = params.toString();
    history.replaceState({}, '', location.pathname + (qs ? '?' + qs : ''));
    const join = code.trim().toLowerCase();
    if (memberOf(join)) open({ name: 'student', join });
    else open({ name: 'join', code: join });
  }

  function init() {
    load();
    renderSection();
    document.addEventListener('click', onClick);
    checkLink();
    if (cfg.member.length) setTimeout(() => { refreshAll().catch(() => {}); }, 2000);
    setInterval(() => { refreshAll().catch(() => {}); }, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportAll();
    });
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));

  return { init, deckBadge, renderSection, refreshAll, reportAll, open, closeModal };
})();
