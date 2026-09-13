import { describe, it, expect } from 'vitest';

/**
 * §5.5 사이드바 뷰 헤더 — **제목 줄이 자기 칸을 넘거나 아래와 겹치지 않는다.**
 *
 * 활동바 옆 뷰(목표·루프·검증)는 전부 같은 모양이다: `제목 + 상태 배지` 한 줄이 위에 서고 그
 * 아래를 `ScrollFade` 가 채운다. 이 한 줄은 폭이 고정이 아니다 —
 *
 * - 사이드바는 좁은 창에서 **서랍**으로 뜨고, 그때 폭 상한이 `max-w-[calc(100%-5rem)]` 이라
 *   창을 줄이면 평소의 `w-52`(208px)보다도 얇아진다.
 * - 제목·상태 문구 길이는 12개 로케일마다 다르다("정지됨" 3글자 ↔ "Presupuesto agotado" 19글자).
 *
 * 종전 루프·검증 헤더는 제목에 `min-w-0` 이 없어 **제목이 줄지 않았고**, 배지는 `flex-shrink-0`
 * 이라 줄 수 없었다. 둘이 한 줄에 못 서면 배지가 패널 오른쪽 테두리 **밖으로 밀려 잘렸다.**
 * (신고 원문: "스크롤 내리니까 외각 라인이 아래 겹쳐지는 현상인데 반응형으로 잘조절해 안짤리게")
 *
 * 헤더에 아래 여백이 없는 것도 같은 줄의 문제였다 — 스크롤을 내리는 순간 나타나는
 * `.scroll-fade-top`(12px·z-10)이 배지 밑변에 그대로 달라붙어 배지가 반쯤 덮인 것처럼 보인다.
 *
 * 그래서 이 모양의 헤더는 셋을 모두 들고 있어야 한다.
 *   ① `flex-wrap`          — 한 줄에 못 서면 아랫줄로 내려간다(밖으로 밀려 잘리지 않는다).
 *   ② `pb-*`               — 스크롤 그라데이션이 붙을 자리를 미리 띄운다.
 *   ③ 제목에 `min-w-0`+`truncate` — 제목이 먼저 줄어 배지를 패널 밖으로 밀지 않는다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가
 * 타입체크에서 막힌다. 대신 `import.meta.glob(?raw)` 로 같은 파일들을 문자열로 받는다
 * (`sessionLabelClamp.test.ts` 와 같은 수법).
 */

const ideSources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true });

/** 사이드바 뷰 헤더의 지문 — 줄지 않는 한 줄이 `px-3 pt-2` 로 스크롤 영역 위에 서 있다. */
function isViewHeader(cls: string): boolean {
  return /\bflex-shrink-0\b/.test(cls) && /\bpx-3\b/.test(cls) && /\bpt-2\b/.test(cls);
}

/** 제목 칸의 지문 — 이 자리의 낱말은 전부 대문자·자간 넓힘으로 그린다. */
const TITLE_TAG = /uppercase\s+tracking-wider/;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** 여는 태그 하나를 통째로 집는다 — 속성이 여러 줄로 흩어져 있어도 `>` 까지가 한 태그다. */
function openTagAt(raw: string, at: number): string {
  const end = raw.indexOf('>', at);
  return end < 0 ? raw.slice(at) : raw.slice(at, end + 1);
}

interface ViewHeader {
  path: string;
  line: number;
  /** 헤더 `<div>` 의 className 원문. */
  tag: string;
  /** 헤더부터 그 아래 스크롤 영역 직전까지 — 제목·배지가 이 안에 있다. */
  block: string;
}

const headers: ViewHeader[] = [];

for (const [key, raw] of Object.entries(ideSources as Record<string, string>)) {
  const path = key.replace(/^\.\//, '');
  if (/\.test\.tsx?$/.test(path)) continue;

  for (const m of raw.matchAll(/<div\s+className="([^"]*)"/g)) {
    const cls = m[1] ?? '';
    if (!isViewHeader(cls)) continue;
    const at = m.index ?? 0;
    const fadeAt = raw.indexOf('<ScrollFade', at);
    headers.push({
      path,
      line: lineOf(raw, at),
      tag: cls,
      block: raw.slice(at, fadeAt > at ? fadeAt : at + 2000),
    });
  }
}

describe('IDE 사이드바 뷰 헤더 — 좁은 폭·긴 로케일에서도 잘리지 않는다', () => {
  it('이 모양의 헤더가 실제로 있다 — 지문이 바뀌면 아래 검사가 헛돈다', () => {
    expect(headers.length).toBeGreaterThanOrEqual(3);
  });

  it('① 한 줄에 못 서면 아랫줄로 내려간다 — flex-wrap', () => {
    const bad = headers.filter((h) => !/\bflex-wrap\b/.test(h.tag)).map((h) => `${h.path}:${h.line}`);
    expect(bad, `헤더에 flex-wrap 이 없다(넘치면 패널 테두리 밖으로 밀려 잘린다):\n${bad.join('\n')}`).toEqual([]);
  });

  it('② 스크롤 그라데이션이 붙을 자리를 미리 띄운다 — pb-*', () => {
    const bad = headers.filter((h) => !/\bpb-[\w.[\]/-]+/.test(h.tag)).map((h) => `${h.path}:${h.line}`);
    expect(bad, `헤더에 아래 여백(pb-*)이 없다(.scroll-fade-top 이 배지 밑변에 달라붙는다):\n${bad.join('\n')}`).toEqual([]);
  });

  it('③ 제목이 먼저 줄어 배지를 밖으로 밀지 않는다 — min-w-0 + truncate', () => {
    const bad: string[] = [];

    for (const h of headers) {
      let found = false;
      for (const s of h.block.matchAll(/<span\b/g)) {
        const tag = openTagAt(h.block, s.index ?? 0);
        if (!TITLE_TAG.test(tag)) continue;
        found = true;
        if (!/\bmin-w-0\b/.test(tag) || !/\btruncate\b/.test(tag)) {
          bad.push(`${h.path}:${h.line} — 제목 칸에 min-w-0/truncate 가 없다`);
        }
      }
      if (!found) bad.push(`${h.path}:${h.line} — 제목 칸(uppercase tracking-wider)을 못 찾았다`);
    }

    expect(bad, bad.join('\n')).toEqual([]);
  });
});
