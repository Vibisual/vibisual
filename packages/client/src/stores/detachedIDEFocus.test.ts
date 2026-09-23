/**
 * detachedIDEFocus.test.ts — §5.5 #17-6 (판올림 번호 발급 대기)
 * **밖에 이미 서 있는 IDE 창은 다시 열지 않는다.**
 *
 * 앱 밖으로 꺼낸 IDE 창은 앱 안 창을 닫고 나간다((H) — "같은 IDE 가 두 곳에 뜨면 어느 쪽이
 * 진짜인지 알 수 없다"). 그런데 여는 손짓들은 그 규율을 몰라 밖에 펼쳐진 IDE 를 그대로 둔 채
 * 앱 안에 같은 창을 하나 더 세웠다. 이 파일은 갈림의 규칙과, 그 규칙을 **실제로 그렇게 쓰는지**를
 * 함께 고정한다(창을 띄우지 않는다 — 클라 테스트에는 DOM 이 없다).
 *
 * (H-27) 밖에 **접힌 버블**로 떠 있는 에이전트도 앱 안에 IDE 를 세우지 않고 그 창을 IDE 로 편다
 * (사용자 지시 — "버블 오버레이로 되어있다면 ide창이 열려야하고 즉 2개가 열리는걸 막으라고").
 * 반대로 밖에서 IDE 가 먼저 펴지면 앱 안의 같은 창이 짐을 넘기고 물러난다. 앱에 남기는 예외
 * 셋(ⓐ 앱 안에 그 창이 이미 있음 · ⓑ 전역 표시 꺼짐 · ⓒ 프로젝트 모름)도 여기서 함께 잠근다.
 */
import { describe, expect, it } from 'vitest';
import {
  agentIDEPaneKey,
  coerceIDEFocusTarget,
  hasAppIDEPane,
  isOverlayWindowHash,
  panesYieldingToDetachedIDE,
  resolveOpenIDEDestination,
  type OverlayWindowInfo,
} from './detachedIDEFocus.js';

const expandedWindow: OverlayWindowInfo = { agentId: 'a1', projectId: 'proj', expanded: true };
const collapsedWidget: OverlayWindowInfo = { agentId: 'a1', projectId: 'proj', expanded: false };

function ask(over: Partial<Parameters<typeof resolveOpenIDEDestination>[0]> = {}): ReturnType<typeof resolveOpenIDEDestination> {
  return resolveOpenIDEDestination({
    agentId: 'a1',
    overlays: [],
    selfIsOverlayWindow: false,
    redock: false,
    hasOverlayApi: true,
    appHasPane: false,
    overlaysVisible: true,
    ...over,
  });
}

describe('resolveOpenIDEDestination — 밖에 펼쳐진 창이 있으면 그 창을 앞으로', () => {
  it('밖에 그 에이전트의 IDE 가 펼쳐져 있으면 앱 안에 열지 않는다', () => {
    expect(ask({ overlays: [expandedWindow] })).toEqual({
      kind: 'detached',
      agentId: 'a1',
      projectId: 'proj',
    });
  });

  it('앞으로 세울 창의 `projectId` 는 **그 창이 등록된 값**을 그대로 쓴다', () => {
    // main 은 `agentId → 창` 으로 찾지만 `open` 은 projectId 를 함께 받는다 — 여기서 다른 값을
    //   지어 보내면 그 창이 아니라 새 창이 설 수 있다.
    const dest = ask({ overlays: [{ agentId: 'a1', projectId: 'worktree-x', expanded: true }] });
    expect(dest).toEqual({ kind: 'detached', agentId: 'a1', projectId: 'worktree-x' });
  });

  it('다른 에이전트의 창만 밖에 있으면 앱 안에서 연다', () => {
    expect(ask({ overlays: [{ agentId: 'other', projectId: 'proj', expanded: true }] })).toEqual({ kind: 'app' });
  });

  it('**이 창 자신이 독립 창**이면 갈리지 않는다 — 자기 IDE 를 펴는 길이 막힌다', () => {
    // 창 목록은 모든 창에 함께 밀리므로 독립 창의 store 에도 자기 자신이 들어 있다.
    expect(ask({ overlays: [expandedWindow], selfIsOverlayWindow: true })).toEqual({ kind: 'app' });
  });

  it('밖에서 앱 안으로 **되돌아오는 길**(redock)은 예외 — 그 창은 닫히는 중이다', () => {
    expect(ask({ overlays: [expandedWindow], redock: true })).toEqual({ kind: 'app' });
  });

  it('오버레이 IPC 가 없는 창(브라우저·구버전 preload)은 종전 그대로', () => {
    expect(ask({ overlays: [expandedWindow], hasOverlayApi: false })).toEqual({ kind: 'app' });
  });
});

