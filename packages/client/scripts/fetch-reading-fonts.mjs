#!/usr/bin/env node
/**
 * §5.5 — 읽기 설정 글꼴을 저장소에 **동봉**하기 위한 내려받기 스크립트.
 *
 * 예전에는 글꼴 이름만 부르고(`font-family: 'Pretendard', …`) OS 에 설치돼 있기를 기대했다.
 * 그러면 고른 글꼴이 조용히 폴백돼 "골랐는데 안 바뀐다"가 되고, 오프라인 데스크톱 앱에서는
 * 되돌릴 방법도 없다. 그래서 웹폰트 파일을 받아 `src/assets/fonts/` 에 넣고 앱이 스스로 싣는다.
 *
 * 받는 것은 전부 **SIL Open Font License 1.1** 글꼴이라 재배포가 허용된다. 라이선스 전문도 같이
 * 받아 글꼴 옆에 둔다(OFL 의 재배포 조건).
 *
 * 용량 규율: 자모별로 쪼갠 수백 개 조각 대신 **묶음 서브셋 파일**(한글 1개 · 라틴 1개)을 받는다.
 * 그래서 글꼴 10종 전체가 40여 개 파일 · 7MB 남짓으로 들어온다. 라틴 면에는 표준 unicode-range 를
 * 달아 뒤에 선언하므로 라틴 글자는 라틴 조각이, 나머지(한글 등)는 한글 조각이 맡는다.
 *
 * 실행:  node packages/client/scripts/fetch-reading-fonts.mjs
 * 결과:  packages/client/src/assets/fonts/<가족>/*.woff2 + LICENSE.txt, 그리고 생성된 fonts.css
 *        (fonts.css 는 손으로 고치지 말고 이 스크립트를 다시 돌릴 것)
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, '..', 'src', 'assets', 'fonts');
const CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * Google Fonts 가 쓰는 표준 라틴 범위. 라틴 조각에만 달아 두면 한글 조각이 라틴 글자까지
 * 가져가는 일(자간·굵기가 어색해진다)을 막는다.
 */
const RANGE_LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
  + 'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const RANGE_LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,'
  + 'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const SUBSET_RANGE = { latin: RANGE_LATIN, 'latin-ext': RANGE_LATIN_EXT };

/**
 * fontsource 규격 가족 — 파일 이름이 `<id>-<subset>-<weight>-<style>.woff2` 로 고정이라
 * 서브셋·굵기만 적으면 나머지는 규칙으로 만든다.
 * `subsets` 순서가 곧 CSS 선언 순서다(범위 없는 한글 조각이 먼저, 좁은 라틴 조각이 나중).
 */
