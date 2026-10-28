/** §5.5 #17-6 (H-14) — 들어오는 순간: 앱 안 창이 윤곽선 자리를 첫 렌더부터 이어받고(`useEffect` 로 옮기면 옛 자리가 한 번 그려져 튄다), 버블을 고르지 않는다. */
import { describe, expect, it } from 'vitest';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const ts = import.meta.glob('./*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const hooks = import.meta.glob('../../hooks/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const stores = import.meta.glob('../../stores/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

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

describe('돌아오는 창은 **그려지기 전에** 손 아래에 앉는다', () => {
  const overlay = source(tsx, './AgentIDEOverlay.tsx');

  it('첫 렌더의 자리부터 이어받은 짐으로 정한다 — 옛 자리로 한 프레임 그리지 않게', () => {
    const seed = block(overlay, 'function resumeGeomFor(', '\n}');
    // 꺼내면(`take`) 뒤따르는 레이아웃 효과가 빈손이 된다 — 여기서는 들여다보기만 한다.
    expect(seed).toContain('peekPaneDragResume(');
    expect(seed).not.toContain('takePaneDragResume(');
    expect(seed).toContain('resumedFloatGeom(');
  });

  it('그 자리가 `floatPos`·`floatSize` 의 **초기값**이다(마운트 뒤에 옮기지 않는다)', () => {
    const init = block(overlay, 'const [mode, setMode] = useState<OverlayMode>(', 'const [snapRect,');
    expect(init).toContain('resumeGeom ?? floatGeomFor(paneKey, paneIndex)');
    // 붙은 채·모달로 한 프레임 섰다가 떠 있는 창이 되면 그 전이가 통째로 깜빡임이 된다.
    expect(init).toContain("if (resumeGeom) return 'floating';");
  });

  it('드래그를 이어받는 판은 **레이아웃 효과**다 — 미뤄 두면 옛 자리가 화면에 한 번 그려진다', () => {
    const resume = block(
      overlay,
      '§5.5 #17-6 (H-4) ③ — 밖에서 끌던 창이 앱 안으로 돌아왔다',
      'resumed: true,',
    );
    expect(resume).toContain('useLayoutEffect(');
    expect(resume).not.toContain('useEffect(');
    // 크기는 밖의 창 것이 먼저다 — 그것이 방금까지 떠 있던 윤곽선의 크기다.
    expect(resume).toContain('width: resume.width > 0 ? resume.width : rect.width,');
    expect(resume).toContain('height: resume.height > 0 ? resume.height : rect.height,');
  });
});

describe('되돌아오는 길은 버블을 고르지 않는다', () => {
  const reveal = source(hooks, '../../hooks/useOverlayReveal.ts');

  it('`openIde` 갈래는 카메라만 맞춘다 — 고르면 에이전트 설정 패널이 함께 열린다', () => {
    const back = block(reveal, 'if (openIde) {', 'if (resumeDrag) {');
    expect(back).toContain('store.focusOnNode(agentId);');
    expect(back).not.toContain('store.selectNode(');
  });

  it('점프(§5.4 #30 북마크와 같은 규율)는 종전대로 고른다 — 그쪽은 "그 버블을 보여 달라"다', () => {
    const jump = reveal.slice(reveal.indexOf('if (!keepPanes) store.closeIDEOverlay();'));
    expect(jump).toContain('store.selectNode(agentId);');
  });
});

// §5.5 #17-6 (H-15) — 윤곽선 걷기 예약이 효과 정리에 매이면(딸린 `agent` 는 스냅샷마다 새 객체) 취소돼, 클릭통과 선이 커서에 영영 남는다.
describe('윤곽선을 걷는 부탁은 취소되지 않는다', () => {
  const ghost = source(ts, './ghostHandoff.ts');
  const overlay = source(tsx, './AgentIDEOverlay.tsx');
  const reveal = source(hooks, '../../hooks/useOverlayReveal.ts');

  it('예약은 훅 밖에 있고 **걷을 손잡이를 주지 않는다** — 취소할 수 있으면 취소된다', () => {
    expect(ghost).toContain('export function scheduleGhostHide()');
    expect(ghost).toContain('ghostHide');
    expect(ghost).not.toContain('cancelAnimationFrame');
    // 두 프레임은 그대로다 — 창이 손 아래로 옮겨진 것이 그려지기 전에 걷으면 한 프레임이 빈다.
    expect(ghost.match(/requestAnimationFrame/g)?.length ?? 0).toBe(2);
  });

  it('이어받는 판은 그 예약만 부르고, 정리로 되돌리지 않는다', () => {
    const resume = block(
      overlay,
      '§5.5 #17-6 (H-4) ③ — 밖에서 끌던 창이 앱 안으로 돌아왔다',
      'const handleFloatResize',
    );
    expect(resume).toContain('scheduleGhostHide();');
    expect(resume).not.toContain('cancelAnimationFrame');
  });

  it('짐이 없는 되돌리기(↩ 버튼·칩 드래그)도 선을 걷는다 — 그물이 하나뿐이면 안 된다', () => {
    const back = block(reveal, 'if (openIde) {', '// 직전 세션 점프로 열린 IDE');
    // 두 갈래(짐 없음 · 짐 있음) 모두에서 부탁이 나가야 한다.
    expect(back.match(/scheduleGhostHide\(\);/g)?.length ?? 0).toBe(2);
  });
});

// §5.5 #17-6 (H-26) — 들어온 창은 그 크기 그대로(`resumeGeomFor`) — 다음 프레임 마운트 전이가 `80vw×80vh` 로 덮지 않는다(덮는 자리 둘).
describe('(H-26) 들어온 창의 크기를 마운트 전이가 덮지 않는다', () => {
  const overlay = source(tsx, './AgentIDEOverlay.tsx');
  const handoff = source(stores, '../../stores/idePaneHandoff.ts');

  it('밖에서 들어온 판은 모드를 다시 정하는 세 갈래보다 **먼저** 비켜선다', () => {
    const transition = block(
      overlay,
      'if (agentId && (!prev.agentId || projectChanged)) {',
      '} else if (agentId && prev.agentId',
    );
    const guard = transition.indexOf('if (resumeGeomRef.current) {');
    expect(guard, '밖에서 들어온 판을 가리는 자리가 없다').toBeGreaterThan(-1);
    // 뒤에 서면 이미 덮은 뒤다 — 도킹·플로팅·모달 어느 갈래든 들고 온 크기를 잃는다.
    expect(guard).toBeLessThan(transition.indexOf("setMode('docked')"));
    expect(guard).toBeLessThan(transition.indexOf('goFloating()'));
    expect(guard).toBeLessThan(transition.indexOf("setMode('modal')"));
  });

  it('그 표식은 **한 판만** 쓴다 — 남겨 두면 프로젝트를 갈아탈 때도 비켜선다', () => {
    const transition = block(
      overlay,
      'if (agentId && (!prev.agentId || projectChanged)) {',
      '} else if (agentId && prev.agentId',
    );
    expect(transition).toContain('resumeGeomRef.current = null;');
  });

  it('앱으로 합치는 패치는 짐의 `openMode` 를 물려받지 않는다', () => {
    const app = block(handoff, "if (target === 'app') {", '\n  }');
    expect(app).toContain("patch.openMode = 'floating';");
    // 그 값은 독립 창 슬롯의 기본값('modal')이라, 물려받으면 돌아온 창이 늘 모달이 된다.
    expect(app).not.toContain('handoff.openMode');
  });
});
