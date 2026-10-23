// ===== Focus Timer (Pomodoro) =====
// A floating timer that survives reloads (state lives in localStorage as an
// absolute end time). Finished focus blocks are recorded in Stats, so a
// focus-only day still keeps the streak alive.
const Focus = (() => {
  const KEY = 'flashmind_focus_v1';
  const PRESETS = { '25': [25, 5], '50': [50, 10], '15': [15, 3] };
  let state = null; // { preset, phase: 'focus'|'break', endsAt, left (ms, when paused), running, blocks }
  let el = null, tick = null;
  const baseTitle = document.title;

  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { state = null; }
    if (!state || typeof state !== 'object' || !PRESETS[state.preset]) state = null;
  }

  function save() {
    try {
      if (state) localStorage.setItem(KEY, JSON.stringify(state));
      else localStorage.removeItem(KEY);
    } catch (e) { /* non-fatal */ }
  }

  function phaseMs(phase) {
    const p = PRESETS[state.preset];
    return (phase === 'break' ? p[1] : p[0]) * 60 * 1000;
  }

  function remaining() {
    if (!state) return 0;
    return state.running ? Math.max(0, state.endsAt - Date.now()) : state.left;
  }

  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ----- Controls -----

  function open() {
    if (!state) {
      let preset = '25';
      try { preset = localStorage.getItem('flashmind_focus_preset') || '25'; } catch (e) {}
      if (!PRESETS[preset]) preset = '25';
      state = { preset, phase: 'focus', running: false, left: 0, endsAt: 0, blocks: 0 };
      state.left = phaseMs('focus');
      save();
    }
    render();
  }

  function start() {
    if (!state) open();
    if (state.running) return;
    state.running = true;
    state.endsAt = Date.now() + (state.left || phaseMs(state.phase));
    save();
    ensureTick();
    render();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function pause() {
    if (!state || !state.running) return;
    state.left = remaining();
    state.running = false;
    save();
    render();
  }

  function reset() {
    if (!state) return;
    state.running = false;
    state.left = phaseMs(state.phase);
    save();
    render();
  }

  function skip() {
    if (!state) return;
    switchPhase(false);
  }

  function close() {
    state = null;
    save();
    clearInterval(tick); tick = null;
    document.title = baseTitle;
    if (el) el.remove();
    el = null;
  }

  function setPreset(preset) {
    if (!PRESETS[preset] || !state) return;
    state.preset = preset;
    try { localStorage.setItem('flashmind_focus_preset', preset); } catch (e) {}
    state.running = false;
    state.phase = 'focus';
    state.left = phaseMs('focus');
    save();
    render();
  }

  // Phase over (or skipped): a completed focus block is recorded, then the
  // timer flips to the other phase and waits for the user to start it.
  function switchPhase(completed) {
    const T = i18n.t;
    if (completed && state.phase === 'focus') {
      const mins = PRESETS[state.preset][0];
      state.blocks = (state.blocks || 0) + 1;
      if (typeof Stats !== 'undefined') Stats.recordFocus(mins);
      notify(T('focusDoneTitle'), T('focusDoneBody', { n: mins }));
      if (typeof Sound !== 'undefined') Sound.play('complete');
      if (typeof FX !== 'undefined' && FX.celebrate) FX.celebrate();
    } else if (completed) {
      notify(T('focusBreakOverTitle'), T('focusBreakOverBody'));
      if (typeof Sound !== 'undefined') Sound.play('correct');
    }
    state.phase = state.phase === 'focus' ? 'break' : 'focus';
    state.running = false;
    state.left = phaseMs(state.phase);
    save();
    render();
    const statsTab = document.getElementById('tab-stats');
    if (completed && statsTab && statsTab.classList.contains('active') && typeof Stats !== 'undefined') Stats.render();
  }

  function notify(title, body) {
    if (typeof App !== 'undefined') App.showToast(body, 'success');
    if (document.visibilityState === 'visible') return;
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    } catch (e) { /* SW-only platforms — the toast is enough */ }
  }

  function ensureTick() {
    if (tick) return;
    tick = setInterval(() => {
      if (!state) { clearInterval(tick); tick = null; return; }
      if (state.running && remaining() <= 0) { switchPhase(true); return; }
      update();
    }, 500);
  }

  // ----- Rendering -----

  function render() {
    if (!state) return;
    const T = i18n.t;
    if (!el) {
      el = document.createElement('div');
      el.className = 'focus-widget';
      el.setAttribute('role', 'timer');
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-focus]');
        if (!b) return;
        const a = b.dataset.focus;
        if (a === 'start') start();
        else if (a === 'pause') pause();
        else if (a === 'reset') reset();
        else if (a === 'skip') skip();
        else if (a === 'close') close();
        else if (a === 'min') { el.classList.toggle('minimized'); }
        else if (a === 'preset') setPreset(b.dataset.preset);
      });
    }
    el.classList.toggle('on-break', state.phase === 'break');
    el.classList.toggle('running', !!state.running);
    el.innerHTML = `
      <button class="focus-ring-btn" data-focus="min" aria-label="${T('focusTitle')}">
        <svg viewBox="0 0 44 44" class="focus-ring"><circle cx="22" cy="22" r="19" class="focus-ring-bg"/><circle cx="22" cy="22" r="19" class="focus-ring-fill" pathLength="100"/></svg>
        <span class="focus-time"></span>
      </button>
      <div class="focus-body">
        <span class="focus-phase">${state.phase === 'break' ? '&#9749; ' + T('focusBreak') : '&#127919; ' + T('focusFocus')}${state.blocks ? ` <span class="focus-blocks">&times;${state.blocks}</span>` : ''}</span>
        <div class="focus-controls">
          ${state.running
            ? `<button class="btn-ghost" data-focus="pause">${T('focusPause')}</button>`
            : `<button class="btn-primary" data-focus="start">${T('focusStart')}</button>`}
          <button class="btn-icon" data-focus="reset" title="${T('focusReset')}" aria-label="${T('focusReset')}">&#8635;</button>
          <button class="btn-icon" data-focus="skip" title="${T('focusSkip')}" aria-label="${T('focusSkip')}">&#9197;</button>
          <button class="btn-icon" data-focus="close" title="${T('focusClose')}" aria-label="${T('focusClose')}">&times;</button>
        </div>
        ${state.running ? '' : `<div class="focus-presets">${Object.keys(PRESETS).map(k =>
          `<button class="focus-preset${k === state.preset ? ' active' : ''}" data-focus="preset" data-preset="${k}">${PRESETS[k][0]}/${PRESETS[k][1]}</button>`).join('')}</div>`}
      </div>`;
    update();
    if (state.running) ensureTick();
  }

  function update() {
    if (!el || !state) return;
    const left = remaining();
    const total = phaseMs(state.phase);
    el.querySelector('.focus-time').textContent = fmt(left);
    el.querySelector('.focus-ring-fill').style.strokeDashoffset = String(100 - (left / total) * 100);
    document.title = state.running ? `${state.phase === 'break' ? '☕' : '⏱'} ${fmt(left)} · FlashMind` : baseTitle;
  }

  function toggle() {
    if (state) close(); else open();
  }

  function init() {
    load();
    if (state) {
      // A block that ran out while the app was closed still counts.
      if (state.running && state.endsAt <= Date.now()) switchPhase(true);
      else render();
    }
    document.querySelectorAll('.focus-toggle').forEach(btn => btn.addEventListener('click', toggle));
  }

  return { init, open, start, pause, reset, skip, close, toggle, setPreset, isOpen: () => !!state };
})();