const FONTSOURCE = [
  {
    // §4 (CMD) — 읽기용이 아니라 **터미널 전용** 고정폭. xterm 은 열 정렬이 글꼴 폭에 직결되는데
    //   OS 것(Consolas/Menlo)에 기대면 그 폭이 기계마다 다르고, 애초에 그 둘은 재배포가 안 된다.
    //   JetBrains Mono 는 OFL 이라 동봉할 수 있어 세 OS 에서 같은 화면이 나온다.
    dir: 'jetbrains-mono', id: 'jetbrains-mono', pkg: '@fontsource/jetbrains-mono@5.3.0',
    family: 'JetBrains Mono', subsets: ['latin', 'latin-ext'], weights: [400, 700],
  },
  {
    // 한글 고정폭 — 라틴 폭의 정확히 2배로 설계돼 한국어가 섞여도 터미널 열이 밀리지 않는다.
    //   (맑은 고딕 같은 가변폭으로 폴백되면 CLI 가 그리는 상자·상태줄이 그 줄부터 어긋난다.)
    dir: 'nanum-gothic-coding', id: 'nanum-gothic-coding', pkg: '@fontsource/nanum-gothic-coding@5.3.0',
    family: 'Nanum Gothic Coding', subsets: ['korean', 'latin'], weights: [400, 700],
  },
  {
    dir: 'noto-sans-kr', id: 'noto-sans-kr', pkg: '@fontsource/noto-sans-kr@5.3.0',
    family: 'Noto Sans KR', subsets: ['korean', 'latin', 'latin-ext'], weights: [400, 700],
  },
  {
    dir: 'nanum-gothic', id: 'nanum-gothic', pkg: '@fontsource/nanum-gothic@5.3.0',
    family: 'Nanum Gothic', subsets: ['korean', 'latin'], weights: [400, 700],
  },
  {
    dir: 'nanum-myeongjo', id: 'nanum-myeongjo', pkg: '@fontsource/nanum-myeongjo@5.3.0',
    family: 'Nanum Myeongjo', subsets: ['korean', 'latin'], weights: [400, 700],
  },
  {
    dir: 'ibm-plex-sans-kr', id: 'ibm-plex-sans-kr', pkg: '@fontsource/ibm-plex-sans-kr@5.3.0',
    family: 'IBM Plex Sans KR', subsets: ['korean', 'latin', 'latin-ext'], weights: [400, 700],
  },
  {
    dir: 'gothic-a1', id: 'gothic-a1', pkg: '@fontsource/gothic-a1@5.3.0',
    family: 'Gothic A1', subsets: ['korean', 'latin', 'latin-ext'], weights: [400, 700],
  },
  {
    // 저시력 판독성 연구에서 나온 글꼴 — 기울임까지 실제 자형이 있어 함께 받는다.
    dir: 'atkinson-hyperlegible', id: 'atkinson-hyperlegible', pkg: '@fontsource/atkinson-hyperlegible@5.3.0',
    family: 'Atkinson Hyperlegible', subsets: ['latin', 'latin-ext'], weights: [400, 700], styles: ['normal', 'italic'],
  },
];

/**
 * 가변 글꼴(굵기 축 하나로 전 굵기 커버) — 파일 이름이 `<id>-<subset>-wght-<style>.woff2`.
 * 패키지가 부르는 이름은 'Lexend Variable' 처럼 뒤에 Variable 이 붙지만, 레지스트리·CSS 는
 * 사람이 아는 이름을 쓰므로 여기서 원래 이름으로 되돌려 선언한다.
 */
const FONTSOURCE_VARIABLE = [
  {
    dir: 'lexend', id: 'lexend', pkg: '@fontsource-variable/lexend@5.3.0',
    family: 'Lexend', subsets: ['latin', 'latin-ext'], styles: ['normal'],
  },
  {
    dir: 'inter', id: 'inter', pkg: '@fontsource-variable/inter@5.3.0',
    family: 'Inter', subsets: ['latin', 'latin-ext'], styles: ['normal', 'italic'],
  },
];

/** 규격 밖 배포본 — 파일 위치를 그대로 적는다. */
const EXPLICIT = [
  {
    dir: 'pretendard', family: 'Pretendard',
    faces: [{
      // 가변 단일 파일(45~920) — 앱 기본 글꼴(`--font-sans`)의 첫 후보이기도 하다.
      url: `${CDN}/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2`,
      file: 'PretendardVariable.woff2', weight: '45 920', style: 'normal',
    }],
    license: `${CDN}/pretendard@1.3.9/dist/LICENSE.txt`,
  },
  {
    dir: 'spoqa-han-sans-neo', family: 'Spoqa Han Sans Neo',
    faces: [
      {
        url: `${CDN}/spoqa-han-sans@3.3.0/Subset/SpoqaHanSansNeo/SpoqaHanSansNeo-Regular.woff2`,
        file: 'SpoqaHanSansNeo-Regular.woff2', weight: '400', style: 'normal',
      },
      {
        url: `${CDN}/spoqa-han-sans@3.3.0/Subset/SpoqaHanSansNeo/SpoqaHanSansNeo-Bold.woff2`,
        file: 'SpoqaHanSansNeo-Bold.woff2', weight: '700', style: 'normal',
      },
    ],
    license: `${CDN}/spoqa-han-sans@3.3.0/Subset/SpoqaHanSansNeo/LICENSE_OFL.txt`,
  },
];

