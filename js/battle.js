// ===== Quiz battles (live, Kahoot-style) =====
// The host turns a deck's exam questions into a room on the worker (one
// Durable Object per room); players join with the 6-digit code (or the
// ?battle=CODE link / QR) and a nickname. Everything after that is one
// WebSocket per screen. The server owns the clock, the answer key and the
// scoring — this file only renders what it sends.
const Battle = (() => {
  const T = (k, p) => i18n.t(k, p);
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const SHAPES = ['&#9650;', '&#9670;', '&#9679;', '&#9632;', '&#9733;'];
  const STORE = 'flashmind_battle_v1';
  const QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

  let setup = null, releaseSetup = null;
  let ov = null, releaseOv = null;
  let s = null; // the live session
  let tick = null, ping = null, qrPromise = null;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function joinLink(code) { return `${location.origin}${location.pathname}?battle=${encodeURIComponent(code)}`; }
  const prettyCode = c => String(c).replace(/^(\d{3})(\d{3})$/, '$1 $2');

  function remember() {
    if (!s) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ role: s.role, code: s.code, hostKey: s.hostKey, name: s.name, pid: s.pid, token: s.token, t: Date.now() }));
    } catch (e) { /* private mode: no resume after reload */ }
  }
  function forget() { try { sessionStorage.removeItem(STORE); } catch (e) { /* ignore */ } }

  // ----- Setup modal (host / join) -----
  function buildSetup() {
    if (setup) return;
    setup = document.createElement('div');
    setup.className = 'shortcuts-backdrop';
    setup.style.display = 'none';
    setup.innerHTML = '<div class="shortcuts-card btl-setup" role="dialog" aria-modal="true" aria-labelledby="btl-setup-title"></div>';
    document.body.appendChild(setup);
    setup.addEventListener('click', e => {
      if (e.target === setup) closeSetup();
      const btn = e.target.closest('[data-btl-setup]');
      if (!btn) return;
      if (btn.dataset.btlSetup === 'cancel') closeSetup();
      if (btn.dataset.btlSetup === 'create') createRoom();
      if (btn.dataset.btlSetup === 'join') submitJoin();
    });
    setup.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSetup();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const go = setup.querySelector('[data-btl-setup="create"], [data-btl-setup="join"]');
        if (go) go.click();
      }
    });
  }

  function showSetup(html) {
    buildSetup();
    setup.querySelector('.btl-setup').innerHTML = html;
    setup.style.display = 'flex';
    if (releaseSetup) releaseSetup();
    releaseSetup = FX.trapFocus(setup.querySelector('.btl-setup'));
    const first = setup.querySelector('input:not([value]), input[value=""], select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeSetup() {
    if (!setup) return;
    setup.style.display = 'none';
    if (releaseSetup) { releaseSetup(); releaseSetup = null; }
  }

  function playable(deck) {
    return ClassCore.battleQuestions((deck.data || {}).quiz, { t: 'T', f: 'F' }, 50).length;
  }

  function openHost(deckId) {
    const decks = Decks.list().filter(d => playable(d) > 0);
    const active = Decks.getActive();
    const pick = deckId || (active && playable(active) ? active.id : (decks[0] && decks[0].id));
    if (!decks.length) {
      showSetup(`<h3 id="btl-setup-title">&#9876;&#65039; ${T('btlHost')}</h3>
        <p class="cls-desc">${T('btlNoQuestions')}</p>
        <div class="cls-actions"><button class="btn-primary" data-btl-setup="cancel">${T('close')}</button></div>`);
      return;
    }
    showSetup(`<h3 id="btl-setup-title">&#9876;&#65039; ${T('btlHost')}</h3>
      <p class="cls-desc">${T('btlHostDesc')}</p>
      <label class="cls-label" for="btl-deck">${T('btlDeck')}</label>
      <select id="btl-deck" class="cls-input">${decks.map(d => `<option value="${esc(d.id)}"${d.id === pick ? ' selected' : ''}>${esc(d.data.title)} (${playable(d)})</option>`).join('')}</select>
      <div class="btl-setup-row">
        <label class="cls-label">${T('btlSeconds')}
          <select id="btl-secs" class="cls-input"><option value="10">10 s</option><option value="20" selected>20 s</option><option value="30">30 s</option></select>
        </label>
        <label class="cls-label">${T('btlCount')}
          <select id="btl-count" class="cls-input"><option value="5">5</option><option value="10" selected>10</option><option value="20">20</option><option value="50">${T('btlAll')}</option></select>
        </label>
      </div>
      <div class="cls-actions">
        <button class="btn-ghost" data-btl-setup="cancel">${T('cancel')}</button>
        <button class="btn-primary" data-btl-setup="create">${T('btlCreate')}</button>
      </div>`);
  }

  function openJoin(code, error, name) {
    showSetup(`<h3 id="btl-setup-title">${T('btlJoin')}</h3>
      ${error ? `<p class="btl-error">${esc(error)}</p>` : ''}
      <label class="cls-label" for="btl-code">${T('btlCode')}</label>
      <input id="btl-code" class="cls-input cls-input-code" inputmode="numeric" maxlength="7" autocomplete="off" value="${esc(code || '')}">
      <label class="cls-label" for="btl-name">${T('clsNick')}</label>
      <input id="btl-name" class="cls-input" maxlength="20" autocomplete="nickname" value="${esc(name || '')}">
      <div class="cls-actions">
        <button class="btn-ghost" data-btl-setup="cancel">${T('cancel')}</button>
        <button class="btn-primary" data-btl-setup="join">${T('btlJoinBtn')}</button>
      </div>`);
  }

  async function createRoom() {
    const btn = setup.querySelector('[data-btl-setup="create"]');
    const deck = Decks.get(setup.querySelector('#btl-deck').value);
    if (!deck || btn.disabled) return;
    const secs = parseInt(setup.querySelector('#btl-secs').value, 10) || 20;
    const count = parseInt(setup.querySelector('#btl-count').value, 10) || 10;
    const questions = ClassCore.battleQuestions(deck.data.quiz, { t: T('btlTrue'), f: T('btlFalse') }, count, Math.random);
    btn.disabled = true;
    btn.textContent = T('btlCreating');
    try {
      const res = await API.battleCreate(deck.data.title, questions, secs);
      closeSetup();
      begin({ role: 'host', code: res.code, hostKey: res.hostKey, title: deck.data.title });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = T('btlCreate');
      App.showToast(T('btlFailed') + ' ' + e.message, 'error');
    }
  }

  function submitJoin() {
    const code = (setup.querySelector('#btl-code').value || '').replace(/\D/g, '');
    const name = (setup.querySelector('#btl-name').value || '').trim();
    if (!/^\d{6}$/.test(code)) { App.showToast(T('btlBadCode'), 'error'); return; }
    if (!name) { App.showToast(T('clsNeedNick'), 'error'); return; }
    closeSetup();
    begin({ role: 'player', code, name });
  }

  // ----- Session + socket -----
  function begin(session) {
    if (s) stop(false);
    s = { ...session, view: null, status: 'connecting', retries: 0, choice: null, qi: -1, error: null, fatal: false };
    remember();
    showOverlay();
    connect();
  }

  function connect() {
    if (!s) return;
    const params = s.role === 'host'
      ? { role: 'host', key: s.hostKey }
      : { role: 'player', name: s.name || '', ...(s.pid ? { pid: s.pid, token: s.token } : {}) };
    let ws;
    try { ws = new WebSocket(API.battleSocketUrl(s.code, params)); }
    catch (e) { s.status = 'lost'; render(); return; }
    s.ws = ws;
    s.status = s.view ? 'reconnecting' : 'connecting';
    ws.onopen = () => {
      if (s && s.ws === ws) { s.status = 'open'; s.retries = 0; startPing(); render(); }
    };
    ws.onmessage = e => {
      if (!s || s.ws !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      onMessage(m);
    };
    ws.onclose = e => {
      if (!s || s.ws !== ws) return;
      stopPing();
      if (s.closedByUser) return;
      if (s.fatal || e.code === 4000 || e.code === 4001 || e.code === 4004) {
        s.status = 'closed';
        if (!s.error && (!s.view || s.view.phase !== 'ended')) s.error = 'closed';
        render();
        return;
      }
      if (s.retries >= 8) { s.status = 'lost'; render(); return; }
      s.status = 'reconnecting';
      render();
      const wait = Math.min(8000, 500 * Math.pow(2, s.retries++));
      setTimeout(() => { if (s && s.ws === ws) connect(); }, wait);
    };
  }

  function startPing() {
    stopPing();
    ping = setInterval(() => send({ t: 'ping' }), 25000);
  }
  function stopPing() { clearInterval(ping); ping = null; }

  function send(msg) {
    if (s && s.ws && s.ws.readyState === 1) { s.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  function onMessage(m) {
    if (m.t === 'joined') {
      s.pid = m.pid;
      s.token = m.token;
      remember();
      return;
    }
    if (m.t === 'error') {
      s.fatal = true;
      s.error = m.code;
      if (s.role === 'player' && ['name_taken', 'bad_name'].includes(m.code)) {
        const { code, name } = s;
        stop(true);
        s = null;
        openJoin(code, T('btlErr_' + m.code), name);
        return;
      }
      if (['no_room', 'kicked', 'unknown_player', 'not_host'].includes(m.code)) forget();
      render();
      return;
    }
    if (m.t !== 'state') return;
    s.view = m;
    if (m.phase === 'question') {
      s.deadline = Date.now() + (m.remainMs || 0);
      if (m.qi !== s.qi) { s.qi = m.qi; s.choice = null; }
    }
    if (m.me && m.me.answered) s.choice = m.me.choice;
    if (m.phase === 'ended') forget();
    render();
  }

  function answer(c) {
    const v = s && s.view;
    if (!v || v.phase !== 'question' || s.choice != null) return;
    if (!send({ t: 'answer', qi: v.qi, c })) return;
    s.choice = c;
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
    render();
  }

  function stop(closeOverlay) {
    if (!s) return;
    s.closedByUser = true;
    stopPing();
    clearInterval(tick);
    tick = null;
    try { if (s.ws) s.ws.close(1000); } catch (e) { /* ignore */ }
    forget();
    if (closeOverlay && ov) {
      ov.remove();
      ov = null;
      document.body.classList.remove('btl-open');
      if (releaseOv) { releaseOv(); releaseOv = null; }
    }
  }

  function exit() {
    if (!s) return;
    const v = s.view;
    const live = v && v.phase !== 'ended' && s.status !== 'closed' && !s.fatal;
    if (live && !confirm(T(s.role === 'host' ? 'btlEndConfirm' : 'btlLeaveConfirm'))) return;
    if (s.role === 'host' && live) send({ t: 'end' });
    stop(true);
    s = null;
  }

  // ----- Overlay -----
  function showOverlay() {
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'btl-overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', T('btlTitle'));
      ov.setAttribute('tabindex', '-1');
      ov.innerHTML = '<div class="btl-inner"></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', onOverlayClick);
      ov.addEventListener('keydown', e => {
        if (e.key === 'Escape') exit();
        const i = '12345'.indexOf(e.key) >= 0 ? '12345'.indexOf(e.key) : 'abcde'.indexOf(e.key.toLowerCase());
        if (s && s.role === 'player' && i >= 0 && e.key.length === 1) answer(i);
      });
      document.body.classList.add('btl-open');
      releaseOv = FX.trapFocus(ov);
    }
    render();
    ov.focus();
  }

  function onOverlayClick(e) {
    const btn = e.target.closest('[data-btl]');
    if (!btn || !s) return;
    const act = btn.dataset.btl;
    if (act === 'exit') exit();
    else if (act === 'choice') answer(parseInt(btn.dataset.c, 10));
    else if (act === 'start' || act === 'next' || act === 'close' || act === 'end') send({ t: act });
    else if (act === 'kick' && confirm(T('btlKickConfirm', { name: btn.dataset.name }))) send({ t: 'kick', pid: btn.dataset.pid });
    else if (act === 'copy') navigator.clipboard.writeText(joinLink(s.code)).then(() => App.showToast(T('copied'), 'success')).catch(() => {});
    else if (act === 'retry') { s.retries = 0; s.fatal = false; s.error = null; connect(); render(); }
  }

  function remainSecs() {
    return s && s.deadline ? Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000)) : 0;
  }

  function updateTimer() {
    if (!ov || !s || !s.view) return;
    const el = ov.querySelector('.btl-timer');
    if (!el) return;
    const left = remainSecs();
    const frac = s.view.limitMs ? Math.max(0, (s.deadline - Date.now()) / s.view.limitMs) : 0;
    el.querySelector('.btl-timer-num').textContent = left;
    el.style.setProperty('--p', Math.round(frac * 100));
    el.classList.toggle('btl-timer-low', left <= 5);
  }

  function render() {
    if (!ov || !s) return;
    const inner = ov.querySelector('.btl-inner');
    const v = s.view;
    let body;
    if (s.error && (s.fatal || s.status === 'closed') && !(v && v.phase === 'ended')) body = errorHtml();
    else if (!v) body = `<div class="btl-center"><div class="btl-spinner"></div><p>${T(s.status === 'lost' ? 'btlLost' : 'btlConnecting')}</p>${s.status === 'lost' ? retryBtn() : ''}</div>`;
    else body = s.role === 'host' ? hostHtml(v) : playerHtml(v);
    const banner = s.status === 'reconnecting' ? T('btlReconnecting')
      : s.status === 'lost' && v ? T('btlLost')
      : v && v.hostOnline === false && s.role === 'player' && v.phase !== 'ended' ? T('btlHostAway') : '';
    inner.className = 'btl-inner btl-role-' + s.role + ' btl-phase-' + (v ? v.phase : 'wait');
    inner.innerHTML = `
      <header class="btl-bar">
        <span class="btl-bar-title">&#9876;&#65039; ${esc((v && v.title) || s.title || T('btlTitle'))}</span>
        ${v && (v.phase === 'question' || v.phase === 'reveal') ? `<span class="btl-bar-q">${T('btlQOf', { i: esc(v.qi + 1), n: esc(v.total) })}</span>` : ''}
        <span class="btl-bar-code">${s.role === 'host' ? T('btlCode') + ' ' + esc(prettyCode(s.code)) : esc(s.name || '')}</span>
        <button class="btl-x" data-btl="exit" aria-label="${T('close')}">&times;</button>
      </header>
      ${banner ? `<div class="btl-banner">${esc(banner)}${s.status === 'lost' ? ' ' + retryBtn() : ''}</div>` : ''}
      <main class="btl-main">${body}</main>`;
    clearInterval(tick);
    tick = null;
    if (v && v.phase === 'question') {
      updateTimer();
      tick = setInterval(updateTimer, 250);
    }
    if (s.role === 'host' && v && v.phase === 'lobby') drawQr();
  }

  function retryBtn() { return `<button class="btn-ghost cls-mini" data-btl="retry">${T('btlRetry')}</button>`; }

  function errorHtml() {
    const key = 'btlErr_' + (s.error || 'closed');
    const msg = T(key) === key ? T('btlErr_closed') : T(key);
    return `<div class="btl-center"><p class="btl-big">&#128683;</p><p>${esc(msg)}</p>
      <button class="btn-primary" data-btl="exit">${T('close')}</button></div>`;
  }

  function timerHtml() {
    return `<div class="btl-timer" style="--p:100"><span class="btl-timer-num">${remainSecs()}</span></div>`;
  }

  function optionsHtml(v, opts) {
    const q = v.question;
    const reveal = v.phase === 'reveal';
    return `<div class="btl-options${opts.big ? ' btl-options-big' : ''}">${q.o.map((o, i) => {
      const cls = ['btl-opt', 'btl-c' + i];
      if (reveal) cls.push(i === q.c ? 'btl-right' : 'btl-dim');
      if (opts.mine === i) cls.push('btl-mine');
      const tag = opts.clickable ? 'button' : 'div';
      return `<${tag} class="${cls.join(' ')}"${opts.clickable ? ` data-btl="choice" data-c="${i}" aria-label="${LETTERS[i]}: ${esc(o)}"` : ''}>
        <span class="btl-opt-key"><span aria-hidden="true">${SHAPES[i]}</span> ${LETTERS[i]}</span>
        ${opts.text ? `<span class="btl-opt-text">${esc(o)}</span>` : ''}
        ${reveal && i === q.c ? '<span class="btl-check" aria-hidden="true">&#10003;</span>' : ''}
      </${tag}>`;
    }).join('')}</div>`;
  }

  function boardHtml(list, limit) {
    if (!list || !list.length) return '';
    return `<ol class="btl-board">${list.slice(0, limit).map((p, i) => `
      <li class="btl-board-row${s.role === 'player' && p.name === s.name ? ' btl-board-me' : ''}" style="--i:${i}">
        <span class="btl-rank">${i + 1}</span><span class="btl-board-name">${esc(p.name)}</span><span class="btl-board-score">${esc(p.score)}</span>
      </li>`).join('')}</ol>`;
  }

  function podiumHtml(list) {
    const top = (list || []).slice(0, 3);
    const order = [1, 0, 2].filter(i => top[i]);
    return `<div class="btl-podium">${order.map(i => `
      <div class="btl-step btl-step-${i + 1}">
        <span class="btl-step-name">${esc(top[i].name)}</span>
        <span class="btl-step-score">${esc(top[i].score)}</span>
        <div class="btl-step-block">${i + 1}</div>
      </div>`).join('')}</div>`;
  }

  function hostHtml(v) {
    if (v.phase === 'lobby') {
      const players = (v.players || []).map(p => `<button class="btl-player${p.connected ? '' : ' btl-off'}" data-btl="kick" data-pid="${esc(p.pid)}" data-name="${esc(p.name)}" title="${T('btlKick')}">${esc(p.name)}</button>`).join('');
      return `<div class="btl-lobby">
        <div class="btl-join-card">
          <p class="btl-join-how">${T('btlJoinHow')}</p>
          <p class="btl-code-big">${esc(prettyCode(s.code))}</p>
          <p class="btl-link"><span>${esc(joinLink(s.code))}</span> <button class="btn-ghost cls-mini" data-btl="copy">${T('clsCopyLink')}</button></p>
          <div class="btl-qr" aria-hidden="true"></div>
        </div>
        <div class="btl-lobby-side">
          <p class="btl-count">${T('btlPlayersN', { n: (v.players || []).length })}</p>
          <div class="btl-players">${players || `<p class="cls-empty">${T('btlWaitingPlayers')}</p>`}</div>
          <button class="btn-primary btl-go" data-btl="start"${(v.players || []).length ? '' : ' disabled'}>${T('btlStart')}</button>
        </div>
      </div>`;
    }
    if (v.phase === 'question') {
      return `<div class="btl-stage">
        <div class="btl-q-row">${timerHtml()}<h2 class="btl-question">${esc(v.question.q)}</h2>
          <div class="btl-answered"><span class="btl-answered-num">${esc(v.answered)}</span><span>${T('btlAnswers')}</span></div></div>
        ${optionsHtml(v, { text: true })}
        <div class="btl-controls"><button class="btn-ghost" data-btl="close">${T('btlSkip')}</button></div>
      </div>`;
    }
    if (v.phase === 'reveal') {
      const max = Math.max(1, ...(v.dist || [0]));
      const bars = (v.dist || []).map((n, i) => `
        <div class="btl-bar-col btl-c${i}${i === v.question.c ? ' btl-right' : ''}">
          <span class="btl-bar-n">${esc(n)}</span>
          <div class="btl-bar-fill" style="height:${Math.round(n / max * 100)}%"></div>
          <span class="btl-bar-key">${SHAPES[i]} ${LETTERS[i]}${i === v.question.c ? ' &#10003;' : ''}</span>
        </div>`).join('');
      const last = v.qi + 1 >= v.total;
      return `<div class="btl-stage">
        <h2 class="btl-question btl-question-sm">${esc(v.question.q)}</h2>
        <div class="btl-reveal">
          <div class="btl-chart" role="img" aria-label="${T('btlDistribution')}">${bars}</div>
          <div class="btl-reveal-side">
            <p class="btl-correct-line">${T('btlCorrectWas')} <b>${LETTERS[v.question.c]}: ${esc(v.question.o[v.question.c])}</b></p>
            ${boardHtml(v.leaderboard, 5)}
          </div>
        </div>
        <div class="btl-controls"><button class="btn-primary btl-go" data-btl="next">${T(last ? 'btlPodium' : 'btlNext')}</button></div>
      </div>`;
    }
    return `<div class="btl-end"><h2 class="btl-end-title">&#127942; ${T('btlFinal')}</h2>${podiumHtml(v.leaderboard)}${boardHtml(v.leaderboard, 10)}
      <button class="btn-primary" data-btl="exit">${T('close')}</button></div>`;
  }

  function playerHtml(v) {
    const me = v.me || {};
    if (v.phase === 'lobby') {
      return `<div class="btl-center"><p class="btl-big">&#127918;</p>
        <h2>${T('btlYoureIn', { name: esc(me.name || s.name) })}</h2>
        <p class="cls-desc">${T('btlWaitHost')}</p>
        <p class="btl-count">${T('btlPlayersN', { n: esc(v.players || 0) })}</p></div>`;
    }
    if (v.phase === 'question') {
      if (s.choice != null) {
        return `<div class="btl-center">${timerHtml()}<p class="btl-locked btl-c${s.choice}">${SHAPES[s.choice]} ${LETTERS[s.choice]}</p>
          <h2>${T('btlLocked')}</h2><p class="cls-desc">${T('btlWaitOthers')}</p></div>`;
      }
      return `<div class="btl-play">
        <div class="btl-q-row btl-q-row-player">${timerHtml()}<p class="btl-question btl-question-player">${esc(v.question.q)}</p></div>
        ${optionsHtml(v, { clickable: true, text: true, big: true })}
      </div>`;
    }
    if (v.phase === 'reveal') {
      const r = v.result || { ok: false, pts: 0, choice: null };
      const verdict = r.choice == null ? T('btlNoAnswer') : r.ok ? T('btlRight') : T('btlWrong');
      return `<div class="btl-center btl-result ${r.ok ? 'btl-result-ok' : 'btl-result-bad'}">
        <p class="btl-big">${r.ok ? '&#10003;' : '&#10007;'}</p>
        <h2>${verdict}</h2>
        ${r.ok ? `<p class="btl-pts">+${Number(r.pts) || 0}</p>` : ''}
        <p class="cls-desc">${T('btlCorrectWas')} <b>${LETTERS[v.question.c]}: ${esc(v.question.o[v.question.c])}</b></p>
        <p class="btl-rankline">${T('btlRankLine', { rank: Number(me.rank) || '—', score: Number(me.score) || 0 })}${me.streak > 1 ? ' &middot; &#128293; ' + Number(me.streak) : ''}</p>
      </div>`;
    }
    return `<div class="btl-end"><h2 class="btl-end-title">&#127942; ${T('btlFinal')}</h2>
      <p class="btl-rankline">${T('btlRankLine', { rank: Number(me.rank) || '—', score: Number(me.score) || 0 })}</p>
      ${podiumHtml(v.leaderboard)}${boardHtml(v.leaderboard, 5)}
      <button class="btn-primary" data-btl="exit">${T('close')}</button></div>`;
  }

  // QR code for the join link. The tiny generator is loaded on demand from
  // the CDN; without it the code and link are shown on their own.
  function drawQr() {
    const box = ov && ov.querySelector('.btl-qr');
    if (!box || box.dataset.done) return;
    box.dataset.done = '1';
    if (!qrPromise) {
      qrPromise = window.qrcode ? Promise.resolve(window.qrcode) : new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = QR_SRC;
        sc.async = true;
        sc.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qr'));
        sc.onerror = () => reject(new Error('qr'));
        document.head.appendChild(sc);
      });
      qrPromise.catch(() => { qrPromise = null; });
    }
    const url = joinLink(s.code);
    qrPromise.then(qrcode => {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const live = ov && ov.querySelector('.btl-qr');
      if (live) live.innerHTML = qr.createSvgTag(5, 2);
    }).catch(() => { /* link + code only */ });
  }

  // ?battle=CODE opens the join form; a reload mid-game resumes the session.
  function init() {
    const params = new URLSearchParams(location.search);
    const code = (params.get('battle') || '').replace(/\D/g, '');
    if (params.has('battle')) {
      params.delete('battle');
      const qs = params.toString();
      history.replaceState({}, '', location.pathname + (qs ? '?' + qs : ''));
    }
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STORE)); } catch (e) { saved = null; }
    if (saved && saved.code && Date.now() - (saved.t || 0) < 2 * 3600 * 1000 && (!code || code === saved.code)) {
      begin({ role: saved.role === 'host' ? 'host' : 'player', code: saved.code, hostKey: saved.hostKey, name: saved.name, pid: saved.pid, token: saved.token });
      return;
    }
    if (/^\d{6}$/.test(code)) openJoin(code);
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));

  return { openHost, openJoin, exit, isActive: () => !!s };
})();
