/**
 * ghostBody.test.ts — §5.5 #17-6 (H-19) **선이 뜨면 본체는 숨고, 숨은 채로 손을 따라온다.**
 *
 * (H-6) ③ 은 밖으로 빼는 동안 본체를 반투명(0.35)으로 그 자리에 멎게 했다. 그 멎은 창이
 * 사용자에게는 잔상이었다("밖으로 나갈 때 기존 앱 안 창은 안 보여야 하는데 잔상이 있다").
 * 이제 선이 뜨는 동안 본체는 완전히 숨되 자리는 계속 맞춰 두고(선이 꺼지면 손 아래에서 다시
 * 나타난다), 인계 중에도 도로 나타나지 않으며, 본체가 하던 말은 선이 한다.
 *
 * 이 파일은 그 계약을 소스로 고정한다(클라 테스트에는 DOM 이 없다 — `vitest.config.ts`).
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

const OVERLAY = source('AgentIDEOverlay.tsx');
/** 끄는 판 전체 — 이동·인계·선 부탁이 전부 이 안에 있다. */
const DRAG = block(OVERLAY, 'const beginTitleDrag = useCallback(', 'const handleTitleBarMouseDown = useCallback(');

describe('(H-19) 선이 뜨면 본체는 완전히 숨는다', () => {
  it('떠 있는 창의 스타일 — 반투명이 아니라 0 이고, 손짓도 받지 않는다', () => {
    const style = block(OVERLAY, "windowClass += ' fixed rounded-lg border';", '// fullWindow 는 백드롭 없음');
    expect(style).toContain('opacity: popOutGhost ? 0 : undefined');
    expect(style).toContain("pointerEvents: popOutGhost ? 'none' : undefined");
    expect(style).not.toContain('popOutGhost ? 0.35');
  });

  it('본체 안 안내 띠는 없다 — 숨은 창 안의 말은 아무도 못 본다', () => {
    const body = block(OVERLAY, '{flashKey > 0 && (', '{/* 도킹 시 안쪽 모서리 리사이즈 핸들');
    expect(body).not.toContain('popOutGhostArmedHint');
  });
});

describe('(H-19) 숨은 본체는 손을 따라온다', () => {
  const move = block(DRAG, 'function handleMove(ev: MouseEvent): void {', 'function handleUp(): void {');

  it('선이 켜진 이동에서도 자리를 적는다 — 선이 꺼지면 손 아래 그 자리에 다시 나타나야 한다', () => {
    const ghostMove = block(move, 'if (ghostOn) {', 'let moved = raw;');
    expect(ghostMove).toContain('lastGeom = raw;');
    expect(ghostMove).toContain('dragOffsetRef.current = { dx: raw.x - dragBase.x, dy: raw.y - dragBase.y };');
    expect(ghostMove).toContain('scheduleDragFrame();');
    // 나가는 자리는 여전히 뗌 하나다((H-17) — 여기서 창을 바꾸지 않는다).
    expect(ghostMove).not.toContain('popOutNow(');
  });

  it('무장 없이 놓으면 그 자리에서 안전망을 건다 — 밖으로 끌어 둔 자리를 화면 안으로 되돌린다', () => {
    const up = block(DRAG, 'function handleUp(): void {', 'if (init.resumed) {');
    expect(up).toContain('clampFloatGeom(lastGeom, viewportNow())');
  });
});

describe('(H-19) 인계 중에 본체가 도로 나타나지 않는다', () => {
  it('`handOff` 는 `popOutGhost` 를 내리지 않는다 — 내리면 새 창이 서기까지 본체가 번쩍인다', () => {
    const hand = block(DRAG, 'const handOff = (): void => {', 'if (!standing) { handOff(); return; }');
    expect(hand).not.toContain('setPopOutGhost(null)');
    expect(hand).toContain('ghostOn = false;');
  });
});

// §5.5 #17-6 (H-22) — 선이 **꺼지는** 자리도 뗌 하나다. 순수 판정은 `ideDockLayout.test.ts`
//   가 값으로 고정하고, 여기서는 그 걸쇠가 드래그 판에 실제로 배선돼 있는지를 본다
//   (배선이 빠지면 값은 맞는데 화면은 종전 그대로다 — 이 층이 없으면 안 잡힌다).
describe('(H-22) 한 번 나간 판은 도로 들어와도 선이다', () => {
  const refresh = block(DRAG, 'function refreshGhost(): void {', 'function startEdgeWatch(');

  it('판정에 걸쇠를 먹인다 — 지금 자리만 보면 도로 들어온 순간 꺼진다', () => {
    expect(refresh).toContain('escaped: ghostEscaped');
  });

  it('밖을 밟은 프레임에 걸쇠를 문다 — 무는 자리는 한 곳', () => {
    expect(refresh).toContain('if (canPopOut && want.outside) ghostEscaped = true;');
  });

  it('걸쇠는 한 판짜리다 — 판 밖(컴포넌트)에 두면 다음 판이 선으로 시작한다', () => {
    expect(DRAG).toContain('let ghostEscaped = false;');
    expect(OVERLAY.replace(DRAG, '')).not.toContain('ghostEscaped');
  });

  // 선이 한 판 내내 살아 있게 됐으므로, main 의 수명 그물(20초)이 **아직 끌고 있는 손
  //   아래에서** 걷힐 수 있게 됐다 — 본체는 숨어 있으니((H-19)) 그러면 커서 아래가 완전히
  //   빈다. 판이 사는 동안 그물을 다시 재게 하되, 판이 끝나는 자리에서는 반드시 멎어야 한다
  //   (안 멎으면 렌더러가 죽어도 선이 남는 그물 구멍이 된다).
  it('선이 서면 수명 알림도 함께 선다', () => {
    const show = block(DRAG, 'function showGhost(rect: FloatGeom, armed: boolean): void {', 'function hideGhost(): void {');
    expect(show).toContain('startGhostKeepAlive();');
  });

  it('알림은 판이 끝나는 자리마다 멎는다 — 선을 걷을 때 · 정리할 때 · 언마운트될 때', () => {
    expect(block(DRAG, 'function hideGhost(): void {', 'function clearEdgeWatch(')).toContain('stopGhostKeepAlive();');
    expect(block(DRAG, 'function detach(opts?:', 'function clearDragVisuals(')).toContain('stopGhostKeepAlive();');
    expect(block(DRAG, 'activeDragCleanupRef.current = () => {', 'dragOffsetRef.current = { dx: 0, dy: 0 };')).toContain('stopGhostKeepAlive();');
  });
});

describe('(H-19) 본체가 하던 말은 선이 한다', () => {
  it('main 의 선에 나가는 길의 문구를 싣는다 — 앱 안 선과 같은 문구라 경계를 넘어도 말이 안 바뀐다', () => {
    const req = block(DRAG, 'function requestOsGhost(', 'function syncOsGhost(');
    expect(req).toContain("hint: armed ? t('ide.overlay.popOutGhostArmedHint') : t('ide.overlay.popOutGhostHint')");
  });

  it('앱 안 선은 이름 띠와 안내 한 줄을 그린다(main 의 선과 같은 그림)', () => {
    const ghost = block(OVERLAY, 'data-ide-popout-ghost="1"', '{/* 자석 안내선');
    expect(ghost).toContain('popOutGhostArmedHint');
    expect(ghost).toContain("agent?.label ?? ''");
    expect(ghost).toContain('h-[34px]');
  });
});