describe('(H-27) resolveOpenIDEDestination — 밖에 접힌 버블이 있으면 그 창을 IDE 로 편다', () => {
  it('접힌 버블이면 그 창으로 보낸다 — 앱 안에 세우면 그 버블을 펴는 순간 같은 IDE 가 두 곳에 선다', () => {
    // (H-13) ② "접힌 버블 위젯은 IDE 가 아니다 — 앱 안에서 연다"를 사용자 지시로 대체했다.
    expect(ask({ overlays: [collapsedWidget] })).toEqual({ kind: 'detached', agentId: 'a1', projectId: 'proj' });
  });

  it('ⓐ 앱 안에 그 창이 이미 서 있으면 앱이다 — 여는 길이 그 창을 앞으로 올리기만 해 두 벌이 아니다', () => {
    expect(ask({ overlays: [collapsedWidget], appHasPane: true })).toEqual({ kind: 'app' });
  });

  it('ⓐ 는 접힌 버블에만 걸린다 — 밖에 IDE 로 펼친 창이 있으면 종전대로 밖이 이긴다((H-13))', () => {
    expect(ask({ overlays: [expandedWindow], appHasPane: true })).toEqual({ kind: 'detached', agentId: 'a1', projectId: 'proj' });
  });

  it('ⓑ 전역 표시가 꺼져 있으면 앱이다 — 숨긴 버블을 펴면 스위치가 켜지며 다른 버블까지 모두 나타난다', () => {
    expect(ask({ overlays: [collapsedWidget], overlaysVisible: false })).toEqual({ kind: 'app' });
  });

  it('ⓑ 도 접힌 버블에만 걸린다 — 숨겨 둔 펼친 IDE 는 종전대로 스위치를 켜고 보여 준다', () => {
    expect(ask({ overlays: [expandedWindow], overlaysVisible: false })).toEqual({ kind: 'detached', agentId: 'a1', projectId: 'proj' });
  });

  it('ⓒ 그 창의 프로젝트를 모르면 앱이다 — main 의 `overlay:open` 이 빈 projectId 를 받지 않는다', () => {
    expect(ask({ overlays: [{ agentId: 'a1', projectId: '', expanded: false }] })).toEqual({ kind: 'app' });
  });

  it('접힌 버블도 앞의 세 예외(독립 창 자신 · 되돌아오는 길 · IPC 없음)를 그대로 따른다', () => {
    expect(ask({ overlays: [collapsedWidget], selfIsOverlayWindow: true })).toEqual({ kind: 'app' });
    expect(ask({ overlays: [collapsedWidget], redock: true })).toEqual({ kind: 'app' });
    expect(ask({ overlays: [collapsedWidget], hasOverlayApi: false })).toEqual({ kind: 'app' });
  });
});

