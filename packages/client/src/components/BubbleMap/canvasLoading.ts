/**
 * §9 — 탭을 옮긴 직후의 빈 캔버스는 빈 프로젝트가 아니다(`set-project-scope` 회신 스냅샷이 원격에선 몇 초 늦는다).
 * 노드 수가 아니라 `GraphSnapshot.scopedProjects` 로 판정 — 지금 탭이 없으면 아직 안 온 것(0개 프로젝트도 목록엔 있다).
 */

/** 캔버스가 지금 무엇을 말해야 하는가. */
export type CanvasLoadingState =
  /** 그릴 것이 다 왔다(비어 있다면 그건 진짜 빈 프로젝트다) — 아무것도 띄우지 않는다. */
  | 'ready'
  /** 선언은 나갔고 스냅샷을 기다리는 중 — 조용한 "불러오는 중". */
  | 'loading'
  /** 소켓이 끊겨 기다릴 곳조차 없는 상태 — "연결하는 중"으로 말이 달라져야 한다. */
  | 'reconnecting';

export interface CanvasLoadingInputs {
  /** 지금 그리는 프로젝트 표시명. `null` = 아직 못 정함(부팅 중) 또는 등록된 프로젝트 0. */
  activeProject: string | null;
  /** 그 탭이 stub(내려놓은 배경 탭)인가 — 그쪽 화면은 `StubProjectPlaceholder` 가 따로 담당한다. */
  activeIsStub: boolean;
  /** 마지막 스냅샷이 실어 온 구독 범위. `null` = 범위 미적용(= 전량이 왔다). */
  snapshotScope: string[] | null;
  /** §9 폴더 스코프 — 들어가 있는 폴더 id, `null` = 메인 뷰. 막 들어간 빈 내부 뷰와 진짜 빈 폴더가 같아 보이는 함정이 있다. */
  currentFolderId: string | null;
  /** 마지막 스냅샷이 적용한 폴더 범위. `null` = 범위 미적용(= 폴더 슬라이스가 전량이다). */
  snapshotFolderScope: string[] | null;
  /** 이 창이 스냅샷을 한 번이라도 받았는가. */
  snapshotReceived: boolean;
  /** WebSocket 연결 상태(헤더 인디케이터와 같은 값). */
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

/** ⚠ 노드 수로 세지 마라 — 빈 새 프로젝트는 영원히 로딩, 직전 탭 잔상은 안 온 것을 왔다고 읽는다. */
function hasActiveProjectData(i: CanvasLoadingInputs): boolean {
  // 한 벌도 못 받았으면 아무것도 모른다(부팅 첫 화면).
  if (!i.snapshotReceived) return false;
  // 스냅샷은 왔는데 그릴 프로젝트가 없다 = 등록된 것이 없는 진짜 빈 상태. 기다릴 대상이 없다.
  if (i.activeProject === null) return true;
  // 범위를 적용하지 않은 스냅샷(선언한 창 0 · 구버전 서버)은 전량이므로 전부 들어 있다.
  if (i.snapshotScope === null) return true;
  return i.snapshotScope.includes(i.activeProject);
}

/**
 * 폴더도 세지 않고 서버가 돌려준 범위로 판정한다(자식 0 폴더도 범위엔 있다). 서버가 한 칸 앞까지 실어 거의 안 걸리고,
 * 재연결·위치 복원 직후처럼 선언 전 순간에만 걸린다.
 */
function hasOpenFolderData(i: CanvasLoadingInputs): boolean {
  if (i.currentFolderId === null) return true;      // 폴더 밖이면 볼 것이 없다
  if (i.snapshotFolderScope === null) return true;  // 범위 미적용 = 폴더 슬라이스가 전량이다
  return i.snapshotFolderScope.includes(i.currentFolderId);
}

/** 순서가 규칙: ① stub 탭은 `ready`([불러오기] 안내 위에 로딩을 겹치지 않는다) ② 프로젝트·폴더 데이터가 왔으면 비어도 `ready` ③ 아니면 소켓 생존으로 문구가 갈린다. */
export function resolveCanvasLoadingState(i: CanvasLoadingInputs): CanvasLoadingState {
  if (i.activeIsStub) return 'ready';
  if (hasActiveProjectData(i) && hasOpenFolderData(i)) return 'ready';
  return i.connectionStatus === 'connected' ? 'loading' : 'reconnecting';
}
