import express from 'express';
import cors from 'cors';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { exec, execFile } from 'node:child_process';
import multer from 'multer';
import { DEFAULT_PORT, SESSION_SCAN_INTERVAL, FILE_EXISTENCE_CHECK_INTERVAL, SATELLITE_TYPES, IFRAME_PROXY_PATH, AGENT_IDLE_THRESHOLD_MS, AGENT_IDLE_SWEEP_INTERVAL_MS, INTERRUPT_RECONCILE_INTERVAL_MS, TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT, TASK_EDGE_AUTO_REWORK_COMMAND_LABEL, SUPPORTED_UI_LOCALES, CONTI_AGENT_RULES, RULES_HISTORY_MAX, CANVAS_CLIPBOARD_SCHEMA_VERSION, buildAgentReportRules, buildAgentQuestionRules, buildAgentReviewRules, buildAgentListRules, buildAgentIframeRules, buildAgentFeedbackBlock, AGENT_FEEDBACK_SUMMARY_ITEM_MAX } from '@vibisual/shared';
import type { HookEventPayload, WSMessage, SubAgentStreamEvent, QueuedCommand, SessionTokenData, PipelineType, AgentConfig, TaskEdge, TaskEdgeForwardMode, TaskEdgeKind, TaskEdgeMessageFormat, TaskEdgeReturnFormat, TaskEdgePriority, TaskEdgeCritiqueTiming, TaskEdgeCritiqueAuthority, TaskEdgeCommandMode, SubAgentHistoryItem, UiLocale, PermissionDecision, RulesHistoryEntry, Conti, CanvasClipboardPayload, CanvasPasteResponse, AskUserQuestionDecision, AskUserQuestionAnswer, AskUserQuestionOption, AskUserQuestionItem, AskUserQuestionToolInput, AgentReport, AgentQuestions, AgentQuestionItem, AgentReview, AgentList, AgentFeedback, AgentFeedbackTargetType, AgentFeedbackVerdict } from '@vibisual/shared';
import { permissionBroker } from './services/permissionBroker.js';
import { askUserQuestionBroker } from './services/askUserQuestionBroker.js';
import { AutoAgentRuntime } from './services/autoAgentRuntime.js';
import { BUBBLE_COLORS, READ_TOOLS, WS_BATCH_INTERVAL } from '@vibisual/shared';
import { broadcast } from './broadcastBus.js';
import { graphManager } from './services/projectGraphManager.js';
import { modelRegistryService } from './services/modelRegistryService.js';
import { builtinCommandsService } from './services/builtinCommandsService.js';
import { userDefaultsService } from './services/userDefaultsService.js';
import { distillFeedbackToRules } from './services/feedbackDistillService.js';
import { isPortAlive, killByPort, respawn } from './services/processChecker.js';
import { discoverProjectMetas, migrateLegacy, migrateLegacySaveRootToProjectDirs, pruneOrphanWorktreeDirs, SaveScheduler, writeCheckpoint } from './services/statePersistence.js';
import { loadAppState, saveAppState, patchAppState, appStateAddOpenProject, appStateRemoveOpenProject, appStatePruneStaleProjectNames, appStateGetSkillOrder, appStateSetSkillOrder, appStateRemoveSkillFromOrder, appStateGetSkillFavorites, appStateSetSkillFavorites } from './services/appState.js';
import { ensureClaudeHooksInstalled } from './services/hookInstaller.js';
import { isAgentViewEnabled, reconcileOnBoot as agentViewReconcileOnBoot } from './services/claudeAgentViewService.js';
import { getClaudeVersionInfo, getClaudeInstallsInfo, installLatestClaude, getInflightInstall, invalidateLatestCache } from './services/claudeVersionService.js';
import { agentTracker } from './services/agentTracker.js';
import { discoverSessions, findPidBySession, isProcessAlive, readSessionTokenData, setLivenessProbeListener } from './services/sessionDiscovery.js';
import { SessionLifecycleManager } from './services/sessionLifecycle.js';
import { subAgentManager, recordCmdTermSession } from './services/subAgentManager.js';
import { reapOrphanedPidsFromPreviousRun } from './services/processTree.js';
import { validatePathWithinRoot } from './services/pathValidator.js';
import { openFile, openFileAtSearch, openFolder } from './services/editorLauncher.js';
import { iframeProxyHandler } from './services/iframeProxy.js';
import { gitStatusService, type WorktreeResolveInfo } from './services/gitStatusService.js';
import { generateContiFrames, patchContiElement, createEmptyConti, contiId, parseContiResponse, type ContiContextInput } from './services/contiManager.js';
import { logger } from './logger.js';
import { diagnosticService } from './services/diagnosticService.js';


// §3.7 — desktop in-process 진입점이 server 코어를 라이브러리로 쓰기 위한 re-export.
// `@vibisual/server` 단일 import 지점에서 코어 API를 모두 가져갈 수 있게 한다.
export { setBroadcastSink, broadcast, type BroadcastSink } from './broadcastBus.js';
export {
  handleClientMessage,
  buildConnectionMessages,
  shutdownIframeLogStreamer,
  shutdownServerLogService,
  type ClientConnection,
} from './websocket.js';
// desktop in-process 모드는 hook 전용 loopback 리스너 포트로 직접 훅을 설치한다.
export { ensureClaudeHooksInstalled } from './services/hookInstaller.js';
// §4 v1.98 — 진단 에러 로그: desktop main 이 자기 프로세스 에러를 recordDiagnostic 으로 적재.
export { recordDiagnostic, diagnosticService } from './services/diagnosticService.js';
// Persistent SubAgent child — desktop main 의 before-quit 핸들러가
// `subAgentManager.shutdownAllPersistentChildren()` 으로 long-lived claude 자식들을 깨끗이 종료.
export { subAgentManager, buildInteractiveClaudeArgs, prepareInteractiveRulesDir, recordCmdTermSession, getCmdResumeSession } from './services/subAgentManager.js';
// § 프로세스 트리 누수 — desktop 의 PTY(cmd.exe→claude) 종료 시 Windows 트리 전체를 회수하는 데 재사용.
export { killTree } from './services/processTree.js';
// §4 v2.63 — desktop main 의 임베디드 터미널 매니저가 인터랙티브 claude 를 스폰할 때
// 같은 바이너리(버전 체크/헤드리스 스폰과 동일 SSOT)를 쓰도록 경로 resolver 를 노출.
export { resolveClaudeBin } from './services/claudeBin.js';

// §3.7 v2.8 — hook loopback 리스너 포트. 통합(in-process) 모델에서 외부 `claude` 프로세스
// (hook curl·커스텀 위임 엣지 dispatch)가 in-process 서버에 닿는 유일한 네트워크 포트다.
// desktop main 이 startHookListener 직후 주입한다. 폐기된 서버-클라 모델엔 DEFAULT_PORT(4800)
// listen 소켓이 있었으나 in-process 모델에선 없어졌으므로, 위임 엣지 dispatch curl URL 은
// 반드시 이 리스너 포트를 써야 한다(`buildOutboundEdgesRulesSection` 참조).
let hookListenerPort: number | null = null;
export function setHookListenerPort(port: number): void {
  hookListenerPort = port;
}

// §5.3 #10-2 v2.47 — loopback 리스너 per-launch 토큰. desktop main 의 hookToken 을 주입받아
// 하네스 빌더 rules 의 구축 curl 헤더(x-vibisual-hook-token)에 실어 보낸다(§3.7 v2.47).
let hookListenerToken: string | null = null;
export function setHookListenerToken(token: string): void {
  hookListenerToken = token;
}

// §4 v2.71 — hook 신원 파일(hook-listener.json)의 절대 경로(forward-slash 정규화). desktop main 이
// 주입한다. 카드 엔드포인트(작업 신고/질문/검수) curl 이 dispatch 시점 상수가 아니라 "호출 시점"에
// 이 파일에서 현재 포트·토큰을 읽도록 빌더에 넘긴다 → 재기동으로 포트가 바뀐 뒤 resume 으로 도는
// 옛 세션도 live 서버로 닿아 카드를 "또 못 받는" 일이 사라진다. 미주입(서버 단독 모드) 시 상수 폴백.
let hookListenerIdentityFile: string | null = null;
export function setHookListenerIdentityFile(filePath: string): void {
  hookListenerIdentityFile = filePath;
}

export interface RunServerHandle { app: import('express').Express; }

