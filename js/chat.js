// ===== Chat Module =====
const Chat = (() => {
  let messagesEl;
  let inputEl;
  let sendBtn;
  let isLoading = false;
  let session = 0;
  let focusText = '';   // one topic's text added to the next request's context (Chat.askAbout)

  function init() {
    messagesEl = document.getElementById('chat-messages');
    inputEl = document.getElementById('chat-input');
    sendBtn = document.getElementById('chat-send-btn');

    inputEl.addEventListener('input', () => {
      sendBtn.disabled = !inputEl.value.trim() || isLoading;
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && inputEl.value.trim() && !isLoading) {
        e.preventDefault();
        sendMessage(inputEl.value.trim());
      }
    });

    sendBtn.addEventListener('click', () => {
      if (inputEl.value.trim() && !isLoading) sendMessage(inputEl.value.trim());
    });
  }

  function setup(title) {
    session++;
    isLoading = false;
    Chat._pendingFlashcards = null;
    Chat._pendingQuiz = null;
    sendBtn.disabled = !inputEl.value.trim();
    document.getElementById('chat-context-badge').textContent = title;
    messagesEl.innerHTML = '';
    showStarters();
  }

  function showStarters() {
    const T = i18n.t;
    const starters = [
      T('starter1'), T('starter2'), T('starter3'),
      T('starter4'), T('starter5'), T('starter6')
    ];

    let html = '<div class="chat-starters">';
    starters.forEach(s => {
      html += `<button class="chat-starter" onclick="Chat.sendMessage('${s.replace(/'/g, "\\'")}')">${s}</button>`;
    });
    html += `<button class="chat-starter chat-starter-feynman" onclick="Chat.startFeynman()">&#127891; ${T('feynmanBtn')}</button>`;
    html += '</div>';
    messagesEl.innerHTML = html;
  }

  // ===== Feynman mode =====
  // The student explains the topic in their own words; the AI grades the
  // explanation against the study material and lists gaps.
  let feynmanArmed = false;

  function startFeynman() {
    feynmanArmed = true;
    addAIMessage({ answer: i18n.t('feynmanIntro'), tip: null, followUps: [] });
    inputEl.placeholder = i18n.t('feynmanHolder');
    inputEl.focus();
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
    const T = i18n.t;
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    let html = `<div class="chat-bubble">${esc(data.answer)}</div>`;
    if (data.tip) {
      html += `<div class="chat-tip"><div class="chat-tip-label">${T('studyTip')}</div>${esc(data.tip)}</div>`;
    }
    if (data.followUps && data.followUps.length > 0) {
      html += `<div class="chat-followups">`;
      data.followUps.filter(f => typeof f === 'string').forEach(f => {
        html += `<button class="chat-followup">${esc(f)}</button>`;
      });
      html += `</div>`;
    }
    // Citations are checked against the actual material before display.
    if (data.citations && data.citations.length && typeof Sources !== 'undefined') {
      html += Sources.citationsHtml(data.citations, App.getStudyData());
    }
    msg.innerHTML = html;
    msg.querySelectorAll('.chat-followup').forEach(btn => btn.addEventListener('click', () => sendMessage(btn.textContent)));
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addFlashcardsMessage(data) {
    const T = i18n.t;
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.innerHTML = `
      <div class="chat-bubble">${T('newFlashcards', { n: data.flashcards.length })}</div>
      <button class="chat-action-btn">${T('addToDeck')}</button>`;
    msg._flashcards = data.flashcards;
    msg.querySelector('button').addEventListener('click', function () {
      Flashcards.addCards(msg._flashcards);
      this.disabled = true;
    }, { once: true });
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addQuizMessage(data) {
    const T = i18n.t;
    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.innerHTML = `
      <div class="chat-bubble">${T('newQuizQs', { n: data.quiz.length })}</div>
      <button class="chat-action-btn">${T('addToQuiz')}</button>`;
    msg._quiz = data.quiz;
    msg.querySelector('button').addEventListener('click', function () {
      Quiz.addQuestions(msg._quiz);
      this.disabled = true;
    }, { once: true });
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function showLoading() {
    const loader = document.createElement('div');
    loader.className = 'chat-message ai';
    loader.id = 'chat-loader';
    loader.innerHTML = `<div class="chat-loading">
      <div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div>
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
    const requestSession = session;
    const source = App.getStudyData();
    isLoading = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    addUserMessage(text);
    showLoading();

    // Feynman: the visible message is the student's explanation; the request
    // wraps it in a grading instruction.
    let toSend = text;
    if (feynmanArmed) {
      feynmanArmed = false;
      inputEl.placeholder = i18n.t('chatHolder');
      toSend = 'FEYNMAN TECHNIQUE CHECK. The student is explaining the topic in their own words below. ' +
        'Compare it against the study material and answer with: 1) what they got right, 2) what is wrong, ' +
        '3) which important points are missing, then an understanding score out of 100 and one concrete study tip. ' +
        'Answer in the same language as the explanation.\n\nStudent explanation:\n"""' + text + '"""';
    }

    // Grounding: ask for verbatim supporting quotes, which addAIMessage then
    // looks up in the sources so made-up claims are visibly flagged.
    toSend += '\n\n[Grounding: in your JSON reply also include "citations": an array of 1-3 short quotes ' +
      '(each under 30 words) copied word-for-word from the study material that support your answer. ' +
      'Use [] if the material does not cover it, and say so in the answer.]';
    // The notes are written like a teacher talking; the answers should be too.
    toSend += '\n\n[Style: answer like a teacher explaining to a student, in flowing friendly sentences: build the idea, give one concrete example and name the typical trap. ' +
      'No headings, no bullet lists and no numbered instructions unless the student asks for them. Keep it short.]';

    try {
      let context = App.getOriginalText() || JSON.stringify(source);
      if (focusText) { context += '\n\nTOPIC THE STUDENT IS ASKING ABOUT:\n' + focusText; focusText = ''; }
      const raw = await API.chat(toSend, context);
      if (requestSession !== session || source !== App.getStudyData()) return;
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
      if (requestSession !== session || source !== App.getStudyData()) return;
      removeLoading();
      addAIMessage({ answer: `${i18n.t('chatError')} ${err.message}`, tip: null, followUps: [] });
    }

    isLoading = false;
    sendBtn.disabled = !inputEl.value.trim();
  }

  // Opens the chat on a notes topic and sends the opening question once.
  function askAbout(text, sectionText) {
    if (isLoading) throw new Error(i18n.t('topicChatBusy'));
    App.switchTab('chat');
    focusText = sectionText;
    sendMessage(text);
  }

  function addFlashcards() {
    if (Chat._pendingFlashcards) {
      Flashcards.addCards(Chat._pendingFlashcards);
      Chat._pendingFlashcards = null;
      App.showToast(i18n.t('flashcardsAdded'), 'success');
    }
  }

  function addQuizQuestions() {
    if (Chat._pendingQuiz) {
      Quiz.addQuestions(Chat._pendingQuiz);
      Chat._pendingQuiz = null;
      App.showToast(i18n.t('questionsAdded'), 'success');
    }
  }

  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  return { init, setup, sendMessage, askAbout, addFlashcards, addQuizQuestions, startFeynman };
})();
