// ===== App Controller =====
const App = (() => {
  let currentView = 'input';
  let currentTab = 'notes';
  let studyData = null;
  let originalText = '';
  let activeDeckId = null; // id of the deck currently open (null = unsaved)
  let elapsedTimer = null;
  // When true, the next generated/imported set is MERGED into the current
  // studyData instead of replacing it ("Add Materials" flow).
  let appendMode = false;

  function init() {
    translateStaticHTML();
    setupLangSwitcher();
    setupInputTabs();
    setupStudyTabs();
    setupPDF();
    setupTopicChips();
    setupGenerate();
    setupSettings();
    setupExport();
    setupTopBar();
    setupShare();
    Notes.init();
    Flashcards.init();
    Quiz.init();
    if (typeof Search !== 'undefined') Search.init();
    if (typeof Profile !== 'undefined') Profile.init();
    Chat.init();
    if (typeof Sound !== 'undefined') Sound.init();
    if (typeof Palette !== 'undefined') Palette.init();
    if (typeof Sync !== 'undefined') Sync.init();
    Shell.init({
      getView: () => currentView,
      getTab: () => currentTab
    });
    Library.init({
      onOpen: openDeck,
      getActiveId: () => activeDeckId,
      onActiveDeckGone: () => { activeDeckId = null; studyData = null; },
      onRenamed: (id, title) => {
        if (studyData) {
          studyData.title = title.trim();
          document.getElementById('study-title').textContent = studyData.title;
        }
      },
      showToast
    });
    setupDemo();
    Library.render();
    if (typeof Today !== 'undefined') Today.init();
    if (typeof Gallery !== 'undefined') Gallery.init();
    registerServiceWorker();
    checkShareLink() || checkSavedData();
  }

  // ===== Translate static HTML =====
  function translateStaticHTML() {
    const T = i18n.t;
    document.getElementById('tagline').textContent = T('tagline');
    // Tab labels live in a span next to the tab icon — only replace the span.
    const setTabLabel = (tab, text) => {
      const label = document.querySelector(`[data-input-tab="${tab}"] .input-tab-label`);
      if (label) label.textContent = text;
    };
    setTabLabel('profile', T('profileTab'));
    setTabLabel('paste', T('tabPaste'));
    setTabLabel('pdf', T('tabPdf'));
    setTabLabel('topic', T('tabTopic'));
    document.getElementById('paste-input').placeholder = T('pasteHolder');
    document.getElementById('char-count').textContent = T('charCount', { n: 0 });
    document.getElementById('clear-btn').textContent = T('clear');
    document.querySelector('.dropzone-text').textContent = T('dropText');
    document.querySelector('.dropzone-hint').textContent = T('dropHint');
    document.getElementById('pdf-progress-text').textContent = T('extracting');
    document.getElementById('pdf-use-btn').textContent = T('useText');
    document.getElementById('pdf-clear-btn').textContent = T('remove');
    document.getElementById('topic-input').placeholder = T('topicHolder');
    document.querySelector('.btn-generate-text').textContent = T('generateBtn');
    document.querySelector('.generate-hint').textContent = T('ctrlEnter');
    document.getElementById('study-title').textContent = T('studyMaterials');
    // Topbar buttons carry an icon — translate only the label span.
    const setBtnLabel = (id, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      const label = el.querySelector('.btn-label');
      if (label) label.textContent = text; else el.textContent = text;
    };
    setBtnLabel('share-btn', T('share'));
    setBtnLabel('export-btn', T('export_'));
    setBtnLabel('new-material-btn', T('newMaterial'));
    setBtnLabel('add-material-btn', T('addMaterials'));
    document.getElementById('append-cancel-btn').textContent = T('cancel');

    // Export menu items
    const exportItems = document.querySelectorAll('#export-menu button');
    const exportKeys = ['notesMd', 'notesPdf', 'cardsCsv', 'quizText', 'examPdfKey', 'allJson'];
    exportItems.forEach((el, idx) => { if (exportKeys[idx]) el.textContent = T(exportKeys[idx]); });

    // Study tabs — set only the label span; textContent on the button would
    // wipe out the icon used by the mobile bottom nav.
    const setStudyTabLabel = (tab, text) => {
      const label = document.querySelector(`[data-tab="${tab}"] .study-tab-label`);
      if (label) label.textContent = text;
    };
    setStudyTabLabel('notes', T('tabNotes'));
    setStudyTabLabel('flashcards', T('tabFlashcards'));
    setStudyTabLabel('quiz', T('tabQuiz'));
    setStudyTabLabel('stats', T('tabStats'));
    setStudyTabLabel('chat', T('tabChat'));

    // Chat header & input
    document.querySelector('.chat-header span').textContent = T('chatHeader');
    document.getElementById('chat-input').placeholder = T('chatHolder');

    // Study mode overlay
    document.getElementById('study-mode-close').title = T('exitStudy');
    const typedCheck = document.getElementById('study-typed-check');
    if (typedCheck) typedCheck.textContent = T('checkAnswer');
    document.getElementById('study-flip-hint').textContent = T('flipHint');
    document.querySelector('.study-btn.again').textContent = T('again');
    document.querySelector('.study-btn.hard').textContent = T('hard');
    document.querySelector('.study-btn.got-it').textContent = T('gotIt');
    document.querySelector('.study-shortcuts-hint').textContent = T('shortcutsHint');

    // Deck complete
    document.querySelector('.deck-complete-card h2').textContent = T('deckComplete');
    document.querySelectorAll('.deck-stat-label').forEach((el, idx) => {
      el.textContent = [T('time'), T('mastered'), T('reviewing')][idx] || el.textContent;
    });
    document.getElementById('dc-study-again').textContent = T('studyAgain');
    document.getElementById('dc-take-quiz').textContent = T('takeQuiz');

    // Study card labels
    document.querySelector('.study-card-front .study-card-label').textContent = T('question');
    document.querySelector('.study-card-back .study-card-label').textContent = T('answer');

    // Share modal
    document.querySelector('.share-modal-header h3').textContent = T('shareTitle');
    const pubBtn = document.getElementById('share-publish-btn');
    if (pubBtn) pubBtn.textContent = '🌍 ' + T('publishToGallery');
    document.querySelector('.share-label').textContent = T('shareLabel');
    document.getElementById('share-copy-btn').textContent = T('copyLink');
    document.querySelector('.share-expires').textContent = T('shareExpiry');
    document.querySelector('.share-load-card p').textContent = T('shareLoading');

    // Demo button
    const demoBtn = document.getElementById('demo-btn');
    if (demoBtn) demoBtn.textContent = T('tryExample');

    // Generation difficulty dial
    const levelLabel = document.getElementById('gen-level-label');
    if (levelLabel) levelLabel.textContent = T('genLevelLabel');
    const levelKeys = { simple: 'genLevelSimple', standard: 'genLevelStandard', advanced: 'genLevelAdvanced' };
    document.querySelectorAll('#gen-level-options .timer-option').forEach(btn => {
      if (levelKeys[btn.dataset.level]) btn.textContent = T(levelKeys[btn.dataset.level]);
    });

    // Lang switcher active state
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === i18n.getLang());
    });
  }

  // ===== Language Switcher =====
  function setupLangSwitcher() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newLang = btn.dataset.lang;
        if (newLang !== i18n.getLang()) {
          i18n.setLang(newLang);
        }
      });
    });
  }

  // ===== Input Tabs =====
  function setupInputTabs() {
    // Returning users (who already have saved decks) land on Paste, the general
    // entry; new users land on the "10. Sınıf" profile.
    if (Decks.list().length) {
      document.querySelectorAll('.input-tab').forEach(t => t.classList.toggle('active', t.dataset.inputTab === 'paste'));
      document.querySelectorAll('.input-panel').forEach(p => p.classList.toggle('active', p.id === 'paste-panel'));
    }
    // The profile tab generates via topic chips, so the Generate button and
    // customize panel are hidden while it's active.
    const applyGenVisibility = (inputTab) => {
      const hide = inputTab === 'profile';
      const btn = document.getElementById('generate-btn');
      if (btn) btn.style.display = hide ? 'none' : '';
      document.querySelectorAll('.generate-settings, .generate-hint').forEach(el => { el.style.display = hide ? 'none' : ''; });
    };
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panelId = tab.dataset.inputTab + '-panel';
        document.getElementById(panelId).classList.add('active');
        applyGenVisibility(tab.dataset.inputTab);
      });
    });
    const activeTab = document.querySelector('.input-tab.active');
    if (activeTab) applyGenVisibility(activeTab.dataset.inputTab);

    const textarea = document.getElementById('paste-input');
    const charCount = document.getElementById('char-count');
    const clearBtn = document.getElementById('clear-btn');

    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCount.textContent = i18n.t('charCount', { n: len.toLocaleString() });
      clearBtn.style.display = len > 0 ? '' : 'none';
    });

    clearBtn.addEventListener('click', () => {
      textarea.value = '';
      charCount.textContent = i18n.t('charCount', { n: 0 });
      clearBtn.style.display = 'none';
    });

    setupUrlImport(textarea, charCount, clearBtn);
  }

  // ===== Import text from a URL (worker fetches + strips the page) =====
  function setupUrlImport(textarea, charCount, clearBtn) {
    const input = document.getElementById('url-import-input');
    const btn = document.getElementById('url-import-btn');
    if (!input || !btn) return;
    input.placeholder = i18n.t('urlHolder');
    btn.textContent = i18n.t('urlFetch');

    const run = async () => {
      let url = input.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      btn.disabled = true;
      btn.textContent = i18n.t('urlFetching');
      try {
        const pageText = await API.fetchUrl(url);
        textarea.value = pageText;
        charCount.textContent = i18n.t('charCount', { n: pageText.length.toLocaleString() });
        clearBtn.style.display = '';
        showToast(i18n.t('urlFetched'), 'success');
      } catch (err) {
        showToast(i18n.t('urlFailed') + ' ' + err.message, 'error');
      }
      btn.disabled = false;
      btn.textContent = i18n.t('urlFetch');
    };
    btn.addEventListener('click', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  }

  // ===== Study Tabs =====
  const TAB_ORDER = ['notes', 'flashcards', 'quiz', 'stats', 'chat'];
  let tabIndicator = null;

  function setupStudyTabs() {
    document.querySelectorAll('.study-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    // Sliding underline that glides between tabs (desktop only; fx.css hides
    // it when the tab strip becomes the mobile bottom nav).
    const nav = document.querySelector('.study-tabs');
    tabIndicator = document.createElement('span');
    tabIndicator.className = 'tab-indicator';
    nav.appendChild(tabIndicator);
    window.addEventListener('resize', moveTabIndicator);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveTabIndicator);
  }

  function moveTabIndicator() {
    if (!tabIndicator) return;
    const active = document.querySelector('.study-tab.active');
    if (!active) return;
    tabIndicator.style.width = active.offsetWidth + 'px';
    tabIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function switchTab(tabName) {
    const prevTab = currentTab;
    currentTab = tabName;
    document.querySelectorAll('.study-tab').forEach(t => {
      const active = t.dataset.tab === tabName;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const content = document.getElementById(`tab-${tabName}`);
    content.classList.add('active');
    // Content slides in from the direction of travel.
    if (prevTab !== tabName) {
      const dir = TAB_ORDER.indexOf(tabName) > TAB_ORDER.indexOf(prevTab) ? 'tab-slide-left' : 'tab-slide-right';
      content.classList.remove('tab-slide-left', 'tab-slide-right');
      void content.offsetWidth; // restart the animation
      content.classList.add(dir);
      content.addEventListener('animationend', () => content.classList.remove(dir), { once: true });
    }
    moveTabIndicator();
    Shell.updateReadProgress();
    if (tabName === 'stats' && typeof Stats !== 'undefined') Stats.render();
  }

  // ===== PDF =====
  function setupPDF() {
    const dropzone = document.getElementById('pdf-dropzone');
    const fileInput = document.getElementById('pdf-file-input');
    const preview = document.getElementById('pdf-preview');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) processFile(fileInput.files[0]); });

    document.getElementById('pdf-use-btn').addEventListener('click', () => {
      const text = document.getElementById('pdf-text-preview').value;
      if (text) {
        document.getElementById('paste-input').value = text;
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-input-tab="paste"]').classList.add('active');
        document.getElementById('paste-panel').classList.add('active');
        document.getElementById('char-count').textContent = i18n.t('charCount', { n: text.length.toLocaleString() });
        document.getElementById('clear-btn').style.display = '';
      }
    });

    document.getElementById('pdf-clear-btn').addEventListener('click', () => {
      dropzone.style.display = '';
      preview.style.display = 'none';
      fileInput.value = '';
    });
  }

  // Route an uploaded file: JSON → import a study set (or use as text),
  // CSV/TSV → flashcard import, image → OCR, else PDF.
  async function processFile(file) {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      return importJSONFile(file);
    }
    if (/\.(csv|tsv)$/i.test(file.name) || file.type === 'text/csv') {
      return importCSVFile(file);
    }
    if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
      return processImage(file);
    }
    return processPDF(file);
  }

  // Photo → text via client-side OCR (tesseract.js, lazy-loaded). Reuses the
  // PDF preview/progress UI, so the extracted text lands in the same flow.
  async function processImage(file) {
    const dropzone = document.getElementById('pdf-dropzone');
    const preview = document.getElementById('pdf-preview');
    const progressEl = document.getElementById('pdf-progress');
    const progressFill = document.getElementById('pdf-progress-fill');
    const progressText = document.getElementById('pdf-progress-text');

    document.getElementById('pdf-filename').textContent = file.name;
    dropzone.style.display = 'none';
    preview.style.display = '';
    progressEl.style.display = '';
    progressFill.style.width = '0%';
    progressText.textContent = i18n.t('ocrLoading');
    document.getElementById('pdf-text-preview').value = '';
    document.getElementById('pdf-pages').textContent = '';

    try {
      const text = await OCR.extractText(file, (p) => {
        progressFill.style.width = (p * 100).toFixed(0) + '%';
        progressText.textContent = i18n.t('ocrProgress', { p: Math.round(p * 100) });
      });
      progressEl.style.display = 'none';
      document.getElementById('pdf-text-preview').value = text;
      if (!text) showToast(i18n.t('ocrEmpty'), 'info');
    } catch (err) {
      progressEl.style.display = 'none';
      showToast(i18n.t('ocrFailed') + ' ' + err.message, 'error');
      dropzone.style.display = '';
      preview.style.display = 'none';
    }
  }

  // CSV/TSV → a flashcards-only deck (our export, Anki exports, any
  // front/back sheet).
  async function importCSVFile(file) {
    try {
      const cards = Parser.parseCSVCards(await file.text());
      if (!cards.length) { showToast(i18n.t('csvEmpty'), 'error'); return; }
      const title = file.name.replace(/\.(csv|tsv)$/i, '').replace(/[_-]+/g, ' ').trim() || i18n.t('importedSet');
      commitStudyData({ title, notes: { summary: '' }, flashcards: cards, quiz: [] }, '');
      showToast(i18n.t('csvImported', { n: cards.length }), 'success');
    } catch (err) {
      showToast(i18n.t('jsonInvalid') + ' ' + err.message, 'error');
    }
  }

  async function importJSONFile(file) {
    try {
      const obj = JSON.parse(await file.text());
      if (obj && obj.flashmindBackup === 1) {
        // Whole-library backup — merge into the local library (tombstone-aware,
        // never destructive) and refresh.
        Decks.mergeRemote(obj.decks);
        Stats.mergeRemote(obj.stats);
        Library.render();
        showToast(i18n.t('backupRestored'), 'success');
        return;
      }
      if (looksLikeDeck(obj)) {
        // A FlashMind set (e.g. an "Everything as JSON" export). Load it
        // directly — merged into the current set if "Add Materials" is active.
        const wasAppend = appendMode;
        commitStudyData(obj, ''); // shows its own "added" toast when appending
        if (!wasAppend) showToast(i18n.t('jsonImported'), 'success');
      } else {
        // Arbitrary JSON — feed it to the generator as raw study text.
        const text = JSON.stringify(obj, null, 2);
        document.getElementById('paste-input').value = text;
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-input-tab="paste"]').classList.add('active');
        document.getElementById('paste-panel').classList.add('active');
        document.getElementById('char-count').textContent = i18n.t('charCount', { n: text.length.toLocaleString() });
        document.getElementById('clear-btn').style.display = '';
        showToast(i18n.t('jsonAsText'), 'info');
      }
    } catch (err) {
      showToast(i18n.t('jsonInvalid') + ' ' + err.message, 'error');
    }
  }

  async function processPDF(file) {
    const dropzone = document.getElementById('pdf-dropzone');
    const preview = document.getElementById('pdf-preview');
    const progressEl = document.getElementById('pdf-progress');
    const progressFill = document.getElementById('pdf-progress-fill');
    const progressText = document.getElementById('pdf-progress-text');

    document.getElementById('pdf-filename').textContent = file.name;
    dropzone.style.display = 'none';
    preview.style.display = '';
    progressEl.style.display = '';
    document.getElementById('pdf-text-preview').value = '';
    document.getElementById('pdf-pages').textContent = '';

    try {
      const result = await PDF.extractText(file, (current, total) => {
        const pct = (current / total * 100).toFixed(0);
        progressFill.style.width = pct + '%';
        progressText.textContent = i18n.t('extractingPage', { c: current, t: total });
        document.getElementById('pdf-pages').textContent = i18n.t('pages', { n: total });
      });
      progressEl.style.display = 'none';
      document.getElementById('pdf-text-preview').value = result.text;
      document.getElementById('pdf-pages').textContent = i18n.t('pages', { n: result.pages });
    } catch (err) {
      progressEl.style.display = 'none';
      showToast(i18n.t('pdfFailed') + ' ' + err.message, 'error');
      dropzone.style.display = '';
      preview.style.display = 'none';
    }
  }

  // ===== Topic Chips =====
  let topicsExpanded = false;

  function setupTopicChips() {
    renderTopicCategories();

    const showMoreBtn = document.getElementById('show-more-topics');
    showMoreBtn.addEventListener('click', () => {
      topicsExpanded = !topicsExpanded;
      renderTopicCategories();
    });
  }

  function renderTopicCategories() {
    const container = document.getElementById('topic-categories');
    const showMoreBtn = document.getElementById('show-more-topics');
    const categories = i18n.getTopicCategories();
    const visibleCount = topicsExpanded ? categories.length : 2;
    const visible = categories.slice(0, visibleCount);

    let html = '';
    visible.forEach(cat => {
      html += `<div class="topic-category">
        <h4 class="topic-category-name">${escText(cat.name)}</h4>
        <div class="topic-chips">`;
      cat.topics.forEach(topic => {
        const safe = topic.replace(/"/g, '&quot;');
        html += `<button class="topic-chip" data-topic="${safe}">${escText(topic)}</button>`;
      });
      html += `</div></div>`;
    });

    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('.topic-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('topic-input').value = chip.dataset.topic;
      });
    });

    // Update show more button
    if (categories.length <= 2) {
      showMoreBtn.style.display = 'none';
    } else {
      showMoreBtn.style.display = '';
      showMoreBtn.textContent = topicsExpanded ? i18n.t('showFewerTopics') : i18n.t('showMoreTopics');
    }
  }

  function escText(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ===== Settings Panel =====
  // Generation difficulty level ("difficulty dial"): simple / standard /
  // advanced — persisted, appended as an instruction to the generation input.
  let genLevel = localStorage.getItem('flashmind_genlevel') || 'standard';
  const LEVEL_HINTS = {
    simple: 'Explain everything as simply as possible, for a beginner: short sentences, everyday examples, minimal jargon, easier questions.',
    advanced: 'Target an advanced student preparing for a competitive exam: deeper detail, tricky distinctions, and noticeably harder questions.'
  };

  function setupSettings() {
    const toggle = document.getElementById('settings-toggle');
    const panel = document.getElementById('settings-panel');

    toggle.addEventListener('click', () => {
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : '';
      toggle.classList.toggle('open', !isOpen);
    });

    ['fc-easy', 'fc-medium', 'fc-hard'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        const total = ['fc-easy', 'fc-medium', 'fc-hard']
          .reduce((sum, id) => sum + (parseInt(document.getElementById(id).value) || 0), 0);
        document.getElementById('fc-total').textContent = `Total: ${total}`;
      });
    });

    document.querySelectorAll('#gen-level-options .timer-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.level === genLevel);
      btn.addEventListener('click', () => {
        genLevel = btn.dataset.level;
        localStorage.setItem('flashmind_genlevel', genLevel);
        document.querySelectorAll('#gen-level-options .timer-option').forEach(b =>
          b.classList.toggle('active', b === btn));
      });
    });
  }

  function getGenerationConfig() {
    const amount = (id, fallback) => {
      const input = document.getElementById(id);
      const value = Number.parseInt(input.value, 10);
      return Number.isFinite(value) ? Math.min(Number(input.max) || 100, Math.max(Number(input.min) || 0, value)) : fallback;
    };
    return {
      flashcardConfig: {
        easy: amount('fc-easy', 10),
        medium: amount('fc-medium', 15),
        hard: amount('fc-hard', 10)
      },
      quizConfig: {
        multipleChoice: amount('quiz-mc', 15),
        openEnded: amount('quiz-open', 8)
      }
    };
  }

  // ===== Generate =====
  function setupGenerate() {
    document.getElementById('generate-btn').addEventListener('click', generate);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentView === 'input') generate();
    });
  }

  async function generate() {
    const btn = document.getElementById('generate-btn');
    if (btn.disabled) return;
    const targetData = studyData, targetAppend = appendMode;
    const textEl = btn.querySelector('.btn-generate-text');
    const loadingEl = btn.querySelector('.btn-generate-loading');
    const elapsedEl = document.getElementById('elapsed-time');

    let text = '';
    const activeTab = document.querySelector('.input-tab.active').dataset.inputTab;
    if (activeTab === 'paste') text = document.getElementById('paste-input').value.trim();
    else if (activeTab === 'pdf') text = document.getElementById('pdf-text-preview').value.trim();
    else if (activeTab === 'topic') {
      text = document.getElementById('topic-input').value.trim();
      if (text) text = `Generate comprehensive study materials about: ${text}`;
    }

    if (!text) { showToast(i18n.t('noInput'), 'error'); return; }
    if (text.length > 15000) { text = text.substring(0, 15000); showToast(i18n.t('truncated'), 'info'); }
    if (LEVEL_HINTS[genLevel]) text += '\n\n[Difficulty instruction: ' + LEVEL_HINTS[genLevel] + ']';

    btn.disabled = true;
    textEl.style.display = 'none';
    loadingEl.style.display = '';

    // Staged progress: an animated checklist under the button walks through
    // the generation phases (time-driven — it's a single API call) with a
    // shimmering skeleton, so the wait feels alive.
    const stageEl = document.getElementById('gen-stage');
    if (stageEl) stageEl.textContent = i18n.t('generating');
    let seconds = 0;
    genStreaming = false;
    elapsedEl.textContent = '0s';
    renderGenProgress(0);
    elapsedTimer = setInterval(() => {
      seconds++;
      elapsedEl.textContent = seconds + 's';
      // Time-based stage advance is only the fallback; once the stream
      // delivers content, stages are driven by what's actually been written.
      if (!genStreaming) renderGenProgress(Math.min(Math.floor(seconds / 8), 3));
    }, 1000);

    const { flashcardConfig, quizConfig } = getGenerationConfig();

    try {
      let raw = null;
      try {
        raw = await API.generateStream(text, flashcardConfig, quizConfig, updateGenLive);
      } catch (e) {
        raw = null; // streaming unavailable — fall back to the plain request
      }
      if (!raw) raw = await API.generate(text, flashcardConfig, quizConfig);
      const data = Parser.parseGenerate(raw, {
        requireFlashcards: Object.values(flashcardConfig).some(n => n > 0),
        requireQuiz: Object.values(quizConfig).some(n => n > 0)
      });
      if (studyData === targetData && appendMode === targetAppend) commitStudyData(data, text);
      else {
        // Navigation during generation must not append to a different deck.
        const previous = Decks.getActive();
        Decks.save(data, text);
        if (previous) Decks.setActive(previous.id);
        Library.render();
        showToast(i18n.getLang() === 'tr' ? 'Oluşturulan materyaller yeni deste olarak kaydedildi.' : 'Generated materials saved as a new deck.', 'success');
      }
    } catch (err) {
      showToast(i18n.t('genFailed') + ' ' + err.message, 'error');
    }

    clearInterval(elapsedTimer);
    hideGenProgress();
    btn.disabled = false;
    textEl.style.display = '';
    loadingEl.style.display = 'none';
  }

  // Stage checklist rendered under the Generate button while a set is being
  // built. Steps before `activeIdx` show a drawn check, the active one spins.
  let genProgressStage = -1;
  let genStreaming = false;

  // Streaming progress: derive the real stage and live counters from the
  // accumulated model output instead of guessing from elapsed time.
  function updateGenLive(full) {
    genStreaming = true;
    const stage = full.includes('"quiz"') ? 3 : full.includes('"flashcards"') ? 2 : full.includes('"sections"') ? 1 : 0;
    renderGenProgress(stage);
    const live = document.getElementById('gen-live');
    if (!live) return;
    if (stage >= 2) {
      const fc = (full.match(/"front"/g) || []).length;
      const qs = (full.match(/"question"/g) || []).length;
      live.textContent = i18n.t('genLive', { f: fc, q: qs });
    } else {
      live.textContent = '';
    }
  }

  function renderGenProgress(activeIdx) {
    const panel = document.getElementById('gen-progress');
    if (!panel) return;
    if (genProgressStage === activeIdx && panel.style.display !== 'none') return;
    genProgressStage = activeIdx;
    const stages = [i18n.t('genStage1'), i18n.t('genStage2'), i18n.t('genStage3'), i18n.t('genStage4')];
    const spinner = '<svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>';
    const check = '<svg class="gen-check" viewBox="0 0 24 24"><path d="M5 13l4 4 10-10"/></svg>';
    panel.innerHTML = stages.map((label, i) => {
      const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
      const icon = state === 'done' ? check : state === 'active' ? spinner : '<span class="dot"></span>';
      return `<div class="gen-step ${state}"><span class="gen-step-icon">${icon}</span><span>${label}</span></div>`;
    }).join('') + '<div class="gen-live" id="gen-live"></div><div class="gen-skeleton"><span></span><span></span><span></span></div>';
    panel.style.display = '';
  }

  function hideGenProgress() {
    genProgressStage = -1;
    const panel = document.getElementById('gen-progress');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  }

  // ===== Show Study View =====
  function showStudyView(data) {
    studyData = data;
    currentView = 'study';
    document.getElementById('input-view').classList.remove('active');
    document.getElementById('study-view').classList.add('active');
    document.getElementById('study-title').textContent = data.title;
    Notes.render(data);
    Flashcards.setCards(data.flashcards);
    Quiz.setQuestions(data.quiz);
    Chat.setup(data.title);
    if (typeof Search !== 'undefined') Search.reset();
    if (typeof Stats !== 'undefined') Stats.render();
    switchTab('notes');
  }

  // ===== Deck helpers (normalize / merge / import) =====
  // A study set is { title, notes:{summary,sections,...}, flashcards[], quiz[] }.
  function normalizeDeck(d) {
    return Parser.normalizeStudyData(d);
  }

  // Does a parsed JSON object look like a FlashMind study set we can import?
  function looksLikeDeck(obj) {
    return obj && typeof obj === 'object' &&
      typeof obj.title === 'string' &&
      (Array.isArray(obj.flashcards) || Array.isArray(obj.quiz));
  }

  // Merge `extra` into `base`: concatenate cards/quiz/note-sections, join
  // summaries, then re-number ids so navigation stays unique.
  function mergeStudyData(base, extra) {
    const b = normalizeDeck(base), e = normalizeDeck(extra);
    const merged = {
      title: b.title,
      notes: {
        summary: [b.notes.summary, e.notes.summary].filter(Boolean).join('\n\n'),
        sections: [...b.notes.sections, ...e.notes.sections],
        importantDates: [...b.notes.importantDates, ...e.notes.importantDates],
        commonMistakes: [...b.notes.commonMistakes, ...e.notes.commonMistakes],
        diagrams: [...b.notes.diagrams, ...e.notes.diagrams]
      },
      flashcards: [...b.flashcards, ...e.flashcards],
      quiz: [...b.quiz, ...e.quiz]
    };
    // Keep the original IDs: their schedules are keyed by these values.
    const used = new Set(b.flashcards.map(c => String(c.id)));
    let next = 1;
    merged.flashcards = [...b.flashcards, ...e.flashcards.map(c => {
      while (used.has(String(next))) next++;
      const id = next++;
      used.add(String(id));
      return { ...c, id };
    })];
    merged.quiz.forEach((q, i) => { if (q) q.id = i + 1; });
    return merged;
  }

  // Single commit path for both generation and JSON import. Respects append
  // mode, persists, refreshes the study view, and returns the active set.
  function commitStudyData(data, sourceText) {
    const incoming = normalizeDeck(data);
    if (appendMode && studyData) {
      studyData = mergeStudyData(studyData, incoming);
      if (sourceText) originalText = [originalText, sourceText].filter(Boolean).join('\n\n');
      showToast(i18n.t('materialsAdded'), 'success');
    } else {
      studyData = incoming;
      originalText = sourceText || '';
      activeDeckId = null; // a fresh set becomes a new deck below
    }
    const deck = Decks.save(studyData, originalText, activeDeckId);
    activeDeckId = deck.id;
    exitAppendMode();
    showStudyView(studyData);
    return studyData;
  }

  // ===== Add Materials (append mode) =====
  function startAddMaterials() {
    if (!studyData) return;
    appendMode = true;
    const banner = document.getElementById('append-banner');
    document.getElementById('append-banner-text').textContent =
      i18n.t('addingTo', { title: studyData.title });
    banner.style.display = 'flex';
    // Fresh input fields so the user adds new material, not a duplicate.
    const paste = document.getElementById('paste-input');
    if (paste) { paste.value = ''; document.getElementById('char-count').textContent = i18n.t('charCount', { n: 0 }); }
    backToInput();
    window.scrollTo(0, 0);
  }

  function exitAppendMode() {
    appendMode = false;
    const banner = document.getElementById('append-banner');
    if (banner) banner.style.display = 'none';
  }

  // ===== Top Bar =====
  function setupTopBar() {
    document.getElementById('back-to-input').addEventListener('click', backToInput);
    document.getElementById('add-material-btn').addEventListener('click', startAddMaterials);
    document.getElementById('append-cancel-btn').addEventListener('click', exitAppendMode);
    document.getElementById('new-material-btn').addEventListener('click', () => {
      exitAppendMode();
      // Keep saved decks intact; just return to the input screen for a new one.
      activeDeckId = null;
      studyData = null;
      Library.render();
      backToInput();
    });
  }

  function backToInput() {
    currentView = 'input';
    document.getElementById('study-view').classList.remove('active');
    document.getElementById('input-view').classList.add('active');
    // Re-render so a deck created this session (and fresh due counts) show up.
    Library.render();
  }

  // ===== Export =====
  function setupExport() {
    const btn = document.getElementById('export-btn');
    const menu = document.getElementById('export-menu');
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.querySelectorAll('button').forEach(item => {
      item.addEventListener('click', () => {
        menu.classList.remove('open');
        const action = item.dataset.export;
        if (action === 'notes-md') Export.copyNotesMd();
        else if (action === 'notes-pdf') Export.notesPdf();
        else if (action === 'cards-csv') Export.cardsCSV();
        else if (action === 'quiz-text') Export.quizText();
        else if (action === 'exam-pdf') Export.examPdf();
        else if (action === 'all-json') Export.allJSON();
      });
    });
  }

  // ===== Share =====
  function setupShare() {
    const shareBtn = document.getElementById('share-btn');
    const modal = document.getElementById('share-modal');
    const closeBtn = document.getElementById('share-modal-close');
    const copyBtn = document.getElementById('share-copy-btn');
    const whatsappBtn = document.getElementById('share-whatsapp');
    const discordBtn = document.getElementById('share-discord');

    let releaseShareTrap = null;
    const closeShare = () => {
      modal.style.display = 'none';
      if (releaseShareTrap) { releaseShareTrap(); releaseShareTrap = null; }
    };
    modal._close = closeShare;
    modal._trap = () => { if (releaseShareTrap) releaseShareTrap(); releaseShareTrap = FX.trapFocus(modal.querySelector('.share-modal')); };
    shareBtn.addEventListener('click', openShareModal);
    closeBtn.addEventListener('click', closeShare);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeShare(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') closeShare();
    });

    copyBtn.addEventListener('click', () => {
      const input = document.getElementById('share-link-input');
      navigator.clipboard.writeText(input.value).then(() => {
        copyBtn.textContent = i18n.t('copied');
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = i18n.t('copyLink'); copyBtn.classList.remove('copied'); }, 2000);
      }).catch(() => {
        input.select();
        document.execCommand('copy');
        copyBtn.textContent = i18n.t('copied');
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = i18n.t('copyLink'); copyBtn.classList.remove('copied'); }, 2000);
      });
    });

    whatsappBtn.addEventListener('click', () => {
      const url = document.getElementById('share-link-input').value;
      const title = studyData ? studyData.title : '';
      const text = i18n.t('shareWhatsapp', { title }) + ' ' + url;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    });

    // Opt-in gallery listing for the share code that was just created.
    const publishBtn = document.getElementById('share-publish-btn');
    if (publishBtn) publishBtn.addEventListener('click', async () => {
      if (!lastShareCode || publishBtn.disabled) return;
      publishBtn.disabled = true;
      try {
        await API.publishShare(lastShareCode);
        publishBtn.textContent = '✓ ' + i18n.t('publishedToGallery');
        showToast(i18n.t('publishedToGallery'), 'success');
        if (typeof Gallery !== 'undefined') Gallery.load().catch(() => {});
      } catch (err) {
        publishBtn.disabled = false;
        showToast(i18n.t('publishFailed') + ' ' + err.message, 'error');
      }
    });

    discordBtn.addEventListener('click', () => {
      const url = document.getElementById('share-link-input').value;
      const title = studyData ? studyData.title : '';
      const text = i18n.t('shareDiscord', { title }) + '\n' + url;
      navigator.clipboard.writeText(text).then(() => {
        showToast(i18n.t('discordCopied'), 'success');
      }).catch(() => { showToast(i18n.t('failedCopy'), 'error'); });
    });
  }

  async function openShareModal() {
    if (!studyData) { showToast(i18n.t('noDataShare'), 'error'); return; }
    const modal = document.getElementById('share-modal');
    const loading = document.getElementById('share-loading');
    const result = document.getElementById('share-result');
    modal.style.display = 'flex';
    loading.style.display = 'flex';
    result.style.display = 'none';
    if (modal._trap) modal._trap();

    try {
      const response = await API.share({ studyData, originalText });
      const code = response.code;
      lastShareCode = code;
      const publishBtn = document.getElementById('share-publish-btn');
      if (publishBtn) {
        publishBtn.disabled = false;
        publishBtn.textContent = '🌍 ' + i18n.t('publishToGallery');
      }
      document.getElementById('share-link-input').value = `${window.location.origin}${window.location.pathname}?s=${encodeURIComponent(code)}`;
      loading.style.display = 'none';
      result.style.display = 'block';
      showToast(i18n.t('shareCreated'), 'success');
    } catch (err) {
      modal._close();
      showToast(i18n.t('shareFailed') + ' ' + err.message, 'error');
    }
  }

  // The most recent share code minted in this session (gallery publishing).
  let lastShareCode = null;

  // Open a shared deck by code (community gallery cards) — same pipeline as
  // an incoming ?s= link.
  function openSharedCode(code) {
    if (!code) return;
    const overlay = document.getElementById('share-load-overlay');
    overlay.style.display = 'flex';
    loadSharedMaterials(code, overlay);
  }

  // ===== Share Link Detection =====
  function checkShareLink() {
    const shareCode = new URLSearchParams(window.location.search).get('s');
    if (!shareCode) return false;
    const overlay = document.getElementById('share-load-overlay');
    overlay.style.display = 'flex';
    history.replaceState({}, '', window.location.pathname);
    loadSharedMaterials(shareCode, overlay);
    return true;
  }

  async function loadSharedMaterials(code, overlay) {
    // Step 1: fetch. Only a real 404 from the worker means the share is gone;
    // a network/5xx failure is a DIFFERENT problem and must not masquerade as
    // "expired" (that misdiagnosis is why a working link looked dead).
    let data;
    try {
      data = await API.load(code);
    } catch (err) {
      overlay.style.display = 'none';
      const notFound = /not found|expired|404/i.test(err && err.message || '');
      showToast(i18n.t(notFound ? 'shareExpired' : 'shareLoadError'), 'error');
      return;
    }

    // Step 2: use the data. Be lenient — a deck is usable with a title plus at
    // least flashcards OR a quiz. Notes/quiz/flashcards may legitimately be
    // empty (e.g. a flashcards-only deck), so normalize rather than reject.
    try {
      const shared = data.studyData || data;
      const text = data.originalText || '';
      shared.notes = shared.notes || '';
      shared.flashcards = Array.isArray(shared.flashcards) ? shared.flashcards : [];
      shared.quiz = Array.isArray(shared.quiz) ? shared.quiz : [];
      const usable = shared.title && (shared.flashcards.length || shared.quiz.length);
      if (!usable) throw new Error('Invalid');
      originalText = text;
      studyData = normalizeDeck(shared);
      const deck = Decks.save(studyData, text, null);
      activeDeckId = deck.id;
      overlay.style.display = 'none';
      showStudyView(studyData);
      Library.render();
      showToast(i18n.t('shareLoaded'), 'success');
    } catch (err) {
      overlay.style.display = 'none';
      showToast(i18n.t('shareInvalid'), 'error');
    }
  }

  // ===== Auto-restore last active deck =====
  function checkSavedData() {
    const deck = Decks.getActive();
    if (deck && deck.data) {
      openDeck(deck.id, true);
      // Gentle on-open reminder when reviews are waiting.
      const cards = Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
      const due = Decks.dueCards(cards).length;
      if (due > 0) setTimeout(() => showToast(i18n.t('dueReminder', { n: due }), 'info'), 1200);
    }
  }

  // Persist the currently open study set back to its deck (used when modules
  // append cards/questions outside the normal generate/commit path).
  function persistActiveDeck() {
    if (!studyData) return;
    const deck = Decks.save(studyData, originalText, activeDeckId);
    activeDeckId = deck.id;
  }

  // ===== Deck Library =====
  function openDeck(id, silent) {
    const deck = Decks.get(id);
    if (!deck) return;
    Decks.setActive(id);
    activeDeckId = id;
    studyData = normalizeDeck(deck.data);
    originalText = deck.originalText || '';
    if (!silent) showToast(i18n.t('deckOpened', { title: studyData.title }), 'info');
    else showToast(i18n.t('restored'), 'info');
    showStudyView(studyData);
    Library.render();
  }

  // Thin wrapper so external modules (palette.js, sync.js) can refresh the
  // deck library through App's public surface.
  function refreshLibrary(reloadActive = false) {
    if (reloadActive && activeDeckId) {
      if (Decks.get(activeDeckId)) openDeck(activeDeckId, true);
      else {
        activeDeckId = null; studyData = null;
        Quiz.setQuestions([]); Flashcards.setCards([]);
        exitAppendMode(); backToInput();
      }
    }
    Library.render();
  }

  // ===== Demo Deck =====
  function setupDemo() {
    const btn = document.getElementById('demo-btn');
    if (btn) btn.addEventListener('click', () => {
      if (typeof Demo === 'undefined') return;
      commitStudyData(Demo.get(), '');
      showToast(i18n.t('demoLoaded'), 'success');
    });
  }

  // ===== Service Worker (PWA) =====
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline unsupported — non-fatal */ });
      });
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Type icon (styled circle) ahead of the message text.
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'i';
    toast.appendChild(icon);
    toast.appendChild(document.createTextNode(message));
    // Auto-dismiss progress bar along the bottom edge.
    const progress = document.createElement('span');
    progress.className = 'toast-progress';
    progress.style.animationDuration = '3000ms';
    toast.appendChild(progress);
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // ===== Getters =====
  function getStudyData() { return studyData; }
  function getOriginalText() { return originalText; }

  document.addEventListener('DOMContentLoaded', init);

  return {
    switchTab,
    showToast,
    getStudyData,
    getOriginalText,
    openDeck,
    // Pass-throughs kept for external callers (palette.js).
    toggleTheme: (originEl) => Shell.toggleTheme(originEl),
    toggleShortcuts: (force) => Shell.toggleShortcuts(force),
    refreshLibrary,
    persistActiveDeck,
    openSharedCode
  };
})();
