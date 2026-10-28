/**
 * 헤더 레이아웃 프리셋이 화면까지 닿는가 — `ideLayoutEpoch` 효과(`AgentIDEOverlay`)가 도크 sync 효과보다 앞에 서야 한다(뒤면 sync 가 옛 `mode` 로 방금 적힌 `dockSide` 를 지운다).
 * jsdom 이 없어 순서를 소스로 본다(스토어 결과는 `stores/idePanes.test.ts`).
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
