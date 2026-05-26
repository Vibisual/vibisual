<div align="center">

# Vibisual

### See your AI agents think.

A visual workspace for Claude Code — watch your agents work as a live bubble
map, and configure sub-agents without ever opening `settings.json`.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-7c3aed)](https://claude.com/claude-code)
[![Status: early](https://img.shields.io/badge/status-early-orange)](#)

</div>

<img src="docs/media/demo.gif" alt="Vibisual demo — hooks streaming into the bubble map, sub-agents configured visually" width="100%" />

---

## What it does

Vibisual does two things.

### 1. Visualizes Claude Code through hooks

Every Claude Code hook event — `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `SessionStart`, and others — becomes a node on a
live bubble map. Sub-agent spawns become edges. Tool calls become child
bubbles. Keyword links connect related work across sessions.

The terminal output of a multi-agent Claude session is a tree printed
as a wall of text. Vibisual draws that tree as it grows.

### 2. Designs the harness as a visual graph

The bubble map is both the runtime view **and** the design surface for
your harness. Instead of editing `settings.json` in a text editor, you
build the harness on a canvas:

- **Place agents as nodes.** Drop a bubble onto the canvas to define a
  new sub-agent. Each node carries its own configuration — model,
  permission mode, tools, isolation, max turns, effort level, skills,
  and per-agent rules.
- **Wire them with edges.** Connect agents with task edges to define
  handoffs and dependencies between them. The edges become the
  control-flow graph of your harness.
- **The graph is the harness.** At runtime, Vibisual reads the graph
  and spawns Claude Code sub-agents accordingly. The same canvas you
  designed on is the canvas you watch the run on.

What used to be a buried `settings.json` tree is now a workflow you can
see, edit, and rearrange at any time.

## Watch the full walkthrough

[![Vibisual — full walkthrough on YouTube](https://img.youtube.com/vi/asJ_Z-75uqc/maxresdefault.jpg)](https://youtu.be/asJ_Z-75uqc)

▶ [Watch on YouTube — 2-minute walkthrough](https://youtu.be/asJ_Z-75uqc)

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

## License

Apache License 2.0 — see [LICENSE](LICENSE). "Vibisual" and the Vibisual logo are trademarks of the project maintainers; see [TRADEMARK.md](TRADEMARK.md) for the policy.

## Contributing

PRs, issues, and reproductions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

The project uses the **Developer Certificate of Origin** — just sign off your commits:

```bash
git commit -s -m "your change here"
```
