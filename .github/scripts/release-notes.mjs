#!/usr/bin/env node
/**
 * release-notes.mjs — 릴리스 페이지 본문(다운로드 안내)을 자산 목록에서 생성한다.
 *
 * SCENARIO.md §4 v2.44 자동 업데이트 릴리스 자동화의 마지막 한 칸.
 *
 * ⚠️ 왜 필요한가 — electron-builder 의 `--publish always` 는 자산만 올리고 **본문을 쓰지 않는다.**
 *    v0.1.14 의 릴리스 본문은 실제로 비어 있었고(GitHub API `body: null`), 제목은 `0.1.14`
 *    한 줄이었다. 그래서 처음 온 사람이 보는 것은 이름순으로 흩어진 파일 14개가 전부다:
 *
 *      Vibisual-0.1.14-arm64-mac.zip        ← 받으면 안 되는 것(업데이터 전용)
 *      Vibisual-0.1.14-arm64.dmg            ← Apple Silicon. 이름만 보고는 모른다
 *      Vibisual-0.1.14.dmg                  ← Intel. 접미사가 **없는 쪽**이 Intel 이다
 *      Vibisual-0.1.14-setup.exe.blockmap   ← 순수 잡음
 *      latest-mac.yml …
 *
 *    "내 것"을 고르는 데 필요한 지식(arm64=Apple Silicon, 무접미사=Intel, zip/blockmap/yml 은
 *    받는 게 아님)이 파일 이름 어디에도 없다. 자산 목록의 정렬·표시는 GitHub 이 정하므로
 *    우리가 손댈 수 있는 자리는 **본문**뿐이고, 본문은 자산 목록보다 위에 그려진다.
 *
 * ⚠️ 표는 **실제로 발행된 자산에서** 만든다 — 이름을 미리 적어 두지 않는다. release.yml 은
 *    `fail-fast: false` 라 한 OS 가 넘어져도 나머지가 발행되는데(v0.1.12 가 Intel dmg 없이
 *    나갔다), 하드코딩한 표는 그때 **없는 파일로 가는 죽은 링크**를 그린다. 있는 것만 그리면
 *    표가 곧 발행 현황이 된다.
 *
 * 사용법:
 *   node .github/scripts/release-notes.mjs                  # desktop package.json 버전으로 렌더 → stdout
 *   node .github/scripts/release-notes.mjs 0.1.14           # 그 버전으로 렌더 → stdout
 *   node .github/scripts/release-notes.mjs 0.1.14 --apply   # 렌더 + 릴리스 제목·본문 갱신(GH_TOKEN 필요)
 *   node .github/scripts/release-notes.mjs --selftest       # 분류 규칙 자체 점검(네트워크 없이)
 *
 * ⚠️ 왜 scripts/ 가 아니라 .github/scripts/ 인가 — `/scripts/*.mjs` 는 `.gitignore` + pre-commit
 *    훅으로 **공개 저장소에 나가지 않는** 개인 개발 스크립트 자리다. 이 파일은 GitHub
 *    Actions 러너가 체크아웃해서 실행하므로 반드시 추적되어야 한다 — 저기 두면 커밋
 *    자체가 막히고 CI 는 파일을 못 찾는다. 옮기지 마라.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER = 'Vibisual';
const REPO = 'vibisual';

// ── 자산 분류 ────────────────────────────────────────────────────────────────
// `label` 은 **한 운영체제 안에서 갈래를 고르는 말**이다. 운영체제 이름은 여기 넣지 않는다 —
// 그건 아래 OS_ROWS 가 붙인다.
//
// ⚠️ `match` 는 **위에서부터 처음 맞는 것**이 이긴다. `arm64.dmg` 가 `.dmg` 보다 먼저
//    와야 한다 — 순서를 바꾸면 Apple Silicon dmg 가 Intel 줄에 실린다.
const KINDS = [
  {
    id: 'win',
    match: (n) => /-setup\.exe$/i.test(n),
    label: null, // 갈래가 하나뿐 — 고를 것이 없으면 고르라는 말도 없어야 한다.
  },
  {
    id: 'mac-arm64',
    match: (n) => /arm64\.dmg$/i.test(n),
    label: 'Apple Silicon (M1 and later)',
  },
  {
    id: 'mac-x64',
    match: (n) => /\.dmg$/i.test(n),
    label: 'Intel',
  },
  {
    id: 'linux-deb',
    match: (n) => /\.deb$/i.test(n),
    label: 'Debian, Ubuntu, Mint',
  },
  {
    id: 'linux-rpm',
    match: (n) => /\.rpm$/i.test(n),
    label: 'Fedora, RHEL, openSUSE',
  },
  {
    id: 'linux-appimage',
    match: (n) => /\.AppImage$/i.test(n),
    label: 'Arch, NixOS, anything else',
  },
];

/**
 * 표는 **운영체제 한 줄**이다 — 윈도우 · 맥 · 리눅스, 셋.
 *
 * 갈래(맥 2 · 리눅스 3)를 저마다 한 줄로 펴면 표가 여섯 줄이 되는데, 그러면 처음 온 사람이
 * 자기 줄을 찾기 전에 **리눅스 세 줄부터 읽어야 한다** — 리눅스를 안 쓰는 사람에게는 그
 * 세 줄이 전부 잡음이고, 정작 "내 OS 는 어디"라는 물음의 답은 뒤로 밀린다. 운영체제로
 * 먼저 좁히고 갈래는 그 칸 안에서 고르게 한다.
 *
 * 자산이 하나도 없는 운영체제는 **줄 자체가 빠진다**(없는 파일로 가는 죽은 링크 ❌).
 * 표에 줄이 셋보다 적으면 그 OS 잡이 실패한 것이다 — v0.1.15 가 그랬다(맥 줄 없음).
 */
