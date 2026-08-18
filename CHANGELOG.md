# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.9] - 2026-08-18

### Added
- **A real editor, inside the IDE.** File names were showing in three places — the explorer tree, the *edited files* section, and the `Edit` tool header in the stream — and none of them opened anything. All three now open the same built-in editor, docked to the right of the conversation rather than covering it, so you read the file while the agent keeps talking. Tabs with dirty dots and a close prompt, `Tab` / `Shift+Tab` indent, `Ctrl+S` save, original line endings preserved, and a modification check that refuses to overwrite a file the agent changed underneath you. There's a right-click menu, read-only files can be unlocked and saved, and a **Follow** toggle walks the editor to whatever the agent is editing right now — telling you when it chose not to follow, and why.
- **The Files view is now a workspace explorer.** Instead of the bare filenames the agent happened to touch, you get the real directory tree from the project root — lazy-loaded, hidden entries included, original casing — with the full path shown in the tooltip, the footer, and as `parent/file`. The old edited-files list is kept as a collapsible section rather than replaced.
- **Run and Debug.** A new activity-bar section finds your run configurations wherever they already live — `.vscode/launch.json`, `tasks.json`, `package.json` scripts, `.vibisual/run.json` — and runs them with output in the panel. Debug mode now actually attaches: a common debug layer speaks both CDP and DAP, so a breakpoint stops instead of the process sitting there waiting for a debugger that never came. **Unreal projects are first-class** — open any `.uproject` and the configurations appear, without writing a per-project file first.
- **Play bubbles — a button on the canvas that starts your project.** Drop one on the canvas and press it instead of asking an agent to "start the server"; a live preview appears beside it, and closing the preview leaves the button. How to start a given app is worked out in four steps (static serving → auto-detection → learning by watching → asking an agent), and once it's settled the recipe is saved to the bubble, so it's one click from then on.
- **Internal apps — and the first one, Vibistudio.** Things too heavy to be a plugin now install as separate apps from **File → Apps**, appear as their own bubbles on the canvas, and cost nothing when you don't use them (an app that isn't installed is never even loaded). The first is **Vibistudio**, a programmable video studio: code-driven motion graphics and real footage on one timeline, a timeline an agent can edit directly, and rendering that happens entirely on your machine.
- **Session goals.** Give an open session a goal sentence and the activity bar carries its progress as a percentage at all times. The goal is re-injected every turn, so editing it mid-run changes the next turn instead of requiring a restart, and progress comes from three sources — the agent's own report, your manual correction, and the plan checklist — with the agent's explicit report winning. A goal is a final objective plus a todo checklist.
- **Sign in to Claude inside the app.** Logging in used to mean a black console window outside the app, and logging out or switching accounts had no path at all. There's now a login popup when you aren't signed in, and an **Account** tab in Options to check the account or sign out.
- **See — and switch off — everything being fed to the agent.** A new *Context* view lays out every source that gets prepended to your prompt: card instructions, the intent declaration, the session goal, the Brain briefing, enforcement plugins, edges, feedback, Agent Rules, plus Claude Code's own `CLAUDE.md`, memory index, skill and command descriptions, subagent definitions, tool schemas and system prompt. Each row shows its estimated size and can be turned off per session or per project, with a one-line explanation on hover and a detail dialog on click.
- **Reading settings.** Line length, text size, line height, letter and word spacing, and paragraph spacing are yours to set, with width presets, a slider, and a badge measuring the line against the accessibility guideline for CJK text — because there is no single correct width, only the one that suits you.
- **Draw on a screenshot instead of describing it.** The attachment lightbox gains annotation: rectangle, ellipse, arrow, pen, highlighter, redaction, text, and auto-numbering badges, in six colours and three weights. What gets attached is the annotated PNG, so you can write "area 2" instead of a paragraph locating a button. The default tool is *View*, so viewing an image behaves exactly as before.
- **Command history, per session.** Walk back through what you've already sent, without leaving the session you're in.
- **Verified runs.** "Done" used to be a word the model produced. Completion for autonomous runs is now decided by the server, an unreadable review verdict is no longer treated as approval, and exceeding the rework limit calls you instead of quietly lowering its own standards.
- **Copy a skill into another project**, straight from the sidebar.
- **Loops got a budget and a memory.** The loop screen moved from an overlay into the sidebar, context is compacted automatically at the end of each round, and each round runs against an explicit budget.
- **Running subagents, in detail.** The view moved from a count to what each background child is doing and what it produced, with per-item expiry, an unresponsive marker, and the ability to take one down on its own.
- **Emptying the Trash.** Three deletion actions inside the Trash bubble, plus a Storage tab in Options.
- **Tabs move out of the way.** Dragging a tab now pushes its neighbours aside with real motion instead of snapping into place or drawing an insertion line.
- **Bash tool timeout is a setting**, and IDE bookmarks are kept per project.

