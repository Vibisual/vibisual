# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-07-03

### Added
- **Mobile access.** Open Vibisual from your phone's browser (File → Mobile Access…). Turn it on and it starts listening on your local network; scan or type the shown address on a phone on the same Wi-Fi, enter the one-time pairing code, and you're in — paired devices stay connected, and a failed-attempt lockout guards the code. An optional *Access from outside* mode asks your router to open a port automatically (UPnP) and serves over encrypted HTTPS so you can reach the PC over the internet, with clear guidance when your connection is behind carrier-grade NAT or UPnP is off.
- **Rate an agent's work.** Work-report and review cards, and the agent's result blocks, now carry like / dislike buttons. A dislike can take an optional reason, and the reasons you leave for an agent can be distilled into suggested rule sentences you review and approve before they're added to that agent's settings — so recurring corrections turn into standing guidance instead of being repeated. Nothing is applied automatically.
- **Built-in slash commands in autocomplete.** The Claude CLI's own commands — `/clear`, `/compact`, `/model`, and the rest — now appear in the `/` autocomplete in the terminal input alongside your project, global, and plugin skills, tagged *built-in*. They're discovered from the CLI itself, so updating the CLI surfaces new ones without a Vibisual update.
- **Language setting.** Options → Appearance now has a UI language picker that applies immediately.

### Fixed
- **Long sessions no longer wind the view upward.** On heavily-used sessions where older output is trimmed from the top, the scroll position no longer drifts or jumps away from the bottom as new text arrives; growth-following stays pinned to the bottom and releases only when you scroll up yourself.

## [0.1.5] - 2026-07-02

### Added
- **Per-agent budget cap.** Each custom agent can now be given a spending limit in US dollars (*Budget ($, 0 = unlimited)*) in its settings. When a cap is set the agent runs every turn as a fresh metered `--print` spawn so the limit is enforced across the whole run, guarding against a runaway agent draining your API credit. Interactive-terminal (CMD) agents are unaffected.
- **Bookmarks inside the agent output.** Select any text in an agent's output, right-click, and choose *Bookmark* to pin it into a new Bookmarks panel — later jump back to where it came from, copy it, or remove it. (Separate from the Alt+1…0 bubble bookmarks.)
- **Session summaries.** A new sidebar view that gathers each session's report cards into one readable summary — what was done, what changed, your actions, checkpoints, questions, and next steps — with summarize / re-summarize on demand. You can also tidy up by closing inactive, already-reviewed sessions in one click; they stay in History.
- **Card rail in the terminal.** The work-report, question, and review cards an agent files are now collected into a collapsible Cards rail beside the terminal, so you can scan or clear them without scrolling back through the whole stream.
- **Follow-up messages.** Send an agent another message with the *Add* button (Enter) without stopping its current run, instead of having to interrupt it first.
- **Drop files to add their paths.** Drag files onto the agent input to insert their paths into your prompt.
- **Overlay bubble menu.** Right-click a desktop overlay bubble for Open IDE, Find on canvas, an opacity control, Hide, and Remove from overlay.
- **Skill favorites, refresh, and quick-create.** Star the skills you use most into a Favorites group, refresh the skill list without reloading, and start a new skill straight from the sidebar.
- **Find in conversation.** Search within an agent's output, with previous / next match navigation.
- **Restore a previous custom agent.** Canvas right-click now offers *Restore Previous Custom Agent* to bring back a custom agent from an earlier session by its saved identity.
- **Debug panel additions.** The Debug panel now shows the active project (name / path), live node and edge counts, and a frames-per-second meter.
- **Jump to bottom.** A quick scroll-to-bottom action in the agent output.

### Changed
- **Stays responsive over long sessions.** The agent stream no longer slows down and bloats the longer you use it. On the client, output is now parsed incrementally — only the newly arrived text is processed each tick instead of re-parsing the whole buffer — and on the server the on-disk stream buffers are capped and trimmed. Long-running or heavily-used sessions hold a steadier frame rate and a smaller memory and disk footprint.

### Fixed
- **Stream auto-scroll jitter.** Fixed the flicker where the last line would shudder, mis-align, or bounce up and down as new text arrived, and the view would stop short of the bottom or get yanked away while you were reading. Growth-following is now driven by a single pin at the moment the list's measured height actually changes, and it releases only when you deliberately scroll up (wheel, touch, or keyboard), re-arming when you return to the bottom.

