# Privacy

**Vibisual collects nothing.** There is no account, no sign-in, no telemetry, no
analytics, and no crash-report upload. The app you install sends us nothing, and
there is no server of ours for it to send anything to. Should an optional
service ever be offered, it would be something you choose to turn on, and this
file would say so.

This document exists so you can verify that rather than take it on faith.

## What stays on your machine

- **Project data** — session transcripts, canvas layout, checkpoints,
  attachments, and verification artifacts live in a `.vibisual/` folder inside
  the project you opened.
- **App settings** — window state, the per-installation hook token, and updater
  bookkeeping live in the operating system's user-data directory for the app
  (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
  `~/.config` on Linux).
- **Crash diagnostics** — a local `crash.log` and, when the process dies hard,
  minidumps under the same user-data directory. These are written for you to
  read. There is no upload server configured, and none is planned.

Deleting those directories deletes the data. Nothing is mirrored anywhere.

## What leaves your machine, and when

None of it reaches us — we run no server for it to reach. What follows is every
outside address this code can contact. The first five happen while the app simply
runs, or through tools you were already using; the ones after that stay unused
until you switch on the feature that needs them.

**1. Update checks — to GitHub.** While the app runs it asks the GitHub Releases
API whether a newer version exists, on start and then every four hours. GitHub
sees what any web request shows: your IP address and user agent. On Windows and
Linux a new version downloads and installs when you quit; on macOS it only
notifies you, because installing in place requires a code signature we do not
have yet. There is no in-app switch for this today — block the app at your
firewall if you need it silent.

**2. Your prompts — to Anthropic, through the Claude CLI you installed.**
Vibisual does not talk to model APIs on your behalf and does not proxy or copy
your conversations. It launches the `claude` binary already on your machine as a
child process and reads what that process prints. Whatever Claude Code sends,
and whatever Anthropic retains, is governed by
[Anthropic's terms and privacy policy](https://www.anthropic.com/legal/privacy)
— not by this document. Vibisual never reads your Claude access token, and never
sends it anywhere. It does open that credentials file for two fields — the plan
type and the rate-limit tier — so the usage panel can name your plan instead of
showing a blank. It never writes to that file.

**3. The model list — to Anthropic, only if you already set an API key.** If the
environment variable `ANTHROPIC_API_KEY` is present, Vibisual calls
`GET https://api.anthropic.com/v1/models` so the model dropdown reflects what
your account can actually use, and caches the answer for 12 hours in
`~/.vibisual/model-registry.json`. If that variable is unset — the normal case
for subscription users — the call is skipped entirely and a built-in list is
used. The key is read from your environment and sent to Anthropic only, never
anywhere else.

**4. Whatever you point the app at.** Preview panes load the URLs your dev server
serves. Agents run the commands you approve, and those commands can reach the
internet. Optionally, Claude Code's own updater can be allowed to keep the CLI
current, which contacts its own distribution channel; you can turn that off in
Options.

**5. The Claude CLI's version number — to the npm registry.** So the app can tell
you when the `claude` on your machine is behind, it asks `registry.npmjs.org`
which version of `@anthropic-ai/claude-code` is newest and caches the answer for
five minutes. The request says nothing about you that any web request would not.

### Only if you switch it on

Everything below is off until you turn it on, and off again the moment you turn it
back off. They are listed separately because turning one on sends something to a
third party — neither Anthropic nor us.

- **Remote access (the phone/QR mode).** Off unless you start it, and exposing it
  beyond your LAN through UPnP is a second, separate action. When the router cannot
  report its own public address, the app asks `api.ipify.org`, `icanhazip.com`, or
  `ifconfig.me` for it, in that order until one answers. Those services see the
  request and nothing else. See [SECURITY.md](SECURITY.md) for how that surface is
  protected.

- **The messenger bridge (Discord or Telegram).** Connect a bot and the agent's
  activity goes to that messenger so you can follow it from your phone: stream
  output, questions it asks you, permission requests, and status cards — and the
  replies you send come back the same way. Discord or Telegram sees all of that,
  under their terms rather than this document, and how much of it depends on the
  verbosity you choose. The bot token stays on your machine.

- **Local models.** The local engine browses and downloads model files from
  `huggingface.co`, and downloads the llama.cpp runtime from GitHub. These are
  ordinary file transfers: what leaves is which file you asked for.

- **Web search from a local model.** When a local model calls its `WebSearch` tool,
  the search text goes to `api.firecrawl.dev`, which runs the search and returns
  the results. That is a third-party service, it works without a key, and the query
  is all it receives. A local model that never calls that tool never reaches it.

- **Search the web from the right-click menu.** Opens your own browser with the
  text you selected as the search words.

## What we know about you

Aggregate, public counters — nothing more. GitHub publishes how many times each
release file has been downloaded and how many people starred the repository, and
a scheduled workflow copies those public numbers into a CSV so the project has a
growth curve over time. That data is produced by GitHub's servers, contains no
identifiers, and would exist whether or not we recorded it. The application
itself reports nothing.

## Children

Vibisual is a developer tool and is not directed at children. Because it
collects no personal data at all, there is nothing for us to delete on request —
but if you believe otherwise, please open an issue.

## Changes

This file is versioned with the source. Material changes will be noted in
[CHANGELOG.md](CHANGELOG.md), and the commit history is the authoritative record
of what changed and when.