### Changed
- **Plugins stopped only watching.** All 111 inspector cards gained an enforcement side: switch one on and that principle is loaded into the agent's prompt every turn — for that project only, since plugin scope moved from global to per-project. Each plugin is also now a self-contained folder that runs if you copy it elsewhere, with its own descriptor and its own translations.
- **Slash commands reach the CLI again.** Everything we prepend to a turn was standing in front of them, so `/context` and friends were handed to the model as plain text instead of being run.
- **Less noise in the stream.** Finished thinking blocks are gone entirely (thinking is one live line while it happens), repeated `working` heartbeats for a task already on screen are no longer drawn at any density, and housekeeping notifications are hidden.
- **Cards stay where they were reported.** Work reports, questions, and reviews are pinned at the point in the conversation where they arrived, instead of riding along at the bottom of the screen.
- **Hook bubbles are read-only** — an externally-started session is something you watch, not something you type into.
- **A turn ending is provisional.** A finished result no longer seals a turn as complete while background work it started is still running.
- **App bubbles are graphite and a third of the size**, and canvas physics runs always rather than only when satellites are present.

### Fixed
- **It no longer gets heavier the longer it runs.** Eleven hours in, the main process — which is also the server core — held 3 GB, while everything on disk came to 73 MB. The I/O counters told the real story: a single tool event was reading 832 MB. Caches are now bounded by bytes rather than item count, whole-file reads became chunked reads, and conversation-event and summary extraction became incremental, so an event reads what changed instead of everything.
- **The middle of a conversation no longer vanishes**, leaving only your bubbles and the cards. The restore budget was being spent on events that are never drawn on screen.
- **An `[immediate]` follow-up could end the session.** Sending one while a turn was held open by lingering background work wrote to a closed pipe and took the whole process down.
- **Background work survives the turn that started it.** Two places were terminating the session process — and therefore every background task it had spawned — the moment a turn finished.
- **"Running" tells the truth.** The running indicator is now cross-checked against the actual process: a session that had already died showed as running for up to five minutes, now five seconds, and the paths that produced that state were closed.
- **Hook blocks no longer pile up.** An installer that could only find its own marked block left every older one behind — one measured `settings.json` had 58 blocks, meaning eight `node` processes spawned on every single tool call. Old blocks are now collected, and backups rotate instead of accumulating (88 of them had gathered in one folder).
- **External files and folders open again**, and custom agent settings match what the installed CLI actually accepts.

## [0.1.8] - 2026-08-03