## [0.1.4] - 2026-06-11

### Added
- **Guide window** (File → Guide). A built-in tour and feature inventory: eight categories — Getting Started, Bubble Map, Agents, Task Edges, IDE Overlay, Navigation, History & Saving, and Shortcuts — each laying out what Vibisual can do and how, so newcomers can find their bearings without leaving the app.
- **Desktop overlay bubbles.** Pop an agent bubble out of the canvas into an always-on-top desktop widget that floats over your other windows — click it to jump straight back into that agent's IDE, and toggle all overlay bubbles in or out of view at once. Handy for keeping an eye on a running agent while you work elsewhere.
- **Bubble bookmark shortcuts.** Alt+1…0 now pins the focused bubble or session to a numbered slot, and pressing 1…0 jumps straight back to it. Shortcuts pause automatically while you're typing in an input or terminal so they never swallow your keystrokes.
- **CMD agents can raise cards too.** The embedded interactive CMD agent can now surface work-report, question, and review cards just like spawned agents — it prints a single marked line to its own terminal and the IDE captures it and rewrites it as a colour-coded card, with no port, token, or `curl` plumbing to set up.
- **Collapsible prompts in the stream.** The text you typed now appears in the agent stream as a tidy collapsible "You" block, so long prompts no longer push the agent's actual work off the screen.
- **Global skills.** Skills and commands installed in your home `~/.claude` (shared across every project) now show up under their own "Global" group in the Skills view, alongside Project and Plugin skills.
- **Terminal input context menu.** Right-click the IDE terminal's input box for Cut, Copy, Paste, and Select all.
- **Builder activity view for Auto Agent.** While the Auto Agent's builder is designing and wiring a team, its live activity is now shown inline so you can watch the work as it happens.

### Changed
- **New model families appear automatically.** Model handling no longer hard-codes the Opus / Sonnet / Haiku trio. Any `claude-<family>-<version>` the Claude CLI or `/v1/models` reports — including brand-new families like Fable — is now recognised on its own: it shows up in the model picker, is labelled correctly on bubbles, and resolves its "latest" build without a code change. Families without a known price/context table fall back to conservative defaults rather than being hidden.

### Fixed
- **Report cards survive an app restart.** The work-report, question, and review cards an agent files no longer go silent after the app is restarted or its hook port changes. Instead of baking the server port and token into the prompt once at spawn time — which left already-running sessions pointing at a dead port — the card commands now read the live port and token from a fixed identity file at the moment they run, so resumed sessions always reach the current app. If that file is missing the old baked-in values are still used, so this never makes things worse than before.

## [0.1.3] - 2026-06-04

### Added
- **Review request cards.** When an agent finishes a task you asked for — especially a bug fix or behaviour change — it can file a structured "review request" that the IDE renders as a purple card: the instruction it was given, what it changed, and what you should verify. This is distinct from a work report's "what you need to do" card — a review card is for double-checking work the AI has already completed, not for handing you a manual step.
- **Bookmarks.** Assign canvas bubbles or an open agent IDE to numbered bookmark slots and jump straight back to them later, with an on-screen confirmation when you set or jump to one (and a clear message when a slot is empty or its target no longer exists).
- **Hover tooltips on tab labels.** When a tab name is too long to fit and gets truncated, hovering now shows the full label quickly — faster than the native browser tooltip, and rendered so it isn't clipped by the tab bar. Agent tabs can also be renamed in place.

### Changed
- **Hook agents are easier to tell apart.** Agent bubbles captured from external Claude Code hooks now use a darker navy shade, distinguishing them at a glance from the brighter blue of the custom / CMD agents you orchestrate yourself, while still keeping their blue active glow.

## [0.1.2] - 2026-06-02

