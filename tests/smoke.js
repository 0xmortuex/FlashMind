// FlashMind smoke test: load app, exercise the new UI paths, report errors.
// CI-friendly: uses full puppeteer (bundled Chromium), BASE_URL env override,
// and exits non-zero when any step fails or console/page errors are collected.
const puppeteer = require('puppeteer');

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

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(failCount ? failCount + ' step(s) failed' : 'ALL STEPS PASSED');
  await browser.close();
  process.exit(failCount || errors.length ? 1 : 0);
})();
