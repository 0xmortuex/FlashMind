# FlashMind — AI-Powered Study Tool

[![Smoke test](https://github.com/0xmortuex/FlashMind/actions/workflows/smoke.yml/badge.svg)](https://github.com/0xmortuex/FlashMind/actions/workflows/smoke.yml)

**Turn any notes, PDF, web page, or topic into structured study notes, flashcards, and a Turkish-style exam — with an AI tutor, FSRS spaced repetition, and device sync.** Free, no signup, runs in the browser.

🔗 **Live:** [0xmortuex.github.io/FlashMind](https://0xmortuex.github.io/FlashMind/)

---

## What it does

Give FlashMind some material and it generates a complete study set in one streamed call — you watch the stage checklist tick off and the flashcard counter climb while it writes:

- **📝 Notes** — a clean summary with sections, key terms, important dates, common mistakes, and simple diagrams. Read-aloud (TTS) included.
- **🃏 Flashcards** — 3D flip-card deck with a drag-to-rate study mode (swipe right = Got it, left = Again, up = Hard) scheduled by **FSRS**, plus one-click **cloze cards** built from your notes' key terms. Add, edit, and delete cards by hand (with an optional image), study in **typed-recall mode** (type the answer, get a verdict before rating), or hit **⚡ Cram** the night before — hardest cards first, schedules untouched.
- **📋 Exam (Turkish style)** — mixed-format exam with two modes: **Practice** (per-question feedback, optional timer) and **Simulation (deneme sınavı)** — one overall countdown, optik-form question navigator, results only at the end. Results include a **per-topic accuracy breakdown**, and the **question bank only grows**: generate more questions any time (deduped automatically).
- **📕 Mistake notebook (yanlış defteri)** — every wrong answer is filed automatically; retake just your mistakes, ask the AI for a **harder retake** built from them, and correct answers clear them.
- **📊 Stats** — day streak with **streak freezes** (earned every 7 study days, auto-bridge a missed day), review charts, a 6-month activity heatmap, a 7-day due forecast, exam-score history, and an **AI weekly report**.
- **💬 Ask AI** — a tutor with your material as context; one click on any wrong exam answer asks it "explain this". **Feynman mode** flips the roles: you explain the topic, the AI grades your explanation and lists what's missing. Struggling cards (2+ lapses) get a one-click **AI mnemonic**.
- **☀️ Today queue** — one session that pulls every due card from **all** your decks, with a home-screen banner, PWA app-icon badge, and an opt-in daily reminder notification.

Not sure? Hit **Try an example** on the home screen for an instant sample deck — no waiting, no API call.

## Inputs

- **Paste** text (notes, a transcript, a textbook chapter).
- **Upload a PDF** — text extracted client-side with PDF.js.
- **A photo** — point your camera at a textbook page or your notes; text is extracted client-side with Tesseract.js OCR (English + Turkish).
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
- **🎚️ Difficulty dial** — generate the same material as *Simple*, *Standard*, or *Advanced* (exam-prep depth).
- **📚 Deck library** — every set is saved locally; rename, duplicate, search, export, delete, group into **folders**, or **merge decks** (review progress carries over); mastery rings and due counts at a glance.
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
- **Charts & scheduling** — hand-rolled: inline-SVG charts, canvas confetti, and an FSRS-4.5 implementation — no libraries. The only CDN dependencies are PDF.js and (lazy-loaded, only when you drop a photo) Tesseract.js for OCR.
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