describe('(H-27) ⓐ hasAppIDEPane — `openIDEOverlay` 의 `already` 와 같은 창을 본다', () => {
  const pane = (projectId: string | null, agentId: string | null) => ({ projectId, agentId });

  it('슬롯 주인의 프로젝트에 그 에이전트의 창이 있으면 참', () => {
    expect(hasAppIDEPane([pane('other', 'a2'), pane('proj', 'a1')], 'proj', 'a1')).toBe(true);
  });

  it('다른 프로젝트 탭의 창은 세지 않는다 — 여는 길은 그 창을 올리지 못하고 새 창을 세운다', () => {
    expect(hasAppIDEPane([pane('other', 'a1')], 'proj', 'a1')).toBe(false);
  });

  it('다른 에이전트의 창 · 에이전트가 없는 창은 세지 않는다', () => {
    expect(hasAppIDEPane([pane('proj', 'a2'), pane('proj', null)], 'proj', 'a1')).toBe(false);
  });

  it('슬롯 주인을 모르면 거짓 — 그 판의 여는 길은 앱 안에 아무것도 세우지 않는다', () => {
    for (const owner of [null, undefined, '']) {
      expect(hasAppIDEPane([pane('proj', 'a1'), pane('', 'a1')], owner, 'a1')).toBe(false);
    }
  });
});

describe('(H-27) ⑤ panesYieldingToDetachedIDE — 밖에서 IDE 가 펴질 때 앱 안에서 물러날 창들', () => {
  const pane = (paneKey: string, agentId: string | null, z: number, projectId = 'proj') => ({ paneKey, agentId, z, projectId });

  it('앱 안에 그 에이전트의 창이 없으면 아무것도 물러나지 않는다', () => {
    expect(panesYieldingToDetachedIDE([], 'a1')).toEqual({ front: null, paneKeys: [] });
    expect(panesYieldingToDetachedIDE([pane('p1', 'a2', 1), pane('p2', null, 2)], 'a1')).toEqual({ front: null, paneKeys: [] });
  });

  it('그 에이전트의 창은 모두 물러나고, 짐은 맨 앞(z 가 가장 큰) 창의 것을 넘긴다', () => {
    const back = pane('p1', 'a1', 3);
    const other = pane('p2', 'a2', 9);
    const front = pane('p3', 'a1', 7);
    const out = panesYieldingToDetachedIDE([back, other, front], 'a1');
    expect(out.paneKeys).toEqual(['p1', 'p3']);
    expect(out.front).toBe(front);
  });

  it('프로젝트 탭은 가리지 않는다 — 다른 탭에 가려져 있을 뿐 같은 IDE 가 두 벌이다', () => {
    const here = pane('p1', 'a1', 1, 'proj');
    const elsewhere = pane('p2', 'a1', 2, 'other');
    const out = panesYieldingToDetachedIDE([here, elsewhere], 'a1');
    expect(out.paneKeys).toEqual(['p1', 'p2']);
    expect(out.front).toBe(elsewhere);
  });
});

describe('isOverlayWindowHash — 이 창이 독립(오버레이) 창인가', () => {
  it('`#overlay=1` 이면 참', () => {
    expect(isOverlayWindowHash('#overlay=1&agentId=a1&projectId=p1')).toBe(true);
    expect(isOverlayWindowHash('#overlay=1&agentId=a1&projectId=p1&expanded=1')).toBe(true);
  });

  it('메인 캔버스 창(해시 없음)은 거짓', () => {
    expect(isOverlayWindowHash('')).toBe(false);
    expect(isOverlayWindowHash('#')).toBe(false);
  });

  it('별창·메뉴 팝업·지휘통제실 창은 거짓 — 저마다 다른 해시다', () => {
    expect(isOverlayWindowHash('#detached=1&kind=project&tabKey=p1')).toBe(false);
    expect(isOverlayWindowHash('#overlaymenu=1&targetWindowId=3&agentId=a1')).toBe(false);
    expect(isOverlayWindowHash('#command=1&projectId=p1')).toBe(false);
  });
});

