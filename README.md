<div align="center">

# Vibisual

### See your AI agents think.

A visual workspace for Claude Code — watch your agents work as a live bubble
map, and configure sub-agents without ever opening `settings.json`.

![Vibisual demo — hooks streaming into the bubble map, sub-agents configured visually](docs/media/demo.gif)

▶ [Full 2-minute walkthrough on YouTube](https://youtu.be/asJ_Z-75uqc)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-7c3aed)](https://claude.com/claude-code)
[![Status: early](https://img.shields.io/badge/status-early-orange)](#)

</div>

---

## What it does today

**Hook-driven visualization.** Claude Code emits hook events on every
action — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`,
and more. Vibisual subscribes to that stream and renders each event as a
node on a live bubble map. Sub-agent spawns become edges. Tool calls
become child bubbles. Keyword links connect related work across sessions.

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
- Keyword graph across sessions
- A handful of built-in skills: runapp, runserver, reinstall, and more

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

Tested on Windows. macOS and Linux builds are available but not extensively tested.

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

Apache License 2.0 — see [LICENSE](LICENSE). "Vibisual" and the Vibisual logo are trademarks of the project maintainers; see [TRADEMARK.md](TRADEMARK.md) for the policy.

## Contributing

PRs, issues, and reproductions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

The project uses the **Developer Certificate of Origin** — just sign off your commits:

```bash
git commit -s -m "your change here"
```

## Acknowledgments

- [Anthropic Claude Code](https://claude.com/claude-code) — the CLI Vibisual visualizes.
- [@xyflow/react](https://reactflow.dev) — the graph engine.
- [Lucide](https://lucide.dev) — icons.
