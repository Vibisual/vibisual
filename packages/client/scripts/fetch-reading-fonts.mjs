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
import { brotliDecompressSync } from 'node:zlib';

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

/**
 * §5.5 #17-22 ⑤-3 — **문자 폴백 글꼴**. 읽기 목록(`READING_FONTS`)에는 안 나온다.
 * 사용자가 *고르는* 글꼴이 아니라, UI 언어를 中文·日本語·हिन्दी 로 바꿨을 때 **글자가 두부로
 * 사라지지 않게 하는** 폴백이다(윈도우·맥은 OS 글꼴이 조용히 메우지만 최소 설치 리눅스는
 * `fc-list :lang=zh-cn|ja|hi` 가 0 이다).
 *
 * 위 두 갈래와 달리 **파일 목록을 우리가 적지 않고 fontsource 가 발행한 CSS 를 읽어 온다.**
 * 한자는 묶음 서브셋 한 덩어리로 받으면 한 글자를 그리려고 수 MB 를 통째로 해독해야 해서,
 * 조각별 `unicode-range` 가 있어야 브라우저가 쓰는 조각만 해독한다 — 그 범위를 손으로 옮겨
 * 적으면 100 조각이 넘고 갱신 때마다 어긋나므로, 발행자의 CSS 를 정본으로 삼는다.
 * 굵기는 400/700 두 벌 대신 **가변 축 하나(100~900)** 로 받아 용량을 2/3 로 줄인다.
 */
