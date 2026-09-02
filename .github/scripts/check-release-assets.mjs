#!/usr/bin/env node
// 한 판올림이 **세 OS 전부에 도달했는가**를 세는 곳 — 자산 목록의 정본은 여기 하나다.
//
// 왜 한 곳이어야 하나: 종전에는 이 목록이 `/release` 스킬 문서 안에만 있었다. 문서는 실행되지
// 않으므로 아무도 세지 않으면 아무 일도 일어나지 않았고, v0.1.12 가 Intel dmg 없이 발행됐다.
// 이제는 `smoke.yml` 의 `publish` 잡이 **공개 전환 직전에** 이 스크립트를 돌린다 — 한 종이라도
// 없으면 그 릴리스는 draft 로 남는다. 사람의 기억이 아니라 게이트가 센다.
//
// ⚠️ draft 릴리스를 봐야 하므로 `/releases/tags/<tag>` 를 쓰지 않는다 — 그 경로는 draft 에
//    404 를 준다. 목록에서 `tag_name` 으로 찾는다(그래야 검증 전 단계의 릴리스가 보인다).
//
// 사용법:  node .github/scripts/check-release-assets.mjs v0.1.19
// 환경:    GH_TOKEN (draft 를 보려면 필수 — 없으면 공개 릴리스만 보인다)
// 종료코드: 0 = 전부 있음 · 1 = 누락 있음 · 2 = 릴리스 자체를 못 찾음

const OWNER = 'Vibisual';
const REPO = 'vibisual';

const raw = process.argv[2];
if (!raw) {
  console.error('사용법: node check-release-assets.mjs <태그>   (예: v0.1.19)');
  process.exit(2);
}
/** `v0.1.19` 와 `0.1.19` 를 모두 받는다 — 부르는 쪽마다 다르게 들고 있어서다. */
const tag = raw.startsWith('v') ? raw : `v${raw}`;
const version = tag.slice(1);

/**
 * 이름을 못 박아 세는 것들. 여기 없는 이름으로 발행되면 "없다"가 되는데, 그게 맞다 —
 * 자동 업데이트 피드와 설치 안내가 전부 이 이름을 가리키고 있다.
 */
const NEED_EXACT = [
  ['win   설치본', `Vibisual-${version}-setup.exe`],
  ['win   피드', 'latest.yml'],
  ['mac   arm64 dmg', `Vibisual-${version}-arm64.dmg`],
  ['mac   arm64 zip', `Vibisual-${version}-arm64-mac.zip`],
  ['mac   x64 dmg', `Vibisual-${version}.dmg`],
  ['mac   x64 zip', `Vibisual-${version}-mac.zip`],
  ['mac   피드', 'latest-mac.yml'],
  ['linux AppImage', `Vibisual-${version}.AppImage`],
  ['linux 피드', 'latest-linux.yml'],
];

/**
 * deb·rpm 은 **확장자로** 센다. 파일명 규칙이 electron-builder 기본값에 달려 있어서,
 * 이름을 못 박아 두면 상류가 규칙을 바꿀 때 멀쩡한 자산을 "없다"고 잘못 말한다.
 */
const NEED_SUFFIX = [
  ['linux deb', '.deb'],
  ['linux rpm', '.rpm'],
];

export const EXPECTED_ASSET_COUNT = NEED_EXACT.length + NEED_SUFFIX.length;

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'vibisual-release-check' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** draft 를 포함해 그 태그의 릴리스를 찾는다. 못 찾으면 null. */
async function findRelease() {
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100&page=${page}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`릴리스 목록 조회 실패: HTTP ${res.status}`);
    const list = await res.json();
    const hit = list.find((r) => r.tag_name === tag);
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

const release = await findRelease();
if (!release) {
  console.log(`릴리스 ${tag} 를 못 찾았다 — 아직 빌드 중이거나 태그가 다르다.`);
  process.exit(2);
}

const have = new Set((release.assets ?? []).map((a) => a.name));
let miss = 0;

for (const [label, name] of NEED_EXACT) {
  const ok = have.has(name);
  if (!ok) miss++;
  console.log(`${ok ? ' OK ' : 'MISS'}  ${label}  ${name}`);
}
for (const [label, suffix] of NEED_SUFFIX) {
  const hit = [...have].find((n) => n.endsWith(suffix));
  if (!hit) miss++;
  console.log(`${hit ? ' OK ' : 'MISS'}  ${label}  ${hit ?? `(*${suffix} 없음)`}`);
}

console.log('');
console.log(`상태: ${release.draft ? 'draft(비공개 — 검증 대기)' : '공개 발행됨'}`);
if (miss) {
  console.log(`=> ${miss}개 누락 (${EXPECTED_ASSET_COUNT - miss}/${EXPECTED_ASSET_COUNT}) — 그 OS 잡이 실패했다. Actions 의 해당 잡 로그를 볼 것.`);
  process.exit(1);
}
console.log(`=> ${EXPECTED_ASSET_COUNT}/${EXPECTED_ASSET_COUNT} — win/mac(arm64+x64)/linux(AppImage+deb+rpm) 전부 발행됨.`);
process.exit(0);
