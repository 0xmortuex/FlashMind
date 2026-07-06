# FlashMind — AI-Powered Study Tool

[![Smoke test](https://github.com/0xmortuex/FlashMind/actions/workflows/smoke.yml/badge.svg)](https://github.com/0xmortuex/FlashMind/actions/workflows/smoke.yml)

**Turn any notes, PDF, web page, or topic into structured study notes, flashcards, and a Turkish-style exam — with an AI tutor, FSRS spaced repetition, and device sync.** Free, no signup, runs in the browser.

🔗 **Live:** [0xmortuex.github.io/FlashMind](https://0xmortuex.github.io/FlashMind/)

---

## What it does

Give FlashMind some material and it generates a complete study set in one streamed call — you watch the stage checklist tick off and the flashcard counter climb while it writes:

- **📝 Notes** — a clean summary with sections, key terms, important dates, common mistakes, and simple diagrams. Read-aloud (TTS) included.
- **🃏 Flashcards** — 3D flip-card deck with a drag-to-rate study mode (swipe right = Got it, left = Again, up = Hard) scheduled by **FSRS**, plus one-click **cloze cards** built from your notes' key terms.
- **📋 Exam (Turkish style)** — mixed-format exam with two modes: **Practice** (per-question feedback, optional timer) and **Simulation (deneme sınavı)** — one overall countdown, optik-form question navigator, results only at the end.
- **📕 Mistake notebook (yanlış defteri)** — every wrong answer is filed automatically; retake just your mistakes, and correct answers clear them.
- **📊 Stats** — day streak, review charts, a 6-month activity heatmap, a 7-day due forecast, and exam-score history.
- **💬 Ask AI** — a tutor with your material as context; one click on any wrong exam answer asks it "explain this".

Not sure? Hit **Try an example** on the home screen for an instant sample deck — no waiting, no API call.

## Inputs

- **Paste** text (notes, a transcript, a textbook chapter).
- **Upload a PDF** — text extracted client-side with PDF.js.
- **Upload JSON** — re-import a FlashMind export, or load any JSON as raw text.
- **Upload CSV/TSV** — flashcards from our export, Anki exports, or any front/back sheet.
- **A URL** — the backend fetches the page and extracts its readable text.
- **Just a topic** — type "Photosynthesis" and it teaches the subject.

## Turkish-style exam (Türk sınav sistemi)

| Type | Turkish | Notes |
|---|---|---|
| Multiple choice | Çoktan seçmeli | **5 options (A–E)** — YKS/lise format |
| True / False | Doğru-Yanlış | single statement |
| Fill in the blank | Boşluk doldurma | typed answer, accepts synonyms |
| Matching | Eşleştirme | match term ↔ definition |
| Open-ended | Açık uçlu / klasik | written answer, **AI-graded** (practice mode) |

**Scoring follows Turkish conventions:** Doğru / Yanlış / Boş counts and a **Net** for the multiple-choice section (`net = doğru − yanlış ⁄ 4`), a 0–100 puan shown on an animated gauge, and a letter grade. Answer with the keyboard (**A–E**, Enter for next), filter types, shuffle, set timers, review every answer, and export a **printable exam sheet with an answer key**.

## Study features

- **🧠 FSRS spaced repetition** — the modern scheduler (FSRS-4.5) plans each card's optimal review date; lapses feed **weak-spot targeting**, which generates new cards for the categories you struggle with.
- **📚 Deck library** — every set is saved locally; rename, duplicate, search, export, delete; mastery rings and due counts at a glance.
- **🔁 Device sync** — account-less: enable sync, enter the private code on another device, and decks/stats merge (deletions propagate too). Disabling wipes the cloud copy.
- **💾 Backup** — one file backs up the whole library including schedules, stats, and mistake banks; drop it on any FlashMind to restore.
- **🔍 Search, 🔗 permanent share links, 📤 exports** (Markdown, PDF, Anki-compatible CSV, printable exam, JSON).

## Interface

- **⌘ Command palette** — Ctrl+K for tabs, actions, and decks; **?** shows all keyboard shortcuts.
- **🌗 Light & dark theme** with an animated circular reveal; motion everywhere is GPU-cheap and respects `prefers-reduced-motion`.
- **🔊 Opt-in sounds & haptics** — WebAudio-synthesized, off by default.
- **📱 Mobile-first PWA** — bottom navigation, swipe gestures, installable, offline for saved decks.
- **♿ Accessible** — focus-trapped dialogs, ARIA roles, keyboard support throughout.
- **🌍 Full English and Turkish UI**; generated content matches the source language.

## How it's built

- **Frontend** — vanilla HTML/CSS/JS, no framework, no build step. Hosted on GitHub Pages.
- **Backend** — a Cloudflare Worker ([`flashmind-worker`](https://github.com/0xmortuex/flashmind-worker)) that proxies generation/grading to [OpenRouter](https://openrouter.ai) (Claude) with SSE streaming, stores shares and sync blobs in KV, extracts text from URLs, and rate-limits per IP. The API key lives only as a Worker secret.
- **Storage** — decks, FSRS schedules, mistake banks, and stats persist in `localStorage`; sync/share blobs in Worker KV under random bearer codes.
- **Charts & scheduling** — hand-rolled: inline-SVG charts, canvas confetti, and an FSRS-4.5 implementation — no libraries.
- **CI** — a 23-step puppeteer smoke test runs on every push (badge above).

## Run locally

It's static — open `index.html`, or:

```bash
npx serve .
```

Generation/sharing/sync call the hosted Worker. To run your own backend, deploy `flashmind-worker` (see its README) and point `WORKER_URL` in `js/api.js` at it. Run the test suite with `npm i --no-save puppeteer serve && npx serve -l 4173 . & node tests/smoke.js`.

## Privacy

Material is processed on demand and not stored server-side. Your library lives in your browser. Shared sets and sync data are stored (by you, on demand) under random codes until you delete them — disabling sync deletes your cloud copy.

## License

MIT
