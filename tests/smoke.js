// FlashMind smoke test: load app, exercise the new UI paths, report errors.
// CI-friendly: uses full puppeteer (bundled Chromium), BASE_URL env override,
// and exits non-zero when any step fails or console/page errors are collected.
const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4173/';
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-first-run', '--disable-extensions', '--window-size=1280,900',
      // GitHub's Ubuntu 24.04 runners restrict unprivileged user namespaces,
      // which breaks Chrome's sandbox — CI runs unsandboxed.
      ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  // Accept confirms (finish-exam flow), dismiss prompts/alerts.
  page.on('dialog', d => (d.type() === 'confirm' ? d.accept() : d.dismiss()).catch(() => {}));
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  let failCount = 0;
  const step = async (name, fn) => {
    try { await fn(); console.log('PASS  ' + name); }
    catch (e) { failCount++; console.log('FAIL  ' + name + ' — ' + e.message); }
  };

  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  await step('home renders with input card', async () => {
    await page.waitForSelector('.input-card', { timeout: 3000 });
  });

  await step('load demo deck', async () => {
    await page.click('#demo-btn');
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
  });

  await step('tab indicator exists and is positioned', async () => {
    await page.waitForSelector('.tab-indicator', { timeout: 2000 });
    // Its width transitions from zero when the previously hidden view opens.
    await page.waitForFunction(() => document.querySelector('.tab-indicator').getBoundingClientRect().width >= 10, { timeout: 2000 });
    const w = await page.$eval('.tab-indicator', el => el.getBoundingClientRect().width);
    if (w < 10) throw new Error('indicator width ' + w);
  });

  await step('switch to flashcards (directional slide + stagger)', async () => {
    await page.click('[data-tab="flashcards"]');
    await page.waitForSelector('#tab-flashcards.active .flashcard', { timeout: 2000 });
    const hasDiff = await page.$eval('#tab-flashcards .flashcard', el => /diff-(easy|medium|hard)/.test(el.className));
    if (!hasDiff) throw new Error('difficulty class missing');
  });

  await step('filter FLIP does not crash', async () => {
    await page.evaluate(() => Flashcards.setFilter('hard'));
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => Flashcards.setFilter('all'));
  });

  await step('study mode: flip + drag-right rates card', async () => {
    await page.evaluate(() => Flashcards.startStudy('all'));
    await page.waitForSelector('#study-mode-overlay', { visible: true, timeout: 2000 });
    const before = await page.$eval('#study-progress-text', el => el.textContent);
    await page.click('#study-card');                       // flip
    await new Promise(r => setTimeout(r, 700));
    const flipped = await page.$eval('#study-card', el => el.classList.contains('flipped'));
    if (!flipped) throw new Error('card did not flip');
    // drag right past threshold
    const box = await (await page.$('#study-card')).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 20, cy - i * 2);
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 800));
    const after = await page.$eval('#study-progress-text', el => el.textContent);
    if (before === after) throw new Error('progress did not advance (' + before + ' -> ' + after + ')');
    await page.evaluate(() => document.getElementById('study-mode-close').click());
  });

  await step('notes reading progress bar updates on scroll', async () => {
    await page.click('[data-tab="notes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await new Promise(r => setTimeout(r, 400));
    const w = await page.$eval('.read-progress', el => parseFloat(el.style.width) || 0);
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight > 40);
    if (scrollable && w < 50) throw new Error('progress width ' + w + '% after full scroll');
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await step('shortcuts overlay opens on ? and closes on Esc', async () => {
    await page.keyboard.press('?');
    await page.waitForSelector('.shortcuts-card', { visible: true, timeout: 2000 });
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    const visible = await page.$eval('.shortcuts-backdrop', el => el.style.display !== 'none');
    if (visible) throw new Error('overlay did not close');
  });

  await step('exam tab renders ready screen', async () => {
    await page.click('[data-tab="quiz"]');
    await page.waitForSelector('#start-quiz-btn', { timeout: 2000 });
    // enable the per-question timer so the countdown ring renders
    await page.click('#timer-toggle');
  });

  await step('answer MC question shows drawn check', async () => {
    await page.click('#start-quiz-btn');
    await page.waitForSelector('#quiz-timer-ring', { timeout: 2000 }); // countdown ring present
    // Advance through the shuffled exam until a multiple-choice question
    // appears, answering each type minimally along the way.
    let verified = false;
    for (let i = 0; i < 10 && !verified; i++) {
      await page.waitForSelector('#quiz-body', { timeout: 2000 });
      await new Promise(r => setTimeout(r, 250));
      if (await page.$('.quiz-options:not(.tf-options) .quiz-option')) {
        await page.click('.quiz-options:not(.tf-options) .quiz-option');
        await new Promise(r => setTimeout(r, 400));
        if (!await page.$('.opt-check')) throw new Error('no drawn checkmark rendered');
        verified = true;
      } else if (await page.$('.tf-option')) {
        await page.click('.tf-option');
      } else if (await page.$('#fill-input')) {
        await page.type('#fill-input', 'x');
        await page.click('#fill-submit-btn');
      } else if (await page.$('#match-submit-btn')) {
        await page.click('#match-submit-btn');
      } else if (await page.$('#oe-submit-btn')) {
        await page.click('#oe-submit-btn');
      }
      if (!verified) {
        await page.waitForSelector('#quiz-next-btn', { timeout: 8000 });
        await page.click('#quiz-next-btn');
      }
    }
    if (!verified) throw new Error('never reached an MC question');
  });

  await step('Enter key advances to the next question', async () => {
    await page.waitForSelector('#quiz-next-btn', { timeout: 2000 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 400));
    if (await page.$('#quiz-next-btn')) throw new Error('next button still present');
  });

  await step('FSRS state written after rating', async () => {
    const srs = await page.evaluate(() => {
      const deck = Decks.getActive();
      return Object.values(deck.srs || {})[0] || null;
    });
    if (!srs || typeof srs.stab !== 'number' || typeof srs.diff !== 'number') {
      throw new Error('FSRS fields missing: ' + JSON.stringify(srs));
    }
  });

  await step('TTS button present in study header', async () => {
    if (!await page.$('#study-tts')) throw new Error('no #study-tts');
  });

  await step('mistake notebook: retake button appears', async () => {
    await page.evaluate(() => {
      Decks.addMistakes([{ id: 999, type: 'multiple-choice', question: 'Smoke test q?', options: ['a', 'b', 'c', 'd', 'e'], correct: 0, explanation: '' }]);
      Quiz.renderReady();
    });
    await page.waitForSelector('#retake-mistakes-btn', { timeout: 2000 });
    await page.evaluate(() => { Decks.resolveMistakes([{ type: 'multiple-choice', question: 'Smoke test q?' }]); Quiz.renderReady(); });
  });

  await step('CSV parser handles quoted CSV and TSV', async () => {
    const counts = await page.evaluate(() => [
      Parser.parseCSVCards('front,back\n"What, is ""X""?","It is X",hard,Topic\nQ2,A2').length,
      Parser.parseCSVCards('#separator:tab\nQ1\tA1\nQ2\tA2\nQ3\tA3').length
    ]);
    if (counts[0] !== 2 || counts[1] !== 3) throw new Error('parsed ' + counts.join(','));
  });

  await step('cloze cards generate and persist to the deck', async () => {
    await page.evaluate(() => App.switchTab('flashcards'));
    await new Promise(r => setTimeout(r, 300));
    const before = await page.evaluate(() => App.getStudyData().flashcards.length);
    const btn = await page.$('button[onclick="Flashcards.addClozeCards()"]');
    if (!btn) throw new Error('cloze button missing');
    await btn.click();
    await new Promise(r => setTimeout(r, 500));
    const counts = await page.evaluate(() => [App.getStudyData().flashcards.length, Decks.getActive().data.flashcards.length]);
    if (counts[0] <= before) throw new Error('no cards added (' + before + ' -> ' + counts[0] + ')');
    if (counts[1] !== counts[0]) throw new Error('not persisted: deck ' + counts[1] + ' vs memory ' + counts[0]);
  });

  await step('simulation exam: silent answers, navigator, finish to results', async () => {
    await page.evaluate(() => { App.switchTab('quiz'); Quiz.renderReady(); });
    await page.waitForSelector('[data-mode="sim"]', { timeout: 2000 });
    await page.click('[data-mode="sim"]');
    await page.click('#start-quiz-btn');
    await page.waitForSelector('.sim-nav .sim-chip', { timeout: 2000 });
    // Answer one question — sim mode must stay silent (no feedback leak).
    const opt = await page.$('.quiz-option:not(.disabled)');
    if (opt) {
      await opt.click();
      await new Promise(r => setTimeout(r, 400));
      if (await page.$('.opt-check')) throw new Error('sim mode leaked per-question feedback');
    }
    await page.click('#sim-finish-btn'); // confirm dialog auto-accepted
    await page.waitForSelector('.quiz-score-ring', { timeout: 3000 });
    await page.evaluate(() => Quiz.renderReady()); // reset for later steps
  });

  await step('stats tab renders tiles, forecast and heatmap', async () => {
    await page.click('[data-tab="stats"]');
    await new Promise(r => setTimeout(r, 1200));
    if (!(await page.$$('.stat-tile')).length) throw new Error('no stat tiles');
    if (!await page.$('.heatmap')) throw new Error('no heatmap');
  });

  await step('command palette opens and filters', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.palette-input', { visible: true, timeout: 2000 });
    const count = await page.$$eval('.palette-item', els => els.length);
    if (!count) throw new Error('no palette items');
    await page.keyboard.press('Escape');
  });

  await step('theme toggle works', async () => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#theme-toggle-study');
    await new Promise(r => setTimeout(r, 800));
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    if (before === after) throw new Error('theme unchanged');
  });

  await step('back to home shows deck library with mastery ring', async () => {
    await page.click('#back-to-input');
    await page.waitForSelector('#deck-library .deck-card', { timeout: 2000 });
    const ring = await page.$('.deck-ring-fill');
    if (!ring) throw new Error('no mastery ring');
  });

  await step('URL import row present on paste panel', async () => {
    if (!await page.$('#url-import-input')) throw new Error('no url input');
  });

  await step('deck kebab menu duplicates a deck', async () => {
    const before = await page.evaluate(() => Decks.list().length);
    await page.click('.deck-card-menu-btn');
    await page.waitForSelector('.deck-menu [data-act="duplicate"]', { visible: true, timeout: 2000 });
    await page.click('.deck-menu [data-act="duplicate"]');
    await new Promise(r => setTimeout(r, 400));
    const after = await page.evaluate(() => Decks.list().length);
    if (after !== before + 1) throw new Error(`deck count ${before} -> ${after}`);
  });

  await step('sync modal opens with enable/enter options', async () => {
    await page.evaluate(() => Sync.openModal());
    await page.waitForSelector('#sync-enable-btn', { visible: true, timeout: 2000 });
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
  });

  await step('card editor adds and persists a card', async () => {
    await page.evaluate(() => { App.openDeck(Decks.list()[0].id); App.switchTab('flashcards'); });
    await new Promise(r => setTimeout(r, 400));
    const before = await page.evaluate(() => App.getStudyData().flashcards.length);
    await page.evaluate(() => Flashcards.openEditor());
    await page.waitForSelector('#card-edit-front', { visible: true, timeout: 2000 });
    await page.type('#card-edit-front', 'Smoke card front?');
    await page.type('#card-edit-back', 'Smoke card back');
    await page.click('#card-edit-save');
    await new Promise(r => setTimeout(r, 300));
    const counts = await page.evaluate(() => [App.getStudyData().flashcards.length, Decks.getActive().data.flashcards.length]);
    if (counts[0] !== before + 1) throw new Error('card not added');
    if (counts[1] !== counts[0]) throw new Error('card not persisted to deck');
  });

  await step('cram + add-card + typed-recall controls present', async () => {
    const html = await page.$eval('#tab-flashcards', el => el.innerHTML);
    if (!html.includes("startStudy('cram')")) throw new Error('no cram button');
    if (!html.includes('Flashcards.openEditor()')) throw new Error('no add-card button');
    if (!await page.$('#study-typed-toggle')) throw new Error('no typed-recall toggle');
  });

  await step('question bank + harder-retake controls on exam ready screen', async () => {
    await page.evaluate(() => { App.switchTab('quiz'); Quiz.renderReady(); });
    await page.waitForSelector('#gen-more-q-btn', { timeout: 2000 });
  });

  await step('exam results include accuracy breakdown', async () => {
    // Earlier steps left simulation mode selected — back to practice so the
    // per-question next-button flow applies.
    await page.click('[data-mode="practice"]');
    await new Promise(r => setTimeout(r, 200));
    // Deterministic mini-exam: two types so the breakdown has >= 2 groups.
    await page.evaluate(() => Quiz.startQuiz([
      { id: 9001, type: 'multiple-choice', question: 'Smoke MC?', options: ['a', 'b', 'c', 'd', 'e'], correct: 0, explanation: '' },
      { id: 9002, type: 'true-false', question: 'Smoke TF?', correct: true, explanation: '' },
    ]));
    await page.waitForSelector('#quiz-body', { timeout: 2000 });
    for (let i = 0; i < 4 && !(await page.$('.quiz-score-ring')); i++) {
      if (await page.$('.quiz-options:not(.tf-options) .quiz-option')) await page.click('.quiz-options:not(.tf-options) .quiz-option');
      else if (await page.$('.tf-option')) await page.click('.tf-option');
      await new Promise(r => setTimeout(r, 300));
      const next = await page.$('#quiz-next-btn');
      if (next) await next.click();
      await new Promise(r => setTimeout(r, 300));
    }
    await page.waitForSelector('.quiz-breakdown', { timeout: 2000 });
    await page.evaluate(() => Quiz.renderReady());
  });

  await step('deck menu has folder + merge actions', async () => {
    await page.click('#back-to-input');
    await page.waitForSelector('#deck-library .deck-card', { timeout: 2000 });
    if (!await page.$('.deck-menu [data-act="folder"]')) throw new Error('no folder action');
    if (!await page.$('.deck-menu [data-act="merge"]')) throw new Error('no merge action');
  });

  await step('Today queue module wired (badge + due aggregation)', async () => {
    const ok = await page.evaluate(() => {
      const deck = Decks.list()[0];
      const card = deck.data.flashcards[0];
      deck.srs[card.id] = { stab: 1, diff: 5, reps: 1, lapses: 0, due: Date.now() - 1000, last: Date.now() - 86400000 };
      return Today.dueItems().length > 0;
    });
    if (!ok) throw new Error('dueAcrossDecks empty after forcing a due card');
    await page.evaluate(() => Library.render());
    await page.waitForSelector('#today-review-btn', { timeout: 2000 });
  });

  // ===== Study studio features =====
  await step('studio: open demo for studio checks', async () => {
    await page.evaluate(() => document.getElementById('demo-btn').click());
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
  });

  await step('studio: formulas are typeset (MathRender pipeline)', async () => {
    await page.evaluate(() => {
      // Deterministic: stub KaTeX when the CDN copy hasn't loaded.
      if (!window.katex) window.katex = { render(tex, el) { el.textContent = tex; } };
      const p = document.createElement('p');
      p.id = 'math-probe';
      p.textContent = 'Area is $\\pi r^2$ and costs $5 or $10.';
      document.getElementById('tab-notes').appendChild(p);
    });
    await page.waitForSelector('#math-probe .math-inline', { timeout: 3000 });
    const n = await page.$$eval('#math-probe .math-inline', els => els.length);
    if (n !== 1) throw new Error('expected exactly one formula (prices stay text), got ' + n);
    await page.evaluate(() => document.getElementById('math-probe').remove());
  });

  await step('studio: mind map renders, expands, and builds with AI', async () => {
    await page.click('[data-tab="notes"]');
    await page.click('[data-notes-view="map"]');
    await page.waitForSelector('.mm-svg [data-mm="0.0"]', { timeout: 2000 });
    const before = await page.$$eval('.mm-node', els => els.length);
    await page.click('[data-mm="0.0"]');
    await page.waitForFunction(n => document.querySelectorAll('.mm-node').length > n, { timeout: 2000 }, before);
    await page.evaluate(() => {
      window.__chat = API.chat;
      API.chat = async () => JSON.stringify({ type: 'mindmap', root: { label: 'Root', children: [{ label: 'Branch', detail: 'd', children: [] }] } });
    });
    await page.click('[data-mm-act="ai"]');
    await page.waitForFunction(() => App.getStudyData().notes.mindmap && document.querySelector('[data-mm-act="outline"]'), { timeout: 3000 });
    await page.evaluate(() => { API.chat = window.__chat; });
    await page.click('[data-mm-act="outline"]');
  });

  await step('studio: audio overview (offline recap) builds a transcript', async () => {
    await page.click('[data-notes-view="audio"]');
    await page.click('[data-audio-format="recap"]');
    await page.click('[data-audio-act="generate"]');
    await page.waitForSelector('.audio-line', { timeout: 2000 });
    if (!await page.evaluate(() => Decks.getActive().data.audio.lines.length > 2)) throw new Error('script not saved');
    await page.click('[data-notes-view="notes"]');
  });

  await step('studio: chat citations are verified against the material', async () => {
    await page.click('[data-tab="chat"]');
    const classes = await page.evaluate(async () => {
      const api = API.chat;
      API.chat = async () => JSON.stringify({ answer: 'x', citations: ['Oxygen comes from splitting water, not from carbon dioxide.', 'Totally invented sentence about moon plants.'] });
      await Chat.sendMessage('where does oxygen come from?');
      API.chat = api;
      return [...document.querySelectorAll('.citation')].map(c => c.className);
    });
    if (classes.length !== 2 || /unverified/.test(classes[0]) || !/unverified/.test(classes[1])) throw new Error(JSON.stringify(classes));
  });

  await step('studio: exam date drives the plan bar and stats plan', async () => {
    await page.evaluate(() => {
      const d = new Date(Date.now() + 5 * 86400000);
      Decks.setExamDate(Decks.getActive().id, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
      Planner.refresh();
    });
    await page.click('[data-tab="flashcards"]');
    await page.waitForSelector('.plan-bar .plan-countdown', { timeout: 2000 });
    await page.click('[data-tab="stats"]');
    await page.waitForSelector('.plan-card .plan-row.today', { timeout: 2000 });
  });

  await step('studio: image occlusion cards render masked and revealed', async () => {
    await page.click('[data-tab="flashcards"]');
    const n = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 100;
      return Occlusion.buildCards(c.toDataURL('image/jpeg'), [{ x: 0.1, y: 0.1, w: 0.3, h: 0.2, label: 'A' }, { x: 0.5, y: 0.5, w: 0.3, h: 0.2, label: 'B' }], { mode: 'all' });
    });
    if (n !== 2) throw new Error('cards ' + n);
    await page.waitForSelector('.flashcard .occl-box.target', { timeout: 2000 });
    await page.waitForSelector('.flashcard .occl-box.revealed', { timeout: 2000 });
  });

  await step('studio: focus timer starts and shows the countdown', async () => {
    await page.evaluate(() => { Focus.open(); Focus.start(); });
    await page.waitForSelector('.focus-widget.running .focus-time', { timeout: 2000 });
    await page.evaluate(() => Focus.close());
  });

  await step('studio: staged sources combine into one generation', async () => {
    await page.click('#back-to-input');
    await page.click('[data-input-tab="paste"]');
    await page.evaluate(() => {
      Sources.stage('A', 'paste', 'First source about mitosis.');
      Sources.stage('B', 'url', 'Second source about meiosis.');
    });
    await page.waitForSelector('#source-tray .source-chip', { timeout: 2000 });
    const ok = await page.evaluate(async () => {
      const gs = API.generateStream;
      let sent = '';
      API.generateStream = async t => { sent = t; return JSON.stringify({ title: 'Combo', notes: { summary: 's' }, flashcards: [{ front: 'f', back: 'b' }], quiz: [{ question: 'q', options: ['a', 'b'], correct: 0 }] }); };
      document.getElementById('paste-input').value = '';
      document.getElementById('generate-btn').click();
      await new Promise(r => setTimeout(r, 500));
      API.generateStream = gs;
      return sent.includes('=== Source 2: B ===') && (App.getStudyData().sources || []).length === 2;
    });
    if (!ok) throw new Error('sources not combined');
    await page.waitForSelector('.sources-bar .source-chip', { timeout: 2000 });
  });

  await step('voice tutor: token, live audio both ways, transcript, clean shutdown', async () => {
    await page.evaluate(() => {
      document.getElementById('demo-btn').click();
      window.__voice = { sent: [], ws: null };
      API.liveToken = async () => ({ token: 'auth_tokens/smoke', model: 'gemini-3.8-live', maxMinutes: 15 });
      // A synthetic microphone: an oscillator routed into a MediaStream.
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest); osc.start();
        return dest.stream;
      };
      class FakeWS {
        constructor(url) { this.url = url; this.readyState = 0; window.__voice.ws = this; setTimeout(() => { this.readyState = 1; this.onopen(); }, 10); }
        send(raw) {
          const m = JSON.parse(raw); window.__voice.sent.push(m);
          const reply = o => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 5);
          if (m.setup) reply({ setupComplete: {} });
          if (m.clientContent) {
            reply({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: btoa('\0\0'.repeat(480)) } }] }, outputTranscription: { text: 'What is photosynthesis?' } } });
            reply({ serverContent: { turnComplete: true } });
          }
          if (m.realtimeInput && !this.heard) { this.heard = true; reply({ serverContent: { inputTranscription: { text: 'Plants make food from light.' } } }); }
        }
        close() { this.readyState = 3; this.closed = true; }
      }
      FakeWS.OPEN = 1;
      window.WebSocket = FakeWS;
    });
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
    await page.click('[data-tab="chat"]');
    await page.click('#voice-open-btn');
    await page.click('[data-voice-act="start"]');
    await page.waitForFunction(() => document.querySelectorAll('.voice-line').length === 2, { timeout: 6000 });
    await page.waitForFunction(() => /^14:5\d$/.test(document.getElementById('voice-timer').textContent), { timeout: 4000 });
    const audio = await page.evaluate(() => window.__voice.sent.filter(m => m.realtimeInput).map(m => m.realtimeInput.audio));
    if (!audio.length || audio[0].mimeType !== 'audio/pcm;rate=16000' || atob(audio[0].data).length !== 1024) throw new Error('bad mic audio ' + JSON.stringify(audio[0]));
    await page.click('[data-voice-act="stop"]');
    await page.waitForSelector('.voice-status.ended', { timeout: 2000 });
    if (!await page.evaluate(() => window.__voice.ws.closed)) throw new Error('socket left open');
    await page.click('[data-voice-act="close"]');
  });

  await step('voice tutor: pause stops the mic, continue resumes, and a dropped session continues with its transcript', async () => {
    await page.click('#voice-open-btn');
    await page.click('[data-voice-act="start"]');
    await page.waitForFunction(() => document.querySelectorAll('.voice-line').length === 2, { timeout: 6000 });
    const micCount = () => page.evaluate(() => window.__voice.sent.filter(m => m.realtimeInput).length);
    await page.click('[data-voice-act="pause"]');
    await page.waitForSelector('.voice-status.paused', { timeout: 2000 });
    const atPause = await micCount();
    await new Promise(r => setTimeout(r, 400));
    if (await micCount() !== atPause) throw new Error('mic audio still sent while paused');
    await page.click('[data-voice-act="resume"]');
    await page.waitForFunction(n => window.__voice.sent.filter(m => m.realtimeInput).length > n, { timeout: 3000 }, atPause);
    // The server drops the connection (time ran out): Continue reconnects
    // and hands the tutor the transcript instead of starting over.
    const firstWs = await page.evaluateHandle(() => window.__voice.ws);
    await page.evaluate(() => { const ws = window.__voice.ws; ws.readyState = 3; ws.onclose({ code: 1000, reason: '' }); });
    await page.waitForSelector('[data-voice-act="continue"]', { timeout: 2000 });
    await page.evaluate(() => { window.__voice.sent = []; });
    await page.click('[data-voice-act="continue"]');
    await page.waitForFunction(() => window.__voice.sent.some(m => m.clientContent), { timeout: 4000 });
    const kick = await page.evaluate(() => window.__voice.sent.find(m => m.clientContent).clientContent.turns[0].parts[0].text);
    if (!/Transcript so far/.test(kick) || !/What is photosynthesis\?/.test(kick)) throw new Error('continue lost the transcript: ' + kick.slice(0, 120));
    if (await page.evaluate(w => w === window.__voice.ws, firstWs)) throw new Error('continue did not reconnect');
    if (await page.$$eval('.voice-line', l => l.length) < 2) throw new Error('earlier transcript not shown');
    await page.click('[data-voice-act="stop"]');
    await page.click('[data-voice-act="close"]');
  });

  await step('accuracy: answer checker flags a wrong card, applies the fix, and marks exam questions', async () => {
    await page.evaluate(() => { document.getElementById('demo-btn').click(); });
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
    await page.evaluate(() => {
      window.__chkChat = API.chat;
      API.chat = async (prompt) => {
        const refs = [...prompt.matchAll(/^\[([cq]\d+)\]/gm)].map(m => m[1]);
        return JSON.stringify({ type: 'verify', results: refs.map(ref => ref === 'c1'
          ? { ref, verdict: 'wrong', problem: 'Plants release oxygen.', fix: 'Oxygen (O2)' }
          : ref === 'q1' ? { ref, verdict: 'ambiguous', problem: 'Two options fit.', fix: '' }
          : { ref, verdict: 'ok' }) });
      };
    });
    await page.click('[data-tab="flashcards"]');
    await page.click('[data-chk-act="run"]');
    await page.waitForSelector('.flashcard .chk-badge.wrong', { timeout: 5000 });
    await page.click('[data-chk-act="review"]');
    await page.waitForSelector('[data-chk-fix="c1"]', { timeout: 2000 });
    await page.click('[data-chk-fix="c1"]');
    const back = await page.evaluate(() => App.getStudyData().flashcards.find(c => c.id === 1).back);
    if (back !== 'Oxygen (O2)') throw new Error('fix not applied: ' + back);
    if (!await page.evaluate(() => Decks.getActive().data.quiz.find(q => q.id === 1).check.v === 'ambiguous')) throw new Error('question verdict not saved');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { API.chat = window.__chkChat; });
  });

  await step('accuracy: confidence buttons flip the card and feed calibration', async () => {
    await page.evaluate(() => Flashcards.startStudy('cram'));
    if (await page.$eval('#study-confidence', el => el.style.display) !== 'none') throw new Error('confidence shown in cram');
    await page.evaluate(() => { document.getElementById('study-mode-close').click(); Flashcards.startStudy('all'); });
    await page.waitForSelector('#study-confidence', { visible: true, timeout: 2000 });
    await page.keyboard.press('e');
    await page.waitForSelector('#study-card.flipped', { timeout: 2000 });
    await page.keyboard.press('1');
    await page.waitForFunction(() => { const c = Decks.getActive().calib || {}; return Object.values(c).some(x => x.sure && x.sure[1] === 1); }, { timeout: 2000 });
    await page.evaluate(() => document.getElementById('study-mode-close').click());
    await page.click('[data-tab="stats"]');
    await page.waitForSelector('[data-ins-act="study-over"]', { timeout: 2000 });
  });

  await step('accuracy: exam answers feed prediction, adaptive practice, and mistake tags', async () => {
    await page.click('[data-tab="quiz"]');
    await page.evaluate(() => {
      const qs = App.getStudyData().quiz;
      Decks.recordAnswers(qs.map((q, i) => ({ id: q.id, ok: i % 2 === 0 })));
      Quiz.renderReady();
    });
    await page.waitForSelector('#adaptive-quiz-btn', { timeout: 2000 });
    const hint = await page.$eval('.adaptive-hint', el => el.textContent);
    if (!/\d+\/100/.test(hint)) throw new Error('no prediction: ' + hint);
    await page.click('#adaptive-quiz-btn');
    await page.waitForSelector('#quiz-body', { timeout: 2000 });
    const n = await page.evaluate(() => App.getStudyData().quiz.length);
    const label = await page.$eval('.quiz-question-number', el => el.textContent);
    if (!label.includes(String(Math.min(15, n)))) throw new Error('adaptive set size: ' + label);
    // Mistake tags: a two-question exam answered wrong on purpose.
    await page.evaluate(() => Quiz.setQuestions([
      { id: 9101, type: 'multiple-choice', question: 'Tag me 1?', options: ['right', 'wrong'], correct: 0 },
      { id: 9102, type: 'multiple-choice', question: 'Tag me 2?', options: ['right', 'wrong'], correct: 0 }
    ]));
    await page.click('#start-quiz-btn');
    for (let i = 0; i < 2; i++) {
      await page.waitForSelector('.quiz-option:not(.disabled)', { timeout: 2000 });
      const opts = await page.$$('.quiz-option');
      const texts = await Promise.all(opts.map(o => o.evaluate(e => e.textContent.trim())));
      await opts[texts.findIndex(t => t.startsWith('wrong') || t.includes('wrong'))].click();
      await page.waitForSelector('#quiz-next-btn', { timeout: 2000 });
      await page.click('#quiz-next-btn');
    }
    await page.waitForSelector('.quiz-score-ring', { timeout: 3000 });
    await page.click('#review-btn');
    await page.waitForSelector('.mt-tags [data-mtype="careless"]', { timeout: 2000 });
    await page.click('.mt-tags [data-mtype="careless"]');
    if (!await page.evaluate(() => Decks.getMistakes().some(m => m.mtype === 'careless' && '_given' in m))) throw new Error('mistake tag/answer not stored');
    await page.click('[data-tab="stats"]');
    await page.waitForSelector('[data-ins-act="diagnose"]', { timeout: 2000 });
  });

  // ----- Exams from real papers (OCR, PDF.js and the AI are mocked) -----
  const exFiles = (() => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-exams-'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const f = name => { const p = path.join(dir, name); fs.writeFileSync(p, name.endsWith('.png') ? png : '%PDF-1.4 stub'); return p; };
    return { pdf: f('ornek-kitapcik.pdf'), p1: f('page1.png'), p2: f('page2.png') };
  })();

  await step('exams: MEB resource links in the 10th-grade profile open safely in a new tab', async () => {
    const links = await page.$$eval('#profile-panel .meb-res-link', as => as.map(a => [a.href, a.target, a.rel]));
    if (links.length !== 3) throw new Error('expected 3 links, got ' + links.length);
    const hosts = links.map(l => new URL(l[0]).host).join(',');
    if (hosts !== 'odsgm.meb.gov.tr,ogmmateryal.eba.gov.tr,mebi.eba.gov.tr') throw new Error('hosts ' + hosts);
    if (!links.every(l => l[1] === '_blank' && /noopener/.test(l[2]))) throw new Error('unsafe link attrs');
  });

  await step('exams: past-paper mode analyses a booklet PDF, files its questions and generates in its style', async () => {
    await page.evaluate(() => {
      window.__ex = { chat: API.chat, grade: API.grade, ocr: OCR.extractText, pdf: PDF.extractText, prompts: [] };
      PDF.extractText = async (f, onP) => { onP && onP(1, 1); return { pages: 2, text: 'FİZİK 10. SINIF ÖRNEK SORU KİTAPÇIĞI\n\n1. Işık hangi ortamda en hızlıdır? A) Su B) Cam C) Boşluk D) Hava E) Elmas\n\n2. Ses boşlukta yayılır mı?\n\nCEVAP ANAHTARI\n1-C 2-B 3-A' }; };
      API.chat = async (prompt) => {
        window.__ex.prompts.push(prompt);
        if (/strict fact-checker/.test(prompt)) {
          const refs = [...prompt.matchAll(/^\[([cq]\d+)\]/gm)].map(m => m[1]);
          return JSON.stringify({ type: 'verify', results: refs.map(ref => ({ ref, verdict: 'ok' })) });
        }
        if (/Analyse it/.test(prompt)) return JSON.stringify({
          style: { formats: { 'multiple-choice': 1, 'true-false': 1 }, optionCount: 5, length: 'medium', difficulty: 'medium', notes: 'Kısa kökler' },
          topics: [{ name: 'Optik', count: 1 }, { name: 'Dalgalar', count: 1 }], patterns: ['Hangisidir sorusu'],
          questions: [
            { number: 1, type: 'multiple-choice', question: 'Işık hangi ortamda en hızlıdır?', options: ['Su', 'Cam', 'Boşluk', 'Hava', 'Elmas'], correct: 0, keyed: 'ai', topic: 'Optik' },
            { number: 2, type: 'true-false', question: 'Ses boşlukta yayılır.', correct: false, keyed: 'ai', topic: 'Dalgalar' }
          ] });
        if (/Write NEW exam questions/.test(prompt)) {
          const rows = [...prompt.matchAll(/^(\d+)\. (\S+)(?: — topic: (.*))?$/gm)];
          return JSON.stringify({ type: 'quiz', quiz: rows.map(r => ({ type: 'multiple-choice', question: 'Stil sorusu ' + Math.random(), options: ['a', 'b', 'c', 'd', 'e'], correct: 1, category: r[3] || '' })) });
        }
        if (/topic distribution table/.test(prompt)) return '{"topics":[]}';
        return '{"answer":"?"}';
      };
      // Earlier steps swapped in throwaway question lists; use the deck's bank.
      Quiz.setQuestions(App.getStudyData().quiz);
      App.switchTab('quiz');
    });
    await page.waitForSelector('[data-pp-act="open"]', { timeout: 2000 });
    await page.click('[data-pp-act="open"]');
    await page.waitForSelector('.pp-panel #pp-files', { timeout: 2000 });
    if (!await page.$('.pp-panel .meb-res-link[href="https://odsgm.meb.gov.tr"]')) throw new Error('resources missing in past-paper mode');
    const before = await page.evaluate(() => App.getStudyData().quiz.length);
    const input = await page.$('#pp-files');
    await input.uploadFile(exFiles.pdf);
    await page.waitForFunction(() => /ornek-kitapcik\.pdf/.test(document.querySelector('.pp-files').textContent), { timeout: 2000 });
    await page.click('[data-pp-act="analyse"]');
    await page.waitForSelector('.pp-profile', { timeout: 5000 });
    const r = await page.evaluate(() => {
      const d = Decks.getActive();
      const qs = App.getStudyData().quiz.filter(q => q.src === 'paper');
      return { p: d.paperProfile, qs, saved: d.data.quiz.filter(q => q.src === 'paper').length };
    });
    if (!r.p || r.p.topics.length !== 2 || r.p.style.formats['multiple-choice'] !== 1) throw new Error('profile not saved: ' + JSON.stringify(r.p));
    if (r.qs.length !== 2 || r.saved !== 2) throw new Error('booklet questions not filed: ' + r.qs.length + '/' + r.saved);
    const mc = r.qs.find(q => q.type === 'multiple-choice');
    if (mc.correct !== 2 || mc.aiKeyed) throw new Error('answer key not applied');
    if (!r.qs.find(q => q.type === 'true-false').aiKeyed) throw new Error('AI-solved question not marked');
    await page.waitForFunction(() => App.getStudyData().quiz.filter(q => q.src === 'paper').every(q => q.check), { timeout: 4000 });
    // Generate 10 in the paper's style.
    await page.click('[data-pp-act="gen"][data-n="10"]');
    await page.waitForFunction(n => App.getStudyData().quiz.length >= n + 12, { timeout: 5000 }, before);
    const cats = await page.evaluate(() => App.getStudyData().quiz.filter(q => q.src === 'paper-style').map(q => q.category));
    if (cats.filter(c => c === 'Optik').length !== 5) throw new Error('topic split off: ' + cats.join(','));
    // A pasted konu dağılımı takes over the topic weights.
    await page.$eval('#pp-text', el => { el.value = 'Optik 6\nDalgalar 3\nBasınç ve Kaldırma Kuvveti 1'; });
    await page.click('[data-pp-act="dist"]');
    await page.waitForFunction(() => (Decks.getActive().paperProfile || {}).topicsFrom === 'distribution', { timeout: 3000 });
    const w = await page.evaluate(() => Decks.getActive().paperProfile.topics.map(t => t.weight).join(','));
    if (w !== '0.6,0.3,0.1') throw new Error('weights ' + w);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pp-weight-note', { timeout: 2000 });
    await page.click('#adaptive-quiz-btn');
    await page.waitForSelector('#quiz-body', { timeout: 2000 });
    await page.evaluate(() => Quiz.renderReady());
  });

  await step('exams: the MEB library filters grade 8 + LGS, links out safely and applies a topic profile to the deck', async () => {
    await page.click('[data-pp-act="open"]');
    await page.waitForSelector('.pp-panel .pp-actions [data-meb-act="open"]', { timeout: 2000 });
    await page.click('.pp-panel .pp-actions [data-meb-act="open"]');
    await page.waitForSelector('.meb-panel .meb-row', { timeout: 5000 }); // lazy-loaded index
    await page.$eval('.meb-panel [data-meb-year=""]', b => b.click()); // the library opens on 2026-2027; this check spans all years
    if (!/Files open on MEB.s own servers/.test(await page.$eval('.meb-panel .chk-intro', el => el.textContent))) throw new Error('hosting note missing');
    if (!/Past paper/.test(await page.$eval('.meb-panel .meb-tip', el => el.textContent))) throw new Error('past-paper tip missing');
    await page.select('#meb-grade', '8');
    await page.select('#meb-type', 'lgs');
    const lgs = await page.$$eval('.meb-panel .meb-row', rows => rows.map(r => r.textContent));
    if (lgs.length < 1 || !lgs.every(t => /Grade 8/.test(t) && /LGS/.test(t))) throw new Error('grade 8 + LGS rows: ' + lgs.length);
    const link = await page.$eval('.meb-panel .meb-row .meb-open', a => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent }));
    if (!/^https:\/\/[a-z0-9.-]*(meb\.gov\.tr|eba\.gov\.tr)\//.test(link.href) || link.target !== '_blank' || !/noopener/.test(link.rel) || !/noreferrer/.test(link.rel) || !/Open on MEB/.test(link.text)) throw new Error('bad link ' + JSON.stringify(link));
    await page.type('#meb-q', 'sozel');
    const narrowed = await page.$$eval('.meb-panel .meb-row', rows => rows.length);
    if (narrowed < 1 || narrowed >= lgs.length) throw new Error('search did not narrow: ' + narrowed + '/' + lgs.length);
    // A konu-soru table becomes this deck's topic profile (an existing profile is replaced after the confirm, which the harness accepts).
    await page.$eval('#meb-q', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.select('#meb-grade', '0');
    await page.select('#meb-type', 'konu');
    await page.select('#meb-grade', '9');
    await page.waitForSelector('.meb-panel [data-meb-act="profile"]', { timeout: 2000 });
    const title = await page.$eval('.meb-panel [data-meb-act="profile"]', b => b.closest('.meb-row').querySelector('.meb-row-title').textContent);
    await page.click('.meb-panel [data-meb-act="profile"]');
    await page.waitForFunction(t => (Decks.getActive().paperProfile || {}).source === t, { timeout: 3000 }, title);
    const p = await page.evaluate(() => Decks.getActive().paperProfile);
    if (p.topicsFrom !== 'distribution' || p.topics.length < 2 || Math.abs(p.topics.reduce((s, t) => s + t.weight, 0) - 1) > 0.01) throw new Error('profile: ' + JSON.stringify(p).slice(0, 300));
    // Phone width: the screen must not scroll sideways.
    await page.setViewport({ width: 390, height: 844 });
    const overflow = await page.$eval('.meb-panel', el => el.scrollWidth - el.clientWidth);
    await page.setViewport({ width: 1280, height: 900 });
    if (overflow > 1) throw new Error('horizontal overflow at 390px: ' + overflow);
    // Escape closes the library only; the past-paper screen under it stays.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.meb-panel').parentElement.style.display === 'none', { timeout: 2000 });
    if (!await page.$eval('.pp-panel', el => el.parentElement.style.display !== 'none')) throw new Error('past-paper modal closed with the library');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pp-weight-note', { timeout: 2000 });
  });

  await step('exams: a MEB library file opens as a ready-made study set (2026-2027 first, deck, notes, cards, quiz, Ask AI context)', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/meb-set-a1.json'), 'utf8'));
    // Serve the fixture for one 2026-2027 library entry; everything else is the real index.
    const entry = await page.evaluate(async fx => {
      const d = await MebIndex.load();
      const it = d.items.find(x => x.y === '2026-2027' && !x.set);
      Object.assign(it, { set: 1, sz: 3, nc: 3, nq: 2, ns: 2 });
      window.__setFetch = window.fetch;
      window.__setMode = 'ok';
      window.__setReq = [];
      window.fetch = (u, ...a) => {
        if (!/data\/meb\/sets\//.test(u)) return window.__setFetch.call(window, u, ...a);
        window.__setReq.push(u);
        if (window.__setMode === 'fail') return Promise.resolve(new Response('', { status: 503 }));
        return Promise.resolve(new Response(JSON.stringify({ ...fx, meta: { ...fx.meta, fileId: it.id } }), { status: 200 }));
      };
      return { id: it.id, u: it.u };
    }, fixture);
    await page.evaluate(() => { window.__decks = Decks.list().length; window.__prevDeck = Decks.getActive().id; MebIndex.open(); });
    await page.waitForSelector('.meb-panel .meb-row', { timeout: 5000 });
    // The 2026-2027 group (the library's default on a fresh visit; an earlier step chose All years), every row badged with its school year.
    // Toasts from earlier steps stack over the panel's right side, so the chips are clicked in the page, not by pointer.
    await page.$eval('.meb-panel [data-meb-year="2026-2027"]', b => b.click());
    await page.select('#meb-grade', '0'); await page.select('#meb-type', ''); await page.select('#meb-subject', '');
    const lead = await page.evaluate(() => ({
      pressed: document.querySelector('.meb-panel [aria-pressed="true"][data-meb-year]').dataset.mebYear,
      years: [...document.querySelectorAll('.meb-panel .meb-row .meb-year')].map(e => e.textContent)
    }));
    if (lead.pressed !== '2026-2027' || !lead.years.length || !lead.years.every(y => y === '2026-2027')) throw new Error('default year: ' + JSON.stringify(lead).slice(0, 200));
    // Rows with a set: primary button + stats; without: MEB link + quiet note.
    const row = '.meb-panel [data-row="' + entry.id + '"]';
    const stats = await page.$eval(row + ' .meb-stats', e => e.textContent);
    if (stats !== '3 cards · 2 questions · 2 sections') throw new Error('stats line: ' + stats);
    const plain = await page.$$eval('.meb-panel .meb-row', rs => rs.filter(r => !r.querySelector('.meb-set')).every(r => /Study set coming/.test(r.textContent) && r.querySelector('a.meb-open')));
    if (!plain) throw new Error('rows without a set need the MEB link and the coming note');
    await page.$eval('.meb-panel [data-meb-sets]', b => b.click());
    await page.waitForFunction(() => document.querySelectorAll('.meb-panel .meb-row').length === 1, { timeout: 2000 }).catch(() => { throw new Error('Study sets chip did not narrow the list to the one set'); });
    // A failed download is shown in the row with Retry, and nothing is saved.
    await page.evaluate(() => { window.__setMode = 'fail'; });
    await page.click(row + ' [data-meb-act="set"]');
    await page.waitForSelector(row + ' .meb-error', { timeout: 3000 });
    const fail = await page.evaluate(r => ({ err: document.querySelector(r + ' .meb-error').textContent, btn: document.querySelector(r + ' .meb-set-btn').textContent.trim(), decks: Decks.list().length, before: window.__decks }), row);
    if (!/503/.test(fail.err) || !/Try again/.test(fail.btn) || fail.decks !== fail.before) throw new Error('error state: ' + JSON.stringify(fail));
    await page.evaluate(() => { window.__setMode = 'ok'; });
    await page.click(row + ' [data-meb-act="set"]');
    await page.waitForFunction(t => (App.getStudyData() || {}).title === t, { timeout: 5000 }, fixture.title);
    const got = await page.evaluate(() => ({
      decks: Decks.list().length, before: window.__decks, meta: Decks.getActive().data.meta,
      libOpen: [...document.querySelectorAll('.shortcuts-backdrop')].some(e => e.style.display !== 'none'),
      sections: document.querySelectorAll('#tab-notes .notes-section').length,
      cards: App.getStudyData().flashcards.length, questions: App.getStudyData().quiz.length,
      link: (document.querySelector('#tab-notes .meb-srclink') || {}).href, linkText: (document.querySelector('#tab-notes .meb-srclink') || {}).textContent
    }));
    if (got.decks !== got.before + 1 || got.meta.fileId !== entry.id || got.meta.sourceUrl !== entry.u) throw new Error('deck: ' + JSON.stringify(got).slice(0, 300));
    if (got.libOpen) throw new Error('library modals still open');
    if (got.sections !== 2 || got.cards !== 3 || got.questions !== 2) throw new Error('counts: ' + JSON.stringify(got));
    if (got.link !== entry.u || !/Source: MEB \(official file\)/.test(got.linkText)) throw new Error('source link: ' + got.link);
    await page.click('[data-tab="flashcards"]');
    await page.waitForFunction(() => document.querySelectorAll('#tab-flashcards .flashcard').length === 3, { timeout: 3000 });
    // Ask AI receives the set's own source text.
    const ctxText = await page.evaluate(async () => {
      const api = API.chat;
      let seen = '';
      API.chat = async (msg, context) => { seen = context; return '{"answer":"ok"}'; };
      await Chat.sendMessage('what is in this file?');
      API.chat = api;
      return seen;
    });
    if (!/SENTINEL-OXYGEN-7421/.test(ctxText)) throw new Error('Ask AI context lacks the source text: ' + String(ctxText).slice(0, 120));
    // Same file again: the confirm (accepted by this harness) opens the existing deck, no download, no new deck.
    const again = await page.evaluate(async e => {
      const n = Decks.list().length, r = window.__setReq.length;
      const id = await MebSets.open({ id: e.id, u: e.u });
      return { same: id === Decks.getActive().id, decks: Decks.list().length === n, noFetch: window.__setReq.length === r };
    }, entry);
    if (!again.same || !again.decks || !again.noFetch) throw new Error('reopen: ' + JSON.stringify(again));
    // Leave the deck and tab the later steps expect.
    await page.evaluate(() => { window.fetch = window.__setFetch; Decks.remove(Decks.getActive().id); App.openDeck(window.__prevDeck); App.switchTab('quiz'); });
  });

  await step('exams: Senaryolar tab opens a scenario as its own notebook (exam block = table count, distribution summary, Ask AI table rows, profile)', async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scen-fixture.json'), 'utf8'));
    const base = { fileId: 'fx000001', si: 0, sheet: '9. SINIF', subject: 'Biyoloji', grade: 9, variant: '', bank: 'b-fx000001-9', hasBank: true };
    const index = [
      { ...base, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 1, total: 4, kazanimCount: 2, d: [1, 3], national: 0 },
      { ...base, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 2, total: 6, kazanimCount: 3, d: [3, 1, 2], national: 0 },
      { ...base, ei: 1, exam: '1. Dönem 2. Ortak Yazılı Sınav', n: 0, total: 0, kazanimCount: 0, d: [], national: 1 },
      { fileId: 'fx000002', si: 0, sheet: '10. SINIF', subject: 'Fizik', grade: 10, variant: '', bank: null, hasBank: false, ei: 0, exam: '1. Dönem 1. Ortak Yazılı Sınav', n: 1, total: 2, kazanimCount: 1, d: [2], national: 0 }
    ];
    await page.evaluate((fx, index) => {
      window.__scenFetch = window.fetch;
      window.__scenMode = 'ok';
      window.fetch = (u, ...a) => {
        const m = String(u).match(/data\/meb\/scen\/(.*)$/);
        if (!m) return window.__scenFetch.call(window, u, ...a);
        if (window.__scenMode === 'fail' && !/index/.test(m[1])) return Promise.resolve(new Response('', { status: 503 }));
        return Promise.resolve(new Response(JSON.stringify(m[1] === 'index.json' ? index : m[1].startsWith('spec/') ? fx.spec : fx.bank), { status: 200 }));
      };
      window.__prevDeck = Decks.getActive().id; window.__decks = Decks.list().length;
      window.__prevMeta = Decks.getActive().data.meta;
      Decks.getActive().data.meta = { fileId: 'smoke', grade: [10] };   // the open deck states a grade: the list starts on it
      MebIndex.open({ tab: 'scen' });
    }, fx, index);
    await page.waitForSelector('.meb-panel .scen-row', { timeout: 5000 });
    const start = await page.evaluate(() => ({ grade: document.querySelector('.meb-panel [data-scen-grade][aria-pressed="true"]').textContent, rows: document.querySelectorAll('.meb-panel .scen-row').length }));
    if (start.grade !== 'Grade 10' || start.rows !== 1) throw new Error('list did not default to the open deck grade: ' + JSON.stringify(start));
    await page.evaluate(() => { Decks.getActive().data.meta = window.__prevMeta; });
    await page.$eval('.meb-panel [data-scen-grade="0"]', b => b.click());
    await page.select('#scen-sheet', 'fx000001.0');
    const ui = await page.evaluate(() => ({
      tab: document.querySelector('.meb-panel [data-meb-tab][aria-selected="true"]').textContent,
      rows: [...document.querySelectorAll('.meb-panel .scen-row')].map(r => r.querySelector('.scen-row-title').textContent + '|' + r.querySelector('.scen-stats').textContent + '|' + r.querySelectorAll('.scen-bar i').length),
      options: [...document.querySelectorAll('#scen-sheet option')].map(o => o.textContent),
      grade: document.querySelector('.meb-panel [data-scen-grade][aria-pressed="true"]').textContent
    }));
    if (ui.tab !== 'Scenarios' || ui.grade !== 'All grades') throw new Error('tab/grade: ' + JSON.stringify(ui));
    if (JSON.stringify(ui.rows) !== JSON.stringify(['Scenario 1|4 questions · 2 outcomes|2', 'Scenario 2|6 questions · 3 outcomes|3'])) throw new Error('rows: ' + JSON.stringify(ui.rows));
    if (ui.options.length !== 2 || !/Fizik · Grade 10 · Study bank coming/.test(ui.options[1])) throw new Error('sheets: ' + JSON.stringify(ui.options));
    // A national exam is listed but cannot be opened.
    await page.$eval('.meb-panel [data-scen-exam="1"]', b => b.click());
    const nat = await page.evaluate(() => ({ t: document.querySelector('.meb-panel .scen-national').textContent, open: document.querySelectorAll('.meb-panel [data-scen-act="open"]').length }));
    if (!/Nationwide common exam - no scenario/.test(nat.t) || nat.open) throw new Error('national: ' + JSON.stringify(nat));
    await page.$eval('.meb-panel [data-scen-exam="0"]', b => b.click());
    // A course whose bank is not built shows the note instead of the open button.
    await page.select('#scen-sheet', 'fx000002.0');
    const soon = await page.evaluate(() => ({ t: document.querySelector('.meb-panel .scen-row .meb-soon').textContent, open: document.querySelectorAll('.meb-panel [data-scen-act="open"]').length }));
    if (soon.t !== 'Study bank coming' || soon.open) throw new Error('soon: ' + JSON.stringify(soon));
    await page.$eval('.meb-panel [data-scen-grade="10"]', b => b.click());
    if (await page.$$eval('.meb-panel .scen-row', r => r.length) !== 1) throw new Error('grade chip did not narrow to Fizik');
    await page.$eval('.meb-panel [data-scen-grade="0"]', b => b.click());
    await page.select('#scen-sheet', 'fx000001.0');
    await page.setViewport({ width: 390, height: 844 });
    const overflow = await page.$eval('.meb-panel', el => el.scrollWidth - el.clientWidth);
    await page.setViewport({ width: 1280, height: 900 });
    if (overflow > 1) throw new Error('horizontal overflow at 390px: ' + overflow);
    // A failed download is shown in the row with Retry and saves nothing.
    const row = '.meb-panel [data-row="fx000001.0.0.2"]';
    await page.evaluate(() => { window.__scenMode = 'fail'; });
    await page.$eval(row + ' [data-scen-act="open"]', b => b.click());
    await page.waitForSelector(row + ' .meb-error', { timeout: 3000 });
    const fail = await page.evaluate(r => ({ err: document.querySelector(r + ' .meb-error').textContent, btn: document.querySelector(r + ' .scen-open-btn').textContent.trim(), decks: Decks.list().length, before: window.__decks }), row);
    if (!/503/.test(fail.err) || !/Try again/.test(fail.btn) || fail.decks !== fail.before) throw new Error('error state: ' + JSON.stringify(fail));
    await page.evaluate(() => { window.__scenMode = 'ok'; });
    await page.$eval(row + ' [data-scen-act="open"]', b => b.click());
    const title = 'Biyoloji 9 · 1. Dönem 1. Ortak Yazılı · Senaryo 2';
    await page.waitForFunction(t => (App.getStudyData() || {}).title === t, { timeout: 5000 }, title);
    const got = await page.evaluate(() => {
      const d = App.getStudyData();
      return {
        decks: Decks.list().length, before: window.__decks, meta: Decks.getActive().data.meta,
        libOpen: [...document.querySelectorAll('.shortcuts-backdrop')].some(e => e.style.display !== 'none'),
        exam: d.quiz.filter(q => q.scenarioExam).length, extra: d.quiz.filter(q => !q.scenarioExam).length,
        summary: document.querySelector('#tab-notes .notes-summary').textContent,
        sections: document.querySelectorAll('#tab-notes .notes-section').length,
        lines: getComputedStyle(document.querySelector('#tab-notes .notes-summary')).whiteSpace
      };
    });
    if (got.decks !== got.before + 1 || got.meta.kind !== 'scenario' || got.meta.scenario !== 2 || got.meta.fileId !== 'fx000001') throw new Error('deck: ' + JSON.stringify(got).slice(0, 300));
    if (got.libOpen) throw new Error('library modals still open');
    if (got.exam !== 6 || got.extra !== 12) throw new Error('exam/extra counts: ' + got.exam + '/' + got.extra);
    if (!/toplam 6 soru ve 3 kazanım/.test(got.summary) || !/FX\.1 · Hücre Yapısı: 3 soru \(%50\)/.test(got.summary) || !/ÜNİTE 1: 4 soru \(%66,7\)/.test(got.summary) || got.sections !== 5) throw new Error('summary/sections: ' + got.sections + ' ' + got.summary.slice(0, 200));
    if (got.lines !== 'pre-line') throw new Error('summary line breaks collapsed: ' + got.lines);
    // Ask AI receives the table rows of this scenario.
    const ctxText = await page.evaluate(async () => {
      const api = API.chat;
      let seen = '';
      API.chat = async (msg, context) => { seen = context; return '{"answer":"ok"}'; };
      await Chat.sendMessage('how many questions per topic?');
      API.chat = api;
      return seen;
    });
    if (!/ÜNİTE 1 \| FX\.1 \| Hücre Yapısı \| FX\.1\. Hücrenin yapısını açıklayabilme \| 3/.test(ctxText) || !/Senaryo 2 · toplam 6 soru/.test(ctxText)) throw new Error('Ask AI context lacks the table rows: ' + String(ctxText).slice(0, 160));
    // Exam mode: the scenario exam button starts exactly the exam block, in table order.
    await page.click('[data-tab="quiz"]');
    await page.waitForSelector('#start-scen-exam-btn', { timeout: 3000 });
    if (!/Start scenario exam \(6 questions\)/.test(await page.$eval('#start-scen-exam-btn', b => b.textContent))) throw new Error('scenario exam button label');
    await page.click('#start-scen-exam-btn');
    await page.waitForSelector('.quiz-question-number', { timeout: 3000 });
    const run = await page.$eval('.quiz-question-number', el => el.textContent);
    if (!/Question 1 of 6/.test(run)) throw new Error('scenario exam length: ' + run);
    // The topic profile of the scenario goes to the open deck (the scenario notebook).
    await page.evaluate(() => { Quiz.setQuestions(App.getStudyData().quiz); MebIndex.open({ tab: 'scen' }); });
    await page.waitForSelector('.meb-panel .scen-row', { timeout: 5000 });
    await page.$eval('.meb-panel [data-row="fx000001.0.0.1"] [data-scen-act="profile"]', b => b.click());
    await page.waitForFunction(() => (Decks.getActive().paperProfile || {}).source === 'Biyoloji 9 · 1. Dönem 1. Ortak Yazılı Sınav · Scenario 1', { timeout: 3000 });
    const prof = await page.evaluate(() => Decks.getActive().paperProfile);
    if (prof.topicsFrom !== 'distribution' || JSON.stringify(prof.topics.map(t => [t.name, t.count])) !== JSON.stringify([['Doku Çeşitleri', 3], ['Hücre Yapısı', 1]])) throw new Error('profile: ' + JSON.stringify(prof).slice(0, 300));
    await page.evaluate(() => { MebIndex.open({ tab: 'files' }); MebIndex.close(); });
    await page.evaluate(() => { window.fetch = window.__scenFetch; Decks.remove(Decks.getActive().id); App.openDeck(window.__prevDeck); App.switchTab('quiz'); });
  });

  await step('exams: a photographed handwritten answer is OCRed, corrected and graded', async () => {
    await page.evaluate(() => {
      window.__ex.graded = null;
      OCR.extractText = async (f, onP) => { onP && onP(0.5); await new Promise(r => setTimeout(r, 50)); return 'Isik kirilir cunku hiz degisir'; };
      API.grade = async (answer) => { window.__ex.graded = answer; return JSON.stringify({ score: 3, maxScore: 3, feedback: 'Doğru', missedPoints: [] }); };
      Quiz.setQuestions([{ id: 9201, type: 'open-ended', question: 'Kırılma neden olur?', correctAnswer: 'Hız değişir', keyPoints: ['hız'], maxPoints: 3 }]);
    });
    await page.click('[data-mode="practice"]');
    await page.click('#start-quiz-btn');
    await page.waitForSelector('[data-hw-act="photo"]', { timeout: 2000 });
    const inp = await page.$('.hw-file');
    await inp.uploadFile(exFiles.p1);
    await page.waitForSelector('.hw-thumb', { timeout: 3000 });
    const val = await page.$eval('#oe-answer', el => el.value);
    if (val !== 'Isik kirilir cunku hiz degisir') throw new Error('OCR text not in answer box: ' + val);
    await page.$eval('#oe-answer', el => { el.value = 'Işık kırılır çünkü hız değişir'; });
    await page.click('#oe-submit-btn');
    await page.waitForSelector('.oe-score', { timeout: 3000 });
    if (await page.evaluate(() => window.__ex.graded) !== 'Işık kırılır çünkü hız değişir') throw new Error('corrected text not graded');
    await page.evaluate(() => { Quiz.setQuestions(App.getStudyData().quiz); });
  });

  await step('exams: graded paper photos → mistake notebook, report, flashcards and practice', async () => {
    await page.evaluate(() => {
      let n = 0;
      OCR.extractText = async (f, onP) => { onP && onP(1); n++; return n === 1 ? '1) Işık kırılması ... X -4/10' : '2) Rezonans ... -2/10\n3) Doğru ✓'; };
      API.chat = async (prompt) => {
        window.__ex.prompts.push(prompt);
        if (/MARKED school exam paper/.test(prompt)) return JSON.stringify({ items: [
          { n: 1, topic: 'Optik', question: 'Işık neden kırılır?', given: 'Renk değişir', wrong: true, lost: 4, max: 10, correct: 'Hız değişir', concept: 'Kırılma: ortam değişince hız değişir', mtype: 'concept' },
          { n: 2, topic: 'Dalgalar', question: 'Rezonans nedir?', given: 'Yankı', wrong: true, lost: 2, max: 10, correct: 'Doğal frekansla titreşim', concept: 'Rezonans', mtype: 'misread' },
          { n: 3, topic: 'Dalgalar', question: 'Ses boşlukta yayılmaz.', given: 'D', wrong: false, lost: 0, max: 10 }
        ] });
        if (/"type":"flashcards"/.test(prompt)) return JSON.stringify({ type: 'flashcards', flashcards: [{ front: 'Kırılma neden olur?', back: 'Hız değişir' }, { front: 'Rezonans?', back: 'Doğal frekans' }] });
        if (/2 NEW similar exam/.test(prompt)) return JSON.stringify({ type: 'quiz', quiz: [
          { type: 'multiple-choice', question: 'Benzer soru 1?', options: ['a', 'b', 'c', 'd', 'e'], correct: 0, category: 'Optik' },
          { type: 'true-false', question: 'Benzer soru 2.', correct: true, category: 'Dalgalar' }] });
        return '{"answer":"?"}';
      };
      App.switchTab('quiz'); Quiz.renderReady();
    });
    await page.click('[data-pr-act="open"]');
    await page.waitForSelector('#pr-files', { timeout: 2000 });
    const inp = await page.$('#pr-files');
    await inp.uploadFile(exFiles.p1, exFiles.p2);
    await page.waitForFunction(() => /Page 2/.test((document.getElementById('pr-text') || {}).value || ''), { timeout: 3000 });
    await page.waitForSelector('[data-pr-act="analyse"]:not([disabled])', { timeout: 2000 });
    await page.click('[data-pr-act="analyse"]');
    await page.waitForSelector('.pr-report', { timeout: 4000 });
    const rows = await page.$$eval('.pr-report .qb-row', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    if (rows.length !== 2 || !/Optik.*-4/.test(rows[0])) throw new Error('per-topic rows ' + rows.join(' | '));
    if ((await page.$$('.pr-fixes li')).length !== 2) throw new Error('fix list');
    const ms = await page.evaluate(() => Decks.getMistakes().filter(m => m.src === 'paper-review'));
    if (ms.length !== 2 || ms[0]._given !== 'Renk değişir' || ms[1].mtype !== 'misread') throw new Error('mistakes ' + JSON.stringify(ms));
    const cardsBefore = await page.evaluate(() => App.getStudyData().flashcards.length);
    await page.click('[data-pr-act="cards"]');
    await page.waitForSelector('#tab-flashcards.active', { timeout: 3000 });
    const cardsAfter = await page.evaluate(() => [App.getStudyData().flashcards.length, Decks.getActive().data.flashcards.length]);
    if (cardsAfter[0] !== cardsBefore + 2 || cardsAfter[1] !== cardsAfter[0]) throw new Error('cards ' + cardsBefore + ' → ' + cardsAfter);
    await page.click('[data-tab="stats"]');
    await page.waitForSelector('.pr-stat [data-pr-act="last"]', { timeout: 2000 });
    await page.click('.pr-stat [data-pr-act="last"]');
    await page.waitForSelector('[data-pr-act="practise"]', { timeout: 2000 });
    await page.click('[data-pr-act="practise"]');
    await page.waitForSelector('#tab-quiz.active #quiz-body', { timeout: 3000 });
    const label = await page.$eval('.quiz-question-number', el => el.textContent);
    if (!/\b2\b/.test(label)) throw new Error('practice set size: ' + label);
    await page.evaluate(() => {
      API.chat = window.__ex.chat; API.grade = window.__ex.grade; OCR.extractText = window.__ex.ocr; PDF.extractText = window.__ex.pdf;
      Quiz.renderReady();
    });
  });

  // ===== Labs + video lessons =====
  await step('labs: AI spec renders, sliders update live, challenges complete, unsafe specs rejected', async () => {
    await page.evaluate(() => document.getElementById('demo-btn').click());
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
    await page.click('[data-tab="notes"]');
    await page.click('[data-notes-view="labs"]');
    await page.waitForSelector('[data-lab-act="generate"]', { timeout: 2000 });
    const unsafe = await page.evaluate(() => ['alert(1)', 'constructor', 'x.y', 'a[0]', 'window', '"s"', 'Function("x")()'].map(e => SimSpec.compile(e, ['x', 'a']).ok));
    if (unsafe.some(Boolean)) throw new Error('unsafe formula accepted: ' + unsafe);
    await page.evaluate(() => {
      window.__chat = API.chat;
      window.__labPrompt = '';
      API.chat = async (q) => { window.__labPrompt = q; return JSON.stringify({ labs: [
        { template: 'graph', title: 'Parabola lab', goal: 'Make it steeper', params: [{ id: 'a', label: 'a', min: 0, max: 4, step: 0.5, value: 1 }],
          derived: [{ id: 'y2', label: 'y(2)', expr: 'a*2^2' }], graph: { x: { min: -3, max: 3 }, curves: [{ expr: 'a*x^2', label: 'y' }] },
          challenges: [{ text: 'Make y(2) equal 12', check: 'abs(y2-12) < 0.01' }, { text: 'evil', check: 'alert(1)' }] },
        { template: 'graph', title: 'Broken', params: [], challenges: [] }
      ] }); };
    });
    await page.click('[data-lab-act="generate"]');
    await page.waitForSelector('[data-lab-curve="0"]', { timeout: 3000 });
    await page.evaluate(() => { API.chat = window.__chat; });
    if (!/Return ONLY JSON/.test(await page.evaluate(() => window.__labPrompt))) throw new Error('prompt shape');
    const saved = await page.evaluate(() => { const l = Decks.getActive().data.labs; return l && l.length === 1 && l[0].challenges.length === 1; });
    if (!saved) throw new Error('lab not sanitized/saved');
    const d0 = await page.$eval('[data-lab-curve="0"]', el => el.getAttribute('d'));
    if (!d0 || d0.length < 50) throw new Error('curve not drawn');
    // Drag the slider (input events) to a = 3.
    await page.$eval('[data-lab-param="a"]', el => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(d => document.querySelector('[data-lab-curve="0"]').getAttribute('d') !== d, { timeout: 2000 }, d0);
    await page.waitForSelector('[data-lab-ch="0"].done', { timeout: 2000 });
    const out = await page.$eval('[data-lab-ro="0"]', el => el.textContent);
    if (!out.startsWith('12')) throw new Error('readout ' + out);
    await page.waitForFunction(() => (Decks.getActive().data.labs[0].solved || []).includes(0), { timeout: 2000 });
  });

  await step('labs: starter circuit rewires, switches open the loop', async () => {
    await page.click('[data-lab-act="new"]');
    await page.click('[data-lab-preset="circuit"]');
    await page.waitForSelector('.lab-circuit [data-lab-switch="R2"]', { timeout: 2000 });
    const I = () => page.$eval('[data-lab-ro="1"]', el => el.textContent);
    if (!(await I()).startsWith('0.2')) throw new Error('series current ' + await I());
    await page.click('[data-lab-switch="R2"]');
    await page.waitForFunction(() => document.querySelector('[data-lab-ro="1"]').textContent.startsWith('0 '), { timeout: 2000 });
    await page.waitForSelector('[data-lab-ch="2"].done', { timeout: 2000 });
    await page.click('[data-lab-layout="parallel"]');
    await page.waitForFunction(() => !document.querySelector('[data-lab-ro="1"]').textContent.startsWith('0 '), { timeout: 2000 });
    await page.click('[data-lab-act="new"]');
    await page.click('[data-lab-preset="projectile"]');
    await page.waitForSelector('[data-lab-ball]', { timeout: 2000 });
    await page.click('[data-lab-act="play"]');
    await page.waitForFunction(() => +document.querySelector('[data-lab-time]').value > 0, { timeout: 3000 });
  });

  await step('video lesson: storyboard plays, advances on TTS end, keyboard + captions', async () => {
    await page.click('[data-notes-view="video"]');
    await page.waitForSelector('[data-vl-act="generate"]', { timeout: 2000 });
    await page.evaluate(() => {
      window.__chat = API.chat;
      const d = App.getStudyData();
      const branch = (d.notes.mindmap || Mindmap.fromNotes(d)).children[0].label;
      API.chat = async () => JSON.stringify({ title: 'Light lesson', slides: [
        { title: 'Why plants need light', bullets: [], narration: 'Welcome. Today we learn photosynthesis.' },
        { title: 'The equation', bullets: ['CO2 and water in', 'glucose and oxygen out'], formula: '$6CO_2 + 6H_2O \\to C_6H_{12}O_6 + 6O_2$', narration: 'Carbon dioxide and water become glucose and oxygen.' },
        { title: 'Big picture', bullets: ['Two stages'], diagram: { kind: 'map', label: branch }, narration: 'Here is the big picture.' },
        { title: 'Recap', bullets: ['Light in, sugar out'], narration: 'That is all.' }
      ] });
      window.__spoken = [];
      window.__tts = { supported: TTS.supported, speak: TTS.speak, stop: TTS.stop };
      let pending = null;
      TTS.supported = () => true;
      TTS.speak = (text, onEnd) => { if (pending) { const p = pending; pending = null; p(true); } window.__spoken.push(text); pending = onEnd; setTimeout(() => { if (pending === onEnd) { pending = null; onEnd(false); } }, 40); };
      TTS.stop = () => { if (pending) { const p = pending; pending = null; p(true); } };
    });
    await page.click('[data-vl-act="generate"]');
    await page.waitForSelector('.vl-slide.in', { timeout: 3000 });
    await page.evaluate(() => { API.chat = window.__chat; });
    if (await page.$$eval('.vl-mark', m => m.length) !== 4) throw new Error('markers');
    await page.click('[data-vl-act="toggle"]');
    await page.waitForFunction(() => window.__spoken.length === 4 && !VideoLesson.isPlaying(), { timeout: 6000 });
    if (await page.evaluate(() => VideoLesson._index()) !== 3) throw new Error('did not reach last slide');
    const spoken = await page.evaluate(() => window.__spoken.join('|'));
    if (!spoken.startsWith('Welcome') || !spoken.endsWith('That is all.')) throw new Error('narration order ' + spoken);
    await page.click('.vl-mark[data-vl-go="2"]');
    await page.waitForSelector('.vl-slide.in .vl-branch', { timeout: 2000 });
    await page.focus('[data-vl-player]');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => VideoLesson._index() === 1, { timeout: 2000 });
    await page.waitForSelector('.vl-slide.in .vl-formula', { timeout: 2000 });
    await page.keyboard.press('c');
    if (await page.$eval('[data-vl-player]', el => el.classList.contains('cc-on'))) throw new Error('captions toggle');
    await page.keyboard.press('c');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => VideoLesson.isPlaying() && window.__spoken.length > 4, { timeout: 2000 });
    await page.keyboard.press(' ');
    if (await page.evaluate(() => VideoLesson.isPlaying())) throw new Error('pause failed');
    if (!await page.evaluate(() => Decks.getActive().data.lessons[0].slides[1].formula.startsWith('6CO_2'))) throw new Error('lesson not saved');
    await page.evaluate(() => Object.assign(TTS, window.__tts));
    await page.click('[data-notes-view="notes"]');
  });

  await step('study brain: memory model, exam predictor and concept map render on Stats', async () => {
    await page.evaluate(() => {
      const deck = Decks.getActive();
      const d = new Date(Date.now() + 6 * 864e5);
      Decks.setExamDate(deck.id, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
      deck.data.flashcards.slice(0, 3).forEach(c => Decks.review(c.id, 5));
      App.switchTab('flashcards');
    });
    await page.waitForSelector('#tab-flashcards .plan-bar', { timeout: 2000 });
    await page.click('[data-tab="stats"]');
    await page.waitForSelector('#memory-card', { timeout: 2000 });
    await page.waitForSelector('.plan-card .pred-block', { timeout: 2000 });
    if (!await page.evaluate(() => Decks.getActive().rlog.length >= 3)) throw new Error('reviews not logged');
    await page.waitForSelector('#concept-card .cm-node', { timeout: 2000 });
    await page.evaluate(() => document.querySelector('#concept-card .cm-node circle').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForSelector('#cm-detail [data-cm-act="ask"]', { timeout: 2000 });
    const study = await page.$('#cm-detail [data-cm-act="study"]');
    if (study) {
      await study.click();
      await page.waitForSelector('#study-mode-overlay', { visible: true, timeout: 2000 });
      await page.evaluate(() => document.getElementById('study-mode-close').click());
    }
  });

  await step('study brain: AI concept linking is batched, parsed and stored (mocked)', async () => {
    await page.evaluate(() => {
      window.__cmChat = API.chat;
      window.__cmCalls = 0;
      API.chat = async () => { window.__cmCalls++; return 'Sure: {"pre":[[1,2],[2,99]],"rel":[[3,1]]}'; };
      App.switchTab('stats');
    });
    await page.waitForSelector('[data-cm-act="ai"]', { timeout: 2000 });
    await page.click('[data-cm-act="ai"]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('flashmind_concepts_v1') || '{}').e || []).length >= 2, { timeout: 3000 });
    await page.waitForSelector('[data-cm-act="ai"]:not([disabled])', { timeout: 3000 });
    await page.evaluate(() => { API.chat = window.__cmChat; });
    if (!await page.evaluate(() => window.__cmCalls >= 1)) throw new Error('no AI call');
  });

  await step('autopilot coach: "What now?" launches a session and suggests the next step', async () => {
    await page.waitForSelector('#study-view .coach-btn', { timeout: 2000 });
    await page.click('#study-view .coach-btn');
    await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('flashmind_coach_v1') || '{}'); return s.recent && s.recent.length; }, { timeout: 2000 });
    const kind = await page.evaluate(() => JSON.parse(localStorage.getItem('flashmind_coach_v1')).recent[0].k);
    if (!['review', 'marks', 'new', 'mistakes', 'adaptive', 'voice', 'over', 'mindmap'].includes(kind)) throw new Error('bad kind ' + kind);
    await page.evaluate(() => {
      const ov = document.getElementById('study-mode-overlay');
      if (ov.style.display === 'flex') document.getElementById('study-mode-close').click();
      if (typeof Voice !== 'undefined') Voice.close();
      document.dispatchEvent(new CustomEvent('fm:session-end'));
    });
    await page.waitForSelector('.coach-next', { visible: true, timeout: 2000 });
    const go = await page.$('.coach-next [data-coach-act="next"]');
    if (go) await go.click(); else await page.click('.coach-next [data-coach-act="dismiss"]');
    await page.waitForFunction(() => document.querySelector('.coach-next').style.display === 'none', { timeout: 2000 });
    await page.evaluate(() => {
      const ov = document.getElementById('study-mode-overlay');
      if (ov.style.display === 'flex') document.getElementById('study-mode-close').click();
      if (typeof Voice !== 'undefined') Voice.close();
    });
    await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
    await page.waitForSelector('.palette-backdrop', { visible: true, timeout: 2000 });
    const labels = await page.$$eval('.palette-list *', els => els.map(e => e.textContent).join('|'));
    await page.keyboard.press('Escape');
    if (!labels.includes('🧭')) throw new Error('coach missing from palette');
  });

  // ----- Live: camera tutor + lecture companion (mocked token, socket, devices, AI) -----
  const installLiveMocks = () => page.evaluate(() => {
    window.__live = { sent: [], sockets: [], modes: [], tracks: [] };
    API.liveToken = async (mode) => { window.__live.modes.push(mode); return { token: 'auth_tokens/smoke' + window.__live.modes.length, model: 'gemini-3.8-live', maxMinutes: 15 }; };
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c.video) {
        // A synthetic camera whose picture keeps changing.
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240;
        const g = cv.getContext('2d'); let n = 0;
        const paint = () => { g.fillStyle = `hsl(${(n += 40) % 360},70%,50%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect((n * 7) % 280, 100, 40, 40); };
        paint(); setInterval(paint, 200);
        const stream = cv.captureStream(10);
        window.__live.tracks.push(...stream.getVideoTracks());
        return stream;
      }
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.5;
      const dest = ctx.createMediaStreamDestination(); osc.connect(gain); gain.connect(dest); osc.start();
      return dest.stream;
    };
    class FakeWS {
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__live.sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 10); }
      reply(o) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 5); }
      send(raw) {
        const m = JSON.parse(raw); this.sent.push(m); window.__live.sent.push(m);
        if (m.setup) this.reply({ setupComplete: {} });
        if (m.clientContent) this.reply({ serverContent: { outputTranscription: { text: 'Show me your work.' }, turnComplete: true } });
        if (m.realtimeInput && m.realtimeInput.audio && window.__live.say && !this.said) {
          this.said = true;
          this.reply({ serverContent: { inputTranscription: { text: window.__live.say } } });
        }
      }
      close() { this.readyState = 3; this.closed = true; }
    }
    FakeWS.OPEN = 1;
    window.WebSocket = FakeWS;
  });

  await step('voice tutor: "check my work" streams camera frames, pause stops them, end releases the camera', async () => {
    await page.evaluate(() => { document.getElementById('demo-btn').click(); });
    await page.waitForSelector('#study-view.active', { timeout: 3000 });
    await installLiveMocks();
    await page.click('[data-tab="chat"]');
    await page.click('#voice-open-btn');
    await page.click('[data-voice-mode="solve"]');
    await page.waitForSelector('#voice-cam-select', { timeout: 2000 });
    await page.click('[data-voice-act="start"]');
    await page.waitForSelector('.voice-cam video', { timeout: 6000 });
    await page.waitForFunction(() => window.__live.sent.filter(m => m.realtimeInput && m.realtimeInput.video).length >= 2, { timeout: 8000 });
    const frame = await page.evaluate(() => window.__live.sent.find(m => m.realtimeInput && m.realtimeInput.video).realtimeInput.video);
    if (frame.mimeType !== 'image/jpeg' || !frame.data.startsWith('/9j/')) throw new Error('bad frame ' + frame.mimeType);
    if (!await page.evaluate(() => window.__live.modes[0] === 'solve')) throw new Error('token not minted for solve mode');
    const frames = () => page.evaluate(() => window.__live.sent.filter(m => m.realtimeInput && m.realtimeInput.video).length);
    await page.click('[data-voice-act="pause"]');
    await page.waitForSelector('.voice-status.paused', { timeout: 2000 });
    const atPause = await frames();
    await new Promise(r => setTimeout(r, 1600));
    if (await frames() !== atPause) throw new Error('frames still sent while paused');
    if (await page.evaluate(() => window.__live.tracks.some(t => t.enabled))) throw new Error('camera left enabled while paused');
    await page.click('[data-voice-act="resume"]');
    await page.waitForFunction(n => window.__live.sent.filter(m => m.realtimeInput && m.realtimeInput.video).length > n, { timeout: 6000 }, atPause);
    await page.click('[data-voice-act="camera"]');
    await page.waitForFunction(() => !document.querySelector('.voice-cam video') && window.__live.tracks.every(t => t.readyState === 'ended'), { timeout: 2000 });
    await page.click('[data-voice-act="camera"]');
    await page.waitForSelector('.voice-cam video', { timeout: 4000 });
    await page.click('[data-voice-act="stop"]');
    await page.waitForSelector('.voice-status.ended', { timeout: 2000 });
    if (!await page.evaluate(() => window.__live.tracks.length >= 2 && window.__live.tracks.every(t => t.readyState === 'ended'))) throw new Error('camera not stopped');
    await page.click('[data-voice-act="close"]');
  });

  await step('lecture companion: live transcript, exam cue chip, token renewal, notes/cards/alerts into a new deck, summary', async () => {
    await installLiveMocks();
    await page.evaluate(() => {
      window.__live.say = 'Arkadaşlar hücre zarı seçici geçirgendir, bu sınavda çıkar, dikkat edin. Madde geçişini kontrol eder ve hücreyi korur.';
      window.__lecChat = [];
      API.chat = async (prompt, ctx) => {
        window.__lecChat.push(prompt);
        return JSON.stringify({ sections: [{ title: 'Hücre zarı', content: 'Seçici geçirgendir.', bulletPoints: ['Madde geçişini kontrol eder'] }],
          flashcards: [{ front: 'Hücre zarının özelliği nedir?', back: 'Seçici geçirgenlik', exam: true }, { front: 'Hücre zarı neyi kontrol eder?', back: 'Madde geçişini' }],
          examAlerts: [{ point: 'Hücre zarının seçici geçirgenliği sorulacak', quote: 'bu sınavda çıkar', why: 'exam' }] });
      };
      window.__decksBefore = Decks.list().length;
      Lecture.open();
    });
    await page.waitForSelector('.lec-panel [data-lec-target="new"]', { timeout: 2000 });
    await page.click('[data-lec-target="new"]');
    await page.$eval('#lec-name', e => { e.value = 'Biyoloji dersi'; });
    await page.click('[data-lec-act="start"]');
    await page.waitForSelector('.lec-seg', { timeout: 6000 });
    await page.waitForSelector('.lec-chip.cue', { timeout: 2000 });
    const first = await page.evaluate(() => ({ mode: window.__live.modes[0], start: window.__live.sockets[0].sent.some(m => m.realtimeInput && m.realtimeInput.activityStart), audio: window.__live.sockets[0].sent.some(m => m.realtimeInput && m.realtimeInput.audio) }));
    if (first.mode !== 'lecture' || !first.start || !first.audio) throw new Error('bad lecture session ' + JSON.stringify(first));
    // The server announces the session is ending: a fresh token and socket take over.
    await page.evaluate(() => window.__live.sockets[0].reply({ goAway: { timeLeft: '10s' } }));
    await page.waitForFunction(() => window.__live.sockets.length === 2 && window.__live.sockets[1].sent.some(m => m.realtimeInput && m.realtimeInput.activityStart), { timeout: 4000 });
    if (!await page.evaluate(() => window.__live.modes.length === 2 && window.__live.sockets[0].sent.some(m => m.realtimeInput && m.realtimeInput.activityEnd))) throw new Error('renewal did not hand over');
    await page.waitForFunction(() => window.__live.sockets[1].sent.some(m => m.realtimeInput && m.realtimeInput.audio), { timeout: 3000 });
    // Minimize: the pill keeps the lecture visible; reopen and stop.
    await page.click('[data-lec-act="hide"]');
    await page.waitForSelector('.lec-pill', { visible: true, timeout: 2000 });
    await page.click('.lec-pill');
    await page.click('[data-lec-act="stop"]');
    await page.waitForSelector('.lec-summary', { timeout: 8000 });
    const summary = await page.$eval('.lec-summary-big', e => e.textContent);
    if (!/1 notes, 2 cards, 1 exam alerts/.test(summary)) throw new Error('summary: ' + summary);
    if (!await page.evaluate(() => window.__live.sockets.every(s => s.closed))) throw new Error('lecture socket left open');
    const prompt = await page.evaluate(() => window.__lecChat[0]);
    if (!/sınavda çıkar/.test(prompt) || !/Hücre zarı|hücre zarı/.test(prompt)) throw new Error('chunk prompt missing transcript/cues');
    const deck = await page.evaluate(() => {
      const d = Decks.list().find(x => x.data.title === 'Biyoloji dersi');
      return d && { n: Decks.list().length - window.__decksBefore, cards: d.data.flashcards.length, exam: d.data.flashcards.filter(c => c.exam).length,
        src: (d.data.sources || []).map(s => s.kind + ':' + s.text.slice(0, 40)), alerts: d.data.notes.sections.filter(s => s.lectureAlerts).length };
    });
    if (!deck || deck.n !== 1 || deck.cards !== 2 || deck.exam !== 1 || deck.alerts !== 1 || !/^lecture:\[0:0\d\] Arkadaşlar/.test(deck.src[0] || '')) throw new Error('deck: ' + JSON.stringify(deck));
    await page.click('[data-lec-act="review"]');
    await page.waitForFunction(() => document.getElementById('study-title').textContent === 'Biyoloji dersi' && document.querySelector('#tab-flashcards.active'), { timeout: 3000 });
  });

  await step('lecture companion: falls back to browser speech recognition when Live is unavailable', async () => {
    await installLiveMocks();
    await page.evaluate(() => {
      API.liveToken = async () => { throw new Error("Voice tutor isn't set up yet"); };
      window.__rec = [];
      window.__realRec = [window.SpeechRecognition, window.webkitSpeechRecognition];
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        constructor() { window.__rec.push(this); }
        start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Mitoz bölünmede kromozom sayısı korunur' }], { isFinal: true })] }), 20); }
        stop() { setTimeout(() => this.onend && this.onend(), 5); }
      };
      Lecture.open();
    });
    await page.waitForSelector('[data-lec-act="start"]', { timeout: 2000 });
    await page.click('[data-lec-act="start"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.lec-seg')].some(s => /Mitoz/.test(s.textContent)), { timeout: 5000 });
    if (!await page.$eval('.lec-engine-badge', e => !/Gemini/.test(e.textContent))) throw new Error('engine did not switch');
    await page.click('[data-lec-act="stop"]');
    await page.waitForSelector('.lec-summary', { timeout: 8000 });
    await page.click('.lec-panel [data-lec-act="review"], .lec-panel [data-lec-act="close"]');
    await page.evaluate(() => { [window.SpeechRecognition, window.webkitSpeechRecognition] = window.__realRec; });
  });

  await step('class mode: create, push, join, keep progress across versions, report, dashboard, revision exam', async () => {
    await page.evaluate(() => {
      const srv = window.__cls = { items: [], report: null, calls: [] };
      const pub = () => srv.items.map(({ id, title, ver, due, cards, qs, t }) => ({ id, title, ver, due, cards, qs, t }));
      API.classCall = async (a, p) => {
        srv.calls.push(a);
        if (a === 'classCreate') return { join: 'abcd234', teacher: 't'.repeat(20), name: p.name };
        if (a === 'classPush') {
          const prev = srv.items.find(i => i.id === p.id);
          const ver = (prev ? prev.ver : 0) + 1;
          srv.items = [{ id: p.id, ver, title: p.data.title, due: p.due || null, cards: p.data.flashcards.length, qs: p.data.quiz.length, t: Date.now(), data: p.data }, ...srv.items.filter(i => i.id !== p.id)];
          return { id: p.id, ver };
        }
        if (a === 'classJoin') return { sid: 's1', key: 'k'.repeat(20), name: '10-A', items: pub() };
        if (a === 'classState') return { name: '10-A', closed: false, items: pub(), member: true };
        if (a === 'classItem') { const it = srv.items.find(i => i.id === p.id); return { studyData: it.data, ver: it.ver }; }
        if (a === 'classReport') { srv.report = p.report; return { ok: true }; }
        if (a === 'classDashboard') return { name: '10-A', items: pub(), students: srv.report ? [{ sid: 's1', nick: 'Ayşe', joined: 1, t: Date.now(), r: srv.report }] : [] };
        return { ok: true };
      };
      API.chat = async () => JSON.stringify({ type: 'quiz', quiz: [{ type: 'multiple-choice', question: 'New revision Q?', options: ['a', 'b', 'c', 'd', 'e'], correct: 1, category: 'Light' }] });
      document.getElementById('back-to-input').click();
    });
    await page.waitForSelector('#class-section [data-cls-act="create"]', { visible: true, timeout: 2000 });
    // Teacher: create a class and push the demo deck with a due date.
    await page.evaluate(() => document.querySelector('[data-cls-act="create"]').click());
    await page.waitForSelector('#cls-name', { visible: true, timeout: 2000 });
    await page.type('#cls-name', '10-A');
    await page.click('[data-cls-act="do-create"]');
    await page.waitForFunction(() => /ABCD234/.test(document.querySelector('#cls-body').textContent), { timeout: 2000 });
    await page.click('#cls-body [data-cls-act="open-teacher"]');
    await page.waitForSelector('#cls-push-deck', { timeout: 2000 });
    const demoId = await page.evaluate(() => Decks.list().find(d => /Photosynthesis/.test(d.data.title)).id);
    await page.select('#cls-push-deck', demoId);
    await page.evaluate(() => { document.getElementById('cls-push-due').value = '2030-05-01'; });
    await page.click('[data-cls-act="push"]');
    await page.waitForFunction(() => window.__cls.items.length === 1 && document.querySelector('.cls-items .cls-item'), { timeout: 2000 });
    if (await page.evaluate(() => window.__cls.items[0].due) !== '2030-05-01') throw new Error('due date not pushed');
    await page.evaluate(() => ClassMode.closeModal());
    // Student (same browser): join with the code + nickname.
    await page.evaluate(() => ClassMode.open({ name: 'join', code: 'abcd234' }));
    await page.waitForSelector('#cls-nick', { visible: true, timeout: 2000 });
    await page.type('#cls-nick', 'Ayşe');
    await page.click('[data-cls-act="do-join"]');
    await page.waitForFunction(() => Decks.list().some(d => d.cls && d.cls.join === 'abcd234'), { timeout: 2000 });
    await page.waitForSelector('#deck-library .cls-badge', { timeout: 2000 });
    const before = await page.evaluate(() => {
      const d = Decks.list().find(x => x.cls);
      if (d.examDate !== '2030-05-01') throw new Error('due date not applied: ' + d.examDate);
      const card = d.data.flashcards[1];
      Decks.reviewIn(d.id, card.id, 5);
      const q = d.data.quiz[0];
      d.qstats = { [q.id]: { n: 4, ok: 1, last: 0, t: Date.now() } };
      Decks.touch(d.id);
      return { front: card.front, q: q.question };
    });
    // Teacher pushes v2 with the cards reordered: progress must follow the card.
    await page.evaluate(async () => {
      const it = window.__cls.items[0];
      const data = JSON.parse(JSON.stringify(it.data));
      data.flashcards = data.flashcards.reverse().map((c, i) => ({ ...c, id: i + 1 }));
      data.title += ' v2';
      await API.classCall('classPush', { id: it.id, data });
      await ClassMode.refreshAll();
    });
    const after = await page.evaluate(f => {
      const d = Decks.list().find(x => x.cls);
      const card = d.data.flashcards.find(c => c.front === f.front);
      return { title: d.data.title, ver: d.cls.ver, reps: (d.srs[card.id] || {}).reps, n: Decks.list().filter(x => x.cls).length };
    }, before);
    if (!/v2$/.test(after.title) || after.ver !== 2 || after.reps !== 1 || after.n !== 1) throw new Error('class update lost progress: ' + JSON.stringify(after));
    const rep = await page.evaluate(() => window.__cls.report);
    const deckRep = rep && Object.values(rep.decks)[0];
    if (!deckRep || deckRep.n !== 4 || JSON.stringify(rep).includes('Ayşe')) throw new Error('bad report: ' + JSON.stringify(rep));
    // Teacher dashboard: heatmap + weakest topics + one-click revision exam.
    await page.evaluate(() => document.querySelector('[data-cls-act="open-teacher"]').click());
    await page.waitForSelector('.cls-heat .cls-cell', { timeout: 3000 });
    await page.click('[data-cls-act="revision"]');
    await page.waitForFunction(() => window.__cls.items.length === 2, { timeout: 4000 });
    const rev = await page.evaluate(() => window.__cls.items[0]);
    if (!rev.data.quiz.some(q => q.question === 'New revision Q?') || rev.data.quiz.length < 2) throw new Error('revision exam: ' + JSON.stringify(rev.data.quiz.map(q => q.question)));
    if (await page.evaluate(() => Decks.getActive() && /Revision/.test(Decks.getActive().data.title))) throw new Error('revision exam stole the active deck');
    await page.evaluate(() => ClassMode.closeModal());
  });

  await step('quiz battle: host room + player answers over a mocked WebSocket', async () => {
    await page.evaluate(() => {
      window.__btl = [];
      window.qrcode = () => ({ addData() {}, make() {}, createSvgTag: () => '<svg viewBox="0 0 4 4"></svg>' });
      window.WebSocket = class {
        constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__btl.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
        send(m) { this.sent.push(JSON.parse(m)); }
        close(code) { this.readyState = 3; this.onclose && this.onclose({ code: code || 1000 }); }
        emit(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
      };
      window.__btlCreate = null;
      API.battleCreate = async (title, questions, secs) => { window.__btlCreate = { title, questions, secs }; return { code: '123456', hostKey: 'hk' }; };
      Battle.openHost(Decks.list().find(d => /Photosynthesis/.test(d.data.title)).id);
    });
    await page.waitForSelector('[data-btl-setup="create"]', { visible: true, timeout: 2000 });
    await page.click('[data-btl-setup="create"]');
    await page.waitForSelector('.btl-overlay', { timeout: 2000 });
    await page.waitForFunction(() => window.__btl[0] && window.__btl[0].readyState === 1, { timeout: 2000 });
    const created = await page.evaluate(() => window.__btlCreate);
    if (!created.questions.length || created.questions.some(q => !Array.isArray(q.o) || !Number.isInteger(q.c))) throw new Error('bad battle questions');
    if (!/\/battle\/123456\?role=host&key=hk$/.test(await page.evaluate(() => window.__btl[0].url))) throw new Error('host url');
    const view = { t: 'state', hostOnline: true, title: 'Demo', total: 2, limitMs: 20000, dist: null, role: 'host', answered: 0, leaderboard: [] };
    await page.evaluate(v => window.__btl[0].emit({ ...v, phase: 'lobby', qi: -1, remainMs: 0, question: null, players: [{ pid: 'p1', name: 'Ayşe', score: 0, connected: true }] }), view);
    await page.waitForSelector('.btl-code-big', { timeout: 2000 });
    await page.click('[data-btl="start"]');
    if (!await page.evaluate(() => window.__btl[0].sent.some(m => m.t === 'start'))) throw new Error('start not sent');
    await page.evaluate(v => window.__btl[0].emit({ ...v, phase: 'question', qi: 0, remainMs: 15000, question: { q: 'Q1?', o: ['a', 'b'] }, players: [] }), view);
    await page.waitForSelector('.btl-role-host .btl-timer', { timeout: 2000 });
    await page.evaluate(v => window.__btl[0].emit({ ...v, phase: 'reveal', qi: 0, remainMs: 0, question: { q: 'Q1?', o: ['a', 'b'], c: 1 }, dist: [0, 1], players: [], leaderboard: [{ name: 'Ayşe', score: 900 }] }), view);
    await page.waitForSelector('.btl-chart .btl-bar-col.btl-right', { timeout: 2000 });
    await page.evaluate(() => Battle.exit());
    if (await page.$('.btl-overlay')) throw new Error('host overlay stayed open');
    // Player: join by code, answer with a big button, see the result.
    await page.evaluate(() => Battle.openJoin('123456'));
    await page.waitForSelector('#btl-name', { visible: true, timeout: 2000 });
    await page.type('#btl-name', 'Ayşe');
    await page.click('[data-btl-setup="join"]');
    await page.waitForFunction(() => window.__btl.length === 2 && window.__btl[1].readyState === 1, { timeout: 2000 });
    if (!/role=player&name=Ay%C5%9Fe/.test(await page.evaluate(() => window.__btl[1].url))) throw new Error('player url');
    const pv = { t: 'state', hostOnline: true, title: 'Demo', total: 2, limitMs: 20000, dist: null, role: 'player', players: 1, leaderboard: [] };
    await page.evaluate(v => { const ws = window.__btl[1]; ws.emit({ t: 'joined', pid: 'p1', token: 'tok' }); ws.emit({ ...v, phase: 'question', qi: 0, remainMs: 9000, question: { q: 'Q1?', o: ['a', 'b'] }, me: { name: 'Ayşe', score: 0, rank: 1, answered: false, choice: null } }); }, pv);
    await page.waitForSelector('.btl-options-big .btl-opt.btl-c0', { timeout: 2000 });
    // Left column: toasts from earlier steps can sit over the right one.
    await page.click('.btl-options-big .btl-opt.btl-c0');
    await page.waitForSelector('.btl-locked', { timeout: 2000 });
    const sent = await page.evaluate(() => window.__btl[1].sent.filter(m => m.t === 'answer'));
    if (sent.length !== 1 || sent[0].qi !== 0 || sent[0].c !== 0) throw new Error('answer: ' + JSON.stringify(sent));
    await page.evaluate(v => window.__btl[1].emit({ ...v, phase: 'reveal', qi: 0, remainMs: 0, question: { q: 'Q1?', o: ['a', 'b'], c: 0 }, dist: [1, 0], result: { qi: 0, choice: 0, ok: true, pts: 940 }, me: { name: 'Ayşe', score: 940, rank: 1, answered: true, choice: 0 } }), pv);
    await page.waitForSelector('.btl-result-ok .btl-pts', { timeout: 2000 });
    // A dropped connection reconnects with the saved seat token.
    await page.evaluate(() => window.__btl[1].onclose({ code: 1006 }));
    await page.waitForFunction(() => window.__btl.length === 3, { timeout: 3000 });
    if (!/pid=p1&token=tok/.test(await page.evaluate(() => window.__btl[2].url))) throw new Error('rejoin url');
    await page.evaluate(() => window.__btl[2].emit({ t: 'error', code: 'kicked' }));
    await page.waitForFunction(() => /removed you/.test(document.querySelector('.btl-overlay').textContent), { timeout: 2000 });
    await page.evaluate(() => Battle.exit());
  });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(failCount ? failCount + ' step(s) failed' : 'ALL STEPS PASSED');
  await browser.close();
  process.exit(failCount || errors.length ? 1 : 0);
})();
