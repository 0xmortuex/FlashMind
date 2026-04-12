# FlashMind — AI-Powered Study Tool

Paste notes, upload PDFs, or type any topic — instantly get structured study notes, interactive flashcards, multiple-choice quizzes, and an AI tutor. Free, no signup required.

![FlashMind Screenshot](https://via.placeholder.com/800x400/0f1117/7c3aed?text=FlashMind)

## Features

- **Structured Notes** — AI generates organized summaries with key terms, bullet points, and common mistakes
- **Interactive Flashcards** — Full 3D flip cards with a spaced-repetition study mode (Again / Hard / Got it)
- **Multiple-Choice Quiz** — Timed or untimed, with scoring, grading (A-F), answer review, and confetti for 90%+
- **AI Chat Tutor** — Ask questions about your material, request mnemonics, get exam tips, or generate more cards/questions
- **PDF Upload** — Drop a PDF and extract text automatically
- **Export** — Notes as Markdown/PDF, flashcards as Anki-compatible CSV, quiz as text, or full JSON

## How It Works

1. **Paste** your notes, upload a PDF, or type a topic
2. **AI generates** structured notes, flashcards, and quiz questions in one call
3. **Study** with flashcards, quiz yourself, and ask the AI tutor anything

## Tech Stack

- Vanilla HTML, CSS, JavaScript (no frameworks)
- Cloudflare Worker proxy to OpenRouter (Claude Sonnet)
- PDF.js for client-side PDF text extraction
- Zero dependencies, zero build step

## Privacy

Your study materials are processed in real-time and never stored on any server. Everything stays in your browser's localStorage.

## Live Demo

[https://0xmortuex.github.io/FlashMind/](https://0xmortuex.github.io/FlashMind/)

## License

MIT
