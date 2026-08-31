// 공개 지표 스냅샷 — 하루 한 줄씩 CSV 에 적는다.
//
// ⚠️ 왜 필요한지(2026-08-28):
//    GitHub 은 릴리스 다운로드를 **누적값으로만** 준다. 어제 몇 개였는지는 아무도
//    보관해 주지 않는다. 즉 오늘 기록을 시작하지 않으면 "6개월간 어떻게 늘었나"라는
//    곡선은 **영원히 만들 수 없다.** 과거는 소급되지 않는다.
//    텔레메트리를 앱에 넣지 않고도(우리는 넣지 않는다) 공개 API 만으로 이 곡선을
//    만들 수 있다 — 그래서 이 파일이 있다.
//
// ⚠️ 트래픽 열이 왜 붙었는지(2026-08-31):
//    조회수·고유 방문자·클론 수는 "얼마나 쓰이나"에 가장 가까우면서 법적으로 완전히
//    깨끗한 지표다 — 우리 저장소를, 우리 토큰으로, 공식 문서에 있는 엔드포인트로 읽는다.
//    그런데 GitHub 은 이 값을 **14일치만** 보관한다. 15일 전 조회수는 GitHub 안에도
//    남아 있지 않다. 다른 열은 늦게 시작해도 현재값부터 이어 붙지만, 이 열만은
//    **안 찍은 날이 영구 결손**이 된다.
//    Actions 의 기본 `GITHUB_TOKEN` 으로는 읽을 수 없다 — 워크플로 `permissions:`
//    블록에 `administration` 키 자체가 없기 때문이다(설정 가능한 16종에 없다).
//    이 저장소 하나에만 묶은 fine-grained PAT(Administration: read)을 `METRICS_TOKEN`
//    시크릿으로 넣어야 채워진다. 없으면 **그 열만 비우고 나머지는 그대로 적는다** —
//    토큰 하나 때문에 곡선 전체를 잃지 않는다.
//
// 파일을 넷 쓴다(전부 `metrics` 브랜치):
//   traction.csv        하루 한 줄, **누적 게이지**(별·포크·다운로드 총합).
//   traffic.csv         하루 한 줄, **그날의 유량**(조회·클론). API 가 14일치를 통째로
//                       주므로 매번 그 14일을 덮어쓴다 → 며칠 걸러도 스스로 메워진다.
//   badge-*.json        shields.io endpoint 배지용. README 가 이걸 가리킨다.
//
// ⚠️ 배지를 왜 직접 만드는지: shields 기본 `github/downloads/…/total` 은 릴리스 자산을
//    **전부** 더한다. 우리 자산의 대부분은 electron-updater 가 갱신 확인 때마다 받아 가는
//    `latest*.yml` 이라, 그 배지는 실제 설치본의 9배쯤으로 부풀어 보인다(실측 547 vs 59).
//    부풀린 숫자는 언젠가 대조당하고, 그때 잃는 것이 얻은 것보다 크다. 그래서 설치 파일만
//    세어 우리가 직접 배지 JSON 을 만든다.
//
// 사용법: node .github/scripts/traction-snapshot.mjs <출력 디렉터리>
//   REPO         owner/name (기본 Vibisual/vibisual)
//   GITHUB_TOKEN 공개 API rate limit 완화용(선택)
//   METRICS_TOKEN 트래픽 전용 PAT(선택, 없으면 트래픽 열만 빈다)

import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO ?? 'Vibisual/vibisual';
const TOKEN = process.env.GITHUB_TOKEN ?? '';
const TRAFFIC_TOKEN = process.env.METRICS_TOKEN ?? '';

// 인자는 디렉터리다. 예전처럼 csv 경로를 주더라도 그 상위 폴더로 알아듣는다.
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

/**
 * 실패해도 던지지 않는 호출. 트래픽 엔드포인트 전용이다 —
 * 토큰이 없거나 권한이 모자라면 403 이 오는데, 그 하나 때문에 나머지 열까지
 * 잃으면 안 된다. 이유를 stderr 에 남기고 null 을 돌려준다.
 */
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

// 예전 판본은 열이 적을 수 있다(트래픽 열은 2026-08-31 에 붙었다). 짧은 줄은 뒤를
// 빈 칸으로 채워 폭을 맞춘다 — 안 그러면 표 도구가 열을 밀려 읽는다.
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

writeBadge('badge-downloads.json', 'downloads', tally.total, 'blue');
writeBadge('badge-stars.json', 'stars', repo.stargazers_count, 'blue');

console.log(tractionRow);
