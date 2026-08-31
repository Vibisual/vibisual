# Security Policy

Vibisual runs coding agents on your machine, with your files and your shell. The
security model deserves to be stated plainly rather than left implied.

## Reporting a vulnerability

Open the **Security** tab of this repository and choose **Report a
vulnerability**. That channel stays private until a fix ships and it reaches the
maintainer directly. Please do not open a public issue for anything exploitable.

Vibisual is maintained by one person, so set your expectations accordingly: you
should get a first reply within about a week, and fixes ride the next release
rather than a fixed schedule. If something needs longer, the report thread is
where you will hear about it.

## Supported versions

Only the latest release gets fixes. Vibisual is a `0.1.x` preview with no
maintained branches behind it — please update before reporting.

## How the app is built to behave

These describe the current design. They are facts about the code you can check,
not guarantees about future versions.

- **The local server listens on loopback only.** The API and WebSocket surface
  binds to `127.0.0.1`. External processes — including the Claude Code hooks —
  reach it through a narrow allow-listed hook endpoint that requires a
  per-installation token, kept in the app's user-data directory.

- **Hooks run with your account's permissions.** Vibisual installs Claude Code
  hooks to observe agent activity, and hook commands execute as you. Review the
  generated hook configuration before using Vibisual in a repository that holds
  credentials, customer data, or production access.

- **Remote access is off until you turn it on, twice.** The phone/QR mode is a
  separate action in the app: enabling it binds a server to your LAN, and
  opening it to the internet through your router's UPnP is a *second*, distinct
  action. External exposure is served over TLS with a generated self-signed
  certificate, pairing is required, `Host` headers are checked against IP
  literals to block DNS rebinding, and UPnP mappings are leased rather than
  permanent. Neither step happens on its own.

- **macOS builds are not code-signed yet.** Gatekeeper blocks the first launch
  and the README documents the `xattr -cr` workaround. Apple's updater refuses
  an unsigned build outright, so macOS updates run on a path of our own: the app
  downloads the release asset, verifies it against the SHA-256 digest GitHub
  publishes for that asset, checks that the binary's architecture matches the
  machine, and replaces the bundle only after you press install. That digest is
  doing the job a signature would — it catches a download that was corrupted or
  tampered with in transit, but not a release that was replaced at the source.
  Treat an unsigned build as a build whose origin you are trusting on the
  strength of the download URL alone.

- **Nothing is uploaded to us.** There is no telemetry, no analytics, and no
  crash-report server — crash minidumps are collected locally and never sent
  (`uploadToServer: false`). See [PRIVACY.md](PRIVACY.md) for what does leave
  your machine and when.

## In scope

- Anything that lets a website, a LAN neighbour, or a remote attacker reach the
  loopback API, the hook endpoint, or the mobile access server without pairing.
- Token or credential disclosure through app state, logs, or the mobile surface.
- Code execution that the user did not initiate — for example a crafted repo,
  filename, or agent output that runs commands on open.
- Path traversal or file access outside the directories the user opened.

## Out of scope

- Claude Code itself, the Claude CLI, and Anthropic's services. Report those to
  Anthropic.
- Vulnerabilities that require an attacker to already have local code execution
  as your user account.
- The fact that agents can run shell commands. That is the product; the guard is
  Claude Code's permission mode, which Vibisual surfaces rather than replaces.
- Missing code signing on macOS. It is a known gap, tracked in the README.

## Disclosure

Once a fix ships, the advisory is published with credit to the reporter unless
you ask otherwise. There is no bug bounty — Vibisual is free software maintained
by one person.
