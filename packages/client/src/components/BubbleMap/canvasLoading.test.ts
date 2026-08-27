import { describe, it, expect } from 'vitest';
import { resolveCanvasLoadingState, type CanvasLoadingInputs } from './canvasLoading.js';

/**
 * §9 — 느린 회선에서만 재현되는 화면이라 표로 고정한다.
 * 여기서 지키는 것은 두 가지다: **빈 프로젝트에 영구 스피너를 씌우지 않는다** ·
 * **아직 안 온 탭을 빈 프로젝트로 보여 주지 않는다**.
 */
function inputs(over: Partial<CanvasLoadingInputs> = {}): CanvasLoadingInputs {
  return {
    activeProject: 'vibisual',
    activeIsStub: false,
    snapshotScope: ['vibisual'],
    snapshotReceived: true,
    connectionStatus: 'connected',
    ...over,
  };
}

describe('resolveCanvasLoadingState', () => {
  it('지금 탭이 스냅샷 범위에 들어 있으면 아무것도 띄우지 않는다', () => {
    expect(resolveCanvasLoadingState(inputs())).toBe('ready');
  });

  it('범위에 들어 있으면 버블이 0개여도 ready — 빈 프로젝트에 영구 스피너 ❌', () => {
    // 이 함수는 노드 수를 아예 보지 않는다. 범위에 들어 있다 = 서버가 "이게 전부"라고 말한 것.
    expect(resolveCanvasLoadingState(inputs({ snapshotScope: ['vibisual'] }))).toBe('ready');
  });

  it('탭을 막 옮겨 아직 그 프로젝트가 범위 밖이면 불러오는 중', () => {
    expect(resolveCanvasLoadingState(inputs({
      activeProject: 'other-project',
      snapshotScope: ['vibisual'],
    }))).toBe('loading');
  });

  it('범위 미적용(전량) 스냅샷은 전부 들어 있는 것으로 본다 — 구버전 서버에서 스피너가 남지 않는다', () => {
    expect(resolveCanvasLoadingState(inputs({
      activeProject: 'anything',
      snapshotScope: null,
    }))).toBe('ready');
  });

  it('스냅샷을 한 벌도 못 받았으면 불러오는 중(부팅 첫 화면)', () => {
    expect(resolveCanvasLoadingState(inputs({
      snapshotReceived: false,
      snapshotScope: null,
    }))).toBe('loading');
  });

  it('스냅샷은 받았고 활성 프로젝트가 없으면 ready — 등록된 프로젝트 0 은 기다릴 대상이 아니다', () => {
    expect(resolveCanvasLoadingState(inputs({
      activeProject: null,
      snapshotScope: null,
    }))).toBe('ready');
  });

  it('stub 탭은 언제나 ready — 그 자리 안내는 StubProjectPlaceholder 소유', () => {
    expect(resolveCanvasLoadingState(inputs({
      activeIsStub: true,
      activeProject: 'sleeping',
      snapshotScope: ['vibisual'],
    }))).toBe('ready');
  });

  it('소켓이 끊긴 채 데이터가 없으면 문구가 갈린다(연결하는 중)', () => {
    expect(resolveCanvasLoadingState(inputs({
      activeProject: 'other-project',
      connectionStatus: 'disconnected',
    }))).toBe('reconnecting');
    expect(resolveCanvasLoadingState(inputs({
      snapshotReceived: false,
      snapshotScope: null,
      connectionStatus: 'connecting',
    }))).toBe('reconnecting');
  });

  it('데이터가 이미 손에 있으면 소켓이 끊겨도 캔버스를 덮지 않는다 — 끊김은 헤더가 말한다', () => {
    expect(resolveCanvasLoadingState(inputs({ connectionStatus: 'disconnected' }))).toBe('ready');
  });
});