const OS_ROWS = [
  // Windows 를 맨 위에 두는 것은 취향이 아니라 다운로드 분포다(설치 사용자의 다수가 Windows).
  { os: '**Windows** 10 / 11 · 64-bit', kinds: ['win'] },
  { os: '**macOS**', kinds: ['mac-arm64', 'mac-x64'] },
  { os: '**Linux**', kinds: ['linux-deb', 'linux-rpm', 'linux-appimage'] },
];

/** 자산 이름 → 종류 id. 설치 파일이 아니면 null(= 업데이터 전용). */
export function classifyAsset(name) {
  for (const kind of KINDS) if (kind.match(name)) return kind.id;
  return null;
}

/** 바이트 → "151 MB". 소수점은 버린다 — 여기서 정밀도는 아무 값도 하지 않는다. */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * 자산 배열 → { installers: Map<kindId, asset>, extras: asset[] }.
 * 같은 종류가 둘 이상이면 먼저 온 것을 쓴다(정상 릴리스에서는 일어나지 않는다).
 */
export function groupAssets(assets) {
  const installers = new Map();
  const extras = [];
  for (const asset of assets) {
    const kind = classifyAsset(asset.name);
    if (kind && !installers.has(kind)) installers.set(kind, asset);
    else if (kind) extras.push(asset);
    else extras.push(asset);
  }
  return { installers, extras };
}