const FONTSOURCE_SPLIT = [
  {
    dir: 'noto-sans-sc', family: 'Noto Sans SC',
    pkg: '@fontsource-variable/noto-sans-sc@5.3.0', weight: '100 900',
  },
  {
    dir: 'noto-sans-jp', family: 'Noto Sans JP',
    pkg: '@fontsource-variable/noto-sans-jp@5.3.0', weight: '100 900',
  },
  {
    dir: 'noto-sans-devanagari', family: 'Noto Sans Devanagari',
    pkg: '@fontsource-variable/noto-sans-devanagari@5.3.0', weight: '100 900',
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

/**
 * §5.5 ⑤-3 — 조각으로 쪼개 발행된 가족은 **발행자의 CSS 가 정본**이다.
 * `index.css` 를 받아 `@font-face` 블록마다 (woff2 파일 이름 · `unicode-range`) 만 뽑아 온다.
 * 파일 이름을 우리가 규칙으로 만들지 않는 이유는 조각 번호가 글꼴 갱신마다 달라지기 때문이고,
 * 범위를 우리가 적지 않는 이유는 100 조각이 넘어 손으로 옮기면 반드시 어긋나기 때문이다.
 */
async function planSplitFamilies() {
  const plan = [];
  for (const f of FONTSOURCE_SPLIT) {
    const css = (await download(`${CDN}/${f.pkg}/index.css`)).toString('utf8');
    const faces = [];
    for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const file = block.match(/url\(\.\/files\/([^)'"\s]+\.woff2)\)/)?.[1];
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
      // 범위 없는 조각은 뒤 조각이 앞을 통째로 덮어 버려 폴백이 무너진다 — 조용히 넘기지 않는다.
      if (!file || !range) throw new Error(`${f.family}: cannot parse @font-face (file=${file}, range=${range})`);
      faces.push({ url: `${CDN}/${f.pkg}/files/${file}`, file, weight: f.weight, style: 'normal', range });
    }
    if (faces.length === 0) throw new Error(`${f.family}: no @font-face found in ${f.pkg}/index.css`);
    plan.push({ dir: f.dir, family: f.family, faces, license: `${CDN}/${f.pkg}/LICENSE` });
  }
  return plan;
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

/* ---------------------------------------------------------------- 커버리지 */

/**
 * §5.5 ⑤-3 — **어느 가족이 어떤 글자를 실제로 그릴 수 있는가**를 여기서 재어 `fonts.coverage.json`
 * 으로 내보낸다. 두부(□)는 화면을 띄워야만, 그것도 리눅스에서만 보이는 결함이라 회귀 테스트가
 * 필요한데, 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가 woff2 를 직접 못 연다.
 * 그래서 **파일을 이미 손에 쥔 이 스크립트가** 재고, 테스트는 그 결과만 읽는다.
 *
 * `unicode-range` 선언은 "이 조각을 이 범위에 쓰겠다"일 뿐 그 안에 글자가 다 있다는 뜻이 아니므로
 * `선언 범위 ∩ 실제 cmap` 으로 잡는다(브라우저가 폴백을 정하는 방식과 같다).
 */
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function readUIntBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[cursor.at];
    cursor.at += 1;
    value = ((value << 7) | (byte & 0x7f)) >>> 0;
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('UIntBase128 이 5바이트를 넘습니다 — 깨진 woff2');
}

function cmapFormat4(cmap, off, out) {
  const segCountX2 = cmap.readUInt16BE(off + 6);
  const endBase = off + 14;
  const startBase = endBase + segCountX2 + 2;
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;
  for (let i = 0; i < segCountX2 / 2; i += 1) {
    const end = cmap.readUInt16BE(endBase + i * 2);
    const start = cmap.readUInt16BE(startBase + i * 2);
    if (start === 0xffff) continue;
    const delta = cmap.readInt16BE(deltaBase + i * 2);
    const rangeOffset = cmap.readUInt16BE(rangeBase + i * 2);
    for (let cp = start; cp <= end; cp += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const at = rangeBase + i * 2 + rangeOffset + (cp - start) * 2;
        if (at + 1 >= cmap.length) continue;
        glyph = cmap.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
}

function cmapFormat12(cmap, off, out) {
  const groups = cmap.readUInt32BE(off + 12);
  for (let i = 0; i < groups; i += 1) {
    const at = off + 16 + i * 12;
    const start = cmap.readUInt32BE(at);
    const end = cmap.readUInt32BE(at + 4);
    for (let cp = start; cp <= end; cp += 1) out.add(cp);
  }
}

/** woff2 는 sfnt 를 통째로 brotli 로 누른 것이라, 표 디렉터리로 `cmap` 자리를 계산해 그것만 읽는다. */
function woff2Codepoints(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('woff2 가 아닙니다');
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  const cursor = { at: 48 };
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[cursor.at];
    cursor.at += 1;
    const tagIndex = flags & 0x3f;
    const transformVersion = (flags >> 6) & 0x03;
    let tag;
    if (tagIndex === 63) {
      tag = buf.toString('latin1', cursor.at, cursor.at + 4);
      cursor.at += 4;
    } else tag = WOFF2_KNOWN_TAGS[tagIndex] ?? `?${tagIndex}`;
    const origLength = readUIntBase128(buf, cursor);
    // glyf/loca 만 "변환 버전 3 = 변환 없음"으로 뜻이 뒤집힌다.
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
    tables.push({ tag, length: transformed ? readUIntBase128(buf, cursor) : origLength });
  }

  const font = brotliDecompressSync(buf.subarray(cursor.at, cursor.at + compressedSize));
  let offset = 0;
  let cmapAt = -1;
  let cmapLength = 0;
  for (const table of tables) {
    if (table.tag === 'cmap') {
      cmapAt = offset;
      cmapLength = table.length;
    }
    offset += table.length;
  }
  if (cmapAt < 0) throw new Error('cmap 표가 없습니다');

  const cmap = font.subarray(cmapAt, cmapAt + cmapLength);
  const out = new Set();
  const subtables = cmap.readUInt16BE(2);
  for (let i = 0; i < subtables; i += 1) {
    const at = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(at);
    if (format === 4) cmapFormat4(cmap, at, out);
    else if (format === 12) cmapFormat12(cmap, at, out);
  }
  return out;
}

/** 선언된 `unicode-range` 문자열을 [시작, 끝] 쌍으로. */
function parseRange(value) {
  return value.split(',').map((part) => {
    const [lo, hi] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
  });
}

/** 코드포인트 집합을 `unicode-range` 와 같은 문법의 압축 문자열로(연속 구간은 한 덩어리로). */
function toRangeText(codepoints) {
  const sorted = [...codepoints].sort((a, b) => a - b);
  const parts = [];
  let start = -1;
  let prev = -2;
  for (const cp of sorted) {
    if (cp !== prev + 1) {
      if (start >= 0) parts.push(start === prev ? start.toString(16) : `${start.toString(16)}-${prev.toString(16)}`);
      start = cp;
    }
    prev = cp;
  }
  if (start >= 0) parts.push(start === prev ? start.toString(16) : `${start.toString(16)}-${prev.toString(16)}`);
  return parts.join(',');
}

async function main() {
  const plan = [...planFaces(), ...await planSplitFamilies()];
  await mkdir(OUT_ROOT, { recursive: true });
  /** 가족 이름 → 그릴 수 있는 코드포인트 집합. */
  const coverage = new Map();

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

      const covered = coverage.get(family.family) ?? new Set();
      const cmap = woff2Codepoints(buf);
      if (face.range) {
        // 선언 범위 밖은 브라우저가 이 조각을 아예 안 쓴다 — 그러니 교집합만 인정한다.
        for (const [lo, hi] of parseRange(face.range)) {
          for (let cp = lo; cp <= hi; cp += 1) if (cmap.has(cp)) covered.add(cp);
        }
      } else for (const cp of cmap) covered.add(cp);
      coverage.set(family.family, covered);
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
    ' *',
    ' * 끝의 Noto Sans SC · JP · Devanagari 는 읽기 목록에 없는 **문자 폴백**(§5.5 #17-22 ⑤-3) 이다 —',
    ' * 고르는 글꼴이 아니라 中文·日本語·हिन्दी 가 두부로 사라지지 않게 하는 자리이고, 조각마다',
    ' * unicode-range 가 붙어 있어 브라우저가 실제로 쓰는 조각만 해독한다.',
    ' */',
    '',
  ].join('\n');
  await writeFile(join(OUT_ROOT, 'fonts.css'), `${header}${blocks.join('\n\n')}\n`);

  // §5.5 ⑤-3 — 커버리지 정본. `src/i18n/localeFontCoverage.test.ts` 가 이것과 로케일 문자열을 대조한다.
  const manifest = {
    _: '자동 생성 — fetch-reading-fonts.mjs. 가족 이름 → 그릴 수 있는 코드포인트(16진, unicode-range 문법).',
    families: Object.fromEntries(
      [...coverage].sort(([a], [b]) => a.localeCompare(b)).map(([family, cps]) => [family, toRangeText(cps)]),
    ),
  };
  await writeFile(join(OUT_ROOT, 'fonts.coverage.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const glyphs = [...coverage.values()].reduce((n, s) => n + s.size, 0);
  process.stdout.write(`\n${plan.length} families · ${blocks.length} files · ${(total / 1048576).toFixed(2)} MB · ${glyphs} codepoints\n`);
}

main().catch((err) => {
  process.stderr.write(`fetch-reading-fonts failed: ${err.message}\n`);
  process.exit(1);
});
