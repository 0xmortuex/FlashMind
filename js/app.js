// ===== App Controller =====
const App = (() => {
  let currentView = 'input';
  let currentTab = 'notes';
  let studyData = null;
  let originalText = '';
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
    checkShareLink() || checkSavedData();
  }

  // ===== Translate static HTML =====
  function translateStaticHTML() {
    const T = i18n.t;
    document.getElementById('tagline').textContent = T('tagline');
    const profTab = document.querySelector('[data-input-tab="profile"]');
    if (profTab) profTab.textContent = T('profileTab');
    document.querySelector('[data-input-tab="paste"]').textContent = T('tabPaste');
    document.querySelector('[data-input-tab="pdf"]').textContent = T('tabPdf');
    document.querySelector('[data-input-tab="topic"]').textContent = T('tabTopic');
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
    document.getElementById('share-btn').textContent = T('share');
    document.getElementById('export-btn').textContent = T('export_');
    document.getElementById('new-material-btn').textContent = T('newMaterial');
    document.getElementById('add-material-btn').textContent = T('addMaterials');
    document.getElementById('append-cancel-btn').textContent = T('cancel');

    // Export menu items
    const exportItems = document.querySelectorAll('#export-menu button');
    const exportKeys = ['notesMd', 'notesPdf', 'cardsCsv', 'quizText', 'allJson'];
    exportItems.forEach((el, idx) => { if (exportKeys[idx]) el.textContent = T(exportKeys[idx]); });

    // Study tabs
    document.querySelector('[data-tab="notes"]').textContent = T('tabNotes');
    document.querySelector('[data-tab="flashcards"]').textContent = T('tabFlashcards');
    document.querySelector('[data-tab="quiz"]').textContent = T('tabQuiz');
    document.querySelector('[data-tab="chat"]').textContent = T('tabChat');

    // Chat header & input
    document.querySelector('.chat-header span').textContent = T('chatHeader');
    document.getElementById('chat-input').placeholder = T('chatHolder');

    // Study mode overlay
    document.getElementById('study-mode-close').title = T('exitStudy');
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
    document.querySelector('.share-label').textContent = T('shareLabel');
    document.getElementById('share-copy-btn').textContent = T('copyLink');
    document.querySelector('.share-expires').textContent = T('shareExpiry');
    document.querySelector('.share-load-card p').textContent = T('shareLoading');

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
  }

  // ===== Study Tabs =====
  function setupStudyTabs() {
    document.querySelectorAll('.study-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.study-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.study-tab[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
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

  // Route an uploaded file: JSON → import a study set (or use as text), else PDF.
  async function processFile(file) {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      return importJSONFile(file);
    }
    return processPDF(file);
  }

  async function importJSONFile(file) {
    try {
      const obj = JSON.parse(await file.text());
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
  }

  function getGenerationConfig() {
    return {
      flashcardConfig: {
        easy: parseInt(document.getElementById('fc-easy').value) || 10,
        medium: parseInt(document.getElementById('fc-medium').value) || 15,
        hard: parseInt(document.getElementById('fc-hard').value) || 10
      },
      quizConfig: {
        multipleChoice: parseInt(document.getElementById('quiz-mc').value) || 15,
        openEnded: parseInt(document.getElementById('quiz-open').value) || 8
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

    btn.disabled = true;
    textEl.style.display = 'none';
    loadingEl.style.display = '';

    let seconds = 0;
    elapsedEl.textContent = '0s';
    elapsedTimer = setInterval(() => { seconds++; elapsedEl.textContent = seconds + 's'; }, 1000);

    const { flashcardConfig, quizConfig } = getGenerationConfig();

    try {
      const raw = await API.generate(text, flashcardConfig, quizConfig);
      const data = Parser.parseGenerate(raw);
      commitStudyData(data, text);
    } catch (err) {
      showToast(i18n.t('genFailed') + ' ' + err.message, 'error');
    }

    clearInterval(elapsedTimer);
    btn.disabled = false;
    textEl.style.display = '';
    loadingEl.style.display = 'none';
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
    switchTab('notes');
  }

  // ===== Deck helpers (normalize / merge / import) =====
  // A study set is { title, notes:{summary,sections,...}, flashcards[], quiz[] }.
  function normalizeDeck(d) {
    d = d && typeof d === 'object' ? d : {};
    let notes = (d.notes && typeof d.notes === 'object') ? d.notes : {};
    if (typeof d.notes === 'string') notes = { summary: d.notes };
    return {
      title: typeof d.title === 'string' && d.title.trim() ? d.title : i18n.t('importedSet'),
      notes: {
        summary: notes.summary || '',
        sections: Array.isArray(notes.sections) ? notes.sections : [],
        importantDates: Array.isArray(notes.importantDates) ? notes.importantDates : [],
        commonMistakes: Array.isArray(notes.commonMistakes) ? notes.commonMistakes : [],
        diagrams: Array.isArray(notes.diagrams) ? notes.diagrams : []
      },
      flashcards: Array.isArray(d.flashcards) ? d.flashcards : [],
      quiz: Array.isArray(d.quiz) ? d.quiz : []
    };
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
    merged.flashcards.forEach((c, i) => { if (c) c.id = i + 1; });
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
    }
    localStorage.setItem('flashmind_data', JSON.stringify(studyData));
    localStorage.setItem('flashmind_text', originalText);
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
      localStorage.removeItem('flashmind_data');
      localStorage.removeItem('flashmind_text');
      backToInput();
    });
  }

  function backToInput() {
    currentView = 'input';
    document.getElementById('study-view').classList.remove('active');
    document.getElementById('input-view').classList.add('active');
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

    shareBtn.addEventListener('click', openShareModal);
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

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

    try {
      const response = await API.share({ studyData, originalText });
      const code = response.code;
      document.getElementById('share-link-input').value = `https://0xmortuex.github.io/FlashMind/?s=${code}`;
      loading.style.display = 'none';
      result.style.display = 'block';
      showToast(i18n.t('shareCreated'), 'success');
    } catch (err) {
      modal.style.display = 'none';
      showToast(i18n.t('shareFailed') + ' ' + err.message, 'error');
    }
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
      studyData = shared;
      localStorage.setItem('flashmind_data', JSON.stringify(shared));
      if (text) localStorage.setItem('flashmind_text', text);
      overlay.style.display = 'none';
      showStudyView(shared);
      showToast(i18n.t('shareLoaded'), 'success');
    } catch (err) {
      overlay.style.display = 'none';
      showToast(i18n.t('shareInvalid'), 'error');
    }
  }

  // ===== Auto-save =====
  function checkSavedData() {
    const saved = localStorage.getItem('flashmind_data');
    const savedText = localStorage.getItem('flashmind_text');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.title && data.notes && data.flashcards && data.quiz) {
          originalText = savedText || '';
          showToast(i18n.t('restored'), 'info');
          showStudyView(data);
          return;
        }
      } catch (e) { localStorage.removeItem('flashmind_data'); }
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // ===== Getters =====
  function getStudyData() { return studyData; }
  function getOriginalText() { return originalText; }

  document.addEventListener('DOMContentLoaded', init);

  return { switchTab, showToast, getStudyData, getOriginalText };
})();
