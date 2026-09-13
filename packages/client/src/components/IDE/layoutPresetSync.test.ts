/**
 * 헤더 [창과 버블] 메뉴의 **레이아웃 프리셋**이 화면까지 닿는지 못 박는다.
 *
 * 왜 필요한가: 프리셋은 스토어(`applyIDEWindowLayout`)만 고치고, 창의 모양(모달/플로팅/도킹)은
 * `AgentIDEOverlay` 의 **로컬 state** 다. 둘을 잇는 것은 `ideLayoutEpoch` 를 보는 효과 하나뿐인데,
 * 그 효과가 **도크 sync 효과보다 뒤에** 서 있으면 붙이는 프리셋이 통째로 죽는다 —
 * 한 커밋 안에서 효과는 선언 순서로 돌고, 그때 sync 가 보는 `mode` 는 아직 옛것(floating)이라
 * "모드는 안 붙었는데 변이 생겼다"로 읽어 **방금 적힌 `dockSide` 를 도로 지운다**.
 * 그 결과가 사용자 보고 그대로다: [오른쪽 한 칸에 탭으로 모으기]·[좌우로 나눠 붙이기]·[전부 떼어
 * 내기] 세 개가 눌러도 아무 일이 안 일어난다(스토어 단위 테스트는 전부 통과한 채로).
 *
 * jsdom 이 없어 렌더로는 못 잡는다 — 순서와 가드가 소스에 남아 있는지 문자열로 고정한다
 * (`promptBubbleCollapse.test.ts` 와 같은 방식). 스토어 쪽 결과는 `stores/idePanes.test.ts` 가 본다.
 */
import { describe, it, expect } from 'vitest';

const SRC = './AgentIDEOverlay.tsx';
const source = import.meta.glob('./AgentIDEOverlay.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})[SRC] as string | undefined;

/** 효과 본문의 시작 위치 — 그 효과를 특징짓는 한 줄로 찾는다. */
function at(needle: string): number {
  const i = (source ?? '').indexOf(needle);
  expect(i, `소스에서 못 찾음: ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe('레이아웃 프리셋 반영 — 배선', () => {
  it('소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 검사들이 전부 통과해 집행이 무력해진다.
    expect(source).toBeTypeOf('string');
    expect((source ?? '').length).toBeGreaterThan(10000);
  });

  it('세대를 반영하는 효과가 도크 sync 효과보다 **먼저** 선다', () => {
    // 순서가 뒤집히면 sync 가 프리셋이 적은 변을 지운다 — 붙이는 프리셋이 죽는 자리.
    expect(at('}, [layoutEpoch]);')).toBeLessThan(at("const dockedNow = mode === 'docked';"));
  });

  it('도크 sync 는 프리셋 세대를 구독하고, 그 커밋을 비켜선다', () => {
    const s = source ?? '';
    // 세대를 deps 에 넣지 않으면 가드가 도는 커밋 자체가 오지 않는다.
    expect(s).toContain(
      "}, [agentId, mode, storeDockSide, paneKey, setPaneDock, goFloating, fullWindow, disableDock, layoutEpoch]);",
    );
    // 가드는 **세대 번호**로 견줘야 한다 — 한 번 쓰고 버리는 플래그면 mode 가 안 바뀌는 프리셋에서
    //   표시가 남아, 나중에 진짜 필요한 sync 한 번을 삼킨다.
    expect(s).toContain('if (layoutEpochRef.current === layoutEpoch && syncedEpochRef.current !== layoutEpoch) {');
  });

  it('세대 반영 효과가 붙은 변을 도킹으로, 없으면 플로팅으로 읽는다', () => {
    const s = source ?? '';
    const start = at('if (layoutEpoch === 0 || fullWindow || !agentId) return;');
    const body = s.slice(start, s.indexOf('}, [layoutEpoch]);', start));
    // 붙이는 프리셋(tabRight·splitLeftRight)
    expect(body).toContain("setMode('docked');");
    // 떼는 프리셋(undockAll·tile·cascade) — **모달도 함께 푼다**(모달이 남으면 백드롭이 화면을 덮어
    //   "떼어 늘어놓았다"가 눈에 보이지 않는다).
    expect(body).toContain("setMode('floating');");
    // 새로 잡은 자리는 슬롯에 남겨야 다음 마운트에서 되찾는다.
    expect(body).toContain('commitFloat(g);');
  });
});
