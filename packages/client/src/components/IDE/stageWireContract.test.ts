/**
 * §5.5 #17-17 ㉖ — 무대 선의 소스 계약: 캔버스 `EdgeMask` 가 무대 선까지 칠하지 않고(토막 나 없는 연결이 보인다), ⑰(a) 팬아웃·팬인이 살아 있다(걷으면 선이 사라진다).
 * 판정 규칙 자체는 `goalDropTarget.test.ts`.
 */

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(
  [
    './IDEGoalMapView.tsx', './StageCanvasMenu.tsx', './goalDropTarget.ts',
    '../BubbleMap/EdgeMask.tsx', '../BubbleMap/edgeOccluders.ts', '../BubbleMap/CurvedEdge.tsx',
    '../BubbleMap/TaskEdgeComponent.tsx', '../../stores/graphStore.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;

/** ㉖(h)-2 — 번역문에 `Ctrl+` 를 박으면 12개 로케일이 한꺼번에 틀어진다(멀티플랫폼 5축). */
const localeFiles = import.meta.glob('../../i18n/locales/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(path: string): string {
  const found = sources[path];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${path} (있는 것: ${Object.keys(sources).join(', ')})`);
  return found;
}

/** 주석을 걷어 낸 본문 — 규약을 적어 둔 주석 문장이 검사를 통과시키지 않게. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('㉖(a) 캔버스의 선 가림은 자기 캔버스 밖으로 나가지 않는다', () => {
  const mask = code('../BubbleMap/EdgeMask.tsx');
  const board = code('../BubbleMap/edgeOccluders.ts');

  it('엣지를 `document` 에서 걷지 않는다 — 전역 쿼리가 무대의 선까지 잡았다', () => {
    expect(mask).not.toMatch(/document\s*\.\s*querySelectorAll/);
  });

  it('§5.4 #31 (K) — 문서·DOM 을 아예 만지지 않고, 원만 자기 React Flow 인스턴스에 게시한다', () => {
    expect(mask).not.toMatch(/\bdocument\s*\./);
    expect(mask).not.toMatch(/querySelector|createElementNS/);
    expect(mask).toMatch(/const instance = useOccluderInstance\(\);/);
    expect(mask).toMatch(/publishOccluders\(instance, /);
  });

  it('게시판은 인스턴스마다 갈라진다 — 한 화면에 캔버스가 둘이어도 서로의 선을 자르지 않게', () => {
    expect(board).toMatch(/new WeakMap<object, OccluderBoard>\(\)/);
    // useStoreApi() 가 돌려주는 객체는 부르는 자리마다 새로 감싼 것이라 열쇠가 못 된다(선이 하나도 안 잘렸다).
    expect(board).toMatch(/return useStoreApi\(\)\.getState;/);
  });

  it('선은 같은 인스턴스의 게시판에서 자기 곡선에 닿는 원만 읽는다', () => {
    for (const edge of ['../BubbleMap/CurvedEdge.tsx', '../BubbleMap/TaskEdgeComponent.tsx']) {
      expect(code(edge)).toMatch(/useEdgeOccluders\(curve, source\)/);
    }
  });
});

describe('㉖(b)(c) 차례가 그리는 선 위에 그은 선이 더해진다', () => {
  const view = code('./IDEGoalMapView.tsx');

  it('⑰(a) 행 팬아웃·팬인이 살아 있다 — 걷어 내면 지도에서 선이 사라진다', () => {
    const pure = code('./goalDropTarget.ts');
    expect(pure).toMatch(/export function rowWires\(/);
    expect(pure).toMatch(/for \(let r = 1; r < rows\.length; r\+\+\)/);
    expect(pure).toMatch(/for \(const from of rows\[r - 1\]/);
    expect(pure).toMatch(/for \(const to of rows\[r\]/);
  });

  it('㉖(h)-3 무대와 끊기 손잡이가 **같은 목록**을 본다 — 갈리면 못 끊는 선이 생긴다', () => {
    expect(view).toMatch(/for \(const w of rowWires\(currentRows\(\)\)\)/);
    expect(view).toMatch(/rowWiresAt\(currentRows\(\), stepId, side\)/);
  });

  it('그 위에 그은 선(`goalWires`)을 얹는다', () => {
    expect(view).toMatch(/drawableWires\(wires,/);
  });

  it('두 원천이 같은 쌍을 내면 한 번만 그린다 — 같은 id 가 둘이면 React Flow 가 경고한다', () => {
    expect(view).toMatch(/const seen = new Set<string>\(\);/);
    expect(view).toMatch(/if \(seen\.has\(id\)\) continue;/);
  });

  it('색·굵기 규약은 두 원천이 같은 자리에서 받아 간다', () => {
    expect(view).toMatch(/const link = \(sourceId: string, targetId: string\): Edge =>/);
  });

  it('그은 선·끊은 자리가 둘 다 엣지 memo 의 입력이다 — 바뀌면 화면도 따라온다', () => {
    expect(view).toMatch(/\}, \[steps, wires, cuts, currentRows, visualKinds\]\);/);
  });

  it('㉖(h)-3 끊은 자리는 **두 원천 모두**에서 빠진다 — 한쪽만 빼면 다른 쪽이 도로 그린다', () => {
    expect(view).toMatch(/if \(isCut\(cuts, w\.source, w\.target\)\) continue;/);
    expect(view).toMatch(/drawableWires\(wires, byId\.keys\(\), cuts\)/);
  });

  it('양 끝이 지금 목록에 있는 선만 그린다 — 단계가 사라지면 그 선도 사라진다', () => {
    expect(view).toMatch(/byId\.keys\(\)/);
  });
});

describe('㉖(d)(e) 긋고 걷는 손잡이가 배선돼 있다', () => {
  const view = code('./IDEGoalMapView.tsx');

  it('한 핀에서 두 번째로 나간 선은 같은 행에 합류한다', () => {
    expect(view).toMatch(/hasOutgoing\(base, source, target\)/);
    expect(view).toMatch(/wireAfter\(currentRows\(\), source, target, \{ joinRow \}\)/);
  });

  it('그을 것이 없으면(중복·순환) 차례도 건드리지 않는다', () => {
    expect(view).toMatch(/if \(addWire\(base, source, target\) === base\) return;/);
  });

  it('선 끝을 빈 자리에 놓으면 끊긴다 — 잡은 순간과 뗀 순간이 한 쌍이다', () => {
    expect(view).toMatch(/onReconnectStart=\{onReconnectStart\}/);
    expect(view).toMatch(/onReconnectEnd=\{onReconnectEnd\}/);
    expect(view).toMatch(/reconnectedRef/);
  });

  it('노드 메뉴 [선 끊기] 가 그은 선이 있을 때만 선다', () => {
    expect(view).toMatch(/onClearWires=\{onClearWires\}/);
    expect(view).toMatch(/stepHasWires=\{/);
  });

  it('단계를 지우면 그 단계에 붙은 그은 선도 함께 걷는다', () => {
    expect(view).toMatch(/clearGoalWiresOf\(activeSessionId, stepId\)/);
  });

  it('빈 목록에서는 선을 걷지 않는다 — 스냅샷이 아직 안 온 한 프레임에 통째로 날아가지 않게', () => {
    expect(view).toMatch(/if \(!activeSessionId \|\| steps\.length === 0\) return;/);
  });
});

describe('㉖(c)·(h)-3 그은 선과 끊은 자리는 자리와 같은 축에 산다', () => {
  const store = code('../../stores/graphStore.ts');

  it('클라 로컬에만 남는다 — 전선·체크포인트로 가지 않는다', () => {
    expect(store).toMatch(/const GOAL_WIRES_KEY = 'vibisual:goalWires';/);
    expect(store).toMatch(/const GOAL_CUTS_KEY = 'vibisual:goalCuts';/);
    expect(store).toMatch(/saveJSON\(storageKey, next\);/);
  });

  it('두 축이 **같은 저장 규율**을 쓴다 — 상한·정리가 둘로 갈리면 한쪽만 고쳐진다', () => {
    expect(store).toMatch(/saveSessionWires\(s\.goalWires, sessionId, next, GOAL_WIRES_KEY\)/);
    expect(store).toMatch(/saveSessionWires\(s\.goalCuts, sessionId, next, GOAL_CUTS_KEY\)/);
  });

  it('세션 키에 상한이 있다 — 세션은 계속 새로 생긴다', () => {
    expect(store).toMatch(/Object\.keys\(next\)\.length - GOAL_LAYOUT_SESSIONS_MAX/);
  });

  it('판정은 순수 모듈 한 벌이 소유한다 — 저장고가 자기 규칙을 따로 들지 않는다', () => {
    expect(store).toMatch(/import \{ addCut, addCuts, addWire, removeWire, removeWiresOf, pruneWires, type GoalPinSide, type GoalWire \}/);
  });
});

describe('㉖(h) 핀에서 끊는 두 손짓', () => {
  const view = code('./IDEGoalMapView.tsx');
  const menu = code('./StageCanvasMenu.tsx');

  it('단축키 판정은 `ctrlKey || metaKey` 다 — Windows·Linux 는 Ctrl, macOS 는 ⌘', () => {
    expect(view).toMatch(/e\.ctrlKey \|\| e\.metaKey/);
  });

  it('Ctrl(⌘)을 누른 `mousedown` 은 삼킨다 — 끊으려던 손이 새 선을 끌고 다니지 않게', () => {
    const at = view.indexOf('function pinBreakHandlers');
    expect(at, 'pinBreakHandlers 를 못 찾음').toBeGreaterThan(-1);
    const body = view.slice(at, view.indexOf('\n}', at));
    expect(body).toMatch(/onMouseDown/);
    expect(body).toMatch(/onClick/);
    expect(body).toMatch(/onContextMenu/);
  });

  it('단축키 **표시**는 `shortcutLabel` 이 그린다 — 문자열을 직접 적지 않는다', () => {
    expect(view).toMatch(/shortcutLabel\('Ctrl'\)/);
    expect(view).not.toMatch(/'Ctrl\+/);
  });

  it('두 핀이 같은 규약을 쓴다 — 한 자리에서 만든 손짓을 양쪽에 단다', () => {
    expect(view).toMatch(/pinBreakHandlers\(step\.id, 'in', onBreakPin, onPinMenu\)/);
    expect(view).toMatch(/pinBreakHandlers\(step\.id, 'out', onBreakPin, onPinMenu\)/);
  });

  it('끊기는 그은 선을 방향대로 걷는다', () => {
    expect(view).toMatch(/clearGoalWiresOf\(activeSessionId, stepId, side\)/);
  });

  it('메뉴는 **핀 갈래를 노드 갈래보다 먼저** 본다 — 핀은 노드 위에 있어 둘 다 stepId 를 들고 온다', () => {
    const pinAt = menu.indexOf('if (step && anchor.pinSide)');
    const stepAt = menu.indexOf('if (step) {');
    expect(pinAt, '핀 갈래를 못 찾음').toBeGreaterThan(-1);
    expect(stepAt, '노드 갈래를 못 찾음').toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(stepAt);
  });

  it('끊을 것이 없는 핀에서는 칸 대신 한 줄이다', () => {
    expect(menu).toMatch(/canEdit && canBreakPin/);
    expect(menu).toMatch(/ide\.stage\.menu\.breakPinNone/);
  });

  it('핀 툴팁은 로케일 전부에서 단축키를 **변수로** 받는다', () => {
    const entries = Object.entries(localeFiles);
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const [path, raw] of entries) {
      const pin = (JSON.parse(raw) as { ide?: { stage?: { pin?: { in?: string; out?: string } } } }).ide?.stage?.pin;
      expect(pin?.in, path).toContain('{{shortcut}}');
      expect(pin?.out, path).toContain('{{shortcut}}');
      expect(pin?.in, path).not.toMatch(/Ctrl\s*\+/);
      expect(pin?.out, path).not.toMatch(/Ctrl\s*\+/);
    }
  });
});

/** §5.5 #17-17 ㉖(h)-3 — 끊기가 차례(행)를 건드리지 않는다(행을 합치면 팬아웃이 방금 끊은 핀에 선을 도로 그린다 — `[A][B][C][D]` 의 `C`). */
describe('㉖(h)-3 끊은 것은 끊긴 채로 남는다 — 끊기가 차례를 바꾸지 않는다', () => {
  const view = code('./IDEGoalMapView.tsx');

  /** 이름이 붙은 콜백 하나의 본문만 잘라 본다 — 옆 콜백의 코드가 검사를 통과시키지 않게. */
  function callback(name: string): string {
    const at = view.indexOf(`const ${name} = useCallback(`);
    expect(at, `${name} 을 못 찾음`).toBeGreaterThan(-1);
    const end = view.indexOf('\n  );', at);
    expect(end, `${name} 의 끝을 못 찾음`).toBeGreaterThan(at);
    return view.slice(at, end);
  }

  it('핀 끊기는 행을 합치지 않는다 — 합치면 팬아웃이 그 핀에 새 선을 도로 그린다', () => {
    const body = callback('onBreakPin');
    expect(body).toMatch(/clearGoalWiresOf\(activeSessionId, stepId, side\)/);
    expect(body).toMatch(/addGoalCuts\(activeSessionId, rowWiresAt\(currentRows\(\), stepId, side\)\)/);
    // 여기서 차례를 보내는 순간 결함이 되살아난다(종전 `breakAt` → `setUserGoalSteps`).
    expect(body).not.toMatch(/setUserGoalSteps/);
    expect(view).not.toMatch(/breakAt\(/);
  });

  it('선 끝을 빈 자리에 놓으면 끊은 자리로 남는다 — 그은 목록에서만 빼면 차례가 도로 그린다', () => {
    const body = callback('onReconnectEnd');
    expect(body).toMatch(/removeGoalWire\(activeSessionId, edge\.source, edge\.target\)/);
    expect(body).toMatch(/addGoalCut\(activeSessionId, edge\.source, edge\.target\)/);
  });

  it('옮겨 꽂으면 떠난 자리도 끊긴 채로 남는다', () => {
    expect(callback('onReconnect')).toMatch(/addGoalCut\(activeSessionId, old\.source, old\.target\)/);
  });

  it('노드 메뉴 [선 끊기] 는 양쪽 전부다 — 그은 선도, 차례가 그린 선도', () => {
    const body = callback('onClearWires');
    expect(body).toMatch(/clearGoalWiresOf\(activeSessionId, stepId\)/);
    expect(body).toMatch(/addGoalCuts\(activeSessionId, rowWiresAt\(currentRows\(\), stepId\)\)/);
  });

  it('같은 쌍을 다시 이으면 끊은 자리가 풀린다 — 끊기를 되돌리는 손잡이가 있어야 한다', () => {
    expect(callback('applyWire')).toMatch(/removeGoalCut\(activeSessionId, source, target\)/);
  });

  it('이미 끊은 핀에는 [끊기] 칸이 서지 않는다 — 서 있으면 그 자체로 "안 끊겼다"로 읽힌다', () => {
    expect(view).toMatch(/canBreakAt\(currentRows\(\), wires, menu\.stepId, menu\.pinSide, cuts\)/);
  });

  it('목록에서 사라진 단계의 끊은 자리도 저장고에서 걷는다', () => {
    expect(view).toMatch(/pruneGoalCuts\(activeSessionId, live\)/);
  });
});
