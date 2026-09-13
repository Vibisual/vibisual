/**
 * detachedFollowRelease.test.ts — §5.5 #17-6 (H-23) **뗌을 듣는 귀가 하나뿐이면 안 된다.**
 *
 * 독립 창을 끌고 앱 안으로 들어오면 (H-12) 가 그 창을 **숨긴다**. 숨는 순간 OS 는 그 창의 마우스
 * 캡처를 걷으므로, 들어오는 판의 뗌은 그 렌더러에 영영 닿지 않는다 — 그런데 그 판의 리스너는
 * 전부 그 창에 달려 있었다(`AgentIDEOverlay` 의 `fullWindow` 갈래 · `OverlayShell` 의 매달림 그물).
 * 그래서 `finishOverlayFollow` 가 불리지 않아 선이 커서에 붙은 채 남고(사용자 보고 — "마우스를
 * 때도 손에 붙어있는 버그"), 선마저 수명으로 걷히면 그 IDE 가 화면 어디에도 없다.
 *
 * (H-4) ⑥ 의 "두 창이 함께 듣는다"를 들어오는 길에도 적용하는 것이 고침이고, 이 파일은
 * ⓐ 그 그물 자체의 동작과 ⓑ 메인 창이 그것을 거는 계약을 고정한다.
 *
 * 클라 테스트에는 DOM 이 없다(`vitest.config.ts`) — 그물은 `window` 스텁으로 실제로 돌려 보고,
 * 훅·배선은 소스로 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDetachedFollowRelease } from './detachedFollowRelease.js';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const hooks = import.meta.glob('../../hooks/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const app = import.meta.glob('../../App.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(map: Record<string, string>, key: string): string {
  const found = map[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
  return found;
}

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

// ─── `window` 스텁 — 건 리스너를 그대로 들여다본다 ────────────────────────────
interface Listener { type: string; fn: (ev: unknown) => void; capture: boolean }

function installWindow(): { listeners: Listener[]; ends: string[] } {
  const listeners: Listener[] = [];
  const ends: string[] = [];
  const stub = {
    addEventListener(type: string, fn: (ev: unknown) => void, capture?: boolean) {
      listeners.push({ type, fn, capture: !!capture });
    },
    removeEventListener(type: string, fn: (ev: unknown) => void, capture?: boolean) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === !!capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    api: { overlay: { dragEndFor: (agentId: string) => { ends.push(agentId); return Promise.resolve(true); } } },
  };
  vi.stubGlobal('window', stub);
  return { listeners, ends };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('그물은 뗌을 놓칠 수 있는 조합을 **셋 다** 듣는다', () => {
  it('뗌 · 버튼 없이 움직임 · 포커스 잃음 — 하나라도 빠지면 창이 영영 커서를 따라다닌다', () => {
    const { listeners } = installWindow();
    watchDetachedFollowRelease('a1');
    expect(listeners.map((l) => l.type).sort()).toEqual(['blur', 'mousemove', 'mouseup']);
    // 뗌·움직임은 **캡처**로 듣는다 — 도중의 누가 멈춰 세워도 우리에게는 닿아야 한다.
    expect(listeners.find((l) => l.type === 'mouseup')?.capture).toBe(true);
    expect(listeners.find((l) => l.type === 'mousemove')?.capture).toBe(true);
  });

  it('뗌이 오면 그 에이전트의 판을 끝내고 **스스로 걷는다** — 리스너가 쌓이지 않게', () => {
    const { listeners, ends } = installWindow();
    watchDetachedFollowRelease('a1');
    listeners.find((l) => l.type === 'mouseup')!.fn({});
    expect(ends).toEqual(['a1']);
    expect(listeners).toHaveLength(0);
  });

  it('버튼이 눌리지 않은 채 움직이면 **이미 놓은 것**이다 — 뗌 자체를 놓쳤을 때의 그물', () => {
    const { listeners, ends } = installWindow();
    watchDetachedFollowRelease('a2');
    listeners.find((l) => l.type === 'mousemove')!.fn({ buttons: 1 });
    expect(ends, '아직 눌려 있다 — 끝내면 안 된다').toEqual([]);
    listeners.find((l) => l.type === 'mousemove')!.fn({ buttons: 0 });
    expect(ends).toEqual(['a2']);
  });

  it('걷는 손잡이를 돌려준다 — 판이 신호로 끝났을 때 부르면 뗌이 헛나가지 않는다', () => {
    const { listeners, ends } = installWindow();
    const detach = watchDetachedFollowRelease('a3');
    expect(listeners).toHaveLength(3);
    detach();
    expect(listeners).toHaveLength(0);
    expect(ends, '걷기만 했을 뿐 판을 끝낸 것이 아니다').toEqual([]);
  });
});

describe('메인 창이 들어오는 판의 뗌을 함께 듣는다', () => {
  const hook = source(hooks, '../../hooks/useDetachedFollowRelease.ts');

  it('같은 그물을 쓴다 — 나가는 길에서 잡은 조합은 들어오는 길에서도 그대로 필요하다', () => {
    expect(hook).toContain('watchDetachedFollowRelease');
    expect(hook).toContain('onFollowDragState');
  });

  it('`agentId` 없는 신호(구버전 preload)는 건너뛴다 — 누구의 판인지 모르면 걸 수 없다', () => {
    expect(hook).toContain('if (!agentId) return;');
  });

  it('같은 에이전트의 신호가 두 번 와도 그물은 하나다 — 겹치면 한 번의 뗌이 여러 번 나간다', () => {
    // 부팅을 마친 창이 매달림을 다시 알리는 길이 실제로 있다(`did-finish-load`).
    expect(hook).toContain('stop(agentId);');
    expect(hook).toContain('watching.set(agentId, watchDetachedFollowRelease(agentId));');
  });

  it('끄는 신호가 오면 그 판의 그물을 걷는다', () => {
    expect(hook).toContain('if (!following) return;');
  });

  it('언마운트에서 남은 그물을 전부 걷는다 — 고아 리스너 ❌', () => {
    const cleanup = block(hook, 'return () => {', '};');
    expect(cleanup).toContain('for (const detach of watching.values()) detach();');
  });
});

describe('거는 자리는 `App` 이다 — IDE 컴포넌트가 아니다', () => {
  it('`App` 이 훅을 부른다', () => {
    const src = source(app, '../../App.tsx');
    expect(src).toContain('useDetachedFollowRelease();');
    expect(src).toContain("from './hooks/useDetachedFollowRelease.js'");
  });

  it('`AgentIDEOverlay` 는 그 함수를 **공용 모듈에서** 가져온다 — 사본을 두면 한쪽만 고쳐진다', () => {
    // 이 판이 도는 동안 그 IDE 는 밖에 나가 있다 — 컴포넌트 안에 두면 앱 안에 열려 있을 때만 듣는다.
    const overlay = source(tsx, './AgentIDEOverlay.tsx');
    expect(overlay).toContain("from './detachedFollowRelease.js'");
    expect(overlay).not.toContain('function watchDetachedFollowRelease(');
  });
});
