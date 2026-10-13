import { describe, expect, it } from 'vitest';
import { APP_CANVAS_FACE } from '@vibisual/shared';

import { formatPlayClock, isFaceControlTarget, playFraction, quantizePlayTime } from './canvasFaceKit.js';
import { appNodeResizeBounds } from './appNodeForm.js';
import { mediaBlobVerdict } from './useMediaBlobUrl.js';
import { INTERNAL_APPS } from './registry.js';

/**
 * §5.4 #36 (G) — 앱 위성은 작은 작업대다: 누름은 선택, 여는 손은 더블클릭과 [에디터에서 열기], 크기를 바꾸고, 결과가 담긴
 * 화면에서는 앱이 선언한 간단한 조작(재생·돌려 보기·맞춤)을 캔버스에서 바로 한다.
 * 클라 시험 환경에는 DOM 이 없다 — 순수 도우미와 소스 규약만 본다.
 */

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
});
