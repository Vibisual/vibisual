/**
 * popOutWarmLatch.test.ts — §5.5 #17-6 (H-25) **놓는 순간에 창을 짓지 않는다.**
 *
 * (H-17) 로 "창이 바뀌는 자리는 뗌 하나"가 되면서 창을 **짓는 일까지** 그 한 순간으로 모였다.
 * 끄는 동안은 선 하나만 움직여 매끄러운데, 손을 떼는 그 프레임에서야 `new BrowserWindow` →
 * 번들 파싱 → WS 연결 → 스냅샷 → `takeHandoff` → IDE 마운트가 통째로 돌아간다((H-15) 가 그것을
 * 기다리는 그물을 4초로 잡아 둔 그 까닭이다). 그래서 그 지점만 유독 무겁다(사용자 보고 —
 * "손 떼면 두두둑 이러면서 엄청 느리다").
 *
 * 고침은 그 일을 **나갈 뜻이 분명해지는 순간**으로 앞당기는 것이고(§5.5 #17-17 (b) 가 카드를
 * 계획이 아니라 발사 순간에 세운 것과 같은 손짓), 그러면 뗌은 `openOverlay` 의 **재사용 갈래**를
 * 타 자리 옮기기와 보여주기만 남는다.
 *
 * 이 파일은 그 앞당김의 두 축을 본다:
 *   ⓐ 걸쇠 자체 — 한 판에 한 번만 짓고, 판이 끝나는 네 자리가 같은 판단을 쓴다(실제로 돌려 본다)
 *   ⓑ 컴포넌트 배선 — 그 걸쇠를 무장 순간에 걸고, 끝나는 자리마다 빠짐없이 거둔다(소스로 본다.
 *      클라 테스트에는 DOM 이 없어 드래그 판을 실제로 돌릴 수 없다 — `vitest.config.ts` 의 전제)
 */
