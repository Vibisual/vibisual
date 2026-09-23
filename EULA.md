# Vibisual End User License Agreement

**Version 1.0 — effective 2026-09-22**

This Agreement covers the **installer builds and prebuilt binaries that the
Vibisual project distributes** on or after the date above — for example
`Vibisual-<version>-setup.exe`, the macOS `.dmg`, and the Linux `.deb` /
`.AppImage` / `.rpm` published on GitHub Releases. It does **not** cover the
source code, which is licensed separately under the Apache License 2.0, and it
does not apply to builds released before this date.

By installing or using a distributed Vibisual build, you agree to this
Agreement. If you do not agree, do not install it.

## 1. Who owns this build, and who distributes it

Vibisual is owned by 길근오 ("we", "us"), the sole copyright holder.
Copyright 2026 길근오. Official builds are distributed by us through GitHub
Releases and the project website. All rights not expressly granted here are
reserved.

## 2. What you may do

We grant you a free, worldwide, non-exclusive license, ending only as described
in section 12, to install and run this build:

- on as many devices as you like;
- for any purpose, personal or commercial, including inside a company;
- with no account, no license key, and no usage limit.

You may also:

- deploy this build, unmodified, to devices within your own organization,
  including through an internal software portal or device-management tool;
- publish package-manager manifests (for example winget, Scoop, Homebrew, or
  similar) that download this build from our official release URLs, without
  rehosting or modifying it.

You owe us nothing for this. There is no paid tier of this build.

## 3. What you may not do with this build

Except as section 2 allows, you may not:

- redistribute, sell, rent, sublicense, host for public download, or bundle
  this build, or any modified form of it;
- repackage it, or strip or alter its name, icon, notices, or signatures;
- present it as your own product, or as endorsed by or affiliated with us.

You may not decompile, disassemble, or reverse engineer this build, except:

- where that right cannot be excluded by law — in particular the
  interoperability right under Article 6 of Directive 2009/24/EC in the EU, and
  equivalent rights elsewhere; and
- as permitted by the license of any third-party component included in this
  build (see section 5), whose terms prevail over this section for that
  component.

Configuring the application through its own settings, or through any method we
document, is always permitted.

These restrictions apply to **this build**. They place no conditions on what
you do with the source code — see section 4.

## 4. The source is open, and you may build your own

The source code for each released version is published under the Apache License
2.0 at https://github.com/Vibisual/vibisual. Under that license you may read,
modify, and redistribute the source, and you may compile and distribute your
own builds from it. Nothing in this Agreement takes that away or adds
conditions to it.

A build you compile and distribute yourself is yours, not ours. Give it a
different name and branding as `TRADEMARK.md` describes, and do not present it
as Vibisual.

## 5. Third-party components and tools

This build includes third-party open-source components, each under its own
license. Those licenses govern those components. If anything in this Agreement
conflicts with a third-party component's license, that license prevails for
that component. Their license texts ship inside the installed application; our
own license and notice are at `resources/LICENSE` and `resources/NOTICE`.

Vibisual also drives third-party tools that you install and authorize yourself,
such as the Claude Code CLI. Your use of those tools, and of any AI service
behind them, is governed by their own terms and privacy policies — not by this
Agreement. We are not a party to that relationship. Vibisual is an independent
project and is not affiliated with, endorsed by, or sponsored by Anthropic.

## 6. Name and logo

"Vibisual" and the Vibisual logo are trademarks of 길근오. This Agreement
grants no rights in them. Permitted and prohibited uses are set out in
`TRADEMARK.md`, which applies here in full.

## 7. Updates

This build checks for new versions while it runs and updates itself
automatically. On Windows and Linux it downloads a new version as soon as it
finds one and applies it when you close the application. On macOS, because
these builds are not code-signed, the application downloads and replaces its
own bundle instead.

**There is currently no setting that turns this off.** The auto-update toggle
you may find in the application's settings controls updates to the Claude Code
CLI, which is a separate program, not to Vibisual itself. If you do not want
automatic updates, build from source (section 4) or block the application's
network access. `PRIVACY.md` lists every address this build contacts, and when.

## 8. What the software does on your machine — and your responsibility

**Hook installation.** On first launch, Vibisual adds a managed hook block to
your Claude Code settings file (`~/.claude/settings.json`) so that Claude Code
sessions can stream into the application. If that file already exists, a
timestamped backup is written beside it (`settings.json.bak-vibisual-*`); a
limited number of backups is kept and older ones are removed. You can prevent
this step entirely by setting `VIBISUAL_SKIP_HOOK_INSTALL=1` before first
launch. Hook data — prompts, tool calls, file paths, shell commands, and other
local development context — is recorded on your own machine; `PRIVACY.md`
describes where it is kept and what, if anything, leaves.

**AI agents.** Vibisual runs AI coding agents that **read and write files, and
execute commands, on your computer**, under the permissions you grant them.
Agents can be misconfigured, and AI output can be wrong. You are responsible
for:

- what you point Vibisual at, and which permissions you grant;
- keeping backups and using version control before letting an agent modify
  anything you cannot afford to lose;
- reviewing what an agent did before you rely on it, ship it, or commit it.

We do not control, review, or endorse what an agent produces or executes.

## 9. No warranty

Vibisual is an early preview. Expect bugs, incomplete features, and breaking
changes. We do not recommend it for critical production workflows or for
repositories containing highly sensitive data.

This build is provided **"as is", without warranty of any kind**, express or
implied, including any implied warranty of merchantability, fitness for a
particular purpose, accuracy, or non-infringement. We do not warrant that it
will be uninterrupted, error-free, or free of data loss.

Some builds are not code-signed; your operating system may warn you
accordingly. Installing anyway is your decision.

## 10. Limitation of liability

To the maximum extent permitted by law, we are not liable for any indirect,
incidental, special, consequential, or punitive damages, nor for lost profits,
lost data, lost work, or business interruption, arising from or relating to
this build — even if we were told such damages were possible. Because this
build is supplied free of charge, our total liability for any other claim
relating to it is limited to zero.

This section does not limit liability for our intentional misconduct or gross
negligence, or any other liability that cannot be limited under applicable law.

## 11. Your statutory rights remain

You keep every right that applicable law gives you and that cannot be waived by
agreement, whether you are a consumer or a business. Sections 9 and 10 apply
only so far as that law allows. If any provision of this Agreement is held
unenforceable, the rest remains in effect.

## 12. Termination

This license ends automatically if you breach section 3 or section 6, and it
ends when you uninstall the build. Uninstalling is the only thing we ask of you
when it ends. Sections 5, 6, 9, 10, 11, and 13 survive termination.

## 13. Governing law

This Agreement is governed by the laws of the Republic of Korea, without regard
to its conflict-of-laws rules, and the Seoul Central District Court has
jurisdiction as the court of first instance — except that if you are a
consumer, you may also rely on the mandatory consumer-protection law and the
courts of your country of residence.

## 14. Changes

We may publish a new version of this Agreement for future builds. The version
that applies to a build is the one shipped with it. Changes are never
retroactive.

## 15. Contact

Questions about this Agreement, or trademark licensing inquiries: open an issue
at https://github.com/Vibisual/vibisual/issues.