// ── CHANGELOG 발췌 ───────────────────────────────────────────────────────────
/** CHANGELOG.md 에서 `## [<version>]` 섹션 본문만 떼어 온다. 없으면 null. */
export function extractChangelog(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const head = new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`);
  const start = lines.findIndex((l) => head.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s*\[/.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body || null;
}

// ── 본문 렌더 ────────────────────────────────────────────────────────────────
/**
 * @param {{ version: string, assets: Array<{name:string,size:number,browser_download_url:string}>, changelog?: string|null }} input
 * @returns {string} 릴리스 본문 마크다운
 */
export function renderNotes({ version, assets, changelog }) {
  const { installers, extras } = groupAssets(assets);
  const out = [];

  out.push('## Download');
  out.push('');

  if (installers.size === 0) {
    // 빌드가 전부 넘어진 릴리스. 없는 파일로 가는 표를 그리느니 사실을 적는다.
    out.push('> No installer was published for this release. See the');
    out.push('> [previous releases](https://github.com/Vibisual/vibisual/releases) instead.');
    out.push('');
  } else {
    out.push('Find your operating system — that row has the only file you need.');
    out.push('');
    out.push('| Your machine | Download |');
    out.push('|---|---|');
    for (const row of OS_ROWS) {
      const cells = [];
      for (const id of row.kinds) {
        const asset = installers.get(id);
        if (!asset) continue;
        const size = formatSize(asset.size);
        const link = `[\`${asset.name}\`](${asset.browser_download_url})`;
        const variant = KINDS.find((k) => k.id === id)?.label;
        cells.push(`${variant ? `${variant} — ` : ''}${link}${size ? ` · ${size}` : ''}`);
      }
      // 그 OS 의 자산이 하나도 없으면 줄을 그리지 않는다 — 표의 줄 수가 곧 발행된 OS 수다.
      if (cells.length === 0) continue;
      out.push(`| ${row.os} | ${cells.join('<br>')} |`);
    }
    out.push('');

    if (installers.has('mac-arm64') || installers.has('mac-x64')) {
      out.push(
        'Not sure which Mac you have? **Apple menu → About This Mac** — "Apple M1/M2/M3/M4" is Apple Silicon, "Intel" is Intel.',
      );
      out.push('');
    }
  }

  if (extras.length > 0) {
    // 왜 접어 두는가: 이 파일들은 지우거나 감출 수 없다(자동 업데이트가 읽는다).
    // 그렇다면 남는 일은 "받는 것이 아니다"라고 **한 줄로 말해 주는 것**뿐이다.
    out.push(
      `<details><summary>The other ${extras.length} files under Assets — you do not need them</summary>`,
    );
    out.push('');
    out.push(
      'They are what the app\'s built-in updater reads: `latest*.yml` is the version feed, `*.blockmap` lets an update download only the changed parts, and `*-mac.zip` is the format macOS updates in place with. Downloading them by hand does nothing.',
    );
    out.push('');
    out.push('</details>');
    out.push('');
  }

  // ── 한 줄 설치 ─────────────────────────────────────────────────────────────
  out.push('### Or install with one line');
  out.push('');
  out.push('```bash');
  out.push('# macOS and Linux');
  out.push(
    'curl -fsSL https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.sh | sh',
  );
  out.push('```');
  out.push('');
  out.push('```powershell');
  out.push('# Windows');
  out.push('irm https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.ps1 | iex');
  out.push('```');
  out.push('');
  out.push(
    'The script reads this release, picks the build for your machine, and prefers your package manager over the AppImage when you have one.',
  );
  out.push('');

  // ── 첫 실행 ────────────────────────────────────────────────────────────────
  // 있는 플랫폼의 줄만 적는다 — 받을 수 없는 것의 사용법은 안내가 아니라 잡음이다.
  const first = [];
  if (installers.has('win')) {
    first.push(
      '- **Windows** — the build is not code-signed yet, so SmartScreen warns on first run: **More info → Run anyway**.',
    );
  }
  if (installers.has('mac-arm64') || installers.has('mac-x64')) {
    first.push(
      '- **macOS** — unsigned too, and Gatekeeper blocks it outright. Move `Vibisual.app` into `/Applications`, then run this once:\n\n  ```bash\n  xattr -cr /Applications/Vibisual.app\n  ```',
    );
  }
  const deb = installers.get('linux-deb');
  const rpm = installers.get('linux-rpm');
  if (deb || rpm) {
    const cmds = [];
    if (deb) cmds.push(`  sudo apt install ./${deb.name}`);
    if (rpm) cmds.push(`  sudo dnf install ./${rpm.name}`);
    first.push(
      `- **Linux (.deb / .rpm)** — your package manager pulls in the libraries for you:\n\n  \`\`\`bash\n${cmds.join('\n')}\n  \`\`\``,
    );
  }
  const appImage = installers.get('linux-appimage');
  if (appImage) {
    first.push(
      `- **Linux (AppImage)** — for distributions that take neither format. It needs FUSE 2, which recent releases no longer ship:\n\n  \`\`\`bash\n  sudo apt install libfuse2t64   # "libfuse2" on Ubuntu 22.04 and older\n  chmod +x ${appImage.name}\n  ./${appImage.name}\n  \`\`\``,
    );
  }
  if (first.length > 0) {
    out.push('### First launch');
    out.push('');
    // 항목 사이를 빈 줄로 띄운다 — 코드 블록을 품은 항목 바로 뒤에 다음 `-` 가 붙으면
    // 렌더러에 따라 목록이 끊긴 것으로 읽힌다.
    out.push(first.join('\n\n'));
    out.push('');
  }

  out.push(
    'Vibisual runs on top of the [Claude CLI](https://claude.com/claude-code), which must already be on your PATH.',
  );
  out.push('');

  // ── 어디서 테스트했는지 ────────────────────────────────────────────────────
  // 받는 사람이 기대치를 맞출 수 있어야 한다 — mac/linux 에서 깨졌을 때 "원래 이런가 보다"
  // 하고 조용히 지우는 대신 이슈로 오게 만드는 줄이다.
  out.push(
    `Day-to-day development and testing happen on Windows, so macOS and Linux get far less hands-on use. If a build is broken there, [open an issue](https://github.com/${OWNER}/${REPO}/issues/new) — we will fix it quickly.`,
  );
  out.push('');

  // ── 변경 내역 ──────────────────────────────────────────────────────────────
  if (changelog) {
    out.push('---');
    out.push('');
    out.push(`## What changed in ${version}`);
    out.push('');
    out.push(changelog);
    out.push('');
  }

  out.push(
    `**Full history:** [CHANGELOG.md](https://github.com/${OWNER}/${REPO}/blob/v${version}/CHANGELOG.md)`,
  );

  return out.join('\n');
}

