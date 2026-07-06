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

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE/PAGE ERRORS');
  console.log(failCount ? failCount + ' step(s) failed' : 'ALL STEPS PASSED');
  await browser.close();
  process.exit(failCount || errors.length ? 1 : 0);
})();
