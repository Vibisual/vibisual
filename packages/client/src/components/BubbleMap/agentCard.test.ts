import { describe, expect, it } from 'vitest';
import type { AppBubble, BubbleData } from '@vibisual/shared';
import {
  APP_BUBBLE_LINK_MAX,
  linkedFileName,
  projectRelativePath,
  sanitizeLinkedAgentIds,
  withLinkedAgent,
  withoutLinkedAgent,
} from '@vibisual/shared';
import {
  LINKED_OUTPUT_MARK,
  appNodeLabel,
  buildLinkedOutputBrief,
  canUseAgentCard,
  isAgentCardForm,
  isRectNode,
  linkedAppBubblesKey,
  linkedAppBubblesOf,
  nodeBorderDistance,
  pickCardSession,
  rectBorderDistance,
  refLinkEndpoints,
  refLinkPairs,
  refLinkPath,
  withLinkedOutputBrief,
  type LinkedOutputNode,
} from './agentCard.js';

/**
 * §5.4 #36 — 전환과 연결의 순수 판정. 화면(카드·메뉴·선)과 서버(REST 검증)가 같은 답을 내야 하는 것들이다.
 */

function agent(over: Partial<BubbleData> = {}): BubbleData {
  return {
    id: 'agent-1',
    label: 'Agent 1',
    bubbleType: 'agent',
    path: 'agent-1',
    status: 'idle',
    activity: 0,
    customCreated: true,
    ...over,
  } as BubbleData;
}

function app(over: Partial<AppBubble> = {}): AppBubble {
  return {
    id: 'app-1',
    projectName: 'proj',
    appId: 'some-app',
    x: 0,
    y: 0,
    width: 80,
    height: 50,
    createdAt: 1,
    ...over,
  };
}

describe('§5.4 #36 (A) 누가 입력 카드가 될 수 있나', () => {
  it('커스텀 에이전트만 — 훅·CMD·버려진 에이전트·다른 버블은 아니다', () => {
    expect(canUseAgentCard(agent(), undefined)).toBe(true);
    expect(canUseAgentCard(agent({ customCreated: false }), undefined)).toBe(false);
    expect(canUseAgentCard(agent(), { executionMode: 'interactive-terminal' })).toBe(false);
    expect(canUseAgentCard(agent({ trashed: true }), undefined)).toBe(false);
    expect(canUseAgentCard(agent({ bubbleType: 'file' }), undefined)).toBe(false);
    expect(canUseAgentCard(undefined, undefined)).toBe(false);
  });

  it('카드로 그리는 것은 형태 칸이 card 인 커스텀 에이전트뿐이다(휴지통 안은 버블)', () => {
    expect(isAgentCardForm(agent({ agentForm: 'card' }))).toBe(true);
    expect(isAgentCardForm(agent())).toBe(false);
    expect(isAgentCardForm(agent({ agentForm: 'card', trashed: true }))).toBe(false);
    expect(isAgentCardForm(agent({ agentForm: 'card', customCreated: false }))).toBe(false);
  });

  it('보낼 세션은 버블이 보여 주는 세션과 같은 우선순위다', () => {
    const subs = [{ id: 's1', status: 'idle' }, { id: 's2', status: 'idle' }, { id: 's3', status: 'active' }];
    expect(pickCardSession(subs, 's1', 's2')).toBe('s3'); // 도는 세션이 먼저
    const idle = subs.map((s) => ({ ...s, status: 'idle' }));
    expect(pickCardSession(idle, 's1', 's2')).toBe('s1'); // 그다음 IDE 에서 고른 탭
    expect(pickCardSession(idle, null, 's2')).toBe('s2'); // 그다음 마지막으로 고른 탭
    expect(pickCardSession(idle, 'gone', undefined)).toBeNull(); // 없는 탭은 무시 → 서버 기본
    expect(pickCardSession(undefined, 's1', 's2')).toBeNull();
  });
});

