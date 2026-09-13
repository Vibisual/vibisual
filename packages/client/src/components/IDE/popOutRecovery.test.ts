/**
 * popOutRecovery.test.ts — §5.5 #17-6 (H-10) **밖으로 빼는 손짓이 실패한 판**의 소스 계약.
 *
 * 앱 안 IDE 창을 밖으로 빼는 길(`popOutToWindow`)은 **앱 안 창을 먼저 닫는다** — 같은 IDE 가 두
 * 곳에 뜨면 어느 쪽이 진짜인지 알 수 없기 때문이다. 그래서 창을 세우는 쪽이 실패하면 IDE 는
 * 밖에도 안에도 없다(사용자에게는 통째로 사라진 것이다). 빠르게 오갈 때 실제로 그 판이 났다 —
 * 닫히는 중인 창을 다시 쓰려다 `Object has been destroyed` 로 약속이 깨졌다.
 *
 * 이 파일은 창을 띄우지 않고 그 계약만 고정한다(클라 테스트에는 DOM 이 없다 — `vitest.config.ts`).
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

describe('popOutToWindow — 창이 서지 못하면 앱 안에 되세운다', () => {
  const popOut = block(
    source('AgentIDEOverlay.tsx'),
    'const popOutToWindow = useCallback(',
    'const bringToFront = useCallback(',
  );

  it('`open()` 의 실패를 받는다 — 삼킨 거절은 화면에서 IDE 가 사라진 채로 끝난다', () => {
    expect(popOut).toContain('.catch(');
  });

  it('실패하면 매달림과 윤곽선을 먼저 걷는다 — 세울 창이 없는데 선만 커서를 따라다니면 안 된다', () => {
    const recover = block(popOut, '.catch(', '});');
    expect(recover).toContain('ghostHide');
    expect(recover).toContain('dragEndFor');
  });

  it('실패하면 **보던 그대로** 앱 안에 다시 연다(짐을 실어서)', () => {
    const recover = block(popOut, '.catch(', '});');
    expect(recover).toContain('openIDEOverlay(');
    expect(recover).toContain('handoff');
  });

  it('앱 안 창을 닫는 줄은 그대로 남는다 — 같은 IDE 가 두 곳에 뜨지 않게', () => {
    expect(popOut).toContain('closeOverlay();');
  });
});

describe('beginTitleDrag — 앞 판이 남아 있으면 먼저 걷는다', () => {
  it('판을 시작하기 전에 직전 판의 정리를 부른다', () => {
    // 빠르게 오가면 앞 판의 뗌이 **이미 닫힌 창**으로 가 이 창에 도착하지 않는다. 그 판의
    // 리스너가 살아 있는 채로 새 판이 서면 한 번의 이동을 둘이 듣고 창을 두 번 꺼내려 든다.
    const begin = block(
      source('AgentIDEOverlay.tsx'),
      'const beginTitleDrag = useCallback(',
      'const dragVp = viewportNow();',
    );
    expect(begin).toContain('activeDragCleanupRef.current?.();');
  });
});

// §5.5 #17-6 (H-12) — **들어오는 길에도 구간을 만든다.** 판정과 그림은 main 이 쥐지만, 그 구간에
// 적을 말(로케일)과 "다 그렸다"를 말하는 자리는 렌더러밖에 없다. 그 두 줄이 빠지면 화면에는
// 아무 말 없는 선이 뜨고(무슨 일인지 알 수 없다), 합쳐진 뒤에도 선이 4초 그물까지 남는다.
describe('(H-12) 들어오는 구간 — 렌더러가 대는 말과 "다 그렸다"', () => {
  const src = source('AgentIDEOverlay.tsx');

  it('밖으로 내보낼 때 **되돌아올 때 쓸 말**까지 함께 맡긴다 — main 에는 번역이 없다', () => {
    const popOut = block(src, 'const popOutToWindow = useCallback(', 'const bringToFront = useCallback(');
    expect(popOut).toContain("t('ide.overlay.redockDwellHint')");
    expect(popOut).toContain('label: agentLabelRef.current');
  });

  it('독립 창 타이틀바 드래그도 같은 말을 맡긴다 — 두 길이 같은 선을 그린다', () => {
    const title = block(src, 'const handleTitleBarMouseDown = useCallback(', 'bringToFront();');
    expect(title).toContain('redockOnEnter: true');
    expect(title).toContain("t('ide.overlay.redockDwellHint')");
  });

  it('이어받은 앱 안 창이 다 그리면 **선을 걷는다** — 걷지 않으면 그물이 걷을 때까지 얹혀 있다', () => {
    const resume = block(src, 'const resume = takePaneDragResume(agentId);', 'const handleFloatResize');
    // (H-15) 부탁은 훅 밖의 예약(`scheduleGhostHide`)으로 나간다 — 두 프레임을 기다리는 것은
    //   그대로이고(한 프레임 앞서 걷으면 창이 손 아래로 옮겨지는 그림 전에 선이 사라진다),
    //   달라진 것은 **그 예약을 이 효과의 정리가 취소하지 못한다**는 점이다.
    expect(resume).toContain('scheduleGhostHide();');
    expect(resume).not.toContain('cancelAnimationFrame');
  });
});
