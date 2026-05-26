<div align="center">

# Vibisual

### See your AI agents think.

A visual workspace for Claude Code — watch your agents work as a live bubble
map, and configure sub-agents without ever opening `settings.json`.

<img src="docs/media/demo.gif" alt="Vibisual demo — hooks streaming into the bubble map, sub-agents configured visually" width="720" />

<sub>Hooks streaming into the bubble map, sub-agents configured visually.</sub>

<br />
<br />

<a href="https://youtu.be/asJ_Z-75uqc">
  <img src="https://img.youtube.com/vi/asJ_Z-75uqc/maxresdefault.jpg"
       alt="Full 2-minute walkthrough on YouTube" width="480" />
</a>

<sub>▶ <a href="https://youtu.be/asJ_Z-75uqc">Full 2-minute walkthrough on YouTube</a></sub>

<br />

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-7c3aed)](https://claude.com/claude-code)
[![Status: early](https://img.shields.io/badge/status-early%20%26%20rough-orange)](#honest-status)

</div>

---

## Why this exists

I was using Claude Code every day and kept hitting two walls:

1. **I couldn't see what the agent was actually doing.** Hook events scroll
   past in the terminal. Sub-agents spawn sub-agents. It's a tree, but it
   prints like a wall of text.
2. **Tuning sub-agents meant editing JSON.** Switching models, toggling
   tools, changing permission modes — all by hand, in a config file, every
   time.

So I built Vibisual. It's a desktop app that takes the Claude Code hook
stream and renders it as a live bubble map, with a panel for editing
sub-agent configs by clicking.

It's the tool I wanted to use myself. Putting it out in case it helps you too.

## What it does today

> ▶ The demo at the top of this page shows both pillars in action — hook
> events streaming into the bubble map, and an agent config panel opening
> on click.

**Hook-driven visualization.** Claude Code emits hook events on every
action — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`,
and friends. Vibisual subscribes to that stream and renders each event as
a node on the bubble map. Sub-agent spawns become edges. Tool calls become
child bubbles. Keyword links connect related work across sessions.

**Visual sub-agent configuration.** Click any agent bubble and a panel
opens with:

- Model (Opus / Sonnet / Haiku)
- Permission mode
- Allowed tools
- Max turns
- Isolation (worktree or in-place)
- Effort / reasoning level
- Skills enabled
- Color & label
- Per-agent rules

Save it. The next run picks it up.

**Other things in there:**

- Multi-project workspace with per-project state isolation
- Checkpoints & session replay
- Permission prompts surfaced in-app (no terminal swapping)
- Keyword graph across sessions (Layer 4)
- 12 UI languages (EN, KO, JA, ZH-CN, ES, ES-419, FR, DE, HI, ID, IT, PT-BR)
- A handful of built-in skills: runapp, runserver, reinstall, i18n-sync, …

## Where it's going

Vibisual starts as a Claude Code tool, but the architecture is CLI-agnostic.

| Phase | Goal |
|---|---|
| **v1 (now)** | Claude Code: hooks → bubble map, visual sub-agent config |
| **v2** | Adapter layer for other CLI agents — Cursor CLI, Codex, Aider, Continue, … |
| **v3** | **Harness Marketplace.** Publish your custom agent configs, hook recipes, and skill bundles. When someone uses your bundle, you earn a revenue share. |

The endgame is one visual control plane for every AI coding agent you run,
plus an economy around the configs that actually work in practice.

## Honest status

Vibisual is **vibe-coded** — built fast, with Claude Code itself, by one
person. That means:

- It works for the things I use it for daily.
- It has rough edges I haven't sanded down yet.
- Windows is the platform I actually test on. macOS and Linux builds
  exist but I haven't verified them in real use.
- The codebase is more "moving sketch" than "polished library." If you
  read the source you'll see traces of how it grew.
- Things I'd be embarrassed about in a corporate repo (TODOs, debug
  panels, half-explored ideas) are still in there. I'm leaving them.
  This is the actual shape of the project.

If that sounds OK, dive in. If you need enterprise polish, this is
probably too early.

## Quick Start

You'll need **Node.js ≥ 20**, **pnpm**, and the **Claude CLI** (`claude`)
on your PATH.

```bash
git clone https://github.com/Vibisual/vibisual.git
cd vibisual
pnpm install

# Build everything and launch the desktop app
node scripts/runapp.mjs
```

To build a distributable installer:

```bash
pnpm build:win    # Windows NSIS installer
pnpm build:mac    # macOS dmg
pnpm build:linux  # AppImage
```

### About the hook installer

On first launch, Vibisual writes a managed hook block into
`~/.claude/settings.json` so Claude CLI sessions can stream into the
bubble map. A timestamped backup is kept next to it
(`.bak-vibisual-*`). If you'd rather wire hooks yourself, set
`VIBISUAL_SKIP_HOOK_INSTALL=1` before first launch.

## Tech Stack

- Node.js 20+ / pnpm monorepo: `shared` / `server` / `client` / `desktop`
- React 18 + TypeScript 5 + Vite + [@xyflow/react](https://reactflow.dev)
  for the graph
- Express + WebSocket (ws) for the hook stream
- Tailwind CSS
- Zustand for state
- Electron (desktop shell, electron-vite preview)
- Vitest + React Testing Library

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

**About the name.** "Vibisual" and the Vibisual logo are trademarks of the
project maintainers. Apache 2.0 covers the code; it does not give you the
right to use the name or logo on a fork or derivative product. Forks are
welcome — please use a different name. See [NOTICE](NOTICE) for details.

## Contributing

PRs, issues, ideas — all welcome. Especially:

- macOS / Linux smoke tests (I can't reliably test these)
- Adapter prototypes for non-Claude CLIs (toward v2)
- Bug reports with reproduction steps

See [CONTRIBUTING.md](CONTRIBUTING.md). I use the
**Developer Certificate of Origin** — just `git commit -s` on your commits.

```bash
git commit -s -m "your change here"
```

