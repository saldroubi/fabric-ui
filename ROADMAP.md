# Fabric UI Advanced — Roadmap & TODO

Merged from `fabric-gui/roadmap.md` and `fabric-gui/TODO.md` on 2026-09-14, with the TUI build removed
(decided 2026-09-14: web app only — see [Decisions](#decisions) below). This is now the single planning
doc for this project.

## Context

`fabric-gui` (a vanilla HTML/JS + Python-proxy tool) was the first prototype — built to run fabric-ai
patterns from a browser instead of the CLI. It proved out the core feature set and caught real problems
(unsearchable 260+-pattern list, silent YouTube/input conflicts, sessions not doing what the name implied)
before this rewrite started. `fabric-ui` is a clean SvelteKit rebuild — not a fork of `fabric-gui`
and not a fork of fabric's own official `web/` app — that carries the *proven features* forward properly
architected, and adds the larger ones `fabric-gui` never attempted.

## Decisions

- **Web app only, no TUI.** The original plan was Go+Bubble Tea TUI first, Svelte web UI second (reusing
  the TUI's "core logic"). Reconsidered 2026-09-14: the two aren't code-shareable anyway (different
  language runtimes — Go binary vs. browser/Node JS), and personal usefulness matters more here than
  matching fabric's own Go-binary distribution model. If a TUI happens later, it will be a separate,
  from-scratch Go project that only shares *API/protocol knowledge* with this one, not code. If real
  logic-sharing across a future TUI and this web app ever matters, the right place for that shared logic
  is inside `fabric-ai` itself (already Go) as new endpoints/flags — both frontends would then be thin
  clients over one implementation.
- **Not a fork.** Built as a fresh `sv create` scaffold (SvelteKit + TypeScript + Tailwind 4 + mdsvex —
  matching fabric's own official web app's core stack so components/patterns are easier to borrow later).
  `fabric-source` (a clone of `danielmiessler/fabric`) exists locally only as a read-only reference for
  comparison, not something this project imports from.
- **Separate repo**, local git only for now (`git init` done 2026-09-14) — no GitHub remote yet.
- **Tech stack confirmed and executed**: SvelteKit 5 (runes mode), TypeScript, Tailwind 4, mdsvex. Skeleton
  UI (fabric's own component library) not yet added — revisit if/when a component need justifies the
  dependency.
- **CORS/proxy solved via SvelteKit server routes** instead of a separate Python process: fabric-ai's REST
  API only sets `Access-Control-Allow-Origin` on `/chat` (hardcoded to `localhost:5173` — coincidentally
  fabric's own official app's default Vite port), and zero CORS headers on every other endpoint
  (`/patterns`, `/models`, `/youtube/transcript`, ...). `src/routes/api/fabric/[...path]/+server.ts` proxies
  everything server-side, sidestepping the problem entirely regardless of which port Vite picks.

## Feature backlog

Merged from both source documents; overlapping ideas combined into one item.

### High priority

- [x] **Pattern chaining / pipelines (minimal version)** — 2026-09-14. "Use as input →" button loads the
  current output into the input box, clears the YouTube field, and focuses pattern search so the user
  picks a new pattern and Runs — no manual copy/paste. Verified live: `tighten_prompt`'s output correctly
  fed `improve_prompt` as input. Originally surfaced in `fabric-gui` when "Session" was mistaken for this
  exact feature. Not something fabric-ai's API does natively (the CLI equivalent is piping,
  `fabric-ai -p pattern1 | fabric-ai -p pattern2`) — this is GUI-side orchestration, two sequential
  `/chat` calls with a UI step in between.
  - [ ] **Ambitious version, not built**: a full visual pipeline/wiring builder (drag boxes, connect
    outputs to inputs, run a whole chain in one click). Revisit if the minimal version proves limiting.
- [ ] **Pattern variables** — patterns can define `{{variable}}` placeholders; `/patterns/:name/apply`
  already accepts a `variables` map server-side, but no UI exists to supply them. The official fabric web
  app has a raw JSON textarea for this (`{"lang_code": "fr", "role": "expert"}`) — functional but not
  friendly. Worth doing better: a form UI that surfaces the variables a *specific* pattern actually
  declares, not a blind JSON box.
- [ ] **Contexts** — `/contexts/*` supports reusable text blocks prepended to any pattern (e.g. a saved
  Genie Agent's vocabulary, so `improve_genie_question` doesn't have to guess table/column names every
  time). Not exposed in either the old or new UI yet.
- [ ] **Session/history browser** — fabric-ai stores session history in a filesystem DB (`fsdb`); nothing
  surfaces it well anywhere, including the official app's raw "Session Name" text field. Build a
  searchable history view: past runs, inputs/outputs, diff two outputs, re-run a past session with tweaks.
  Note: this is about *reading* past sessions, which sidesteps the live multi-turn bug below — a browser
  doesn't need to *create* new multi-turn exchanges to be useful.
  - Known limitation if multi-turn *writing* is ever revisited: the 2nd+ message in any session that uses
    a pattern currently fails against Anthropic (`400 This model does not support assistant message
    prefill`), reproduced via plain CLI — this is an upstream fabric-ai bug, not something either UI can
    fix. Tracked as [danielmiessler/fabric#2208](https://github.com/danielmiessler/fabric/issues/2208).

### Medium priority

- [ ] **Multi-model comparison view** — run the same pattern across 2-3 models (e.g. different Claude
  tiers, or Ollama if configured) side by side to compare outputs directly.
- [ ] **Live pattern editor with test runs** — edit a pattern's `system.md` in the UI and immediately test
  it against sample input, side by side, without leaving the editor. `/patterns/:name` already supports
  GET (raw content) and POST (save) server-side.
- [ ] **Smart input handling, remaining pieces** — YouTube URL handling (auto-detect + mutual exclusivity
  with typed input) is already done. Still open: generic URL scraping (fabric's `-u`/`scrape_url` flag) and
  drag-and-drop file input, so users don't need to remember which flag maps to which input type.
- [ ] **Strategies dropdown** — `/strategies` lists reasoning strategies (e.g. chain-of-thought) from
  `~/.config/fabric/strategies/*.json`. Not exposed anywhere yet.
- [ ] **Advanced params panel** — temperature / top_p / seed are supported by fabric-ai's `ChatOptions` but
  hardcoded to defaults currently.

### Lower priority / exploratory

- [ ] **Custom pattern builder** — a form-based UI for authoring brand-new patterns (not just running or
  editing existing ones), including variable/placeholder definition, without hand-editing markdown files.
  Broader than the live pattern editor above — that one edits; this one creates from scratch.

## Shipped

Everything below was built and verified working in `fabric-gui` (the vanilla-JS prototype). The features
carry forward into `fabric-ui` as native SvelteKit implementations rather than ported files —
tracked here as design/functionality wins, not code to copy.

- Token usage display (parses the `/chat` SSE `usage` event) — 2026-09-11
- CLI-command preview (shows the equivalent `fabric-ai` command, real input redacted as `<your input>`) — 2026-09-11
- Searchable pattern picker with live descriptions (pulled from each pattern's own `# IDENTITY and PURPOSE`
  section) — 2026-09-11. Confirmed 2026-09-14 by inspecting fabric's own official app: it ships a plain
  260+-item `<select>` with zero search or descriptions — this remains a real differentiator, not a solved
  problem elsewhere.
- Web search toggle (`ChatOptions.Search`, verified live — token count jumped 7x confirming the tool
  actually fired) — 2026-09-11
- YouTube URL / typed-input mutual exclusivity (one field disables the other, so a transcript can never
  silently overwrite typed input) — 2026-09-14
- Sessions — built then removed the same day, 2026-09-11. Blocked by the upstream bug noted above, and
  separately the UI was confusing (users expected "Session" to mean pattern chaining — see that backlog
  item). Removed entirely rather than shipped half-broken.
- 5 custom Databricks fabric patterns, distilled from `databricks/databricks-agent-skills` (the real source
  behind `databricks-solutions/ai-dev-kit`'s installer notebook — most of that ~30-skill set doesn't
  convert to fabric patterns since it assumes live CLI/workspace execution, but the pure code-writing-
  convention subset does): `write_databricks_pipeline_code`, `write_databricks_streaming_code`,
  `write_databricks_sql_code`, `write_databricks_sdk_code`, `review_databricks_serverless_compatibility` —
  all 2026-09-11, all tested live with planted-issue inputs to confirm correctness, not just that they run.
  These live in `~/.config/fabric/patterns/` and work regardless of which UI is used.

**`fabric-ui` milestones:**

- SvelteKit + TypeScript + Tailwind 4 + mdsvex scaffold, git-initialized — 2026-09-14
- Server-side proxy (`/api/fabric/[...path]`) replacing the standalone Python proxy — 2026-09-14
- Full pattern-runner page ported and verified end-to-end against live `fabric-ai --serve`: pattern search
  + descriptions, model selection, web search toggle, YouTube/input mutual exclusivity, streaming output,
  token usage, CLI-command preview — 2026-09-14
