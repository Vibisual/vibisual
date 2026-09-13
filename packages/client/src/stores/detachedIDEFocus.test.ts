/**
 * detachedIDEFocus.test.ts — §5.5 #17-6 (판올림 번호 발급 대기)
 * **밖에 이미 서 있는 IDE 창은 다시 열지 않는다.**
 *
 * 앱 밖으로 꺼낸 IDE 창은 앱 안 창을 닫고 나간다((H) — "같은 IDE 가 두 곳에 뜨면 어느 쪽이
 * 진짜인지 알 수 없다"). 그런데 여는 손짓들은 그 규율을 몰라 밖에 펼쳐진 IDE 를 그대로 둔 채
 * 앱 안에 같은 창을 하나 더 세웠다. 이 파일은 갈림의 규칙과, 그 규칙을 **실제로 그렇게 쓰는지**를
 * 함께 고정한다(창을 띄우지 않는다 — 클라 테스트에는 DOM 이 없다).
 */
import { describe, expect, it } from 'vitest';
import {
  isOverlayWindowHash,
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

  it('접힌 버블 위젯은 IDE 가 아니다 — 종전대로 앱 안에서 연다', () => {
    // §17-6 (A) 위젯은 캔버스 버블의 **미러**다. 접혀 있는 동안은 IDE 가 두 곳에 뜨지 않는다.
    expect(ask({ overlays: [collapsedWidget] })).toEqual({ kind: 'app' });
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

// ─── 소스 집행 — 판정을 실제로 그렇게 쓰는지 ────────────────────────────────

const storeSources = import.meta.glob('./*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const hookSources = import.meta.glob('../hooks/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

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