describe('(H-27) ⑦ coerceIDEFocusTarget — 창구를 건너온 "세울 세션"을 가린다', () => {
  it('객체가 아니면 세우지 않는다', () => {
    expect(coerceIDEFocusTarget(undefined)).toBeNull();
    expect(coerceIDEFocusTarget(null)).toBeNull();
    expect(coerceIDEFocusTarget('sub-1')).toBeNull();
    expect(coerceIDEFocusTarget(42)).toBeNull();
    expect(coerceIDEFocusTarget([])).toBeNull();
  });

  it('세션 칸이 `null` 이면 메인 탭이다 — 칸이 없는 것과 다르다', () => {
    expect(coerceIDEFocusTarget({ sessionId: null })).toEqual({ sessionId: null });
  });

  it('세션 칸이 없거나 비었거나 모양이 틀리면 세우지 않는다 — 엉뚱한 탭으로 옮기느니 보던 세션에 둔다', () => {
    expect(coerceIDEFocusTarget({})).toBeNull();
    expect(coerceIDEFocusTarget({ sessionId: '' })).toBeNull();
    expect(coerceIDEFocusTarget({ sessionId: 7 })).toBeNull();
  });

  it('북마크 자리는 글과 앵커를 함께 넘기고, 빈 앵커는 버린다', () => {
    expect(coerceIDEFocusTarget({ sessionId: 's1', bookmark: { text: '여기', anchorId: 'a1' } }))
      .toEqual({ sessionId: 's1', bookmark: { text: '여기', anchorId: 'a1' } });
    const noAnchor = coerceIDEFocusTarget({ sessionId: 's1', bookmark: { text: '여기', anchorId: '' } });
    expect(noAnchor).toEqual({ sessionId: 's1', bookmark: { text: '여기' } });
    expect(noAnchor?.bookmark && 'anchorId' in noAnchor.bookmark).toBe(false);
  });

  it('북마크 자리만 틀렸으면 세션은 세우고 자리만 버린다', () => {
    const badText = coerceIDEFocusTarget({ sessionId: 's1', bookmark: { text: 3 } });
    expect(badText).toEqual({ sessionId: 's1' });
    expect(badText && 'bookmark' in badText).toBe(false);
    expect(coerceIDEFocusTarget({ sessionId: 's1', bookmark: 'x' })).toEqual({ sessionId: 's1' });
    expect(coerceIDEFocusTarget({ sessionId: null, bookmark: null })).toEqual({ sessionId: null });
  });

  it('필요한 칸만 옮긴다 — 함께 건너온 다른 칸은 버린다', () => {
    expect(coerceIDEFocusTarget({ sessionId: 's1', paneKey: 'p9' })).toEqual({ sessionId: 's1' });
  });
});

describe('(H-27) ⑦ agentIDEPaneKey — 세션은 그 에이전트의 창에만 세운다', () => {
  const pane = (paneKey: string, agentId: string | null, z: number, projectId: string | null = 'proj') => ({
    paneKey,
    projectId,
    agentId,
    z,
  });

  it('슬롯 주인을 모르면 없다 — 키 없이 부르면 맨 앞의 남의 창에 선다', () => {
    const panes = [pane('p1', 'a1', 1)];
    expect(agentIDEPaneKey(panes, null, 'a1')).toBeNull();
    expect(agentIDEPaneKey(panes, undefined, 'a1')).toBeNull();
    expect(agentIDEPaneKey(panes, '', 'a1')).toBeNull();
  });

  it('남의 창·빈 창뿐이면 없다 — 그 에이전트의 IDE 는 밖에 나가 있거나 아예 안 열렸다', () => {
    expect(agentIDEPaneKey([pane('p1', 'other', 9), pane('p2', null, 10)], 'proj', 'a1')).toBeNull();
  });

  it('다른 프로젝트 탭에 선 창은 세지 않는다', () => {
    expect(agentIDEPaneKey([pane('p1', 'a1', 3, 'elsewhere')], 'proj', 'a1')).toBeNull();
  });

  it('그 에이전트의 창이 여럿이면 맨 앞(z 가 가장 큰) 창이다 — 남의 창이 더 앞이어도 그렇다', () => {
    const panes = [pane('back', 'a1', 2), pane('other', 'b1', 99), pane('front', 'a1', 7), pane('mid', 'a1', 5)];
    expect(agentIDEPaneKey(panes, 'proj', 'a1')).toBe('front');
  });

  it('"앱 안에 그 창이 있다"(ⓐ)와 늘 같은 답이다 — 어긋나면 연 창에 세션이 서지 않는다', () => {
    const panes = [pane('p1', 'a1', 1), pane('p2', 'b1', 2, 'x'), pane('p3', null, 3)];
    const cases: [string | null, string][] = [['proj', 'a1'], ['proj', 'b1'], ['x', 'b1'], [null, 'a1'], ['proj', 'zz']];
    for (const [owner, agent] of cases) {
      expect(agentIDEPaneKey(panes, owner, agent) !== null).toBe(hasAppIDEPane(panes, owner, agent));
    }
  });
});