### Added
- **Plugins — 111 inspector cards you switch on one at a time.** A new plugin kernel (File → *Plugins…*) turns the 2026 agent-engineering vocabulary — context engineering, retrieval, memory, evaluation, security, orchestration — into small inspector cards that read what your agents are actually doing and show whether that principle is holding. Everything is **off by default**: each entry tells you what you'd see before you enable it, categories fold, and the enabled / total count is shown per category. Cards only observe — they never take over what the core already does — and one misbehaving card is isolated so it can't take the app down with it. All of them are fully translated into the 12 supported languages.
- **Command Center.** Double-click a project's root bubble to open a dedicated window that sorts every session by what it wants from you — *Needs your answer*, *Waiting for review*, *Your turn*, *Working*, *Finished / idle*. From a card you can jump to the session, send it a command without opening the IDE, ask for a summary, stop it, or close its tab; a search box filters across every session at once.
- **Screen and program capture bubbles — with remote control.** Put a live screen or application window on the canvas as its own bubble (canvas right-click → *Screen / Program Capture Bubble*). Open it large in an in-app window, magnet-snap two or three capture bubbles together into a multi-monitor wall, and — with remote control on — click, drag, right-click and type into the captured machine straight from the bubble, in either *touch* mode (acts where you point) or *mouse* mode (a trackpad for phones). It works from a phone over Mobile Access too, and your own pointer no longer gets yanked around: a look-alike cursor is drawn under your finger while the real one stays where you left it.
- **A memory library you can read.** Project Brain moved out of a ranked feed into an in-app window organised by **topic**: memories are filed under subjects like capture, worktrees, usage, or UI, so an agent (and you) can open only the topic at hand instead of being handed a pile of cards. Cards carry their own lifecycle — a card whose source file changed since it was written is flagged *needs checking*, agents report back whether it still holds, and repeatedly-stale cards are archived rather than deleted. Trashed custom agents keep their memories in a Trash bubble you can restore from.
- **Usage at a glance.** A usage pill in the header shows how much of your Claude plan is left, with a popup that breaks the window down; the figures now come from the same source as the Claude app's own `/usage`, so they match what you see there.
- **QR pairing for Mobile Access.** Instead of typing an address and then a pairing code on your phone, scan a QR code shown on the PC — a three-minute ticket that pairs the device in one step. You can reissue or revoke it at any time.
- **Repeat a session on a loop.** Run the same session a set number of times in a row; the completion chime holds until the whole loop is finished instead of firing on every pass.
- **Stream density — Compact / Standard / Raw.** Choose how much of an agent's output you want to see. Consecutive tool calls collapse into a single *commands run* box with the tool names on it, finished thinking blocks are dropped entirely (thinking shows as one live line while it's happening), and every agent turn now leads with what it understood and intends to do, so you can stop it before it goes the wrong way.
- **Jump pills for cards you missed.** When a work-report, question, or review card scrolls past while you're reading elsewhere, a stack of pills appears to jump you back to it.
- **Low-power mode.** Suspends the always-on physics loop and the endless animations and blur effects to keep the machine cool during long sessions. It's a phone-side optimisation only — the desktop canvas is untouched, and activity signals keep flowing either way.
- **Confirmation before closing a busy tab.** Closing an IDE session tab while that session is still working now asks first.

### Changed
- **Stop means stop.** *Stop* now ends the open session **and** the subagents it spawned, and the IDE shows which background subagents are still running rather than leaving them invisible.
- **A trashed project stands on its own.** Projects in the Trash no longer depend on the original entry, and entering one shows the path it came from.
- **Question cards handle several questions at once.** Multi-question reports lay each question out separately with its own suggested replies.

