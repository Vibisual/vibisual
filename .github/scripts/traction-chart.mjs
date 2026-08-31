// 별 성장 곡선 — traction.csv 를 읽어 README 에 붙일 SVG 를 그린다.
//
// ⚠️ 왜 star-history.com 임베드가 아닌지(2026-08-31):
//    그쪽 이미지를 README 에 박으면 우리 README 를 여는 **모든 사람의 IP 가 3자 서버로
//    간다.** 우리 PRIVACY.md 는 "아무것도 수집하지 않는다"고 공개 선언해 두었는데,
//    그 문장 옆에 3자 추적 픽셀을 놓는 셈이라 앞뒤가 맞지 않는다. 같은 그림을
//    우리 CSV 로 직접 그리면 그 문제가 통째로 사라진다 — 데이터가 이미 우리 손에 있다.
//
// ⚠️ 왜 두 벌(light/dark)인지: GitHub 은 README 이미지를 camo 로 프록시해서 내보낸다.
//    그 안에서는 SVG 의 `prefers-color-scheme` 이 보는 사람의 테마를 따라가지 못한다.
//    테마를 따르게 하는 방법은 `<picture>` + `media` 로 **파일 자체를 갈라 주는 것**뿐이다.
//    그래서 한 벌을 자동 반전시키지 않고, 어두운 배경에 맞는 값을 따로 골라 두 벌을 낸다.
//
// 색은 눈으로 고르지 않았다 — dataviz 검증기(6종 검사)를 실제 렌더 표면인
// GitHub README 배경(라이트 #ffffff · 다크 #0d1117)에 대고 돌려 통과한 값이다.
// 단일 계열이라 범례는 없고(제목이 계열명이다), 값은 끝점 하나만 직접 붙인다.
//
// 사용법: node .github/scripts/traction-chart.mjs <csv 디렉터리>

import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO ?? 'Vibisual/vibisual';
const DIR = process.argv[2] ?? '.';
const CSV = path.join(DIR, 'traction.csv');

const W = 800;
const H = 280;
const PAD_L = 56;
const PAD_R = 84;
const PAD_T = 52;
const PAD_B = 36;
const X0 = PAD_L;
const X1 = W - PAD_R;
const Y0 = PAD_T;
const Y1 = H - PAD_B;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// 표면은 차트가 실제로 얹히는 곳(GitHub README)의 색이다. 배경은 칠하지 않고
// 투명하게 두되, 마커의 링만은 그 표면색으로 그려야 선 위에서 분리돼 보인다.
const THEMES = {
  light: {
    surface: '#ffffff',
    ink: '#1f2328',
    secondary: '#59636e',
    muted: '#818b98',
    grid: '#d1d9e0',
    series: '#2a78d6',
    areaOpacity: 0.14,
  },
  dark: {
    surface: '#0d1117',
    ink: '#f0f6fc',
    secondary: '#9198a1',
    muted: '#7d8590',
    grid: '#3d444d',
    series: '#3987e5',
    areaOpacity: 0.18,
  },
};

