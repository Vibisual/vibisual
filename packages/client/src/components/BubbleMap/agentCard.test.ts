import { describe, expect, it } from 'vitest';
import type { AppBubble, BubbleData } from '@vibisual/shared';
import {
  AGENT_CARD,
  APP_BUBBLE_ID_PATTERN,
  APP_BUBBLE_LINK_MAX,
  REF_BLOOM,
  REF_LINK_STYLE,
  isAppBubbleId,
  linkedFileName,
  makeAppBubbleId,
  projectRelativePath,
  sanitizeLinkedAgentIds,
  withLinkedAgent,
  withoutLinkedAgent,
} from '@vibisual/shared';
import {
  LINKED_OUTPUT_MARK,
  agentCardBorderDistance,
  agentCardDiscCenter,
  appNodeLabel,
  bloomPetalOffsets,
  buildLinkedOutputBrief,
  canUseAgentCard,
  clampBloomCenter,
  isAgentCardBox,
  isAgentCardForm,
  isRectNode,
  linkedAppBubblesKey,
  linkedAppBubblesOf,
  nodeBorderDistance,
  orbitDotAngles,
  pickCardSession,
  pointOnOrbitToward,
  rectBorderDistance,
  refLinkEnds,
  refLinkOrigin,
  refLinkPairs,
  refLinkPath,
  refLinkSag,
  viewportShiftToShow,
  withLinkedOutputBrief,
  type LinkedOutputNode,
} from './agentCard.js';

