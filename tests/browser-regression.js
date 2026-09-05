const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = process.env.BASE_URL || 'http://localhost:4173/';
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.click('#demo-btn');
    async function check(name, fn) { await fn(); console.log('PASS  ' + name); }

    await check('hostile AI follow-ups are text and send the exact original string', async () => {
      assert.equal(await page.evaluate(async () => {
        const payload = `hello \\"'><img src=x onerror="window.injected=1">`;
        const api = API.chat;
        API.chat = async () => JSON.stringify({ answer: 'ok', followUps: [payload] });
        await Chat.sendMessage('test');
        const btn = document.querySelector('.chat-followup');
        let sent;
        API.chat = async text => { sent = text; return '{"answer":"ok"}'; };
        btn.click();
        await Promise.resolve();
        API.chat = api;
        return btn.textContent === payload && !btn.hasAttribute('onclick') && !document.querySelector('#chat-messages img') && sent === payload && !window.injected;
      }), true);
    });
    await check('old chat response cannot populate a different deck', async () => {
      assert.equal(await page.evaluate(async () => {
        const api = API.chat;
        let resolve;
        API.chat = () => new Promise(r => { resolve = r; });
        const pending = Chat.sendMessage('old deck');
        document.getElementById('demo-btn').click();
        resolve('{"answer":"STALE RESPONSE"}');
        await pending;
        API.chat = api;
        return !document.getElementById('chat-messages').textContent.includes('STALE RESPONSE');
      }), true);
    });
    await check('each AI card button adds its own response once', async () => {
      assert.equal(await page.evaluate(async () => {
        const api = API.chat;
        let n = 0;
        API.chat = async () => JSON.stringify({ type: 'flashcards', flashcards: [{ front: 'batch' + ++n, back: 'A' }] });
        await Chat.sendMessage('one'); await Chat.sendMessage('two');
        const buttons = [...document.querySelectorAll('.chat-action-btn')];
        const before = App.getStudyData().flashcards.length;
        buttons[0].click(); buttons[0].click(); buttons[1].click();
        API.chat = api;
        return App.getStudyData().flashcards.length === before + 2 && App.getStudyData().flashcards.slice(-2).map(c => c.front).join(',') === 'batch1,batch2';
      }), true);
    });
    await check('all quiz types export and print title is escaped', async () => {
      assert.equal(await page.evaluate(async () => {
        const original = App.getStudyData;
        const open = window.open;
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        let output = '', html = '';
        App.getStudyData = () => ({ title: '</title><script>evil()</script>', notes: { summary: '', sections: [] }, quiz: [
          { type: 'multiple-choice', question: 'mc', options: ['a','b'], correct: 0 },
          { type: 'true-false', question: 'tf', correct: false },
          { type: 'fill-blank', question: 'fill', answers: ['blank'] },
          { type: 'matching', question: 'match', pairs: [{left:'left',right:'right'}] },
          { type: 'open-ended', question: 'oe', correctAnswer: 'model' }
        ] });
        navigator.clipboard.writeText = async s => { output = s; };
        window.open = () => ({ document: { write(s) { html = s; }, close() {} }, print() {} });
        Export.quizText(); Export.notesPdf();
        App.getStudyData = original; window.open = open; navigator.clipboard.writeText = write;
        return output.includes('left → right') && output.includes('blank') && output.includes('model') && !html.includes('<script>evil');
      }), true);
    });
    await check('malformed imported deck renders and string IDs accept additional cards', async () => {
      assert.equal(await page.evaluate(() => {
        const d = Decks.save({ title: 'Malformed', notes: { sections: [null, { keyTerms: 'bad' }], diagrams: [null] }, flashcards: [null, { id: 'card_A', front: 'Q', back: 'A' }], quiz: [{ question: 'q', options: ['a','b'], correct: 0 }] }, '');
        App.openDeck(d.id);
        Flashcards.addCards([{front:'new',back:'answer',difficulty:'medium',category:'test'}]);
        const cards = App.getStudyData().flashcards;
        return cards.length === 2 && Number.isFinite(cards[1].id);
      }), true);
    });
    await check('empty flashcard decks do not crash study mode', async () => {
      await page.evaluate(() => { const d = Decks.save({title:'Empty',flashcards:[],quiz:[]},''); App.openDeck(d.id); Flashcards.startStudy('all'); });
      assert.equal(await page.$eval('#study-mode-overlay', el => el.style.display), 'none');
    });
    await check('delayed grading cannot mutate a replacement exam', async () => {
      assert.equal(await page.evaluate(async () => {
        const d = Decks.save({title:'Written',notes:{},flashcards:[],quiz:[{type:'open-ended',question:'why',correctAnswer:'because',keyPoints:['because']}]},'');
        App.openDeck(d.id); App.switchTab('quiz'); Quiz.startQuiz();
        const grade = API.grade;
        let resolve;
        API.grade = () => new Promise(r => { resolve = r; });
        document.getElementById('oe-answer').value = 'because';
        document.getElementById('oe-submit-btn').click();
        document.getElementById('demo-btn').click();
        resolve('{"score":3,"maxScore":3,"feedback":"STALE GRADE"}');
        await new Promise(r => setTimeout(r, 0));
        API.grade = grade;
        return !document.getElementById('tab-quiz').textContent.includes('STALE GRADE');
      }), true);
    });
    await check('append preserves schedules on nonsequential card IDs', async () => {
      assert.equal(await page.evaluate(() => {
        const d = Decks.save({title:'IDs',notes:{},flashcards:[{id:42,front:'original',back:'answer'}],quiz:[]},'');
        App.openDeck(d.id); Decks.review(42,5);
        document.getElementById('add-material-btn').click();
        document.getElementById('demo-btn').click();
        return App.getStudyData().flashcards[0].id === 42 && Decks.getSrs(42).reps === 1 && new Set(App.getStudyData().flashcards.map(c => c.id)).size === App.getStudyData().flashcards.length;
      }), true);
    });
    await check('generation honors zero counts, suppresses duplicate shortcuts and preserves navigation', async () => {
      assert.equal(await page.evaluate(async () => {
        document.getElementById('back-to-input').click();
        document.querySelector('[data-input-tab="paste"]').click();
        document.getElementById('paste-input').value = 'test generation';
        document.getElementById('fc-easy').value = '0';
        document.getElementById('quiz-open').value = '0';
        const generate = API.generateStream;
        let resolve, calls = 0, config;
        API.generateStream = (text, fc, quiz) => { calls++; config = [fc.easy, quiz.openEnded]; return new Promise(r => { resolve = r; }); };
        document.getElementById('generate-btn').click();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true}));
        const next = Decks.save({title:'Keep this deck',notes:{},flashcards:[],quiz:[]},'');
        App.openDeck(next.id);
        resolve(JSON.stringify(Demo.get()));
        await new Promise(r => setTimeout(r,0));
        API.generateStream = generate;
        return calls === 1 && config.every(n => n === 0) && App.getStudyData().title === 'Keep this deck' && Decks.getActive().id === next.id;
      }), true);
    });
    await check('disabling sync waits for in-flight upload and does not recreate the cloud copy', async () => {
      assert.equal(await page.evaluate(async () => {
        const original = { push: API.syncPush, pull: API.syncPull, del: API.syncDelete };
        const calls = [];
        API.syncPush = async () => ({code:'test-code'});
        API.syncPull = async () => ({decks:{decks:{}},stats:{}});
        API.syncDelete = async code => { calls.push('delete:' + code); };
        Sync.openModal();
        document.getElementById('sync-enable-btn').click();
        await new Promise(r => setTimeout(r,0));
        let resolve;
        API.syncPush = () => new Promise(r => { resolve = () => { calls.push('upload'); r({code:'test-code'}); }; });
        const syncing = Sync.syncNow();
        await new Promise(r => setTimeout(r,0));
        document.getElementById('sync-disable-btn').click();
        resolve();
        await syncing;
        await new Promise(r => setTimeout(r,0));
        const result = calls.join(',') === 'upload,delete:test-code' && !Sync.enabled();
        API.syncPush = original.push; API.syncPull = original.pull; API.syncDelete = original.del;
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
        return result;
      }), true);
    });
    await check('offline navigation with a query string uses cached app shell', async () => {
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.setOfflineMode(true);
      await page.goto(base + '?offline-regression=1', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof App !== 'undefined' && !!document.querySelector('#study-view.active'));
      await page.setOfflineMode(false);
    });
    assert.deepEqual(errors, []);
    console.log('ALL BROWSER REGRESSIONS PASSED');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