// ── GitHub ───────────────────────────────────────────────────────────────────
function ghHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vibisual-release-notes',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * 그 태그의 릴리스를 읽는다 — **draft 도 찾는다.**
 *
 * ⚠️ `/releases/tags/<tag>` 하나만 쓰면 안 된다. 그 경로는 **draft 에 404** 를 준다.
 * 자산은 이제 draft 로 올라오고(`electron-builder.yml` 의 `releaseType: draft` — 실기 검증을
 * 통과해야 공개된다) 본문은 그보다 **먼저** 붙어야 하므로, 태그 경로만 보면 매 릴리스마다
 * "아직 빌드 중"이라며 본문 없이 지나간다. 태그 경로를 먼저 보고(공개된 것 재생성용),
 * 없으면 목록에서 `tag_name` 으로 찾는다(방금 올라온 draft).
 */
async function fetchRelease(version) {
  const tag = `v${version}`;
  const direct = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`,
    { headers: ghHeaders() },
  );
  if (direct.ok) return direct.json();

  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100&page=${page}`,
      { headers: ghHeaders() },
    );
    if (!res.ok) break;
    const list = await res.json();
    const hit = list.find((r) => r.tag_name === tag);
    if (hit) return hit;
    if (list.length < 100) break;
  }

  throw new Error(
    `릴리스 ${tag} 를 못 읽었다 (태그 조회 HTTP ${direct.status}, 목록에도 없음). ` +
      '아직 빌드 중이거나 태그가 없다.',
  );
}

/**
 * 릴리스 제목 — **버전 숫자만**.
 *
 * 저장소 이름 아래에 놓인 릴리스 목록에서 모든 줄이 같은 제품명으로 시작하면 그 낱말은
 * 정보가 아니라 잡음이고, 눈이 실제로 비교하는 숫자를 오른쪽으로 밀어낸다. v0.1.6~v0.1.14 는
 * electron-builder 가 넣은 숫자 그대로였는데 `Vibisual 0.1.15` 한 줄만 그 대열에서 튀었다.
 *
 * 사람이 손으로 붙인 제목은 건드리지 않는다 — 자동화가 사람의 글을 덮어쓰면 안 된다.
 * 다만 **우리가 예전에 찍어 둔 `Vibisual <버전>` 은 사람의 글이 아니므로** 같이 정규화한다.
 * 그 갈래가 없으면 이미 발행된 릴리스는 영영 옛 형태로 남는다(다시 태그를 밀 수는 없다).
 *
 * @param {string|null|undefined} currentName 지금 붙어 있는 제목
 * @param {string} version `0.1.15` 형태
 * @returns {string|null} 새로 쓸 제목, 또는 사람의 글이라 손대지 말아야 하면 null
 */
