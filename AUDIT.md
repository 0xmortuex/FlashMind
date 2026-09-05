# FlashMind code audit — 2026-09-06

This audit covered the frontend's data flow, persistence, imports, generation, chat, exams, flashcards, statistics, exports, search, profile, audio, dialogs, service worker and test setup. It included source review and local Chromium tests. It is not an exhaustive security certification or a verification of generated educational content. The separate Cloudflare backend is not present in this checkout and was not audited or changed. Nothing was deployed.

## Implemented fixes

### Data loss, storage and sync

1. Removed quota-error handling that silently deleted the oldest inactive deck. Failed writes now retain the in-memory library and show an export warning.
2. Whole-library backups read in-memory deck/stat snapshots, including changes that could not be written to browser storage.
3. Legacy migration retains its source when saving the migrated deck fails.
4. Recovered from null/array deck and statistics maps instead of crashing startup.
5. Rejected unsafe remote deck IDs and invalid deletion timestamps; restored missing schedule maps.
6. Mistake-notebook additions and removals advance the timestamp used to merge decks.
7. Serialized sync operations, retained edits made during an upload, and pulled remote changes before automatic uploads.
8. Joining a sync code now uploads the merged library instead of leaving this device's decks only on this device.
9. Disabling sync waits for outstanding uploads before deleting the cloud copy. Failed deletion is reported and does not falsely claim success.
10. Remote replacements/deletions refresh the active deck so later edits do not silently overwrite it using stale UI data.
11. Invalid persisted sync/profile settings and unavailable preference storage no longer break initial rendering.

### Imports, parsing and rendering

12. Added shared study-data normalization for imports, shares, generated data, chat additions, restored decks and sync. It validates nested collections, defaults card metadata and rejects unusable questions.
13. Preserved valid card IDs and assigned unique IDs to duplicates or missing IDs. Invalid answer indexes no longer silently turn the first option into the correct answer.
14. JSON repair closes nested containers in stack order and handles dangling string escapes and incomplete trailing keys.
15. CSV import preserves hash-prefixed lines inside quoted multiline fields.
16. AI follow-up buttons bind event listeners to text instead of interpolating model output into executable HTML attributes.
17. Escaped attribute values in search, library search, profile recent topics and sync-code rendering.
18. Escaped note-print document titles and handled popup blocking without dereferencing a null window.
19. Diagram position lookup uses a dictionary without inherited properties; normalized node types cannot select inherited properties from the color table.
20. Stream parsing handles `data:` without a space, a final unterminated line, decoder flushing and explicit provider errors. Reader locks are released.
21. PDF loading disables eval support and releases document/page resources after extraction.

### Study sessions and asynchronous work

22. Chat replies and AI grades from old sessions cannot populate or mutate a replacement deck/exam.
23. Every generated-card/question message adds its own batch once, instead of every button using the most recent batch.
24. Chat and additional-card generation use study data as context when imported/demo decks have no original source text.
25. Additional-card generation cannot append its response to a different deck after navigation.
26. Appending materials preserves original card IDs and their review schedules.
27. Adding cards/questions supports existing string IDs without generating `NaN` IDs.
28. Empty flashcard decks do not enter a broken study overlay. Pending rating animations are cleared on exit/restart, and completed sessions stop accepting ratings.
29. Cancelled pointer gestures do not rate cards. Duplicate cloze candidates are removed within a batch.
30. Exam resets clear timers; both exam countdowns use wall-clock deadlines. Results are recorded only once per session and AI grades are bounded to their maximum.
31. Generation respects explicit zero counts and input limits. Repeated keyboard shortcuts cannot launch overlapping generation requests. Navigating during generation saves the result separately instead of appending it to another deck.

### Exports, statistics, offline use and accessibility

