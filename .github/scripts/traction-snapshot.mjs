// 공개 지표 스냅샷 — 하루 한 줄씩(`metrics` 브랜치, 공개 API 만). GitHub 은 누적값만 줘 안 찍은 날은 소급할 수 없다.
// traction.csv = 누적(별·포크·다운로드) · traffic.csv = 그날 유량(조회·클론 — 14일치를 매번 덮어써 스스로 메운다) · badge-stars.json = 별 배지.
// ⚠️ 트래픽은 14일만 보관되고 기본 `GITHUB_TOKEN` 으로 못 읽는다(`permissions:` 에 `administration` 이 없다) — `METRICS_TOKEN`(이 저장소 fine-grained PAT,
// Administration: read)이 없으면 그 열만 비운다. 다운로드 배지는 shields.io 표준을 쓴다(카운터로 사람과 자동 업데이트를 못 가른다).
// 사용법: node .github/scripts/traction-snapshot.mjs <출력 디렉터리> · env REPO(기본 Vibisual/vibisual) · GITHUB_TOKEN · METRICS_TOKEN(둘 다 선택)

import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO ?? 'Vibisual/vibisual';
const TOKEN = process.env.GITHUB_TOKEN ?? '';
const TRAFFIC_TOKEN = process.env.METRICS_TOKEN ?? '';

// 인자는 디렉터리 — csv 경로를 주면 그 상위 폴더로 읽는다.
const rawArg = process.argv[2] ?? '.';
const OUT_DIR = rawArg.endsWith('.csv') ? path.dirname(rawArg) : rawArg;

const TRACTION_CSV = path.join(OUT_DIR, 'traction.csv');
const TRAFFIC_CSV = path.join(OUT_DIR, 'traffic.csv');

const TRACTION_HEADER = [
  'date',
  'stars',
  'forks',
  'watchers',
  'open_issues',
  'releases',
  'downloads_total',
  'downloads_windows',
  'downloads_macos',
  'downloads_linux',
  'update_checks',
  'latest_tag',
  'latest_downloads',
  'views_14d',
  'visitors_14d',
  'clones_14d',
  'cloners_14d',
].join(',');

const TRAFFIC_HEADER = ['date', 'views', 'visitors', 'clones', 'cloners'].join(',');

/** 설치 파일 이름 → 플랫폼. 갱신 메타(.yml)와 델타(.blockmap)는 설치가 아니므로 뺀다. */
function classify(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.blockmap')) return null;
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return 'meta';
  if (n.endsWith('.exe') || n.endsWith('.msi')) return 'windows';
  if (n.endsWith('.dmg') || n.endsWith('-mac.zip') || n.endsWith('.pkg')) return 'macos';
  if (n.endsWith('.appimage') || n.endsWith('.deb') || n.endsWith('.rpm') || n.endsWith('.snap')) {
    return 'linux';
  }
  return null;
}