export async function runServer(): Promise<RunServerHandle> {
  // 크래시(before-quit 미발동)로 지난 런의 claude 트리가 고아로 남았으면 부팅 시 회수(§ 프로세스 트리 누수).
  void reapOrphanedPidsFromPreviousRun();

  /** cwd에서 위로 올라가며 pnpm-workspace.yaml 있는 디렉토리 = 프로젝트 루트 */
  function findProjectRoot(start: string): string {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return start; // fallback
      dir = parent;
    }
  }

  /** Type guard — validates that an unknown value matches HookEventPayload shape */
  function isHookEventPayload(data: unknown): data is HookEventPayload {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj['session_id'] === 'string' &&
      typeof obj['hook_event_name'] === 'string'
    );
  }

  /** 도구 사용 이벤트인지 (PreToolUse / PostToolUse) */
  function isToolEvent(payload: HookEventPayload): boolean {
    return typeof payload.tool_name === 'string' &&
      typeof payload.tool_input === 'object' &&
      payload.tool_input !== null;
  }

  /**
   * §4 v1.49 — Notification 이벤트 서브타입 분류.
   *
   * Anthropic Agent SDK 2026-04~05 부터 `type` 필드(permission_prompt | idle_prompt |
   * auth_success | elicitation_dialog)가 명시적으로 들어오지만 구버전 페이로드는 `message`
   * 만 가질 수 있어 폴백 heuristic 으로 분류한다.
   *
   * - awaiting_permission: 도구 호출 권한 요청
   * - other:               분류 불가(또는 입력 대기) — 시각 상태 변경 없음
   *
   * v1.73 — `awaiting_input`(모래시계) 분류 제거. idle_prompt / 입력대기 메시지는 더 이상
   * 별도 시각 상태로 승격하지 않고 'other'(무시)로 떨군다. 데몬 단일-세션은 `--resume`
   * 으로 항상 이어지므로 "입력 대기" 모래시계가 오히려 연속성 끊김으로 보였다.
   */
  function classifyNotification(
    type: string | undefined,
    message: string | undefined,
  ): 'awaiting_permission' | 'other' {
    if (type === 'permission_prompt') return 'awaiting_permission';
    if (type === 'idle_prompt' || type === 'auth_success' || type === 'elicitation_dialog') return 'other';

    if (typeof message === 'string') {
      if (/permission|approve|allow/i.test(message)) return 'awaiting_permission';
    }
    return 'other';
  }

  /**
   * 3-Layer 세션 생명주기 매니저.
   * 정책: entrypoint(cli/vscode) 무관. 활성 판정은 OR 조건 —
   *   claude.exe가 매칭 PID로 실행 중이거나 세션 JSONL 파일이 잠겨 있으면 활성.
   *   둘 다 아니면 onDead로 즉시 제거. VSCode를 다시 열면 새 프로세스가 뜨고
   *   SessionStart 훅으로 재등록되므로 손실 없음.
   */
  const lifecycle = new SessionLifecycleManager({
    onDead: (sessionId) => {
      if (graphManager.removeAgentBySession(sessionId)) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    },
    onVSCodeClosed: (sessionId) => {
      // 현재 정책에서는 호출되지 않지만 콜백 시그니처 호환 유지.
      agentTracker.markForceStop(sessionId);
    },
    onMetaChange: () => {
      broadcastSnapshot();
    },
    listAgentSessionIds: () => graphManager.getSessionIds(),
  });
  graphManager.setLifecycleSnapshotProvider(() => ({
    sessionSources: lifecycle.getSourcesSnapshot(),
    sessionStatuses: lifecycle.getStatusesSnapshot(),
  }));
  graphManager.setGitDirtyProvider(() => gitStatusService.getDirtyMap());
  graphManager.setOnMutated(() => broadcastSnapshot());
  gitStatusService.setChangeListener(() => broadcastSnapshot());

  // §4 v2.38 — 모델 레지스트리 부팅 시 비동기 refresh (시드는 이미 적재됨).
  // 완료/실패 무관, listener 가 WS 푸시 담당.
  modelRegistryService.refreshIfStale().catch((err) => {
    logger.warn(`[modelRegistry] refresh error: ${err instanceof Error ? err.message : String(err)}`);
  });
  modelRegistryService.subscribe((reg) => {
    broadcast({ type: 'model_registry_updated', timestamp: Date.now(), payload: reg });
    // 시드 → api-merged 전환 시 snapshot 의 modelRegistry 도 갱신해야 하므로 그래프 한 번 푸시.
    broadcastSnapshot();
  });

  // §5.5 #17-2 v3.19 — CLI 내장 슬래시 명령 부팅 시 비동기 스캔(캐시 hit 면 즉시).
  // 결과는 /api/available-skills 응답의 builtins 로만 소비 — push 불필요.
  void builtinCommandsService.refreshIfStale();

  // §4 v2.42 — 사용자 옵션 갱신 broadcast (다른 창/탭 즉시 반영)
  userDefaultsService.subscribe((d) => {
    broadcast({ type: 'user_defaults_updated', timestamp: Date.now(), payload: d });
  });

  /** 프로세스 부팅 시각 — Debug 패널 "Restart Server"가 startedAt 증가로 재시작 여부 확인 */
  const SERVER_STARTED_AT = Date.now();

  const app = express();
  // iframe 프록시에서 본문을 재작성하므로 Express 자동 ETag 비활성화
  // (ETag가 남으면 브라우저가 304로 재작성 전 버전을 캐시 재사용할 수 있음)
  app.set('etag', false);
  // In-process IPC-only era: no external origin needs CORS — DNS-rebinding surface removed.
  app.use(cors({ origin: false }));

  // Iframe 프록시 — express.json() 보다 앞에 마운트 (raw body 전달 필요)
  app.use(IFRAME_PROXY_PATH, (req, res) => { void iframeProxyHandler(req, res); });

  app.use(express.json());
  // Task Edge dispatch raw-text 경로용 — instruction 원문을 손escape 없이 stdin 으로 받기 위함.
  // express.json() 은 application/json 만, express.text() 는 text/* 만 처리 → 상호 간섭 없음.
  // (JSON 본문은 후방호환 유지, 신규 호출은 raw text + ?edgeId= 사용 — heredoc escape 실패 원천 차단)
  app.use(express.text({ type: ['text/*'], limit: '8mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  /** GET /api/server-info — Debug 패널용 런타임 서버 신원.
   *  startedAt 이 증가했으면 재시작이 실제로 일어난 것. supportedLocales 는 메모리 상수 스냅샷. */
  app.get('/api/server-info', (_req, res) => {
    res.json({
      pid: process.pid,
      startedAt: SERVER_STARTED_AT,
      uptimeMs: Date.now() - SERVER_STARTED_AT,
      supportedLocales: [...SUPPORTED_UI_LOCALES],
      nodeVersion: process.version,
    });
  });

  // §4 v2.38 — 동적 모델 레지스트리 (시드 + /v1/models 머지 결과)
  app.get('/api/models', (_req, res) => {
    res.json(modelRegistryService.getRegistry());
  });

  // §4 v2.42 — 사용자 글로벌 옵션 (Options 창 SSOT)
  app.get('/api/user-defaults', (_req, res) => {
    res.json(userDefaultsService.get());
  });
  app.put('/api/user-defaults', async (req, res) => {
    try {
      const patch = req.body as Partial<import('@vibisual/shared').UserDefaults>;
      if (!patch || typeof patch !== 'object') {
        res.status(400).json({ ok: false, error: 'invalid body' });
        return;
      }
      const next = await userDefaultsService.update(patch);
      res.json({ ok: true, userDefaults: next });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put('/api/ui-locale', (req, res) => {
    const locale = (req.body as { locale?: string } | undefined)?.locale;
    if (!locale || !SUPPORTED_UI_LOCALES.includes(locale as UiLocale)) {
      res.status(400).json({ error: 'invalid locale', supported: SUPPORTED_UI_LOCALES });
      return;
    }
    const changed = graphManager.setUiLocale(locale as UiLocale);
    if (changed) broadcastSnapshot();
    res.json({ ok: true, uiLocale: locale });
  });


  // DEBUG: background shell 수동 rehydrate + 진단
  app.post('/api/debug/rehydrate-shells', (_req, res) => {
    const diag = graphManager.diagnoseBackgroundShells();
    graphManager.rehydrateAllBackgroundShells();
    broadcastSnapshot();
    saveCheckpoint();
    res.json(diag);
  });

  // DEBUG: 커스텀 에이전트 sub 의 contextUsed/contextMax 가 스냅샷에 실리는지 확인용
  app.get('/api/debug/subs', (_req, res) => {
    const snap = graphManager.getSnapshot();
    const out: Record<string, Array<{ id: string; label: string; status: string; sessionId: string; modelName?: string; contextUsed?: number; contextMax?: number; totalInputTokens?: number }>> = {};
    for (const [agentId, subs] of Object.entries(snap.subAgents)) {
      out[agentId] = subs.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        sessionId: s.sessionId,
        modelName: s.modelName,
        contextUsed: s.contextUsed,
        contextMax: s.contextMax,
        totalInputTokens: s.totalInputTokens,
      }));
    }
    const customAgents = snap.agents
      .filter((a) => a.customCreated)
      .map((a) => ({
        id: a.id,
        label: a.label,
        status: a.status,
        modelName: a.modelName,
        contextUsed: a.contextUsed,
        contextMax: a.contextMax,
        contextSourceSubLabel: a.contextSourceSubLabel,
      }));
    res.json({ customAgents, subAgents: out });
  });

  // DEBUG: 스냅샷 조회 (디버깅용)
  app.get('/api/debug/snapshot', (_req, res) => {
    const snap = graphManager.getSnapshot();
    const satelliteKeys = Object.keys(snap.satellites);
    const satelliteSummary: Record<string, { count: number; types: string[] }> = {};
    for (const [k, v] of Object.entries(snap.satellites)) {
      satelliteSummary[k] = { count: v.length, types: v.map((b) => b.bubbleType) };
    }
    // iframe 노드를 직접 찾기 (디버깅)
    const iframeNodes: Record<string, unknown>[] = [];
    for (const [, v] of Object.entries(snap.satellites)) {
      for (const b of v) {
        if (b.bubbleType === 'iframe') iframeNodes.push({ id: b.id, label: b.label, url: b.url, serverKind: b.serverKind });
      }
    }

    res.json({
      agentCount: snap.agents.length,
      activeAgents: snap.agents.filter((a) => a.status === 'active').map((a) => ({
        id: a.id, label: a.label, status: a.status,
        project: snap.agentProjects[a.id],
        hasSatellites: !!satelliteSummary[a.id],
      })),
      satelliteKeys,
      satelliteSummary,
      iframeNodes,
      satelliteTypesHasIframe: SATELLITE_TYPES.has('iframe'),
    });
  });

  app.post('/api/session-start', (req, res) => {
    try {
      const body = req.body as {
        sessionId?: unknown;
        pid?: unknown;
        cwd?: unknown;
      };
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      const cwd = typeof body.cwd === 'string' ? body.cwd : null;
      const pid = typeof body.pid === 'number' ? body.pid : null;
      if (!sessionId || !cwd) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }
      // v1.77 (Direction A) — Vibisual 이 스폰한 sub(커스텀 에이전트 워커 등)의 SessionStart 는
      // 독립 훅 에이전트 버블로 등록하지 않는다. 그 세션의 활동은 명령 흐름을 통해 부모
      // 커스텀 버블에 귀속된다. 이 가드가 없으면 워커 세션이 "Continue from where you left.."
      // 훅 버블로 증식한다(사용자 보고 증상). 사용자 인터랙티브 세션은 managed 가 아니라 영향 없음.
      if (subAgentManager.isManagedSession(sessionId)) {
        res.json({ ok: true, managed: true, restored: 0 });
        return;
      }
      lifecycle.registerFromHook({ sessionId, pid, cwd });
      // AppState: hook 으로 처음 감지된 프로젝트도 openProjects 에 추가되도록 보장.
      // registerProject 는 idempotent — 이미 있으면 기존 인스턴스 반환, 새로 만들면 appStateAddOpenProject 트리거.
      // 이전엔 tool 이벤트(/api/hook-event) 가 오기 전까지 appState 에 기록되지 않아, SessionStart 만 발생하고 서버 재시작 시 사라지는 문제가 있었음.
      try { graphManager.registerProject(cwd); } catch (err) {
        logger.warn(`session-start: registerProject("${cwd}") failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // v1.6 SCENARIO §5.7 #24: VSCode 재오픈 시 같은 cwd로 잠들어있던 에이전트 복원.
      const restored = graphManager.restoreDormantForCwd(cwd);
      if (restored.length > 0) {
        logger.info(
          `SessionStart: restored ${restored.length} dormant agent(s) for cwd ${cwd} ` +
          `(sessions: ${restored.map((s) => s.slice(0, 8)).join(',')})`,
        );
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, restored: restored.length });
    } catch (err) {
      logger.error('POST /api/session-start failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hook-event', (req, res) => {
    try {
      const body: unknown = req.body;

      if (!isHookEventPayload(body)) {
        logger.warn('Invalid hook event payload received');
        res.status(400).json({ error: 'Invalid HookEventPayload', continue: true });
        return;
      }

      // §4 v2.64 — CMD(인터랙티브 터미널) 소유자 태그면 상태/그래프 귀속을 그 CMD 버블 세션으로
      //   일원화한다. 이후 markActive/markStop·Notification·processHookEvent 가 모두 CMD 버블을
      //   가리켜 별개 Hook 버블/오완료(recompute) 대신 Hook 에이전트와 동일한 라이프사이클
      //   (tool→active, Stop→completed→idle)을 탄다. lifecycle 만은 OS 세션 liveness 추적이라
      //   claude 원본 session(아래 claudeSessionId)을 그대로 쓴다(합성 custom 세션 미주입).
      const claudeSessionId = body.session_id;
      if (body._vibisualOwnerAgentId) {
        const ownerSession = graphManager.findSessionByAgentId(body._vibisualOwnerAgentId);
        if (ownerSession) body.session_id = ownerSession;
      }

      // §4 v2.64 — CMD 터미널 연속성: 이 인터랙티브 claude 대화의 sessionId(rewrite 전 원본)를
      //   termId 별로 기록해 둔다. 앱을 완전히 종료하면 PTY 는 죽지만, 재시작 후 같은 termId 로
      //   터미널을 다시 열 때 terminalManager 가 이 값으로 `claude --resume <id>` 를 prefill 한다.
      if (body._vibisualOwnerTermId && claudeSessionId) {
        recordCmdTermSession(body._vibisualOwnerTermId, claudeSessionId);
        // §4 — CMD 세션 탭(sub) 도트 연속 동기화: tool 이벤트→active, Stop→idle(녹색).
        //   termId 끝 토큰이 곧 sub.id 라 그 탭만 정확히 구동한다(부모 버블은 위 markActive/markStop 담당).
        const subChanged = subAgentManager.markCmdSubActivity(
          body._vibisualOwnerTermId,
          body.hook_event_name === 'Stop',
        );
        if (subChanged) broadcastSnapshot();
      }

      // Stop → 즉시 completed, 그 외 → active
      if (body.hook_event_name === 'Stop') {
        agentTracker.markStop(body.session_id);
      } else {
        agentTracker.markActive(body.session_id);
      }

      // sessionLifecycle에 활동 신호 전파 (PID는 여기서 알 수 없으므로 null)
      if (claudeSessionId && body.cwd) {
        lifecycle.registerFromToolUse(claudeSessionId, body.cwd, null);
      }

      // §4 v1.49 — Notification 서브타입 → 버블 시각 신호.
      // SDK 신규 `type` 필드 우선, 누락 시 message heuristic 폴백.
      // permission 차단 자체는 v1.43 PreToolUse 경로가 담당하므로 본 분기는 시각화 전용.
      if (body.hook_event_name === 'Notification') {
        const subtype = classifyNotification(body.type, body.message);
        if (subtype === 'awaiting_permission') {
          graphManager.setAgentNotificationStatus(body.session_id, subtype);
          broadcastSnapshot();
        }
      }

      // §4 v1.50 — PostToolUse `duration_ms` 캡처 (Anthropic SDK 2026-04 신규 필드).
      if (
        body.hook_event_name === 'PostToolUse'
        && typeof body.tool_name === 'string'
        && typeof body.duration_ms === 'number'
      ) {
        graphManager.recordToolDuration(body.session_id, body.tool_name, body.duration_ms);
        // broadcast 는 도구 이벤트 처리부에서 이미 일어나므로 별도 호출 불필요.
      }

      // §4 v1.50 — PreCompact 카운터 증가.
      if (body.hook_event_name === 'PreCompact') {
        graphManager.recordCompact(body.session_id);
        broadcastSnapshot();
        saveCheckpoint(); // compactCounts 는 영속화 대상
      }

      // 도구 사용 이벤트만 그래프 처리 (Notification/Stop은 상태 전환만)
      if (isToolEvent(body)) {
        const result = graphManager.processHookEvent(body);

        // PostToolUse Bash 후 파일 존재 확인 (삭제/rename 즉시 감지)
        if (body.hook_event_name === 'PostToolUse' && body.tool_name === 'Bash') {
          const ghosted = graphManager.checkFileExistence();
          const pruned = graphManager.pruneDisappearing();
          if (ghosted > 0 || pruned > 0 || result) {
            broadcastSnapshot();
            saveCheckpoint();
          } else if (result) {
            broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
            saveCheckpoint();
          }
        } else if (result) {
          broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
          saveCheckpoint();
        } else {
          saveCheckpoint();
        }
      }
      res.json({ continue: true });
    } catch (err) {
      logger.error('POST /api/hook-event failed', err);
      res.status(500).json({ error: 'Internal server error', continue: true });
    }
  });

  /**
   * §4 v1.50 — Claude.ai 한도 사용률 푸시.
   * 외부 statusline 스크립트(또는 사용자 자체 도구)가 5h/7d 윈도우 사용률을 보고한다.
   * 한도는 사용자 단위라 프로젝트 무관 글로벌 1건만 보관.
   *
   * Body: { used5h?: number; resetAt5h?: number; used7d?: number; resetAt7d?: number }
   *  - used5h / used7d: 0~1 (사용률) 또는 0~100 (퍼센트). 클라이언트가 표시 시점에 정규화.
   *  - resetAt*: 한도 리셋 epoch ms.
   */
  app.post('/api/rate-limits', (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Body required' });
        return;
      }
      const payload: Record<string, number> = {};
      for (const key of ['used5h', 'resetAt5h', 'used7d', 'resetAt7d'] as const) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) payload[key] = v;
      }
      if (Object.keys(payload).length === 0) {
        res.status(400).json({ error: 'No valid fields' });
        return;
      }
      graphManager.setRateLimits(payload);
      broadcastSnapshot();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/rate-limits failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/refresh-servers', async (_req, res) => {
    try {
      const servers = graphManager.getRunningServers();
      await Promise.all(
        servers.map(async (s) => {
          s.alive = s.port ? await isPortAlive(s.port) : false;
        }),
      );
      // §7.11 v2.4 — 죽은 ServerEntry 를 즉시 제거하지 않는다. iframe 위성이 살아 있는
      // 동안(고정핀 / grace 이내) 매칭 entry 가 남아야 IframeServerCard 의 Start/Restart
      // 가 동작한다. 정리는 위성 grace 제거(checkIframesAlive)가 위성과 함께 수행.
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/refresh-servers failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/stop-server', async (req, res) => {
    try {
      const { id } = req.body as { id?: string };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'id required' });
        return;
      }
      const servers = graphManager.getRunningServers();
      const target = servers.find((s) => s.id === id);
      if (!target || !target.port) {
        target && (target.alive = false);
        if (target) graphManager.markIframeStoppedByServerId(id);
        broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
        res.json({ killed: false, servers: graphManager.getRunningServers() });
        return;
      }
      const killed = await killByPort(target.port);
      target.alive = false;
      // §7.11 v1.29 — 매칭 iframe 위성 iframeAlive=false 즉시 반영 (5초 스윕 대기 없이 active→idle 전환)
      graphManager.markIframeStoppedByServerId(id);
      // §7.11 v2.4 — removeDeadServers 제거: 죽은 entry 는 iframe 위성(고정핀/grace)이
      // 살아 있는 한 보존해야 Start/Restart 버튼의 serverId 매칭이 동작한다.
      logger.info(`Stop server port=${target.port} killed=${killed}`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ killed, servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/stop-server failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/restart-server', async (req, res) => {
    try {
      const { id } = req.body as { id?: string };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'id required' });
        return;
      }
      const servers = graphManager.getRunningServers();
      const target = servers.find((s) => s.id === id);
      if (!target) {
        res.status(404).json({ error: 'server not found' });
        return;
      }
      // kill
      if (target.port) await killByPort(target.port);
      // §7.11 v2.22 — owning session 의 cwd 로 respawn. 누락 시 명령이 의존하는 파일/스크립트
      // (`node my-server.js` 등)을 못 찾고 즉시 종료된다. windowsHide 는 respawn 내부에서 처리.
      const owner = graphManager.findServerOwnerSession(id);
      respawn(target.command, owner?.cwd);
      target.startedAt = Date.now();
      target.alive = true;
      // §7.11 v2.23 — respawn 직후 매칭 iframe 위성의 owning-shell 분리. Vibisual detached child 는
      // Claude JSONL 에 active 로 기록 안 돼 v1.48 검사가 영원히 false → 포트가 살아도 idle 고정.
      graphManager.noteIframeRespawnedByServerId(id);
      logger.info(`Restart server port=${target.port ?? '?'} cwd="${owner?.cwd ?? '(default)'}" cmd="${target.command}"`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();

      // §7.11 v2.22 — 5초 정기 sweep 외에 빠른 수렴: 0.5s / 1.5s / 3s 에 추가 probe.
      // respawn 된 서버가 부팅해 listen 시점이 임의 (Vite ~1s, python http.server 즉시,
      // node 무거운 의존성 2-3s) 인 점 cover. fire-and-forget — 응답 지연 방지.
      for (const delayMs of [500, 1500, 3000]) {
        setTimeout(() => {
          void graphManager.checkIframesAlive().then((changed) => {
            if (changed) broadcastSnapshot();
          });
        }, delayMs);
      }

      res.json({ servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/restart-server failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * 열기 계열 엔드포인트 공용 경계 검사 — resolved 절대경로가 등록된 프로젝트 루트(또는
   * extraRoots 로 명시 허용한 디렉토리) 내부인지 확인한다. 로컬 IPC(renderer)는 신뢰되지만,
   * opt-in 모바일 리스너로 페어링된 기기도 이 라우트에 도달하므로 임의 절대경로가 에디터·
   * 탐색기로 열리는 것을 막기 위한 방어선이다(§ open-in-editor 의 기존 가드를 형제 라우트에 통일).
   * Windows 는 대소문자 무시 비교.
   */
  function isWithinOpenableRoots(resolved: string, extraRoots: string[] = []): boolean {
    const roots: string[] = [];
    for (const r of extraRoots) roots.push(path.resolve(r));
    const primaryRoot = graphManager.getRoot();
    if (primaryRoot) roots.push(path.resolve(primaryRoot));
    for (const proj of Object.values(graphManager.getProjects())) {
      roots.push(path.resolve(proj.path));
    }
    const isWin = process.platform === 'win32';
    const rLower = isWin ? resolved.toLowerCase() : resolved;
    return roots.some((r) => {
      const rootLower = isWin ? r.toLowerCase() : r;
      return rLower === rootLower || rLower.startsWith(rootLower + path.sep);
    });
  }

  /** POST /api/open-in-editor — 절대 경로 + searchText로 에디터에서 열기 */
  app.post('/api/open-in-editor', (req, res) => {
    try {
      const { filePath, searchText } = req.body as { filePath?: string; searchText?: string };
      if (typeof filePath !== 'string') {
        res.status(400).json({ error: 'filePath required' });
        return;
      }

      // 절대경로 정규화 후 프로젝트 루트 내부인지 확인 (Windows 대소문자 무시)
      const resolved = path.resolve(filePath);
      if (!isWithinOpenableRoots(resolved)) {
        logger.warn(`Path traversal blocked: filePath="${filePath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFileAtSearch(resolved, searchText);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`POST /api/open-in-editor failed: ${msg}`, err);
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/open-node-file — 노드 키로 파일 열기 (에디터).
   *  client가 absolutePath를 함께 보내면 그걸 우선 사용 — 프로젝트 컨텍스트 소실로 타 프로젝트 파일이 열리는 것 방지. */
  app.post('/api/open-node-file', (req, res) => {
    try {
      const { nodePath, absolutePath } = req.body as { nodePath?: string; absolutePath?: string | null };
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath required' });
        return;
      }
      const absPath = (typeof absolutePath === 'string' && absolutePath.length > 0)
        ? absolutePath
        : graphManager.resolveAbsolutePath(nodePath);
      if (!absPath) {
        res.status(404).json({ error: 'Cannot resolve absolute path' });
        return;
      }

      // client 가 준 absolutePath 는 프로젝트 루트 내부인 것만 허용(임의 파일 열기 차단).
      const resolved = path.resolve(absPath);
      if (!isWithinOpenableRoots(resolved)) {
        logger.warn(`open-node-file blocked (outside project root): "${absPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFile(resolved);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-node-file failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/open-node-folder — 노드 키로 상위 폴더 열기 (탐색기).
   *  client가 absolutePath를 함께 보내면 그걸 우선 사용 (프로젝트 컨텍스트 보존). */
  app.post('/api/open-node-folder', (req, res) => {
    try {
      const { nodePath, absolutePath } = req.body as { nodePath?: string; absolutePath?: string | null };
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath required' });
        return;
      }
      const absPath = (typeof absolutePath === 'string' && absolutePath.length > 0)
        ? absolutePath
        : graphManager.resolveAbsolutePath(nodePath);
      if (!absPath) {
        res.status(404).json({ error: 'Cannot resolve absolute path' });
        return;
      }

      // client 가 준 absolutePath 는 프로젝트 루트 내부인 것만 허용(임의 폴더 열기 차단).
      const resolved = path.resolve(absPath);
      if (!isWithinOpenableRoots(resolved)) {
        logger.warn(`open-node-folder blocked (outside project root): "${absPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFolder(resolved);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-node-folder failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 명령 대기열 API ───

  /** sessionId → 대기 명령 배열 (queued/executing만) */
  const commandQueues = new Map<string, QueuedCommand[]>();

  /** sessionId → 완료/에러 명령 아카이브 (Results 표시용) */
  const completedCommandArchive = new Map<string, QueuedCommand[]>();

  /** sessionId → 최근 pop된 명령 메타 (buildAgentEvents에서 source 매칭용) */
  interface PoppedCommand { text: string; queuedAt: number; poppedAt: number }
  const poppedCommands = new Map<string, PoppedCommand[]>();

  /** DEBUG: heartbeat 상태 확인 */
  app.get('/api/debug/heartbeat', (_req, res) => {
    const sessions = graphManager.getSessionIds();
    const result = sessions.map((sid) => {
      const agent = graphManager.getAgentBySession(sid);
      const queue = commandQueues.get(sid) ?? [];
      return {
        sessionId: sid,
        agentId: agent?.id,
        status: agent?.status,
        queueSize: queue.length,
        queueItems: queue.map((c) => c.text),
      };
    });
    res.json({ sessions: result, totalQueues: [...commandQueues.keys()] });
  });

  // ─── SubAgent 명령 실행 ───

  /** v1.38 — 엣지의 타겟이 실제로 위임 수행이 가능한지 판정.
   *  명시적으로 저장된 `AgentConfig.tools === []` 는 "모든 도구 제거" → skip 대상.
   *  cfg 자체가 undefined(한 번도 저장 안 됨)이면 CLI 기본 툴셋 상속이라 skip 아님. */
  function isEdgeTargetViable(edgeTargetAgentId: string): boolean {
    const cfg = graphManager.getAgentConfig(edgeTargetAgentId);
    if (cfg && cfg.tools.length === 0) return false;
    return true;
  }

  /** v1.33 — outbound Task Edge 자동 rules 섹션. subagent 스폰 직전에 호출되어 런타임 조회로
   *  해당 agent 의 primary(outbound) 엣지 목록을 markdown 블록으로 조립. 엣지 0개면 빈 문자열.
   *  엣지 변경은 이 함수가 다음 호출에서 자동 반영 — 별도 파일/cleanup 불필요.
   *  v1.38 — 타겟 도구가 빈 배열인 엣지는 viability 필터로 제외(프롬프트 정책 소실 == 삭제와 동등). */
  function buildOutboundEdgesRulesSection(agentId: string): string {
    const allOutbound = graphManager.getOutboundTaskEdges(agentId);
    const outbound = allOutbound.filter((e) => isEdgeTargetViable(e.targetAgentId));
    if (outbound.length === 0) return '';
    const allAgents = graphManager.getSnapshot().agents;
    // §3.7 v2.8 — dispatch curl 은 소스 커스텀 에이전트(외부 `claude` 프로세스)가 실행한다.
    // 외부 프로세스는 renderer↔server IPC 를 못 쓰므로 in-process 서버에 닿으려면 hook
    // loopback 리스너를 거쳐야 한다. 폐기된 서버-클라 모델의 DEFAULT_PORT(4800)를 쓰면
    // listen 소켓이 없어 connection refused — desktop main 이 setHookListenerPort()로
    // 주입한 동적 포트를 쓴다. (미주입 시 port 폴백 — 통합 모델에선 부팅 시 항상 주입됨.)
    const serverBase = `http://127.0.0.1:${hookListenerPort ?? port}`;

    // v1.33 — 엣지별 policy. 같은 소스라도 엣지마다 다른 policy 가능. 엣지 목록에 각각 Policy 태그 표시.
    const lines: string[] = [
      '',
      '',
      '# 연결된 위임 엣지 (자동)',
      '',
      '각 엣지마다 **Policy** 가 독립 설정됩니다:',
      '- **STRICT**: 이 엣지의 "용도" 와 매칭되는 작업은 **반드시 이 엣지로 위임**. 소스가 자체 Read/Grep/Glob 등으로 처리 **금지**. 예외는 타겟에 없는 도구(예: Write)가 꼭 필요한 경우만.',
      '- **AUTO**: 이 엣지는 **소스 판단 시 위임**. 탐색 3회+ 예상 / 용도 명확 매칭 / 더 적합한 타겟 모델일 때만. 간단 1~2회 Read 는 자체 처리 허용.',
      '',
      '## 호출 프로토콜 (전 언어 공통 — Bash heredoc, 파일 금지)',
      'instruction **원문을 그대로** heredoc 본문에 넣어 stdin 으로 보낸다. **JSON 손조립·escape 일절 없음** — `edgeId` 는 URL 쿼리로, instruction 은 raw 본문 전체로 서버가 받는다. 한글·일본어·중국어·아랍어·이모지·싱글쿼트·백슬래시·따옴표·여러 줄 전부 escape 없이 안전. **절대 파일로 쓰지 말 것** — `.tmp-*` 등 임시 파일 생성·`Write` 후 `--data @file` 우회 금지. heredoc stdin 만 사용(동시 dispatch 시 디스크 레이스 없음).',
      '',
      '```bash',
      `curl -s -X POST '${serverBase}/api/task-edges/dispatch?edgeId=<id>' \\`,
      '  -H \'Content-Type: text/plain; charset=utf-8\' \\',
      '  --data-binary @- <<\'VIBISUAL_EDGE_PAYLOAD_EOF\'',
      '<instruction 전문 — 그대로 붙여넣기, JSON·쉘 escape 불필요, 여러 줄 OK>',
      'VIBISUAL_EDGE_PAYLOAD_EOF',
      '```',
      '',
      '주의: `<id>` 자리에 아래 목록의 edgeId 를 그대로 넣는다(URL-safe, 인코딩 불필요). delimiter 는 싱글쿼트로 감싼 `<<\'VIBISUAL_EDGE_PAYLOAD_EOF\'` 형태 유지(쉘 변수·백틱 치환 차단). instruction 본문에 `VIBISUAL_EDGE_PAYLOAD_EOF` 가 한 줄로 등장할 가능성이 있으면 delimiter 만 다른 이름으로 변경. (기존 `{"edgeId":..,"instruction":..}` JSON 본문 방식도 서버가 후방호환 수용하지만, 신규 호출은 escape 불가능한 위 raw 방식만 쓴다.)',
      '',
      '## 엣지 목록',
    ];
    for (const edge of outbound) {
      const target = allAgents.find((a) => a.id === edge.targetAgentId);
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const targetLabel = target?.label ?? edge.targetAgentId;
      const modelStr = cfg?.model ?? 'unknown';
      const toolsStr = cfg?.tools && cfg.tools.length > 0 ? cfg.tools.join(', ') : 'default';
      const returnFmt = edge.returnFormat ?? 'summary';
      const policy = edge.delegationPolicy ?? 'strict';
      const policyBadge = policy === 'strict' ? '**[Policy=STRICT — 의무 위임]**' : '**[Policy=AUTO — 판단 위임]**';
      // v1.44 — commandMode (kind='command' 한정) 안내. mode-delegation 의 경우 LLM 이 도구는 가지고 있어도
      //         "이 작업은 반드시 위임" 임을 인지하도록 명시. tool-delegation 은 strip 으로 자연 강제되지만
      //         프롬프트에도 표시해 일관성 유지.
      const kind = edge.kind ?? 'command';
      const cmdMode = kind === 'command' ? (edge.commandMode ?? (policy === 'strict' ? 'tool-delegation' : 'shared')) : null;
      const cmdModeBadge = cmdMode === 'tool-delegation'
        ? '**[Mode=TOOL-DELEGATION — 부모에서 도구 박탈됨, dispatch 만 가능]**'
        : cmdMode === 'mode-delegation'
          ? '**[Mode=MODE-DELEGATION — 도구는 공유되지만 이 작업은 반드시 위임할 것]**'
          : cmdMode === 'shared'
            ? '**[Mode=SHARED — 자체 처리 또는 위임 자유]**'
            : '';
      const artifact = graphManager.getBundleArtifact(edge.id);
      const waitNote = artifact
        ? '결과를 기다려 반환받습니다 (동기).'
        : '즉시 dispatched 로만 반환되고 결과는 따로 전달되지 않습니다 (비동기).';
      lines.push(`- **→ ${targetLabel}** ${policyBadge}${cmdModeBadge ? ' ' + cmdModeBadge : ''} (model: ${modelStr}, tools: ${toolsStr})`);
      lines.push(`  - 용도: ${edge.command || '(미기재)'}`);
      lines.push(`  - returnFormat: ${returnFmt} — ${waitNote}`);
      // v1.48 — messageSchema 가 비어있지 않으면 발신 본문(instruction) 포맷을 강제. messageFormat='free' 거나 빈 값이면 생략.
      if (edge.messageFormat === 'schema' && edge.messageSchema && edge.messageSchema.trim().length > 0) {
        lines.push(`  - **메시지 스키마 (필수)**: 이 엣지로 보낼 때 \`instruction\` 본문은 아래 양식을 따르세요:`);
        lines.push('    ```');
        for (const sline of edge.messageSchema.split('\n')) lines.push(`    ${sline}`);
        lines.push('    ```');
      }
      lines.push(`  - edgeId: \`${edge.id}\``);
    }
    return lines.join('\n');
  }

  /** v1.37 — STRICT outbound 엣지 기반 tools strip set 계산.
   *  - outbound 중 박탈 모드인 엣지의 각 타겟 agentConfig.tools 를 합집합
   *  - 엣지 삭제/모드 전환 시 다음 호출에서 자동 축소/소멸 (매 턴 재계산)
   *  - 박탈 모드가 아닌 엣지는 도구 변경 없음 (프롬프트 권고만)
   *  - 툴 구성은 사용자 책임 (Bash 포함 특수 보호 없음).
   *  v1.38 — 타겟 tools 가 빈 배열인 엣지는 viability 필터로 skip.
   *  v1.44 — `commandMode` 도입. 박탈 조건을 `delegationPolicy === 'strict'` 단일 축에서
   *          `commandMode === 'tool-delegation'` 으로 이동. 후방호환:
   *          - kind !== 'command' (artifact/request/critique): 박탈 ❌
   *          - commandMode === 'tool-delegation': 박탈 ✅
   *          - commandMode === 'shared' | 'mode-delegation': 박탈 ❌
   *          - commandMode === undefined (기존 엣지): delegationPolicy === 'strict' 일 때만 박탈
   *            (= v1.37~v1.43 거동 그대로 보존). 신규 엣지는 기본 'shared' 라 박탈 안 됨. */
  function computeStrictStripSet(agentId: string): Set<string> {
    const outbound = graphManager.getOutboundTaskEdges(agentId);
    const stripping = outbound.filter((e) => {
      if (!isEdgeTargetViable(e.targetAgentId)) return false;
      if ((e.kind ?? 'command') !== 'command') return false;
      if (e.commandMode !== undefined) return e.commandMode === 'tool-delegation';
      // Legacy fallback: undefined commandMode + strict policy = pre-v1.44 strip behavior.
      return (e.delegationPolicy ?? 'strict') === 'strict';
    });
    if (stripping.length === 0) return new Set();
    const strip = new Set<string>();
    for (const edge of stripping) {
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const tools = cfg?.tools ?? [];
      for (const t of tools) strip.add(t);
    }
    return strip;
  }

  /** 큐에서 dispatch 가능한 명령을 전부 실행.
   *  동일 subAgentId는 직렬(한 세션당 한 명령), 서로 다른 subAgentId끼리는 병렬로 시작.
   *  null subAgentId는 하나의 슬롯으로 묶어 기존 직렬 동작 유지. */
  function processNextCommand(sessionId: string): void {
    const queue = commandQueues.get(sessionId);
    if (!queue) return;

    const agent = graphManager.getAgentBySession(sessionId);
    if (!agent) return;

    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) return;

    const agentConfig = graphManager.getAgentConfig(agent.id);
    const userRulesBlock = agentConfig?.rules?.trim()
      ? `\n\n# Agent Rules\n${agentConfig.rules.trim()}`
      : '';
    // v1.33 — outbound 엣지 자동 섹션.
    const edgesBlock = buildOutboundEdgesRulesSection(agent.id);
    // §4 v3.21 — 사용자 피드백 다이제스트(# Past User Feedback) — 좋아요/싫어요 즉효 되먹임.
    //   매 턴 재계산이라 새 평가가 다음 턴에 바로 반영되고, 평가 철회 시 자동 소거.
    const feedbackBlock = buildAgentFeedbackBlock(graphManager.getAgentFeedbacksForAgent(agent.id));
    const rulesBlock = userRulesBlock + edgesBlock + feedbackBlock;
    const skillsPrefix = (agentConfig?.skills && agentConfig.skills.length > 0)
      ? agentConfig.skills.map((s) => `/${s}`).join('\n') + '\n\n'
      : '';
    const contextSummary = `${skillsPrefix}You are a sub-agent working in project at: ${cwd}\nParent agent: ${agent.label}${rulesBlock}\n\nExecute the following task.`;

    // v1.37 — STRICT outbound 엣지가 있으면 타겟이 가진 도구를 소스 allowedTools 에서 박탈.
    // 매 턴 재계산이라 엣지 삭제·AUTO 전환 시 다음 턴에 자동 복귀 — 별도 cleanup 불필요.
    // Bash 포함 모든 툴이 strip 대상 — 구성은 사용자 책임.
    const stripSet = computeStrictStripSet(agent.id);
    const effectiveConfig = (agentConfig && stripSet.size > 0)
      ? { ...agentConfig, tools: agentConfig.tools.filter((t) => !stripSet.has(t)) }
      : agentConfig;

    // 이미 executing 중인 subAgentId들 — 이 슬롯은 점유 중
    const busy = new Set<string | null>();
    for (const c of queue) {
      if (c.status === 'executing') busy.add(c.subAgentId);
    }

    let dispatched = false;
    for (const next of queue) {
      if (next.status !== 'queued') continue;
      if (busy.has(next.subAgentId)) continue;
      busy.add(next.subAgentId); // 같은 sub에 두 개 동시 dispatch 금지
      // §4 v2.52 — 커스텀/스폰 에이전트에만 "작업 신고" 지시문 주입(Hook 에이전트 제외 = 하이브리드 경계).
      //   하네스 빌더와 동일 인프라(토큰 인증 loopback)로 did/userActions 를 POST /api/agent-report 신고 →
      //   IDE 가 색 구분 카드 렌더. agentId=부모 버블, subAgentId=이 세션(탭) 키로 baked.
      let dispatchContext = contextSummary;
      if (agent.customCreated) {
        const ruleArgs = {
          serverBase: `http://127.0.0.1:${hookListenerPort ?? port}`,
          serverToken: hookListenerToken ?? '',
          agentId: agent.id,
          // v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 위 상수 폴백).
          ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
          ...(next.subAgentId ? { subAgentId: next.subAgentId } : {}),
        };
        // §4 v2.52 작업 신고 + v2.60 질문 카드 + v2.70 검수 요청 + v2.84 번호 목록 + §7.11 v2.29 서버 iframe 신고 지시문을 함께 주입(동일 loopback 인프라).
        dispatchContext = contextSummary + buildAgentReportRules(ruleArgs) + buildAgentQuestionRules(ruleArgs) + buildAgentReviewRules(ruleArgs) + buildAgentListRules(ruleArgs) + buildAgentIframeRules(ruleArgs);
      }
      // v1.33 — edgesBlock 을 separately 전달해 resume(--resume) 경로에서도 매 턴 prepend.
      //         엣지가 생기거나 바뀌었을 때 세션 재시작 없이도 즉시 인지하도록.
      // v1.77 (Direction A) — 커스텀 에이전트면 customParent=true → execute 가 --bg 우회, legacy 고정.
      subAgentManager.execute(next, cwd, dispatchContext, effectiveConfig, edgesBlock, { customParent: !!agent.customCreated });
      dispatched = true;
    }

    if (dispatched) broadcastSnapshot();
  }

  // §9 — graph_snapshot 16ms trailing 디바운스. 커스텀 에이전트 다중 실행 시 매 mutation
  // (setOnMutated)마다 풀 getSnapshot()+broadcast 하던 것을 16ms 창 1회로 합친다.
  // 30+ 호출 사이트는 그대로 — 본체만 큐잉. flush 시점에 getSnapshot()을 읽으므로
  // 창 안의 모든 변경이 최신 상태로 반영(스케줄 시점 캡처 ❌ → 누락 0).
  // 인라인 직송 broadcast({type:'graph_snapshot'...}) 13곳은 즉시 송신이지만, trailing 이
  // 그 뒤에 떠도 최신 상태를 다시 읽어 보내므로 stale 덮어쓰기 없음.
  let snapshotBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  // [perf-snapshot] 계측 — VIBISUAL_PERF=1 일 때만. 서버는 Electron 메인 프로세스에서 돌므로
  // getSnapshot()+직렬화 비용이 그대로 창 입력 스레드를 잡는다. 전수조사 다중 세션에서 이 값이
  // 프레임 예산(16ms)을 잡아먹는지 확인하기 위한 임시 계측(델타/utilityProcess 착수 전 범인 확정용).
  const PERF_SNAPSHOT = process.env.VIBISUAL_PERF === '1';
  function broadcastSnapshot(): void {
    if (snapshotBroadcastTimer !== null) return; // 이미 예약됨 — trailing flush 가 최신 스냅샷을 읽는다
    snapshotBroadcastTimer = setTimeout(() => {
      snapshotBroadcastTimer = null;
      if (PERF_SNAPSHOT) {
        const t0 = performance.now();
        const snap = graphManager.getSnapshot();
        const t1 = performance.now();
        const bytes = JSON.stringify(snap).length; // 직렬화 비용 계측용(broadcast 가 다시 직렬화하지만 PERF 시에만)
        const t2 = performance.now();
        const agents = Array.isArray(snap.agents) ? snap.agents.length : Object.keys(snap.agents ?? {}).length;
        const subs = Object.keys(snap.subAgents ?? {}).length;
        logger.warn(
          `[perf-snapshot] getSnapshot=${(t1 - t0).toFixed(1)}ms stringify=${(t2 - t1).toFixed(1)}ms ` +
          `bytes=${bytes} agents=${agents} subAgents=${subs}`,
        );
        broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: snap });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
    }, WS_BATCH_INTERVAL);
  }

  // §5.3 #10-2 v2.37 — Auto Agent 런타임. 사용자 메시지 → 서브 군 자동 생성·dispatch.
  // enqueueCommand 는 기존 `commandQueues` Map 에 push + processNextCommand 즉시 발사.
  const autoAgentRuntime = new AutoAgentRuntime({
    graphManager,
    setAgentConfig: (agentId, config) => {
      // index.ts 의 PUT /api/agent-config 와 동일 효과 — 최소형(머지 X, 풀 set).
      // partial 입력이라도 호출자가 머지 후 전달 가정. 여기선 전체로 저장.
      graphManager.setAgentConfig(agentId, config as import('@vibisual/shared').AgentConfig);
    },
    enqueueCommand: (sessionId, text) => {
      // 빌더는 auto-agent 버블(customCreated) 자기 세션의 sub 로 돈다. `POST /api/commands/:sessionId`
      // 의 customCreated 분기와 동일하게, dispatch 전에 정규 sub 를 해석/생성해 cmd.subAgentId 로 박는다.
      // 이 해석을 빠뜨리면 execute() 가 subAgentId=null 로 sub 를 못 찾아 "SubAgent not found" 후 즉시
      // return → 빌더가 아예 스폰되지 않고 진행 표시만 영원히 'building' 으로 돈다.
      const agentId = graphManager.findAgentIdBySession(sessionId);
      const subAgentId = agentId
        ? (subAgentManager.getPrimarySub(agentId) ?? subAgentManager.create(agentId)).id
        : null;
      let queue = commandQueues.get(sessionId);
      if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
      const cmd: QueuedCommand = {
        id: `cmd-${Date.now()}-${queue.length}`,
        text,
        timestamp: Date.now(),
        subAgentId,
        status: 'queued' as const,
      };
      queue.push(cmd);
      processNextCommand(sessionId);
    },
    broadcastSnapshot,
    saveCheckpoint: () => saveCheckpoint(),
    // §5.3 #10-2 v2.45 — 빌더가 curl 로 닿을 loopback 베이스. buildOutboundEdgesRulesSection 과 동일 근거
    // (외부 claude 프로세스는 hook 리스너 동적 포트로만 in-process 서버에 닿음).
    getServerBase: () => `http://127.0.0.1:${hookListenerPort ?? port}`,
    getServerToken: () => hookListenerToken ?? '',
    broadcastAutoAgentProgress: (autoAgentId, summary) => {
      broadcast({
        type: 'auto_agent_progress',
        timestamp: Date.now(),
        payload: { autoAgentId, summary },
      });
    },
  });

  /** POST /api/layout-bounds/:projectName — 루트 캔버스 바운딩 박스 크기 저장 */
  app.post('/api/layout-bounds/:projectName', (req, res) => {
    const { projectName } = req.params;
    const body = req.body as { hw?: unknown; hh?: unknown };
    if (typeof body.hw !== 'number' || !Number.isFinite(body.hw)) {
      return res.status(400).json({ error: 'hw must be number' });
    }
    if (typeof body.hh !== 'number' || !Number.isFinite(body.hh)) {
      return res.status(400).json({ error: 'hh must be number' });
    }
    const hw = Math.min(8000, Math.max(300, Math.round(body.hw)));
    const hh = Math.min(8000, Math.max(300, Math.round(body.hh)));
    const changed = graphManager.setLayoutBounds(projectName, hw, hh);
    if (changed) broadcastSnapshot();
    res.json({ ok: true, hw, hh });
  });

  /** GET /api/commands/:sessionId — 훅/스크립트에서 대기열 조회 */
  app.get('/api/commands/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const queue = commandQueues.get(sessionId) ?? [];
    res.json({ commands: queue });
  });

  /**
   * v1.35 — 에이전트 프롬프트 이미지 paste 업로드.
   * sessionId 는 URL param (multer 가 body 를 이미지 다음에 파싱하므로 body 에 두면 destination 콜백에서 못 읽음).
   * 저장 위치: `<agentCwd>/.vibisual/attachments/<sessionId>/<uuid>.<ext>` 절대경로.
   * 응답의 `path` 를 클라이언트가 `QueuedCommand.attachments[]` 로 보내면 dispatch 시 프롬프트에 주입되고 완료 후 cleanup.
   */
  const attachmentsUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const raw = req.params['sessionId'];
        const sessionId = typeof raw === 'string' ? raw : '';
        if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
          return cb(new Error('invalid sessionId'), '');
        }
        const cwd = graphManager.getAgentCwd(sessionId);
        if (!cwd) return cb(new Error('agent not found for session'), '');
        const dir = path.join(cwd, '.vibisual', 'attachments', sessionId);
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          return cb(err instanceof Error ? err : new Error('mkdir failed'), '');
        }
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase();
        const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.bin';
        cb(null, `${randomUUID()}${safeExt}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB per file
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        cb(new Error('only image/* mime types allowed'));
        return;
      }
      cb(null, true);
    },
  });

  app.post('/api/agent-attachments/:sessionId/upload', (req, res) => {
    attachmentsUpload.single('image')(req, res, (err?: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: msg });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'no file uploaded (field name must be "image")' });
        return;
      }
      res.json({ ok: true, path: req.file.path, filename: req.file.filename, size: req.file.size });
    });
  });

  /**
   * v1.35 — 업로드 취소/대기 중 삭제.
   * 제출 전 사용자가 썸네일을 제거하거나 팝업을 닫을 때 호출.
   * 제출 후엔 `setOnComplete` cleanup 이 담당하므로 이 엔드포인트는 쓰지 않음.
   */
  app.delete('/api/agent-attachments/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { filePath } = req.body as { filePath?: string };
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    if (typeof filePath !== 'string' || !filePath) {
      res.status(400).json({ error: 'filePath required' });
      return;
    }
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) {
      res.status(404).json({ error: 'agent not found for session' });
      return;
    }
    const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(expectedDir + path.sep)) {
      res.status(403).json({ error: 'path outside attachments dir' });
      return;
    }
    fs.unlink(resolvedPath, (unlinkErr) => {
      if (unlinkErr && (unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`attachment unlink failed: ${resolvedPath} — ${unlinkErr.message}`);
        res.status(500).json({ error: 'unlink failed' });
        return;
      }
      res.json({ ok: true });
    });
  });

  /** GET /api/agent-attachments/:sessionId/file?rel=<subId/uuid.ext | uuid.ext> — v2.93
   *  제출 후에도 디스크에 보존된 첨부 이미지를 서빙(영구 폴백). 클라 썸네일은 원래 제출 시점
   *  메모리 blob URL 에만 의존해 detach 별창·새로고침·재시작·부팅복원에서 소실됐다 → 이 라우트로
   *  파일을 직접 받아 현재 document 에서 blob 재생성. 경로 검증: 해당 세션 attachments 디렉토리
   *  내부 파일만 허용(트래버설 차단). IPC 트랜스포트가 비텍스트 응답을 base64 로 무손실 전달. */
  app.get('/api/agent-attachments/:sessionId/file', (req, res) => {
    const { sessionId } = req.params;
    const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    if (!rel) {
      res.status(400).json({ error: 'rel required' });
      return;
    }
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) {
      res.status(404).json({ error: 'agent not found for session' });
      return;
    }
    const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
    const resolvedPath = path.resolve(expectedDir, rel);
    if (!resolvedPath.startsWith(expectedDir + path.sep)) {
      res.status(403).json({ error: 'path outside attachments dir' });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!stat.isFile()) {
      res.status(404).json({ error: 'not a file' });
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : ext === '.svg' ? 'image/svg+xml'
      : 'application/octet-stream';
    try {
      const buf = fs.readFileSync(resolvedPath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(buf);
    } catch (err) {
      logger.warn(`attachment read failed: ${resolvedPath} — ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'read failed' });
    }
  });

  /** POST /api/commands/:sessionId — 명령 추가.
   *  두 경로 수용: (1) JSON `{ text, subAgentId?, attachments? }`,
   *  (2) raw text/plain 본문 — 하네스 빌더(§5.3 #10-2 v2.45) 가 엔트리 노드를 escape-free 로 kickoff. */
  app.post('/api/commands/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    let text: string | undefined;
    let subAgentId: string | null | undefined;
    let attachments: string[] | undefined;
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. 끝의 heredoc 잔여 개행만 정리.
      text = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { text?: string; subAgentId?: string | null; attachments?: string[] };
      text = body.text;
      subAgentId = body.subAgentId;
      attachments = body.attachments;
    }
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text required' });
      return;
    }

    const agentId = graphManager.findAgentIdBySession(sessionId);
    const agentBubble = graphManager.getAgentBySession(sessionId);

    // subagent 결정: 지정된 ID 사용 → (커스텀: 정규 sub 1개 고정 재사용) → idle 재사용 → 새로 생성
    let resolvedSubId = subAgentId ?? null;
    if (!resolvedSubId && agentId) {
      if (agentBubble?.customCreated) {
        // v1.77 (Direction A) — 커스텀 에이전트 = 하나의 안정 대화. 명령마다 새 sub 를
        // 만들면 sub.sessionId 가 매번 비어 새 Claude 세션이 생기고(연속성 상실) 그게
        // 또 새 훅 버블로 증식한다. 정규 sub(대화 성립된 것 우선) 하나만 계속 재사용.
        // 진행 중이면 processNextCommand 의 busy 가드가 자동 큐잉(동시 dispatch 방지).
        const primary = subAgentManager.getPrimarySub(agentId);
        resolvedSubId = (primary ?? subAgentManager.create(agentId)).id;
      } else {
        const idleSubs = subAgentManager.getIdleSubs(agentId);
        const lastIdle = idleSubs[idleSubs.length - 1];
        if (lastIdle) {
          resolvedSubId = lastIdle.id;
        } else {
          const newSub = subAgentManager.create(agentId);
          resolvedSubId = newSub.id;
        }
      }
    }

    // v1.35 — attachments 경로 검증: 해당 세션의 attachments 디렉토리 내부인 것만 허용.
    // 위조된 경로로 CLI 에게 임의 파일 경로 주입 방지.
    // v1.38 — 제출 확정 시 <agentPath>/<subId>/<uuid>.<ext> 로 이동하여 서브세션별 격리.
    //         이동 실패(권한/크로스 디바이스)시 원본 경로 유지.
    let resolvedAttachments: string[] | undefined;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const cwd = graphManager.getAgentCwd(sessionId);
      if (cwd) {
        const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
        const valid: string[] = [];
        for (const a of attachments) {
          if (typeof a !== 'string') continue;
          const resolved = path.resolve(a);
          if (resolved.startsWith(expectedDir + path.sep) && fs.existsSync(resolved)) {
            valid.push(resolved);
          }
        }
        if (valid.length > 0) {
          // resolvedSubId 가 있고 /, \\, .. 가 없으면 서브폴더로 이동.
          const safeSubId =
            resolvedSubId && !resolvedSubId.includes('/') && !resolvedSubId.includes('\\') && !resolvedSubId.includes('..')
              ? resolvedSubId
              : null;
          if (safeSubId) {
            const subDir = path.join(expectedDir, safeSubId);
            try { fs.mkdirSync(subDir, { recursive: true }); } catch { /* 실패해도 원본 경로로 fallback */ }
            const moved: string[] = [];
            for (const src of valid) {
              const dest = path.join(subDir, path.basename(src));
              try {
                fs.renameSync(src, dest);
                moved.push(dest);
              } catch (err) {
                logger.warn(`attachment move failed: ${src} → ${dest} (${err instanceof Error ? err.message : String(err)})`);
                moved.push(src);
              }
            }
            resolvedAttachments = moved;
          } else {
            resolvedAttachments = valid;
          }
        }
      }
    }

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-${queue.length}`,
      text: text.trim(),
      timestamp: Date.now(),
      subAgentId: resolvedSubId,
      status: 'queued' as const,
      ...(resolvedAttachments ? { attachments: resolvedAttachments } : {}),
    };
    queue.push(cmd);
    // §5.5 #17-4 v2.36 — 명령 텍스트의 `/skill-name` 토큰들을 프로젝트 사용 카운트에 반영.
    //                    SkillsView 가 정렬 키·배지로 사용.
    graphManager.recordSkillUsageFromCommandText(sessionId, cmd.text);
    res.json({ ok: true, command: cmd });
    broadcastSnapshot();

    // 즉시 실행 시도
    processNextCommand(sessionId);
  });

  /** DELETE /api/commands/:sessionId/:commandId — 명령 제거 */
  app.delete('/api/commands/:sessionId/:commandId', (req, res) => {
    const { sessionId, commandId } = req.params;
    const queue = commandQueues.get(sessionId);
    if (!queue) { res.json({ ok: true }); return; }
    const idx = queue.findIndex((c) => c.id === commandId);
    if (idx >= 0) queue.splice(idx, 1);
    res.json({ ok: true });
    broadcastSnapshot();
  });

  /** POST /api/commands/:sessionId/pop — 1번 명령 꺼내기 (실행용) */
  app.post('/api/commands/:sessionId/pop', (req, res) => {
    const { sessionId } = req.params;
    const queue = commandQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      res.json({ command: null });
      return;
    }
    const cmd = queue.shift()!;

    // pop 메타 기록 — buildAgentEvents에서 source 매칭용
    let popped = poppedCommands.get(sessionId);
    if (!popped) { popped = []; poppedCommands.set(sessionId, popped); }
    popped.push({ text: cmd.text, queuedAt: cmd.timestamp, poppedAt: Date.now() });
    // 오래된 기록 정리 (최대 30개)
    if (popped.length > 30) popped.splice(0, popped.length - 30);

    res.json({ command: cmd });
    broadcastSnapshot();
  });

  /** PUT /api/commands/:sessionId/reorder — 순서 변경 */
  app.put('/api/commands/:sessionId/reorder', (req, res) => {
    const { sessionId } = req.params;
    const { fromIndex, toIndex } = req.body as { fromIndex?: number; toIndex?: number };
    if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
      res.status(400).json({ error: 'fromIndex and toIndex required' });
      return;
    }
    const queue = commandQueues.get(sessionId);
    if (!queue) { res.json({ ok: true }); return; }
    const [moved] = queue.splice(fromIndex, 1);
    if (moved) queue.splice(toIndex, 0, moved);
    res.json({ ok: true });
    broadcastSnapshot();
  });

  /** POST /api/create-custom-agent — 캔버스에서 커스텀 에이전트 생성.
   *  §4 v2.63 — `executionMode:'interactive-terminal'` 이면 CMD(인터랙티브 터미널) 에이전트로 baked. */
  app.post('/api/create-custom-agent', (req, res) => {
    try {
      const { label, x, y, project, executionMode } = req.body as { label?: string; x?: number; y?: number; project?: string; executionMode?: 'headless' | 'interactive-terminal' };
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const options = executionMode === 'interactive-terminal' ? { executionMode } : undefined;
      const agent = graphManager.createCustomAgent(label ?? '', position, project ?? null, options);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, agent });
    } catch (err) {
      logger.error('POST /api/create-custom-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §3.2.2 (C 복구) — 해당 프로젝트에서 복구 가능한(사라졌거나 닫힌) 커스텀 에이전트 목록.
   *  identity.json 정체성 중 현재 캔버스에 없고 명시 삭제(묘비)도 아닌 것. 캔버스 우클릭 "복구" UI 용. */
  app.get('/api/custom-agents/recoverable', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : '';
      if (!project) { res.json({ agents: [] }); return; }
      const agents = graphManager.listRecoverableCustomAgents(project);
      res.json({ agents });
    } catch (err) {
      logger.error('GET /api/custom-agents/recoverable failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §3.2.2 (C 복구) — sessionId 로 커스텀 에이전트를 identity.json 에서 되살려 캔버스에 재삽입. */
  app.post('/api/custom-agents/restore', (req, res) => {
    try {
      const { project, sessionId, x, y } = req.body as { project?: string; sessionId?: string; x?: number; y?: number };
      if (typeof project !== 'string' || !project || typeof sessionId !== 'string' || !sessionId) {
        return res.status(400).json({ error: 'project and sessionId required' });
      }
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const agent = graphManager.restoreCustomAgent(project, sessionId, position);
      if (!agent) return res.status(404).json({ error: 'recoverable custom agent not found' });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, agent });
    } catch (err) {
      logger.error('POST /api/custom-agents/restore failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성 (캔버스 우클릭 메뉴) */
  app.post('/api/create-auto-agent', (req, res) => {
    try {
      const { label, x, y, project } = req.body as { label?: string; x?: number; y?: number; project?: string };
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const agent = graphManager.createAutoAgent(label ?? '', position, project ?? null);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, agent });
    } catch (err) {
      logger.error('POST /api/create-auto-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.3 #10-2 v2.37 — Auto Agent 에게 사용자 메시지 전달 → 자동 spawn + dispatch */
  app.post('/api/auto-agent/:sessionId/message', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { text } = req.body as { text?: string };
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
      }
      const summary = autoAgentRuntime.processRequest(sessionId, text.trim());
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/message failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** §5.3 #10-2 v2.37 — Auto Agent "질문하기" 토글 */
  app.post('/api/auto-agent/:sessionId/toggle-questions', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be boolean' });
      }
      const summary = autoAgentRuntime.toggleQuestions(sessionId, enabled);
      if (!summary) return res.status(404).json({ error: 'auto-agent not found' });
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/toggle-questions failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.3 #10-2 v2.37 — Auto Agent 명확화 질문에 사용자 답을 보내고 spawn 재개 */
  app.post('/api/auto-agent/:sessionId/answer-questions', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { answers } = req.body as { answers?: { questionIndex: number; selectedLabels: string[]; note?: string }[] };
      if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'answers must be array' });
      }
      const summary = autoAgentRuntime.resumeWithAnswers(sessionId, answers);
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/answer-questions failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** POST /api/create-pipeline — 캔버스에서 파이프라인 에이전트 생성 (부모 + 자식 4개) */
  app.post('/api/create-pipeline', (req, res) => {
    try {
      const { type, label, x, y, project } = req.body as {
        type?: string; label?: string; x?: number; y?: number; project?: string;
      };
      const validTypes = ['pipeline-subagent', 'pipeline-teams', 'pipeline-hybrid'];
      if (!type || !validTypes.includes(type)) {
        res.status(400).json({ error: `Invalid pipeline type: ${type}` });
        return;
      }
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const pipeline = graphManager.createPipeline(type as PipelineType, label ?? '', position, project ?? null);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, pipeline });
    } catch (err) {
      logger.error('POST /api/create-pipeline failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** `git worktree add` 실행. base 브랜치 후보를 차례로 시도(master → main). */
  function runGitWorktreeAdd(
    parentCwd: string,
    targetDir: string,
    newBranch: string,
    baseCandidates: string[],
  ): Promise<{ ok: true; base: string } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const tryNext = (i: number): void => {
        if (i >= baseCandidates.length) {
          resolve({ ok: false, error: `No matching base ref (tried: ${baseCandidates.join(', ')})` });
          return;
        }
        const base = baseCandidates[i]!;
        execFile(
          'git',
          ['-C', parentCwd, 'worktree', 'add', '-b', newBranch, targetDir, base],
          { windowsHide: true },
          (err, _stdout, stderr) => {
            if (!err) { resolve({ ok: true, base }); return; }
            const msg = (stderr || String(err)).trim();
            // base 를 찾지 못한 경우 → 다음 후보 시도
            if (/invalid reference|unknown revision|not a valid object/i.test(msg)) {
              tryNext(i + 1);
              return;
            }
            resolve({ ok: false, error: msg });
          },
        );
      };
      tryNext(0);
    });
  }

  /** POST /api/create-worktree — 캔버스에서 `master` 기준 새 git worktree + 버블 생성 */
  app.post('/api/create-worktree', (req, res) => {
    void (async () => {
      try {
        const { project, x, y, name, base } = req.body as {
          project?: string; x?: number; y?: number; name?: string; base?: string;
        };
        // 1) 부모 프로젝트 resolve — worktree 프로젝트가 넘어오면 부모로 승격
        const requested = typeof project === 'string' && project.length > 0 ? project : null;
        const info = requested ? graphManager.getProjectByName(requested) : graphManager.getPrimaryProject();
        if (!info) {
          res.status(400).json({ error: 'No project available to create a worktree under.' });
          return;
        }
        let parentInfo = info;
        if (info.parentProjectPath) {
          // `getProjectByName`은 모든 인스턴스를 훑으므로 worktree 본인일 수도 있다 → 부모로 치환
          const parent = graphManager.getProjectByName(path.basename(info.parentProjectPath));
          if (parent) parentInfo = parent;
        }
        const parentCwd = parentInfo.path.replace(/\//g, path.sep);

        // 2) 이름 자동 생성 (미지정 시 timestamp). 파일 시스템 안전 문자만 허용.
        const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
        const autoName = (() => {
          const d = new Date();
          const pad = (n: number): string => n.toString().padStart(2, '0');
          return `wt-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        })();
        let wtName = sanitize(typeof name === 'string' && name.trim() ? name.trim() : autoName);
        if (!wtName) wtName = autoName;

        const wtRoot = path.join(parentCwd, '.claude', 'worktrees');
        try { fs.mkdirSync(wtRoot, { recursive: true }); } catch { /* ignore */ }

        // 3) 중복 회피 — 같은 이름 존재 시 `-2`, `-3`... 접미어
        let targetDir = path.join(wtRoot, wtName);
        let attempt = 1;
        while (fs.existsSync(targetDir)) {
          attempt += 1;
          targetDir = path.join(wtRoot, `${wtName}-${attempt}`);
        }
        const finalName = path.basename(targetDir);
        const branch = `wt/${finalName}`;

        // 4) `git worktree add -b <branch> <target> <base>` — base 후보: 사용자 지정 → master → main
        const baseCandidates = base ? [base, 'master', 'main'] : ['master', 'main'];
        const result = await runGitWorktreeAdd(parentCwd, targetDir, branch, baseCandidates);
        if (!result.ok) {
          logger.warn(`create-worktree git failed: ${result.error}`);
          res.status(500).json({ error: `git worktree add failed: ${result.error}` });
          return;
        }

        // 5) 등록 + 버블 생성
        //    부모가 이미 등록돼 있으면 manager.registerProject(wtCwd) 는 부모로 리다이렉트 후 early return 하므로,
        //    `scanAllProjects` 로 부모 인스턴스의 `discoverWorktrees` 를 강제 실행시켜 worktree 노드를 생성한다.
        try {
          graphManager.registerProject(parentCwd); // 부모 인스턴스 확보 (idempotent)
        } catch (err) {
          // §3.2.1-4 (v3.03) — 부모가 read-only 격리(load-error)면 워크트리 생성 불가.
          logger.warn(`create-worktree: parent registerProject("${parentCwd}") failed: ${err instanceof Error ? err.message : String(err)}`);
          res.status(409).json({ error: `parent project not available (possibly read-only isolated): ${parentCwd}` });
          return;
        }
        graphManager.scanAllProjects();          // `.claude/worktrees/*` 재스캔 → ensureWorktreeNode

        // 6) 위치 부여 — ensureWorktreeNode 의 id 규칙: `worktree-${hashString(normalized)}`
        const normalizedWt = targetDir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
        let hash = 5381;
        for (let i = 0; i < normalizedWt.length; i++) {
          hash = ((hash << 5) + hash + normalizedWt.charCodeAt(i)) >>> 0;
        }
        const nodeId = `worktree-${hash}`;
        if (typeof x === 'number' && typeof y === 'number') {
          const positioned = graphManager.updateBubblePosition(nodeId, x, y);
          if (!positioned) {
            logger.warn(`create-worktree: node not found after scan — id=${nodeId}, path=${normalizedWt}`);
          }
        }

        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, name: finalName, branch, base: result.base, path: targetDir, nodeId });
      } catch (err) {
        logger.error('POST /api/create-worktree failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** git 명령 실행 헬퍼 — stdout/stderr/exitCode 를 한 번에 반환 */
  function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
          ? (err as NodeJS.ErrnoException).code as unknown as number
          : err ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
  }

  /** 주어진 worktree 경로에 매칭되는 branch 를 `git worktree list --porcelain` 로 조회 */
  async function getWorktreeBranch(parentCwd: string, wtAbsolutePath: string): Promise<string | null> {
    const r = await runGit(parentCwd, ['worktree', 'list', '--porcelain']);
    if (r.code !== 0) return null;
    const targetNorm = path.resolve(wtAbsolutePath).replace(/\\/g, '/').toLowerCase();
    const blocks = r.stdout.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const m = block.match(/^worktree\s+(.+)$/m);
      if (!m) continue;
      const wt = path.resolve(m[1]!.trim()).replace(/\\/g, '/').toLowerCase();
      if (wt !== targetNorm) continue;
      const b = block.match(/^branch\s+refs\/heads\/(.+)$/m);
      return b ? b[1]!.trim() : null;
    }
    return null;
  }

  /** nodeId → worktree 버블 정보 조회 (topFolders 순회) */
  function resolveWorktreeNode(nodeId: string): { parentAbs: string; wtAbs: string; wtNormalized: string } | null {
    const snap = graphManager.getSnapshot();
    const found = snap.topFolders.find((n) => n.id === nodeId && n.bubbleType === 'worktree');
    if (!found) return null;
    const wtNormalized = found.path;
    const wtAbs = (found.absolutePath ?? wtNormalized).replace(/\//g, path.sep);
    const m = wtNormalized.match(/^(.+?)\/\.claude\/worktrees\/[^/]+$/);
    if (!m) return null;
    const parentNorm = m[1]!;
    const parentAbs = parentNorm.replace(/\//g, path.sep);
    return { parentAbs, wtAbs, wtNormalized };
  }

  /** GET /api/worktree/:nodeId/status — 브랜치명 + master/main 병합 여부 조회 */
  app.get('/api/worktree/:nodeId/status', (req, res) => {
    void (async () => {
      try {
        const info = resolveWorktreeNode(req.params.nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }
        const branch = await getWorktreeBranch(info.parentAbs, info.wtAbs);
        // base branch 결정 — master → main 순 존재 확인
        const masterRef = await runGit(info.parentAbs, ['rev-parse', '--verify', '--quiet', 'refs/heads/master']);
        const baseBranch = masterRef.code === 0 ? 'master' : 'main';
        let isMerged = false;
        if (branch) {
          const anc = await runGit(info.parentAbs, ['merge-base', '--is-ancestor', branch, baseBranch]);
          isMerged = anc.code === 0;
        }
        res.json({ branch, baseBranch, isMerged, wtPath: info.wtAbs, parentPath: info.parentAbs });
      } catch (err) {
        logger.error('GET /api/worktree/:id/status failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** DELETE /api/worktree/:nodeId?merge=1 — 폴더·브랜치·버블 일괄 정리. merge=1 이면 삭제 전 병합 시도. */
  app.delete('/api/worktree/:nodeId', (req, res) => {
    void (async () => {
      try {
        const nodeId = req.params.nodeId;
        const merge = req.query['merge'] === '1' || req.query['merge'] === 'true';
        const info = resolveWorktreeNode(nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }
        const branch = await getWorktreeBranch(info.parentAbs, info.wtAbs);

        // 1) 선택 시 병합 먼저
        if (merge) {
          if (!branch) {
            res.status(400).json({ error: 'branch not resolved', stderr: 'Could not determine worktree branch via `git worktree list`.' });
            return;
          }
          const mergeRes = await runGit(info.parentAbs, ['merge', '--no-edit', branch]);
          if (mergeRes.code !== 0) {
            // 실패 — 삭제 진행하지 않고 stderr 반환
            res.status(409).json({ ok: false, step: 'merge', error: 'merge failed', stderr: mergeRes.stderr || mergeRes.stdout, branch });
            return;
          }
        }

        // 2) worktree 제거 (force — dirty tree 도 강제 삭제, "그냥 삭제" 경로 커버)
        const rm = await runGit(info.parentAbs, ['worktree', 'remove', '--force', info.wtAbs]);
        if (rm.code !== 0) {
          // 폴더가 이미 사라졌으면 prune 으로 정리 후 계속 진행
          const prune = await runGit(info.parentAbs, ['worktree', 'prune']);
          logger.warn(`worktree remove failed, pruned: rmStderr=${rm.stderr} pruneStderr=${prune.stderr}`);
        }

        // 3) 브랜치 강제 삭제 (best-effort)
        if (branch) {
          const br = await runGit(info.parentAbs, ['branch', '-D', branch]);
          if (br.code !== 0) logger.warn(`branch -D ${branch} failed: ${br.stderr}`);
        }

        // 4) 버블 제거 + 디스크 폴더가 남아 있으면 정리 (worktree remove 가 실패한 경우)
        graphManager.removeBubble(nodeId);
        try {
          if (fs.existsSync(info.wtAbs)) fs.rmSync(info.wtAbs, { recursive: true, force: true });
        } catch (err) {
          logger.warn(`worktree folder cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, branch });
      } catch (err) {
        logger.error('DELETE /api/worktree/:id failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /**
   * POST /api/worktree/:nodeId/sync — worktree 에 원격/로컬 base(master→main) 를 머지.
   * v1.23 §7.6 Sync 액션. base 후보: origin/master → origin/main → master → main.
   * 충돌 시 `merge --abort` 로 자동 원복 후 409 + stderr 반환.
   */
  app.post('/api/worktree/:nodeId/sync', (req, res) => {
    void (async () => {
      try {
        const info = resolveWorktreeNode(req.params.nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }

        // 1) fetch origin — best-effort (offline / no remote 시 경고만 찍고 계속)
        const fetchR = await runGit(info.wtAbs, ['fetch', 'origin']);
        if (fetchR.code !== 0) {
          logger.warn(`worktree sync: fetch origin failed (continuing with local refs): ${fetchR.stderr.trim()}`);
        }

        // 2) base ref 결정 — 4단 폴백
        const candidates = ['origin/master', 'origin/main', 'master', 'main'];
        let base: string | null = null;
        for (const ref of candidates) {
          const verify = await runGit(info.wtAbs, ['rev-parse', '--verify', '--quiet', ref]);
          if (verify.code === 0) { base = ref; break; }
        }
        if (!base) {
          res.status(400).json({ error: 'no base ref found', tried: candidates });
          return;
        }

        // 3) merge
        const merge = await runGit(info.wtAbs, ['merge', '--no-edit', base]);
        if (merge.code !== 0) {
          // 충돌 → 자동 abort 로 worktree 상태 원복
          const abort = await runGit(info.wtAbs, ['merge', '--abort']);
          if (abort.code !== 0) logger.warn(`worktree sync: merge --abort failed: ${abort.stderr.trim()}`);
          res.status(409).json({
            ok: false,
            step: 'merge',
            base,
            stderr: merge.stderr || merge.stdout || 'merge failed',
          });
          return;
        }

        // 4) 캐시 무효화 — 부모 프로젝트의 git-status 에 반영 (worktree ahead/behind 변동)
        const parentInst = graphManager.getProjectByName(path.basename(info.parentAbs));
        const projectName = parentInst?.name;
        if (projectName) gitStatusService.invalidate(projectName);
        broadcastSnapshot();
        res.json({ ok: true, base });
      } catch (err) {
        logger.error('POST /api/worktree/:id/sync failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** 특정 프로젝트의 worktree 버블 → gitStatusService 로 넘길 resolve 정보 리스트 */
  function listWorktreeInfo(projectName: string): WorktreeResolveInfo[] {
    const info = graphManager.getProjectByName(projectName);
    if (!info) return [];
    const parentNorm = info.path.toLowerCase();
    const snap = graphManager.getSnapshot();
    const out: WorktreeResolveInfo[] = [];
    for (const node of snap.topFolders) {
      if (node.bubbleType !== 'worktree') continue;
      const p = (node.path ?? '').toLowerCase();
      if (!p.startsWith(`${parentNorm}/.claude/worktrees/`)) continue;
      const absPath = (node.absolutePath ?? node.path).replace(/\//g, path.sep);
      out.push({ nodeId: node.id, name: node.label, absPath });
    }
    return out;
  }

  /** GET /api/git-status/:projectName?force=1 — §7.6 GitStatusCard 데이터 소스 */
  app.get('/api/git-status/:projectName', (req, res) => {
    void (async () => {
      try {
        const projectName = req.params.projectName;
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);
        const worktrees = listWorktreeInfo(projectName);
        const force = req.query['force'] === '1' || req.query['force'] === 'true';
        const status = await gitStatusService.getStatus(projectName, cwd, worktrees, force);
        res.json(status);
      } catch (err) {
        logger.error('GET /api/git-status/:projectName failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /**
   * POST /api/git-commit — body { projectName, message? }.
   * v1.25 §7.6 Commit 액션 (v1.24 Snapshot 리네임). `git add -A && git commit -m "wip: <ts>"` 일괄 실행.
   * 실패 시 stderr 를 409 로 반환하여 클라이언트가 GitErrorModal 로 노출.
   */
  app.post('/api/git-commit', (req, res) => {
    void (async () => {
      try {
        const { projectName, message } = req.body as { projectName?: string; message?: string };
        if (typeof projectName !== 'string' || projectName.length === 0) {
          res.status(400).json({ error: 'projectName required' });
          return;
        }
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);

        // 기본 메시지: "wip: YYYY-MM-DD HH:mm" (서버 로컬 타임, work-in-progress 관용)
        const now = new Date();
        const pad = (n: number): string => n.toString().padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const commitMsg = typeof message === 'string' && message.trim() ? message.trim() : `wip: ${ts}`;

        // 1) add -A
        const add = await runGit(cwd, ['add', '-A']);
        if (add.code !== 0) {
          res.status(409).json({ ok: false, step: 'add', stderr: add.stderr || add.stdout || 'git add failed' });
          return;
        }
        // 2) commit — 빈 커밋은 에러로 튀는데, dirty 없으면 클라에서 버튼 비활성화 상태라 정상 경로에선 안 옴
        const commit = await runGit(cwd, ['commit', '-m', commitMsg]);
        if (commit.code !== 0) {
          res.status(409).json({
            ok: false,
            step: 'commit',
            message: commitMsg,
            stderr: commit.stderr || commit.stdout || 'git commit failed',
          });
          return;
        }

        gitStatusService.invalidate(projectName);
        broadcastSnapshot();
        res.json({ ok: true, message: commitMsg });
      } catch (err) {
        logger.error('POST /api/git-commit failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** POST /api/git-init — body { projectName }. git init 실행 후 캐시 무효화 + 재fetch + 브로드캐스트. */
  app.post('/api/git-init', (req, res) => {
    void (async () => {
      try {
        const { projectName } = req.body as { projectName?: string };
        if (typeof projectName !== 'string' || projectName.length === 0) {
          res.status(400).json({ error: 'projectName required' });
          return;
        }
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);
        const init = await runGit(cwd, ['init']);
        if (init.code !== 0) {
          res.status(500).json({ error: 'git init failed', stderr: init.stderr });
          return;
        }
        gitStatusService.invalidate(projectName);
        const worktrees = listWorktreeInfo(projectName);
        const status = await gitStatusService.getStatus(projectName, cwd, worktrees, true);
        res.json({ ok: true, status });
      } catch (err) {
        logger.error('POST /api/git-init failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  app.post('/api/dismiss-agent', (req, res) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (typeof agentId !== 'string') {
        res.status(400).json({ error: 'agentId required' });
        return;
      }
      const sessionId = graphManager.findSessionByAgentId(agentId);
      if (sessionId) {
        agentTracker.dismiss(sessionId);
        // markAgentIdle 이 파일/폴더 엣지를 삭제 → 클라에 즉시 반영해야
        // 완료 에이전트 dismiss 시 폴더 버블이 화면에서 사라진다(고정 제외).
        // 형제 변이 엔드포인트와 동일하게 broadcast + saveCheckpoint 쌍으로 마감.
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/dismiss-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/subagents/:agentId — 해당 에이전트의 idle subagent 목록 (세션 선택용) */
  app.get('/api/subagents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const idle = subAgentManager.getIdleSubs(agentId);
    res.json({ subAgents: idle });
  });

  /** POST /api/subagents/:agentId — 빈 SubAgent 생성 (IDE + 탭용).
   *  body.subAgentId 가 있으면 그 id 로 생성(클라이언트 optimistic create — 응답 대기 없이 즉시 포커스). */
  app.post('/api/subagents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const body = req.body as { subAgentId?: unknown } | undefined;
    const preferredId = typeof body?.subAgentId === 'string' && body.subAgentId.startsWith('sub-')
      ? body.subAgentId
      : undefined;
    const sub = subAgentManager.create(agentId, preferredId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, subAgent: sub });
  });

  /** POST /api/subagents/:agentId/:subId/stop — 실행 중인 서브에이전트 중지 (탭/세션은 유지).
   *  실행 중이 아니면 409. 성공 시 close 핸들러가 cmd.result 를 `[Stopped by user]` 로 채운다. */
  app.post('/api/subagents/:agentId/:subId/stop', (req, res) => {
    const { subId } = req.params;
    const ok = subAgentManager.stop(subId);
    if (!ok) {
      res.status(409).json({ ok: false, error: 'not running' });
      return;
    }
    res.json({ ok: true });
  });

  /** DELETE /api/subagents/:agentId/:subId — 서브에이전트 탭 닫기(세션 종료+삭제) */
  app.delete('/api/subagents/:agentId/:subId', (req, res) => {
    const { subId } = req.params;
    const ok = subAgentManager.remove(subId);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'sub not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** POST /api/subagents/:agentId/remove-bulk — 여러 탭을 한 번에 닫기
   *  (컨텍스트 메뉴 "다른 탭 닫기 / 오른쪽 닫기 / 모두 닫기").
   *  N개를 개별 DELETE 로 닫으면 매 요청마다 broadcastSnapshot + saveCheckpoint(전체 직렬화 +
   *  worktree prune)가 돌아 "닫닫 닫" 하며 한 개씩 느리게 닫히는 체감을 만든다. 한 요청으로 모두
   *  제거한 뒤 broadcast/checkpoint 는 1회만 수행한다. */
  app.post('/api/subagents/:agentId/remove-bulk', (req, res) => {
    const body = req.body as { ids?: unknown } | undefined;
    const ids = Array.isArray(body?.ids)
      ? body!.ids.filter((x): x is string => typeof x === 'string')
      : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ ok: false, error: 'ids must be non-empty string[]' });
      return;
    }
    let removed = 0;
    for (const id of ids) {
      if (subAgentManager.remove(id)) removed++;
    }
    if (removed > 0) {
      broadcastSnapshot();
      saveCheckpoint();
    }
    res.json({ ok: true, removed });
  });

  /** GET /api/subagents/:agentId/history — 이 부모 에이전트가 과거에 소유했던(탭 닫은) SubAgent 목록.
   *  소프트 아카이브에서 읽음 → 다른 에이전트·VSCode 메인 세션은 섞이지 않음. */
  app.get('/api/subagents/:agentId/history', (req, res) => {
    const { agentId } = req.params;
    const archived = subAgentManager.getArchived(agentId);
    const items: SubAgentHistoryItem[] = archived.map((s) => ({
      subAgentId: s.id,
      sessionId: s.sessionId,
      label: s.label,
      lastCommand: s.lastCommand,
      lastActivityAt: s.lastActivityAt,
      totalInputTokens: s.totalInputTokens,
      totalOutputTokens: s.totalOutputTokens,
    }));
    res.json({ ok: true, items });
  });

  /** POST /api/subagents/:agentId/restore — archive에서 registry로 되돌림.
   *  body: { subAgentId }. 이미 registry에 있으면(중복) 그 인스턴스 반환. */
  app.post('/api/subagents/:agentId/restore', (req, res) => {
    const body = req.body as { subAgentId?: unknown } | undefined;
    const sid = typeof body?.subAgentId === 'string' ? body.subAgentId : '';
    if (!sid) {
      res.status(400).json({ ok: false, error: 'subAgentId required' });
      return;
    }

    const revived = subAgentManager.restoreFromArchive(sid);
    if (!revived) {
      res.status(404).json({ ok: false, error: 'archived sub not found' });
      return;
    }

    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, subAgent: revived });
  });

  /** PATCH /api/subagents/:agentId/order — 서브에이전트 탭 순서 저장 */
  app.patch('/api/subagents/:agentId/order', (req, res) => {
    const { agentId } = req.params;
    const body = req.body as { order?: unknown } | undefined;
    const order = Array.isArray(body?.order) ? body!.order.filter((x): x is string => typeof x === 'string') : null;
    if (!order) {
      res.status(400).json({ ok: false, error: 'order must be string[]' });
      return;
    }
    const ok = subAgentManager.reorder(agentId, order);
    if (!ok) {
      res.status(409).json({ ok: false, error: 'order mismatch' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** POST /api/subagents/:agentId/:subId/summary — §5.5 #17-8 v2.95 세션 자기요약.
   *  카드가 없는 세션을 요약 보드에서 한 줄로 보여주기 위해, 그 세션의 claude 대화를 `--resume` 해
   *  헤드리스 1턴 한국어 요약을 받아 `{ ok, text }` 로 반환. 표시 전용 — 그래프 상태/체크포인트 무관. */
  app.post('/api/subagents/:agentId/:subId/summary', async (req, res) => {
    const { agentId, subId } = req.params;
    try {
      const result = await subAgentManager.summarizeSession(agentId, subId);
      if (!result.ok) {
        res.status(result.error === 'no-conversation' ? 404 : 502).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** GET /api/subagent-streams/:agentId — 에이전트 전체 서브에이전트 스트림 버퍼 (IDE 열 때 초기 데이터).
   *  버퍼는 emit 시점에 디스크 append-only로 기록되므로(streamBufferStore), 서버 재시작 후에도 live와 동일한 타임라인이 복원된 상태다. */
  app.get('/api/subagent-streams/:agentId', (req, res) => {
    const { agentId } = req.params;
    const buffers = subAgentManager.getStreamBuffersForAgent(agentId);
    res.json({ streams: buffers });
  });

  /** PATCH /api/bubble/:nodeId/label — 버블 이름 변경 */
  app.patch('/api/bubble/:nodeId/label', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { label } = req.body as { label?: string };
      if (typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: 'label required' });
        return;
      }
      graphManager.updateBubbleLabel(nodeId, label.trim());
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/label failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Skills Discovery ───

  interface SkillInfo {
    name: string;
    description: string;
    /** project = 프로젝트 `.claude`, global = 홈 `~/.claude`(모든 프로젝트 공통), plugin = 설치 플러그인. */
    source: 'project' | 'global' | 'plugin';
    /** 플러그인 스킬일 때 소속 플러그인 이름 (예: "claude-code-harness", "frontend-design") */
    pluginName?: string;
  }

  /** SKILL.md frontmatter에서 name/description 파싱 */
  function parseSkillMd(filePath: string): { name: string; description: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // YAML frontmatter: --- 로 시작, --- 로 끝
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch?.[1]) return null;
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*["']?(.*?)["']?\s*$/m);
      if (!nameMatch?.[1]) return null;
      return {
        name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
        description: descMatch?.[1]?.trim() ?? '',
      };
    } catch {
      return null;
    }
  }

  /** 디렉토리 내 스킬 폴더들 스캔 → SkillInfo[] */
  function scanSkillsDir(dir: string, source: 'project' | 'global' | 'plugin', pluginName?: string): SkillInfo[] {
    const results: SkillInfo[] = [];
    try {
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        const parsed = parseSkillMd(skillMd);
        if (parsed) {
          results.push({ name: parsed.name, description: parsed.description, source, pluginName });
        }
      }
    } catch { /* ignore */ }
    return results;
  }

  /**
   * 슬래시 커맨드 `.md` 1개 파싱 → description. (커맨드는 skill 과 달리 frontmatter 가 선택)
   * frontmatter `description:` 우선, 없으면 본문 첫 비어있지 않은 줄(헤딩/HTML 주석 제외) — Claude Code 규칙.
   */
  function parseCommandMd(filePath: string): { description: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const fm = fmMatch?.[1] ?? '';
      const body = fmMatch ? (fmMatch[2] ?? '') : content;
      const descMatch = fm.match(/^description:\s*["']?(.*?)["']?\s*$/m);
      if (descMatch?.[1]) {
        return { description: descMatch[1].trim().replace(/^["']|["']$/g, '') };
      }
      const firstLine = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('<!--'));
      return { description: firstLine ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * `.claude/commands/` 재귀 스캔 → SkillInfo[]. Claude Code 가 슬래시 커맨드를 읽는 디렉토리.
   * 최상위 `foo.md` → `foo`, 하위폴더 `bar/baz.md` → `bar:baz` (네임스페이스). skill 폴더와 달리 폴더가 아니라 `.md` 파일이 단위.
   */
  function scanCommandsDir(baseDir: string, source: 'project' | 'global' | 'plugin', pluginName?: string): SkillInfo[] {
    const results: SkillInfo[] = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, prefix ? `${prefix}:${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const base = entry.name.slice(0, -'.md'.length);
          const name = prefix ? `${prefix}:${base}` : base;
          const parsed = parseCommandMd(full);
          results.push({ name, description: parsed?.description ?? '', source, pluginName });
        }
      }
    };
    if (!fs.existsSync(baseDir)) return results;
    walk(baseDir, '');
    return results;
  }

  /**
   * GET /api/available-skills — 프로젝트 + 설치 플러그인 스킬 목록.
   * §5.5 #17-2/#17-4 v2.59 — `?agent=<id>`(권위) 또는 `?project=<name>` 지정 시 그 프로젝트의
   * `.claude/skills/` + `.claude/commands/`(Claude Code 슬래시 커맨드) 를 프로젝트 스킬로 반환.
   * 미지정 시 전 프로젝트 병합(하위 호환 fallback).
   * plugin 스킬은 `~/.claude/plugins` 전역이라 project 와 무관하게 항상 동일.
   */
  app.get('/api/available-skills', async (req, res) => {
    try {
      // §5.5 #17-2 v3.19 — 부팅 직후 첫 조회가 콜드 스캔과 경합해 builtins 가 비지 않도록 대기.
      // 캐시 hit 부팅에선 즉시 resolve. 클라 훅은 키별 1회 fetch 후 캐시라 여기서 기다려야 한다.
      await builtinCommandsService.whenReady();
      const skills: SkillInfo[] = [];
      const seen = new Set<string>();

      // 1) 프로젝트 스킬 — 스캔할 프로젝트 경로 결정.
      //    우선순위: agent(권위) → project(표시명/path 해소) → 미지정 시 전 프로젝트.
      //    v2.59 클라는 스냅샷의 전역 유일 표시명을 보내는데, 활성 프로젝트 오염·이름 충돌·
      //    미해소로 어긋날 수 있다. agentId 가 있으면 그 에이전트의 소속 인스턴스(=cwd 기준
      //    실제 프로젝트)에서 path 를 직접 얻어 "그 프로젝트의 .claude/skills" 만 정확히 읽는다.
      const agentParam = typeof req.query.agent === 'string' ? req.query.agent : '';
      const projectParam = typeof req.query.project === 'string' ? req.query.project : '';
      const scoped = agentParam || projectParam;
      let scopedPath: string | null = null;
      if (agentParam) scopedPath = graphManager.getProjectPathForAgent(agentParam);
      if (!scopedPath && projectParam) {
        scopedPath = graphManager.resolveProjectRef(projectParam)?.path ?? null;
      }
      const projectDirs: string[] = scoped
        ? (scopedPath ? [scopedPath] : []) // 지정했으나 미해소 → 빈 목록(전역 병합으로 새지 않게)
        : Object.values(graphManager.getSnapshot().projects).map((info) => info.path);
      for (const projectPath of projectDirs) {
        // skill 폴더(.claude/skills) 를 먼저 — 같은 이름이면 skill 이 command 를 이긴다(Claude Code 규칙).
        const projectSkillsDir = path.join(projectPath, '.claude', 'skills');
        for (const s of scanSkillsDir(projectSkillsDir, 'project')) {
          if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
        }
        // 슬래시 커맨드(.claude/commands) — Claude Code 가 프로젝트 스킬처럼 노출하는 곳. (P_MPS_DEV 의 26개 등)
        const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
        for (const s of scanCommandsDir(projectCommandsDir, 'project')) {
          if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
        }
      }
      const projectSkillCount = skills.length;

      // 1.5) 글로벌(개인) 스킬 — 홈 `~/.claude/skills/` + `~/.claude/commands/`. 모든 프로젝트 공통.
      //   §5.5 #17-5 — claude CLI 가 헤드리스/인터랙티브 양쪽에서 읽는 개인 스킬 경로. 프로젝트가
      //   같은 이름을 먼저 차지하면 그게 이긴다(Claude Code: project > personal). seen 공유로 보장.
      const homeClaudeDir = path.join(os.homedir(), '.claude');
      for (const s of scanSkillsDir(path.join(homeClaudeDir, 'skills'), 'global')) {
        if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
      }
      for (const s of scanCommandsDir(path.join(homeClaudeDir, 'commands'), 'global')) {
        if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
      }
      logger.info(`[skills] agent="${agentParam}" project="${projectParam}" → path=${scopedPath ?? 'null'} dirs=${projectDirs.length} projectSkills=${projectSkillCount} globalSkills=${skills.length - projectSkillCount}`);

      // 2) 설치된 플러그인 스킬: ~/.claude/plugins/marketplaces/*/
      const pluginsBase = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
      try {
        if (fs.existsSync(pluginsBase)) {
          // 마켓플레이스 → 플러그인 → skills/ 탐색
          for (const marketplace of fs.readdirSync(pluginsBase, { withFileTypes: true })) {
            if (!marketplace.isDirectory()) continue;
            const mpDir = path.join(pluginsBase, marketplace.name);
            // 최상위 skills/ 폴더 (가장 대표적)
            const topSkills = path.join(mpDir, 'skills');
            const pluginLabel = marketplace.name.replace(/-marketplace$/, '');
            for (const s of scanSkillsDir(topSkills, 'plugin', pluginLabel)) {
              if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
            }
            // plugins/ 하위 (claude-plugins-official 등)
            const pluginsSubDir = path.join(mpDir, 'plugins');
            try {
              if (fs.existsSync(pluginsSubDir)) {
                for (const plugin of fs.readdirSync(pluginsSubDir, { withFileTypes: true })) {
                  if (!plugin.isDirectory()) continue;
                  const pSkills = path.join(pluginsSubDir, plugin.name, 'skills');
                  for (const s of scanSkillsDir(pSkills, 'plugin', plugin.name)) {
                    if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }

      // §5.5 #17-2 v3.19 — CLI 내장 슬래시 명령은 별도 배열로. skills 에 섞지 않아
      // Skills 사이드바(#17-4)는 불변, `/` 자동완성 드롭다운만 병행 표시한다.
      res.json({
        ok: true,
        skills,
        builtins: builtinCommandsService.getCommands(),
        order: appStateGetSkillOrder(),
        favorites: appStateGetSkillFavorites(),
      });
    } catch (err) {
      logger.error('GET /api/available-skills failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.5 #17-4 — 등록된 프로젝트들의 .claude/skills/ 에서 frontmatter name 이 일치하는 스킬 폴더 절대경로 탐색. */
  function findProjectSkillDir(skillName: string): string | null {
    for (const info of Object.values(graphManager.getSnapshot().projects)) {
      const skillsDir = path.join(info.path, '.claude', 'skills');
      try {
        if (!fs.existsSync(skillsDir)) continue;
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dir = path.join(skillsDir, entry.name);
          const parsed = parseSkillMd(path.join(dir, 'SKILL.md'));
          if (parsed && parsed.name === skillName) return dir;
        }
      } catch { /* next project */ }
    }
    return null;
  }

  /** DELETE /api/skill — 프로젝트 스킬을 디스크에서 제거 (source==='project' 만).
   *  frontmatter name 으로 폴더를 찾아 해당 스킬 디렉토리 전체를 삭제하고 고정 순서에서도 제거. */
  app.delete('/api/skill', (req, res) => {
    try {
      const { name, source } = req.body as { name?: string; source?: string };
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name required' });
        return;
      }
      if (source !== 'project') {
        // 플러그인 스킬은 전역 설치본이라 디스크 삭제 대상에서 제외 (프로젝트 스킬만 제거).
        res.status(400).json({ error: 'only project skills can be deleted' });
        return;
      }
      const dir = findProjectSkillDir(name.trim());
      if (!dir) {
        res.status(404).json({ error: 'skill not found' });
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      appStateRemoveSkillFromOrder(name.trim());
      logger.info(`Skill deleted from disk: ${dir} ("${name.trim()}")`);
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/skill failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/skill-order — SkillsView 고정 순서 저장 (type 별 전체 가시 순서 치환). */
  app.put('/api/skill-order', (req, res) => {
    try {
      const { type, order } = req.body as { type?: string; order?: unknown };
      if (type !== 'project' && type !== 'global' && type !== 'plugin') {
        res.status(400).json({ error: 'type must be project|global|plugin' });
        return;
      }
      if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) {
        res.status(400).json({ error: 'order must be string[]' });
        return;
      }
      appStateSetSkillOrder(type, order as string[]);
      res.json({ ok: true, order: appStateGetSkillOrder() });
    } catch (err) {
      logger.error('PUT /api/skill-order failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.5 #17-4 v2.93 — PUT /api/skill-favorites — SkillsView 즐겨찾기 목록 전체 치환(클라가 별 누른 순서대로 전송). */
  app.put('/api/skill-favorites', (req, res) => {
    try {
      const { favorites } = req.body as { favorites?: unknown };
      if (!Array.isArray(favorites) || favorites.some((x) => typeof x !== 'string')) {
        res.status(400).json({ error: 'favorites must be string[]' });
        return;
      }
      appStateSetSkillFavorites(favorites as string[]);
      res.json({ ok: true, favorites: appStateGetSkillFavorites() });
    } catch (err) {
      logger.error('PUT /api/skill-favorites failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/agent-config/:agentId — 에이전트 설정 조회 */
  app.get('/api/agent-config/:agentId', (req, res) => {
    try {
      const config = graphManager.getAgentConfig(req.params.agentId);
      res.json({ ok: true, config: config ?? null });
    } catch (err) {
      logger.error('GET /api/agent-config failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/agent-config/:agentId — 에이전트 설정 저장 */
  app.put('/api/agent-config/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const body = req.body as Partial<AgentConfig>;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'config body required' });
        return;
      }
      // v1.37 — Bash 자동 포함 제거: 툴 구성은 사용자 책임.
      //         Bash 를 제거하면 dispatch curl 경로가 동작 안 할 수 있음 — 사용자가 인지하고 선택.
      const tools = Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === 'string') : [];
      // §5.3 #28 (K) v1.48 — prev config snapshot (rules diff + customMode 전이 감지용)
      const prev = graphManager.getAgentConfig(agentId);
      const prevRules = typeof prev?.rules === 'string' ? prev.rules : '';
      const prevHistory: RulesHistoryEntry[] = Array.isArray(prev?.rulesHistory) ? [...prev.rulesHistory] : [];
      const prevCustomMode = prev?.customMode;
      const incomingCustomMode =
        body.customMode === 'conti' || body.customMode === 'review' || body.customMode === 'debug'
          ? body.customMode
          : undefined;
      const userRules = typeof body.rules === 'string' ? body.rules : '';

      // §5.3 #28 (K) v1.48 — 콘티모드 전이 자동 룰 처리.
      // (i) → 'conti' 진입: rules 를 CONTI_AGENT_RULES 로 강제 덮어쓰기.
      // (ii) 'conti' → 그 외: rules 를 빈 문자열로 비움 (자동 복원 ❌, 사용자가 히스토리에서 직접).
      // (iii) 그 외 변경 없음: 사용자 입력 그대로 보존.
      let nextRules = userRules;
      let autoLabel: 'auto:conti-on' | 'auto:conti-off' | null = null;
      if (incomingCustomMode === 'conti' && prevCustomMode !== 'conti') {
        nextRules = CONTI_AGENT_RULES;
        autoLabel = 'auto:conti-on';
      } else if (prevCustomMode === 'conti' && incomingCustomMode !== 'conti') {
        nextRules = '';
        autoLabel = 'auto:conti-off';
      }

      // §5.3 #28 (K) v1.48 — rules 가 실제로 변경되었고 prev 가 비어있지 않으면 history push.
      // 빈 → 빈 또는 동일 본문은 push 하지 않음(노이즈 방지). 라벨: 자동 전이면 auto:*, 아니면 manual.
      const nextHistory: RulesHistoryEntry[] = [...prevHistory];
      if (prevRules !== nextRules && prevRules !== '') {
        nextHistory.push({
          ts: Date.now(),
          rules: prevRules,
          label: autoLabel ?? 'manual',
        });
        // FIFO drop
        while (nextHistory.length > RULES_HISTORY_MAX) nextHistory.shift();
      }

      const config: AgentConfig = {
        model: typeof body.model === 'string' ? body.model : 'sonnet',
        tools,
        permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : 'default',
        skills: Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === 'string') : [],
        color: typeof body.color === 'string' ? body.color : undefined,
        maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
        isolation: typeof body.isolation === 'string' ? body.isolation : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
        disallowedTools: Array.isArray(body.disallowedTools) ? body.disallowedTools.filter((t): t is string => typeof t === 'string') : undefined,
        memory: typeof body.memory === 'string' ? body.memory : undefined,
        rules: nextRules.trim() ? nextRules : undefined,
        rulesHistory: nextHistory.length > 0 ? nextHistory : undefined,
        // §5.3 #12-1 v1.87 — permissionPromptMode/permissionPromptAllowPatterns 제거. 권한 축은 permissionMode 단일.
        // §5.3 #12-1 v1.90 — 60초 무응답 fallback. 'deny' 만 유효, 그 외(기본)는 undefined=allow 로 저장.
        permissionTimeoutPolicy: body.permissionTimeoutPolicy === 'deny' ? 'deny' : undefined,
        // §5.3 #28 v1.47 — Custom Mode (conti/review/debug). 그 외는 undefined.
        customMode: incomingCustomMode,
        // §4 v1.53 — 1M 컨텍스트 토글. **기본 1M** (undefined → 1M 적용).
        //   - '200k' = 명시적 opt-out (저장됨)
        //   - '1m' = 명시적 opt-in (저장됨, undefined 와 동일 동작)
        //   - 그 외(undefined 포함) = undefined 저장 = 기본 1M
        contextWindow: body.contextWindow === '200k' ? '200k' : body.contextWindow === '1m' ? '1m' : undefined,
        // §4 v1.53 — 프리셋 트레이스 메타. 값 검증은 클라에 위임(자유 문자열).
        presetId: typeof body.presetId === 'string' && body.presetId.trim() ? body.presetId.trim() : undefined,
        // §4 v2.63 — executionMode 는 에이전트 정체성(CMD vs 헤드리스)이라 AgentConfigPopup 이 보내지 않는다.
        //   PUT 이 config 를 새로 빌드하므로 여기서 prev 값을 명시 보존하지 않으면 설정 저장 시 CMD→커스텀 으로
        //   되돌아간다(회귀). body 에 명시값이 오면 그걸, 아니면 이전 값을 유지.
        executionMode:
          body.executionMode === 'interactive-terminal' || body.executionMode === 'headless'
            ? body.executionMode
            : prev?.executionMode,
        // §4 v2.88 — API 비용 상한(달러). 양수만 저장, 그 외(0/미설정)는 undefined = 무제한.
        maxBudgetUsd: typeof body.maxBudgetUsd === 'number' && body.maxBudgetUsd > 0 ? body.maxBudgetUsd : undefined,
      };
      // §5.3 #28 v1.47 — Custom Mode 는 커스텀 에이전트(customCreated=true) 에만 켤 수 있음.
      // Hook 에이전트는 사용자가 직접 만든 게 아니라 모드 강제 부착 ❌.
      if (config.customMode) {
        const snap = graphManager.getSnapshot();
        const agent = snap.agents.find((a) => a.id === agentId);
        if (!agent || !agent.customCreated) {
          res.status(400).json({ error: 'customMode is only allowed on custom-created agents' });
          return;
        }
      }
      graphManager.setAgentConfig(agentId, config);
      // §5.3 #28 v1.47 — customMode='conti' 최초 활성화 시 빈 conti 1건 자동 생성 (LLM 호출 ❌)
      if (config.customMode === 'conti') {
        const existing = graphManager.getContisByAgent(agentId);
        if (existing.length === 0) {
          const empty = createEmptyConti(agentId);
          graphManager.addConti(empty);
          broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: empty.id, agentId } });
        }
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PUT /api/agent-config failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.3 #12-1 v1.43 — POST /api/permission-check
   * PreToolUse 훅이 동기 호출. 해당 세션/subagent 가 Vibisual 관할 + ask 모드면 broker 에 큐잉 후
   * 사용자 결정을 기다렸다가 `{decision:'allow'|'deny'}` 반환. 그 외는 즉시 allow.
   */
  app.post('/api/permission-check', async (req, res) => {
    try {
      interface Body {
        sessionId?: string;
        /** env VIBISUAL_SUBAGENT_ID */
        subAgentId?: string;
        /** env VIBISUAL_PARENT_AGENT_ID — 설정의 owner */
        parentAgentId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        cwd?: string;
      }
      const body = (req.body ?? {}) as Body;

      const toolName = typeof body.toolName === 'string' ? body.toolName : '';
      const toolInput = (body.toolInput ?? {}) as Record<string, unknown>;

      // 1) 관할 에이전트 resolve — parentAgentId 우선, 그 다음 sessionId 역방향.
      let agentId: string | null = body.parentAgentId ?? null;
      if (!agentId && typeof body.sessionId === 'string') {
        agentId = graphManager.findAgentIdBySession(body.sessionId);
      }
      if (!agentId) {
        // Vibisual 관할이 아님 — 즉시 통과
        res.json({ ok: true, decision: 'allow', reason: 'not-managed' });
        return;
      }

      // §5.3 #12-1 v1.87 — 권한 승인 팝업은 **커스텀 에이전트 전용**.
      // 훅으로 생성된 에이전트 버블(사용자의 Claude Code 세션 시각화)은 view-only —
      // 절대 승인 모달을 띄우지 않는다(이 세션 자신의 도구 호출을 막아선 안 됨).
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        res.json({ ok: true, decision: 'allow', reason: 'view-only-agent' });
        return;
      }

      const config = graphManager.getAgentConfig(agentId);
      if (!config) {
        // 설정 없음 — 막을 근거 없음, 통과
        res.json({ ok: true, decision: 'allow', reason: 'no-config' });
        return;
      }

      // §5.3 #12-1 v1.87 — 권한 축 = permissionMode 단일. CC 정식 권한모델에 팝업 발동을 매핑:
      //   bypassPermissions → 무확인 / plan → 실행차단은 CC 자체 / 읽기전용 → 자동 allow
      //   acceptEdits → 편집계열 자동 allow / default·acceptEdits(비편집 가변) → 사용자 확인 팝업
      const mode = config.permissionMode || 'default';
      const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

      if (mode === 'bypassPermissions') {
        res.json({ ok: true, decision: 'allow', reason: 'bypass' });
        return;
      }
      if (mode === 'plan') {
        res.json({ ok: true, decision: 'allow', reason: 'plan' });
        return;
      }
      if (READ_TOOLS.has(toolName)) {
        res.json({ ok: true, decision: 'allow', reason: 'read-only' });
        return;
      }
      if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
        res.json({ ok: true, decision: 'allow', reason: 'accept-edits' });
        return;
      }

      // 가변 도구 + (default | acceptEdits 비편집) → broker 큐잉, 클라 응답 대기
      const agentLabel = agentNode.label ?? agentId;
      const agentColor = config.color ?? BUBBLE_COLORS.agent;
      const projectName = graphManager.getAgentProjectName(agentId) ?? '';

      // §5.3 #12-1 v1.90 — 60초 무응답 fallback 정책 (기본 allow).
      const timeoutPolicy = config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow';
      // §5.3 #12-1 v1.91 — 팝업 대기 동안 에이전트를 "블록된 활성"으로 고정(completed 강등 방지).
      graphManager.setPermissionWaiting(agentId, true);
      broadcastSnapshot();
      let decision;
      try {
        decision = await permissionBroker.request({
          agentId,
          // §5.3 #12-1 v1.96 — sub 인스턴스 ID 를 stamp 해서 broker resolve 후
          // 사용자의 Allow/Deny 결정을 그 sub 의 stream 라인으로 합성할 수 있게 한다.
          subAgentId: typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          agentLabel,
          agentColor,
          projectName,
          toolName,
          toolInput,
        }, timeoutPolicy);
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }
      res.json({ ok: true, decision: decision.decision, reason: decision.reason });
    } catch (err) {
      logger.error('POST /api/permission-check failed', err);
      // safe-deny on error
      res.status(500).json({ ok: false, decision: 'deny', reason: 'internal-error' });
    }
  });

  /**
   * §5.3 #12-1 v1.43 — POST /api/permission-decide
   * 클라 모달에서 Allow/Deny 버튼 클릭 시 호출. broker 의 pending 요청 해제.
   */
  app.post('/api/permission-decide', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<PermissionDecision>;
      if (typeof body.requestId !== 'string' || (body.decision !== 'allow' && body.decision !== 'deny')) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const resolved = permissionBroker.resolve({
        requestId: body.requestId,
        decision: body.decision,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      if (!resolved) {
        res.status(404).json({ ok: false, error: 'request not found (possibly timed out)' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/permission-decide failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.7 #23-1 v1.59 — GET /api/claude-version
   * 현재 사용 중인 `claude` 바이너리 버전 + npm registry latest 비교 결과.
   * latest 는 5분 TTL 캐시 — `?refresh=1` 로 무효화 가능.
   */
  app.get('/api/claude-version', async (req, res) => {
    try {
      const force = req.query['refresh'] === '1';
      const info = await getClaudeVersionInfo(force);
      res.json({ ok: true, info });
    } catch (err) {
      logger.error('GET /api/claude-version failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §4 v2.43 — GET /api/claude-installs
   * 옵션창 Version 탭 데이터: PC 에 깔린 모든 claude 설치본 + 현재 활성/선택 + Vibisual·런타임 메타 + npm latest.
   * `?refresh=1` 로 registry 캐시 무효화. 선택 저장은 기존 `PUT /api/user-defaults {claudeBinPath}` 재사용.
   */
  app.get('/api/claude-installs', async (req, res) => {
    try {
      const force = req.query['refresh'] === '1';
      const info = await getClaudeInstallsInfo(force);
      res.json({ ok: true, info });
    } catch (err) {
      logger.error('GET /api/claude-installs failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §5.7 #23-1 v1.59 — POST /api/claude-version/install
   * `npm install -g @anthropic-ai/claude-code` 1회 발사. 단일 in-flight 락 — 동시 호출은 같은 installId 반환.
   * 진행 상황은 WS `claude_install_progress` 로 푸시.
   */
  app.post('/api/claude-version/install', (_req, res) => {
    try {
      const progress = installLatestClaude();
      res.json({ ok: true, progress });
    } catch (err) {
      logger.error('POST /api/claude-version/install failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §5.7 #23-1 v1.59 — GET /api/claude-version/install
   * 진행 중인 설치 작업 상태 조회 (WS 재연결/페이지 reload 복구용).
   */
  app.get('/api/claude-version/install', (_req, res) => {
    res.json({ ok: true, progress: getInflightInstall() });
  });

  /**
   * §5.7 #23-1 v1.59 — POST /api/claude-version/dismiss-session
   * 사용자가 "이번 세션 건너뛰기" 또는 "이 버전 계속 쓰기" 선택 — registry 캐시 무효화로
   * 다음 세션(페이지 새로고침) 시 신선한 결과를 받게 한다.
   */
  app.post('/api/claude-version/dismiss-session', (_req, res) => {
    invalidateLatestCache();
    res.json({ ok: true });
  });

  /**
   * §5.3 #12-1 v1.43 — GET /api/permission-pending
   * 클라 재연결 시 현재 대기 중인 권한 요청 복구용.
   */
  app.get('/api/permission-pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: permissionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/permission-pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §5.3 #12-2 v2.26 — POST /api/ask-user-question
   * PreToolUse 훅이 `tool_name === 'AskUserQuestion'` 분기에서 동기 호출.
   * 커스텀 에이전트가 호출자면 broker 큐잉 → 사용자 응답 또는 60s 타임아웃까지 대기.
   * 응답은 `{ decision: 'answer' | 'timeout' | 'reject', selectedLabels: string[], note?: string }`.
   * 훅은 이 결과를 `permissionDecisionReason` 으로 합성해 모델 transcript 로 도달시킨다.
   */
  app.post('/api/ask-user-question', async (req, res) => {
    try {
      interface Body {
        sessionId?: string;
        subAgentId?: string;
        parentAgentId?: string;
        toolInput?: Record<string, unknown>;
      }
      const body = (req.body ?? {}) as Body;
      const rawInput = (body.toolInput ?? {}) as Partial<AskUserQuestionToolInput>;

      // 1) 관할 에이전트 resolve.
      let agentId: string | null = body.parentAgentId ?? null;
      if (!agentId && typeof body.sessionId === 'string') {
        agentId = graphManager.findAgentIdBySession(body.sessionId);
      }
      if (!agentId) {
        res.json({ ok: true, decision: 'reject', reason: 'not-managed', selectedLabels: [] });
        return;
      }

      // 2) 커스텀 에이전트 가드(view-only 제외) — §5.3 #12-1 v1.87 패턴 재사용.
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        res.json({ ok: true, decision: 'reject', reason: 'view-only-agent', selectedLabels: [] });
        return;
      }

      // 3) toolInput 유효성 — claude-code v2.1.145+ 스키마는 `questions: AskUserQuestionItem[]`.
      //    CLI 와 동일하게 모든 질문을 순차로 surface — 본 라운드는 한 카드에 step 으로 묶어 답한다.
      const questionsRaw = Array.isArray(rawInput.questions) ? rawInput.questions : [];
      const items: AskUserQuestionItem[] = questionsRaw
        .map((q): AskUserQuestionItem | null => {
          if (!q || typeof q !== 'object') return null;
          const qq = q as Partial<AskUserQuestionItem>;
          const question = typeof qq.question === 'string' ? qq.question : '';
          const optionsRaw = Array.isArray(qq.options) ? qq.options : [];
          const options: AskUserQuestionOption[] = optionsRaw
            .filter((o): o is AskUserQuestionOption => !!o && typeof (o as AskUserQuestionOption).label === 'string')
            .map((o) => ({
              label: o.label,
              description: typeof o.description === 'string' && o.description ? o.description : undefined,
            }))
            .slice(0, 4);
          if (!question || options.length === 0) return null;
          const item: AskUserQuestionItem = {
            question,
            multiSelect: qq.multiSelect === true,
            options,
          };
          if (typeof qq.header === 'string' && qq.header) item.header = qq.header;
          return item;
        })
        .filter((q): q is AskUserQuestionItem => q !== null);
      if (items.length === 0) {
        res.json({ ok: true, decision: 'reject', reason: 'invalid-input', answers: [] });
        return;
      }

      // 4) UI 메타 stamp.
      const config = graphManager.getAgentConfig(agentId);
      const agentLabel = agentNode.label ?? agentId;
      const agentColor = config?.color ?? BUBBLE_COLORS.agent;
      const projectName = graphManager.getAgentProjectName(agentId) ?? '';

      // §5.3 #12-1 v1.91 — 훅 hold 중 "블록된 활성" 으로 고정.
      graphManager.setPermissionWaiting(agentId, true);
      broadcastSnapshot();
      let decision: AskUserQuestionDecision;
      try {
        decision = await askUserQuestionBroker.request({
          agentId,
          subAgentId: typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          agentLabel,
          agentColor,
          projectName,
          items,
        });
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }

      // 훅이 reason 합성에 사용할 수 있게 items 의 question 본문과 answers 를 함께 회신.
      // 모델 transcript 도달은 hook handler 에서 단일 reason 문자열로 포매팅.
      const answersOut = items.map((item, i) => {
        const ans = decision.answers[i];
        return {
          question: item.question,
          selectedLabels: ans?.selectedLabels ?? [],
          note: ans?.note,
        };
      });
      res.json({
        ok: true,
        decision: decision.reason === 'timeout' ? 'timeout' : 'answer',
        answers: answersOut,
      });
    } catch (err) {
      logger.error('POST /api/ask-user-question failed', err);
      res.status(500).json({ ok: false, decision: 'reject', reason: 'internal-error', selectedLabels: [] });
    }
  });

  /**
   * §5.3 #12-2 v2.26 — POST /api/ask-user-question/decide
   * 클라 IDE 카드의 Send 버튼이 호출. broker pending 해제.
   */
  app.post('/api/ask-user-question/decide', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AskUserQuestionDecision>;
      if (typeof body.requestId !== 'string' || !Array.isArray(body.answers)) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const answers: AskUserQuestionAnswer[] = body.answers
        .map((a) => {
          if (!a || typeof a !== 'object') return null;
          const aa = a as Partial<AskUserQuestionAnswer>;
          const labels = Array.isArray(aa.selectedLabels)
            ? aa.selectedLabels.filter((s): s is string => typeof s === 'string')
            : [];
          const ans: AskUserQuestionAnswer = { selectedLabels: labels };
          if (typeof aa.note === 'string' && aa.note) ans.note = aa.note;
          return ans;
        })
        .filter((a): a is AskUserQuestionAnswer => a !== null);
      const resolved = askUserQuestionBroker.resolve({
        requestId: body.requestId,
        answers,
        reason: 'user',
      });
      if (!resolved) {
        res.status(404).json({ ok: false, error: 'request not found (possibly timed out)' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/ask-user-question/decide failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.3 #12-2 v2.26 — GET /api/ask-user-question/pending
   * 클라 재연결 시 대기 중인 질문 복구용.
   */
  app.get('/api/ask-user-question/pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: askUserQuestionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/ask-user-question/pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §4 v2.52 — POST /api/agent-report
   * 커스텀/스폰 에이전트가 작업 완료 시 did/userActions 를 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 색 구분 카드 렌더.
   * 표시 전용 — 게임플레이/판정 로직과 무관. Hook 에이전트는 신고 지시문이 없어 호출하지 않음.
   */
  app.post('/api/agent-report', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentReport>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const toStrArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
      const did = toStrArray(body.did);
      const userActions = toStrArray(body.userActions);
      const nextSteps = toStrArray(body.nextSteps);
      // 내용이 전혀 없으면 무시 (빈 신고로 카드만 늘리지 않음)
      if (did.length === 0 && userActions.length === 0 && nextSteps.length === 0) {
        res.status(400).json({ ok: false, error: 'empty report' });
        return;
      }
      const report: AgentReport = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        did,
        userActions,
        ...(nextSteps.length > 0 ? { nextSteps } : {}),
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentReport(report);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_report', payload: { agentId: report.agentId, subAgentId: report.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: report.id });
    } catch (err) {
      logger.error('POST /api/agent-report failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 v2.60 — POST /api/agent-questions
   * 커스텀/스폰 에이전트가 사용자에게 던지는 질문(1~N) + 제안 프롬프트를 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 질문 카드 렌더.
   * 표시 전용. Hook 에이전트는 지시문이 없어 호출하지 않음. agent-report 와 동형 골격.
   */
  app.post('/api/agent-questions', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentQuestions>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      // items 정규화 — question 비어있는 항목 버림, prompts 는 비문자열/공백 제거.
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const items: AgentQuestionItem[] = [];
      for (const it of rawItems) {
        if (!it || typeof it !== 'object') continue;
        const question = typeof it.question === 'string' ? it.question.trim() : '';
        if (!question) continue;
        const prompts = Array.isArray(it.prompts)
          ? it.prompts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
          : [];
        items.push({
          question,
          ...(typeof it.header === 'string' && it.header.trim() ? { header: it.header.trim() } : {}),
          prompts,
        });
      }
      if (items.length === 0) {
        res.status(400).json({ ok: false, error: 'empty questions' });
        return;
      }
      const questions: AgentQuestions = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        items,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentQuestions(questions);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_questions', payload: { agentId: questions.agentId, subAgentId: questions.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: questions.id });
    } catch (err) {
      logger.error('POST /api/agent-questions failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 v2.70 — POST /api/agent-review
   * 커스텀/스폰 에이전트가 사용자 지시 작업을 완료한 뒤 changes/checkpoints 검수 요청을 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 보라색 검수 카드 렌더.
   * userActions("직접 해")와 성격이 다르다 — 이쪽은 "AI 가 완료한 결과를 검수". agent-report/agent-questions 와 동형 골격.
   */
  app.post('/api/agent-review', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentReview>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const toStrArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()) : [];
      const changes = toStrArray(body.changes);
      const checkpoints = toStrArray(body.checkpoints);
      // changes 가 비면 검수 요청으로서 의미가 없으므로 무시 (빈 카드만 늘리지 않음).
      if (changes.length === 0) {
        res.status(400).json({ ok: false, error: 'empty review (changes required)' });
        return;
      }
      const review: AgentReview = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        ...(typeof body.instruction === 'string' && body.instruction.trim() ? { instruction: body.instruction.trim() } : {}),
        changes,
        checkpoints,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentReview(review);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_review', payload: { agentId: review.agentId, subAgentId: review.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: review.id });
    } catch (err) {
      logger.error('POST /api/agent-review failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 v2.84 — POST /api/agent-list
   * 커스텀/스폰 에이전트가 답변의 번호/순서 목록을 items 배열로 구조화 신고(loopback curl, 토큰 인증).
   * 서버가 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 번호를 자동으로 매겨 정렬 카드 렌더.
   * 번호 매김은 IDE 가 하므로 항목 텍스트만 받는다. agent-report/agent-questions/agent-review 와 동형 골격.
   */
  app.post('/api/agent-list', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentList>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const items = Array.isArray(body.items)
        ? body.items.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : [];
      // items 가 비면 목록 카드로서 의미가 없으므로 무시 (빈 카드만 늘리지 않음).
      if (items.length === 0) {
        res.status(400).json({ ok: false, error: 'empty list (items required)' });
        return;
      }
      const list: AgentList = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        ...(typeof body.title === 'string' && body.title.trim() ? { title: body.title.trim() } : {}),
        items,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentList(list);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_list', payload: { agentId: list.agentId, subAgentId: list.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: list.id });
    } catch (err) {
      logger.error('POST /api/agent-list failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §7.11 v2.29 — POST /api/agent-iframe
   * 커스텀/스폰 에이전트가 "사용자가 열어볼 로컬 서버" 를 띄웠을 때 그 URL 을 신고(loopback curl, 토큰 인증).
   * 서버는 agentId 소속 세션을 찾아 그 URL 로 iframe 위성을 **직접** 생성한다(정규식 추측 없이 결정론적).
   * 진짜 서버만: isPortAlive 로 확인된 뒤에만 위성 생성(reportIframeFromAgent 가 boot race 재시도). 중복 없음:
   * 위성 키가 (세션,포트)라 같은 포트 재신고·감지 폴백과 하나로 합류. agent-report 와 동형 골격.
   */
  app.post('/api/agent-iframe', (req, res) => {
    try {
      const body = (req.body ?? {}) as { agentId?: unknown; url?: unknown };
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      if (typeof body.url !== 'string' || !body.url.trim()) {
        res.status(400).json({ ok: false, error: 'url required' });
        return;
      }
      const ok = graphManager.reportAgentIframe(body.agentId, body.url.trim());
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found or invalid url' });
        return;
      }
      // 위성은 isPortAlive 확인 후 async 로 생기며, 그 시점 onSnapshotChange 가 broadcast 를 다시 친다.
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/agent-iframe failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 v3.21 — POST /api/agent-feedback
   * 사용자가 IDE 에서 AI 작업 결과(작업 신고/검수 카드/스트림 result)에 남기는 좋아요/싫어요.
   * targetId 별 upsert — 같은 대상 재평가는 verdict 교체, `verdict:null` 은 평가 철회(제거).
   * 클라 UI 발신(렌더러 in-process fetch)이라 loopback 토큰 화이트리스트 불필요.
   * 표시·학습 보조 전용 — 실제 작업/판정 로직 무관.
   */
  app.post('/api/agent-feedback', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentFeedback> & { verdict?: AgentFeedbackVerdict | null };
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const targetTypes: AgentFeedbackTargetType[] = ['report', 'review', 'result'];
      const targetType = targetTypes.find((t) => t === body.targetType);
      if (!targetType || typeof body.targetId !== 'string' || !body.targetId) {
        res.status(400).json({ ok: false, error: 'targetType/targetId required' });
        return;
      }
      // verdict:null = 평가 철회 (해당 target 의 기존 피드백 제거)
      if (body.verdict == null) {
        const removed = graphManager.removeAgentFeedback(body.agentId, targetType, body.targetId);
        if (removed) {
          broadcast({ type: 'agent_feedback', payload: { agentId: body.agentId } } as WSMessage);
          broadcastSnapshot();
          saveCheckpoint();
        }
        res.json({ ok: true, removed });
        return;
      }
      if (body.verdict !== 'up' && body.verdict !== 'down') {
        res.status(400).json({ ok: false, error: 'verdict must be up/down/null' });
        return;
      }
      const summary = Array.isArray(body.summary)
        ? body.summary
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim().slice(0, AGENT_FEEDBACK_SUMMARY_ITEM_MAX))
            .slice(0, 5)
        : [];
      const feedback: AgentFeedback = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        targetType,
        targetId: body.targetId,
        verdict: body.verdict,
        ...(typeof body.reason === 'string' && body.reason.trim() ? { reason: body.reason.trim() } : {}),
        summary,
        createdAt: Date.now(),
      };
      const ok = graphManager.setAgentFeedback(feedback);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_feedback', payload: { agentId: feedback.agentId, subAgentId: feedback.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: feedback.id });
    } catch (err) {
      logger.error('POST /api/agent-feedback failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 v3.21 — POST /api/agent-feedback/:agentId/distill
   * 이 에이전트의 싫어요 피드백을 one-shot claude CLI(haiku)로 규칙 문장으로 증류해 **제안만 반환**.
   * 적용은 사용자가 클라 확인 모달에서 승인 후 기존 `PUT /api/agent-config/:agentId` rules append 로
   * (rulesHistory 롤백 가능). 자동 append 금지 — 일회성 싫어요의 영구 규칙화 방지.
   */
  app.post('/api/agent-feedback/:agentId/distill', async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const feedbacks = graphManager.getAgentFeedbacksForAgent(agentId);
      if (!feedbacks.some((f) => f.verdict === 'down')) {
        res.status(422).json({ ok: false, error: 'no down feedback to distill' });
        return;
      }
      const proposal = await distillFeedbackToRules(feedbacks);
      if (!proposal) {
        res.status(502).json({ ok: false, error: 'distill failed' });
        return;
      }
      res.json({ ok: true, proposal });
    } catch (err) {
      logger.error('POST /api/agent-feedback/:agentId/distill failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** GET /api/project-context — 프로젝트 컨텍스트 (프롬프트에 주입되는 것들) 조회 */
  app.get('/api/project-context', (_req, res) => {
    try {
      const root = findProjectRoot(process.cwd());
      const home = os.homedir();
      interface CtxItem { name: string; type: 'readable' | 'not_accessible'; summary?: string; lines?: number; path?: string }
      const items: CtxItem[] = [];

      // ─ Readable: CLAUDE.md (project)
      const claudeMd = path.join(root, 'CLAUDE.md');
      if (fs.existsSync(claudeMd)) {
        const content = fs.readFileSync(claudeMd, 'utf-8');
        const headings = content.split('\n').filter(l => l.startsWith('#')).slice(0, 8).map(h => h.replace(/^#+\s*/, ''));
        items.push({ name: 'CLAUDE.md', type: 'readable', summary: headings.join(' / '), lines: content.split('\n').length, path: claudeMd });
      }

      // ─ Readable: ~/.claude/CLAUDE.md (user-level)
      const userClaudeMd = path.join(home, '.claude', 'CLAUDE.md');
      if (fs.existsSync(userClaudeMd)) {
        const content = fs.readFileSync(userClaudeMd, 'utf-8');
        items.push({ name: '~/.claude/CLAUDE.md', type: 'readable', summary: `User-level instructions (${content.split('\n').length} lines)`, lines: content.split('\n').length, path: userClaudeMd });
      }

      // ─ Readable: .claude/settings.local.json (project settings)
      const projSettings = path.join(root, '.claude', 'settings.local.json');
      if (fs.existsSync(projSettings)) {
        try {
          const data = JSON.parse(fs.readFileSync(projSettings, 'utf-8')) as Record<string, unknown>;
          const keys = Object.keys(data);
          const hookCount = data['hooks'] && typeof data['hooks'] === 'object' ? Object.keys(data['hooks'] as object).length : 0;
          items.push({ name: '.claude/settings.local.json', type: 'readable', summary: `Keys: ${keys.join(', ')}${hookCount > 0 ? ` (${hookCount} hook events)` : ''}`, path: projSettings });
        } catch { items.push({ name: '.claude/settings.local.json', type: 'readable', summary: 'Parse error', path: projSettings }); }
      }

      // ─ Readable: ~/.claude/settings.json (global settings)
      const globalSettings = path.join(home, '.claude', 'settings.json');
      if (fs.existsSync(globalSettings)) {
        try {
          const data = JSON.parse(fs.readFileSync(globalSettings, 'utf-8')) as Record<string, unknown>;
          const hookCount = data['hooks'] && typeof data['hooks'] === 'object' ? Object.keys(data['hooks'] as object).length : 0;
          items.push({ name: '~/.claude/settings.json', type: 'readable', summary: `Global settings${hookCount > 0 ? ` (${hookCount} hook events)` : ''}`, path: globalSettings });
        } catch { items.push({ name: '~/.claude/settings.json', type: 'readable', summary: 'Parse error', path: globalSettings }); }
      }

      // ─ Readable: Agent definitions
      const agentsDir = path.join(root, '.claude', 'agents');
      if (fs.existsSync(agentsDir)) {
        const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
        items.push({ name: '.claude/agents/', type: 'readable', summary: `${agents.length} agents: ${agents.map(f => f.replace('.md', '')).join(', ')}`, path: agentsDir });
      }

      // ─ Readable: Memory
      const memGlob = path.join(home, '.claude', 'projects');
      const memoryMd = findMemoryMd(memGlob, root);
      if (memoryMd) {
        const content = fs.readFileSync(memoryMd, 'utf-8');
        const entries = content.split('\n').filter(l => l.trim().startsWith('- [')).length;
        items.push({ name: 'MEMORY.md', type: 'readable', summary: `${entries} memory entries`, lines: content.split('\n').length, path: memoryMd });
      }

      // ─ Readable: Skills
      const skillsDir = path.join(root, '.claude', 'skills');
      if (fs.existsSync(skillsDir)) {
        const skills = fs.readdirSync(skillsDir).filter(f => fs.existsSync(path.join(skillsDir, f, 'SKILL.md')));
        if (skills.length > 0) {
          items.push({ name: '.claude/skills/', type: 'readable', summary: `${skills.length} skills: ${skills.join(', ')}`, path: skillsDir });
        }
      }

      // ─ Not accessible (Claude Code internal)
      items.push({ name: 'Built-in system prompt', type: 'not_accessible', summary: 'Claude Code core instructions, tool definitions, safety rules. Not readable from outside.' });
      items.push({ name: 'IDE context', type: 'not_accessible', summary: 'Open files, cursor position, selected text, workspace state.' });
      items.push({ name: 'Git status snapshot', type: 'not_accessible', summary: 'Branch, uncommitted changes, recent commits — injected at session start.' });
      items.push({ name: 'Conversation history', type: 'not_accessible', summary: 'All prior messages in the current session, compressed when nearing context limit.' });
      items.push({ name: 'Deferred tools list', type: 'not_accessible', summary: 'Available tools and MCP server tools registered in the session.' });
      items.push({ name: 'Model capabilities', type: 'not_accessible', summary: 'Active model ID, context window size, available features.' });

      res.json({ ok: true, items });
    } catch (err) {
      logger.error('GET /api/project-context failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** MEMORY.md를 프로젝트별 경로에서 찾는 헬퍼 */
  function findMemoryMd(projectsBase: string, projectRoot: string): string | null {
    if (!fs.existsSync(projectsBase)) return null;
    // .claude/projects/ 아래에서 현재 프로젝트에 매칭되는 디렉토리 탐색
    try {
      const dirs = fs.readdirSync(projectsBase);
      for (const d of dirs) {
        const memDir = path.join(projectsBase, d, 'memory', 'MEMORY.md');
        if (fs.existsSync(memDir)) {
          // 디렉토리 이름에 프로젝트 경로가 인코딩되어 있는지 확인
          const normalized = projectRoot.replace(/[/\\:]/g, '-').toLowerCase();
          if (d.toLowerCase().includes('vibisual') || d.toLowerCase().includes(normalized)) {
            return memDir;
          }
        }
      }
      // fallback: 첫 번째 발견된 MEMORY.md
      for (const d of dirs) {
        const memDir = path.join(projectsBase, d, 'memory', 'MEMORY.md');
        if (fs.existsSync(memDir)) return memDir;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** POST /api/open-context-path — 프로젝트 컨텍스트 파일/폴더 열기 */
  app.post('/api/open-context-path', (req, res) => {
    try {
      const { filePath, mode } = req.body as { filePath?: string; mode?: string };
      if (typeof filePath !== 'string') { res.status(400).json({ error: 'filePath required' }); return; }
      // 컨텍스트 파일은 프로젝트 루트 또는 홈 `~/.claude`(CLAUDE.md·settings·memory 등) 내부만 허용.
      // project-context 가 노출하는 경로 집합과 일치 — 임의 절대경로 열기 차단(모바일 페어링 기기 포함).
      const resolved = path.resolve(filePath);
      if (!isWithinOpenableRoots(resolved, [path.join(os.homedir(), '.claude')])) {
        logger.warn(`open-context-path blocked (outside allowed roots): "${filePath}"`);
        res.status(403).json({ error: 'Path outside allowed roots' });
        return;
      }
      if (!fs.existsSync(resolved)) { res.status(404).json({ error: 'Path not found' }); return; }
      if (mode === 'folder') {
        const dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
        openFolder(dir);
      } else {
        openFile(resolved);
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-context-path failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/position — 버블 위치 저장 (드래그 후) */
  app.patch('/api/bubble/:nodeId/position', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { x, y } = req.body as { x?: number; y?: number };
      if (typeof x !== 'number' || typeof y !== 'number') {
        res.status(400).json({ error: 'x and y required' });
        return;
      }
      graphManager.updateBubblePosition(nodeId, x, y);
      saveCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/position failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** 물리 엔진 위치 일괄 저장 (PATCH + POST — sendBeacon은 POST만 지원) */
  function handleBatchPositions(req: import('express').Request, res: import('express').Response): void {
    try {
      const { positions } = req.body as { positions?: Array<{ id: string; x: number; y: number }> };
      if (!Array.isArray(positions)) {
        res.status(400).json({ error: 'positions array required' });
        return;
      }
      graphManager.updateBubblePositionsBatch(positions);
      saveCheckpoint();
      logger.info(`Batch positions saved: ${positions.length} nodes`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      res.json({ ok: true });
    } catch (err) {
      logger.error('batch positions save failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  app.patch('/api/bubbles/positions', handleBatchPositions);
  app.post('/api/bubbles/positions', handleBatchPositions);

  /** DELETE /api/bubble/:nodeId — 버블 삭제 (에이전트가 다시 사용하면 재생성) */
  app.delete('/api/bubble/:nodeId', (req, res) => {
    try {
      const { nodeId } = req.params;
      logger.info(`DELETE /api/bubble/${nodeId}`);
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      // preserve-pin 가드 (§2.4 v1.28)
      if (graphManager.isPreservePinned(nodeId)) {
        logger.info(`DELETE /api/bubble/${nodeId} blocked: preserve-pinned`);
        res.status(409).json({ error: 'bubble preserved', reason: 'preserve-pinned' });
        return;
      }
      // v1.85 — 사용자 명시 버블 삭제: 에이전트면 그 Task Edge 까지 cascade 제거(고아 방지).
      graphManager.removeBubble(nodeId, { purgeTaskEdges: true });
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/bubble failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/bubbles/delete — 버블 일괄 삭제 (Shift 다중 선택 → 한 번의 스냅샷으로 동시 제거) */
  app.post('/api/bubbles/delete', (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids array required' });
        return;
      }
      const deleted: string[] = [];
      const blocked: string[] = [];
      for (const nodeId of ids) {
        if (!nodeId) continue;
        // preserve-pin 가드 (§2.4 v1.28) — 차단된 건 건너뛰고 나머지는 계속 삭제
        if (graphManager.isPreservePinned(nodeId)) {
          blocked.push(nodeId);
          continue;
        }
        // v1.85 — 사용자 명시 일괄 삭제: 에이전트면 Task Edge 까지 cascade 제거.
        graphManager.removeBubble(nodeId, { purgeTaskEdges: true });
        deleted.push(nodeId);
      }
      logger.info(`POST /api/bubbles/delete — removed ${deleted.length}, blocked ${blocked.length}`);
      // 한 번만 스냅샷 브로드캐스트 → 클라이언트가 선택 버블을 동시에 제거
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true, deleted, blocked });
    } catch (err) {
      logger.error('POST /api/bubbles/delete failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/preserve-pin — preserve-pin 토글 (§2.4 v1.28) */
  app.patch('/api/bubble/:nodeId/preserve-pin', (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const next = graphManager.togglePreservePinned(nodeId);
      if (next === null) {
        res.status(404).json({ error: 'Bubble not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, preservePinned: next });
    } catch (err) {
      logger.error('PATCH /api/bubble/preserve-pin failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/disappear-pause — 소멸 중단/재개 토글 */
  app.patch('/api/bubble/:nodeId/disappear-pause', (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const paused = graphManager.toggleDisappearPause(nodeId, 60);
      if (paused === null) {
        res.status(404).json({ error: 'Bubble not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, paused });
    } catch (err) {
      logger.error('PATCH /api/bubble/disappear-pause failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/disappear — 버블을 disappearing 상태로 전환 */
  app.patch('/api/bubble/:nodeId/disappear', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { duration } = req.body as { duration?: number };
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      graphManager.setDisappear(nodeId, duration ?? 60);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/disappear failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/folder-files — 폴더의 파일 트리 (디스크 기반) */
  app.get('/api/folder-files', (req, res) => {
    try {
      const nodePath = req.query['nodePath'];
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath query required' });
        return;
      }
      const tree = graphManager.listFolderFiles(nodePath);
      if (!tree) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      res.json({ files: tree });
    } catch (err) {
      logger.error('GET /api/folder-files failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/satellite/toggle — 위성 표시 토글 */
  app.post('/api/satellite/toggle', (req, res) => {
    try {
      const { folderPath, filePath, show } = req.body as {
        folderPath?: string;
        filePath?: string;
        show?: boolean;
      };
      if (typeof folderPath !== 'string' || typeof filePath !== 'string' || typeof show !== 'boolean') {
        res.status(400).json({ error: 'folderPath, filePath, show required' });
        return;
      }
      const ok = graphManager.toggleSatellite(folderPath, filePath, show);
      if (!ok) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/satellite/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/satellite/max — 폴더별 위성 표시 상한 편집 (§7.5) */
  app.post('/api/satellite/max', (req, res) => {
    try {
      const { folderPath, max } = req.body as { folderPath?: string; max?: number };
      if (typeof folderPath !== 'string' || typeof max !== 'number' || !Number.isFinite(max)) {
        res.status(400).json({ error: 'folderPath, max required' });
        return;
      }
      const ok = graphManager.setFolderMaxSatellites(folderPath, max);
      if (!ok) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/satellite/max failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/file-edits/unlimited — 파일 버블별 diff 무한 저장 토글 (§7.4) */
  app.post('/api/file-edits/unlimited', (req, res) => {
    try {
      const { nodePath, unlimited } = req.body as { nodePath?: string; unlimited?: boolean };
      if (typeof nodePath !== 'string' || typeof unlimited !== 'boolean') {
        res.status(400).json({ error: 'nodePath, unlimited required' });
        return;
      }
      const ok = graphManager.setFileEditsUnlimited(nodePath, unlimited);
      if (!ok) {
        res.status(404).json({ error: 'File node not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/file-edits/unlimited failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/root/toggle — 루트 패널에서 독립 버블 추가/제거 (폴더 내부 Root도 지원) */
  app.post('/api/root/toggle', (req, res) => {
    try {
      const { projectName, filePath, show, parentPath } = req.body as {
        projectName?: string;
        filePath?: string;
        show?: boolean;
        parentPath?: string;
      };
      if (typeof projectName !== 'string' || typeof filePath !== 'string' || typeof show !== 'boolean') {
        res.status(400).json({ error: 'projectName, filePath, show required' });
        return;
      }
      const ok = typeof parentPath === 'string'
        ? graphManager.toggleFolderChild(parentPath, filePath, show)
        : graphManager.toggleRootChild(projectName, filePath, show);
      if (!ok) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/root/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/tokens/:sessionId — 세션 토큰 사용량 데이터 */
  app.get('/api/tokens/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const cwd = graphManager.getAgentCwd(sessionId);
      const empty: SessionTokenData = { sessionId, turns: [], categories: [] };
      if (!cwd) {
        res.json(empty);
        return;
      }
      res.json(readSessionTokenData(cwd, sessionId) ?? empty);
    } catch (err) {
      logger.error('GET /api/tokens failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/state — 현재 스냅샷 데이터 (디버그 버블맵용, 메인 뷰와 동일) */
  app.get('/api/state', (_req, res) => {
    const snap = graphManager.getSnapshot();
    res.json({
      agentList: snap.agents,
      nodeList: snap.topFolders,
      edgeList: snap.edges,
    });
  });

  /** GET /api/app-state — 현재 서버의 탭 라이프사이클 상태 반환 */
  app.get('/api/app-state', (_req, res) => {
    try {
      res.json(loadAppState());
    } catch (err) {
      logger.error('GET /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/app-state — lastActiveProject / defaultProject / pinnedProjects 부분 업데이트.
   * body는 `AppStatePatch` (Partial<AppState>). 배열 필드는 치환(전체 목록).
   * openProjects는 서버가 lifecycle로 관리하므로 클라에서 직접 조작하지 않음 (요청 들어와도 무시).
   */
  app.patch('/api/app-state', (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const patch: { lastActiveProject?: string | null; defaultProject?: string | null; pinnedProjects?: string[] } = {};
      if ('lastActiveProject' in body) {
        const v = body['lastActiveProject'];
        if (v === null || typeof v === 'string') patch.lastActiveProject = v;
      }
      if ('defaultProject' in body) {
        const v = body['defaultProject'];
        if (v === null || typeof v === 'string') patch.defaultProject = v;
      }
      if ('pinnedProjects' in body) {
        const v = body['pinnedProjects'];
        if (Array.isArray(v) && v.every((n) => typeof n === 'string')) patch.pinnedProjects = v as string[];
      }
      const updated = patchAppState(patch);
      res.json(updated);
      broadcastSnapshot();
    } catch (err) {
      logger.error('PATCH /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/projects/:name — 프로젝트 탭 닫기 (데이터 보존, 스냅샷에서만 숨김 + AppState에서 제거) */
  app.delete('/api/projects/:name', (req, res) => {
    try {
      // v1.63: 클라는 projectId(path)를 보냄. path 우선 해소, 이름 폴백.
      const ref = decodeURIComponent(req.params.name);
      const resolved = graphManager.resolveProjectRef(ref);
      const rawName = resolved?.rawName ?? ref;
      const idPath = resolved?.path ?? ref;
      // hydrated / stub / appState 어느 쪽이든 걸리면 정리 — 모두 실패면 404.
      const hidden = graphManager.hideProject(rawName);
      const stubRemoved = graphManager.removeStubFromMap(rawName);
      const appStateRemoved = appStateRemoveOpenProject(idPath);
      if (!hidden && !stubRemoved && !appStateRemoved) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      if (appStateRemoved) logger.info(`AppState: openProjects -= ${idPath} ("${rawName}")`);
      res.json({ ok: true });
      broadcastSnapshot();
      saveCheckpoint();
    } catch (err) {
      logger.error('DELETE /api/projects/:name failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/projects/open-folder — 모던 폴더 선택 다이얼로그 (IFileDialog COM) → 프로젝트 등록 */
  app.post('/api/projects/open-folder', (_req, res) => {
    // IFileDialog COM 인터페이스로 모던 파일 탐색기 스타일 폴더 선택
    const csSource = `
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Threading;

  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  class FileOpenDialogRCW {}

  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
      [PreserveSig] int Show(IntPtr hwnd);
      void SetFileTypes(uint c, IntPtr f);
      void SetFileTypeIndex(uint i);
      void GetFileTypeIndex(out uint i);
      void Advise(IntPtr p, out uint c);
      void Unadvise(uint c);
      void SetOptions(uint o);
      void GetOptions(out uint o);
      void SetDefaultFolder(IShellItem i);
      void SetFolder(IShellItem i);
      IShellItem GetFolder();
      IShellItem GetCurrentSelection();
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string s);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string s);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string s);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
      IShellItem GetResult();
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  public class FolderPicker {
      // 백그라운드 Node 서버가 d.Show(NULL owner) 로 모달을 띄우면 Windows 포그라운드
      // 잠금에 걸려 폴더 선택창이 VSCode/브라우저 뒤로 열린다. Show()는 블로킹이라
      // 호출 후 보정이 불가 → 별도 백그라운드 스레드가 이 프로세스의 다이얼로그 창을
      // 찾아 AttachThreadInput 우회로 강제 포그라운드 한다.
      [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
      delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
      [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
      [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
      [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
      [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
      [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
      [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
      [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
      [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
      [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
      [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
      [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
      [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
      [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
      [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
      [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);

      [StructLayout(LayoutKind.Sequential)] struct POINT { public int x; public int y; }
      [StructLayout(LayoutKind.Sequential)] struct RECT { public int left; public int top; public int right; public int bottom; }
      [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }

      // 다이얼로그 창을 현재 마우스 커서 위치(커서가 창 중앙)로 이동.
      // OS가 복원하는 "마지막 창 위치" 대신 사용자가 클릭한 자리에 뜨게 한다.
      // 커서가 속한 모니터 작업영역 안으로 클램프해 화면 밖으로 안 나가게 한다.
      static void PositionAtCursor(IntPtr h) {
          POINT pt;
          if (!GetCursorPos(out pt)) return;
          RECT wr;
          if (!GetWindowRect(h, out wr)) return;
          int w = wr.right - wr.left;
          int ht = wr.bottom - wr.top;
          int x = pt.x - w / 2;
          int y = pt.y - ht / 2;
          IntPtr mon = MonitorFromPoint(pt, 2); // MONITOR_DEFAULTTONEAREST
          MONITORINFO mi = new MONITORINFO();
          mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (GetMonitorInfo(mon, ref mi)) {
              if (x < mi.rcWork.left) x = mi.rcWork.left;
              if (y < mi.rcWork.top) y = mi.rcWork.top;
              if (x + w > mi.rcWork.right) x = mi.rcWork.right - w;
              if (y + ht > mi.rcWork.bottom) y = mi.rcWork.bottom - ht;
          }
          MoveWindow(h, x, y, w, ht, true);
      }

      static void Force(IntPtr h) {
          IntPtr fg = GetForegroundWindow();
          uint fgpid;
          uint ftid = GetWindowThreadProcessId(fg, out fgpid);
          uint cur = GetCurrentThreadId();
          AttachThreadInput(cur, ftid, true);
          ShowWindow(h, 9); // SW_RESTORE
          BringWindowToTop(h);
          SetForegroundWindow(h);
          AttachThreadInput(cur, ftid, false);
      }

      static IntPtr FindDialog() {
          uint mypid = GetCurrentProcessId();
          IntPtr found = IntPtr.Zero;
          EnumWindows(delegate(IntPtr h, IntPtr l) {
              uint pid;
              GetWindowThreadProcessId(h, out pid);
              if (pid != mypid) return true;
              if (!IsWindowVisible(h)) return true;
              if (GetWindow(h, 4) != IntPtr.Zero) return true; // GW_OWNER=4 → 소유된 창 제외
              StringBuilder sb = new StringBuilder(64);
              GetClassName(h, sb, 64);
              if (sb.ToString() == "ConsoleWindowClass") return true; // PS 콘솔 제외
              found = h;
              return false;
          }, IntPtr.Zero);
          return found;
      }

      public static string Pick(string title) {
          Thread t = new Thread(delegate() {
              IntPtr dlg = IntPtr.Zero;
              for (int i = 0; i < 30 && dlg == IntPtr.Zero; i++) {
                  Thread.Sleep(120);
                  dlg = FindDialog();
              }
              if (dlg == IntPtr.Zero) return;
              Force(dlg);
              // 다이얼로그가 표시 직후 OS 저장 위치로 한 번 더 튀는 경우가 있어
              // 짧게 몇 번 더 커서 위치로 재배치한다.
              for (int j = 0; j < 4; j++) {
                  PositionAtCursor(dlg);
                  Thread.Sleep(70);
              }
          });
          t.IsBackground = true;
          t.Start();
          uint options;
          string pickedPath;
          IFileDialog d = (IFileDialog)new FileOpenDialogRCW();
          d.GetOptions(out options);
          d.SetOptions(options | 0x20);
          d.SetTitle(title);
          if (d.Show(IntPtr.Zero) != 0) return "__CANCELLED__";
          IShellItem r = d.GetResult();
          r.GetDisplayName(0x80058000, out pickedPath);
          return pickedPath;
      }
  }`;
    // [Console]::OutputEncoding 을 UTF-8 로 강제 — 기본 OEM 코드페이지(한국어 Windows=CP949 등)
    // 로 stdout 을 쓰면 한글/일어/중국어 경로가 Node 의 utf8 디코딩에서 깨져, 깨진 경로로
    // registerProject 가 호출되고 디스크 fs.existsSync 가 false → 부팅 시 ghost 로 제거되어
    // 다음 실행 때 탭이 사라진다. PowerShell 내부는 UTF-16 이므로 출력 단계만 UTF-8 로 맞춘다.
    const psScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\nAdd-Type -TypeDefinition @'\n${csSource}\n'@\nWrite-Output ([FolderPicker]::Pick('Select project folder'))`;
    const tmpFile = path.join(process.env['TEMP'] || '.', `vibisual-picker-${Date.now()}.ps1`);
    // BOM 포함 UTF-8 로 저장 — PowerShell 5.1 의 -File 은 BOM 없는 파일을 ANSI 로 해석할 수
    // 있어 (스크립트 본문이 ASCII 라 현재는 영향 없지만) 향후 비-ASCII 추가에도 안전하게 둔다.
    fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8');
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile], { timeout: 120000, encoding: 'utf-8' }, (err, stdout) => {
      // 임시 파일 정리
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (err) {
        logger.error('Folder picker failed', err);
        res.status(500).json({ ok: false, error: String(err) });
        return;
      }
      const selected = stdout.trim();
      if (!selected || selected === '__CANCELLED__') {
        res.json({ ok: false, cancelled: true });
        return;
      }
      try {
        const info = graphManager.registerProject(selected);
        // SSOT §5.4 #14 (v1.34): 사용자가 명시적으로 폴더를 선택해서 "열기" 한 경로 —
        // 과거에 닫아서 hidden 상태였다면 여기서만 복구한다.
        graphManager.showProject(info.name);
        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, project: info });
      } catch (regErr) {
        logger.error('Project registration failed', regErr);
        res.status(500).json({ ok: false, error: String(regErr) });
      }
    });
  });

  // ─── Task Edge API (에이전트 간 작업 흐름) ───

  /** GET /api/task-edges — 전체 Task Edge 목록 */
  app.get('/api/task-edges', (_req, res) => {
    res.json({ ok: true, data: graphManager.getTaskEdgesSnapshot() });
  });

  /** POST /api/task-edges — Task Edge 생성. v1.18: 고급 옵션(kind/messageFormat/returnFormat/timeoutMs/retryCount/cacheEnabled/priority) 선택적 수용. */
  app.post('/api/task-edges', (req, res) => {
    const {
      sourceAgentId, targetAgentId, command, forwardMode, templateId,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority,
      delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    } = req.body as {
      sourceAgentId: string;
      targetAgentId: string;
      command: string;
      forwardMode: TaskEdgeForwardMode;
      templateId: string | null;
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    };
    if (!sourceAgentId || !targetAgentId || typeof command !== 'string') {
      res.status(400).json({ ok: false, error: 'sourceAgentId, targetAgentId, command required' });
      return;
    }
    let edge;
    try {
      edge = graphManager.createTaskEdge(
        sourceAgentId, targetAgentId, command,
        forwardMode ?? 'manual', templateId ?? null,
        { kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Task Edge creation failed';
      res.status(400).json({ ok: false, error: msg });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: edge });
  });

  /** PUT /api/task-edges/:id — Task Edge 업데이트. v1.18: 고급 옵션 전부 갱신 가능. */
  app.put('/api/task-edges/:id', (req, res) => {
    const {
      command, forwardMode,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy,
      critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    } = req.body as {
      command?: string;
      forwardMode?: TaskEdgeForwardMode;
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    };
    // v1.32 / v1.54 — auto-artifact / auto-rework 자매 엣지는 사용자 편집 금지 (primary 에서만 수정 가능).
    const existing = graphManager.getTaskEdge(req.params['id']!);
    if (existing && (existing.bundleRole === 'auto-artifact' || existing.bundleRole === 'auto-rework')) {
      res.status(400).json({ ok: false, error: 'cannot edit auto-generated bundle edge — modify the primary edge instead' });
      return;
    }
    const edge = graphManager.updateTaskEdge(req.params['id']!, {
      command, forwardMode,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy,
      critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    });
    if (!edge) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: edge });
  });

  /** DELETE /api/task-edges/:id — Task Edge 삭제. v1.32 / v1.54: 자매(auto-artifact/auto-rework) 단독 삭제 금지 — primary 측에서만. */
  app.delete('/api/task-edges/:id', (req, res) => {
    const existing = graphManager.getTaskEdge(req.params['id']!);
    if (existing && (existing.bundleRole === 'auto-artifact' || existing.bundleRole === 'auto-rework')) {
      res.status(400).json({ ok: false, error: 'cannot delete auto-generated bundle edge — delete the primary edge instead' });
      return;
    }
    const deleted = graphManager.deleteTaskEdge(req.params['id']!);
    if (!deleted) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // ─── §5.3 #28 v1.47 — 콘티모드 (Conti) ───

  /**
   * 콘티 생성 in-flight 락 (agentId → Promise). 같은 에이전트의 동시 generateConti 1건만 허용.
   */
  const contiInflight = new Map<string, Promise<void>>();

  /** POST /api/conti/generate?agentId=... — 새 콘티 1건 생성 (Haiku/Sonnet tool_use). */
  app.post('/api/conti/generate', async (req, res) => {
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'] : '';
    if (!agentId) {
      res.status(400).json({ ok: false, error: 'agentId required' });
      return;
    }
    if (contiInflight.has(agentId)) {
      res.status(409).json({ ok: false, error: 'already generating for this agent' });
      return;
    }

    // 부모 에이전트 sessionId + cwd 조회 — `claude --resume <sessionId>` 로 부모 세션에 붙는다.
    const snap = graphManager.getSnapshot();
    const agent = snap.agents.find((a) => a.id === agentId);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'agent not found' });
      return;
    }
    if (!agent.customCreated) {
      res.status(400).json({ ok: false, error: 'conti only works for custom-created agents' });
      return;
    }
    const sessionId = agent.path; // BubbleData.path === sessionId for agents
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!sessionId || !cwd) {
      res.status(400).json({ ok: false, error: 'agent session/cwd unavailable' });
      return;
    }
    const input: ContiContextInput = { sessionId, cwd, agentLabel: agent.label };

    // §5.3 #28 (L) v1.58 — 사용자 명시 "새 콘티" 트리거. 항상 새 workId 발급
    // (기존 인플라이트 항목이 있어도 폐기 후 새로 — 사용자 의도가 '새'로 명시됨).
    const work_meta = graphManager.resetContiWork(agentId, 'user_new');
    const newWorkId = work_meta?.workId ?? '';

    const work = (async () => {
      try {
        const result = await generateContiFrames(input);
        if (!result) {
          return null;
        }
        const now = Date.now();
        const c: Conti = {
          id: contiId.conti(),
          agentId,
          createdAt: now,
          updatedAt: now,
          workId: newWorkId,
          ...(result.title ? { title: result.title } : {}),
          frames: result.frames,
        };
        graphManager.addConti(c);
        graphManager.attachContiIdToWork(agentId, c.id);
        broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: c.id, agentId, workId: newWorkId } });
        broadcastSnapshot();
        saveCheckpoint();
        return c;
      } catch (err) {
        logger.warn(`POST /api/conti/generate error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })();

    contiInflight.set(agentId, work.then(() => undefined));
    try {
      const c = await work;
      if (!c) {
        res.status(502).json({ ok: false, error: 'generation failed (claude CLI returned no usable JSON)' });
        return;
      }
      res.json({ ok: true, conti: c });
    } finally {
      contiInflight.delete(agentId);
    }
  });

  /** POST /api/conti/:contiId/patch-element — element 한 개 LLM 패치 */
  app.post('/api/conti/:contiId/patch-element', async (req, res) => {
    const cid = req.params['contiId']!;
    const body = req.body as { frameId?: string; elementId?: string; prompt?: string };
    if (!body || typeof body.frameId !== 'string' || typeof body.elementId !== 'string' || typeof body.prompt !== 'string') {
      res.status(400).json({ ok: false, error: 'frameId, elementId, prompt required' });
      return;
    }
    const found = graphManager.findContiElement(cid, body.frameId, body.elementId);
    if (!found) {
      res.status(404).json({ ok: false, error: 'conti/frame/element not found' });
      return;
    }
    // v1.62 — patchContiElement 는 더 이상 부모 세션에 붙지 않는다.
    //   harness 기반 일회용 sub-agent (tmpdir 격리 + Read/Edit only) 가 element.json 을 직접 Edit 한다.
    try {
      const next = await patchContiElement(
        found.element,
        body.prompt,
        { title: found.frame.title, action: found.frame.action },
      );
      if (!next) {
        res.status(502).json({ ok: false, error: 'patch failed (claude CLI returned no usable JSON)' });
        return;
      }
      const applied = graphManager.replaceContiElement(cid, body.frameId, body.elementId, next);
      if (!applied) {
        res.status(404).json({ ok: false, error: 'apply failed' });
        return;
      }
      broadcast({
        type: 'conti_patched',
        timestamp: Date.now(),
        payload: { contiId: cid, agentId: found.conti.agentId, frameId: body.frameId, elementId: body.elementId },
      });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, element: applied });
    } catch (err) {
      logger.warn(`POST /api/conti/:cid/patch-element error: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/conti/:contiId/frames — 빈 frame append (LLM 미경유) */
  app.post('/api/conti/:contiId/frames', (req, res) => {
    const cid = req.params['contiId']!;
    const body = (req.body ?? {}) as { title?: string; action?: string };
    const frame = {
      id: contiId.frame(),
      title: typeof body.title === 'string' && body.title ? body.title.slice(0, 200) : 'New frame',
      action: typeof body.action === 'string' ? body.action.slice(0, 400) : '',
      elements: [],
    };
    const added = graphManager.addContiFrame(cid, frame);
    if (!added) {
      res.status(404).json({ ok: false, error: 'conti not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, frame: added });
  });

  /** DELETE /api/conti/:contiId/frames/:frameIndex — frame 삭제 (인덱스 기반) */
  app.delete('/api/conti/:contiId/frames/:frameIndex', (req, res) => {
    const cid = req.params['contiId']!;
    const idx = parseInt(req.params['frameIndex']!, 10);
    if (Number.isNaN(idx)) {
      res.status(400).json({ ok: false, error: 'frameIndex invalid' });
      return;
    }
    const ok = graphManager.deleteContiFrame(cid, idx);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'not found or out of range' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** §5.3 #28 v1.59 — POST /api/conti/:contiId/frames/reorder — frame 드래그앤드롭 순서 변경 */
  app.post('/api/conti/:contiId/frames/reorder', (req, res) => {
    const cid = req.params['contiId']!;
    const body = (req.body ?? {}) as { fromIndex?: unknown; toIndex?: unknown };
    const from = typeof body.fromIndex === 'number' ? body.fromIndex : NaN;
    const to = typeof body.toIndex === 'number' ? body.toIndex : NaN;
    if (Number.isNaN(from) || Number.isNaN(to)) {
      res.status(400).json({ ok: false, error: 'fromIndex and toIndex (number) required' });
      return;
    }
    const ok = graphManager.moveContiFrame(cid, from, to);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'reorder failed (not found, out of range, or same index)' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** PATCH /api/conti/:contiId/frames/:frameIndex — frame title/action 부분 갱신 */
  app.patch('/api/conti/:contiId/frames/:frameIndex', (req, res) => {
    const cid = req.params['contiId']!;
    const idx = parseInt(req.params['frameIndex']!, 10);
    if (Number.isNaN(idx)) {
      res.status(400).json({ ok: false, error: 'frameIndex invalid' });
      return;
    }
    const body = (req.body ?? {}) as { title?: string; action?: string };
    const updates: { title?: string; action?: string } = {};
    if (typeof body.title === 'string') updates.title = body.title;
    if (typeof body.action === 'string') updates.action = body.action;
    const updated = graphManager.patchContiFrame(cid, idx, updates);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, frame: updated });
  });

  /** DELETE /api/conti/:contiId — 콘티 1건 삭제 */
  app.delete('/api/conti/:contiId', (req, res) => {
    const ok = graphManager.deleteConti(req.params['contiId']!);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** POST /api/conti/import — 완성된 Conti JSON을 직접 주입 (세션 없이 사용 가능). */
  app.post('/api/conti/import', (req, res) => {
    const body = req.body as { conti?: unknown };
    const c = body?.conti;
    if (!c || typeof c !== 'object' || !('id' in (c as object)) || !('agentId' in (c as object))) {
      res.status(400).json({ ok: false, error: 'conti object with id and agentId required' });
      return;
    }
    const conti = c as import('@vibisual/shared').Conti;
    graphManager.addConti(conti);
    broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: conti.id, agentId: conti.agentId } });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, contiId: conti.id });
  });

  // ─── Comment Box (v1.45) — 언리얼 블프 스타일 주석 컨테이너 ───

  /** GET /api/comment-boxes — 모든 Comment Box 조회(디버그용). 일반적으로 snapshot 으로 받음. */
  app.get('/api/comment-boxes', (_req, res) => {
    res.json({ ok: true, data: graphManager.getAllCommentBoxes() });
  });

  /** POST /api/comment-boxes — 새 Comment Box 생성. */
  app.post('/api/comment-boxes', (req, res) => {
    const body = req.body as {
      projectName?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      color?: string;
      textColor?: string;
      fontSize?: number;
      opacity?: number;
      childNodeIds?: string[];
    };
    if (
      typeof body.projectName !== 'string' ||
      typeof body.x !== 'number' ||
      typeof body.y !== 'number' ||
      typeof body.width !== 'number' ||
      typeof body.height !== 'number'
    ) {
      res.status(400).json({ ok: false, error: 'projectName, x, y, width, height required' });
      return;
    }
    const box = graphManager.createCommentBox({
      projectName: body.projectName,
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      ...(body.text !== undefined && { text: body.text }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.textColor !== undefined && { textColor: body.textColor }),
      ...(body.fontSize !== undefined && { fontSize: body.fontSize }),
      ...(body.opacity !== undefined && { opacity: body.opacity }),
      ...(body.childNodeIds !== undefined && { childNodeIds: body.childNodeIds }),
    });
    if (!box) {
      res.status(500).json({ ok: false, error: 'no project instance registered' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: box });
  });

  /** PATCH /api/comment-boxes/:id — 위치/크기/텍스트/색/자식목록 부분 업데이트. */
  app.patch('/api/comment-boxes/:id', (req, res) => {
    const id = req.params['id']!;
    const body = req.body as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      color?: string;
      textColor?: string;
      fontSize?: number;
      opacity?: number;
      childNodeIds?: string[];
    };
    const updated = graphManager.updateCommentBox(id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: updated });
  });

  /** DELETE /api/comment-boxes/:id */
  app.delete('/api/comment-boxes/:id', (req, res) => {
    const deleted = graphManager.deleteCommentBox(req.params['id']!);
    if (!deleted) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /**
   * §5.4 #29 v1.51 — Canvas 복사·붙여넣기.
   * 클라가 localStorage 에 저장한 CanvasClipboardPayload + 대상 projectName + anchor(캔버스 좌표)
   * 를 받아 커스텀 에이전트/Task Edge/Comment Box 묶음을 새 ID 로 한 번에 복원한다.
   *
   * 처리 순서:
   *   1) agents 루프 → createCustomAgent + setAgentConfig (oldId→newId 매핑)
   *   2) taskEdges 루프 → createTaskEdge (graphManager 가 returnFormat='both' 자매 엣지 자동 생성)
   *   3) commentBoxes 루프 → childOldIds 매핑 후 createCommentBox
   *   4) broadcastSnapshot + saveCheckpoint
   */
  app.post('/api/canvas/paste', (req, res) => {
    try {
      const body = req.body as {
        projectName?: string;
        anchor?: { x?: number; y?: number };
        payload?: CanvasClipboardPayload;
      };
      const projectName = body.projectName;
      const anchor = body.anchor;
      const payload = body.payload;
      if (typeof projectName !== 'string' || !projectName) {
        res.status(400).json({ ok: false, error: 'projectName required' });
        return;
      }
      if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') {
        res.status(400).json({ ok: false, error: 'anchor {x,y} required' });
        return;
      }
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ ok: false, error: 'payload required' });
        return;
      }
      if (payload.schemaVersion !== CANVAS_CLIPBOARD_SCHEMA_VERSION) {
        res.status(400).json({ ok: false, error: `unsupported schemaVersion: ${String(payload.schemaVersion)}` });
        return;
      }
      if (!Array.isArray(payload.agents) || !Array.isArray(payload.taskEdges) || !Array.isArray(payload.commentBoxes)) {
        res.status(400).json({ ok: false, error: 'payload.agents/taskEdges/commentBoxes must be arrays' });
        return;
      }

      // (0) 대상 프로젝트가 stub 이면 먼저 hydrate — 미hydrate 인스턴스에 createCustomAgent 가
      //     primaryInstance 로 폴백되어 다른 프로젝트에 새 agent 가 생성되는 사고 방지.
      if (graphManager.isStubbed(projectName)) {
        const hydrateResult = graphManager.hydrateProject(projectName);
        if (!hydrateResult.ok && hydrateResult.reason !== 'already-hydrated') {
          logger.warn(`canvas/paste: hydrate failed for "${projectName}" — reason=${String(hydrateResult.reason)}`);
          res.status(400).json({ ok: false, error: `target project "${projectName}" not hydratable: ${String(hydrateResult.reason)}` });
          return;
        }
      }

      // 대상 프로젝트의 ProjectInfo 가 정말 등록되어 있는지 검증 — 없으면 createCustomAgent 가
      //     resolveProjectCwd 의 fallback(첫 번째 project) 로 빠져 sessionCwds 가 틀린 cwd 로 매핑됨 → 체크포인트에서 누락.
      const knownProjects = graphManager.getProjects();
      const isKnownProject = Object.values(knownProjects).some((p) => p.name === projectName);
      if (!isKnownProject) {
        logger.warn(`canvas/paste: target project "${projectName}" not registered in any hydrated instance`);
        res.status(400).json({ ok: false, error: `target project "${projectName}" is not registered (open the project tab first)` });
        return;
      }

      const anchorX = anchor.x;
      const anchorY = anchor.y;
      const idMap: CanvasPasteResponse['idMap'] = { agents: {}, edges: {}, commentBoxes: {} };

      // (1) 에이전트 복제
      for (const entry of payload.agents) {
        if (!entry || typeof entry.oldId !== 'string') continue;
        const rel = entry.relPosition ?? { x: 0, y: 0 };
        const position = {
          x: anchorX + (typeof rel.x === 'number' ? rel.x : 0),
          y: anchorY + (typeof rel.y === 'number' ? rel.y : 0),
        };
        const created = graphManager.createCustomAgent(entry.label ?? '', position, projectName);
        idMap.agents[entry.oldId] = created.id;

        // AgentConfig 적용 — 클라이언트가 strip 했지만 서버에서도 rulesHistory 방어 제거.
        const cfg = entry.config;
        if (cfg && typeof cfg === 'object') {
          const safeConfig = { ...(cfg as AgentConfig) };
          if ('rulesHistory' in safeConfig) {
            delete (safeConfig as { rulesHistory?: RulesHistoryEntry[] }).rulesHistory;
          }
          graphManager.setAgentConfig(created.id, safeConfig);
        }
      }
      logger.info(`canvas/paste: project="${projectName}" anchor=(${anchorX},${anchorY}) agents=${payload.agents.length}->${Object.keys(idMap.agents).length} edges=${payload.taskEdges.length} boxes=${payload.commentBoxes.length}`);

      // (2) Task Edge 복제 — 양 끝이 idMap 에 모두 있을 때만 생성
      payload.taskEdges.forEach((edgeEntry, idx) => {
        if (!edgeEntry) return;
        const newSrc = idMap.agents[edgeEntry.sourceOldId];
        const newDst = idMap.agents[edgeEntry.targetOldId];
        if (!newSrc || !newDst) return;
        try {
          const created = graphManager.createTaskEdge(
            newSrc,
            newDst,
            typeof edgeEntry.command === 'string' ? edgeEntry.command : '',
            edgeEntry.forwardMode ?? 'manual',
            edgeEntry.templateId ?? null,
            {
              ...(edgeEntry.kind !== undefined && { kind: edgeEntry.kind }),
              ...(edgeEntry.messageFormat !== undefined && { messageFormat: edgeEntry.messageFormat }),
              ...(edgeEntry.messageSchema !== undefined && { messageSchema: edgeEntry.messageSchema }),
              ...(edgeEntry.returnFormat !== undefined && { returnFormat: edgeEntry.returnFormat }),
              ...(edgeEntry.timeoutMs !== undefined && { timeoutMs: edgeEntry.timeoutMs }),
              ...(edgeEntry.retryCount !== undefined && { retryCount: edgeEntry.retryCount }),
              ...(edgeEntry.cacheEnabled !== undefined && { cacheEnabled: edgeEntry.cacheEnabled }),
              ...(edgeEntry.priority !== undefined && { priority: edgeEntry.priority }),
              ...(edgeEntry.delegationPolicy !== undefined && { delegationPolicy: edgeEntry.delegationPolicy }),
              ...(edgeEntry.critiqueTiming !== undefined && { critiqueTiming: edgeEntry.critiqueTiming }),
              ...(edgeEntry.critiqueAuthority !== undefined && { critiqueAuthority: edgeEntry.critiqueAuthority }),
              ...(edgeEntry.maxReworkCount !== undefined && { maxReworkCount: edgeEntry.maxReworkCount }),
              ...(edgeEntry.commandMode !== undefined && { commandMode: edgeEntry.commandMode }),
            },
          );
          idMap.edges[String(idx)] = created.id;
        } catch (err) {
          logger.warn(`canvas/paste: skip edge ${edgeEntry.sourceOldId}->${edgeEntry.targetOldId}: ${String(err)}`);
        }
      });

      // (3) Comment Box 복제 — childOldIds 를 idMap.agents 로 매핑(매칭 없는 oldId 는 drop)
      payload.commentBoxes.forEach((boxEntry, idx) => {
        if (!boxEntry) return;
        const childNodeIds: string[] = [];
        if (Array.isArray(boxEntry.childOldIds)) {
          for (const oid of boxEntry.childOldIds) {
            const mapped = idMap.agents[oid];
            if (mapped) childNodeIds.push(mapped);
          }
        }
        const created = graphManager.createCommentBox({
          projectName,
          x: anchorX + (typeof boxEntry.relX === 'number' ? boxEntry.relX : 0),
          y: anchorY + (typeof boxEntry.relY === 'number' ? boxEntry.relY : 0),
          width: typeof boxEntry.width === 'number' ? boxEntry.width : 200,
          height: typeof boxEntry.height === 'number' ? boxEntry.height : 120,
          text: typeof boxEntry.text === 'string' ? boxEntry.text : '',
          ...(typeof boxEntry.color === 'string' && { color: boxEntry.color }),
          ...(typeof boxEntry.textColor === 'string' && { textColor: boxEntry.textColor }),
          ...(typeof boxEntry.fontSize === 'number' && { fontSize: boxEntry.fontSize }),
          ...(typeof boxEntry.opacity === 'number' && { opacity: boxEntry.opacity }),
          childNodeIds,
        });
        if (created) idMap.commentBoxes[String(idx)] = created.id;
      });

      broadcastSnapshot();
      saveCheckpoint();
      // 타깃 프로젝트 강제 영속화 — saveCheckpoint() 의 getProjectNames() 가 worktree-key 인스턴스를
      // 제외하거나 다른 필터로 타깃을 빼먹는 경우, paste 직후에는 새 에이전트가 디스크에 안 박힌 채
      // 다음 unload/restart 에서 사라진다. paste 결과는 무조건 타깃 체크포인트로 직접 flush.
      try {
        const cp = graphManager.toProjectCheckpoint(projectName);
        writeCheckpoint(cp);
      } catch (err) {
        logger.warn(`canvas/paste: direct flush failed for "${projectName}": ${err instanceof Error ? err.message : String(err)}`);
      }

      const response: CanvasPasteResponse = { ok: true, idMap };
      res.json(response);
    } catch (err) {
      logger.error('POST /api/canvas/paste failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // v1.32 — Task Edge dispatch 대기 promise 레지스트리 (cmdId → resolve/timer)
  interface PendingDispatch {
    resolve: (v: { completed: true; status: 'completed' | 'error'; result?: string; errorMessage?: string }) => void;
    /** v1.84 — 무제한(유효 timeout ≤0) 엣지는 타이머를 설치하지 않으므로 optional. clearTimeout(undefined) 는 no-op. */
    timer?: NodeJS.Timeout;
    edgeId: string;
  }
  const pendingDispatches = new Map<string, PendingDispatch>();

  /** v1.32 — 소스 커스텀 에이전트가 outbound Task Edge 목록을 조회.
   *  시스템 프롬프트/훅 주입 또는 소스 세션의 curl 호출 용도. agentId 기반. */
  app.get('/api/task-edges/outbound-by-agent/:agentId', (req, res) => {
    const agentId = req.params['agentId']!;
    const allAgents = graphManager.getSnapshot().agents;
    const outbound = graphManager.getOutboundTaskEdges(agentId);
    const result = outbound.map((edge) => {
      const target = allAgents.find((a) => a.id === edge.targetAgentId);
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const artifact = graphManager.getBundleArtifact(edge.id);
      return {
        edgeId: edge.id,
        command: edge.command,
        kind: edge.kind ?? 'command',
        returnFormat: edge.returnFormat ?? 'summary',
        bundleId: edge.bundleId,
        hasArtifactReturn: Boolean(artifact),
        target: target
          ? {
              agentId: target.id,
              label: target.label,
              model: cfg?.model ?? null,
              tools: cfg?.tools ?? null,
              rules: cfg?.rules ?? null,
            }
          : null,
      };
    });
    res.json({ ok: true, agentId, edges: result });
  });

  /** v1.32 — POST /api/task-edges/dispatch — 소스 세션이 직접 호출해 엣지 위임 실행.
   *  body: { edgeId, instruction }
   *  - 타겟 에이전트 세션 큐에 edgeId 포함 명령 푸시 → subagent 가 실제 Claude 프로세스로 실행
   *  - `returnFormat='both'` 번들에 artifact 자매 엣지가 있고 그 target이 실에이전트면 완료까지 응답 홀드
   *  - 그 외(artifact 미연결)에는 즉시 { dispatched: true } 반환 → 소스는 다른 일 진행 */
  app.post('/api/task-edges/dispatch', (req, res) => {
    // 두 경로 수용:
    //  (1) 신규(권장) — raw text 본문 + `?edgeId=` 쿼리. instruction 손escape 불필요(heredoc 그대로).
    //  (2) 후방호환 — JSON 본문 `{ edgeId, instruction }`.
    let edgeId: string | undefined;
    let instruction: string | undefined;
    const q = req.query as { edgeId?: unknown };
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. edgeId 는 쿼리(우선) 또는 헤더.
      const qid = typeof q.edgeId === 'string' ? q.edgeId : undefined;
      const hid = typeof req.headers['x-edge-id'] === 'string' ? (req.headers['x-edge-id'] as string) : undefined;
      edgeId = qid ?? hid;
      // 끝의 쉘/heredoc 잔여 개행·CR 만 정리(중간 본문은 보존).
      instruction = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { edgeId?: unknown; instruction?: unknown };
      if (typeof body.edgeId === 'string') edgeId = body.edgeId;
      if (typeof body.instruction === 'string') instruction = body.instruction;
      // JSON 경로에서도 쿼리 edgeId 허용(혼용 안전).
      if (!edgeId && typeof q.edgeId === 'string') edgeId = q.edgeId;
    }
    if (typeof edgeId !== 'string' || edgeId.length === 0 || typeof instruction !== 'string' || instruction.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'edgeId (query ?edgeId= or JSON body) and non-empty instruction (raw text body or JSON body.instruction) required' });
      return;
    }
    const edge = graphManager.getTaskEdge(edgeId);
    if (!edge) { res.status(404).json({ ok: false, error: 'edge not found' }); return; }
    if ((edge.bundleRole ?? 'primary') !== 'primary') {
      res.status(400).json({ ok: false, error: 'dispatch only allowed on primary/command edge, not auto-artifact' });
      return;
    }

    const allAgents = graphManager.getSnapshot().agents;
    const targetAgent = allAgents.find((a) => a.id === edge.targetAgentId);
    if (!targetAgent) { res.status(404).json({ ok: false, error: 'target agent not found' }); return; }

    const sessionId = targetAgent.path;
    // v1.32 dispatch 수정 — /api/commands 핸들러와 동일하게 subAgent 를 새로 create 해서
    // cmd.subAgentId 에 실어 큐잉. 그래야 `processNextCommand → subAgentManager.execute` 가
    // 새 Claude 서브프로세스를 스폰하고 IDE 에 탭이 뜬다. null 로 두면 execute 가 조용히 return.
    const newSub = subAgentManager.create(targetAgent.id);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-edge${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId,
    };
    const queue = commandQueues.get(sessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(sessionId, queue);

    graphManager.setTaskEdgeStatus(edgeId, 'executing');
    const artifact = graphManager.getBundleArtifact(edgeId);
    if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'executing');

    // §5.3 #28 (L) v1.58 — 타겟 에이전트가 conti-mode 면 task_edge 출처로 workId 발급.
    // 이미 인플라이트가 있으면 그대로 유지(같은 work 연속) — 사용자 명시 '새 콘티' 만 reset 한다.
    const targetCfg = graphManager.getAgentConfig(targetAgent.id);
    if (targetCfg?.customMode === 'conti') {
      graphManager.startContiWork(targetAgent.id, 'task_edge');
    }

    broadcastSnapshot();
    saveCheckpoint();

    processNextCommand(sessionId);

    // 대기 여부: artifact 엣지의 target 이 실제 살아있는 에이전트면 결과 돌려줄 채널이 있음 → 홀드.
    // 없거나(returnFormat != 'both') artifact.targetAgentId 가 미등록이면 즉시 반환.
    const artifactTargetLive = artifact
      ? Boolean(allAgents.find((a) => a.id === artifact.targetAgentId))
      : false;

    if (!artifactTargetLive) {
      res.json({ ok: true, dispatched: true, cmdId: cmd.id, waited: false });
      return;
    }

    // v1.84 — 엣지 timeoutMs 가 양수면 그 ms 로 제한, 미설정/0 이면
    // TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS(기본 0=무제한) 적용.
    // 유효 timeout 이 ≤0 이면 타이머를 아예 설치하지 않고 타겟 완료까지 무한 홀드
    // (§5.3 line 236/837 — 미설정=무제한, i18n placeholder "unlimited" 와 정합).
    const timeoutMs = edge.timeoutMs && edge.timeoutMs > 0
      ? edge.timeoutMs
      : TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          const p = pendingDispatches.get(cmd.id);
          if (!p) return;
          pendingDispatches.delete(cmd.id);
          graphManager.setTaskEdgeStatus(edgeId, 'error', undefined, `dispatch timeout (${timeoutMs}ms)`);
          if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'error');
          broadcastSnapshot();
          saveCheckpoint();
          res.status(504).json({ ok: false, timeout: true, cmdId: cmd.id, timeoutMs });
        }, timeoutMs)
      : undefined;

    pendingDispatches.set(cmd.id, {
      edgeId,
      ...(timer !== undefined ? { timer } : {}),
      resolve: (payload) => {
        res.json({
          ok: payload.status === 'completed',
          dispatched: true,
          waited: true,
          cmdId: cmd.id,
          status: payload.status,
          ...(payload.result !== undefined ? { result: payload.result } : {}),
          ...(payload.errorMessage !== undefined ? { errorMessage: payload.errorMessage } : {}),
        });
      },
    });
  });

  const port = Number(process.env['PORT']) || DEFAULT_PORT;

  // §5.7 #23-2 v1.60 — Agent View 게이트 판정. 두 모드 공통(probe + 로그).
  // 부팅 직후 1회 reattach 는 `postListenBoot()` 안에서 호출.
  void isAgentViewEnabled(true).then((res) => {
    logger.info(`[agent-view] enabled=${res.enabled} reason="${res.reason}"`);
  }).catch((err) => {
    logger.warn(`[agent-view] gate probe failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // v1.96 §5.8 — 폐기된 keyword 데이터 1회성 디스크 cleanup. 다음 차수에서 호출과 모듈 모두 제거.
  (await import('./services/keywordCleanup.js')).runKeywordCleanupOnce();

  // ─── 상태 저장 ───

  const saveScheduler = new SaveScheduler();

  // #4: 디바운스 도입했다가 비정상 종료 시 설정 유실 결함이 확인되어 **완전 원복**.
  // 체크포인트는 이벤트마다 동기 즉시 저장 — 설정 내구성 우선. 쓰기 증폭은 기능 결함이
  // 아닌 성능 리스크였을 뿐이라 정상 동작에 영향 없음(별도 분기·코얼레스 ❌, 단순=안전).
  /** 체크포인트 저장 (이벤트 발생 시 호출, 동기 즉시 저장). */
  function saveCheckpoint(): void {
    const fallbackProject = graphManager.getPrimaryProjectName();
    if (!fallbackProject) return;

    graphManager.incrementSeq();
    // §3.2.1-4 (v3.03) — read-only 격리 프로젝트는 자동 저장 동결(빈/손상 인스턴스가 디스크 덮어쓰기 방지).
    // readOnly 는 stub 상태라 보통 getProjectNames(인스턴스 기반)에 안 잡히지만, 방어적으로 필터한다.
    const projectNames = graphManager.getProjectNames().filter((n) => !graphManager.isProjectReadOnly(n));
    if (projectNames.length === 0) return;

    if (projectNames.length <= 1) {
      const cp = graphManager.toProjectCheckpoint(projectNames[0] ?? fallbackProject);
      saveScheduler.forceCheckpoint(cp);
    } else {
      const checkpoints = projectNames.map((name) => graphManager.toProjectCheckpoint(name));
      saveScheduler.forceCheckpointAll(checkpoints);
    }

    // hydrated + stub 프로젝트를 합산해 orphan prune — stub 프로젝트 worktree를 잘못 제거하지 않도록.
    const stubInfos = Object.values(graphManager.getStubProjects()).map((m) => m.project);
    pruneOrphanWorktreeDirs([...Object.values(graphManager.getProjects()), ...stubInfos]);

    // 탭으로 떠 있는 top-level 프로젝트는 openProjects 에 반드시 포함되도록 보정한다.
    // registerProject 펀넬(SessionStart/hook-event)을 놓친 경로(예: 세션 라우팅으로 이미 라우팅돼
    // registerProject 가 재호출되지 않는 경우)로 활성 탭이 openProjects 에서 누락돼 재시작 시
    // 탭이 사라지는 문제 방지. × 로 닫은 hidden 프로젝트는 getVisibleTopLevelProjects 가 이미 제외하므로
    // 닫은 탭을 되살리지 않는다. appStateAddOpenProject 는 이미 있으면 no-op(디스크 미기록).
    for (const info of graphManager.getVisibleTopLevelProjects()) {
      if (appStateAddOpenProject(info.path, info.name)) {
        logger.info(`AppState: openProjects += ${info.path} ("${info.name}") [reconcile]`);
      }
    }
  }

  // 참조 주입 — restoreFromCheckpoint보다 먼저 실행해야 복원된 데이터가 올바른 Map에 들어감
  graphManager.setPoppedCommandsRef(poppedCommands);
  graphManager.setCommandQueuesRef(commandQueues);
  graphManager.setCompletedCommandArchiveRef(completedCommandArchive);

  // v1.52: 1회 마이그레이션 — 구 `<Vibisual>/save/` 단일 루트 → 각 프로젝트의 `.vibisual/save/` 분산 저장.
  // 순서 주의:
  //   (1) `loadAppState()` 를 먼저 호출 — 구 `<Vibisual>/save/_app-state.json` 이 살아있는 동안 `~/.vibisual/app-state.json` 으로 이전.
  //   (2) 그 다음 `migrateLegacySaveRootToProjectDirs()` — 체크포인트 디렉토리들을 각 프로젝트로 분산 후 SAVE_ROOT 를 `save.bak-v1.52` 로 백업.
  {
    loadAppState(); // (1) AppState 먼저 끌어올림 (구 _app-state.json 이 save/ 백업으로 묻히기 전에).
    const result = migrateLegacySaveRootToProjectDirs(); // (2) 체크포인트 분산 + SAVE_ROOT 백업.
    if (result.moved > 0 || result.skipped > 0 || result.bakPath) {
      logger.info(`v1.52 migration: moved=${result.moved}, skipped=${result.skipped}, bak=${result.bakPath ?? '<none>'}`);
    }
  }

  // Lazy boot: project.json 메타만 읽어 stub 등록. 체크포인트 본문은 hydrate 시점까지 로드하지 않는다.
  // openProjects 필터 — `~/.vibisual/app-state.json` 에 기록된 "사용자가 열어둔" 프로젝트만 stub으로 등록.
  // 사용자가 × 로 닫은 프로젝트는 체크포인트는 보존되되 탭으로 뜨지 않는다 (다시 파일 열기 또는 hook 이벤트로 복귀 가능).
  //
  // v1.63: 식별 = projectId(절대경로). loadAppState().normalize 가 구 name-array AppState 를
  // path-array 로 1회 마이그레이션(구 projectPaths name→path 사용)하므로, 부팅은 openProjects(=경로)
  // 를 그대로 스캔 목록으로 쓴다. discoverProjectMetas 는 각 path 의 `.vibisual/save/` 만 읽는다.
  {
    const np = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    const appStateInitial = loadAppState();
    const scanPaths = appStateInitial.openProjects.filter((p): p is string => typeof p === 'string' && p.length > 0);

    let metas = discoverProjectMetas(scanPaths);
    if (metas.length === 0 && migrateLegacy() !== null) {
      // 레거시 state.json이 존재했을 경우 — 마이그레이션 후 재스캔하여 stub 등록.
      metas = discoverProjectMetas(scanPaths);
    }

    const appState = loadAppState();
    // 식별 매칭은 정규화 경로(projectId) 기준 (Windows FS 대소문자 무시).
    let openKeySet = new Set(appState.openProjects.map(np));
    // 초기 마이그레이션: 첫 가동(updatedAt=0)이면 기존 모든 top-level 메타를 열림으로 간주, 1회 기록.
    if (appState.updatedAt === 0 && metas.length > 0) {
      const topPaths = metas
        .filter((m) => !m.project.parentProjectPath && m.project.path)
        .map((m) => m.project.path.replace(/\\/g, '/'));
      const names: Record<string, string> = { ...(appState.projectNames ?? {}) };
      for (const m of metas) {
        if (!m.project.parentProjectPath && m.project.path) {
          names[m.project.path.replace(/\\/g, '/')] = m.project.name;
        }
      }
      saveAppState({ ...appState, openProjects: topPaths, projectNames: names, updatedAt: 0 });
      openKeySet = new Set(topPaths.map(np));
      logger.info(`AppState: bootstrapped openProjects with ${topPaths.length} existing project(s).`);
    }
    const stalePaths: string[] = [];
    // 1단계: path 가 비어 있거나 실제 경로가 사라진 메타는 ghost 로 간주하고 전체 스킵.
    const validMetas = metas.filter((m) => {
      const p = m.project.path;
      if (!p || !fs.existsSync(p)) {
        logger.warn(`Boot: skipping ghost meta "${m.project.name}" (path=${JSON.stringify(p)} not found on disk)`);
        if (openKeySet.has(np(p ?? ''))) stalePaths.push(p ?? '');
        return false;
      }
      return true;
    });

    // openProjects(경로) 에 있는 프로젝트만 부팅 시 즉시 hydrate (worktree 는 부모 재귀로).
    const filtered = validMetas.filter((m) => openKeySet.has(np(m.project.path)));
    let hydratedCount = 0;
    for (const meta of filtered) {
      graphManager.registerStub(meta);
      const result = graphManager.hydrateProject(meta.project.path);
      if (result.ok) {
        hydratedCount += 1;
      } else if (result.reason === 'load-error') {
        // §3.2.1-4 (v3.03) — 로드 실패(디스크 손상/일시 실패)는 데이터가 살아있을 수 있다.
        // stub 을 제거하지 않고 read-only 격리하여 빈 인스턴스가 디스크를 덮어쓰지 못하게 하고,
        // openProjects 도 유지해 다음 부팅에 백업 복구를 재시도한다(과거엔 제거 → 빈 인스턴스 덮어쓰기 손실).
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (load-error) — isolating read-only (data-loss guard), keeping stub + openProjects`);
        graphManager.markStubReadOnly(meta.project.path, 'load-error');
      } else {
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (${result.reason}) — removing from openProjects`);
        graphManager.removeStubFromMap(meta.project.path);
        stalePaths.push(meta.project.path);
      }
    }
    // meta 가 없는데 openProjects 에만 남은 경로도 청소 (정규화 경로 매칭).
    // §3.2.1-4 손실방지 (v3.29): 메타(project.json)를 못 읽었어도 경로가 디스크에 실재하면
    // 크래시로 project.json 이 truncate/일시 손상됐을 수 있으므로 openProjects 에서 지우지 않고
    // 다음 부팅에 재시도한다. 경로 자체가 사라진 것만 영구 청소한다(과거엔 무조건 제거 →
    // 크래시 후 재시작 시 멀쩡한 프로젝트가 목록에서 영영 빠지던 손실 경로).
    const metaKeys = new Set(metas.map((m) => np(m.project.path)));
    const unknownInOpen = appState.openProjects.filter((p) => !metaKeys.has(np(p)));
    if (unknownInOpen.length > 0) {
      const goneUnknown: string[] = [];
      const keptUnknown: string[] = [];
      for (const p of unknownInOpen) {
        let onDisk = false;
        try { onDisk = !!p && fs.existsSync(p); } catch { onDisk = false; }
        if (onDisk) keptUnknown.push(p); else goneUnknown.push(p);
      }
      if (goneUnknown.length > 0) {
        logger.warn(`AppState: ${goneUnknown.length} stale openProjects entry(ies) removed (path gone from disk): ${goneUnknown.join(', ')}`);
        stalePaths.push(...goneUnknown);
      }
      if (keptUnknown.length > 0) {
        logger.warn(`AppState: ${keptUnknown.length} openProjects entry(ies) kept for retry (path present but metadata unreadable — possible transient crash corruption): ${keptUnknown.join(', ')}`);
      }
    }
    for (const p of stalePaths) if (p) appStateRemoveOpenProject(p);
    // #3: projectNames 캐시도 디스크-부재 경로 prune (무한 누적 차단, 재오픈 라벨은 보존).
    const prunedNames = appStatePruneStaleProjectNames((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    logger.info(`Boot: hydrated ${hydratedCount}/${validMetas.length} project(s) from openProjects (${stalePaths.length} stale entry(ies) cleaned, ${prunedNames} name-cache pruned, ${metas.length - validMetas.length} ghost(s) skipped).`);
  }

  // v1.2 (SCENARIO §5.7 #24): 기동 시 체크포인트만 유일한 버블 소스.
  // 이전엔 scanAllProjects로 ~/.claude/sessions/를 긁어 추가 시딩했으나, 체크포인트 외의
  // stale/타 프로젝트 세션이 섞여 들어가는 문제가 있어 비활성화. 새 세션은 SessionStart 훅이 담당.
  // graphManager.scanAllProjects();

  // [DISABLED] 활성 체크 전면 비활성화 — 동시 다발 spawn이 문제를 일으키는 것으로 보여 조사 중.
  // 재활성화 시 동시성 제한(예: 직렬 실행 or p-limit) 고려 필요.
  // const startupPrune = graphManager.pruneStaleRestoredAgents()
  //   .then((removed) => {
  //     if (removed.length > 0) {
  //       logger.info(`Startup prune removed ${removed.length} stale agents`);
  //       saveCheckpoint();
  //     }
  //   })
  //   .catch((err) => logger.error('Startup prune failed', err));
  // setInterval(() => {
  //   void graphManager.pruneStaleRestoredAgents().then((removed) => {
  //     broadcastSnapshot();
  //     if (removed.length > 0) saveCheckpoint();
  //   });
  // }, 10_000);
  const startupPrune = Promise.resolve();

  // 이미 실행 중인 background shell(dev 서버 등) JSONL 스캔으로 복원
  graphManager.rehydrateAllBackgroundShells();

  // isSessionInUse 결과 → WS broadcast (클라 debug 콘솔용)
  setLivenessProbeListener((result) => {
    const msg: WSMessage = { type: 'liveness_probe', timestamp: Date.now(), payload: result };
    broadcast(msg);
  });

  // subAgentManager 스트림 이벤트 → WS로 실시간 중계 (성능: 40ms 창 coalescing).
  // 과거엔 이벤트마다 즉시 broadcast → 멀티에이전트 스트림 폭주 시 초당 수백~수천 IPC/WS
  // 메시지가 나가 클라 큐가 밀림. 짧은 창에 모아 sub_agent_stream_batch 1건으로 묶어 보낸다
  // (도착 순서 보존). 200건 초과 시 창을 기다리지 않고 즉시 flush 해 지연 상한을 건다.
  const STREAM_BROADCAST_INTERVAL = 40;
  const STREAM_BATCH_MAX = 200;
  let streamBatch: SubAgentStreamEvent[] = [];
  let streamBatchTimer: ReturnType<typeof setTimeout> | null = null;
  const flushStreamBatch = (): void => {
    streamBatchTimer = null;
    if (streamBatch.length === 0) return;
    const batch = streamBatch;
    streamBatch = [];
    broadcast({ type: 'sub_agent_stream_batch', timestamp: Date.now(), payload: batch });
  };
  subAgentManager.setOnStreamEvent((event) => {
    streamBatch.push(event);
    if (streamBatch.length >= STREAM_BATCH_MAX) {
      if (streamBatchTimer !== null) { clearTimeout(streamBatchTimer); streamBatchTimer = null; }
      flushStreamBatch();
      return;
    }
    if (streamBatchTimer === null) {
      streamBatchTimer = setTimeout(flushStreamBatch, STREAM_BROADCAST_INTERVAL);
      if (typeof streamBatchTimer.unref === 'function') streamBatchTimer.unref();
    }
  });

  // subAgent 영속화 경로 해석 — 부모 에이전트 소속 프로젝트를 찾아 save/<project>/(worktrees/<wt>/)sub-streams/<agentId>/ 로 라우팅
  subAgentManager.setProjectResolver((parentAgentId) => {
    const name = graphManager.getAgentProjectName(parentAgentId);
    if (!name) return null;
    return graphManager.getProjectByName(name) ?? null;
  });

  // 커스텀 에이전트 상태 = 소속 서브에이전트 집계.
  // 서브 활동 시작/종료 시마다 부모 커스텀 버블의 active/completed 전이를 재계산.
  // 기존 에이전트 버블처럼 completed 후 dismiss/fade 흐름은 그대로 동작(동일 setAgentStatus 세팅).
  subAgentManager.setOnSubStatusChange((parentAgentId) => {
    if (graphManager.recomputeCustomAgentStatus(parentAgentId)) {
      broadcastSnapshot();
      saveCheckpoint();
    }
  });

  // v1.74 — agent-view 매핑(agentViewShort/SessionId) 을 spawn 직후 무조건 영속화.
  // onSubStatusChange 는 status 변화가 없으면 저장을 건너뛰므로 데몬 reattach 가능 윈도우에
  // 구멍이 생긴다. 이 훅은 조건 없이 즉시 saveCheckpoint() — 서버가 spawn 직후 크래시해도
  // 재시작 시 reattachAgentViewOnBoot 가 supervisor 의 살아있는 워커를 되찾는다.
  subAgentManager.setOnPersistNeeded(() => {
    saveCheckpoint();
  });

  // §5.3 #12-1 v1.96 — 권한 결정 직후 sub stream 에 합성 system 라인 한 줄.
  // 사용자가 팝업에서 뭘 눌렀는지 (또는 자동 결정 사유) 가 stream 패널 / 체크포인트에 남는다.
  // subAgentId 미상(레거시 hook env 결손) 인 경우엔 건너뜀 — broadcast permission_resolved 만 남는다.
  permissionBroker.onResolved = (request, decision) => {
    if (!request.subAgentId) return;
    const toolLabel = request.toolName || 'tool';
    let line: string;
    if (decision.decision === 'allow') {
      if (decision.reason === 'timeout') {
        line = `[permission] ALLOW (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] ALLOW (auto: ${decision.reason}) on ${toolLabel}`;
      } else {
        line = `[permission] ALLOW — you pressed Allow on ${toolLabel}`;
      }
    } else {
      // deny
      if (decision.reason === 'timeout') {
        line = `[permission] DENY (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] DENY — you pressed Deny on ${toolLabel} (note: ${decision.reason})`;
      } else {
        line = `[permission] DENY — you pressed Deny on ${toolLabel}`;
      }
    }
    subAgentManager.emitSystemMessage(request.agentId, request.subAgentId, line);
  };

  // ─── v1.55 critique 런타임 강제 ──────────────────────────────────────────────
  //
  // SCENARIO §5.3 line 218/224 의 후속 라운드. 기존 v1.42(저장/UI) + v1.54(자매 엣지 동기화) 위에
  // 실제 reject 이벤트 → rework 트리거를 얹는다.
  //
  // 흐름:
  //   1) 타겟(작업자) 세션 완료 → `getIncomingCritiqueEdges(targetAgentId)` 로 critique primary 엣지 조회
  //   2) 각 watcher(=sourceAgent) 에게 `dispatchCritiqueWatcher` 로 비평 지시 송신 (cmd.edgeId=critique.id)
  //   3) watcher 응답 완료 → cmd.edgeId 가 critique 엣지면 `handleCritiqueCompletion` 로 verdict 파싱
  //   4) verdict='reject' + critiqueAuthority='force-rework':
  //        - reworkCount + 1 이 maxReworkCount 이하면 auto-rework 자매 엣지로 작업자에게 재작업 dispatch
  //        - 초과 시 critiqueAuthority='comment-only' 강등 + 자매 엣지 동기 제거 + 에스컬레이션 알림
  //   5) 작업자가 rework 완료 → 다시 critique 엣지 발사 (사이클 연속, count 누적)
  //
  // v1.55 라운드 한계:
  //   - `critiqueTiming='intermediate'` 도 사실상 'final' 과 동일하게 "Stop 훅 = 1회 완료" 시점에 발사.
  //     진정한 중간 milestone 발사(PostToolUse 스트림 후킹)는 후속 라운드.

  type CritiqueVerdict = 'approve' | 'reject' | 'unknown';

  /** Watcher 응답 텍스트에서 verdict 추출.
   *  1) JSON 블록 `{"verdict":"approve"|"reject"}` 패턴 우선
   *  2) 못 찾으면 첫/마지막 줄에서 REJECT/REWORK vs APPROVE/LGTM 키워드 매칭
   *  3) 둘 다 실패 시 'unknown' → comment-only 처리(rework 안 보냄) */
  function parseCritiqueVerdict(text: string): CritiqueVerdict {
    if (!text || typeof text !== 'string') return 'unknown';
    // 1) JSON 패턴
    const jsonMatch = text.match(/\{[^}]*"verdict"\s*:\s*"(approve|reject)"[^}]*\}/i);
    if (jsonMatch && jsonMatch[1]) {
      const v = jsonMatch[1].toLowerCase();
      if (v === 'approve' || v === 'reject') return v;
    }
    // 2) 키워드 매칭
    const upper = text.toUpperCase();
    const hasReject = /\b(REJECT|REWORK|NEEDS?[- ]?REWORK|FAIL(ED)?|NG\b)/.test(upper);
    const hasApprove = /\b(APPROVE[D]?|LGTM|PASS(ED)?|OK\b|ACCEPT(ED)?)/.test(upper);
    if (hasReject && !hasApprove) return 'reject';
    if (hasApprove && !hasReject) return 'approve';
    return 'unknown';
  }

  /** Critique watcher 발사: source 에이전트의 세션 큐에 비평 지시 명령을 push.
   *  - isFreshCycle=true 면 reworkCount 0 으로 리셋, 아니면 유지(연속 사이클).
   *  - 이미 critique 엣지가 executing 이면 중복 발사 방지(no-op). */
  function dispatchCritiqueWatcher(
    edge: TaskEdge,
    contextResult: string | null,
    isFreshCycle: boolean,
  ): void {
    if (edge.status === 'executing') {
      logger.debug?.(`[critique] skip dispatch — edge ${edge.id} already executing`);
      return;
    }
    const allAgents = graphManager.getSnapshot().agents;
    const watcher = allAgents.find((a) => a.id === edge.sourceAgentId);
    const target = allAgents.find((a) => a.id === edge.targetAgentId);
    if (!watcher) {
      logger.warn(`[critique] watcher agent not found: ${edge.sourceAgentId} (edge ${edge.id})`);
      return;
    }
    const watcherSessionId = watcher.path;
    const targetLabel = target?.label ?? edge.targetAgentId;

    if (isFreshCycle) graphManager.bumpCritiqueReworkCount(edge.id, 'reset');
    const currentRework = edge.reworkCount ?? 0;
    const maxRework = Math.min(edge.maxReworkCount ?? 3, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT);
    const cyclePhase = currentRework === 0
      ? '(initial review)'
      : `(rework cycle ${currentRework}/${maxRework})`;

    const contextBlock = contextResult && contextResult.trim().length > 0
      ? `\n\n=== Target [${targetLabel}] just completed work ===\n${contextResult.trim()}\n`
      : `\n\n=== Target [${targetLabel}] just completed work (no result snippet captured) ===\n`;

    const responseGuide = `\n\n=== Verdict format ===\nReply with one of:\n  APPROVE  — work meets criteria\n  REJECT <one-line reason> — needs rework\nOptionally include JSON: {"verdict":"approve"|"reject","reasoning":"..."}.\nIf you only have comments without a clear verdict, write APPROVE and add notes.\n`;

    const instruction = `${edge.command}${cyclePhase}${contextBlock}${responseGuide}`;

    const newSub = subAgentManager.create(watcher.id);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-critq${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId: edge.id,
    };
    const queue = commandQueues.get(watcherSessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(watcherSessionId, queue);

    graphManager.setTaskEdgeStatus(edge.id, 'executing');
    broadcastSnapshot();
    saveCheckpoint();
    processNextCommand(watcherSessionId);
    logger.info(`[critique] dispatched watcher edge=${edge.id} watcher=${watcher.label} target=${targetLabel} cycle=${currentRework}/${maxRework}`);
  }

  /** Watcher 의 critique 응답이 완료되었을 때 호출. verdict 파싱 + (필요 시) auto-rework 발사 또는 강등. */
  function handleCritiqueCompletion(edge: TaskEdge, watcherResult: string | undefined): void {
    if (edge.kind !== 'critique' || (edge.bundleRole ?? 'primary') !== 'primary') return;
    const verdict = parseCritiqueVerdict(watcherResult ?? '');
    const authority = edge.critiqueAuthority ?? 'force-rework';
    logger.info(`[critique] verdict=${verdict} authority=${authority} edge=${edge.id}`);

    if (verdict !== 'reject') return; // approve / unknown → 사이클 종료
    if (authority !== 'force-rework') return; // comment-only → 강제 없음

    const reworkEdge = graphManager.getBundleAutoRework(edge.id);
    if (!reworkEdge) {
      logger.warn(`[critique] reject but no auto-rework sister edge — edge=${edge.id}`);
      return;
    }
    const maxRework = Math.min(edge.maxReworkCount ?? 3, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT);
    const nextCount = (edge.reworkCount ?? 0) + 1;
    if (nextCount > maxRework) {
      // 강등 + 알림
      graphManager.downgradeCritiqueAuthority(edge.id);
      logger.warn(`[critique] maxReworkCount ${maxRework} exceeded — downgraded to comment-only. edge=${edge.id}`);
      // 시각 신호는 critiqueAuthority='comment-only' 전이 + auto-rework 자매 엣지 사라짐으로 충분.
      // 다음 snapshot broadcast 에서 UI 가 자동 반영.
      broadcastSnapshot();
      saveCheckpoint();
      return;
    }
    graphManager.bumpCritiqueReworkCount(edge.id, 'increment');

    // auto-rework 자매 엣지로 작업자에게 재작업 지시 dispatch
    const allAgents = graphManager.getSnapshot().agents;
    const worker = allAgents.find((a) => a.id === reworkEdge.targetAgentId);
    const watcher = allAgents.find((a) => a.id === reworkEdge.sourceAgentId);
    if (!worker) {
      logger.warn(`[critique] rework target not found — edge=${reworkEdge.id}`);
      return;
    }
    const watcherLabel = watcher?.label ?? reworkEdge.sourceAgentId;
    const reasonBlock = watcherResult && watcherResult.trim().length > 0
      ? `\n\n=== Reviewer [${watcherLabel}] feedback ===\n${watcherResult.trim()}\n`
      : '\n';
    const instruction = `${TASK_EDGE_AUTO_REWORK_COMMAND_LABEL} (cycle ${nextCount}/${maxRework})${reasonBlock}\nAddress the feedback and continue.`;

    const newSub = subAgentManager.create(worker.id);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-rework${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId: reworkEdge.id,
    };
    const workerSessionId = worker.path;
    const queue = commandQueues.get(workerSessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(workerSessionId, queue);

    graphManager.setTaskEdgeStatus(reworkEdge.id, 'executing');
    broadcastSnapshot();
    saveCheckpoint();
    processNextCommand(workerSessionId);
    logger.info(`[critique] dispatched rework edge=${reworkEdge.id} worker=${worker.label} cycle=${nextCount}/${maxRework}`);
  }

  // subAgentManager 완료 콜백 → 완료 명령 archive 이동 + snapshot broadcast + 다음 명령 처리
  subAgentManager.setOnComplete(() => {
    // 완료/에러 명령을 큐에서 archive로 이동
    for (const [sessionId, queue] of commandQueues) {
      const done = queue.filter((c) => c.status === 'completed' || c.status === 'error');
      if (done.length === 0) continue;

      // v1.32 — Task Edge dispatch 매칭: edgeId 실린 명령이면 엣지 상태 갱신 + 대기 중 dispatch promise resolve
      // v1.55 — critique 엣지(watcher 응답) / auto-rework 엣지(작업자 rework) 분류해 별도 처리 hook 마련.
      // v1.56b — 사용자 강제 중단(`[Stopped by user]`)은 critique 트리거 대상에서 제외 — 중단된 결과를 watcher 가 review 할 가치 없음.
      const completedCritiqueEdges: { edge: TaskEdge; result: string | undefined }[] = [];
      let sawNonCritiqueResponse = false;
      let sawReworkCompletion = false;
      const isUserStopped = (cmd: QueuedCommand): boolean =>
        typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]');
      for (const cmd of done) {
        const userStopped = isUserStopped(cmd);
        if (!cmd.edgeId) {
          // 직접 사용자 명령 완료 — 비-critique-응답으로 분류 → watcher 발사 후보
          // 단, 사용자가 강제 중단한 케이스는 watcher 발사 대상에서 제외.
          if (!userStopped) sawNonCritiqueResponse = true;
          continue;
        }
        const edgeStatus: 'completed' | 'error' = cmd.status === 'completed' ? 'completed' : 'error';
        const errMsg = cmd.status === 'error' ? (cmd.result ?? 'subagent error') : undefined;
        graphManager.setTaskEdgeStatus(cmd.edgeId, edgeStatus, cmd.result, errMsg);
        const artifact = graphManager.getBundleArtifact(cmd.edgeId);
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, edgeStatus, cmd.result, errMsg);
        const pending = pendingDispatches.get(cmd.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDispatches.delete(cmd.id);
          pending.resolve({
            completed: true,
            status: edgeStatus,
            ...(cmd.result !== undefined ? { result: cmd.result } : {}),
            ...(errMsg !== undefined ? { errorMessage: errMsg } : {}),
          });
        }
        // v1.55 분류 (v1.56b — 사용자 강제 중단은 critique 사이클에서 전부 배제)
        const cmdEdge = graphManager.getTaskEdge(cmd.edgeId);
        if (cmdEdge?.kind === 'critique' && (cmdEdge.bundleRole ?? 'primary') === 'primary') {
          // watcher 의 critique 응답 — verdict 처리 대상. 작업자 watcher 발사 후보 ❌.
          // 사용자가 watcher 를 중단한 경우 verdict 파싱도 skip (rework 발사 안 함, 사이클 종료).
          if (edgeStatus === 'completed' && !userStopped) {
            completedCritiqueEdges.push({ edge: cmdEdge, result: cmd.result });
          }
        } else if (cmdEdge?.bundleRole === 'auto-rework') {
          // 작업자가 auto-rework 명령 완료 — 다음 사이클 watcher 재발사 대상. count 리셋 ❌(연속).
          // 사용자가 rework 중간에 중단했으면 watcher 재발사 안 함.
          if (!userStopped) {
            sawNonCritiqueResponse = true;
            if (edgeStatus === 'completed') sawReworkCompletion = true;
          }
        } else {
          // 그 외 일반 엣지(command/artifact/request) 완료 — 새 cycle watcher 발사 대상.
          if (!userStopped) sawNonCritiqueResponse = true;
        }
      }

      // §5.3 #28 (K) v1.48 + (L) v1.58 — 콘티모드 에이전트의 응답을 conti 레코드로 자동 추출.
      // sessionId → owning agentId → customMode==='conti' 이면 cmd.result 에서 JSON 파싱.
      // 작업 ID(workId) 트래커로 신규/수정 분기:
      //   - 트래커 + contiId 있음 → 기존 Conti.frames 통째 교체 + conti_updated 브로드캐스트
      //   - 트래커 + contiId 없음 → 새 Conti 생성 + 트래커에 contiId 머지 + conti_generated
      //   - 트래커 없음 (외부 트리거 없는 agent_session 첫 응답) → workId 자체 발급 + 새 Conti
      // 부트스트랩(title='(empty)') 1건은 첫 진짜 응답이 들어올 때 폐기.
      const ownerAgentId = graphManager.findAgentIdBySession(sessionId);
      if (ownerAgentId) {
        const ownerCfg = graphManager.getAgentConfig(ownerAgentId);
        if (ownerCfg?.customMode === 'conti') {
          for (const cmd of done) {
            if (cmd.status !== 'completed') continue;
            if (typeof cmd.result !== 'string' || !cmd.result.trim()) continue;
            const parsed = parseContiResponse(cmd.result);
            if (!parsed) continue;

            // 트래커가 없으면 agent_session 출처로 자체 발급 — fallback.
            let work = graphManager.getActiveContiWork(ownerAgentId);
            if (!work) {
              work = graphManager.startContiWork(ownerAgentId, 'agent_session') ?? undefined;
            }
            const workId = work?.workId ?? '';
            const targetContiId = work?.contiId;

            if (targetContiId && graphManager.getConti(targetContiId)) {
              // 수정 케이스 — frames 통째 교체
              const updated = graphManager.updateContiFrames(targetContiId, parsed.frames, parsed.title);
              if (updated) {
                broadcast({ type: 'conti_updated', timestamp: Date.now(), payload: { contiId: targetContiId, agentId: ownerAgentId, workId } });
                logger.info(`Conti auto-updated: agent=${ownerAgentId}, contiId=${targetContiId}, frames=${parsed.frames.length}, workId=${workId}`);
              }
            } else {
              // 신규 케이스 — 새 Conti 생성 + 트래커에 contiId 머지.
              const existing = graphManager.getContisByAgent(ownerAgentId);
              if (existing.length === 1 && existing[0]?.title === '(empty)') {
                graphManager.deleteConti(existing[0]!.id);
              }
              const now = Date.now();
              const c: Conti = {
                id: contiId.conti(),
                agentId: ownerAgentId,
                createdAt: now,
                updatedAt: now,
                workId,
                ...(parsed.title ? { title: parsed.title } : {}),
                frames: parsed.frames,
              };
              graphManager.addConti(c);
              graphManager.attachContiIdToWork(ownerAgentId, c.id);
              broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: c.id, agentId: ownerAgentId, workId } });
              logger.info(`Conti auto-extracted: agent=${ownerAgentId}, contiId=${c.id}, frames=${c.frames.length}, workId=${workId}, source=${work?.source ?? 'unknown'}`);
            }
          }
        }
      }

      // v2.61 — attachments 보존: 종전(v1.35/v1.38)엔 완료 시 paste 이미지 파일을 unlink + cmd.attachments
      //   필드 클리어해 "전송 직후 사라져 무엇을 보냈는지 확인 불가"(사용자 보고)였다. 이제 파일·필드를
      //   모두 보존하여 archive(완료 명령)에 attachments 경로가 남고, 클라(StreamRenderer CommandBlock)가
      //   대화 스트림에 썸네일을 인라인 표시 + 클릭 시 라이트박스 확대한다.
      //   누적 파일 정리(세션 종료/주기) 정책은 후속 과제.

      // §5.3 #10-2 v2.45 — auto-agent 빌더 완료 감지. 빌더는 auto-agent 버블 자기 세션의 sub 로
      //   돌므로, 그 명령이 끝나면(= done 에 등장) phase 를 building → completed 로 전이하고 마지막
      //   응답을 요약으로 합성한다. 이 전이를 빠뜨리면 빌더가 끝나도 진행 표시가 영원히 'building'
      //   으로 남아 패널 스피너가 계속 돈다(사용자 보고: "명령 후 아무 동작 없이 빙글빙글만").
      const autoSummary = graphManager.getAutoAgentSummary(sessionId);
      if (autoSummary && autoSummary.phase === 'building') {
        let finalText: string | undefined;
        for (let i = done.length - 1; i >= 0; i--) {
          const r = done[i]!.result;
          if (typeof r === 'string' && r.trim()) { finalText = r; break; }
        }
        autoAgentRuntime.handleCompletion(sessionId, finalText);
      }

      let archive = completedCommandArchive.get(sessionId);
      if (!archive) { archive = []; completedCommandArchive.set(sessionId, archive); }
      archive.push(...done);
      const remaining = queue.filter((c) => c.status === 'queued' || c.status === 'executing');
      commandQueues.set(sessionId, remaining);

      // v1.55 — critique 런타임:
      //   (1) watcher critique 응답 완료들 처리(reject 판정 시 자매 auto-rework 발사 / 강등)
      //   (2) 작업자 본 완료(=critique 응답 외)가 있으면 incoming critique watcher 발사
      for (const { edge, result } of completedCritiqueEdges) {
        try {
          handleCritiqueCompletion(edge, result);
        } catch (err) {
          logger.error(`[critique] handleCritiqueCompletion failed edge=${edge.id}`, err);
        }
      }
      if (sawNonCritiqueResponse) {
        const workerAgentId = graphManager.findAgentIdBySession(sessionId);
        if (workerAgentId) {
          const incoming = graphManager.getIncomingCritiqueEdges(workerAgentId);
          // 컨텍스트: 가장 최근 완료된 일반/rework 명령의 result 한 건만 발췌(과도한 컨텍스트 폭주 방지).
          const lastNonCritiqueResult = (() => {
            for (let i = done.length - 1; i >= 0; i--) {
              const c = done[i]!;
              const e = c.edgeId ? graphManager.getTaskEdge(c.edgeId) : null;
              if (e?.kind === 'critique' && (e.bundleRole ?? 'primary') === 'primary') continue;
              if (typeof c.result === 'string' && c.result.trim()) return c.result;
            }
            return null;
          })();
          for (const edge of incoming) {
            try {
              dispatchCritiqueWatcher(edge, lastNonCritiqueResult, !sawReworkCompletion);
            } catch (err) {
              logger.error(`[critique] dispatchCritiqueWatcher failed edge=${edge.id}`, err);
            }
          }
        }
      }
    }
    broadcastSnapshot();
    saveCheckpoint();
    // 완료된 명령의 세션에서 다음 queued 명령 실행 — 큐에 등록된 모든 세션(커스텀 포함) 대상
    for (const sessionId of commandQueues.keys()) {
      processNextCommand(sessionId);
    }
  });

  // Listen 은 이미 위(createServer 직후)에서 완료됨. 여기서는 하이드레이션 완료 후 필요한
  // 주기 작업 / 세션 생명주기 / scenario 시드만 기동.
  void startupPrune.then(() => postListenBoot());

  function postListenBoot(): void {
    // 3-Layer 세션 생명주기 매니저 시작 + 기존 추적 세션 초기 동기화
    for (const s of graphManager.listTrackedSessions()) {
      lifecycle.registerFromSeed(s.sessionId, s.pid, s.cwd);
    }
    lifecycle.start();

    // 재기동 정합성 보정: 체크포인트 복원으로 subs 는 idle 이지만 커스텀 부모 버블이
    // 이전 세션 상태(active) 로 남아있을 수 있으니 여기서 한 번 sweep.
    if (graphManager.recomputeAllCustomAgentStatuses()) {
      broadcastSnapshot();
      saveCheckpoint();
    }

    // §5.7 #23-2 v1.60 — Agent View reattach. 영속화된 agentViewShort 들 중 supervisor 에 살아있는
    // worker 의 JSONL watcher 를 재부착 → 서버가 죽어있던 동안 진행된 turn 도 새 라인부터 따라잡음.
    // 죽은 worker 는 state.json 최종 상태로 마무리. projectResolver 가 set 된 후 호출 보장.
    void subAgentManager.reattachAgentViewOnBoot((subId) => {
      // §5.7 #23-2 v1.60 — agent-view terminal 시점에 cmd 도 함께 봉합하기 위한 lookup.
      // 같은 sub 의 executing 명령이 commandQueues 어딘가에 있다고 가정(보통 그 sub 의 sessionId 큐).
      for (const queue of commandQueues.values()) {
        for (const cmd of queue) {
          if (cmd.status === 'executing' && cmd.subAgentId === subId) return cmd;
        }
      }
      return null;
    }).then((r) => {
      if (r.alive + r.gone + r.failed > 0) {
        logger.info(`[agent-view] postListen reattach: alive=${r.alive} gone=${r.gone} failed=${r.failed}`);
        if (r.alive > 0 || r.gone > 0) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      }
    }).catch((err) => {
      logger.warn(`[agent-view] postListen reattach failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 주기적 세션 스캔 + 제목 해결 + SubAgent 대기열 처리 (통합 루프)
    setInterval(() => {
      let needsBroadcast = false;

      // SCENARIO §5.7 #24: ~/.claude/sessions/<PID>.json 을 10초마다 스캔하여
      // entrypoint=vscode + cwd 일치 + JSONL 활성 조건을 만족하는 신규 세션을 시딩.
      // SessionStart 훅이 놓친 케이스(창 재오픈, 훅 미설치 등)의 폴백.
      const seeded = graphManager.scanAllProjects();
      if (seeded) needsBroadcast = true;

      // 제목 미확정 에이전트 재조회 (JSONL 생성 대기)
      if (graphManager.hasPendingTitles()) {
        const changed = graphManager.resolvePendingTitles();
        if (changed > 0) needsBroadcast = true;
      }

      // 활성 판정은 SessionLifecycleManager가 담당 (아래 server.listen 콜백에서 start)

      if (needsBroadcast) {
        broadcastSnapshot();
        saveCheckpoint();
      }

      // 주기적 sweep: 놓친 서브에이전트 종료 콜백 등으로 커스텀 부모 상태가 튀는 케이스 보정
      if (graphManager.recomputeAllCustomAgentStatuses()) {
        broadcastSnapshot();
        saveCheckpoint();
      }

      // §7.11 — background shell(dev 서버) 발견 sweep(안전망). attachBackgroundShell 의
      // PostToolUse 트리거가 어긋나거나(이벤트 미도달·tool_response 형식 변화) 세션 등록
      // **이후** 떠서 startup rehydrate 가 놓친 dev 서버를, 등록된 모든 세션의 JSONL 을
      // 다시 훑어 잡는다. rehydrate·watcher.start·createIframeSatellite 전부 멱등이라
      // 매 주기 재호출해도 중복 위성/중복 watcher 가 생기지 않는다. 포트 탐지 시 broadcast 는
      // watcher 콜백의 onSnapshotChange 가 담당하므로 여기선 needsBroadcast 를 세우지 않는다.
      graphManager.rehydrateAllBackgroundShells();

      // SubAgent: 대기열에 queued 명령 있으면 실행 — 큐 등록된 모든 세션(커스텀 포함) 대상
      for (const sessionId of commandQueues.keys()) {
        processNextCommand(sessionId);
      }
    }, SESSION_SCAN_INTERVAL);

    // 파일 존재 확인 + ghost 만료 제거 (별도 주기)
    setInterval(() => {
      let needsBroadcast = false;

      // 파일/폴더 경로 검증 → 사라진 노드 ghost 전환
      const ghosted = graphManager.checkFileExistence();
      if (ghosted > 0) needsBroadcast = true;

      // disappearing 만료 버블 제거
      const pruned = graphManager.pruneDisappearing();
      if (pruned > 0) needsBroadcast = true;

      if (needsBroadcast) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, FILE_EXISTENCE_CHECK_INTERVAL);

    // 자동 idle 전환 스윕 (부모 에이전트 + 서브에이전트) — 30초 간격
    setInterval(() => {
      const expiredParents = graphManager.sweepIdleAgents(AGENT_IDLE_THRESHOLD_MS);
      const expiredSubs = subAgentManager.sweepIdle(AGENT_IDLE_THRESHOLD_MS);
      // v1.60: completed → idle 자동 페이드 (AGENT_FADE_DURATION=60s 경과 분).
      // 사용자 클릭 dismiss 없어도 시안 글로우가 자연 소멸 → 다음 작업이 깨끗한 상태에서 시작.
      const expiredCompleted = graphManager.expireCompletedAgents();
      if (expiredParents.length > 0 || expiredSubs.length > 0 || expiredCompleted.length > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, AGENT_IDLE_SWEEP_INTERVAL_MS);

    // §5.3 — 사용자 인터럽트(Esc/Ctrl+C)·도구 거부 시 Claude Code 는 Stop 훅을 발사하지 않아
    // Hook 에이전트 버블이 active(파란 링)로 stuck 된다. 세션 JSONL 마지막 엔트리가 인터럽트
    // sentinel 이면 누락된 Stop 훅을 대신 시뮬레이트(markStop → completed → 60초 fade → idle).
    // markStop 이 내부에서 스냅샷을 broadcast 하므로 별도 broadcast 불필요.
    setInterval(() => {
      const interrupted = graphManager.findInterruptedActiveSessions();
      if (interrupted.length === 0) return;
      for (const sessionId of interrupted) {
        agentTracker.markStop(sessionId);
        logger.info(`Interrupt reconcile: missing Stop hook → completed (session: ${sessionId.slice(0, 8)})`);
      }
      saveCheckpoint();
    }, INTERRUPT_RECONCILE_INTERVAL_MS);

    // iframe 생사 확인 (포트 TCP 핑) — 5초 간격
    setInterval(() => {
      void graphManager.checkIframesAlive().then((changed) => {
        if (changed) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      });
    }, 5000);

    // 비동기 감시 이벤트 (background shell 포트 탐지 등) → broadcast 연결
    graphManager.setOnSnapshotChange(() => {
      broadcastSnapshot();
      saveCheckpoint();
    });

    // §4 v1.98 — 진단 에러 로그 변경 시 스냅샷 broadcast (영속화 ❌ — saveCheckpoint 안 함)
    diagnosticService.setOnChange(() => {
      broadcastSnapshot();
    });

  }

  return { app };
}
