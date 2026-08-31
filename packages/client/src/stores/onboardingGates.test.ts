import { describe, it, expect, beforeEach } from 'vitest';
import { useOnboardingGateStore } from './onboardingGates.js';

// §4 (첫 실행 온보딩) — 헤더 언어 전환기를 창 위로 띄울지 정하는 신호.
//   새 OS 에 갓 깔면 설치 창이 첫 화면이라, 이 신호가 꺼져 있으면 한국어 사용자는 앱을
//   모국어로 바꿀 입구가 없다(백드롭이 상단 탭을 덮는다).

function open(id: Parameters<ReturnType<typeof useOnboardingGateStore.getState>['setGateOpen']>[0], v: boolean): void {
  useOnboardingGateStore.getState().setGateOpen(id, v);
}

describe('onboardingGates', () => {
  beforeEach(() => {
    useOnboardingGateStore.setState({ openGates: [] });
  });

  it('게이트가 열리면 신호가 켜지고 닫히면 꺼진다', () => {
    expect(useOnboardingGateStore.getState().openGates.length).toBe(0);
    open('setup', true);
    expect(useOnboardingGateStore.getState().openGates).toEqual(['setup']);
    open('setup', false);
    expect(useOnboardingGateStore.getState().openGates).toEqual([]);
  });

  it('설치 창이 로그인 창에 자리를 넘기는 구간에도 신호가 끊기지 않는다', () => {
    open('setup', true);
    open('login', true);
    open('setup', false);
    // 인계 도중 한 프레임이라도 꺼지면 전환기가 백드롭 밑으로 떨어졌다가 다시 뜬다.
    expect(useOnboardingGateStore.getState().openGates).toEqual(['login']);
    expect(useOnboardingGateStore.getState().openGates.length > 0).toBe(true);
  });

  it('같은 값을 다시 넣으면 배열 참조가 그대로다(헛리렌더 방지)', () => {
    open('login', true);
    const first = useOnboardingGateStore.getState().openGates;
    open('login', true);
    expect(useOnboardingGateStore.getState().openGates).toBe(first);
    // 열린 적 없는 게이트를 닫아도 마찬가지다(언마운트 정리가 매번 부른다).
    open('version', false);
    expect(useOnboardingGateStore.getState().openGates).toBe(first);
  });

  it('네 게이트가 각각 따로 등록·해제된다', () => {
    open('setup', true);
    open('login', true);
    open('projectFolder', true);
    open('version', true);
    expect(useOnboardingGateStore.getState().openGates.length).toBe(4);
    open('login', false);
    open('version', false);
    expect(useOnboardingGateStore.getState().openGates).toEqual(['setup', 'projectFolder']);
  });
});
