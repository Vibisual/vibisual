#!/usr/bin/env node
// 배포 채널(winget · Homebrew Cask · Flathub) 매니페스트를 한 릴리스에서 만든다.
//
// ## 왜 스크립트인가
//
// 세 채널 모두 매니페스트에 **파일마다의 sha256** 을 적어야 한다. 손으로 하면 판올림마다
// 여섯 개의 해시를 옮겨 적어야 하고, 한 번 틀리면 그 채널의 설치가 "손상된 파일"로 죽는다.
// 실제로 이런 일은 문서에 적어 두면 지켜지지 않는다 — 그래서 실행되는 것으로 만든다.
//
// ## 해시를 어디서 가져오나 — 설치본을 다시 받지 않는다
//
// 릴리스 잡이 지은 직후에 계산해 `SHA256SUMS.txt` 로 발행해 둔다. 그 파일만 읽으므로
// 이 스크립트는 180MB 짜리 설치본을 한 번도 내려받지 않는다. 그게 중요한 이유는,
// 릴리스 자산 다운로드 수가 우리가 밖에 내보이는 유일한 채택 지표이기 때문이다 —
// 자동화가 그 숫자를 채우기 시작하면 지표는 다시 의미를 잃는다(2026-09-07 에 정확히
// 그 상태에서 빠져나왔다: 설치본 다운로드 134회 중 사실상 전부가 우리 CI 였다).
//
// 사용법:
//   node .github/scripts/build-packaging-manifests.mjs v0.1.23 [--out packaging/generated]
// 환경:
//   GH_TOKEN (선택 — 없으면 공개 릴리스만 보인다)

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OWNER = 'Vibisual';
const REPO = 'vibisual';
const HOMEPAGE = 'https://vibisual.pro';
const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
const PUBLISHER = 'Vibisual';
const SHORT_DESC = 'Visual development environment for AI coding agents';

const args = process.argv.slice(2);
const rawTag = args.find((a) => !a.startsWith('-'));
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'packaging/generated';

if (!rawTag) {
  console.error('사용법: node build-packaging-manifests.mjs <태그> [--out <디렉터리>]');
  process.exit(2);
}
const tag = rawTag.startsWith('v') ? rawTag : `v${rawTag}`;
const version = tag.slice(1);

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'vibisual-packaging' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * `SHA256SUMS.txt` 를 읽어 `{파일이름: 해시}` 로 만든다.
 *
 * 로컬 경로를 주면 그것을 읽고(릴리스 잡 안에서 쓰는 길), 아니면 릴리스에서 받는다.
 * 이 파일은 몇 KB 짜리 텍스트라 설치 수 집계(`classify()` 가 `.txt` 를 `null` 로 버린다)에
 * 잡히지 않는다 — 그래서 자동화가 이걸 몇 번을 읽어도 지표가 흔들리지 않는다.
 */
async function loadChecksums() {
  const local = args.indexOf('--sums');
  // 로컬 모드는 릴리스를 안 보므로 자산 크기를 알 수 없다 — flatpak 의 `size` 는 0 으로 남고,
  // 아래 flathub() 가 그 자리에 손으로 채우라는 표식을 남긴다.
  if (local >= 0) return { sums: parseSums(readFileSync(args[local + 1], 'utf8')), sizes: {} };

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`릴리스 목록 조회 실패: HTTP ${res.status}`);
  const releases = await res.json();
  const rel = releases.find((r) => r.tag_name === tag || r.name === version);
  if (!rel) throw new Error(`${tag} 릴리스를 못 찾았다`);
  const asset = (rel.assets ?? []).find((a) => a.name === 'SHA256SUMS.txt');
  if (!asset) {
    throw new Error(
      `${tag} 에 SHA256SUMS.txt 가 없다 — 이 자산이 생긴 판올림부터 쓸 수 있다.` +
        ' 없는 값을 지어내느니 여기서 멈춘다.',
    );
  }
  const body = await fetch(asset.url, {
    headers: { ...ghHeaders(), Accept: 'application/octet-stream' },
  });
  if (!body.ok) throw new Error(`SHA256SUMS.txt 내려받기 실패: HTTP ${body.status}`);
  // 크기는 API 응답에 이미 들어 있다 — 파일을 받아 재지 않는다.
  const sizes = Object.fromEntries((rel.assets ?? []).map((a) => [a.name, a.size]));
  return { sums: parseSums(await body.text()), sizes };
}

function parseSums(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) map[m[2]] = m[1].toLowerCase();
  }
  return map;
}

