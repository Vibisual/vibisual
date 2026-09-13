/**
 * 펼친 프롬프트 말풍선은 **IDE 어디를 눌러도 접힌다** — 그 배선이 남아 있는지, 그리고 접히는 규칙이
 * 무엇을 살려 두는지 못 박는다.
 *
 * 왜 필요한가: 접는 손짓이 "머리줄을 다시 정확히 찾아 누르기" 하나뿐이면, 내가 쓴 글을 확인하고
 * 되돌아가는 흔한 동작이 매번 조준을 요구한다(사용자 보고). 그렇다고 아무 press 로나 접으면 이번엔
 * **펼친 본문을 긁어 복사하는 도중에** 접혀 버린다 — 확인하려고 펼친 것인데 확인을 방해한다.
 * 두 요구는 팝업 닫기와 같은 모양이라 같은 규약([popupDismiss.ts](../../hooks/popupDismiss.ts))이
 * 답을 낸다. 여기서는 ① 말풍선이 그 규약에 실제로 배선돼 있는지(소스 스캔)와 ② 규약이 이 자리에서
 * 내는 답(순수 판정)을 함께 고정한다.
 *
 * jsdom 이 없어 렌더 테스트는 못 한다 — 소스는 `import.meta.glob(?raw)` 로 문자열로 받는다
 * (`popupDismissContract.test.ts` 와 같은 방식).
 */
import { describe, it, expect } from 'vitest';
import { createInsideGestureLatch } from '../../hooks/popupDismiss.js';

const source = import.meta.glob('./CollapsiblePrompt.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})['./CollapsiblePrompt.tsx'] as string | undefined;

describe('펼친 말풍선 바깥 클릭 접기 — 배선', () => {
  it('소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 검사들이 전부 통과해 집행이 무력해진다.
    expect(source).toBeTypeOf('string');
    expect((source ?? '').length).toBeGreaterThan(1000);
  });

  it('공통 규약 훅으로 접는다 — 직접 리스너를 달지 않는다', () => {
    const text = source ?? '';
    expect(text).toContain('useOutsidePressDismiss');
    // 직접 배선은 규약 밖으로 나가는 길 — `popupDismissContract` 와 같은 금지를 이 파일에도 건다.
    expect(text).not.toContain("addEventListener('mousedown'");
    expect(text).not.toContain("addEventListener('pointerdown'");
  });

  it('말풍선 본체를 "안"으로 넘긴다 — 안에서 누른 것은 접기 사유가 아니다', () => {
    const text = source ?? '';
    // ref 가 실제로 말풍선 본체에 달려 있어야 복사·대기 컨트롤·본문 선택이 "안"으로 판정된다.
    expect(text).toMatch(/refs:\s*\[bubbleRef\]/);
    expect(text).toMatch(/<div ref=\{bubbleRef\}/);
  });

  it('접혀 있는 동안에는 리스너를 걸지 않는다', () => {
    // 스트림에 말풍선이 수백 개 쌓여도 window 리스너는 "지금 펼친 것" 수만큼만 살아야 한다.
    expect(source ?? '').toMatch(/enabled:\s*collapsible && open/);
  });

  it('펼친 그 클릭이 곧바로 되접지 않도록 유예를 준다', () => {
    expect(source ?? '').toMatch(/graceMs:\s*POPUP_DISMISS\.openGraceMs/);
  });
});

describe('펼친 말풍선 바깥 클릭 접기 — 판정', () => {
  const viewport = { withinViewport: true };

  it('IDE 빈 곳(스트림 여백)을 누르면 접힌다', () => {
    const latch = createInsideGestureLatch();
    expect(latch.press({ insidePopup: false, ...viewport })).toBe(true);
  });

  it('말풍선 안(복사 버튼·대기 칩)을 누르면 접히지 않는다', () => {
    const latch = createInsideGestureLatch();
    expect(latch.press({ insidePopup: true, ...viewport })).toBe(false);
  });

  it('펼친 본문을 긁다가 말풍선 밖에서 손을 떼도 접히지 않는다', () => {
    // 확인하려고 펼친 글을 복사하는 중이다 — 여기서 접히면 기능이 자기 목적을 방해한다.
    const latch = createInsideGestureLatch();
    latch.press({ insidePopup: true, ...viewport }); // 본문 위에서 누르기 시작
    // 드래그 도중 도착하는 바깥 좌표의 합성 press 는 접기 사유가 못 된다.
    expect(latch.press({ insidePopup: false, ...viewport })).toBe(false);
  });

  it('선택 드래그가 끝난 뒤 누른 바깥 press 는 접는다', () => {
    const latch = createInsideGestureLatch();
    latch.press({ insidePopup: true, ...viewport });
    latch.release();
    expect(latch.press({ insidePopup: false, ...viewport })).toBe(true);
  });

  it('창 밖으로 끌고 나간 좌표에서 온 press 로는 접지 않는다', () => {
    const latch = createInsideGestureLatch();
    expect(latch.press({ insidePopup: false, withinViewport: false })).toBe(false);
  });
});
