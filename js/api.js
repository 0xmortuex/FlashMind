// ===== API Module =====
const API = (() => {
  const WORKER_URL = 'https://flashmind-proxy.mortuexhavoc.workers.dev';

  async function generate(text, flashcardConfig, quizConfig) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', text, lang: i18n.getLang(), flashcardConfig, quizConfig })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.result;
  }

  async function chat(question, context) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'chat', question, context, lang: i18n.getLang() })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.result;
  }

  async function grade(studentAnswer, correctAnswer, keyPoints) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'grade', studentAnswer, correctAnswer, keyPoints, lang: i18n.getLang() })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.result;
  }

  async function share(data) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'share', data })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to share' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const json = await res.json();
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  }

  async function load(code) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load', code })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Share link expired or not found' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const json = await res.json();
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  }

  return { generate, chat, grade, share, load };
})();
