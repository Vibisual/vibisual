<div align="center">

# Vibisual

### See your AI agents think.

A visual workspace for Claude Code — watch your agents work as a live bubble
map, and configure sub-agents without ever opening `settings.json`.

<!--
  HERO VIDEO
  ─ Drop test/hero.mp4 (11s, 1080p, 1.1MB) into any GitHub Issue comment to
    get a https://github.com/user-attachments/assets/... URL.
  ─ Paste that URL inside the <video src="…"> below.
-->

<a href="https://youtu.be/asJ_Z-75uqc">
  <img src="https://img.youtube.com/vi/asJ_Z-75uqc/maxresdefault.jpg"
       alt="Vibisual demo on YouTube" width="720" />
</a>

<sub>▶ Click for the full 2-minute walkthrough on YouTube</sub>

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

## Acknowledgments

- [Anthropic Claude Code](https://claude.com/claude-code) — the CLI this
  visualizes, and the tool I used to build most of this.
- [@xyflow/react](https://reactflow.dev) — the graph engine doing the
  heavy visual lifting.
- [Lucide](https://lucide.dev) — icons.
- Korean indie dev community on YouTube for keeping me motivated while
  vibe-coding.

---

## 한국어 (Korean)

**Vibisual** 은 Claude Code 에이전트의 활동을 실시간 버블맵으로 시각화하는
데스크탑 앱입니다. 훅 이벤트가 들어올 때마다 버블맵에 노드가 그려지고,
서브 에이전트의 설정(모델·권한·도구·스킬·격리 모드 등)을 UI에서 손쉽게
조정하실 수 있어요.

### 왜 만들었나

Claude Code를 매일 쓰다 보니 두 가지가 답답했어요.

1. **에이전트가 뭘 하는지 안 보임** — 훅 이벤트는 터미널에서 흘러가버리고,
   서브 에이전트가 또 서브를 띄우면 트리 구조가 텍스트 벽으로 출력돼요.
2. **서브 에이전트 튜닝이 매번 JSON 편집** — 모델 바꾸고 도구 토글하고
   권한 모드 바꾸려면 설정 파일 직접 만져야 해요.

그래서 만들었습니다. 일단 제가 쓰려고 만든 거고, 혹시 비슷한 답답함 있으신
분들 계시면 같이 쓰시면 좋겠다는 생각으로 공개합니다.

### 현재 가능한 것

- **훅 기반 시각화** — PreToolUse / PostToolUse / UserPromptSubmit 같은
  Claude Code 훅을 받아 버블맵 노드로 그립니다.
- **비주얼 서브 에이전트 설정** — `settings.json` 안 건드리시고 버블 클릭으로
  모델·권한·도구·스킬·격리 모드 다 조정 가능합니다.
- 다중 프로젝트 워크스페이스 · 체크포인트 · 세션 리플레이
- 권한 프롬프트 인앱 처리 (터미널 왔다갔다 안 하셔도 됨)
- Layer 4 키워드 그래프
- 12개 UI 언어

### 비전

| 단계 | 목표 |
|---|---|
| **v1 (현재)** | Claude Code 지원 |
| **v2** | 다른 CLI 에이전트(Cursor, Codex, Aider 등) 어댑터 |
| **v3** | **하네스 마켓플레이스** — 본인의 에이전트 설정·훅 레시피·스킬 번들을 공개하시면, 다른 분들이 쓸 때 **수익 쉐어**로 보상받으실 수 있습니다. |

모든 AI 코딩 에이전트의 시각적 컨트롤 플레인 + 검증된 설정들의 경제권을
만드는 게 최종 목표입니다.

### 솔직한 상태

이 프로젝트는 **바이브 코딩**으로 만들었어요. Claude Code 본인을 써서
혼자 빠르게 만들었다는 뜻이에요. 그래서:

- 제가 매일 쓰는 기능들은 잘 동작합니다.
- 손 안 댄 거친 부분들도 곳곳에 있어요.
- Windows에서만 실사용 검증되어 있어요. macOS·Linux 빌드는 이론상 됩니다.
- 코드베이스는 "다듬은 라이브러리"보다 "움직이는 스케치"에 가까워요.
- 일반 회사 레포면 부끄러울 만한 흔적들(TODO, 디버그 패널, 시도하다 만
  아이디어)도 그대로 남겨뒀어요. 이게 프로젝트의 실제 모습이라고
  생각해서요.

이게 괜찮으시면 환영입니다. 엔터프라이즈급 완성도를 기대하시면 아직
이를 거예요.

### 데모

전체 데모 영상 → https://youtu.be/asJ_Z-75uqc

(한국어 나레이션이지만 화면 위주라 영어권 분들도 보실 수 있어요.)

### 라이선스

Apache 2.0. 코드는 자유롭게 쓰시되 **"Vibisual" 이름과 로고는 상표**로
보호됩니다. 포크해서 새 프로젝트로 만드실 때는 다른 이름으로 부탁드려요.

기여 환영입니다. [CONTRIBUTING.md](CONTRIBUTING.md) 보시고 커밋에
`git commit -s` 로 DCO 사인오프만 부탁드릴게요.

### 도움 받으면 좋은 부분

- macOS / Linux 실사용 테스트 (저는 검증을 못 해요)
- Claude 외 CLI 어댑터 프로토타입 (v2 방향)
- 재현 가능한 버그 리포트

---

<div align="center">

Built one bubble at a time, with Claude Code, in Seoul.

</div>