/**
 * §5.4 #36 — 전환과 연결의 순수 판정. 화면(말풍선·메뉴·줄·꽃잎)과 서버(REST 검증)가 같은 답을 내야 하는 것들이다.
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

describe('§5.4 #36 (A) 누가 말풍선을 펼칠 수 있나', () => {
  it('커스텀 에이전트만 — 훅·CMD·버려진 에이전트·다른 버블은 아니다', () => {
    expect(canUseAgentCard(agent(), undefined)).toBe(true);
    expect(canUseAgentCard(agent({ customCreated: false }), undefined)).toBe(false);
    expect(canUseAgentCard(agent(), { executionMode: 'interactive-terminal' })).toBe(false);
    expect(canUseAgentCard(agent({ trashed: true }), undefined)).toBe(false);
    expect(canUseAgentCard(agent({ bubbleType: 'file' }), undefined)).toBe(false);
    expect(canUseAgentCard(undefined, undefined)).toBe(false);
  });

  it('말풍선으로 그리는 것은 형태 칸이 card 인 커스텀 에이전트뿐이다(휴지통 안은 버블)', () => {
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

  it('위성줄은 끝점(에이전트)이 지금 화면에 있을 때만 만든다', () => {
    const pairs = refLinkPairs(bubbles, new Set(['agent-1']), 'proj');
    expect(pairs.map((p) => p.id)).toEqual(['ref-agent-1-b', 'ref-agent-1-a']);
    expect(refLinkPairs(bubbles, new Set(), 'proj')).toEqual([]);
  });
});

describe('§5.4 #36 (C) 위성 칩이 명령에 붙이는 것', () => {
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

describe('§5.4 #36 기하 — 말풍선 실루엣 · 위성줄 · 꽃잎', () => {
  const W = AGENT_CARD.width;
  const H = AGENT_CARD.height;

  it('원 중심 + 궤도 + 위성 손 자리가 노드 폭과 맞고, 이름 한 줄이 노드 안에 든다', () => {
    const disc = agentCardDiscCenter();
    expect(disc.y).toBe(H / 2);
    expect(disc.x + AGENT_CARD.orbitRadius + AGENT_CARD.satelliteHitSize / 2).toBe(W); // 어긋나면 위성이 잘린다
    expect(disc.x - AGENT_CARD.discSize / 2).toBe(AGENT_CARD.balloonWidth + AGENT_CARD.balloonGap);
    expect(disc.y + AGENT_CARD.orbitRadius + AGENT_CARD.labelGap + 14).toBeLessThanOrEqual(H); // 이름 줄 높이 14px
  });

  it('정사각(버블)은 원 반지름, 앱 노드는 그 방향의 테두리까지', () => {
    expect(isRectNode(100, 100)).toBe(false);
    expect(isRectNode(80, 50)).toBe(true);
    expect(nodeBorderDistance(100, 100, 1, 0)).toBe(50);
    expect(nodeBorderDistance(80, 50, 1, 0)).toBe(40); // 가로로 오면 반폭
    expect(nodeBorderDistance(80, 50, 0, -1)).toBe(25); // 세로로 오면 반높이
    const d = Math.SQRT1_2;
    expect(rectBorderDistance(40, 25, d, d)).toBeCloseTo(25 / d, 6); // 대각은 먼저 닿는 변
  });

  it('말풍선 노드는 실루엣에서 끊는다 — 왼쪽은 말풍선 끝, 오른쪽은 궤도 바깥, 위는 말풍선 윗변', () => {
    expect(isAgentCardBox(W, H)).toBe(true);
    expect(isAgentCardBox(W + 0.6, H - 0.4)).toBe(true); // 측정 반올림
    expect(isAgentCardBox(288, 164)).toBe(false);
    const disc = agentCardDiscCenter();
    expect(nodeBorderDistance(W, H, -1, 0)).toBeCloseTo(W / 2, 6);
    expect(nodeBorderDistance(W, H, 1, 0)).toBeCloseTo(disc.x + AGENT_CARD.orbitRadius - W / 2, 6);
    expect(nodeBorderDistance(W, H, 0, -1)).toBeCloseTo(H / 2, 6);
    // 원 위쪽 빈 자리로 가는 선 — 경계 상자 모서리 앞 허공이 아니라 궤도 위에서 끊긴다.
    const len = Math.hypot(1, -0.3);
    const nx = 1 / len;
    const ny = -0.3 / len;
    const t = agentCardBorderDistance(nx, ny);
    expect(t).toBeLessThan(rectBorderDistance(W / 2, H / 2, nx, ny));
    expect(Math.hypot(W / 2 + nx * t - disc.x, H / 2 + ny * t - disc.y)).toBeCloseTo(AGENT_CARD.orbitRadius, 6);
  });

  it('위성줄은 원(궤도)에서 나가 앱 노드 테두리로 — 두 중심을 잇는 직선 위', () => {
    const card = { cx: W / 2, cy: H / 2, halfW: W / 2, halfH: H / 2 }; // 좌상단 (0,0)
    const disc = agentCardDiscCenter();
    expect(refLinkOrigin(card)).toEqual({ x: disc.x, y: disc.y, r: AGENT_CARD.orbitRadius });
    const app = { cx: disc.x + 300, cy: disc.y, halfW: 40, halfH: 25 };
    expect(refLinkEnds(card, app)).toEqual({
      sx: disc.x + AGENT_CARD.orbitRadius,
      sy: disc.y,
      tx: disc.x + 260,
      ty: disc.y,
    });
    // 버블(정사각)로 접혀 있으면 그 원에서 나간다 — 같은 문법.
    expect(refLinkOrigin({ cx: 0, cy: 0, halfW: 30, halfH: 30 })).toEqual({ x: 0, y: 0, r: 30 });
    // 손이 원 중심 위에 있으면 오른쪽 점(0 으로 나누지 않는다).
    expect(pointOnOrbitToward({ x: 0, y: 0, r: 10 }, 0, 0)).toEqual({ x: 10, y: 0 });
  });

  it('줄은 아래로 처진다 — 처짐은 길이에 비례하되 하한·상한 사이', () => {
    expect(refLinkSag(0)).toBe(REF_LINK_STYLE.sagMin);
    expect(refLinkSag(100_000)).toBe(REF_LINK_STYLE.sagMax);
    const geo = refLinkPath(0, 0, 200, 0);
    expect(geo.path.startsWith('M 0,0 Q ')).toBe(true);
    expect(geo.path.endsWith(' 200,0')).toBe(true);
    expect(geo.midX).toBeCloseTo(100, 6);
    expect(geo.midY).toBeCloseTo(refLinkSag(200) / 2, 6); // 가운데는 처짐의 절반만큼 아래
    expect(geo.midY).toBeGreaterThan(0);
  });

  it('궤도 점은 상한까지만, 위성 손잡이와 다른 쪽(아래)으로 늘어선다', () => {
    expect(orbitDotAngles(0)).toEqual([]);
    expect(orbitDotAngles(2)).toEqual([
      AGENT_CARD.orbitDotStartDeg,
      AGENT_CARD.orbitDotStartDeg + AGENT_CARD.orbitDotStepDeg,
    ]);
    expect(orbitDotAngles(99)).toHaveLength(AGENT_CARD.orbitDotMax);
    expect(Math.min(...orbitDotAngles(99))).toBeGreaterThan(AGENT_CARD.satelliteAngleDeg);
  });

  it('꽃잎은 끌어온 방향 앞쪽에 좌우 같게 펴지고, 화면 밖이면 꽃째 안쪽으로 밀린다', () => {
    const petals = bloomPetalOffsets(4, 0);
    expect(petals).toHaveLength(4);
    for (const p of petals) expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(REF_BLOOM.radius, 6);
    expect(petals.every((p) => p.dx > 0)).toBe(true); // 오른쪽을 보고 핀다
    expect(petals[0]!.dy).toBeCloseTo(-petals[3]!.dy, 6); // 좌우 대칭
    expect(bloomPetalOffsets(1, Math.PI / 2)[0]!.dy).toBeCloseTo(REF_BLOOM.radius, 6); // 하나면 바로 그 방향
    expect(bloomPetalOffsets(0, 0)).toEqual([]);
    // 앱이 많으면 펼침 상한 안으로 좁아진다.
    const many = bloomPetalOffsets(9, 0);
    const spread = Math.atan2(many[8]!.dy, many[8]!.dx) - Math.atan2(many[0]!.dy, many[0]!.dx);
    expect((spread * 180) / Math.PI).toBeLessThanOrEqual(REF_BLOOM.maxSpreadDeg + 1e-6);
    // 오른쪽 아래 구석에서 피면 꽃잎 전부가 화면 안(여백 포함)으로 들어온다.
    const c = clampBloomCenter(1000, 700, petals, 1000, 700);
    const pad = REF_BLOOM.seedSize / 2 + REF_BLOOM.margin;
    for (const p of petals) {
      expect(c.x + p.dx).toBeLessThanOrEqual(1000 - pad + 1e-6);
      expect(c.y + p.dy).toBeLessThanOrEqual(700 - pad + 1e-6);
    }
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

  it('(F) 앱 노드 id — 클라가 지은 것은 서버가 받는 형식이고, 난수 꼬리는 늘 다섯 자리다', () => {
    const id = makeAppBubbleId(1_787_207_191_374, () => 0);
    expect(id).toBe(`app-${(1_787_207_191_374).toString(36)}-00000`);
    expect(isAppBubbleId(id)).toBe(true);
    expect(makeAppBubbleId(0, () => 0.999999999).split('-')[2]).toHaveLength(5); // 1 에 붙어도 여섯 자리로 넘치지 않는다
    expect(APP_BUBBLE_ID_PATTERN.test(makeAppBubbleId())).toBe(true);
    // 서버가 예전에 지은 모양(꼬리 1~4자)도 같은 형식이다 — 붙여 넣기·복원이 거절되지 않게.
    expect(isAppBubbleId('app-mt150mku-30qw')).toBe(true);
  });

  it('(F) 형식 밖 id 는 받지 않는다 — 서버가 새로 짓는다', () => {
    for (const bad of ['', 'app-', 'app--x', 'APP-abc-def', 'app-abc-def-ghi', 'comment-abc-def', 'app-abc-d e', 'app-a/b-c', 42, null]) {
      expect(isAppBubbleId(bad)).toBe(false);
    }
  });
});

describe('§5.4 #36 (F) 새 노드가 화면 밖이면 모자란 만큼만 밀어 들인다', () => {
  const view = { width: 1000, height: 600 };
  const m = REF_BLOOM.revealMargin;

  it('이미 다 보이면 움직이지 않는다', () => {
    expect(viewportShiftToShow({ x: 100, y: 100, width: 208, height: 130 }, { x: 0, y: 0, zoom: 1 }, view, m)).toBeNull();
  });

  it('오른쪽 아래로 삐져나가면 그만큼만 — 여백까지 들인다', () => {
    const shift = viewportShiftToShow({ x: 900, y: 520, width: 208, height: 130 }, { x: 0, y: 0, zoom: 1 }, view, m);
    expect(shift).toEqual({ dx: -(900 + 208 - (1000 - m)), dy: -(520 + 130 - (600 - m)) });
  });

  it('줌과 뷰포트 이동을 따른다(노드 좌표 → 화면 좌표)', () => {
    // 줌 2, 뷰포트 (-100, 0) → 노드 x=40 은 화면 -20 이다 — 왼쪽 여백까지 오른쪽으로 민다.
    const shift = viewportShiftToShow({ x: 40, y: 50, width: 100, height: 50 }, { x: -100, y: 0, zoom: 2 }, view, m);
    expect(shift).toEqual({ dx: m - (40 * 2 - 100), dy: 0 });
  });

  it('화면보다 큰 노드는 앞(왼쪽·위)을 맞춘다', () => {
    const shift = viewportShiftToShow({ x: 0, y: 0, width: 2000, height: 50 }, { x: 300, y: 0, zoom: 1 }, view, m);
    expect(shift?.dx).toBe(m - 300);
  });
});
