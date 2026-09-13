/**
 * dropToCommit.test.ts — §5.5 #17-6 (H-17) **놓을 때까지는 가상 창이다.**
 *
 * (H-4)~(H-12) 까지의 설계는 "경계를 넘는 그 순간 창을 바꾼다"였다. 밖으로 나가는 것도, 다시
 * 앱 안으로 들어오는 것도 손이 눌린 채로 일어나, 한 손짓 안에서 창이 몇 번이고 밖과 안을
 * 오갔다(사용자 지시 — "드래그 하면 밖으로 나가거나 다시 안으로 들어오는데 마우스 놓기 전까지
 * 가상의 창 그대로 유지해. 그리고 마우스 놓는 순간 가상의 창이 있던 그자리 그 크기 그대로").
 *
 * 이제 규율은 하나다: **끄는 내내 화면에 있는 것은 선(가상 창)뿐이고, 창이 바뀌는 자리는 뗌
 * 한 곳이다.** 이 파일은 그 "한 곳"이 다시 여럿으로 흩어지지 않게 소스 계약으로 고정한다
 * (클라 테스트에는 DOM 이 없다 — `vitest.config.ts`. 그래서 실행이 아니라 소스를 읽는다).
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

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

const OVERLAY = source('AgentIDEOverlay.tsx');
/** 끄는 판 전체 — 이동·가장자리 버팀·main 의 이탈 통지·뗌이 전부 이 안에 있다. */
const DRAG = block(OVERLAY, 'const beginTitleDrag = useCallback(', 'const handleTitleBarMouseDown = useCallback(');

describe('(H-17) 밖으로 나가는 자리는 뗌 하나뿐이다', () => {
  it('한 판에서 `popOutNow` 를 부르는 곳은 **한 곳**이다 — 정의를 빼면 호출은 하나', () => {
    // 종전에는 셋이었다: 이동 중 이탈 판정 · 가장자리 버팀 완료 · 뗌. 앞의 둘이 손이 눌린 채
    //   창을 바꿔 버려, 사용자에게는 "놓지도 않았는데 계속 바뀐다"로 읽혔다.
    const defs = count(DRAG, 'function popOutNow(');
    expect(defs).toBe(1);
    expect(count(DRAG, 'popOutNow(') - defs).toBe(1);
  });

  it('그 한 곳은 **뗌**이다 — 그리고 손이 떠났음을 창에 알린다(`settled`)', () => {
    const up = block(DRAG, 'function handleUp(): void {', 'if (init.resumed) {');
    expect(up).toContain('popOutNow({ settled: true })');
  });

  it('이동 중에는 나가지 않는다 — 이탈 판정은 선을 밝히는 데만 쓰인다', () => {
    const move = block(DRAG, 'function handleMove(ev: MouseEvent): void {', 'function handleUp(): void {');
    expect(move).not.toContain('popOutNow(');
  });

  it('가장자리 버팀이 끝나도 나가지 않는다 — 밝아지기만 한다', () => {
    const edge = block(DRAG, 'function startEdgeWatch(', 'function handleMove(');
    expect(edge).not.toContain('popOutNow(');
    expect(edge).toContain('edgeArmed = true');
  });

  it('main 이 "커서가 밖으로 나갔다"고 알려 와도 나가지 않는다 — 선만 세운다', () => {
    const escape = block(DRAG, 'function startEscapeWatch(): void {', 'function detach(');
    expect(escape).not.toContain('popOutNow(');
    expect(escape).toContain('refreshGhost();');
  });
});

describe('(H-17) 놓은 그 자리 그 크기 그대로 선다', () => {
  it('밀어 낸 만큼을 살려 둔 채 정리한다 — 되돌리면 선이 제자리로 튀고 창은 딴 데 선다', () => {
    const up = block(DRAG, 'function handleUp(): void {', 'if (init.resumed) {');
    expect(up).toContain('detach({ keepGhostPush: goingOut })');
  });

  it('창에 넘기는 잡은 지점에서 밀어 낸 만큼을 뺀다 — 선이 서 있던 바로 그 자리', () => {
    const pop = block(DRAG, 'function popOutNow(', 'function enterFloating(): void {');
    expect(pop).toContain('init.grabRatioX * nextW - push.dx');
    expect(pop).toContain('init.grabRatioY * nextH - push.dy');
    expect(pop).toContain('settled,');
  });

  it('놓고 나서 태어난 창은 커서에 매달리지 않는다 — 매달면 놓은 뒤에도 따라다닌다', () => {
    const popOutToWindow = block(OVERLAY, 'const popOutToWindow = useCallback(', 'const bringToFront = useCallback(');
    expect(popOutToWindow).toContain('!opts.follow.settled) watchDetachedFollowRelease(');
  });
});

describe('(H-17) 밖에서 들어와 놓인 창도 그 자리에 서기만 한다', () => {
  const resume = block(OVERLAY, 'const resume = takePaneDragResume(agentId);', 'const handleFloatResize');

  it('손이 이미 떠난 판이면 드래그를 이어받지 않는다', () => {
    // 이어받으면 첫 이동 한 번에 창이 딸려간다(손은 떠났는데 창이 커서를 따라간다).
    expect(resume).toContain('if (!resume.dragging) {');
    const landed = block(resume, 'if (!resume.dragging) {', 'beginTitleDrag({');
    expect(landed).not.toContain('beginTitleDrag(');
  });

  it('그 자리를 **굳힌다** — 접었다 펴거나 탭을 옮겨도 그대로여야 한다', () => {
    const landed = block(resume, 'if (!resume.dragging) {', 'beginTitleDrag({');
    expect(landed).toContain('resumedFloatGeom(');
    expect(landed).toContain('commitFloat(landed);');
  });

  it('그 길에서도 선은 걷는다 — 안 걷으면 클릭통과 선이 그물까지 얹혀 있다', () => {
    const landed = block(resume, 'if (!resume.dragging) {', 'beginTitleDrag({');
    expect(landed).toContain('scheduleGhostHide();');
  });
});
