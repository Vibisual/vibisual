import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import type { WSMessage, GraphSnapshot, GraphSnapshotWire, SubAgentStreamEvent, ProjectHydratedPayload, ProjectUnloadedPayload, IframeLogInitPayload, IframeLogAppendPayload, ServerLogInitPayload, ServerLogAppendPayload, PermissionRequest, PermissionDecision, ClaudeInstallProgress, ClaudeSetupProgress, AskUserQuestionRequest, AskUserQuestionDecision, DebugEventPayload, HookFiredPayload, KeyedSliceDelta, DeltaSliceKey } from '@vibisual/shared';
import { applyKeyedSliceDelta, DELTA_SLICE_KEYS, MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY, WS_BATCH_INTERVAL, WS_STREAM_BATCH_INTERVAL, WS_BATCH_INTERVAL_MAX, WS_BATCH_BACKOFF_FACTOR } from '@vibisual/shared';
// §9 슬라이스 스코프 — 규칙 전문은 `shared/src/sliceScope.ts` 머리말이 단독 소유한다.
import { carryForwardScopedSlices, type SliceScopeGroup } from '@vibisual/shared';
import { useGraphStore, selectRenderedIDEPaneKeys } from '../stores/graphStore.js';
// §6 — 단축키는 프로젝트가 아니라 기계의 것이라 별도 스토어에 산다(graphStore ❌).
import { useKeymapStore } from '../stores/keymap.js';
import { useWebOpenTargetStore } from '../stores/webOpenTarget.js';
import { useIDEActivityBarStore } from '../stores/ideActivityBar.js';
import { useActivePluginModules } from '../plugins/host.js';
import { batchStoreNotify } from '../stores/batchedNotify.js';
import { structuralShare } from '../stores/structuralShare.js';
// §5.5 #17-20 ⑩ — 디버그 세션은 프로세스 수명이라 그래프 스토어가 아닌 런타임 스토어가 받는다.
import { useDebugSessions } from '../stores/debugSessions.js';
import { useHookFires } from '../stores/hookFires.js';
import { iframeLogEvents } from '../bubble-map/api/iframeLogEvents.js';
import { serverLogEvents } from '../bubble-map/api/serverLogEvents.js';
import { setDiagnosticsSender } from '../utils/diagnostics.js';
import { registerTerminalWsSender, dispatchTerminalFrame } from '../transport/mobileTerminalBridge.js';
import i18n from '../i18n/index.js';
import {
  playCompletionChime,
  showBrowserNotification,
  requestNotificationPermission,
  claimCompletionChime,
} from '../utils/notification.js';
import { detectCustomAgentCompletions } from '../utils/completionChime.js';
import { installResumeWatch, shouldResyncOnResume, type SocketState } from './resumeResync.js';
import { resyncAfterReconnect } from './reconnectResync.js';
import { emitAppEvent } from '../apps/appEvents.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketReturn {
  status: ConnectionStatus;
  send: (message: WSMessage) => void;
  /** §5.12 (J) — 소켓을 끊고 즉시 다시 붙는다 — 새 연결의 `buildConnectionMessages()`(ack + 전체 스냅샷)가 곧 새로고침이다(새 메시지 타입 ❌). */
  reconnect: () => void;
  /**
   * §5.12 (J) — 마지막으로 `graph_snapshot` 을 화면에 반영한 시각(0 = 아직 없음).
   * **state 가 아니라 ref 를 읽는 함수**다 — 스냅샷마다 setState 하면 이 훅을 쓰는 모든 창이
   * 16ms 주기로 리렌더된다. 필요한 쪽이 자기 틱에서 읽어 간다.
   */
  getLastSnapshotAt: () => number;
}

function isWSMessage(data: unknown): data is WSMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'timestamp' in data
  );
}

/** §9 — 서버가 안 싣는 슬라이스의 **빈 값 고정 참조**(`?? {}` 로 매번 새로 지으면 안 온 필드에도 16ms 마다 리렌더). */
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_LIST: never[] = [];

/**
 * §9 슬라이스 스코프 — **이 창이 자기가 읽는 슬라이스를 말할 수 있는가**(창은 `location.hash` 로 갈린다, 빈 해시 = 메인 캔버스).
 * 독자를 확증한 창만 선언한다 — 틀린 "안 읽는다"는 화면을 비운다. 미선언 창이 있으면 합집합이 전량이 될 뿐 틀린 값은 안 간다.
 * 버블 오버레이(`#overlay=`)도 선언한다(§5.5 #17-6 (H-4)) — 끌어내는 순간 태어나는 이 창이 침묵하면 전량(실측 752.9KB)이 모든 창에 되살아나 앱이 멎는다.
 * 그 창은 `BubbleNode`·`AgentIDEOverlay`·`PermissionPromptStack` 만 그려 `ideLane`·`pluginAgentData` 가 덮는다(`OverlayShell` 이 프로젝트를 고정해 IDE 칸 수도 맞다).
 */