import { describe, expect, it } from 'vitest';
import { createPopOutWarmLatch } from './popOutWarmLatch.js';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(key: string): string {
  const found = tsx[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
  return found;
}

/** 두 표식 사이만 잘라 본다 — 파일의 닮은 자리와 섞이지 않게. */
function between(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작 표식을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝 표식을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

/** 지은 횟수·거둔 횟수를 세는 걸쇠. */
function spy(): { latch: ReturnType<typeof createPopOutWarmLatch>; built: number; discarded: number } {
  const counts = { built: 0, discarded: 0 };
  const latch = createPopOutWarmLatch({
    build: () => { counts.built += 1; },
    discard: () => { counts.discarded += 1; },
  });
  return {
    latch,
    get built() { return counts.built; },
    get discarded() { return counts.discarded; },
  };
}

describe('ⓐ 걸쇠 — 한 판에 한 번만 짓는다', () => {
  it('무장되면 짓는다', () => {
    const s = spy();
    s.latch.arm();
    expect(s.built).toBe(1);
    expect(s.latch.warmed).toBe(true);
  });

  it('무장이 켜졌다 꺼졌다 해도 창은 하나다 — 그때마다 짓고 닫으면 예열이 되레 부담이 된다', () => {
    const s = spy();
    s.latch.arm();
    s.latch.arm();
    s.latch.arm();
    expect(s.built).toBe(1);
    expect(s.discarded).toBe(0);
  });

  it('나간 판은 거두지 않는다 — 그 창이 곧 사용자가 보는 창이다', () => {
    const s = spy();
    s.latch.arm();
    s.latch.settle(true);
    expect(s.discarded).toBe(0);
    expect(s.latch.warmed).toBe(false);
  });

  it('앱 안에 놓은 판은 거둔다 — 안 거두면 다음에 꺼낼 때 재사용 갈래가 그 빈 창을 집는다', () => {
    const s = spy();
    s.latch.arm();
    s.latch.settle(false);
    expect(s.discarded).toBe(1);
  });

  it('끝나는 자리가 넷이라 **여러 번 불린다** — 두 번째부터는 아무 일도 없다', () => {
    // `popOutNow` 가 `settle(true)` 한 뒤 `detach` → 정리 경로가 `settle(poppedOut)` 를 또 부른다.
    const s = spy();
    s.latch.arm();
    s.latch.settle(true);
    s.latch.settle(false); // 늦게 온 정리 — 이미 태어난 창을 닫아서는 안 된다
    s.latch.settle(false);
    expect(s.discarded).toBe(0);
  });

  it('두 번 거두지 않는다 — 닫으라는 말이 두 번 가면 남의 창을 닫을 틈이 생긴다', () => {
    const s = spy();
    s.latch.arm();
    s.latch.settle(false);
    s.latch.settle(false);
    expect(s.discarded).toBe(1);
  });

  it('짓지 않은 판을 거두라고 해도 조용히 지나간다 — 끌지도 않고 뗀 판이 그렇다', () => {
    const s = spy();
    s.latch.settle(false);
    s.latch.settle(true);
    expect(s.built).toBe(0);
    expect(s.discarded).toBe(0);
  });

  it('거둔 뒤 다시 무장하면 다시 짓는다 — 걸쇠는 한 판짜리다', () => {
    const s = spy();
    s.latch.arm();
    s.latch.settle(false);
    s.latch.arm();
    expect(s.built).toBe(2);
  });
});

describe('ⓑ 배선 — 그 걸쇠를 제때 걸고 빠짐없이 거두는가', () => {
  const src = source('./AgentIDEOverlay.tsx');

  it('짓는 자리는 **무장된 순간** 하나다 — 선이 처음 뜨는 순간은 이르다(도로 앉을 판이 섞인다)', () => {
    expect(src).toContain('if (armed && canPopOut) warmLatch.arm();');
    // 갈림은 걸쇠가 쥔다 — 컴포넌트가 제 걸쇠를 따로 세지 않는다((H-16)).
    expect(src).not.toContain('let warmed = false;');
  });

  it('못 나가는 판은 짓지 않는다 — `canPopOut` 이 거짓이면 그 창은 쓸 데가 없다', () => {
    const at = src.indexOf('warmLatch.arm()');
    expect(src.slice(at - 40, at)).toContain('canPopOut');
  });

  it('나가는 자리가 걸쇠를 **먼저** 내린다 — 뒤따르는 정리 경로들이 그 창을 닫지 않게', () => {
    const popOut = between(src, 'function popOutNow(opts?: { settled?: boolean }): void {', 'clearDragVisuals();');
    expect(popOut).toContain('warmLatch.settle(true);');
    // `detach()` 보다 앞이어야 한다 — 그 뒤의 정리가 `settle(poppedOut)` 을 부른다.
    expect(popOut.indexOf('warmLatch.settle(true);')).toBeLessThan(popOut.indexOf('detach({'));
  });

  it('앱 안으로 끝나는 두 갈래 다 거둔다 — 끌지도 않은 판과 놓은 판', () => {
    expect(src).toContain('if (!dragging) { hideGhost(); warmLatch.settle(false); return; }');
    const inApp = between(src, 'if (goingOut) { popOutNow({ settled: true }); return; }', 'if (lastGeom) {');
    expect(inApp).toContain('warmLatch.settle(false);');
  });

  it('언마운트로 판이 끊겨도 남지 않는다 — 보이지 않는 창이라 사용자가 없앨 수 없다', () => {
    const cleanup = between(src, 'activeDragCleanupRef.current = () => {', 'entryLock = null;');
    expect(cleanup).toContain('warmLatch.settle(poppedOut);');
    // 선을 걷는 것과 같은 근거·같은 자리다(하나만 걷으면 다른 하나가 남는다).
    expect(cleanup).toContain('if (!poppedOut) hideGhost();');
  });

  it('창구가 없으면 아무 일도 없다 — 구버전 preload 에서도 종전대로 뗌에 짓는다(⑥)', () => {
    const warm = between(src, 'const warmPopOutWindow = useCallback(', 'const cancelWarmPopOut');
    expect(warm).toContain('if (!ov?.warm || !agentId) return;');
    expect(warm).toContain('if (!projectId) return;');
    // 실패는 삼킨다 — 빨라지지 않을 뿐 못 나가지는 않는다.
    expect(warm).toContain('.catch(');
  });

  it('짐은 **지금** 맡긴다 — 손이 눌린 동안에는 이 창의 상태가 바뀌지 않는다((H-4) 와 같은 근거)', () => {
    const warm = between(src, 'const warmPopOutWindow = useCallback(', 'const cancelWarmPopOut');
    expect(warm).toContain('handoff: captureHandoff()');
  });

  it('거두기는 `warmCancel` 로만 부른다 — `close` 를 부르면 태어난 창까지 닫힌다', () => {
    const cancel = between(src, 'const cancelWarmPopOut = useCallback(', '}, [agentId]);');
    expect(cancel).toContain('warmCancel?.(agentId)');
    expect(cancel).not.toContain('overlay?.close(');
  });

  it('두 창구가 드래그 판의 의존성에 들어 있다 — 빠지면 옛 `agentId` 로 창을 짓는다', () => {
    const deps = between(src, 'warmLatch.settle(poppedOut);', ']);');
    expect(deps).toContain('warmPopOutWindow');
    expect(deps).toContain('cancelWarmPopOut');
  });
});
