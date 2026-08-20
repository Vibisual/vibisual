import { describe, it, expect } from 'vitest';

/**
 * §9 **UI 텍스트 가독 하한의 집행** — 앞으로 쓰는 화면도 자동으로 이 바닥 위에 서게 한다.
 *
 * 한글은 라틴이 멀쩡한 크기에서 **먼저** 무너진다. 음절 하나에 초·중·종성을 쌓아 획 간격이 라틴의
 * 절반 이하라, 9px 에서는 획 폭이 1픽셀보다 얇아져 **어떤 픽셀도 지정한 색에 도달하지 못한다** —
 * 글자가 형태가 아니라 안티에일리어싱 안개로만 남는다. 실측(Pretendard·DPR 1, 획 픽셀이 제 색에
 * 도달하는 비율): `8px 0.0% · 9px 7.7% · 10px 14.3% · 11px 14.7% · 12px 23.9% · 14px 34.2%`.
 *
 * ⚠ **색 문제로 오진하기 쉽다.** 8px 을 `gray-300` 으로 밝혀도 획은 똑같이 무너지고, 12px 은
 * `gray-500` 으로도 읽힌다. "글씨가 안 보인다"는 신고가 오면 **색보다 크기를 먼저** 본다.
 *
 * 그래서 세 가지를 여기서 못 박는다.
 *
 *  ① `text-[Npx]` 는 **12px 미만 금지** — 배지·경로·힌트·보조 라벨도 예외 없다.
 *  ② **소수점 px 금지** — 획이 픽셀 격자 사이에 걸쳐 같은 값의 정수 px 보다 흐려진다.
 *  ③ 인라인 `fontSize` 숫자도 같은 바닥 — 단, **캔버스 월드 좌표 텍스트**는 예외다(아래 표).
 *
 * 위계를 더 좁히고 싶으면 크기를 줄이지 말고 **굵기·색·대문자·자간**으로 만든다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가
 * 타입체크에서 막힌다. 대신 Vite 의 `import.meta.glob(?raw)` 로 같은 파일들을 문자열로 받는다.
 */

const tsSources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true });
const tsxSources = import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** 가독 하한(px). §9 · docs/rules/coding.md 와 같은 값이어야 한다. */
const FLOOR_PX = 12;

/**
 * 인라인 `fontSize` 예외 — **캔버스 월드 좌표 텍스트**.
 * 줌·버블 크기에 따라 실제 렌더 크기가 변하므로 CSS px 하한이 그대로 적용되지 않는다.
 * (그쪽은 `Math.max()` 로 자기 바닥을 갖는다.) DOM 크롬 텍스트는 여기 등록하면 안 된다.
 */
const INLINE_FONT_SIZE_EXCEPTIONS: Record<string, string> = {
  'components/BubbleMap/BubbleNode.tsx': '버블 라벨 — 버블 크기(ts)에 비례해 커지는 월드 좌표 텍스트.',
  'components/BubbleMap/LayoutBoundsBox.tsx': '캔버스 배치 가이드 오버레이 — 줌과 함께 확대된다.',
  'components/Panel/DebugPanel.tsx': 'React Flow 엣지 라벨(labelStyle) — 캔버스 좌표.',
  'utils/flowBuilder.ts': 'React Flow 엣지 라벨(labelStyle) — 캔버스 좌표.',
  'components/IDE/ImageAnnotator.tsx': '이미지 위 주석 — 이미지 배율(scale)에 비례한다.',
};

/** glob 키(`./components/…`)를 src 기준 경로로 편다. */
function toSrcPath(key: string): string {
  return key.replace(/^\.\//, '');
}

/** 검사 대상 소스 — 테스트 파일은 뺀다. */
function collectSources(): { path: string; text: string }[] {
  const all = { ...tsSources, ...tsxSources } as Record<string, string>;
  return Object.entries(all)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/\.test\.tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 소스에서 줄 번호를 찾는다(위반 보고용). */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

const SOURCES = collectSources();

describe('§9 UI 텍스트 가독 하한', () => {
  it('스캔이 실제로 소스를 읽는다', () => {
    // glob 이 빈 객체를 돌려주면 아래 규칙 검사들이 **전부 조용히 통과**한다.
    // 집행 테스트가 아무것도 집행하지 않는 상태로 남는 것을 여기서 막는다.
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES.some(({ text }) => text.includes('className'))).toBe(true);
  });

  it(`Tailwind 글꼴 크기가 ${FLOOR_PX}px 미만이 아니다`, () => {
    const violations: string[] = [];
    for (const { path, text } of SOURCES) {
      const re = /text-\[(\d+(?:\.\d+)?)px\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const px = Number(m[1]);
        if (px < FLOOR_PX) violations.push(`${path}:${lineOf(text, m.index)}  ${m[0]}`);
      }
    }
    expect(violations, [
      `${FLOOR_PX}px 미만 글꼴이 ${violations.length}곳 있습니다 — 한글 획이 무너져 읽히지 않습니다.`,
      `크기를 줄이는 대신 font-semibold · 색 · uppercase · tracking 으로 위계를 만드세요(§9).`,
    ].join('\n')).toEqual([]);
  });

  it('Tailwind 글꼴 크기에 소수점 px 을 쓰지 않는다', () => {
    const violations: string[] = [];
    for (const { path, text } of SOURCES) {
      const re = /text-\[(\d+\.\d+)px\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        violations.push(`${path}:${lineOf(text, m.index)}  ${m[0]}`);
      }
    }
    expect(violations, '소수점 px 은 획을 픽셀 격자 사이에 걸쳐 같은 값의 정수 px 보다 흐려집니다(§9).')
      .toEqual([]);
  });

  it(`인라인 fontSize 도 ${FLOOR_PX}px 하한을 지킨다(캔버스 텍스트만 예외)`, () => {
    const violations: string[] = [];
    for (const { path, text } of SOURCES) {
      if (INLINE_FONT_SIZE_EXCEPTIONS[path]) continue;
      // `fontSize: 9` 같은 직접 지정과 `fontSize: Math.max(5, …)` 같은 자체 바닥 둘 다 본다.
      const re = /fontSize:\s*(?:Math\.max\(\s*)?(\d+(?:\.\d+)?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const px = Number(m[1]);
        if (px < FLOOR_PX) violations.push(`${path}:${lineOf(text, m.index)}  ${m[0]}`);
      }
    }
    expect(violations, [
      `인라인 fontSize 가 ${FLOOR_PX}px 미만인 곳이 ${violations.length}곳 있습니다.`,
      '줌에 따라 크기가 변하는 캔버스 월드 좌표 텍스트라면 INLINE_FONT_SIZE_EXCEPTIONS 에 이유와 함께 등록하세요.',
    ].join('\n')).toEqual([]);
  });

  it('예외 표에 죽은 항목이 없다', () => {
    const known = new Set(SOURCES.map((s) => s.path));
    const dead = Object.keys(INLINE_FONT_SIZE_EXCEPTIONS).filter((p) => !known.has(p));
    expect(dead, '없는 파일이 예외로 남아 있습니다 — 지우세요.').toEqual([]);
  });
});