### Added
- **CMD Agent — embedded interactive terminal.** A new agent type (canvas right-click → Create CMD Agent) opens a real terminal right inside the IDE with `claude` pre-filled, that you drive yourself. Unlike spawned agents it runs on your Claude subscription (interactive billing) instead of the API. It's a full terminal: copy / paste / select-all / clear, in-terminal find with next/previous matches, and font-size controls, plus a right-click context menu. Vibisual visualizes the session and wires the harness, while execution authority stays inside Claude Code.
- **Work report cards.** When an agent finishes something that still needs your hands, it can file a structured report that the IDE renders as colour-coded cards — "What the AI did", "What you need to do", and "Next steps" — so you can tell at a glance what's done versus what still needs you, without reading the whole message.
- **Question cards.** When an agent needs a decision from you, its question now surfaces as a highlighted card with ready-to-send suggested replies. Each reply sits in a copy box with Copy and Send-now buttons (Send-now dispatches that reply as a new prompt).
- **Update confirmation.** The "Restart to update" button now asks for confirmation first, warning that in-progress agent work or unsaved changes may be lost, and suggesting you finish important custom-agent work before applying the update.
- **Window controls on detached tabs.** Detached / free-floating windows now have Minimize, Maximize, and Restore controls, and tabs can be renamed or detached to a new window from their context menu.

### Changed
- **Reasoning effort levels** were expanded with clearer guidance, including an Extra-high tier (Opus 4.7+, recommended for most coding work) and a Maximum tier (Opus 4.8, no token limit for the hardest judgment calls).

### Fixed
- Detached frameless windows now restore correctly after being maximized (maximize/restore state is judged from the window bounds), and redock-by-drag back onto the tab bar is more reliable.
- Per-project state — including agent work reports — now survives an app restart instead of being lost when the app is closed and reopened.

## [0.1.1] - 2026-05-29

### Added
- **Auto-update.** The app now checks GitHub Releases for newer versions, downloads them in the background automatically, and shows a blue "Restart to update" button in the top-right header (VS Code style). Clicking it restarts the app and applies the new version in one step.
- **Options window** (File → Options). A dedicated settings window with a left category list and right form: Agent Defaults (model / permission mode / tools / effort / isolation / rules / color applied to newly created agents), Appearance, and a Version & About tab that shows the Claude Code binary in use, compares it against the latest on npm, lists every Claude installation found on the PC, and lets you pick which one to use.
- **Auto Agent.** A meta-agent bubble (canvas right-click → Auto Agent): describe what you want in plain language and it automatically spawns a team of custom agents, wires the Task Edges between them, and forwards your request to the entry agent.
- **Skills.** A Skills sidebar view in the IDE, slash-command autocomplete in the IDE terminal input, and per-project skill usage counts that sort the list by how often each skill is used.
- **Detachable tabs.** Drag a project or preview tab out of the tab bar to pop it into its own window, and drag it back onto the tab bar to redock.
- **IDE overlay window modes.** The agent IDE overlay can be a modal, a free-floating window, or docked to the right edge (with a snap preview while dragging); the detail panel mirrors to the left when the IDE is docked right.
- **Terminal context menu.** Right-click in the IDE output to Copy, Quote reply, Send as a new prompt, or Select All.

### Changed
- **Models are resolved dynamically.** The model picker now always uses the latest model of each family (e.g. Opus 4.8) without any code change when a new model ships, with a version sub-dropdown to pin a specific build.
- **Custom agent settings** were streamlined around the dynamic model selection.

### Fixed
- Auto-update installs silently (one-click) and restarts on its own — no installer wizard, no "Failed to uninstall old application files" error.
- The brand app icon is embedded into the executable on every build (local and CI) via a bundled `rcedit`, so installed/updated builds no longer fall back to the default Electron icon.
- IDE window no longer overlays onto other projects; each project keeps its own window state independently.
- Custom delegation edge dispatch no longer fails with 401 Unauthorized. The loopback hook listener now exempts the `/api/task-edges/dispatch` route from the per-launch token gate, since external `claude` subagent processes have no channel to receive that token. The route remains safe because the listener binds to 127.0.0.1 only and the dispatch handler still validates the edge ID and target agent.
- Local dev-server detection and embedded preview matching were hardened (inline `node -e` servers, positional-port commands, and probe commands like `curl` are now handled correctly).

### Removed
- Dropped preset options from the custom agent settings.

[Unreleased]: https://github.com/Vibisual/vibisual/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/Vibisual/vibisual/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Vibisual/vibisual/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Vibisual/vibisual/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Vibisual/vibisual/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Vibisual/vibisual/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Vibisual/vibisual/compare/v0.1.0...v0.1.1
