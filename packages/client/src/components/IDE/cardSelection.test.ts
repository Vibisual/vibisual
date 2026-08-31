/**
 * 질문 카드 "선택 복사" — 고른 것을 언제 복사할 수 있어야 하는가.
 *
 * 사용자 보고: 드래그로 골랐는데 버튼이 **회색으로 잠겨** 있어 복사할 수 없었다. 종전 판정은
 * "지금 이 순간 살아 있는 선택"만 봤는데, 스트림은 살아 있는 동안 계속 다시 그려지고 가상 리스트가
 * 항목을 재활용하면 카드 DOM 이 갈리면서 document 선택이 소리 없이 사라진다 — 사용자가 버튼으로
 * 손을 옮기는 그 사이에 잠기는 것이다. 그래서 **고른 순간에 떠 둔 것**을 판정과 복사에 함께 쓴다.
 *
 * DOM(Range/Selection) 은 이 패키지 테스트 환경(node)에 없으므로, 그 위에서 도는 **순수 판정**과
 * **기억 저장고**만 여기서 못 박는다(같은 방식: `promptOverlayReserve`, `followDecision`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideSelectionCopy,
  rememberSelection,
  recallSelection,
  forgetRememberedSelections,
  REMEMBERED_SELECTION_MAX,
  REMEMBERED_SELECTION_MAX_CHARS,
} from './cardSelection.js';

describe('decideSelectionCopy — 버튼을 켜도 되는가', () => {
  it('이 카드 안에 살아 있는 선택이 있으면 켠다', () => {
    expect(decideSelectionCopy({ live: true, elsewhere: false, remembered: false })).toBe(true);
  });

  it('아무것도 고른 적이 없으면 잠근다(회색으로 남아 "드래그하면 쓸 수 있다"를 알린다)', () => {
    expect(decideSelectionCopy({ live: false, elsewhere: false, remembered: false })).toBe(false);
  });

  it('선택이 풀린 뒤에도 이 카드에서 고른 것을 떠 뒀으면 켠다 — 사용자가 막혔던 자리', () => {
    // 리렌더·재마운트로 document 선택이 사라진 상태. 종전엔 여기서 잠겨 복사할 길이 없었다.
    expect(decideSelectionCopy({ live: false, elsewhere: false, remembered: true })).toBe(true);
  });

  it('살아 있는 선택이 다른 곳 몫이면 잠근다 — 엉뚱한 대목을 복사하지 않게', () => {
    expect(decideSelectionCopy({ live: false, elsewhere: true, remembered: true })).toBe(false);
  });

  it('내 카드 선택이 살아 있으면 다른 곳 여부와 무관하게 켠다', () => {
    expect(decideSelectionCopy({ live: true, elsewhere: true, remembered: false })).toBe(true);
  });
});

describe('decideSelectionCopy — 체크박스로 고른 것', () => {
  it('체크한 답이 있으면 드래그를 한 적 없어도 켠다 — 사용자가 막혔던 자리', () => {
    // 화면에는 체크가 보이는데 버튼은 "고른 게 없다"며 회색이던 상태.
    expect(decideSelectionCopy({ live: false, elsewhere: false, remembered: false, checked: true })).toBe(true);
  });

  it('체크가 살아 있으면 다른 곳 드래그가 있어도 켠다 — 체크는 이 카드 몫이 확실하다', () => {
    expect(decideSelectionCopy({ live: false, elsewhere: true, remembered: false, checked: true })).toBe(true);
  });

  it('체크를 전부 풀면 다시 잠긴다', () => {
    expect(decideSelectionCopy({ live: false, elsewhere: false, remembered: false, checked: false })).toBe(false);
  });

  it('체크 축을 주지 않는 카드는 종전 판정 그대로', () => {
    expect(decideSelectionCopy({ live: false, elsewhere: false, remembered: true })).toBe(true);
    expect(decideSelectionCopy({ live: false, elsewhere: true, remembered: true })).toBe(false);
  });
});

describe('떠 둔 선택 저장고', () => {
  beforeEach(() => {
    forgetRememberedSelections();
  });

  it('카드별로 따로 기억한다 — 옆 카드 선택이 내 것을 덮지 않는다', () => {
    rememberSelection('q-1', '첫 카드에서 고른 대목');
    rememberSelection('q-2', '둘째 카드에서 고른 대목');
    expect(recallSelection('q-1')).toBe('첫 카드에서 고른 대목');
    expect(recallSelection('q-2')).toBe('둘째 카드에서 고른 대목');
  });

  it('선택이 풀려 빈 문자열이 와도 떠 둔 것을 지우지 않는다', () => {
    rememberSelection('q-1', '고른 대목');
    rememberSelection('q-1', ''); // 리렌더로 선택만 사라진 상태
    expect(recallSelection('q-1')).toBe('고른 대목');
  });

  it('다시 고르면 최신 것으로 갱신된다', () => {
    rememberSelection('q-1', '처음 고른 것');
    rememberSelection('q-1', '다시 고른 것');
    expect(recallSelection('q-1')).toBe('다시 고른 것');
  });

  it('고른 적 없는 카드는 빈 문자열', () => {
    expect(recallSelection('q-없음')).toBe('');
  });

  it('키 개수에 캡이 있다 — 오래된 카드부터 버리고 최근 것은 남는다(§9)', () => {
    for (let i = 0; i < REMEMBERED_SELECTION_MAX + 5; i++) {
      rememberSelection(`q-${i}`, `고른 것 ${i}`);
    }
    expect(recallSelection('q-0')).toBe('');
    const newest = REMEMBERED_SELECTION_MAX + 4;
    expect(recallSelection(`q-${newest}`)).toBe(`고른 것 ${newest}`);
  });

  it('다시 고르면 최근 쪽으로 밀려 캡에 먼저 밀려나지 않는다', () => {
    rememberSelection('q-오래된', '처음');
    for (let i = 0; i < REMEMBERED_SELECTION_MAX - 1; i++) {
      rememberSelection(`q-${i}`, `고른 것 ${i}`);
    }
    rememberSelection('q-오래된', '다시 고름'); // 여기서 최신 순서로 올라간다
    rememberSelection('q-새로운', '새 카드');
    expect(recallSelection('q-오래된')).toBe('다시 고름');
  });

  it('한 벌 길이에도 캡이 있다', () => {
    rememberSelection('q-1', 'x'.repeat(REMEMBERED_SELECTION_MAX_CHARS + 500));
    expect(recallSelection('q-1').length).toBe(REMEMBERED_SELECTION_MAX_CHARS);
  });
});
