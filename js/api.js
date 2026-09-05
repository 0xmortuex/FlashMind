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

  // Streaming variant of generate: reads the worker's SSE pass-through and
  // reports the accumulated text after every delta so the UI can show real
  // progress. Returns the full raw model output. Throws on any failure —
  // callers fall back to the non-streaming generate().
  async function generateStream(text, flashcardConfig, quizConfig, onProgress) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', stream: true, text, lang: i18n.getLang(), flashcardConfig, quizConfig })
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // A worker that predates streaming ignores stream:true and answers with
    // plain JSON — use that result directly instead of burning a second call.
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      const data = await res.json();
      if (!data.result) throw new Error('Empty response');
      return data.result;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    function consume(line) {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (event.error) throw new Error(event.error.message || String(event.error));
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        full += delta;
        if (onProgress) onProgress(full);
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(consume);
      }
      buf += decoder.decode();
      if (buf) consume(buf);
    } finally { reader.releaseLock(); }
    if (!full) throw new Error('Empty stream');
    return full;
  }

  async function syncPush(code, data) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'syncPush', code: code || undefined, data })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Sync failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return (await res.json()).result;
  }

  async function syncPull(code) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'syncPull', code })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Sync failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return (await res.json()).result;
  }

  async function syncDelete(code) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'syncDelete', code })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Sync failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return (await res.json()).result;
  }

  async function fetchUrl(url) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetchUrl', url })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Fetch failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return (await res.json()).result;
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

  return { generate, generateStream, chat, grade, share, load, syncPush, syncPull, syncDelete, fetchUrl };
})();
