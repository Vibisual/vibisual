import { describe, expect, it } from 'vitest';

/**
 * §5.4 #15 (D) — Alt 인스펙터 덮개가 모든 층 위인지: 소스의 모든 z-index 숫자가 덮개보다 낮은지 센다.
 * `node:fs` 를 쓰지 않는다 — 클라 tsconfig 에 Node 타입이 없다(`enterKeyOwnerContract.test.ts` 와 같은 방식).
 */

const sources = import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const CSS_Z_MAX = 2_147_483_647;

/** glob 열쇠는 이 파일 기준 상대 경로다 — 같은 폴더면 `./InspectorOverlay.tsx` 로 줄어든다. */
const isOverlayFile = (key: string): boolean => /(^|\/)InspectorOverlay\.tsx$/.test(key);

function overlayZ(): number {
  const entry = Object.entries(sources).find(([key]) => isOverlayFile(key));
  const m = entry ? /id=\{INSPECTOR_OVERLAY_ID\}[^>]*\bz-\[(\d+)\]/.exec(entry[1]) : null;
  return m?.[1] ? Number(m[1]) : NaN;
}

/** 소스에 적힌 z-index 숫자들 — Tailwind `z-[N]`, `zIndex: N`, `…_Z = N` / `…Z_BASE = N` 꼴 상수. */
function zLiterals(): Array<{ file: string; value: number }> {
  const out: Array<{ file: string; value: number }> = [];
  const patterns = [/\bz-\[(\d[\d_]*)\]/g, /\bzIndex:\s*(\d[\d_]*)/g, /\b[A-Z][A-Z0-9_]*Z(?:_BASE)?\s*=\s*(\d[\d_]*)/g];
  for (const [file, text] of Object.entries(sources)) {
    if (/[.]test[.]tsx?$/.test(file) || isOverlayFile(file)) continue;
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        if (m[1]) out.push({ file, value: Number(m[1].replace(/_/g, '')) });
      }
    }
  }
  return out;
}

describe('§5.4 #15 (D) Alt 인스펙터 덮개는 모든 층 위', () => {
  it('덮개는 CSS 가 허락하는 가장 높은 층이다', () => {
    expect(overlayZ()).toBe(CSS_Z_MAX);
  });

  it('다른 어떤 층도 덮개와 같거나 높지 않다(같으면 문서 뒤쪽 포털이 위로 그려진다)', () => {
    const literals = zLiterals();
    // 시험이 실제로 층들을 읽고 있는지 — 앱 안 창 스택과 스튜디오 팝오버가 보여야 한다.
    expect(literals.some((l) => l.value === 1_000_000)).toBe(true);
    expect(literals.some((l) => l.value >= 2_000_000_000)).toBe(true);
    const offenders = literals.filter((l) => l.value >= overlayZ()).map((l) => `${l.file}: ${l.value}`);
    expect(offenders).toEqual([]);
  });
});
