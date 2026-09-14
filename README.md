# Fabric UI

A local web interface for [fabric-ai](https://github.com/danielmiessler/fabric) patterns — search, run, and inspect output without the CLI, and without fabric's own official web app's limitations.

**Not affiliated with or endorsed by the fabric project.** Personal project, currently private.

## Why this exists

fabric's own official web app (`web/` in its repo) ships with a plain `<select>` listing all 260+ patterns alphabetically — no search, no descriptions, so picking the right one means already knowing its exact name. This project exists to fix that, plus add a few things fabric's REST API supports but no UI (including the official one) surfaces:

- **Searchable pattern picker with live descriptions** — type to filter; each match shows a one-line summary pulled from the pattern's own `# IDENTITY and PURPOSE` section
- **Token usage** shown after every run
- **CLI-command preview** — see the exact `fabric-ai` command your run corresponds to (handy for scripting the same thing later)
- **Web search toggle** — enable fabric-ai's live web search per run
- **YouTube URL input** with automatic mutual exclusivity against typed input (no silent overwrites)
- **Pattern chaining** (minimal version) — send one run's output straight into a new pattern as input, one click

See [`ROADMAP.md`](./ROADMAP.md) for what's shipped and what's next.

## Prerequisites

- [`fabric-ai`](https://github.com/danielmiessler/fabric) installed (`brew install fabric-ai`, or see fabric's own install docs) and configured with at least one model vendor's API key
- Node.js 20+ and npm
- `fabric-ai --serve` running (defaults to `http://127.0.0.1:8080`) — **this app is a frontend for that server, not a replacement for it**

## Setup

```sh
git clone https://github.com/saldroubi/fabric-ui.git
cd fabric-ui
npm install
```

## Configuration (optional)

By default this expects `fabric-ai --serve` at `http://127.0.0.1:8080` (fabric-ai's own default). If yours runs somewhere else:

```sh
cp .env.example .env
# then edit FABRIC_AI_URL in .env
```

## Running

In one terminal:

```sh
fabric-ai --serve
```

In another:

```sh
npm run dev
# or, to pick a specific port (e.g. if 5173 is already in use by something else):
npm run dev -- --port 5180 --strictPort
```

Open the URL Vite prints (defaults to `http://localhost:5173`). The port you choose doesn't matter for functionality — all fabric-ai API calls are proxied server-side through this app's own backend routes (`src/routes/api/`), so there's no CORS dependency on which port you land on.

## Building

```sh
npm run build
npm run preview   # preview the production build locally
```

An [adapter](https://svelte.dev/docs/kit/adapters) may be needed depending on where you deploy this — see SvelteKit's docs. For personal/local use, the dev server is fine as-is.

## Tech stack

SvelteKit 5 (runes mode) + TypeScript + Tailwind 4 + mdsvex — chosen to match fabric's own official web app's core stack, in case components/patterns are worth borrowing later.