/** 없는 해시로 매니페스트를 쓰면 그 채널의 설치가 "손상된 파일"로 죽는다 — 여기서 끊는다. */
function need(sums, name) {
  const hash = sums[name];
  if (!hash) throw new Error(`${name} 의 sha256 이 SHA256SUMS.txt 에 없다`);
  return hash;
}

const dl = (name) => `${REPO_URL}/releases/download/${tag}/${name}`;

// ── winget ────────────────────────────────────────────────────────────────────
// 스키마 1.6.0. 세 파일이 한 벌이고, `microsoft/winget-pkgs` 의
// `manifests/v/Vibisual/Vibisual/<버전>/` 에 그대로 들어간다.
function winget(sums) {
  const exe = `Vibisual-${version}-setup.exe`;
  const id = 'Vibisual.Vibisual';
  const files = {};

  files[`${id}.yaml`] = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`;

  files[`${id}.installer.yaml`] = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
# electron-builder 의 nsis 설정이 oneClick: true · perMachine: false 라 사용자 범위 무인 설치다
# (관리자 권한을 묻지 않는다). 이 두 줄과 그 설정은 한 벌이므로 한쪽만 바꾸지 마라.
Scope: user
InstallModes:
  - silent
  - silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${dl(exe)}
    InstallerSha256: ${need(sums, exe)}
ManifestType: installer
ManifestVersion: 1.6.0
`;

  files[`${id}.locale.en-US.yaml`] = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${PUBLISHER}
PublisherUrl: ${HOMEPAGE}
PublisherSupportUrl: ${REPO_URL}/issues
PackageName: Vibisual
PackageUrl: ${HOMEPAGE}
License: Apache-2.0
LicenseUrl: ${REPO_URL}/blob/main/LICENSE
ShortDescription: ${SHORT_DESC}
Description: >-
  Vibisual is a visual development environment for AI coding agents. It captures what an
  agent is doing as it happens and draws it as a map you glance at instead of scrolling
  through: the files it touched, the commands it ran, the preview it started. You still
  write in an editor pane; what changes is everything around it.
Moniker: vibisual
Tags:
  - ai
  - developer-tools
  - ide
ReleaseNotesUrl: ${REPO_URL}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`;
  return files;
}

// ── Homebrew Cask ─────────────────────────────────────────────────────────────
// ⚠️ 이 파일은 **우리 tap**(`Vibisual/homebrew-tap`) 용이다. 공식 `homebrew-cask` 는
//    notability 요건(별 75 · 포크 30 · 워처 30 중 하나)을 요구하고 우리는 아직 못 넘는다.
//    자기 tap 에는 그 요건이 없고, 넘긴 뒤 같은 파일을 그대로 올리면 된다.
function homebrew(sums) {
  const arm = `Vibisual-${version}-arm64.dmg`;
  const intel = `Vibisual-${version}.dmg`;
  return {
    'vibisual.rb': `cask "vibisual" do
  arch arm: "-arm64", intel: ""

  version "${version}"
  sha256 arm:   "${need(sums, arm)}",
         intel: "${need(sums, intel)}"

  url "${REPO_URL}/releases/download/v#{version}/Vibisual-#{version}#{arch}.dmg",
      verified: "github.com/${OWNER}/${REPO}/"
  name "Vibisual"
  desc "${SHORT_DESC}"
  homepage "${HOMEPAGE}"

  # 상류 판올림은 GitHub 릴리스가 정본이다.
  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Vibisual.app"

  # ⚠️ 아직 Developer ID 서명이 없다. Homebrew 는 받은 파일에 격리 속성을 붙이므로
  #    첫 실행에서 Gatekeeper 가 막는다. \`--no-quarantine\` 로 설치하면 넘어가지만,
  #    그건 사용자가 선택할 일이지 우리가 캐스크에서 끌 수 있는 것이 아니다.
  #    서명이 붙으면 이 주석과 함께 사라질 문제다.

  zap trash: [
    "~/Library/Application Support/Vibisual",
    "~/Library/Logs/Vibisual",
    "~/Library/Preferences/com.vibisual.app.plist",
    "~/Library/Saved Application State/com.vibisual.app.savedState",
  ]
end
`,
  };
}

// ── Flathub ───────────────────────────────────────────────────────────────────
// 이미 지어 둔 deb 를 `extra-data` 로 받아 푸는 방식(Electron 앱의 통상 경로다 —
// 소스 빌드는 flatpak 안에서 electron 을 다시 짓는 일이라 현실적이지 않다).
function flathub(sums, sizes) {
  const deb = `vibisual_${version}_amd64.deb`;
  const id = 'pro.vibisual.Vibisual';
  return {
    [`${id}.yml`]: `# Flathub 제출용. app-id 는 우리가 가진 도메인(vibisual.pro)의 역순이다 —
# electron-builder 의 appId(com.vibisual.app)와는 별개 축이고, 둘 다 그대로 둔다.
app-id: ${id}
runtime: org.freedesktop.Platform
runtime-version: '24.08'
sdk: org.freedesktop.Sdk
base: org.electronjs.Electron2.BaseApp
base-version: '24.08'
command: vibisual
separate-locales: false

finish-args:
  - --share=ipc
  - --socket=x11
  - --socket=wayland
  - --socket=pulseaudio
  - --share=network
  - --device=dri
  # 에이전트가 사용자의 프로젝트 폴더를 읽고 쓴다 — 그게 이 앱이 하는 일이다.
  - --filesystem=home
  # 사용자가 설치해 둔 claude/codex 실행본을 자식 프로세스로 띄운다.
  - --talk-name=org.freedesktop.Flatpak

modules:
  - name: vibisual
    buildsystem: simple
    build-commands:
      - ar x vibisual.deb
      - tar -xf data.tar.*
      - mkdir -p /app/main
      - cp -a opt/Vibisual/* /app/main/
      - install -Dm755 vibisual.sh /app/bin/vibisual
      - install -Dm644 usr/share/applications/vibisual.desktop /app/share/applications/${id}.desktop
      - desktop-file-edit --set-key=Exec --set-value=vibisual /app/share/applications/${id}.desktop
      - install -Dm644 usr/share/icons/hicolor/256x256/apps/vibisual.png
          /app/share/icons/hicolor/256x256/apps/${id}.png
      - install -Dm644 ${id}.metainfo.xml /app/share/metainfo/${id}.metainfo.xml
    sources:
      - type: file
        path: vibisual.sh
      - type: file
        path: ${id}.metainfo.xml
      - type: extra-data
        filename: vibisual.deb
        url: ${dl(deb)}
        sha256: ${need(sums, deb)}
        size: ${sizes[deb] ?? 0}${sizes[deb] ? '' : '   # ⚠️ 0 이면 제출 전에 실제 바이트 수로 채워라 (로컬 모드로 지었다)'}
`,
    'vibisual.sh': `#!/bin/sh
# zypak 이 Electron 의 샌드박스를 flatpak 안에서 돌게 한다(BaseApp 이 제공).
exec zypak-wrapper /app/main/vibisual "$@"
`,
    // AppStream 메타데이터. Flathub 는 이게 없으면 받지 않고, 소프트웨어 센터의 이름·설명·
    // 스크린샷이 전부 여기서 온다. 판올림 줄은 릴리스마다 갱신된다.
    [`${id}.metainfo.xml`]: `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${id}</id>
  <name>Vibisual</name>
  <summary>${SHORT_DESC}</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>Apache-2.0</project_license>
  <developer id="pro.vibisual">
    <name>${PUBLISHER}</name>
  </developer>
  <description>
    <p>
      Vibisual is a visual development environment for AI coding agents. It captures what an
      agent is doing as it happens and draws it as a map you glance at instead of scrolling
      through: the files it touched, the commands it ran, the preview it started.
    </p>
    <p>
      You still write in an editor pane; what changes is everything around it. One window
      instead of six.
    </p>
  </description>
  <launchable type="desktop-id">${id}.desktop</launchable>
  <url type="homepage">${HOMEPAGE}</url>
  <url type="bugtracker">${REPO_URL}/issues</url>
  <url type="vcs-browser">${REPO_URL}</url>
  <screenshots>
    <screenshot type="default">
      <image>${HOMEPAGE}/og.png</image>
      <caption>A run drawn as a map</caption>
    </screenshot>
  </screenshots>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="${version}" date="${new Date().toISOString().slice(0, 10)}">
      <url type="details">${REPO_URL}/releases/tag/${tag}</url>
    </release>
  </releases>
</component>
`,
  };
}

// ── 실행 ──────────────────────────────────────────────────────────────────────
const { sums, sizes } = await loadChecksums();

const groups = {
  [path.join(OUT, 'winget', version)]: winget(sums),
  [path.join(OUT, 'homebrew', 'Casks')]: homebrew(sums),
  [path.join(OUT, 'flathub')]: flathub(sums, sizes),
};

let written = 0;
for (const [dir, files] of Object.entries(groups)) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body, 'utf8');
    console.log(`  ${path.join(dir, name)}`);
    written += 1;
  }
}
console.log(`=> ${tag} 매니페스트 ${written}개 생성 (설치본은 한 번도 내려받지 않았다).`);
