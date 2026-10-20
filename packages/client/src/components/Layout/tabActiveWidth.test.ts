import { describe, it, expect } from 'vitest';

/**
 * §5.4 #14 — **고른 탭은 이름이 보인다.** 탭은 한 칸(128px)을 이름·배지(`1/19`)·닫기 버튼이 나눠 써서,
 * 지금 보고 있는 프로젝트조차 `P_M…` 로 읽혔다(사용자 지시). 고른 탭만 폭이 이름을 따라가고, 이름 칸은
 * 상한(페이드 여백 포함 200px)까지 보인 뒤 그보다 긴 것만 끝에서 흐려진다. 고르지 않은 탭은 한 칸이다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다 —
 * `tabPointerDrag.test.ts` 와 같은 방식이다.
 */
const sources = import.meta.glob(['./TabBar.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = Object.values(sources)[0] ?? '';

describe('§5.4 #14 고른 탭은 이름을 따라 넓어진다', () => {
  it('기준은 이름 칸 하나다 — 고른 탭 이름 상한 200px, 탭은 한 칸보다 좁아지지 않는다', () => {
    expect(src).toMatch(/const TAB_LABEL_ACTIVE_MAX = 'max-w-\[200px\]'/);
    expect(src).toMatch(/const TAB_WIDTH_ACTIVE = 'min-w-32'/);
    expect(src).toMatch(/const TAB_WIDTH_IDLE = 'w-32'/);
  });

  it('프로젝트 탭·iframe 탭 둘 다 — 고른 탭만 폭이 풀리고, 고르지 않은 탭은 한 칸 그대로', () => {
    // 고른 갈래와 고르지 않은 갈래가 탭 종류마다 한 번씩(프로젝트 · iframe).
    expect(src.match(/\? `\$\{TAB_WIDTH_ACTIVE\} h-full/g)).toHaveLength(2);
    expect(src.match(/: `\$\{TAB_WIDTH_IDLE\} mt-\[5px\]/g)).toHaveLength(2);
    // 탭 본체 공통 className 에 한 칸 폭을 다시 박으면 고른 탭까지 도로 눌린다.
    expect(src).not.toContain('relative flex w-32 flex-shrink-0 items-center');
  });

  it('이름 칸 상한은 고른 탭에만 — 두 종류 모두 같은 페이드 경계를 쓴다', () => {
    const labels = src.match(/<HoverTooltip className=\{`min-w-0 flex-1 tab-selection-label \$\{isActive \? TAB_LABEL_ACTIVE_MAX : ''\}`\}/g);
    expect(labels).toHaveLength(2);
  });

  it('고른 탭이 바뀌면 페이드·썸을 다시 잰다 — 줄 길이가 바뀌어도 스크롤 칸 크기는 그대로다', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ updateScrollState\(\); \}, \[activeKey, updateScrollState\]\)/);
  });
});