32. Text quiz export supports true/false, fill-blank and matching alongside multiple-choice and written questions.
33. Statistics merge higher success counts even when review totals are equal; duplicate exam timestamps and invalid score records are rejected.
34. Review forecasts group by calendar date and the heatmap accommodates its final column.
35. Offline navigation with query parameters falls back to the cached app shell. Cache lookup uses this app's cache, cache cleanup excludes unrelated cache names, and runtime writes participate in the worker lifetime.
36. Share links use the current deployment origin/path. Failed sharing releases its focus trap.
37. Flashcard grid controls support keyboard flipping and expose pressed state. Study/completion dialogs trap focus; empty dialogs keep Tab within the dialog. Hidden exam panels ignore answer shortcuts.
38. Read-aloud chunks long unpunctuated text, stops on card changes and resets when notes are replaced.
39. The document language follows the UI language; translation substitutions preserve literal dollar-sign sequences.
40. Updated the service-worker cache version, corrected the smoke test's animation timing assumption and added regression suites to CI.

## Validation

- 24 existing smoke checks: demo, tabs, flashcards, drag rating, notes, exams, FSRS persistence, CSV, cloze, simulation, stats, palette, theme, library and sync dialog.
- 13 dependency-free data regression tests: normalization, JSON/CSV repair, storage failure, deck merging, mistake timestamps, stats merging, grade bounds and SSE parsing.
- 11 browser regressions: hostile follow-up text, stale chat/grade responses, per-message additions, mixed quiz exports, malformed decks, empty study sessions, schedule preservation, generation races, sync deletion ordering and offline navigation.
- JavaScript syntax checks and whitespace/diff checks.

AI and sync responses are mocked in regression tests. These tests verify frontend behavior, not production provider availability or real multi-device convergence. A browser PDF extraction fixture, comprehensive screen-reader testing and cross-browser coverage remain useful additions.

## Further architectural work

These are larger design improvements, not claims that the current tests establish correctness in these areas:

- **Merge concurrent edits at a finer granularity.** Sync still uses whole-deck timestamps. Pull-before-push reduces overwrites but two devices editing the same deck simultaneously can still conflict. Per-card review events and revision-aware writes would need a coordinated protocol and backend review.
- **Count independent device activity.** Daily statistics use maximum counters, so independent reviews on two devices can be undercounted. Device-scoped counters or unique review events would allow an idempotent additive merge and require a migration strategy.
- **Move large libraries to IndexedDB.** Synchronous whole-library serialization remains a scaling limit. A migration should preserve existing localStorage data, support rollback and validate recovery before removing old records.
- **Define backup restoration semantics.** Backups currently use the normal tombstone-aware merge. Restoring a deck deleted after the backup requires an explicit recovery policy; silently overriding deletion records would change sync behavior.
- **Coordinate schema validation with the Worker.** Validate payload sizes, sync envelopes, bearer-code handling, rate limiting, URL fetching and share retention at the server boundary. Client validation cannot enforce those guarantees.
- **Use abortable requests and bounded retry rules.** Session guards prevent stale UI writes, but abandoned AI requests can still consume server resources. A shared request layer should distinguish transport failures from validation/rate-limit failures and avoid duplicate billable generation.
- **Modernize and pin external dependencies.** PDF.js is still the existing CDN version, and CI installs test packages without a committed lockfile. A dependency update should include representative PDF fixtures and a reproducible browser toolchain.
- **Remove remaining inline handlers before enforcing CSP.** Model-controlled follow-ups are fixed, but static inline handlers remain throughout the UI. Their removal would make a strict content-security policy practical across supported hosting targets.
- **Expand accessibility and localization coverage.** Add screen-reader checks, proper tablist arrow navigation, reduced-motion/mobile browser runs, and an inventory of remaining hardcoded UI labels.
- **Review curriculum and grading separately.** Bundled curriculum labels and AI/keyword grading need an educational-content review; software tests cannot establish their accuracy. The offline keyword grader should remain visibly distinguishable from AI grading.
- **Make deployment artifacts explicit.** The Wrangler assets directory points at the repository root. A dedicated static deployment directory would make the publishable file set easier to verify across GitHub Pages and Cloudflare.
- **Automate cache versioning and asset inventory.** The cache name and shell list are maintained manually; a small build/check script could prevent stale updates or omitted offline assets without introducing a frontend framework.
