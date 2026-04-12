// ===== App Controller =====
const App = (() => {
  let currentView = 'input';
  let currentTab = 'notes';
  let studyData = null;
  let originalText = '';
  let elapsedTimer = null;

  function init() {
    setupInputTabs();
    setupStudyTabs();
    setupPDF();
    setupTopicChips();
    setupGenerate();
    setupExport();
    setupTopBar();
    Notes.init();
    Flashcards.init();
    Quiz.init();
    Chat.init();
    checkSavedData();
  }

  // ===== Input Tabs =====
  function setupInputTabs() {
    document.querySelectorAll('.input-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panelId = tab.dataset.inputTab + '-panel';
        document.getElementById(panelId).classList.add('active');
      });
    });

    // Character count
    const textarea = document.getElementById('paste-input');
    const charCount = document.getElementById('char-count');
    const clearBtn = document.getElementById('clear-btn');

    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCount.textContent = `${len.toLocaleString()} characters`;
      clearBtn.style.display = len > 0 ? '' : 'none';
    });

    clearBtn.addEventListener('click', () => {
      textarea.value = '';
      charCount.textContent = '0 characters';
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

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        processPDF(file);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) processPDF(fileInput.files[0]);
    });

    document.getElementById('pdf-use-btn').addEventListener('click', () => {
      const text = document.getElementById('pdf-text-preview').value;
      if (text) {
        document.getElementById('paste-input').value = text;
        // Switch to paste tab
        document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-input-tab="paste"]').classList.add('active');
        document.getElementById('paste-panel').classList.add('active');
        document.getElementById('char-count').textContent = `${text.length.toLocaleString()} characters`;
        document.getElementById('clear-btn').style.display = '';
      }
    });

    document.getElementById('pdf-clear-btn').addEventListener('click', () => {
      dropzone.style.display = '';
      preview.style.display = 'none';
      fileInput.value = '';
    });
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
        progressText.textContent = `Extracting text... Page ${current}/${total}`;
        document.getElementById('pdf-pages').textContent = `${total} pages`;
      });

      progressEl.style.display = 'none';
      document.getElementById('pdf-text-preview').value = result.text;
      document.getElementById('pdf-pages').textContent = `${result.pages} pages`;
    } catch (err) {
      progressEl.style.display = 'none';
      showToast('Failed to extract PDF text: ' + err.message, 'error');
      dropzone.style.display = '';
      preview.style.display = 'none';
    }
  }

  // ===== Topic Chips =====
  function setupTopicChips() {
    document.querySelectorAll('.topic-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('topic-input').value = chip.dataset.topic;
      });
    });
  }

  // ===== Generate =====
  function setupGenerate() {
    const btn = document.getElementById('generate-btn');

    btn.addEventListener('click', generate);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentView === 'input') {
        generate();
      }
    });
  }

  async function generate() {
    const btn = document.getElementById('generate-btn');
    const textEl = btn.querySelector('.btn-generate-text');
    const loadingEl = btn.querySelector('.btn-generate-loading');
    const elapsedEl = document.getElementById('elapsed-time');

    // Get text based on active tab
    let text = '';
    const activeTab = document.querySelector('.input-tab.active').dataset.inputTab;

    if (activeTab === 'paste') {
      text = document.getElementById('paste-input').value.trim();
    } else if (activeTab === 'pdf') {
      text = document.getElementById('pdf-text-preview').value.trim();
    } else if (activeTab === 'topic') {
      text = document.getElementById('topic-input').value.trim();
      if (text) text = `Generate comprehensive study materials about: ${text}`;
    }

    if (!text) {
      showToast('Please enter some text or a topic first', 'error');
      return;
    }

    // Truncate very long text
    if (text.length > 15000) {
      text = text.substring(0, 15000);
      showToast('Text truncated to 15,000 characters', 'info');
    }

    originalText = text;

    // Loading state
    btn.disabled = true;
    textEl.style.display = 'none';
    loadingEl.style.display = '';

    let seconds = 0;
    elapsedEl.textContent = '0s';
    elapsedTimer = setInterval(() => {
      seconds++;
      elapsedEl.textContent = seconds + 's';
    }, 1000);

    try {
      const raw = await API.generate(text);
      const data = Parser.parseGenerate(raw);
      studyData = data;

      // Save to localStorage
      localStorage.setItem('flashmind_data', JSON.stringify(data));
      localStorage.setItem('flashmind_text', originalText);

      showStudyView(data);
    } catch (err) {
      showToast('Generation failed: ' + err.message, 'error');
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

    switchTab('notes');
  }

  // ===== Top Bar =====
  function setupTopBar() {
    document.getElementById('back-to-input').addEventListener('click', backToInput);
    document.getElementById('new-material-btn').addEventListener('click', () => {
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

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

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

  // ===== Auto-save =====
  function checkSavedData() {
    const saved = localStorage.getItem('flashmind_data');
    const savedText = localStorage.getItem('flashmind_text');

    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.title && data.notes && data.flashcards && data.quiz) {
          originalText = savedText || '';
          showToast('Restored your previous study materials', 'info');
          showStudyView(data);
          return;
        }
      } catch (e) {
        localStorage.removeItem('flashmind_data');
      }
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ===== Getters =====
  function getStudyData() { return studyData; }
  function getOriginalText() { return originalText; }

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', init);

  return { switchTab, showToast, getStudyData, getOriginalText };
})();
