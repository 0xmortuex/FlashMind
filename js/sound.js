// ===== Sound Module =====
// Opt-in UI sounds + haptics. Everything is synthesized with WebAudio (no
// audio files), OFF by default, and persisted. Haptics ride the same toggle.
const Sound = (() => {
  const KEY = 'flashmind_sound';
  let on = localStorage.getItem(KEY) === '1';
  let ctx = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One enveloped oscillator note. `when`/`dur` in seconds, `glide` slides the
  // pitch down to that frequency across the note.
  function tone(freq, dur, { type = 'sine', gain = 0.12, when = 0, glide = 0 } = {}) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const fx = {
    click: () => tone(700, 0.05, { type: 'triangle', gain: 0.05 }),
    flip: () => { tone(320, 0.07, { type: 'triangle', gain: 0.07 }); tone(520, 0.09, { type: 'triangle', gain: 0.06, when: 0.045 }); },
    correct: () => { tone(523.25, 0.09, { gain: 0.1 }); tone(783.99, 0.16, { gain: 0.1, when: 0.08 }); },
    wrong: () => tone(200, 0.22, { type: 'sawtooth', gain: 0.06, glide: 130 }),
    complete: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.16, { gain: 0.09, when: i * 0.085 })),
  };

  function play(name) {
    if (!on || !fx[name]) return;
    try { fx[name](); } catch (e) { /* audio unavailable — non-fatal */ }
  }

  function haptic(pattern) {
    if (!on || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* non-fatal */ }
  }

  function isOn() { return on; }

  function sync() {
    document.querySelectorAll('.sound-toggle').forEach(b => b.classList.toggle('on', on));
  }

  function toggle() {
    on = !on;
    localStorage.setItem(KEY, on ? '1' : '0');
    sync();
    if (on) play('correct');
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(i18n.t(on ? 'soundOnToast' : 'soundOffToast'), 'info');
    }
  }

  function init() {
    document.querySelectorAll('.sound-toggle').forEach(b => b.addEventListener('click', toggle));
    sync();
  }

  return { init, play, haptic, isOn, toggle };
})();
