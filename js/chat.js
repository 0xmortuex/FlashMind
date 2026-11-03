// ===== Chat Module =====
const Chat = (() => {
  let messagesEl;
  let inputEl;
  let sendBtn;
  let isLoading = false;
  let session = 0;
  let focusText = '';   // one topic's text added to the next request's context (Chat.askAbout)
  let conv = null;      // the open conversation: { id, at, title, msgs: [{ role: 'user', text } | { role: 'ai', kind, data }] }

  // ===== Saved conversations (per deck, on this device) =====
  const HISTORY_KEY = 'flashmind_chat_history_v1';
  const MAX_CONVS = 30, MAX_MSGS = 60;

  function deckKey() {
    const id = App.getActiveDeckId ? App.getActiveDeckId() : null;
    const d = App.getStudyData();
    return id ? 'd:' + id : 't:' + ((d && d.title) || '');
  }
  function loadAll() {
    try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function saveAll(all) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked: the chat still works */ }
  }
  function deckConvs() {
    const list = loadAll()[deckKey()];
    return Array.isArray(list) ? list.filter(c => c && Array.isArray(c.msgs)) : [];
  }
  function newConv() {
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), title: '', msgs: [] };
  }
  // Store the open conversation (once it has a message) at the top of this deck's list.
  function persistConv() {
    if (!conv || !conv.msgs.length) return;
    conv.at = Date.now();
    conv.msgs = conv.msgs.slice(-MAX_MSGS);
    const all = loadAll(), key = deckKey();
    const list = (Array.isArray(all[key]) ? all[key] : []).filter(c => c && c.id !== conv.id);
    all[key] = [conv, ...list].slice(0, MAX_CONVS);
    saveAll(all);
    if (historyOpen()) drawHistory();
  }
  function record(msg) {
    if (!conv) conv = newConv();
    if (msg.role === 'user' && !conv.title) conv.title = msg.text.slice(0, 80);
    conv.msgs.push(msg);
    persistConv();
  }

  // The last messages, sent with each request so follow-ups ("why?", "that one") make sense.
  function transcript() {
    const msgs = (conv ? conv.msgs : []).slice(-12);
    return msgs.map(m => {
      const t = m.role === 'user' ? m.text : m.kind === 'chat' ? m.data.answer : `(${m.kind === 'quiz' ? 'quiz questions' : 'flashcards'} were created)`;
      return (m.role === 'user' ? 'Student: ' : 'Tutor: ') + String(t || '').replace(/\s+/g, ' ').slice(0, 700);
    }).join('\n');
  }

  // ----- History panel -----
  const historyEl = () => document.getElementById('chat-history');
  const historyOpen = () => { const el = historyEl(); return !!el && !el.hidden; };
  function toggleHistory(force) {
    const el = historyEl();
    if (!el) return;
    el.hidden = force === undefined ? !el.hidden : !force;
    const btn = document.getElementById('chat-history-btn');
    if (btn) btn.setAttribute('aria-expanded', String(!el.hidden));
    if (!el.hidden) drawHistory();
  }
  function drawHistory() {
    const el = historyEl();
    if (!el) return;
    const T = i18n.t;
    const list = deckConvs();
    const fmt = t => { try { return new Date(t).toLocaleString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    el.innerHTML = `<div class="chat-history-head"><strong>${T('chatHistTitle')}</strong><button class="btn-ghost" data-chat-hist-close>${T('vlClose')}</button></div>` +
      (list.length ? `<ul class="chat-history-list">${list.map(c => `<li class="${conv && conv.id === c.id ? 'current' : ''}">
        <button class="chat-history-open" data-chat-hist-open="${esc(c.id)}"><span class="chat-history-title">${esc(c.title || T('chatHistUntitled'))}</span>
        <span class="chat-history-meta">${esc(fmt(c.at))} · ${T('chatHistCount', { n: c.msgs.filter(m => m.role === 'user').length })}</span></button>
        <button class="btn-icon chat-history-del" data-chat-hist-del="${esc(c.id)}" aria-label="${esc(T('chatHistDelete'))}" title="${esc(T('chatHistDelete'))}">&#128465;</button></li>`).join('')}</ul>`
        : `<p class="chat-history-empty">${T('chatHistEmpty')}</p>`);
  }
  function openConv(id) {
    const c = deckConvs().find(x => x.id === id);
    if (!c) return;
    session++;
    isLoading = false;
    feynmanArmed = false;
    sendBtn.disabled = !inputEl.value.trim();
    conv = c;
    messagesEl.innerHTML = '';
    c.msgs.forEach(m => {
      if (m.role === 'user') addUserMessage(m.text);
      else if (m.kind === 'flashcards') addFlashcardsMessage(m.data);
      else if (m.kind === 'quiz') addQuizMessage(m.data);
      else addAIMessage(m.data);
    });
    toggleHistory(false);
    inputEl.focus();
  }
  function deleteConv(id) {
    const all = loadAll(), key = deckKey();
    all[key] = (Array.isArray(all[key]) ? all[key] : []).filter(c => c && c.id !== id);
    if (!all[key].length) delete all[key];
    saveAll(all);
    if (conv && conv.id === id) newChat();
    drawHistory();
  }
  function newChat() {
    session++;
    isLoading = false;
    feynmanArmed = false;
    conv = null;
    sendBtn.disabled = !inputEl.value.trim();
    messagesEl.innerHTML = '';
    showStarters();
  }

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

    const newBtn = document.getElementById('chat-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => { newChat(); toggleHistory(false); inputEl.focus(); });
    const histBtn = document.getElementById('chat-history-btn');
    if (histBtn) histBtn.addEventListener('click', () => toggleHistory());
    const hist = historyEl();
    if (hist) hist.addEventListener('click', e => {
      const open = e.target.closest('[data-chat-hist-open]');
      if (open) { openConv(open.dataset.chatHistOpen); return; }
      const del = e.target.closest('[data-chat-hist-del]');
      if (del) { if (confirm(i18n.t('chatHistDeleteConfirm'))) deleteConv(del.dataset.chatHistDel); return; }
      if (e.target.closest('[data-chat-hist-close]')) toggleHistory(false);
    });
    labels();
  }

  function labels() {
    const T = i18n.t;
    const set = (id, key) => { const b = document.getElementById(id); const l = b && b.querySelector('.btn-label'); if (l) l.textContent = T(key); };
    set('chat-new-btn', 'chatNew');
    set('chat-history-btn', 'chatHistBtn');
    if (historyOpen()) drawHistory();
  }

  function setup(title) {
    session++;
    isLoading = false;
    Chat._pendingFlashcards = null;
    Chat._pendingQuiz = null;
    conv = null;
    feynmanArmed = false;
    sendBtn.disabled = !inputEl.value.trim();
    document.getElementById('chat-context-badge').textContent = title;
    messagesEl.innerHTML = '';
    toggleHistory(false);
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
    const earlier = transcript();
    record({ role: 'user', text });
    const myConv = conv;

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
      'Use [] if the material does not cover it; then still answer from your knowledge of the subject and mention in one short clause that it goes beyond the material. Answer the question first.]';
    // The notes are written like a teacher talking; the answers should be too.
    toSend += '\n\n[Style: answer like a teacher explaining to a student, in flowing friendly sentences: build the idea, give one concrete example and name the typical trap. ' +
      'No headings, no bullet lists and no numbered instructions unless the student asks for them. Keep it short.]';
    if (earlier) {
      toSend += '\n\n[Conversation so far (oldest first):\n' + earlier + '\n' +
        'The student\'s message at the top is the newest message in this conversation. Read it as a follow-up: work out what "it", "that", "this number" or "why" refer to from the conversation, ' +
        'build on what you already explained instead of starting over, and do not repeat it unless asked.]';
    }

    try {
      let context = App.getOriginalText() || JSON.stringify(source);
      if (focusText) { context += '\n\nTOPIC THE STUDENT IS ASKING ABOUT:\n' + focusText; focusText = ''; }
      const raw = await API.chat(toSend, context);
      if (requestSession !== session || source !== App.getStudyData()) return;
      removeLoading();
      const data = Parser.parseChat(raw);
      const keep = msg => { if (conv === myConv) record(msg); };
      if (data.type === 'flashcards') {
        addFlashcardsMessage(data);
        Chat._pendingFlashcards = data.flashcards;
        keep({ role: 'ai', kind: 'flashcards', data: { flashcards: data.flashcards } });
      } else if (data.type === 'quiz') {
        addQuizMessage(data);
        Chat._pendingQuiz = data.quiz;
        keep({ role: 'ai', kind: 'quiz', data: { quiz: data.quiz } });
      } else {
        addAIMessage(data);
        keep({ role: 'ai', kind: 'chat', data: { answer: data.answer, tip: data.tip || null, followUps: (data.followUps || []).filter(f => typeof f === 'string').slice(0, 4), citations: data.citations || [] } });
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

  return { init, setup, sendMessage, askAbout, addFlashcards, addQuizQuestions, startFeynman, newChat, labels };
})();
