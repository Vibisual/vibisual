// 공개 지표 스냅샷 — 하루 한 줄씩(`metrics` 브랜치, 공개 API 만). GitHub 은 누적값만 줘 안 찍은 날은 소급할 수 없다.
// traction.csv = 누적(별·포크·다운로드) · traffic.csv = 그날 유량(조회·클론 — 14일치를 매번 덮어써 스스로 메운다) · badge-stars.json = 별 배지.
// ⚠️ 트래픽은 14일만 보관되고 기본 `GITHUB_TOKEN` 으로 못 읽는다(`permissions:` 에 `administration` 이 없다) — `METRICS_TOKEN`(이 저장소 fine-grained PAT,
// Administration: read)이 없으면 그 열만 비운다. 다운로드 배지는 shields.io 표준을 쓴다(카운터로 사람과 자동 업데이트를 못 가른다).
// 사용법: node .github/scripts/traction-snapshot.mjs <출력 디렉터리> · env REPO(기본 Vibisual/vibisual) · GITHUB_TOKEN · METRICS_TOKEN(둘 다 선택)

import fs from 'node:fs';
import path from 'node:path';
import {
  API_VERSION, aggregate, collectReleases, makeEvidence, validateRepository, validateTraffic,
} from './traction-data.mjs';

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

async function api(apiPath, token = TOKEN, pageInfo = false) {
  const headers = {
    'User-Agent': 'vibisual-traction', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (!res.ok) throw new Error(`GET ${apiPath} -> HTTP ${res.status}`);
  const data = await res.json();
  return pageInfo ? { items: data, hasNext: /<[^>]+>;\s*rel="next"/.test(res.headers.get('link') ?? '') } : data;
}

/** 던지지 않는 호출(트래픽 전용) — 403 하나로 나머지 열을 잃지 않게 stderr 에 이유를 남기고 null. */
async function apiSoft(apiPath, key) {
  if (!TRAFFIC_TOKEN) return null;
  try {
    return validateTraffic(await api(apiPath, TRAFFIC_TOKEN), key);
  } catch (err) {
    console.error(`[traffic] ${apiPath} 건너뜀 — ${err.message}`);
    return null;
  }
}

const collectionStartedAt = new Date().toISOString();
const repo = validateRepository(await api(`/repos/${REPO}`));
const { releases, pages } = await collectReleases((page, perPage) =>
  api(`/repos/${REPO}/releases?per_page=${perPage}&page=${page}`, TOKEN, true));
const tally = aggregate(releases);

// 사전 릴리스(preview)는 최신판 판단에서 뺀다 — 정식 배포본의 흐름을 보고 싶기 때문.
const latest = releases.find((r) => !r.prerelease);
const latestDownloads = aggregate(latest ? [latest] : []).total;

const observedAt = new Date().toISOString();
const evidence = makeEvidence({ repository: REPO, repo, releases, pages, collectionStartedAt, observedAt });
const views = await apiSoft(`/repos/${REPO}/traffic/views?per=day`, 'views');
const clones = await apiSoft(`/repos/${REPO}/traffic/clones?per=day`, 'clones');

if (!TRAFFIC_TOKEN) {
  console.error('[traffic] METRICS_TOKEN 이 없어 조회수·클론 열을 비웁니다.');
}

const today = observedAt.slice(0, 10);

// All public API data has passed validation. Preserve every observation; never replace an archive.
// Millisecond UTC filenames permit multiple runs per day, including manual investigation snapshots.
const archiveDir = path.join(OUT_DIR, 'snapshots');
const archiveName = `${observedAt.replace(/[:.]/g, '-')}.json`;
const evidenceJson = JSON.stringify(evidence, null, 2) + '\n';
fs.mkdirSync(archiveDir, { recursive: true });
fs.writeFileSync(path.join(archiveDir, archiveName), evidenceJson, { flag: 'wx' });
fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), evidenceJson);
fs.copyFileSync(new URL('../metrics/README.md', import.meta.url), path.join(OUT_DIR, 'README.md'));

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

const priorTraction = fs.existsSync(TRACTION_CSV) ? fs.readFileSync(TRACTION_CSV, 'utf8') : '';

// Keep historical rows verbatim. Only today's daily summary is replaced; the archive retains every run.
const keptTraction = priorTraction
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('date,') && !line.startsWith(`${today},`));

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
    const prior = daily.get(day)?.split(',');
    daily.set(day, [day, d.views ?? prior?.[1] ?? '', d.visitors ?? prior?.[2] ?? '',
      d.clones ?? prior?.[3] ?? '', d.cloners ?? prior?.[4] ?? ''].join(','));
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
