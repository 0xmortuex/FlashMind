# FlashMind — AI-Powered Study Tool

**Turn any notes, PDF, or topic into structured study notes, flashcards, and a Turkish-style exam — with an AI tutor.** Free, no signup, runs in the browser.

🔗 **Live:** [0xmortuex.github.io/FlashMind](https://0xmortuex.github.io/FlashMind/)

---

## What it does

Give FlashMind some material and it generates a complete study set in one call:

- **📝 Notes** — a clean summary with sections, key terms, important dates, common mistakes, and simple diagrams.
- **🃏 Flashcards** — 3D flip-card deck across easy/medium/hard with a study mode (Again / Hard / Got it).
- **📋 Exam (Turkish style)** — a mixed-format exam modeled on the Turkish system (see below).
- **💬 Ask AI** — a tutor that answers questions about your material and can generate more cards/questions.

## Inputs

Feed it material four ways:

- **Paste** text (notes, a transcript, a textbook chapter).
- **Upload a PDF** — text extracted client-side with PDF.js.
- **Upload JSON** — import a FlashMind set (an "Everything as JSON" export) directly, or load any JSON as raw text.
- **Just a topic** — type "Photosynthesis" and it teaches the subject.

## Turkish-style exam (Türk sınav sistemi)

The exam matches how Turkish exams actually work, mixing question types:

| Type | Turkish | Notes |
|---|---|---|
| Multiple choice | Çoktan seçmeli | **5 options (A–E)** — YKS/lise format |
| True / False | Doğru-Yanlış | single statement |
| Fill in the blank | Boşluk doldurma | typed answer, accepts synonyms |
| Matching | Eşleştirme | match term ↔ definition |
| Open-ended | Açık uçlu / klasik | written answer, **AI-graded** |

**Scoring follows Turkish conventions:** results show **Doğru / Yanlış / Boş** counts and a **Net** for the multiple-choice section (`net = doğru − yanlış ⁄ 4` — the YKS rule where 4 wrong cancel 1 correct), plus a 0–100 puan and a letter grade. Filter to objective-only or written-only, shuffle, set a per-question timer, and review every answer.

## Other features

- **➕ Add Materials** — generate or import more and **merge** it into your current set (flashcards, exam questions, and notes all append) without clearing what you have.
- **🔍 Search** — search keywords across your **notes and exam**; notes matches jump-and-highlight, exam matches show the question and its answer.
- **🔗 Share** — one click creates a link that loads your set on any device. Links **don't expire**.
- **📤 Export** — notes as Markdown/PDF, flashcards as Anki-compatible CSV, exam as text, or the whole set as JSON (re-importable).
- **🌍 Languages** — full English and Turkish UI; generated content matches the source language.
- **💾 Local-first** — your current set is saved in the browser; no account required.

## How it's built

- **Frontend** — vanilla HTML/CSS/JS, no framework, no build step. Hosted on GitHub Pages.
- **Backend** — a Cloudflare Worker (`flashmind-worker`) that proxies generation/grading to [OpenRouter](https://openrouter.ai) (Claude) and stores shared sets in KV. The API key lives only as a Worker secret.
- **PDF.js** — client-side PDF text extraction.

## Run locally

It's static — open `index.html`, or:

```bash
npx serve .
```

Generation/sharing call the hosted Worker. To run your own backend, deploy `flashmind-worker` (see its README) and point `WORKER_URL` in `js/api.js` at it.

## Privacy

Material is processed on demand and not stored server-side; your active set lives in your browser's localStorage. Shared sets are stored (by you, on demand) under a random code until you delete them.

## License

MIT
