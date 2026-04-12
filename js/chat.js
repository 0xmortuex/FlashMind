// ===== Chat Module =====
const Chat = (() => {
  let messagesEl;
  let inputEl;
  let sendBtn;
  let startersEl;
  let isLoading = false;

  function init() {
    messagesEl = document.getElementById('chat-messages');
    inputEl = document.getElementById('chat-input');
    sendBtn = document.getElementById('chat-send-btn');
    startersEl = document.getElementById('chat-starters');

    inputEl.addEventListener('input', () => {
      sendBtn.disabled = !inputEl.value.trim() || isLoading;
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && inputEl.value.trim() && !isLoading) {
        sendMessage(inputEl.value.trim());
      }
    });

    sendBtn.addEventListener('click', () => {
      if (inputEl.value.trim() && !isLoading) {
        sendMessage(inputEl.value.trim());
      }
    });
  }

  function setup(title) {
    document.getElementById('chat-context-badge').textContent = title;
    messagesEl.innerHTML = '';
    showStarters(title);
  }

  function showStarters(title) {
    const starters = [
      `Explain the key concepts in simpler terms`,
      `What are the most important things to remember?`,
      `Give me a mnemonic to remember this`,
      `What questions might appear on an exam?`,
      `Generate 5 more flashcards on the hardest topics`,
      `Create a harder quiz`
    ];

    let html = '<div class="chat-starters">';
    starters.forEach(s => {
      html += `<button class="chat-starter" onclick="Chat.sendMessage('${s.replace(/'/g, "\\'")}')">${s}</button>`;
    });
    html += '</div>';
    messagesEl.innerHTML = html;
  }

  function addUserMessage(text) {
    const startersDiv = messagesEl.querySelector('.chat-starters');
    if (startersDiv) startersDiv.remove();

    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.innerHTML = `<div class="chat-bubble">${esc(text)}</div>`;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addAIMessage(data) {
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';

    let html = `<div class="chat-bubble">${esc(data.answer)}</div>`;

    if (data.tip) {
      html += `<div class="chat-tip"><div class="chat-tip-label">Study Tip</div>${esc(data.tip)}</div>`;
    }

    if (data.followUps && data.followUps.length > 0) {
      html += `<div class="chat-followups">`;
      data.followUps.forEach(f => {
        html += `<button class="chat-followup" onclick="Chat.sendMessage('${f.replace(/'/g, "\\'")}')">${esc(f)}</button>`;
      });
      html += `</div>`;
    }

    msg.innerHTML = html;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addFlashcardsMessage(data) {
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.innerHTML = `
      <div class="chat-bubble">Here are ${data.flashcards.length} new flashcards!</div>
      <button class="chat-action-btn" onclick="Chat.addFlashcards()">Add to Deck</button>`;
    msg._flashcards = data.flashcards;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addQuizMessage(data) {
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.innerHTML = `
      <div class="chat-bubble">Generated ${data.quiz.length} new quiz questions!</div>
      <button class="chat-action-btn" onclick="Chat.addQuizQuestions()">Add to Quiz</button>`;
    msg._quiz = data.quiz;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function showLoading() {
    const loader = document.createElement('div');
    loader.className = 'chat-message ai';
    loader.id = 'chat-loader';
    loader.innerHTML = `<div class="chat-loading">
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
    </div>`;
    messagesEl.appendChild(loader);
    scrollToBottom();
  }

  function removeLoading() {
    const loader = document.getElementById('chat-loader');
    if (loader) loader.remove();
  }

  async function sendMessage(text) {
    if (isLoading) return;
    isLoading = true;
    sendBtn.disabled = true;
    inputEl.value = '';

    addUserMessage(text);
    showLoading();

    try {
      const context = App.getOriginalText();
      const raw = await API.chat(text, context);
      removeLoading();

      const data = Parser.parseChat(raw);

      if (data.type === 'flashcards') {
        addFlashcardsMessage(data);
        Chat._pendingFlashcards = data.flashcards;
      } else if (data.type === 'quiz') {
        addQuizMessage(data);
        Chat._pendingQuiz = data.quiz;
      } else {
        addAIMessage(data);
      }
    } catch (err) {
      removeLoading();
      addAIMessage({ answer: `Sorry, I couldn't process that. ${err.message}`, tip: null, followUps: [] });
    }

    isLoading = false;
    sendBtn.disabled = !inputEl.value.trim();
  }

  function addFlashcards() {
    if (Chat._pendingFlashcards) {
      Flashcards.addCards(Chat._pendingFlashcards);
      Chat._pendingFlashcards = null;
      App.showToast('Flashcards added to deck!', 'success');
    }
  }

  function addQuizQuestions() {
    if (Chat._pendingQuiz) {
      Quiz.addQuestions(Chat._pendingQuiz);
      Chat._pendingQuiz = null;
      App.showToast('Questions added to quiz!', 'success');
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, setup, sendMessage, addFlashcards, addQuizQuestions };
})();