export function canDeclareSliceScopeForHash(hash: string): boolean {
  const h = hash.replace(/^#/, '');
  if (h.length === 0) return true;                 // 메인 캔버스 창(`App`)
  // 버블 오버레이 창 — 위 주석의 근거로 메인 창과 같은 산식을 쓴다. `parseOverlayHash` 와 같은
  //   판정을 여기서 다시 하지 않고 접두만 본다(그 함수를 부르면 훅이 레이아웃 모듈에 매인다).
  return new URLSearchParams(h).get('overlay') === '1';
}

function canDeclareSliceScope(): boolean {
  if (typeof window === 'undefined') return false; // 판정 불가 → 선언하지 않는다(= 전량)
  return canDeclareSliceScopeForHash(window.location.hash);
}

function isGraphSnapshot(data: unknown): data is GraphSnapshotWire {
  return (
    typeof data === 'object' &&
    data !== null &&
    'agents' in data &&
    'topFolders' in data &&
    Array.isArray((data as GraphSnapshot).agents) &&
    Array.isArray((data as GraphSnapshot).topFolders)
  );
}

/** §5.5 #17-11 ⑦ — 이 창이 완료음·알림을 내는가(기본 `false`). 셸마다 이 훅을 마운트해 게이트가 없으면 창 수만큼 울린다(`claimCompletionChime` 클레임은 프로세스 경합에서 둘 다 통과한다). */
export function useWebSocket(
  url: string,
  options?: {
    announceCompletions?: boolean;
    /** §9 — 이 창이 읽는 슬라이스 묶음을 **부르는 쪽이 직접** 말한다(독자를 확인한 창만, 빈 배열도 유효). 없으면 해시 판정(`canDeclareSliceScope`). */
    sliceScope?: readonly SliceScopeGroup[];
  },
): UseWebSocketReturn {
  const announceCompletions = options?.announceCompletions ?? false;
  const declaredSliceKey = options?.sliceScope ? [...options.sliceScope].sort().join(',') : null;
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // graph_snapshot 코얼레스 — 버스트 시 마지막 스냅샷만 적용 (16ms 트레일링).
  const snapshotPendingRef = useRef<GraphSnapshotWire | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §9 — 부하 적응형 배치 창. loadSnapshot 재구축이 16ms 예산을 넘기면 다음 flush 창을 직전 비용 × 배수로 늘린다(상한 250ms). 비용이 낮아지면 즉시 기본 주기.
  const snapshotDelayRef = useRef(WS_BATCH_INTERVAL);
  // §5.12 (J) — 마지막으로 스냅샷을 반영한 시각. ref 라 리렌더를 유발하지 않는다(위 주석 참조).
  const lastSnapshotAtRef = useRef(0);
  // §9 — sub_agent_stream 배치 — 도착분을 16ms 창에 모았다가 store action 1회로 합쳐 적용.
  // 커스텀 에이전트 다중 실행 시 매 스트림 라인마다 구독자 전원 재평가하던 것을 16ms당 1회로.
  const streamPendingRef = useRef<SubAgentStreamEvent[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §9 — 스트림 반영도 같은 적응(기본 50ms, 상한 250ms). 배수 3 — 스트림 텍스트는 지연에 민감해 스냅샷(×4)보다 완만하게.
  const streamDelayRef = useRef(WS_STREAM_BATCH_INTERVAL);
  // 이 창에서 소켓이 한 번이라도 열렸나 — 부팅 첫 연결과 재연결을 가른다(재연결만 놓친 것을 다시 받는다).
  const hasOpenedRef = useRef(false);
  // 화면 복귀로 새로고침을 마지막으로 건 시각 — 복귀 신호가 한꺼번에 여럿 와도 한 번만 붙게(`resumeResync.ts`).
  const lastResumeResyncAtRef = useRef(0);

  /** §9 — 증분으로 온 키맵 슬라이스(`fileEdits`·`bashHistory` — 부피의 78%)를 복원할 **최신 전체 맵**. ⚠ **합성은 메시지가 도착할 때마다** — 코얼레스는 마지막 1건만 적용해, flush 때 합치면 버려진 메시지의 증분이 사라진다. */
  const keyedShadowRef = useRef<Partial<Record<DeltaSliceKey, Record<string, unknown>>>>({});

  /** §9 — **직전 스냅샷**(구조적 공유의 비교 상대). `apply*` 들은 받은 값을 그대로 갈아끼워 안 바뀐 스냅샷도 새 참조가 된다(실측 1건당 리렌더 612건) — 전선에서 받은 시점에 한 번 공유를 태운다. */
  const lastWireRef = useRef<GraphSnapshotWire | null>(null);

  /** 전선에서 온 스냅샷 → 증분을 푼 뒤 직전 스냅샷과 구조적 공유를 태운 것(이후 경로는 종전과 동일). */
  const materializeSnapshot = useCallback((wire: GraphSnapshotWire): GraphSnapshotWire => {
    const shadow = keyedShadowRef.current;
    const deltaRec = wire.deltas as unknown as Record<string, KeyedSliceDelta<unknown> | undefined> | undefined;
    let full = wire;
    if (wire.deltas) full = { ...wire };
    const fullRec = full as unknown as Record<string, unknown>;
    const wireRec = wire as unknown as Record<string, Record<string, unknown> | undefined>;

    // 슬라이스 목록은 서버와 **한 벌**(`DELTA_SLICE_KEYS`) — 한쪽만 늘면 조용히 어긋난다.
    for (const key of DELTA_SLICE_KEYS) {
      const delta = deltaRec?.[key];
      if (delta) {
        // 증분이 왔다 — 직전 그림자 위에 얹어 종전과 똑같은 전체 맵으로 되돌린다.
        const merged = applyKeyedSliceDelta(shadow[key] ?? {}, delta);
        shadow[key] = merged;
        fullRec[key] = merged;
        continue;
      }
      // 전량이 왔다(또는 그 슬라이스가 아직 없다) — 다음 증분의 기준점만 갱신하고
      // `full` 은 건드리지 않는다. 없는 필드를 `{}` 로 채우면 그 기능을 안 쓰는 사람에게
      // 매번 새 빈 객체가 가서 §9 ③(`?? {}` 는 고정 참조)이 깨진다.
      shadow[key] = wireRec[key] ?? {};
    }
    if (wire.deltas) delete full.deltas;
    // §9 슬라이스 스코프 — **범위 밖이라 안 온 슬라이스는 직전 전체 스냅샷의 값을 같은 참조로 잇는다**(§9 ⑥ 안 옴 ≠ 비어 있음). `keyedShadowRef` 는 델타 슬라이스만 덮어 부족하다.
    // `scopedSlices` 가 없으면(범위 미적용·구버전 서버) 하지 않는다 — 그때 없는 것은 진짜 없는 것이라 이으면 지운 값이 되살아난다.
    full = carryForwardScopedSlices(lastWireRef.current, full, wire.scopedSlices);
    // 서버 권위 순수 JSON 이므로 구조적 공유의 전제(structuralShare.ts 주석)를 그대로 만족한다.
    const shared = structuralShare(lastWireRef.current, full);
    lastWireRef.current = shared;
    return shared;
  }, []);

  // §9 — 아래 36번의 `set()`(loadSnapshot 1 + apply* 35)은 **한 사건**이다. zustand 는 호출마다
  //   구독자 전원의 선택자를 다시 돌리므로, 묶지 않으면 스냅샷 1건에 그 재평가를 36벌 지불한다
  //   (실측 구독 4,000개 기준 5.01ms → 0.15ms). 상태 갱신은 종전과 완전히 같고 **통지만** 접힌다.
  const applyGraphSnapshot = useCallback((snap: GraphSnapshotWire) => batchStoreNotify(() => {
    // [perf-snapshot] 계측 — 콘솔에서 `__VIBI_PERF__ = true` 로 켠다(기본 off, 프로덕션 비용 0).
    // loadSnapshot(그래프 전체 재구축) vs 이후 apply*(~22개 슬라이스 set) 중 어디가 무거운지 분리 측정.
    const PERF = !!(globalThis as unknown as { __VIBI_PERF__?: boolean }).__VIBI_PERF__;
    const _t0 = PERF ? performance.now() : 0;
    const store = useGraphStore.getState();
    store.loadSnapshot(
      snap.projects ?? {},
      snap.agents,
      snap.topFolders,
      snap.children,
      snap.edges,
      snap.innerEdges,
      snap.satellites,
      snap.bashHistory ?? {},
      snap.runningServers ?? {},
      snap.agentEvents ?? {},
      snap.agentProjects ?? {},
      snap.nodeProjects ?? {},
      snap.fileEdits ?? {},
      snap.commandQueues ?? {},
      snap.completedCommands ?? {},
      snap.subAgents ?? {},
      snap.agentPhase ?? 'waiting',
      snap.activeAgentCount ?? 0,
      snap.satellitePositions ?? {},
      snap.pipelineChildren ?? {},
      snap.pipelines ?? {},
      snap.agentConfigs ?? {},
      snap.taskEdges ?? {},
      snap.worktreeProjects ?? {},
      snap.gitDirty ?? {},
      snap.commentBoxes ?? [],
      snap.captureBubbles ?? [],
      snap.contis ?? {},
      snap.activeContiWork ?? {},
      snap.autoGoal ?? {},
    );
    // §9 스코프드 구독 — 프로젝트별 에이전트 집계(탭 배지). **구독 범위 밖 프로젝트도 들어 있다.**
    //   같은 이유로 별도 액션(loadSnapshot 위치 인자 ❌).
    useGraphStore.getState().applyProjectAgentCounts(snap.projectAgentCounts ?? EMPTY_RECORD);
    // §9 스코프드 구독 — **이 스냅샷이 어느 프로젝트를 실어 왔는지**. 없으면(구버전 서버 · 선언한
    //   창이 없을 때) 전량이라는 뜻이라 `undefined` 를 그대로 넘긴다. 캔버스의 "불러오는 중"
    //   표시가 이 값 하나로 켜지고 꺼진다.
    useGraphStore.getState().applySnapshotScope(snap.scopedProjects);
    // §9 폴더 스코프 — 한 칸 아래의 같은 값. 지금 열어 둔 폴더가 이 목록에 없으면 그 내부는
    //   비어 있는 것이 아니라 아직 안 온 것이다.
    useGraphStore.getState().applySnapshotFolderScope(snap.scopedFolders);
    // §9 폴더 스코프 — 서버가 전량으로 잰 상대 척도(파일 크기 · 히트맵). **loadSnapshot 뒤**라야
    //   직접 잰 값을 덮는다. 안 오면(구버전 서버) 아무것도 안 하므로 종전 동작 그대로다.
    useGraphStore.getState().applySnapshotScales(
      snap.fileSizeRange,
      snap.readCountMaxByProject,
      snap.writeCountMaxByProject,
      // §5.24 — `quantile` 곡선의 분포도 최대값과 **같은 칸**이다(전량으로 잰 값이라야 폴더를
      //   드나들 때 순위가 뒤집히지 않는다).
      snap.readCountQuantilesByProject,
      snap.writeCountQuantilesByProject,
    );
    // §5.13 — 앱 버블은 별도 액션으로 반영한다(loadSnapshot 위치 인자를 늘리면 호출부 한 곳만 어긋나도 조용히 다른 값이 들어간다).
    useGraphStore.getState().applyAppBubbles(snap.appBubbles ?? EMPTY_LIST);
    // §5.14 — 플레이 버블도 같은 이유로 별도 액션.
    useGraphStore.getState().applyPlayBubbles(snap.playBubbles ?? EMPTY_LIST);
    // §5.15 — 스펙 보드도 같은 이유로 별도 액션.
    useGraphStore.getState().applySpecDocs(snap.specDocs ?? EMPTY_LIST);
    // §5.18 — 에이전트 랩도 같은 이유로 별도 액션(비교 표는 서버 값 그대로 그린다).
    useGraphStore.getState().applyLabRuns(snap.labRuns ?? EMPTY_LIST);
    // §5.20 — 스크립트 선반도 같은 이유로 별도 액션(항목의 마지막 결과는 서버 값 그대로 그린다).
    useGraphStore.getState().applyShelfBubbles(snap.shelfBubbles ?? EMPTY_LIST);
    // §5.21 — 비용·토큰 지도. 기간 합계·정렬까지 서버가 접어 실어 주므로 그대로 넣는다.
    useGraphStore.getState().applyCostMaps(snap.costMaps ?? EMPTY_LIST);
    // §5.22 — 감사 원장. 위험·거부 집계까지 서버가 접어 실어 주므로 그대로 넣는다.
    useGraphStore.getState().applyAuditLogs(snap.auditLogs ?? EMPTY_LIST);
    // §5.26 — 컨텍스트 보험 원장. 감사 원장과 같은 자리·같은 규율(서버가 접은 값을 그대로 받는다).
    useGraphStore.getState().applyContextInsurance(snap.contextInsurance ?? EMPTY_LIST);
    // §5.16 — 리뷰·승인 레인. 서버가 전량을 싣고, 사람이 치운 리뷰는 곧 사라짐으로 반영된다.
    useGraphStore.getState().applyReviewRequests(snap.reviewRequests ?? EMPTY_LIST);
    // §5.5 #17-20 ⑩ — 중단점(프로젝트별). 세션이 없어도 편집창 gutter 가 그린다.
    useGraphStore.getState().applyDebugBreakpoints(snap.debugBreakpoints ?? EMPTY_RECORD);
    // §5.11 — 집행 플러그인의 실측(프로젝트별). 켠 것이 없으면 서버가 필드를 안 실으므로 빈 맵으로 비운다.
    useGraphStore.getState().applyPluginFacts(snap.pluginFacts ?? EMPTY_RECORD);
    const _tLoad = PERF ? performance.now() : 0;
    store.applyStubProjects(snap.stubProjects ?? EMPTY_RECORD);
    store.applyAppState(snap.appState);
    if (snap.uiLocale) store.applyUiLocale(snap.uiLocale);
    store.applyLayoutBoundsByProject(snap.layoutBoundsByProject);
    // §5.3 #12-3 — 자물쇠(프로젝트 이름 키). 집행은 서버가 하고 화면은 이 값으로 글리프·메뉴를 그린다.
    store.applyPathLocks(snap.pathLocks);
    store.applyV150Metrics(snap.recentToolDurations, snap.compactCounts, snap.rateLimits, snap.claudeUsage);
    // §4 — Claude 로그인 상태(글로벌). 미로그인이면 LoginWindow 가 이 값을 보고 뜬다.
    store.applyClaudeAuth(snap.claudeAuth);
    // §4 API 크레딧 — 설정·장부·지금 경로(글로벌). 헤더 필의 점과 사용량 팝업·계정 탭이 이 값을 그린다.
    store.applyApiCredits(snap.apiCredits);
    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정(글로벌). 미설치면 ClaudeSetupGate 가 이 값을 보고 뜬다.
    store.applyClaudeSetup(snap.claudeSetup);
    // §5.25 — 코덱스 네 칸(설치·로그인·모델·훅). 클로드와 같은 자리에서 같은 모양으로 받는다.
    store.applyCodexSetup(snap.codexSetup);
    store.applyCodexAuth(snap.codexAuth);
    store.applyCodexModels(snap.codexModels);
    store.applyCodexInventory(snap.codexInventory);
    store.applyCodexReviews(snap.codexReviews);
    store.applyCodexHooks(snap.codexHooks);
    store.applySkillUsageCounts(snap.skillUsageCounts);
    store.applyAutoAgentSummaries(snap.autoAgentSummaries);
    store.applyAutoAgentRuns(snap.autoAgentRuns);
    // §5.3 #10-4 — 오케스트라 설정·런. 비어 오면(아무것도 정하지 않음) 빈 맵이 곧 "꺼짐"이다.
    store.applyOrchestra(snap.orchestra);
    // §5.3 #10-5 — 설정 덜어내기 범위·런. 비어 오면(아무도 켜지 않음) 빈 맵이 곧 "꺼짐"이다.
    store.applyConfigTrim(snap.configTrim);
    store.applyRunningSubagentTasks(snap.runningSubagentTasks);
    store.applyFinishedSubagentTasks(snap.finishedSubagentTasks);
    store.applyAgentReports(snap.agentReports);
    store.applyAgentMemos(snap.agentMemos);
    // §5.23 — 도메인 버블 웹 이력
    store.applyDomainEntries(snap.domainEntries);
    store.applyAgentQuestions(snap.agentQuestions);
    store.applyAgentReviews(snap.agentReviews);
    store.applyAgentLists(snap.agentLists);
    store.applyAgentFeedbacks(snap.agentFeedbacks);
    store.applySessionLoops(snap.sessionLoops);
    store.applyVerificationRuns(snap.verificationRuns);
    // §5.5 #17-35 ⑨ — 시연 목록도 검증 이력 바로 옆자리에서 전량 교체한다.
    store.applyVerificationDemos(snap.verificationDemos);
    // §5.11 정독 게이트 — 세션별 기획 정독 상태(활동바 배지 + 정독 뷰의 원본).
    store.applySpecReading(snap.specReading);
    // §5.5 #17-17 — 세션 목표(활동바 퍼센트 배지 + 목표 패널의 원본).
    store.applySessionGoals(snap.sessionGoals);
    store.applyVisualKinds(snap.visualKinds);
    store.applyGoalActions(snap.goalActions);
    store.applyDiagnosticLog(snap.diagnosticLog);
    store.applyModelRegistry(snap.modelRegistry);
    // §5.19 — 로컬 LLM 상태(엔진·모델·내려받기). 스냅샷이 진실이고, 사이사이는 아래 진행 push 가 채운다.
    store.applyLocalLlm(snap.localLlm);
    store.applyUserDefaults(snap.userDefaults);
    if (PERF) {
      const _t1 = performance.now();
      const subs = snap.subAgents ? Object.keys(snap.subAgents).length : 0;
      // eslint-disable-next-line no-console
      console.warn(
        `[perf-snapshot] applyGraphSnapshot total=${(_t1 - _t0).toFixed(1)}ms ` +
        `loadSnapshot=${(_tLoad - _t0).toFixed(1)}ms apply*=${(_t1 - _tLoad).toFixed(1)}ms subAgents=${subs}`,
      );
    }
  }), []);

  const flushSnapshot = useCallback(() => {
    snapshotTimerRef.current = null;
    const snap = snapshotPendingRef.current;
    snapshotPendingRef.current = null;
    if (!snap) return;
    const t0 = performance.now();
    applyGraphSnapshot(snap);
    lastSnapshotAtRef.current = Date.now();
    // 완료음·알림의 **유일한 발화 지점** — 커스텀 에이전트가 이번에 completed 로 넘어온 건만(서버가 서브에이전트까지 대차대조한 상태). §5.5 #17-11 ⑦ — 루프 중엔 회차를 침묵하고 끝에 한 번 울리므로 `sessionLoops` 도 넘긴다.
    if (announceCompletions) {
      for (const finished of detectCustomAgentCompletions(snap.agents, snap.sessionLoops)) {
        if (!claimCompletionChime()) break;
        playCompletionChime();
        const body = i18n.t(
          finished.reason === 'loop'
            ? 'common.notifications.loopCompleted'
            : 'common.notifications.agentCompleted',
        );
        showBrowserNotification(
          'Vibisual',
          finished.agent.label ? `${finished.agent.label} — ${body}` : body,
          () => useGraphStore.getState().requestFocus(),
        );
      }
    }
    const cost = performance.now() - t0;
    snapshotDelayRef.current = Math.min(
      Math.max(WS_BATCH_INTERVAL, cost * WS_BATCH_BACKOFF_FACTOR),
      WS_BATCH_INTERVAL_MAX,
    );
  }, [applyGraphSnapshot, announceCompletions]);

  const flushStreamEvents = useCallback(() => {
    streamTimerRef.current = null;
    const buffered = streamPendingRef.current;
    streamPendingRef.current = [];
    if (buffered.length === 0) return;
    const t0 = performance.now();
    useGraphStore.getState().appendStreamEvents(buffered);
    const cost = performance.now() - t0;
    streamDelayRef.current = Math.min(
      Math.max(WS_STREAM_BATCH_INTERVAL, cost * 3),
      WS_BATCH_INTERVAL_MAX,
    );
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      attemptRef.current = 0;
      requestNotificationPermission();
      // store에 WS send 핸들러 등록 — hydrateProject/closeProject가 직접 발송 가능하도록
      useGraphStore.getState()._registerWsSend((msg: WSMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      });
      // §4 — 진단 에러 캡처 sender 주입(연결 때 쌓인 큐를 보낸다).
      setDiagnosticsSender((msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      });
      // §4 — 모바일 임베디드 터미널 프레임 sender 등록(데스크톱은 window.api.terminal).
      registerTerminalWsSender((frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
      });
      // 다시 붙은 것이면 끊겨 있던 동안 놓친 스트림 줄·대기 카드를 다시 받는다 — 새 연결은 스냅샷만
      //   주므로 그대로 두면 글이 중간에서 끊기고 권한 카드가 없어 멈춘 것처럼 보인다(`reconnectResync.ts`).
      if (hasOpenedRef.current) resyncAfterReconnect();
      hasOpenedRef.current = true;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        // §9 — 통합 앱은 IPC 브리지(IpcWebSocket)가 구조화 클론 객체를 그대로 보낸다(stringify→parse 왕복 없음). dev/web/모바일 ws 는 문자열.
        const raw: unknown = event.data;
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // §4 — 터미널 다중화 프레임(term_*)은 WSMessageType 유니온 밖 — 브리지로 먼저 보낸다.
        if (
          parsed && typeof parsed === 'object' &&
          typeof (parsed as { type?: unknown }).type === 'string' &&
          (parsed as { type: string }).type.startsWith('term_')
        ) {
          dispatchTerminalFrame(parsed as { type: string; payload?: unknown });
          return;
        }
        if (!isWSMessage(parsed)) return;

        const store = useGraphStore.getState();

        switch (parsed.type) {
          case 'graph_snapshot':
            if (isGraphSnapshot(parsed.payload)) {
              // 16ms 트레일링 코얼레스 — 버스트 때 최신 1건만 재구축한다. §9 — 증분(deltas)은 누적이라 버려지는 메시지 것도 여기서 먼저 반영한다.
              snapshotPendingRef.current = materializeSnapshot(parsed.payload);
              if (snapshotTimerRef.current === null) {
                snapshotTimerRef.current = setTimeout(flushSnapshot, snapshotDelayRef.current);
              }
            }
            break;

          case 'project-hydrated': {
            const p = parsed.payload as ProjectHydratedPayload;
            if (p && typeof p.projectName === 'string') {
              store.onProjectHydrated(p.projectName, p.success, p.reason);
            }
            break;
          }

          case 'project-unloaded': {
            const p = parsed.payload as ProjectUnloadedPayload;
            if (p && typeof p.projectName === 'string') {
              store.onProjectUnloaded(p.projectName);
            }
            break;
          }

          case 'sub_agent_stream': {
            const event = parsed.payload as SubAgentStreamEvent;
            if (event && typeof event.subAgentId === 'string') {
              // 스트림 배치 — 도착 순서대로 큐에 모았다가 flush 시 한 번에 합쳐 적용.
              // 스냅샷(16ms)과 달리 WS_STREAM_BATCH_INTERVAL(50ms)로 묶어 StreamRenderer 재구축 빈도를 낮춘다.
              streamPendingRef.current.push(event);
              if (streamTimerRef.current === null) {
                streamTimerRef.current = setTimeout(flushStreamEvents, streamDelayRef.current);
              }
            }
            break;
          }

          case 'sub_agent_stream_batch': {
            // 서버가 40ms 창으로 coalescing 한 배열. 클라 스트림 배치 큐(50ms)에 그대로 합류.
            const batch = parsed.payload as SubAgentStreamEvent[];
            if (Array.isArray(batch) && batch.length > 0) {
              for (const event of batch) {
                if (event && typeof event.subAgentId === 'string') {
                  streamPendingRef.current.push(event);
                }
              }
              if (streamTimerRef.current === null) {
                streamTimerRef.current = setTimeout(flushStreamEvents, streamDelayRef.current);
              }
            }
            break;
          }

          case 'liveness_probe': {
            const p = parsed.payload as {
              sessionId: string; cwd: string; inUse: boolean;
              durationMs: number; reason: string; output: string; command: string;
            };
            if (import.meta.env.DEV) {
              const tag = p.inUse ? '%c[INUSE]' : '%c[FREE]';
              const color = p.inUse ? 'color:#10b981;font-weight:bold' : 'color:#f43f5e;font-weight:bold';
              console.log(
                tag + ' sess=%s dur=%dms via=%s',
                color, p.sessionId.slice(0, 8), p.durationMs, p.reason,
              );
              console.log('  cwd:    ', p.cwd);
              console.log('  command:', p.command);
              console.log('  output: ', p.output || '(empty)');
            }
            break;
          }

          case 'agent_status':
            // **여기서 완료음을 울리지 않는다** — "전체 활성 세션 0" 전이라 외부·훅 세션의 턴 종료까지 잡힌다. 완료음은 flushSnapshot 의 커스텀 에이전트 completed 전이가 낸다. phase 는 서버 스냅샷이 관리한다.
            break;

          // §5.3 #12-1 — 권한 승인 요청 스택
          case 'permission_request': {
            const p = parsed.payload as PermissionRequest;
            if (p && typeof p.requestId === 'string') {
              store.addPendingPermission(p);
            }
            break;
          }
          case 'permission_resolved': {
            const p = parsed.payload as PermissionDecision;
            if (p && typeof p.requestId === 'string') {
              store.removePendingPermission(p.requestId);
            }
            break;
          }

          // §5.3 #12-2 — AskUserQuestion IDE 인라인 카드
          case 'ask_user_question': {
            const p = parsed.payload as AskUserQuestionRequest;
            if (p && typeof p.requestId === 'string') {
              store.addPendingAskQuestion(p);
            }
            break;
          }
          case 'ask_user_question_resolved': {
            const p = parsed.payload as AskUserQuestionDecision;
            if (p && typeof p.requestId === 'string') {
              store.removePendingAskQuestion(p.requestId);
            }
            break;
          }

          // §5.5 #17-20 ⑩ — 디버그 층의 상태/출력. 세션은 프로세스 수명이라 graph_snapshot 이 아니라 이 메시지로만 흐른다.
          case 'debug_event': {
            const p = parsed.payload as DebugEventPayload;
            if (p && typeof p.sessionId === 'string') {
              useDebugSessions.getState().applyEvent(p);
            }
            break;
          }

          // §5.5 #17-32 ⑤ — 훅이 방금 울렸다. 서버가 짧은 창으로 모아 배열 한 건으로 보낸다.
          // 순간의 표시 신호라 graph_snapshot 이 아니라 이 메시지로만 흐른다(런타임 스토어가 받는다).
          case 'hook_fired': {
            const fired = parsed.payload as HookFiredPayload[];
            if (Array.isArray(fired) && fired.length > 0) {
              useHookFires.getState().applyFired(fired.filter((f) => f && typeof f.event === 'string'));
            }
            break;
          }

          // §7.11 — iframe 서버 로그 스트리밍. shellId 는 (port, shellId) 필터용 echo.
          case 'iframe_log_init': {
            const p = parsed.payload as IframeLogInitPayload;
            if (p && typeof p.port === 'number' && Array.isArray(p.lines)) {
              const ev: Parameters<typeof iframeLogEvents.emit>[0] = {
                port: p.port,
                kind: 'init',
                lines: p.lines,
              };
              if (p.shellId) ev.shellId = p.shellId;
              if (p.unavailable) ev.unavailable = p.unavailable;
              iframeLogEvents.emit(ev);
            }
            break;
          }
          case 'iframe_log_append': {
            const p = parsed.payload as IframeLogAppendPayload;
            if (p && typeof p.port === 'number' && Array.isArray(p.lines)) {
              const ev: Parameters<typeof iframeLogEvents.emit>[0] = {
                port: p.port,
                kind: 'append',
                lines: p.lines,
              };
              if (p.shellId) ev.shellId = p.shellId;
              iframeLogEvents.emit(ev);
            }
            break;
          }

          // §7.7 — 서버 코어 로그 스트리밍
          case 'server_log_init': {
            const p = parsed.payload as ServerLogInitPayload;
            if (p && Array.isArray(p.lines)) {
              serverLogEvents.emit({ kind: 'init', lines: p.lines });
            }
            break;
          }
          case 'server_log_append': {
            const p = parsed.payload as ServerLogAppendPayload;
            if (p && Array.isArray(p.lines)) {
              serverLogEvents.emit({ kind: 'append', lines: p.lines });
            }
            break;
          }

          // §5.7 #23-1 — Claude Code 업데이트 설치 진행
          case 'claude_install_progress': {
            const p = parsed.payload as ClaudeInstallProgress;
            if (p && typeof p.installId === 'string') {
              store.setClaudeInstallProgress(p);
            }
            break;
          }

          // §4 (첫 실행 설치 온보딩) — 네이티브 인스톨러 진행. 게이트가 이 값으로 로그를 보여준다.
          case 'claude_setup_progress': {
            const p = parsed.payload as ClaudeSetupProgress;
            if (p && typeof p.setupId === 'string') {
              store.setClaudeSetupProgress(p);
            }
            break;
          }

          // §5.25 (D) — 코덱스 설치 진행. 게이트가 이 값으로 로그를 보여준다.
          case 'codex_setup_progress': {
            const p = parsed.payload as import('@vibisual/shared').CodexSetupProgress;
            if (p && typeof p.setupId === 'string') {
              store.setCodexSetupProgress(p);
            }
            break;
          }
          case 'model_registry_updated': {
            // §4 — 시드→api-merged 전환 또는 TTL refresh 때 단독 push.
            store.applyModelRegistry(parsed.payload as import('@vibisual/shared').ModelRegistry);
            break;
          }
          case 'local_engine_progress': {
            // §5.19 — 엔진 설치 진행. 스냅샷을 기다리면 막대가 뚝뚝 끊긴다.
            store.applyLocalEngineProgress(parsed.payload as import('@vibisual/shared').LocalEngineProgress);
            break;
          }
          case 'local_model_progress': {
            // §5.19 — 모델 내려받기 진행(수 GB 라 이 줄이 사실상 유일한 피드백이다).
            store.applyLocalModelProgress(parsed.payload as import('@vibisual/shared').LocalModelDownloadProgress);
            break;
          }
          case 'voice_asr_progress': {
            // §5.5 #17-38 ⑫ — 받아쓰기 엔진·모델 설치 진행(650MB 라 이 줄이 유일한 피드백이다).
            store.applyVoiceAsrProgress(parsed.payload as import('@vibisual/shared').VoiceAsrInstallProgress);
            break;
          }
          case 'user_defaults_updated': {
            // §4 — Options 창의 Apply 를 다른 창들도 즉시 반영.
            store.applyUserDefaults(parsed.payload as import('@vibisual/shared').UserDefaults);
            break;
          }
          case 'app_themes_updated': {
            // §4 앱 테마 — 한 창에서 테마 폴더를 다시 읽었다(바뀐 것이 있을 때만 온다). 고른 사용자 테마가
            //   고쳐졌으면 이 창도 같은 색으로 다시 칠한다.
            const catalog = parsed.payload as import('@vibisual/shared').AppThemeCatalog | null;
            if (catalog && Array.isArray(catalog.themes) && Array.isArray(catalog.issues)) store.applyAppThemes(catalog);
            break;
          }
          case 'keymap_updated': {
            // §6 — 단축키 재매핑. 창이 여럿일 때 다른 창도 즉시 같은 키를 쓴다(안 그러면
            //   창마다 다른 단축키가 되고, 그건 사용자에게 "가끔 안 먹는다"로 보인다).
            useKeymapStore.getState().applyOverrides(parsed.payload);
            break;
          }
          case 'web_open_target_updated': {
            // §5.23 「더블클릭」 — 도메인 버블이 여는 곳. 단축키와 같은 이유로 다른 창도 즉시 같은 곳에서 연다.
            useWebOpenTargetStore.getState().apply(parsed.payload);
            break;
          }
          case 'ide_activity_bar_updated': {
            // §5.5 #16-1 — 활동바 배치. 단축키와 같은 이유로 창이 여럿이면 다른 창도 즉시
            //   같은 자리를 써야 한다 — 한 창에서 내려놓은 칸이 옆 창에 남아 있으면 그것이 곧 버그 신고다.
            useIDEActivityBarStore.getState().applyPrefs(parsed.payload);
            break;
          }
          case 'app_event': {
            // §5.13 (Y) 40-7 ② — 앱 서버 몫의 알림(판이 올랐다·지금 하는 일이 바뀌었다). 코어는 뜻을 모르고 그 앱 화면에 흘린다.
            emitAppEvent(parsed.payload);
            break;
          }
        }
      } catch {
        // 파싱 실패 시 무시
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      setDiagnosticsSender(null); // §4 — 끊긴 동안의 에러는 큐에 두었다가 재연결 때 보낸다.
      registerTerminalWsSender(null); // §4 — 끊기면 터미널 프레임 전송을 멈춘다(재연결 때 다시 등록).

      if (attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, attemptRef.current);
        attemptRef.current += 1;
        console.warn(
          `[Vibisual] Reconnect attempt ${attemptRef.current}/${MAX_RECONNECT_ATTEMPTS} (in ${(delay / 1000).toFixed(1)}s)`,
        );
        timerRef.current = setTimeout(connect, delay);
      } else {
        console.warn(
          `[Vibisual] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded. Run pnpm dev to start the server.`,
        );
      }
    };

    ws.onerror = () => {
      console.warn(`[Vibisual] Cannot connect to server (${url}). Check if the server is running.`);
      ws.close();
    };
  }, [url, flushSnapshot, flushStreamEvents, materializeSnapshot]);

  useEffect(() => {
    connect();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onerror = null;
        ws.onclose = null;
        ws.onopen = () => ws.close();
        if (ws.readyState === WebSocket.OPEN) ws.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /** §5.12 (J) 새로고침 — 닫기 전에 옛 소켓의 `onclose` 를 뗀다(두면 backoff 재연결이 하나 더 예약돼 두 소켓을 문다). 예약된 재시도도 걷고 횟수를 0 으로. */
  const reconnect = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    attemptRef.current = 0;
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      wsRef.current = null; // connect() 의 "이미 열려 있으면 무시" 가드를 지나가게 한다.
    }
    connect();
  }, [connect]);

  const getLastSnapshotAt = useCallback(() => lastSnapshotAtRef.current, []);

  // §4 모바일 웹 — 화면이 돌아오면 연결을 점검해 제자리 새로고침을 건다(폰은 꺼진 사이 소켓이 말없이 죽어 OPEN 으로 남거나 재시도를 다 쓴다). 판정은 `resumeResync.ts`.
  useEffect(() => installResumeWatch((trigger, hiddenForMs) => {
    const ws = wsRef.current;
    const socketState: SocketState =
      ws?.readyState === WebSocket.OPEN ? 'open'
        : ws?.readyState === WebSocket.CONNECTING ? 'connecting'
          : 'closed';
    const now = Date.now();
    if (!shouldResyncOnResume({
      trigger,
      // 통합 앱은 IPC 전송(`install-packaged-transport.ts`)이라 좀비가 되지 않는다.
      packaged: typeof window !== 'undefined' && window.api !== undefined,
      hiddenForMs,
      socketState,
      sinceLastResyncMs: now - lastResumeResyncAtRef.current,
    })) return;
    lastResumeResyncAtRef.current = now;
    reconnect();
  }), [reconnect]);

  // §9 — 이 창이 **지금 그리는 프로젝트**를 서버에 선언한다(모든 셸이 `activeProject` 를 든다). ⚠ 아직 없으면(첫 스냅샷 전) **선언하지 않는다** — 서버는 선언이 없으면 전부 보낸다. 성급한 `[]` 는 데이터를 끊는다.
  const activeProject = useGraphStore((s) => s.activeProject);
  // §9 폴더 스코프 — 이 창이 **지금 열어 둔 폴더의 내비 경로**. 서버는 이 경로의 폴더들과
  //   그 한 칸 앞(하위 폴더)만 `children`/`innerEdges`/폴더 위성에 싣는다.
  //   실측(살아 있는 checkpoint.json): 세 슬라이스 1,306,933 → 72,938 바이트(5.6%).
  const navStack = useGraphStore((s) => s.navStack);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  // §5.1 #2-1 (B) — 폴더 묶음 안이면 그 폴더도 지금 그리는 폴더다 — 그 `children` 이 와야 위성 상한으로 빠진 같은 종류 파일이 묶음 안에 선다.
  const bundleFolderId = useGraphStore((s) => (s.interiorView?.kind === 'bundle' ? s.interiorView.folderId ?? null : null));

  // §9 슬라이스 스코프 — 이 창이 **지금 읽는 슬라이스 묶음**(서버는 모든 창 선언의 합집합만 싣는다 — `sliceScope.ts` 함정 ①). 정의·근거는 `sliceScope.ts`, 여기선 화면이 켜져 있는지만.
  // ⚠ 구독은 **불리언 하나로** — `selectRenderedIDEPaneKeys(s)` 는 매번 새 배열이라 zustand v5 가 무한 리렌더한다.
  const ideLaneOpen = useGraphStore((s) => selectRenderedIDEPaneKeys(s).length > 0);
  //   플러그인은 IDE 레인과 **독립**이다 — `usePluginData` 의 슬롯이 캔버스 버블 배지와
  //   DetailPanel 섹션에 들어가므로, IDE 를 닫아도 켠 플러그인이 이 둘을 읽을 수 있다.
  const activePluginModules = useActivePluginModules();
  const pluginReadsAgentData = useMemo(() => {
    for (const m of activePluginModules) {
      for (const need of m.needs ?? []) {
        if (need === 'agentReports' || need === 'agentReviews') return true;
      }
    }
    return false;
  }, [activePluginModules]);
  const sliceGroupsKey = useMemo(() => {
    // 부르는 쪽이 독자를 코드로 확인해 직접 말한 창(내부 앱의 단독 창 등)은 그 선언을 그대로 쓴다.
    if (declaredSliceKey !== null) return declaredSliceKey;
    // 자기가 읽는 것을 확증하지 못한 창(별창·지휘통제실·내부 앱)은 **선언하지 않는다**
    //   — 판정과 근거는 `canDeclareSliceScope` 주석이 소유한다.
    if (!canDeclareSliceScope()) return null;
    const groups: SliceScopeGroup[] = [];
    if (ideLaneOpen) groups.push('ideLane');
    if (pluginReadsAgentData) groups.push('pluginAgentData');
    // 정렬해 둔다 — 선언 문자열이 순서 때문에 달라져 같은 상태를 두 번 보내지 않게.
    return groups.sort().join(',');
  }, [declaredSliceKey, ideLaneOpen, pluginReadsAgentData]);

  // 연결 상태를 스토어에도 실어 둔다 — 헤더 인디케이터만 알고 있으면 캔버스가 "끊겨서 비어 있는
  // 것"을 "불러오는 중"이라고 잘못 말한다. 값 하나를 두 화면이 같이 본다(설정은 여기 한 곳).
  useEffect(() => {
    useGraphStore.getState().setConnectionStatus(status);
  }, [status]);

  const declaredScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'connected') {
      declaredScopeRef.current = null; // 재연결하면 다시 선언해야 한다(서버 쪽 선언은 창과 함께 사라진다)
      return;
    }
    if (!activeProject) return;
    // 폴더 축은 프로젝트 축과 **한 선언에 함께** 실린다 — 드릴다운이 두 번 왕복하지 않게.
    // 폴더 밖(메인 뷰)이면 빈 배열이고, 그것도 유효한 선언이다("나는 지금 폴더 밖이다").
    const folders = currentFolderId ? [...navStack, currentFolderId] : [...navStack];
    if (bundleFolderId !== null && !folders.includes(bundleFolderId)) folders.push(bundleFolderId);
    // §9 슬라이스 축도 **같은 선언에 함께** 실린다(한 메시지 = 한 왕복). `null` 이면 이 창이
    //   슬라이스 축을 말할 수 없다는 뜻이라 필드 자체를 빼고 보낸다 — 그러면 서버가 전량으로
    //   되돌아간다(빈 배열 `[]` 은 "아무것도 안 읽는다"는 다른 뜻이므로 여기서 섞으면 안 된다).
    const slices = sliceGroupsKey === null
      ? undefined
      : sliceGroupsKey === '' ? [] : sliceGroupsKey.split(',');
    const declared = JSON.stringify([activeProject, folders, sliceGroupsKey]);
    if (declaredScopeRef.current === declared) return;
    declaredScopeRef.current = declared;
    send({
      type: 'set-project-scope',
      timestamp: Date.now(),
      payload: { projects: [activeProject], folders, ...(slices ? { slices } : {}) },
    });
  }, [status, activeProject, navStack, currentFolderId, bundleFolderId, sliceGroupsKey, send]);

  return { status, send, reconnect, getLastSnapshotAt };
}
