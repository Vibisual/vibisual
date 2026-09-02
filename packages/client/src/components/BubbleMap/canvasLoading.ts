/**
 * §9 **"탭을 옮긴 직후의 빈 캔버스는 빈 프로젝트가 아니다"** — 캔버스 로딩 판정 단일 소유.
 *
 * §9 스코프드 스냅샷 구독은 창이 `set-project-scope` 로 **자기가 그리는 프로젝트**를 선언하면
 * 서버가 그 자리에서 스냅샷 1벌을 회신하는 구조다. 같은 기기에서는 왕복이 눈에 안 띄지만
 * 원격(느린 회선)에서는 몇 초씩 걸리고, 그동안 캔버스에는 **아무 버블도 없다** — 화면만 보면
 * "아직 안 온 것"과 "원래 비어 있는 프로젝트"가 완전히 똑같다.
 *
 * 그래서 판정을 눈대중(노드 수가 0인가)이 아니라 **서버가 되돌려 준 사실**로 한다:
 * `GraphSnapshot.scopedProjects` 는 그 스냅샷에 실제로 실린 프로젝트 목록이므로,
 * 지금 보는 탭이 그 안에 없으면 **아직 안 온 것이 확실하다**(0개짜리 프로젝트는 목록에 들어 있다).
 *
 * 판정을 순수 함수로 꺼내 두는 이유는 늘 같다 — store 를 세우지 않고 표로 고정할 수 있어야
 * "느린 회선에서만 재현되는" 이 화면을 테스트가 대신 봐 준다.
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
  /**
   * §9 폴더 스코프 — 지금 들어가 있는 폴더의 노드 id. `null` = 폴더 밖(메인 뷰).
   *
   * 폴더 축은 프로젝트 축과 **같은 함정을 한 칸 아래에서** 갖는다: 폴더에 막 들어간 직후의
   * 빈 내부 뷰와, 자식이 하나도 없는 진짜 빈 폴더가 화면상 완전히 같다.
   */
  currentFolderId: string | null;
  /** 마지막 스냅샷이 적용한 폴더 범위. `null` = 범위 미적용(= 폴더 슬라이스가 전량이다). */
  snapshotFolderScope: string[] | null;
  /** 이 창이 스냅샷을 한 번이라도 받았는가. */
  snapshotReceived: boolean;
  /** WebSocket 연결 상태(헤더 인디케이터와 같은 값). */
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

/**
 * 지금 보는 탭의 데이터가 **손에 들어와 있는가**.
 *
 * ⚠ "노드가 하나라도 있는가"로 세면 안 된다 — 갓 등록해 버블이 없는 프로젝트는 영원히
 *   불러오는 중이 되고, 반대로 직전 탭의 잔상이 남아 있으면 안 온 것을 왔다고 읽는다.
 */
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
 * 지금 **열어 둔 폴더의 내용**이 손에 들어와 있는가.
 *
 * 프로젝트 축과 같은 규칙을 그대로 물려받는다 — 세지 않고, 서버가 되돌려 준 범위로 판정한다.
 * 자식이 0개인 폴더도 범위 안에는 들어 있으므로, 이 한 줄이 빈 폴더와 안 온 폴더를 가른다.
 *
 * ⚠ 서버는 "그리는 폴더 + 한 칸 앞"을 미리 실어 주므로 정상적인 드릴다운에서는 여기 걸릴 일이
 *   거의 없다. 걸리는 자리는 재연결 직후·저장된 위치로 복원한 직후처럼 **선언이 아직 안 나간**
 *   순간이고, 그때가 바로 사용자가 빈 화면을 오해하는 순간이다.
 */
function hasOpenFolderData(i: CanvasLoadingInputs): boolean {
  if (i.currentFolderId === null) return true;      // 폴더 밖이면 볼 것이 없다
  if (i.snapshotFolderScope === null) return true;  // 범위 미적용 = 폴더 슬라이스가 전량이다
  return i.snapshotFolderScope.includes(i.currentFolderId);
}

/**
 * 캔버스가 띄울 상태를 정한다.
 *
 * 순서가 규칙이다.
 *  ① stub 탭은 언제나 `ready` — 그 화면에는 이미 [불러오기] 안내가 서 있고, 그 위에 로딩까지
 *    겹치면 사용자가 무엇을 눌러야 하는지 헷갈린다(같은 자리에 두 개의 안내 ❌).
 *  ② 데이터가 왔으면 `ready` — **비어 있어도** 그렇다(빈 프로젝트에 영구 스피너를 씌우지 않는다).
 *  ③ 못 받았으면, 기다릴 소켓이 살아 있는지로 문구가 갈린다.
 *
 * ②는 **프로젝트와 폴더 두 축을 모두** 본다 — 탭은 다 왔는데 방금 들어간 폴더의 자식이 아직
 * 안 왔으면 그 화면도 똑같이 "아직 안 온 것"이다(§9 폴더 스코프).
 */
export function resolveCanvasLoadingState(i: CanvasLoadingInputs): CanvasLoadingState {
  if (i.activeIsStub) return 'ready';
  if (hasActiveProjectData(i) && hasOpenFolderData(i)) return 'ready';
  return i.connectionStatus === 'connected' ? 'loading' : 'reconnecting';
}