describe('§5.4 #36 (B) 누가 누구를 참조하나', () => {
  const bubbles = [
    app({ id: 'b', createdAt: 2, linkedAgentIds: ['agent-1'] }),
    app({ id: 'a', createdAt: 1, linkedAgentIds: ['agent-1', 'agent-2'] }),
    app({ id: 'c', createdAt: 3, linkedAgentIds: ['agent-2'] }),
    app({ id: 'd', createdAt: 4, projectName: 'other', linkedAgentIds: ['agent-1'] }),
  ];

  it('이 에이전트를 참조하는 노드를 만든 순으로, 프로젝트를 가려 고른다', () => {
    expect(linkedAppBubblesOf(bubbles, 'agent-1', 'proj').map((b) => b.id)).toEqual(['a', 'b']);
    expect(linkedAppBubblesOf(bubbles, 'agent-1', null).map((b) => b.id)).toEqual(['a', 'b', 'd']);
  });

  it('지문은 좌표가 움직여도 그대로다 — 앱 노드를 끄는 매 프레임 카드가 깨면 안 된다', () => {
    const before = linkedAppBubblesKey(bubbles, 'agent-1', 'proj');
    const moved = bubbles.map((b) => ({ ...b, x: b.x + 120, y: b.y - 40 }));
    expect(linkedAppBubblesKey(moved, 'agent-1', 'proj')).toBe(before);
    const renamed = bubbles.map((b) => (b.id === 'a' ? { ...b, title: '새 이름' } : b));
    expect(linkedAppBubblesKey(renamed, 'agent-1', 'proj')).not.toBe(before);
  });

  it('참조선은 끝점(에이전트)이 지금 화면에 있을 때만 만든다', () => {
    const pairs = refLinkPairs(bubbles, new Set(['agent-1']), 'proj');
    expect(pairs.map((p) => p.id)).toEqual(['ref-agent-1-b', 'ref-agent-1-a']);
    expect(refLinkPairs(bubbles, new Set(), 'proj')).toEqual([]);
  });
});

describe('§5.4 #36 (C) 참조 칩이 명령에 붙이는 것', () => {
  const nodes: LinkedOutputNode[] = [
    { id: 'app-9', appName: 'Imager', label: 'Logo', accepts: ['.png', '.svg'], file: 'out/logo.png' },
    { id: 'app-8', appName: 'Sounder', label: 'Sounder', accepts: [] },
  ];

  it('노드 id·앱 이름·받는 확장자·담긴 파일과 전달 창구를 적고, 토큰 값은 싣지 않는다', () => {
    const brief = buildLinkedOutputBrief(nodes);
    expect(brief).toContain(LINKED_OUTPUT_MARK);
    expect(brief).toContain('node app-9');
    expect(brief).toContain('.png .svg');
    expect(brief).toContain('"out/logo.png"');
    expect(brief).toContain('accepts any file');
    expect(brief).toContain('/api/app-bubbles/<node id>/output');
    expect(brief).toContain('$VIBISUAL_TOKEN'); // 이름만 — 값은 세션 환경에 있다
  });

  it('켜진 노드가 없으면 본문 그대로, 이미 블록이 있으면 두 번 붙이지 않는다', () => {
    expect(withLinkedOutputBrief('hello', [])).toBe('hello');
    const once = withLinkedOutputBrief('hello', nodes);
    expect(once.startsWith('hello\n\n---')).toBe(true);
    expect(withLinkedOutputBrief(once, nodes)).toBe(once); // 전송 실패로 초안에 되돌아온 글을 다시 보낼 때
  });

  it('노드 이름은 사용자 제목 → 담긴 파일 이름 → 앱 이름 순이다', () => {
    expect(appNodeLabel({ title: '  표지 ', file: 'a/b.png' }, 'App')).toBe('표지');
    expect(appNodeLabel({ file: 'a\\b\\c.wav' }, 'App')).toBe('c.wav');
    expect(appNodeLabel({}, 'App')).toBe('App');
  });
});