async function api(apiPath, token = TOKEN) {
  const headers = { 'User-Agent': 'vibisual-traction', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (!res.ok) throw new Error(`GET ${apiPath} -> HTTP ${res.status}`);
  return res.json();
}

/** 던지지 않는 호출(트래픽 전용) — 403 하나로 나머지 열을 잃지 않게 stderr 에 이유를 남기고 null. */
async function apiSoft(apiPath) {
  if (!TRAFFIC_TOKEN) return null;
  try {
    return await api(apiPath, TRAFFIC_TOKEN);
  } catch (err) {
    console.error(`[traffic] ${apiPath} 건너뜀 — ${err.message}`);
    return null;
  }
}

const repo = await api(`/repos/${REPO}`);

// 릴리스는 페이지가 넘어갈 수 있다 — 100개씩 끝까지 돈다.
const releases = [];
for (let page = 1; page <= 20; page += 1) {
  const batch = await api(`/repos/${REPO}/releases?per_page=100&page=${page}`);
  releases.push(...batch);
  if (batch.length < 100) break;
}

const tally = { windows: 0, macos: 0, linux: 0, meta: 0, total: 0 };
for (const rel of releases) {
  for (const asset of rel.assets ?? []) {
    const kind = classify(asset.name);
    if (!kind) continue;
    tally[kind] += asset.download_count;
    if (kind !== 'meta') tally.total += asset.download_count;
  }
}

// 사전 릴리스(preview)는 최신판 판단에서 뺀다 — 정식 배포본의 흐름을 보고 싶기 때문.
const latest = releases.find((r) => !r.prerelease && !r.draft) ?? releases[0];
const latestDownloads = (latest?.assets ?? [])
  .filter((a) => classify(a.name) && classify(a.name) !== 'meta')
  .reduce((sum, a) => sum + a.download_count, 0);

const views = await apiSoft(`/repos/${REPO}/traffic/views?per=day`);
const clones = await apiSoft(`/repos/${REPO}/traffic/clones?per=day`);

if (!TRAFFIC_TOKEN) {
  console.error('[traffic] METRICS_TOKEN 이 없어 조회수·클론 열을 비웁니다.');
}

const today = new Date().toISOString().slice(0, 10);

// ── traction.csv ────────────────────────────────────────────────────────────
const tractionRow = [
  today,
  repo.stargazers_count,
  repo.forks_count,
  repo.subscribers_count,
  repo.open_issues_count,
  releases.length,
  tally.total,
  tally.windows,
  tally.macos,
  tally.linux,
  tally.meta,
  latest?.tag_name ?? '',
  latestDownloads,
  views?.count ?? '',
  views?.uniques ?? '',
  clones?.count ?? '',
  clones?.uniques ?? '',
].join(',');

const tractionWidth = TRACTION_HEADER.split(',').length;
const priorTraction = fs.existsSync(TRACTION_CSV) ? fs.readFileSync(TRACTION_CSV, 'utf8') : '';

// 옛 줄은 열이 적을 수 있다 — 빈 칸으로 폭을 맞춘다(안 그러면 표 도구가 열을 밀려 읽는다).
const keptTraction = priorTraction
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('date,') && !line.startsWith(`${today},`))
  .map((line) => {
    const cells = line.split(',');
    while (cells.length < tractionWidth) cells.push('');
    return cells.slice(0, tractionWidth).join(',');
  });

fs.writeFileSync(TRACTION_CSV, [TRACTION_HEADER, ...keptTraction, tractionRow].join('\n') + '\n');

// ── traffic.csv ─────────────────────────────────────────────────────────────
// API 가 14일치를 통째로 주므로, 있던 날은 덮어쓰고 없던 날은 새로 넣는다.
// 워크플로가 며칠 멈춰 있었어도 14일 안이면 스스로 메워진다.
const daily = new Map();
for (const line of fs.existsSync(TRAFFIC_CSV) ? fs.readFileSync(TRAFFIC_CSV, 'utf8').split('\n') : []) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('date,')) continue;
  daily.set(trimmed.slice(0, 10), trimmed);
}

if (views || clones) {
  const byDate = new Map();
  for (const v of views?.views ?? []) {
    const day = v.timestamp.slice(0, 10);
    byDate.set(day, { ...(byDate.get(day) ?? {}), views: v.count, visitors: v.uniques });
  }
  for (const c of clones?.clones ?? []) {
    const day = c.timestamp.slice(0, 10);
    byDate.set(day, { ...(byDate.get(day) ?? {}), clones: c.count, cloners: c.uniques });
  }
  for (const [day, d] of byDate) {
    daily.set(day, [day, d.views ?? 0, d.visitors ?? 0, d.clones ?? 0, d.cloners ?? 0].join(','));
  }
  const rows = [...daily.keys()].sort().map((day) => daily.get(day));
  fs.writeFileSync(TRAFFIC_CSV, [TRAFFIC_HEADER, ...rows].join('\n') + '\n');
} else if (!fs.existsSync(TRAFFIC_CSV)) {
  // 토큰이 붙는 날까지 헤더만 두어, 파일이 없어서 나는 오류를 막는다.
  fs.writeFileSync(TRAFFIC_CSV, TRAFFIC_HEADER + '\n');
}

// ── 배지 ────────────────────────────────────────────────────────────────────
// shields.io endpoint 스키마. https://shields.io/badges/endpoint-badge
function writeBadge(file, label, message, color) {
  const badge = { schemaVersion: 1, label, message: String(message), color, cacheSeconds: 3600 };
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(badge) + '\n');
}

// 예전에 만들던 다운로드 배지 파일은 지운다 — 남겨 두면 누군가 다시 가리킨다.
fs.rmSync(path.join(OUT_DIR, 'badge-downloads.json'), { force: true });
writeBadge('badge-stars.json', 'stars', repo.stargazers_count, 'blue');

console.log(tractionRow);