/** 가족별 면(face) 목록을 하나로 편다. */
function planFaces() {
  const plan = [];
  for (const f of FONTSOURCE) {
    const faces = [];
    for (const style of f.styles ?? ['normal']) {
      for (const weight of f.weights) {
        for (const subset of f.subsets) {
          const file = `${f.id}-${subset}-${weight}-${style}.woff2`;
          faces.push({
            url: `${CDN}/${f.pkg}/files/${file}`,
            file, weight: String(weight), style, range: SUBSET_RANGE[subset],
          });
        }
      }
    }
    plan.push({ dir: f.dir, family: f.family, faces, license: `${CDN}/${f.pkg}/LICENSE` });
  }
  for (const f of FONTSOURCE_VARIABLE) {
    const faces = [];
    for (const style of f.styles) {
      for (const subset of f.subsets) {
        const file = `${f.id}-${subset}-wght-${style}.woff2`;
        faces.push({
          url: `${CDN}/${f.pkg}/files/${file}`,
          file, weight: '100 900', style, range: SUBSET_RANGE[subset],
        });
      }
    }
    plan.push({ dir: f.dir, family: f.family, faces, license: `${CDN}/${f.pkg}/LICENSE` });
  }
  plan.push(...EXPLICIT);
  return plan;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function faceBlock(family, dir, face) {
  const lines = [
    '@font-face {',
    `  font-family: '${family}';`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url('./${dir}/${face.file}') format('woff2');`,
  ];
  if (face.range) lines.push(`  unicode-range: ${face.range};`);
  lines.push('}');
  return lines.join('\n');
}

async function main() {
  const plan = planFaces();
  await mkdir(OUT_ROOT, { recursive: true });

  const blocks = [];
  let total = 0;
  for (const family of plan) {
    const dir = join(OUT_ROOT, family.dir);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    for (const face of family.faces) {
      const buf = await download(face.url);
      await writeFile(join(dir, face.file), buf);
      total += buf.length;
      process.stdout.write(`  ${family.family} ${face.style} ${face.weight} ${face.file} (${Math.round(buf.length / 1024)} kB)\n`);
      blocks.push(faceBlock(family.family, family.dir, face));
    }

    try {
      await writeFile(join(dir, 'LICENSE.txt'), await download(family.license));
    } catch (err) {
      // 라이선스를 못 받으면 조용히 넘어가지 않는다 — OFL 은 전문 동봉을 요구한다.
      throw new Error(`LICENSE download failed for ${family.family}: ${err.message}`);
    }
  }

  const header = [
    '/*',
    ' * 자동 생성 — `node packages/client/scripts/fetch-reading-fonts.mjs` 가 만든다. 손으로 고치지 말 것.',
    ' *',
    ' * §5.5 읽기 설정에서 고를 수 있는 글꼴을 앱에 동봉해 싣는다. 전부 SIL Open Font License 1.1 이며',
    ' * 각 글꼴 폴더의 LICENSE.txt 에 전문이 있다. 라틴 조각이 뒤에 선언되고 unicode-range 가 좁으므로',
    ' * 라틴 글자는 라틴 조각이, 한글을 비롯한 나머지는 앞의 조각이 맡는다.',
    ' */',
    '',
  ].join('\n');
  await writeFile(join(OUT_ROOT, 'fonts.css'), `${header}${blocks.join('\n\n')}\n`);

  process.stdout.write(`\n${plan.length} families · ${blocks.length} files · ${(total / 1048576).toFixed(2)} MB\n`);
}

main().catch((err) => {
  process.stderr.write(`fetch-reading-fonts failed: ${err.message}\n`);
  process.exit(1);
});