### Fixed
- **It no longer gets slower the more you use it.** A full pass over the slowdown found two culprits and removed both: session transcripts were being re-read from disk in full on every snapshot, and `/api/tokens` kept one last whole-file reader alive on the Electron main process — which is also the server core, so the reads froze the UI. Frame drops with many parallel sessions were traced to double serialisation in the snapshot pipeline and fixed with a load-adaptive batch window, and off-screen bubbles are no longer drawn at all.
- **Deleting a worktree folder no longer resurrects it.** Autosave treated "the folder exists" as "this is a worktree" and kept recreating folders you had just removed; it now checks for a live git worktree instead.
- **Usage no longer freezes at an old number** after the window resets, and a 1 % figure is no longer drawn as 100 %.
- **Scanning the QR no longer drops you back at the pairing-code screen** (the session cookie's `SameSite` policy was too strict for a scanned link).
- **Custom agents stop claiming they're done.** A custom agent bubble flipped to *completed* at every turn boundary — edges cleaned up, chime played — while work was still queued. Completion is now decided by whether anything remains to be produced.
- **The Brain bubble no longer reads "0 cards"** when memories exist, and its summary is kept per project.
- **Reflection no longer spawns itself.** A background reflection run triggered the global hooks, which scheduled another reflection — an idle machine was starting a new session every five and a half minutes, chiming each time and littering the canvas with ghost projects. Both the entry point and the scheduler now refuse to run for a reflection's own working directory.
- **Preview satellites from a custom agent's server** no longer stay dark, and a reported preview URL is now paired with its server entry.
- **Broken projects are told apart from missing ones at boot** — a project whose metadata is damaged is retried, while an entry that was never a project is dropped, instead of both silently emptying the canvas.
- Right-clicking inside the IDE no longer also opens the canvas menu, and the image lightbox closes properly while the IDE is docked.

## [0.1.7] - 2026-07-08

### Added
- **Side-by-side diffs in the agent stream.** When an agent edits a file, the change now renders as a before/after diff — red for the old lines, green for the new — with the changed words within a line highlighted, right in the output. Brand-new files show as a *Created* card, and multi-edit changes stack each hunk in order.
- **Turn your feedback into an agent's rules, from its panel.** The agent section of the detail panel now tallies the like / dislike feedback you've left for that agent, and when there are dislikes it offers *Promote to rules*: a distilled set of proposed rule sentences you review and edit in a confirmation dialog before they're appended to that agent's Agent Rules. Nothing is applied automatically, and you can undo via Rules history. Per-session feedback counts are shown alongside the stream.
- **Performance profiler in the Debug panel.** *Profile now* collects a one-minute frame profile, and one is also captured automatically when the frame rate drops below the threshold (with a cooldown), attributing which scripts held frames the longest. The result is a copyable report you can share to diagnose a slowdown.
- **Reload without restarting.** New *Reload session* and *Reload project* actions refresh the current IDE session and the canvas project in place.
- **Fullscreen canvas and zoom reset.** The canvas controls gain a fullscreen toggle and a one-click zoom *Reset*.
- **Phone back button acts as Escape.** When you're viewing Vibisual from a phone, the browser's back gesture now closes the current overlay instead of leaving the app.

### Fixed
- **Projects and tasks survive a crash.** The project index (`app-state.json`) and each project's metadata (`project.json`) are now written atomically with rotating backups, and project metadata self-heals from the checkpoint or identity file (and their backups) when it's missing or truncated — the same protection the stream files already had. A crash mid-write no longer empties the canvas or drops projects on the next launch.
- **Crash causes are now saved to disk.** Fatal errors — uncaught exceptions, unhandled rejections, and renderer / GPU process deaths — are appended to a rotating crash log, and native crashes are captured as local minidumps under the app's data folder, so a crash in an installed build can be diagnosed after the fact instead of vanishing with the process. Nothing is uploaded.
- **No more orphaned processes on Windows.** When an agent stops, its whole process tree — including the node workers and MCP servers the CLI spawns — is now terminated together, instead of leaving grandchild "Claude Code" processes piling up in Task Manager across a long session.

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

[Unreleased]: https://github.com/Vibisual/vibisual/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/Vibisual/vibisual/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Vibisual/vibisual/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Vibisual/vibisual/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Vibisual/vibisual/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Vibisual/vibisual/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Vibisual/vibisual/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Vibisual/vibisual/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Vibisual/vibisual/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Vibisual/vibisual/compare/v0.1.0...v0.1.1
