# FlashMind — AI-Powered Study Tool

**Turn any notes, PDF, or topic into structured study notes, flashcards, and a Turkish-style exam — with an AI tutor.** Free, no signup, runs in the browser.

🔗 **Live:** [0xmortuex.github.io/FlashMind](https://0xmortuex.github.io/FlashMind/)

---

## What it does

Give FlashMind some material and it generates a complete study set in one call:

- **📝 Notes** — a clean summary with sections, key terms, important dates, common mistakes, and simple diagrams.
- **🃏 Flashcards** — 3D flip-card deck across easy/medium/hard with a study mode (Again / Hard / Got it) and **spaced repetition**.
- **📋 Exam (Turkish style)** — a mixed-format exam modeled on the Turkish system (see below).
- **📊 Stats** — study streak, a 14-day review chart, and your exam-score history.
- **💬 Ask AI** — a tutor that answers questions about your material and can generate more cards/questions.

Not sure? Hit **Try an example** on the home screen for an instant sample deck — no waiting, no API call.

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

- **📚 Deck library** — every set you make is saved. Return to the home screen to see your decks, reopen one, or delete it; due-card counts show at a glance.
- **🧠 Spaced repetition (SM-2)** — flashcard reviews schedule each card for its optimal next review date. A **Review due** button studies just what's ready today; progress persists across sessions.
- **📊 Stats dashboard** — day streak, cards reviewed, a 14-day review bar chart, and an exam-score line chart with history — all rendered in dependency-free inline SVG.
- **🌗 Light & dark theme** — toggle in the corner; remembers your choice and follows your OS by default.
- **📱 Mobile-first** — a bottom navigation bar on phones and **swipe gestures** in study mode (right = Got it, left = Again, up = Hard).
- **📴 Installable PWA** — add to your home screen and study saved decks offline (app shell + decks cached; generation still needs a connection).
- **➕ Add Materials** — generate or import more and **merge** it into your current set (flashcards, exam questions, and notes all append) without clearing what you have.
- **🔍 Search** — search keywords across your **notes and exam**; notes matches jump-and-highlight, exam matches show the question and its answer.
- **🔗 Share** — one click creates a link that loads your set on any device. Links **don't expire**.
- **📤 Export** — notes as Markdown/PDF, flashcards as Anki-compatible CSV, exam as text, or the whole set as JSON (re-importable).
- **🌍 Languages** — full English and Turkish UI; generated content matches the source language.
- **♿ Accessible** — ARIA roles on tabs and dialogs, keyboard support (Esc closes modals), and focus-visible outlines.
- **💾 Local-first** — decks, spaced-repetition schedules, and stats all live in your browser; no account required.

## How it's built

- **Frontend** — vanilla HTML/CSS/JS, no framework, no build step. Hosted on GitHub Pages.
- **Backend** — a Cloudflare Worker (`flashmind-worker`) that proxies generation/grading to [OpenRouter](https://openrouter.ai) (Claude) and stores shared sets in KV. The API key lives only as a Worker secret.
- **PDF.js** — client-side PDF text extraction.
- **Storage** — decks, SM-2 schedules, and stats persist in `localStorage`; the deck library migrates the old single-set key automatically.
- **Offline** — a service worker (`sw.js`) caches the app shell for offline use; `manifest.webmanifest` makes it installable.
- **Charts & spaced repetition** — hand-rolled: inline-SVG stat charts and a classic SM-2 scheduler, no libraries.

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
