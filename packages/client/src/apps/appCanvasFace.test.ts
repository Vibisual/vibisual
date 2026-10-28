import { describe, expect, it, vi } from 'vitest';
import { APP_CANVAS_FACE } from '@vibisual/shared';

import { formatPlayClock, isFaceControlTarget, playFraction, quantizePlayTime } from './canvasFaceKit.js';
import { appNodeResizeBounds } from './appNodeForm.js';
import { mediaBlobVerdict } from './useMediaBlobUrl.js';
import { INTERNAL_APPS } from './registry.js';

/** §5.4 #36 (G) — 앱 위성 조작줄 도우미(누름 = 선택, 더블클릭·[에디터에서 열기] = 열기). DOM 이 없어 순수 도우미와 소스 규약만 본다. */

describe('§5.4 #36 (G) 조작줄 도우미', () => {
  it('재생 시계는 내림이고 0 도 0:00 으로 보인다(길이 숫자와 달리)', () => {
    expect(formatPlayClock(0)).toBe('0:00');
    expect(formatPlayClock(5.9)).toBe('0:05');
    expect(formatPlayClock(65)).toBe('1:05');
    expect(formatPlayClock(3723)).toBe('1:02:03');
    expect(formatPlayClock(Number.NaN)).toBe('0:00');
  });

  it('재생 비율은 0~1 로 자르고, 길이를 모르면 0', () => {
    expect(playFraction(5, 10)).toBe(0.5);
    expect(playFraction(15, 10)).toBe(1);
    expect(playFraction(-1, 10)).toBe(0);
    expect(playFraction(5, 0)).toBe(0);
    expect(playFraction(5, Number.NaN)).toBe(0);
  });

  it('재생 시계는 초당 30칸으로 묶는다 — 매 프레임 다시 그리지 않게', () => {
    expect(quantizePlayTime(1 / 100)).toBe(0); // 한 칸이 안 되는 움직임은 같은 칸
    expect(quantizePlayTime(1 / 30)).toBeCloseTo(1 / 30);
    expect(quantizePlayTime(-3)).toBe(0);
  });

  it('DOM 요소가 아닌 대상은 조작 자리가 아니다', () => {
    expect(isFaceControlTarget(null)).toBe(false);
    expect(isFaceControlTarget(undefined)).toBe(false);
  });

  // 크기 조절 띠도 `nodrag` 지만 조작 자리가 아니다 — 그렇게 읽으면 띠의 누름이 노드에 안 가, 띠가 몸통의 큰 몫인 작은 명패에서 일부 앱이 안 지워진다.
  it('크기 조절 띠는 조작 자리가 아니다 — 띠의 누름은 노드의 것이다', () => {
    // 클라 시험에는 DOM 이 없다 — `closest` 만 흉내 낸 요소로 판정만 본다.
    class FakeElement {
      constructor(private readonly matches: readonly string[]) {}
      closest(selector: string): FakeElement | null {
        return this.matches.includes(selector) ? this : null;
      }
    }
    vi.stubGlobal('Element', FakeElement);
    try {
      const at = (...matches: string[]): EventTarget => new FakeElement(matches) as unknown as EventTarget;
      expect(isFaceControlTarget(at('.nodrag', '.react-flow__resize-control'))).toBe(false);
      expect(isFaceControlTarget(at('.nodrag'))).toBe(true);
      expect(isFaceControlTarget(at())).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('§5.4 #36 (G) 바로 재생할 파일 받기', () => {
  it('크기를 먼저 묻고, 모르면 받지 않는다 · 상한을 넘으면 받지 않는다', () => {
    expect(mediaBlobVerdict(null, 100)).toBe('failed');
    expect(mediaBlobVerdict(0, 100)).toBe('failed');
    expect(mediaBlobVerdict(101, 100)).toBe('tooLarge');
    expect(mediaBlobVerdict(100, 100)).toBe('fetch');
    expect(mediaBlobVerdict(1, APP_CANVAS_FACE.playMaxBytes)).toBe('fetch');
  });
});

describe('§5.4 #36 (G) 레지스트리 — 앱이 캔버스 조작을 선언한다', () => {
  it('등록된 앱은 모두 화면 안쪽 그림을 늦은 로더로 선언한다', () => {
    for (const app of INTERNAL_APPS) expect(typeof app.canvasFace, app.id).toBe('function');
  });

  it('선언된 크기는 크기 조절 한도 안이다 — [기본 크기로] 가 한도에 잘리지 않게', () => {
    const screen = appNodeResizeBounds('screen');
    const plate = appNodeResizeBounds('nameplate');
    for (const app of INTERNAL_APPS) {
      expect(app.screenSize.width, app.id).toBeGreaterThanOrEqual(screen.minWidth);
      expect(app.screenSize.height, app.id).toBeGreaterThanOrEqual(screen.minHeight);
      expect(app.defaultSize.width, app.id).toBeGreaterThanOrEqual(plate.minWidth);
      expect(app.defaultSize.height, app.id).toBeGreaterThanOrEqual(plate.minHeight);
    }
  });
});

/**
 * 소스 규약 — 첫 판(F)의 "화면은 누르면 열린다"로 되돌아가면 사용자가 걷게 한 동작이 살아난다.
 */
describe('§5.4 #36 (G) 앱 노드 소스 규약', () => {
  const SOURCES = import.meta.glob<string>(['/src/components/BubbleMap/AppBubbleNode.tsx'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const src = SOURCES['/src/components/BubbleMap/AppBubbleNode.tsx'] ?? '';

  it('누름은 선택이다 — 화면에서도 선택 자리에 열기를 꽂지 않는다', () => {
    expect(src).not.toBe('');
    expect(src).toContain('select: () => selectAppBubble(data.appBubbleId)');
    expect(src).not.toContain('select: isScreen ? open');
  });

  it('여는 손은 더블클릭과 머리줄 [에디터에서 열기] 단추다', () => {
    expect(src).toContain('onDoubleClick={handleDoubleClick}');
    expect(src).toContain("t('panel.fileEdit.openInEditor'");
  });

  it('크기 손잡이가 있고, 화면 안 조작 자리의 누름은 선택·열기로 치지 않는다', () => {
    expect(src).toContain('<NodeResizer');
    expect(src).toContain('isFaceControlTarget(e.target)');
  });

  // 띠는 몸통 밖 형제다 — 감싸개에 따로 달지 않으면 띠 위 우클릭이 아무 메뉴도 열지 않는다.
  it('크기 조절 띠도 노드다 — 띠 감싸개에 같은 우클릭 메뉴·선택 손짓·두 번 누름을 단다', () => {
    const at = src.indexOf('group/app-resize');
    expect(at).toBeGreaterThan(-1);
    const wrapper = src.slice(at, src.indexOf('<NodeResizer', at));
    expect(wrapper).toContain('onContextMenu={handleContextMenu}');
    expect(wrapper).toContain('{...gesture.handlers}');
    expect(wrapper).toContain('onDoubleClick={handleDoubleClick}');
  });

  // React Flow 는 크기가 그대로인 누름에 `onResizeEnd` 를 부르지 않는다 — 누를 때 잠그면 풀 손이 없다.
  it('드래그 락은 크기가 실제로 바뀔 때 건다 — 그 누름은 선택 손짓에서 접는다', () => {
    const start = src.indexOf('<NodeResizer');
    const resizer = src.slice(start, src.indexOf('/>', start));
    expect(resizer).not.toContain('onResizeStart=');
    expect(src).toContain('gesture.cancelPress()');
  });
});