export function releaseTitle(currentName, version) {
  const now = (currentName ?? '').trim();
  const ours = ['', version, `v${version}`, `Vibisual ${version}`, `Vibisual v${version}`];
  return ours.includes(now) ? version : null;
}

async function applyNotes(release, version, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('--apply 에는 GH_TOKEN(또는 GITHUB_TOKEN)이 필요하다.');

  const nextTitle = releaseTitle(release.name, version);
  const payload = { body };
  if (nextTitle !== null) payload.name = nextTitle;

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`,
    { method: 'PATCH', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  );
  if (!res.ok) {
    throw new Error(`릴리스 갱신 실패 (HTTP ${res.status}): ${await res.text()}`);
  }
  return payload.name ?? release.name;
}

// ── 자체 점검 ────────────────────────────────────────────────────────────────
// 분류 규칙이 조용히 뒤집히는 것이 이 스크립트에서 가장 비싼 실수다(Intel 줄에
// Apple Silicon dmg 가 실려도 표는 멀쩡해 보인다). 네트워크 없이 도는 점검을 둔다.
function selftest() {
  const V = '0.1.14';
  const cases = [
    [`Vibisual-${V}-setup.exe`, 'win'],
    [`Vibisual-${V}-arm64.dmg`, 'mac-arm64'],
    [`Vibisual-${V}.dmg`, 'mac-x64'],
    [`vibisual_${V}_amd64.deb`, 'linux-deb'],
    [`vibisual-${V}.x86_64.rpm`, 'linux-rpm'],
    [`Vibisual-${V}.AppImage`, 'linux-appimage'],
    [`Vibisual-${V}-setup.exe.blockmap`, null],
    [`Vibisual-${V}-arm64.dmg.blockmap`, null],
    [`Vibisual-${V}-arm64-mac.zip`, null],
    [`Vibisual-${V}-mac.zip`, null],
    ['latest.yml', null],
    ['latest-mac.yml', null],
    ['latest-linux.yml', null],
  ];
  let failed = 0;
  for (const [name, want] of cases) {
    const got = classifyAsset(name);
    if (got !== want) {
      console.error(`  ✗ ${name} → ${got} (기대: ${want})`);
      failed++;
    }
  }

  // 표 렌더 — 없는 플랫폼 줄이 그려지지 않는지(죽은 링크 방지).
  const winOnly = renderNotes({
    version: V,
    assets: [{ name: `Vibisual-${V}-setup.exe`, size: 158681849, browser_download_url: 'https://x/exe' }],
    changelog: null,
  });
  if (winOnly.includes('Apple Silicon (M1')) {
    console.error('  ✗ mac 자산이 없는데 mac 줄이 그려졌다');
    failed++;
  }
  if (!winOnly.includes('https://x/exe')) {
    console.error('  ✗ win 자산 링크가 표에 없다');
    failed++;
  }

  // 표는 **운영체제 한 줄**이다. 갈래가 늘어도(리눅스 3종) 줄 수는 OS 수를 넘지 않는다 —
  // 이 검사가 없으면 새 포장을 추가한 사람이 표에 네 번째 줄을 만들고도 모른다.
  const bodyRows = (md) =>
    md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Your machine') && !l.startsWith('|---'));
  const full = renderNotes({
    version: V,
    assets: [
      { name: `Vibisual-${V}-setup.exe`, size: 190 << 20, browser_download_url: 'https://x/exe' },
      { name: `Vibisual-${V}-arm64.dmg`, size: 96 << 20, browser_download_url: 'https://x/arm' },
      { name: `Vibisual-${V}.dmg`, size: 101 << 20, browser_download_url: 'https://x/intel' },
      { name: `vibisual_${V}_amd64.deb`, size: 140 << 20, browser_download_url: 'https://x/deb' },
      { name: `vibisual-${V}.x86_64.rpm`, size: 145 << 20, browser_download_url: 'https://x/rpm' },
      { name: `Vibisual-${V}.AppImage`, size: 170 << 20, browser_download_url: 'https://x/img' },
    ],
    changelog: null,
  });
  const rows = bodyRows(full);
  if (rows.length !== 3) {
    console.error(`  ✗ 6종을 다 올렸는데 표가 ${rows.length}줄이다(윈도우·맥·리눅스 3줄이어야 한다)`);
    failed++;
  }
  if (bodyRows(winOnly).length !== 1) {
    console.error('  ✗ win 만 있는데 표가 1줄이 아니다');
    failed++;
  }
  // 한 줄 안에 그 OS 의 갈래가 전부 들어 있어야 한다 — 줄을 줄이려고 갈래를 버리면 안 된다.
  const linuxRow = rows.find((l) => l.includes('**Linux**')) ?? '';
  for (const url of ['https://x/deb', 'https://x/rpm', 'https://x/img']) {
    if (!linuxRow.includes(url)) {
      console.error(`  ✗ 리눅스 줄에 ${url} 이 빠졌다`);
      failed++;
    }
  }
  const macRow = rows.find((l) => l.includes('**macOS**')) ?? '';
  for (const url of ['https://x/arm', 'https://x/intel']) {
    if (!macRow.includes(url)) {
      console.error(`  ✗ 맥 줄에 ${url} 이 빠졌다`);
      failed++;
    }
  }

  const changelog = extractChangelog(
    '# Changelog\n\n## [0.1.15] - 2026-09-01\n\nnewer\n\n## [0.1.14] - 2026-08-27\n\n### Fixed\n- thing\n\n## [0.1.13] - 2026-08-27\n\nolder\n',
    '0.1.14',
  );
  if (changelog !== '### Fixed\n- thing') {
    console.error(`  ✗ CHANGELOG 발췌가 어긋났다: ${JSON.stringify(changelog)}`);
    failed++;
  }

  // 제목 — 우리가 찍은 것은 숫자로 정규화하고, 사람이 쓴 것은 건드리지 않는다.
  const titleCases = [
    [null, V],
    [undefined, V],
    ['', V],
    [V, V],
    [`  ${V}  `, V],
    [`v${V}`, V],
    [`Vibisual ${V}`, V],
    [`Vibisual v${V}`, V],
    ['0.1.14 — 큰 개편', null],
    [`Vibisual 0.1.13`, null],
  ];
  for (const [name, want] of titleCases) {
    const got = releaseTitle(name, V);
    if (got !== want) {
      console.error(`  ✗ releaseTitle(${JSON.stringify(name)}) → ${JSON.stringify(got)} (기대: ${JSON.stringify(want)})`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`selftest 실패 ${failed}건`);
    process.exit(1);
  }
  console.log(`selftest 통과 — 분류 ${cases.length}건 + 렌더 9건 + 제목 ${titleCases.length}건`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();

  const apply = args.includes('--apply');
  const version =
    args.find((a) => !a.startsWith('--')) ??
    JSON.parse(readFileSync(path.join(ROOT, 'packages/desktop/package.json'), 'utf8')).version;

  const release = await fetchRelease(version);
  let changelog = null;
  try {
    changelog = extractChangelog(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  } catch {
    // CHANGELOG 를 못 읽어도 다운로드 안내는 나가야 한다 — 그게 이 스크립트의 본업이다.
  }

  const body = renderNotes({ version, assets: release.assets ?? [], changelog });

  if (!apply) {
    process.stdout.write(body + '\n');
    return;
  }

  const title = await applyNotes(release, version, body);
  console.log(`릴리스 v${version} 본문 갱신 완료 — "${title}"`);
  console.log(`https://github.com/${OWNER}/${REPO}/releases/tag/v${version}`);
}

// 직접 실행일 때만 돈다(위 export 들은 테스트가 가져다 쓴다).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
