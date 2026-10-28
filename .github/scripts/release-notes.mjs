/**
 * 릴리스 본문(다운로드 안내)을 실제 발행 자산에서 만든다(§4) — `--publish always` 는 본문을 안 쓰고, 파일 이름만으로는 arm64 = Apple Silicon
 * · 접미사 없는 dmg = Intel · zip/blockmap/yml 은 받지 않는 것임을 모른다. 이름을 미리 적으면 빠진 OS(`fail-fast: false`)가 죽은 링크가 된다.
 * ⚠️ 첫 줄 `#!` ❌ — Windows 러너(CRLF)의 Vitest 가 `#!…\r\n` 모듈을 SyntaxError 로 못 읽는다(2026-09-13 CI 실측, ubuntu·macos 는 통과).
 * ⚠️ `/scripts/` 로 옮기지 마라 — 그 자리는 gitignore·pre-commit 훅으로 공개되지 않아 커밋이 막히고 CI 가 못 찾는다.
 * 사용법: node .github/scripts/release-notes.mjs [버전] [--apply(제목·본문 갱신, GH_TOKEN)] · --selftest(분류 점검). 버전 생략 = desktop package.json.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER = 'Vibisual';
const REPO = 'vibisual';

// `label` 은 한 OS 안의 갈래 이름(OS 이름은 OS_ROWS 가 붙인다).
// ⚠️ `match` 는 처음 맞는 것이 이긴다 — `arm64.dmg` 가 `.dmg` 보다 먼저(아니면 Apple Silicon dmg 가 Intel 줄에 실린다).
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

/** 표는 OS 한 줄씩, 갈래는 그 칸 안에서. 자산이 없는 OS 는 줄째 빠진다 — 셋보다 적으면 그 OS 잡이 실패한 것이다. */
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
 * 자산을 받는 주소 — **태그로 만든다.** API 의 `browser_download_url` 을 쓰지 마라: 본문은 draft 동안(스모크 통과 전) 쓰이는데
 * draft 주소 `releases/download/untagged-<hash>/…` 는 공개되는 순간 404 다(2026-09-13 실측: untagged 404, 태그 주소 302).
 * @param {string} version `0.1.24` 형태
 * @param {string} name 자산 파일 이름
 */
