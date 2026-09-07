# Privacy

**Vibisual collects nothing about what you do.** There is no account, no
sign-in, no telemetry, no analytics SDK inside the app, and no crash-report
upload. Your prompts, your code, your file paths, and your canvas never reach us.

At most one request can reach a server we run, and only one: **the update
check.** The app has to ask somewhere whether a newer version exists, and asking
is the whole of it — the request carries no identifier, no project data, and no
usage information. Whether it reaches us or goes straight to GitHub depends on
the build: the constant `UPDATE_FEED_URL` in `packages/shared/src/constants.ts`
names the address, and while it is empty — as it is in the build this file ships
with — the check goes to GitHub directly and **no request of any kind reaches
us.** Section 1 below describes both cases and what is kept in each.

Should any other optional service ever be offered, it would be something you
choose to turn on, and this file would say so.

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
- **Screen capture** — a capture bubble mirrors a screen or a window you picked
  onto the canvas. The picture is a live stream inside the app's own window; what
  gets written down is the bubble's position, size, and the name of the source you
  chose. No frame of it is stored by the app or sent anywhere. Saving a snapshot
  or a recording writes an ordinary file to your downloads folder. The one way a
  frame leaves is the way any file does — you attach it to an agent and send it,
  which is item 2 above. Attaching alone does not send it.

Deleting those directories deletes the data. Nothing is mirrored anywhere.

## What leaves your machine, and when

Apart from the update check described in item 1, none of it reaches us. What
follows is every outside address this code can contact. The first five happen
while the app simply runs, or through tools you were already using; the ones
after that stay unused until you switch on the feature that needs them.

**1. Update checks, and the update itself.** While the app runs it asks whether
a newer version exists, on start and then every four hours. The answer is a small
`latest.yml` (`latest-mac.yml`, `latest-linux.yml`) listing the newest version
and its SHA-512 digest.

*Where it asks* depends on `UPDATE_FEED_URL`, as described at the top of this
file. While that constant is empty the question goes to GitHub and nothing
reaches us. When it names our update proxy, the question goes there instead and
the proxy answers with the same file — it forwards the installer download itself
back to GitHub with a redirect, so the bytes you install never pass through us.
If the proxy does not answer, the app falls back to GitHub on its own.

*What our proxy keeps, if the build uses one.* We want one number: roughly how
many installations are running. The request already carries an IP address and a
user agent, as every web request does. We do not store either. They are combined
with a secret and **that day's date**, hashed with SHA-256, and only the first
sixteen hex characters are written down — because the date is part of the input,
the same machine hashes to an unrelated value tomorrow, so yesterday's records
cannot be linked to today's. Each record holds that hash, the date, and which of
the three platforms asked. It expires automatically after 35 days. There are no
cookies, no device identifiers, and no query strings; the aggregate is published
at `/stats` and contains only dates and counts. The source is
[`infra/update-proxy/src/worker.js`](infra/update-proxy/src/worker.js) — about
two hundred lines, and this paragraph is a description of it rather than a
promise about it. Our lawful basis is legitimate interest in delivering updates
and in knowing the size of the installed base; Cloudflare operates the edge that
runs this code and acts as our processor. Because nothing we store can be traced
back to a person — that is the point of the rotating salt — we cannot look up,
export, or delete an individual's records, and neither can anyone else.

When a newer version does exist, the app downloads it from GitHub — always from
GitHub, whichever host answered the question above — and how it is applied
depends on your platform. On Windows and Linux the
downloaded installer runs when you quit. On macOS the app fetches the release
asset itself, checks it against the SHA-256 digest GitHub publishes for that
asset, confirms the binary matches your processor architecture, and swaps the
installed bundle after you press install and the app closes — Apple's updater
refuses an unsigned build outright, so that path is ours rather than theirs, and
the digest check is what stands in for the signature we do not have yet. If any
of it fails, the app opens the release page instead of retrying silently. There
is no in-app switch for update checking today — block the app at your firewall
if you need it silent.

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
internet.

**5. The Claude CLI's version — to the npm registry, and an upgrade unless you
turn it off.** The app asks `registry.npmjs.org` which version of
`@anthropic-ai/claude-code` is newest and caches the answer for five minutes. The
request says nothing about you that any web request would not. If the `claude` on
your machine turns out to be behind, the app then installs the newer one — once
per launch, and **on unless you turn it off in Options**. It upgrades only a CLI
you installed yourself through npm or Anthropic's native installer: a Claude Code
that came from the VS Code extension is left alone, because it cannot be updated
from outside the marketplace, and a machine without the CLI is a setup question
rather than an upgrade one.

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

## The website

[vibisual.pro](https://vibisual.pro) is a static page served by GitHub Pages. It
sets no cookies and asks for no consent banner because it has nothing to consent
to. It also makes **no third-party requests at all** — the web fonts and the
React runtime are served by the site itself rather than from a CDN, precisely so
that loading the page does not hand your address to anyone we did not choose.

For the same reason there is no Google Analytics, no Plausible, and no Cloudflare
beacon on it. Counting visits, when it is switched on, goes to the same update
proxy described in item 1 and sends exactly one value: `view`, or `download` when
you click a link to a release file. No path, no referrer, no cookie, no device
identifier. It is stored the same way as the update check — a hash of that day's
salt, expiring after 35 days — and the script is disabled until the proxy address
is filled in, at which point it becomes visible in the page source.

GitHub Pages keeps its own server logs as the host, under
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).
The numbers on the page (stars, release version, download counts) are read from
a `stats.json` file we publish, not from your browser calling anyone.

## What we know about you

Aggregate counters — nothing more, and nothing that names a person.

- **Public GitHub counters.** How many times each release file was downloaded
  and how many people starred the repository. That data is produced by GitHub's
  servers and would exist whether or not we recorded it. A scheduled workflow
  copies it into a CSV so the project has a growth curve over time.
  Until 2026-09-07 those download counts were mostly our own CI fetching
  installers to test them; that fetch now goes through a private build artifact
  instead, so the figure counts people rather than robots.
- **Update-check counts**, if the build points at our proxy — the daily,
  de-duplicated total described in item 1, broken down by platform and nothing
  else.
- **Page views** on the website, as described just above.

The application itself reports nothing. There is no path by which a prompt, a
file name, a project path, or anything you typed reaches us.

## Children

Vibisual is a developer tool and is not directed at children. The only data we
hold that has any connection to an individual machine is the salted daily hash
described in item 1, and it is designed so that it cannot be tied back to a
person or a device — which also means we cannot find and delete a particular
one on request. Everything else stays on your computer, where deleting it is
yours to do. If you believe otherwise, please open an issue.

## Changes

This file is versioned with the source. Material changes will be noted in
[CHANGELOG.md](CHANGELOG.md), and the commit history is the authoritative record
of what changed and when.