// ─── 소스 집행 — 판정을 실제로 그렇게 쓰는지 ────────────────────────────────

const storeSources = import.meta.glob('./*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const hookSources = import.meta.glob('../hooks/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const transportSources = import.meta.glob('../transport/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
// (H-27) ⑦ 세션을 세우는 줄은 컴포넌트에도 있다 — 창 키 없는 호출이 어디에도 남지 않았는지 전부 훑는다.
const clientSources = {
  ...import.meta.glob('../**/*.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('../**/*.tsx', { eager: true, query: '?raw', import: 'default' }),
} as Record<string, string>;

function source(map: Record<string, string>, key: string): string {
  const found = map[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
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

describe('openIDEOverlay — 여는 손잡이가 전부 지나는 그 한 곳', () => {
  const open = block(
    source(storeSources, './graphStore.ts'),
    'openIDEOverlay: (agentId, opts) => {',
    '// §5.19 (B) — All Model 버블은',
  );

  it('밖의 창 판정을 **가장 먼저** 한다 — 그 뒤 줄들은 앱 안에 창을 세우는 길이다', () => {
    expect(open).toContain('resolveOpenIDEDestination(');
    expect(open).toContain('overlays: get().overlayWindows');
  });

  it('그 창이 밖에 있으면 앱 안에는 아무것도 세우지 않고 끝낸다', () => {
    expect(open).toContain("ideDestination.kind === 'detached'");
    expect(open).toMatch(/return;\s*\n\s*}/);
  });

  it('앞으로 세우는 길은 **기존 `overlay.open`** 하나 — 포커스 전용 IPC 를 새로 만들지 않는다', () => {
    expect(open).toContain('overlayApi?.open(');
    expect(open).toContain('expanded: true');
  });

  it('이 창이 독립 창이면 갈리지 않도록 해시를 함께 넘긴다', () => {
    expect(open).toContain('isOverlayWindowHash(window.location.hash)');
  });
});

describe('되돌아오는 길은 `redock` 으로 표시한다', () => {
  const reveal = source(hookSources, '../hooks/useOverlayReveal.ts');

  it('짐이 없는 되돌리기도 앱 안에 세운다', () => {
    expect(reveal).toContain("openIDEOverlay(agentId, { pane: 'new', redock: true })");
  });

  it('짐을 지고 오는 되돌리기도 앱 안에 세운다', () => {
    const withHandoff = block(reveal, 'takeHandoff(agentId).then', '});');
    expect(withHandoff).toContain('redock: true');
  });
});

describe('(H-27) openIDEOverlay — 접힌 버블 갈림에 넘기는 두 값', () => {
  const store = source(storeSources, './graphStore.ts');
  const open = block(store, 'openIDEOverlay: (agentId, opts) => {', '// §5.19 (B) — All Model 버블은');

  it('ⓐ 는 아래 `already` 와 **같은 슬롯 주인**으로 잰다 — 어긋나면 앱 안 창을 못 보고 밖의 버블까지 펴 두 벌이 된다', () => {
    expect(open).toContain('appHasPane: hasAppIDEPane(');
    expect(open).toContain('Object.values(get().ideOverlays),');
    expect(open).toContain('get().activeProject ?? get().agentProjects[agentId],');
    // 짝이 되는 줄 — 이 둘 중 하나만 바뀌면 여기서 걸린다.
    const slot = block(store, 'openIDEOverlay: (agentId, opts) => {', 'const already = panes.find((o) => o.agentId === agentId);');
    expect(slot).toContain('const ownerProject = state.activeProject ?? state.agentProjects[agentId];');
    expect(slot).toContain('.filter((o) => o.projectId === ownerProject && !!o.agentId)');
  });

  it('ⓑ 는 전역 표시 스위치를 그대로 넘긴다', () => {
    expect(open).toContain('overlaysVisible: get().overlaysVisible,');
  });
});

describe('(H-27) ⑤ 밖에서 IDE 가 펴지면 앱 안의 같은 창이 짐을 넘기고 물러난다', () => {
  const reveal = source(hookSources, '../hooks/useOverlayReveal.ts');
  const yielding = block(reveal, 'overlay.onIdeOpened(', 'return () => { off(); };');

  it('물러날 창은 판정 함수가 고른다 — 프로젝트 탭을 가리지 않고 모든 창을 넘긴다', () => {
    expect(yielding).toContain('panesYieldingToDetachedIDE(Object.values(store.ideOverlays), agentId)');
  });

  it('물러날 창이 없으면 아무것도 하지 않는다 — 앱이 부른 버블은 ⓐ 로 이미 걸러졌다', () => {
    expect(yielding).toContain('if (paneKeys.length === 0) return;');
  });

  it('맨 앞 창의 짐은 종전 짐 길(`overlay.open` → `pane-handoff`)로 넘기고, 창은 짐을 뜬 **뒤에** 닫는다', () => {
    const capture = yielding.indexOf('captureIDEPaneHandoff(front)');
    const send = yielding.indexOf('overlay.open({ agentId, projectId, expanded: true, handoff })');
    const close = yielding.indexOf('for (const key of paneKeys) store.closeIDEOverlay(key);');
    expect(capture).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(capture);
    expect(close).toBeGreaterThan(capture);
  });

  it('알림이 없는 창(브라우저·구버전 preload)에서는 조용히 지나간다', () => {
    expect(reveal).toContain('if (!overlay?.onIdeOpened) return;');
    const transport = source(transportSources, '../transport/install-packaged-transport.ts');
    expect(transport).toContain('onIdeOpened?(cb: (payload: { agentId: string; projectId: string }) => void): () => void;');
  });
});

/** 글롭 키 모양(`./` · `../`)에 기대지 않고 파일 끝 경로로 찾는다. */
function sourceEndingWith(suffix: string): string {
  const hit = Object.entries(clientSources).find(([key]) => key.endsWith(suffix));
  if (!hit) throw new Error(`소스를 못 찾음: ${suffix}`);
  return hit[1];
}

describe('(H-27) ⑦ 세션을 골라 여는 손짓 — 세울 세션을 여는 길에 싣는다', () => {
  const store = source(storeSources, './graphStore.ts');
  const whole = block(store, 'openIDEOverlay: (agentId, opts) => {', 'closeIDEOverlay: (paneKey) => set((state) => {');
  const head = block(store, 'openIDEOverlay: (agentId, opts) => {', '// §5.19 (B) — All Model 버블은');

  it('밖으로 가는 부름은 세울 세션을 기존 `overlay.open` 에 싣는다 — 앱 안에는 그 에이전트의 창이 없다', () => {
    expect(head).toContain('...(opts?.focus ? { focus: opts.focus } : {}),');
  });

  it('앱 안이면 창을 세운 **다음에** 그 에이전트의 창을 키로 찾아 세운다', () => {
    const from = whole.indexOf('const focus = opts?.focus;');
    expect(from).toBeGreaterThan(whole.indexOf('...(handoffPatch ?? {}),'));
    const tail = whole.slice(from);
    expect(tail).toContain('const paneKey = agentIDEPaneKey(');
    // 슬롯 주인은 여는 길(`ownerProject`)·ⓐ 와 같은 순서로 잰다.
    expect(tail).toContain('after.activeProject ?? after.agentProjects[agentId],');
    const apply = tail.indexOf('after.setIDEActiveSession(focus.sessionId, paneKey);');
    expect(apply).toBeGreaterThan(-1);
    // 북마크 자리는 세션이 선 뒤에, 매번 새 번호로 건넨다(같은 자리로 두 번 뛰어도 다시 내려간다).
    expect(tail.indexOf('bookmarkScrollTarget: {')).toBeGreaterThan(apply);
    expect(tail).toContain('nonce: (s.bookmarkScrollTarget?.nonce ?? 0) + 1,');
  });

  it('북마크 점프는 연 뒤에 따로 세우지 않는다 — 출처 세션과 그 자리를 여는 길에 싣는다', () => {
    const jump = block(store, 'jumpToBookmark: (bookmark) => {', 'bookmarkScrollTarget: null,');
    expect(jump).toContain('get().openIDEOverlay(bookmark.agentId, {');
    expect(jump).toContain('sessionId: bookmark.sessionId,');
    expect(jump).toContain('? { text: bookmark.text, anchorId: bookmark.anchorId }');
    expect(jump).not.toContain('setIDEActiveSession(');
    expect(jump).not.toContain('bookmarkScrollTarget');
  });

  it('보낸 명령의 세션 전환은 그 에이전트의 창에서만 — 창이 없으면 한도 정지 확인만 한다(#17-47 ①)', () => {
    const add = block(store, 'addCommand: (agentId, text, subAgentId, attachments) => {', 'removeCommand: (agentId, commandId) => {');
    expect(add).toContain('const own = agentIDEPaneKey(');
    expect(add).toContain('own === submittedPane');
    expect(add).toContain('now.setIDEActiveSession(sentTo, own);');
    expect(add).toContain('else now.acknowledgeUsageLimit({ subAgentIds: [sentTo] });');
  });

  it('세션 북마크 · 지휘통제실 [이동] · 콘티 이력 · [창과 버블] 새 창 줄은 세션을 실어 연다', () => {
    const bookmarks = source(hookSources, '../hooks/useBookmarks.ts');
    expect(bookmarks).toContain('store.openIDEOverlay(bm.agentId, { focus: { sessionId } });');
    const reveal = source(hookSources, '../hooks/useCommandCenterReveal.ts');
    expect(reveal).toContain('store.openIDEOverlay(agentId, live ? { focus: { sessionId: live } } : undefined);');
    // 콘티는 새 세션을 받은 뒤 **한 번** 연다 — 두 번 열면 밖의 창이 두 번 앞으로 서며 두 번 비친다.
    const conti = sourceEndingWith('/components/Panel/ContiHistoryDetail.tsx');
    const generate = block(conti, 'const handleGenerate = useCallback(() => {', '}, [agentId, openIDEOverlay]);');
    expect(generate).toContain('openIDEOverlay(agentId, data.subAgent ? { focus: { sessionId: data.subAgent.id } } : undefined);');
    expect(generate.split('openIDEOverlay(agentId').length - 1).toBe(2); // 성공 한 번 + 실패 폴백 한 번
    expect(generate.indexOf('openIDEOverlay(')).toBeGreaterThan(generate.indexOf("fetch(`/api/subagents/${agentId}`"));
    const windows = sourceEndingWith('/components/Layout/IDEWindowsMenu.tsx');
    const openNew = block(windows, "useGraphStore.getState().openIDEOverlay(agentId, {", '});');
    expect(openNew).toContain("pane: 'new',");
    expect(openNew).toContain('...(liveSession ? { focus: { sessionId: liveSession } } : {}),');
  });

  it('앱 안에서 세션을 세우는 줄은 모두 창 키를 쥔다 — 키 없는 한 줄이 남의 창을 그 세션으로 바꾼다', () => {
    const keyless = /setIDEActiveSession\([^,()]*\)/;
    // 훑을 판이 비었거나 정규식이 헛돌면 늘 통과한다 — 잡아야 할 줄은 잡고, 세우는 줄이 있는 파일은 들어왔는지 먼저 본다.
    expect(keyless.test('get().setIDEActiveSession(bookmark.sessionId);')).toBe(true);
    expect(keyless.test('now.setIDEActiveSession(sentTo, own);')).toBe(false);
    expect(Object.keys(clientSources).length).toBeGreaterThan(200);
    const graph = Object.entries(clientSources).find(([key]) => key === './graphStore.ts' || key.endsWith('/stores/graphStore.ts'));
    expect(graph?.[1]).toContain('after.setIDEActiveSession(focus.sessionId, paneKey);');
    expect(sourceEndingWith('/components/IDE/AgentIDEOverlay.tsx')).toContain('setIDEActiveSession(sessionId, paneKey)');
    const offenders = Object.entries(clientSources)
      .filter(([key]) => !key.includes('.test.'))
      .filter(([, src]) => keyless.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

describe('(H-27) ⑦ 밖의 창 — [IDE 열기]에 실려 온 세션을 제 IDE 에 세운다', () => {
  const shell = sourceEndingWith('/components/Layout/OverlayShell.tsx');
  const menu = block(shell, 'overlay.onMenuCommand(({ command, focus }) => {', '}, [agentId, openIDEOverlay]);');

  it('실려 온 값은 모양을 가린 뒤 여는 길에 싣는다 — 이 창 자신이라 앱 안 갈래로 가 제 IDE 에 선다', () => {
    expect(menu).toContain('const target = coerceIDEFocusTarget(focus);');
    expect(menu).toContain('openIDEOverlay(agentId, target ? { focus: target } : undefined);');
  });

  it('끌어낸 직후 짐을 풀기 전에 온 세션은 맡아 두었다가 짐을 푼 **다음에** 세운다 — 먼저 세우면 짐이 덮는다', () => {
    const hold = menu.indexOf('if (!popOutSettledRef.current) {');
    expect(hold).toBeGreaterThan(-1);
    expect(menu).toContain('if (target) deferredFocusRef.current = target;');
    expect(hold).toBeLessThan(menu.indexOf('openIDEOverlay(agentId, target ? { focus: target } : undefined);'));
    // 버블로 태어난 창은 풀 짐이 없어 처음부터 풀린 판이다.
    expect(shell).toContain('const popOutSettledRef = useRef(!initiallyExpanded);');
    const settle = block(shell, 'const settlePopOut = useCallback(() => {', '}, [agentId, openIDEOverlay]);');
    expect(settle).toContain('popOutSettledRef.current = true;');
    expect(settle).toContain('deferredFocusRef.current = null;');
    expect(settle).toContain('if (focus) openIDEOverlay(agentId, { focus });');
  });

  it('짐을 푸는 두 갈래 모두 연 **뒤에** 풀렸다고 적는다', () => {
    const popOut = block(shell, 'const popOutOpenedRef = useRef(false);', '}, [initiallyExpanded, agent, agentId, openIDEOverlay, settlePopOut]);');
    const withHandoff = popOut.indexOf("handoffTarget: 'detached',");
    expect(withHandoff).toBeGreaterThan(-1);
    expect(popOut.lastIndexOf('settlePopOut();')).toBeGreaterThan(withHandoff);
    const plain = popOut.indexOf('openIDEOverlay(agentId);');
    expect(plain).toBeGreaterThan(-1);
    expect(popOut.indexOf('settlePopOut();', plain)).toBeGreaterThan(plain);
  });

  it('창구 타입도 세울 세션을 싣는다 — 받는 쪽이 모양을 가리므로 `unknown` 이다', () => {
    const transport = source(transportSources, '../transport/install-packaged-transport.ts');
    expect(transport).toContain('onMenuCommand(cb: (payload: { command: string; focus?: unknown }) => void): () => void;');
  });
});