export function assetDownloadUrl(version, name) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${encodeURIComponent(name)}`;
}

/**
 * @param {{ version: string, assets: Array<{name:string,size:number,browser_download_url?:string}>, changelog?: string|null }} input
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
        const link = `[\`${asset.name}\`](${assetDownloadUrl(version, asset.name)})`;
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
 * draft 도 찾는다 — `/releases/tags/<tag>` 는 draft 에 404 인데 자산은 draft 로 오고(`releaseType: draft`) 본문은 그보다 먼저 붙어야 한다.
 * 태그 경로를 먼저, 없으면 목록에서 `tag_name` 으로.
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
 * 릴리스 제목 — **버전 숫자만**(목록의 줄마다 같은 제품명이 앞서면 잡음이고, 눈이 비교하는 숫자를 밀어낸다).
 * 사람이 손으로 붙인 제목은 덮어쓰지 않는다. 자동화가 찍던 `Vibisual <버전>` 은 사람의 글이 아니라 함께 정규화한다
 * — 이 갈래가 없으면 이미 발행된 릴리스가 옛 형태로 남는다(태그를 다시 밀 수 없다).
 * @param {string|null|undefined} currentName 지금 붙어 있는 제목
 * @param {string} version `0.1.15` 형태
 * @returns {string|null} 새로 쓸 제목, 또는 사람의 글이라 손대지 말아야 하면 null
 */
export function releaseTitle(currentName, version) {
  const now = (currentName ?? '').trim();
  const ours = ['', version, `v${version}`, `Vibisual ${version}`, `Vibisual v${version}`];
  return ours.includes(now) ? version : null;
}

/**
 * 본문을 고칠 때 보낼 값. ⚠️ `tag_name` 을 **반드시 같이** 보낸다 — draft 에 본문만 PATCH 하면 GitHub 이 태그 묶음을
 * `untagged-<hash>` 로 풀어 스모크의 공개 잡이 태그로 릴리스를 못 찾고 멈춘다(2026-09-13 임시 draft 로 확인: 본문만 → untagged, 함께 → 유지).
 * @param {{ name?: string|null }} release 지금 릴리스
 * @param {string} version `0.1.24` 형태
 * @param {string} body 새 본문
 */
export function notesPatchPayload(release, version, body) {
  const payload = { body, tag_name: `v${version}` };
  const nextTitle = releaseTitle(release.name, version);
  if (nextTitle !== null) payload.name = nextTitle;
  return payload;
}

async function applyNotes(release, version, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('--apply 에는 GH_TOKEN(또는 GITHUB_TOKEN)이 필요하다.');

  const payload = notesPatchPayload(release, version, body);
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`;
  const patch = (data) =>
    fetch(url, { method: 'PATCH', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  const res = await patch(payload);
  if (!res.ok) {
    throw new Error(`릴리스 갱신 실패 (HTTP ${res.status}): ${await res.text()}`);
  }
  // 고친 뒤에도 태그에 묶여 있는지 응답으로 확인한다 — 풀린 채 지나가면 공개 잡이 릴리스를 못 찾는다.
  // 풀려 있으면 태그만 한 번 더 묶어 본다. 그래도 안 되면 조용히 넘기지 않고 잡을 빨갛게 만든다.
  let after = await res.json();
  if (after.tag_name !== payload.tag_name) {
    const again = await patch({ tag_name: payload.tag_name });
    if (again.ok) after = await again.json();
  }
  if (after.tag_name !== payload.tag_name) {
    throw new Error(`본문은 썼지만 태그 묶음이 풀렸고 다시 묶지 못했다 (tag_name=${after.tag_name}, 기대 ${payload.tag_name}).`);
  }
  return payload.name ?? release.name;
}

// 자체 점검(네트워크 없이) — 분류가 조용히 뒤집혀도(Intel 줄에 Apple Silicon dmg) 표는 멀쩡해 보인다.
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
  // 입력 자산의 주소는 **실제로 들어오는 모양**(draft 의 untagged 주소)으로 둔다 — 본문은 draft 때 쓰인다.
  const draftUrl = (name) => `https://github.com/${OWNER}/${REPO}/releases/download/untagged-5d02f298966051e71200/${name}`;
  const winOnly = renderNotes({
    version: V,
    assets: [{ name: `Vibisual-${V}-setup.exe`, size: 158681849, browser_download_url: draftUrl(`Vibisual-${V}-setup.exe`) }],
    changelog: null,
  });
  if (winOnly.includes('Apple Silicon (M1')) {
    console.error('  ✗ mac 자산이 없는데 mac 줄이 그려졌다');
    failed++;
  }
  if (!winOnly.includes(assetDownloadUrl(V, `Vibisual-${V}-setup.exe`))) {
    console.error('  ✗ win 자산 링크가 표에 없다(태그 주소여야 한다)');
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
      [`Vibisual-${V}-setup.exe`, 190],
      [`Vibisual-${V}-arm64.dmg`, 96],
      [`Vibisual-${V}.dmg`, 101],
      [`vibisual_${V}_amd64.deb`, 140],
      [`vibisual-${V}.x86_64.rpm`, 145],
      [`Vibisual-${V}.AppImage`, 170],
    ].map(([name, mb]) => ({ name, size: mb << 20, browser_download_url: draftUrl(name) })),
    changelog: null,
  });
  // 공개되는 순간 404 가 되는 draft 주소(`untagged-`)가 본문에 새면 안 된다.
  if (full.includes('untagged-') || winOnly.includes('untagged-')) {
    console.error('  ✗ 본문에 draft 주소(untagged-)가 들어갔다 — 공개되면 그 링크는 404 다');
    failed++;
  }
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
  for (const name of [`vibisual_${V}_amd64.deb`, `vibisual-${V}.x86_64.rpm`, `Vibisual-${V}.AppImage`]) {
    if (!linuxRow.includes(assetDownloadUrl(V, name))) {
      console.error(`  ✗ 리눅스 줄에 ${name} 의 태그 주소가 빠졌다`);
      failed++;
    }
  }
  const macRow = rows.find((l) => l.includes('**macOS**')) ?? '';
  for (const name of [`Vibisual-${V}-arm64.dmg`, `Vibisual-${V}.dmg`]) {
    if (!macRow.includes(assetDownloadUrl(V, name))) {
      console.error(`  ✗ 맥 줄에 ${name} 의 태그 주소가 빠졌다`);
      failed++;
    }
  }

  // 본문을 고칠 때 tag_name 을 같이 보내는가 — 빠지면 draft 의 태그 묶음이 풀린다.
  if (notesPatchPayload({ name: V }, V, 'x').tag_name !== `v${V}`) {
    console.error('  ✗ 본문 갱신 값에 tag_name 이 없다 — draft 에 보내면 태그가 untagged 로 풀린다');
    failed++;
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
  console.log(`selftest 통과 — 분류 ${cases.length}건 + 렌더 10건 + 본문 갱신 값 1건 + 제목 ${titleCases.length}건`);
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