describe('§5.4 #36 기하 — 판 테두리와 참조선', () => {
  it('정사각(버블)은 원 반지름, 판(카드)은 그 방향의 테두리까지', () => {
    expect(isRectNode(100, 100)).toBe(false);
    expect(isRectNode(288, 164)).toBe(true);
    expect(nodeBorderDistance(100, 100, 1, 0)).toBe(50);
    expect(nodeBorderDistance(288, 164, 1, 0)).toBe(144); // 가로로 오면 반폭
    expect(nodeBorderDistance(288, 164, 0, -1)).toBe(82); // 세로로 오면 반높이
    const d = Math.SQRT1_2;
    expect(rectBorderDistance(144, 82, d, d)).toBeCloseTo(82 / d, 6); // 대각은 먼저 닿는 변
  });

  it('참조선은 앞에 있는 쪽 옆구리로 나가 마주 보는 옆구리로 들어간다', () => {
    const right = refLinkEndpoints({ cx: 0, cy: 0, halfW: 144, halfH: 82 }, { cx: 400, cy: 30, halfW: 40, halfH: 25 });
    expect(right).toEqual({ sx: 144, sy: 0, tx: 360, ty: 30, side: 1 });
    const left = refLinkEndpoints({ cx: 0, cy: 0, halfW: 144, halfH: 82 }, { cx: -400, cy: 0, halfW: 40, halfH: 25 });
    expect(left.side).toBe(-1);
    expect(left.sx).toBe(-144);
    expect(left.tx).toBe(-360);
  });

  it('곡선은 두 끝점을 지나는 수평 S 곡선이고 가운데는 끝점 사이에 있다', () => {
    const geo = refLinkPath(0, 0, 300, 100, 1);
    expect(geo.path.startsWith('M 0,0 C ')).toBe(true);
    expect(geo.path.endsWith(' 300,100')).toBe(true);
    expect(geo.midX).toBeCloseTo(150, 6);
    expect(geo.midY).toBeCloseTo(50, 6);
  });
});

describe('§5.4 #36 shared 판정 — 서버 검증과 클라 낙관 반영이 한 벌', () => {
  it('참조 목록은 문자열만·공백 제거·중복 제거·상한, 배열이 아니면 손대지 않는다(null)', () => {
    expect(sanitizeLinkedAgentIds('agent-1')).toBeNull();
    expect(sanitizeLinkedAgentIds([' a ', 'a', '', 3, 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: APP_BUBBLE_LINK_MAX + 3 }, (_, i) => `a${i}`);
    expect(sanitizeLinkedAgentIds(many)).toHaveLength(APP_BUBBLE_LINK_MAX);
  });

  it('잇기는 중복·상한을 지키고, 끊기는 그 하나만 뺀다', () => {
    expect(withLinkedAgent(['a'], 'a')).toEqual(['a']);
    expect(withLinkedAgent(undefined, 'a')).toEqual(['a']);
    const full = Array.from({ length: APP_BUBBLE_LINK_MAX }, (_, i) => `a${i}`);
    expect(withLinkedAgent(full, 'new')).toEqual(full); // 가장 오래된 것을 밀어내지 않는다
    expect(withoutLinkedAgent(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('결과 파일은 프로젝트 안의 경로만, 루트 기준 상대 경로로 — 대소문자는 플랫폼 규칙', () => {
    expect(projectRelativePath('C:\\proj', 'C:\\proj\\out\\a.png', 'win32')).toBe('out/a.png');
    expect(projectRelativePath('C:\\Proj', 'c:/proj/Out/A.png', 'win32')).toBe('Out/A.png'); // 입력의 대소문자 그대로
    expect(projectRelativePath('/srv/work/proj', '/srv/work/proj/out/a.png', 'linux')).toBe('out/a.png');
    expect(projectRelativePath('/srv/work/Proj', '/srv/work/proj/out/a.png', 'linux')).toBeNull(); // linux 는 다른 폴더다
    expect(projectRelativePath('/srv/work/proj', '/srv/work/proj', 'linux')).toBeNull(); // 루트 자신
    expect(projectRelativePath('/srv/work/proj', '/srv/work/project2/a.png', 'linux')).toBeNull(); // 이름만 비슷한 옆 폴더
    expect(projectRelativePath('/Volumes/Work/Proj', '/volumes/work/proj/a.png', 'darwin')).toBe('a.png'); // mac 은 접는다
  });

  it('파일 이름은 두 구분자를 다 받는다', () => {
    expect(linkedFileName('a/b/c.png')).toBe('c.png');
    expect(linkedFileName('a\\b\\c.png')).toBe('c.png');
  });
});
