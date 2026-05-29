# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- IDE window no longer overlays onto other projects; each project keeps its own window state independently.
- Custom delegation edge dispatch no longer fails with 401 Unauthorized. The loopback hook listener now exempts the `/api/task-edges/dispatch` route from the per-launch token gate, since external `claude` subagent processes have no channel to receive that token. The route remains safe because the listener binds to 127.0.0.1 only and the dispatch handler still validates the edge ID and target agent.
- Local dev-server detection and embedded preview matching were hardened (inline `node -e` servers, positional-port commands, and probe commands like `curl` are now handled correctly).

### Removed
- Dropped preset options from the custom agent settings.

[Unreleased]: https://github.com/Vibisual/vibisual/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Vibisual/vibisual/compare/v0.1.0...v0.1.1