function readSeries() {
  if (!fs.existsSync(CSV)) return [];
  const lines = fs.readFileSync(CSV, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  // 열 위치가 아니라 이름으로 찾는다 — 열은 앞으로도 더 붙는다.
  const head = lines[0].split(',');
  const iDate = head.indexOf('date');
  const iStars = head.indexOf('stars');
  if (iDate < 0 || iStars < 0) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const date = cells[iDate];
    const stars = Number(cells[iStars]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(stars)) continue;
    out.push({ date, t: Date.parse(`${date}T00:00:00Z`), stars });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * 눈금은 **간격**부터 고른다. 최대값을 4로 나누면 `188 / 375 / 563` 같은 수가 나오는데,
 * 축 눈금은 읽으라고 있는 것이지 정확하라고 있는 것이 아니다 — 1/2/5 사다리에서
 * 간격을 고르고 상단을 거기에 맞춰 올린다. 별 수는 정수라 간격도 정수로 내린다.
 */
function niceTicks(max) {
  const rough = Math.max(max, 1) / 4;
  const base = 10 ** Math.floor(Math.log10(rough));
  const raw = [1, 2, 5, 10].map((m) => m * base).find((s) => s >= rough) ?? 10 * base;
  const step = Math.max(1, Math.round(raw));
  return { step, top: Math.max(step, Math.ceil(max / step) * step) };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 점이 하나뿐이면 **곡선이라는 것이 아직 존재하지 않는다.** 억지로 선을 긋는 것도,
 * 오늘 값을 크게 박는 것도 둘 다 틀렸다 — 이 그림의 주제는 "몇 개인가"가 아니라
 * "어떻게 늘었는가"이고, 그 답이 아직 없다는 게 사실이기 때문이다.
 * 그래서 숫자 대신 조용한 한 줄만 둔다. 내일 두 번째 값이 찍히면 자동으로 선이 된다.
 * (오늘의 별 수 자체는 배지와 저장소 헤더에 이미 있다. 여기서 반복할 이유가 없다.)
 */
const PLACEHOLDER_H = 132;

function renderPlaceholder(theme, series) {
  const t = THEMES[theme];
  const since = series.length ? series[0].date : new Date().toISOString().slice(0, 10);
  const note = `Daily recording began ${since}. The curve appears with the second reading.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${PLACEHOLDER_H}" width="${W}" height="${PLACEHOLDER_H}" role="img" aria-label="GitHub star history for ${esc(REPO)}: ${note}">
  <style>text{font-family:${FONT}}</style>
  <text x="0" y="17" font-size="13" font-weight="600" fill="${t.secondary}">GitHub stars</text>
  <text x="0" y="34" font-size="11" fill="${t.muted}">${esc(REPO)}</text>
  <line x1="0" y1="${PLACEHOLDER_H - 40}" x2="${W}" y2="${PLACEHOLDER_H - 40}" stroke="${t.grid}" stroke-width="1"/>
  <text x="0" y="${PLACEHOLDER_H - 16}" font-size="12" fill="${t.muted}">${note}</text>
</svg>
`;
}

function renderLine(theme, series) {
  const t = THEMES[theme];
  const tMin = series[0].t;
  const tMax = series[series.length - 1].t;
  const span = Math.max(1, tMax - tMin);
  const { top, step } = niceTicks(Math.max(...series.map((d) => d.stars)));

  const sx = (d) => X0 + ((d.t - tMin) / span) * (X1 - X0);
  const sy = (v) => Y1 - (v / top) * (Y1 - Y0);

  const pts = series.map((d) => `${sx(d).toFixed(1)},${sy(d.stars).toFixed(1)}`);
  const linePath = `M${pts.join('L')}`;
  const areaPath = `${linePath}L${X1.toFixed(1)},${Y1}L${X0.toFixed(1)},${Y1}Z`;

  const grid = [];
  for (let v = 0; v <= top; v += step) {
    const y = sy(v);
    grid.push(`<line x1="${X0}" y1="${y.toFixed(1)}" x2="${X1}" y2="${y.toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>`);
    grid.push(`<text x="${X0 - 10}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${t.muted}" style="font-variant-numeric:tabular-nums">${fmt(Math.round(v))}</text>`);
  }

  const last = series[series.length - 1];
  const lastX = sx(last);
  const lastY = sy(last.stars);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub stars for ${esc(REPO)} from ${series[0].date} to ${last.date}, currently ${last.stars}">
  <style>text{font-family:${FONT}}</style>
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.series}" stop-opacity="${t.areaOpacity}"/>
      <stop offset="100%" stop-color="${t.series}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <text x="0" y="17" font-size="13" font-weight="600" fill="${t.secondary}">GitHub stars</text>
  <text x="0" y="34" font-size="11" fill="${t.muted}">${esc(REPO)} · ${series[0].date} → ${last.date}</text>
${grid.join('\n')}
  <path d="${areaPath}" fill="url(#fade)"/>
  <path d="${linePath}" fill="none" stroke="${t.series}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4.5" fill="${t.series}" stroke="${t.surface}" stroke-width="2"/>
  <text x="${(lastX + 12).toFixed(1)}" y="${(lastY + 4).toFixed(1)}" font-size="13" font-weight="600" fill="${t.ink}">${fmt(last.stars)}</text>
  <text x="${X0}" y="${Y1 + 18}" font-size="11" fill="${t.muted}">${series[0].date}</text>
  <text x="${X1}" y="${Y1 + 18}" font-size="11" text-anchor="end" fill="${t.muted}">${last.date}</text>
</svg>
`;
}

const series = readSeries();
for (const theme of ['light', 'dark']) {
  const svg = series.length >= 2 ? renderLine(theme, series) : renderPlaceholder(theme, series);
  fs.writeFileSync(path.join(DIR, `stars-${theme}.svg`), svg);
}

console.log(`stars-light.svg / stars-dark.svg — ${series.length} point(s)`);
