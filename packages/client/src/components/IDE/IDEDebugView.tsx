import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEBUG_PORT_BASE,
  MCP_SERVER_PRESETS,
  RUN_FAILURE_TAIL_LINES,
  buildDebugCommand,
} from '@vibisual/shared';
import type { AgentConfig, ExternalDebuggerInfo, RunConfig, RunConfigSource } from '@vibisual/shared';
import { isReadOnlyHookAgent } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneProjectName } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { ScrollFade } from '../ScrollFade.js';
import {
  countRunning,
  getRunTail,
  runIdFor,
  startRun,
  stopRun,
  useRunSessions,
} from '../../stores/runSessions.js';
// §5.5 #17-20 ⑩⑫ v4.94 — 공통 디버그 층(붙기·풀기·조작판)
import {
  attachDebugSession,
  findSessionByRun,
  hydrateDebugState,
  releaseDebugWait,
  requestFreeDebugPort,
  useDebugSessions,
} from '../../stores/debugSessions.js';
import { IDEDebugSessionPanel } from './IDEDebugSessionPanel.js';
// §5.5 #17-27 ⑬ (h) — 본문에서 눌러 띄운 실행(구성 스캔에 없는 것)을 가려내는 접두사.
import { ADHOC_RUN_PREFIX } from './runExecutableFile.js';

/**
 * §5.5 #17-20 v4.74 — 활동바 **디버그**가 여는 사이드바.
 *
 * 세 층이 위에서부터 그대로 보인다:
 *   A) 실행 구성 — 사용자의 `launch.json`·`tasks.json`·scripts 를 그대로 읽어 켜고 끈다.
 *   B) 에이전트 디버그 도구 — 남이 만든 MCP 서버를 이 에이전트에 꽂는다(디버거 본체는 안 만든다).
 *   C) 외부 디버거 — 우리가 라이선스상 못 하는 네이티브 디버깅은 설치된 IDE 로 넘긴다.
 */

const SOURCE_LABEL_KEY: Record<RunConfigSource, string> = {
  'launch.json': 'ide.debug.source.launchJson',
  'tasks.json': 'ide.debug.source.tasksJson',
  'package.json': 'ide.debug.source.packageJson',
  vibisual: 'ide.debug.source.vibisual',
  unreal: 'ide.debug.source.unreal',
  detected: 'ide.debug.source.detected',
};

/** 출처마다 색을 달리해 "내가 쓴 것"과 "우리가 추측한 것"이 한눈에 갈리게. */
const SOURCE_TONE: Record<RunConfigSource, string> = {
  'launch.json': 'bg-sky-500/15 text-sky-300',
  'tasks.json': 'bg-violet-500/15 text-violet-300',
  'package.json': 'bg-emerald-500/15 text-emerald-300',
  vibisual: 'bg-amber-500/15 text-amber-300',
  // `.uproject` 를 읽어서 만든 것이라 추측(detected)이 아니다 — 사용자가 쓴 파일들과 같은 채도.
  unreal: 'bg-cyan-500/15 text-cyan-300',
  detected: 'bg-gray-600/30 text-gray-400',
};

function PlayIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

function StopIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export const IDEDebugView = memo(function IDEDebugView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const config = useGraphStore((s) => s.agentConfigs[agentId]) as AgentConfig | undefined;
  const addCommand = useGraphStore((s) => s.addCommand);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);

  const sessions = useRunSessions((s) => s.sessions);
  const openOutput = useRunSessions((s) => s.openOutput);

  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * ⑫ — 디버그 모드 토글은 **런타임 스토어**에 산다. 종전에는 이 컴포넌트의 `useState` 라
   * 사이드바를 다른 항목으로 옮겼다 돌아오면 꺼져 있었다(켠 줄 알고 실행하면 평범하게 떴다).
   */
  const debugMode = useDebugSessions((s) => s.debugModeByAgent[agentId] ?? false);
  const setDebugModeFor = useDebugSessions((s) => s.setDebugMode);
  const setDebugMode = useCallback((on: boolean) => setDebugModeFor(agentId, on), [agentId, setDebugModeFor]);
  const debugSessions = useDebugSessions((s) => s.sessions);
  const debugAdapters = useDebugSessions((s) => s.adapters);
  /** runId → 붙기 실패 사유(그 자리에 그대로 적는다). */
  const [attachErrors, setAttachErrors] = useState<Record<string, string>>({});
  /** 지금 이 프로젝트에 찍힌 중단점 — 붙을 때 함께 실어 보낸다(붙기 절차 ②). */
  const projectName = useIDEPaneProjectName();
  const breakpointsForProject = useGraphStore((s) => (projectName ? s.debugBreakpoints[projectName] : undefined));
  const [debuggers, setDebuggers] = useState<ExternalDebuggerInfo[]>([]);
  const [sentRunIds, setSentRunIds] = useState<Record<string, boolean>>({});
  // §5.5 #17-29 — 훅 버블은 읽기 전용. 실패 로그를 에이전트에게 넘기는 것도 명령이라 손잡이를 지운다.
  const isReadOnlyAgent = useGraphStore((s) => isReadOnlyHookAgent(s.nodeMap[agentId]));
  const [savingMcp, setSavingMcp] = useState(false);
  /** 언리얼 붙이기 결과 — runId → 성공 여부·사유(서버가 준 이유를 그 자리에 적는다). */
  const [attachState, setAttachState] = useState<Record<string, { ok: boolean; reason?: string }>>({});

  const enabledMcp = useMemo(() => new Set(config?.mcpServers ?? []), [config?.mcpServers]);

  const loadConfigs = useCallback(() => {
    if (!rootPath) {
      setConfigs([]);
      setScanned([]);
      return;
    }
    setLoading(true);
    fetch(`/api/run-configs?root=${encodeURIComponent(rootPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { configs?: RunConfig[]; scanned?: string[] }) => {
        setConfigs(data.configs ?? []);
        setScanned(data.scanned ?? []);
      })
      .catch(() => {
        setConfigs([]);
        setScanned([]);
      })
      .finally(() => setLoading(false));
  }, [rootPath]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!rootPath) {
      setDebuggers([]);
      return;
    }
    fetch(`/api/external-debuggers?root=${encodeURIComponent(rootPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { debuggers?: ExternalDebuggerInfo[] }) => setDebuggers(data.debuggers ?? []))
      .catch(() => setDebuggers([]));
  }, [rootPath]);

  // ⑩ — 살아 있는 세션·어댑터 목록을 한 번 받아 온다(다른 창에서 붙여 둔 것도 보인다).
  useEffect(() => {
    void hydrateDebugState();
  }, []);

  /**
   * ⑫ 디버그 포트 — **서버에게 비어 있는 자리를 묻는다.**
   *
   * 종전에는 우리 실행 세션 안에서만 겹치는지 봐서(`sessions` 순회), 밖에서 이미 9229 를 쓰는
   * 프로세스가 있으면 그대로 부딪혔다. 실제 리슨 여부는 서버만 볼 수 있고, 상한
   * (`DEBUG_PORT_SCAN_MAX`)도 그쪽에서 지켜진다. 물어보지 못하면 기본 포트로 간다(예전 동작).
   */
  const handleRun = useCallback(
    (runConfig: RunConfig) => {
      if (!config || !rootPath) return;
      if (runConfig.attachOnly) return;
      if (!debugMode) {
        void startRun({
          agentId,
          cwd: rootPath,
          config,
          runConfig,
          command: runConfig.command,
          debugMode: false,
          debugApplied: false,
        });
        return;
      }
      void requestFreeDebugPort(DEBUG_PORT_BASE).then((freePort) => {
        const port = freePort ?? DEBUG_PORT_BASE;
        const built = buildDebugCommand(runConfig, port);
        void startRun({
          agentId,
          cwd: rootPath,
          config,
          runConfig,
          command: built.command,
          ...(built.env ? { env: built.env } : {}),
          debugMode: true,
          ...(built.applied ? { debugPort: port } : {}),
          debugApplied: built.applied,
          noteKey: built.noteKey,
        });
      });
    },
    [agentId, config, rootPath, debugMode],
  );

  /** ⑩ — 그 실행의 디버기에 붙는다(런타임에 따라 CDP·DAP 로 갈리는 것은 서버가 정한다). */
  const handleAttachDebugger = useCallback(
    (runId: string, runConfig: RunConfig, port?: number) => {
      if (!rootPath) return;
      const projectBreakpoints = (projectName ? breakpointsForProject : undefined) ?? [];
      setAttachErrors((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      void attachDebugSession({
        runId,
        root: rootPath,
        runtime: runConfig.runtime,
        ...(port ? { port } : {}),
        command: runConfig.command,
        // 지금 이 프로젝트에 찍혀 있는 중단점을 **함께** 보낸다 — 붙은 뒤에 따로 밀어 넣으면
        // 그 사이에 프로세스가 시작 코드를 지나가 첫 중단점을 놓친다.
        breakpoints: projectBreakpoints,
      }).then((result) => {
        if (!result.ok) {
          setAttachErrors((prev) => ({ ...prev, [runId]: result.error ?? 'unknown' }));
        }
      });
    },
    // 중단점 목록을 의존성에서 빠뜨리면 **찍어 둔 뒤 붙을 때 옛 목록**이 실려 나간다.
    [rootPath, projectName, breakpointsForProject],
  );

  /** ⑫ — 붙지 않고 그냥 진행(멈춰 선 프로세스를 죽였다 다시 켜지 않아도 되게). */
  const handleReleaseWait = useCallback((runId: string, port: number) => {
    void releaseDebugWait(port).then((result) => {
      if (!result.ok) setAttachErrors((prev) => ({ ...prev, [runId]: result.error ?? 'unknown' }));
    });
  }, []);

  /** 실패한 실행을 기존 명령 큐로 넘긴다 — 새 통신 레이어 ❌. */
  const handleSendFailure = useCallback(
    (runId: string) => {
      if (isReadOnlyAgent) return;
      const session = sessions[runId];
      if (!session) return;
      const tail = getRunTail(runId, RUN_FAILURE_TAIL_LINES);
      const text = [
        t('ide.debug.failurePrompt', { name: session.name, code: session.exitCode ?? -1 }),
        '',
        `\`${session.command}\``,
        '',
        '```',
        ...tail,
        '```',
      ].join('\n');
      addCommand(agentId, text, activeSessionId ?? null);
      setSentRunIds((prev) => ({ ...prev, [runId]: true }));
    },
    [sessions, addCommand, agentId, activeSessionId, isReadOnlyAgent, t],
  );

  /** MCP 프리셋 토글 — PUT 은 body 로 config 전량을 재구축하므로 **항상 전체를 보낸다**. */
  const handleToggleMcp = useCallback(
    (presetId: string) => {
      if (!config) return;
      const current = config.mcpServers ?? [];
      const next = current.includes(presetId)
        ? current.filter((id) => id !== presetId)
        : [...current, presetId];
      setSavingMcp(true);
      fetch(`/api/agent-config/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, mcpServers: next }),
      })
        .catch(() => { /* 스냅샷 broadcast 가 진실 — 실패하면 화면이 원래 값으로 되돌아온다 */ })
        .finally(() => setSavingMcp(false));
    },
    [agentId, config],
  );

  /**
   * 언리얼 붙이기 — `-WaitForDebugger` 로 멈춰 선 에디터에 네이티브 디버거를 붙인다.
   *
   * 우리가 멈춰 세우는 것이 아니라(⑦ 재배포 불가), 우리가 띄운 프로세스를 남의 디버거에
   * 넘겨 주는 것이다. 실패 사유는 서버가 준 것을 그대로 화면에 적는다 — "에디터가 안 떠 있다"
   * 와 "Visual Studio 가 없다" 는 사용자가 해야 할 일이 다르다.
   */
  const handleAttachUnreal = useCallback(
    (runId: string) => {
      if (!rootPath) return;
      fetch('/api/unreal/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootPath }),
      })
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          setAttachState((prev) => ({
            ...prev,
            [runId]: r.ok ? { ok: true } : { ok: false, ...(data.error ? { reason: data.error } : {}) },
          }));
        })
        .catch(() => setAttachState((prev) => ({ ...prev, [runId]: { ok: false } })));
    },
    [rootPath],
  );

  const handleLaunchExternal = useCallback(
    (id: string) => {
      if (!rootPath) return;
      fetch(`/api/external-debuggers/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, root: rootPath }),
      }).catch(() => { /* 표시 전용 — 실패해도 목록은 그대로 */ });
    },
    [rootPath],
  );

  /**
   * §5.5 #17-27 ⑬ (h) — **본문에서 눌러 띄운 실행**. 구성 스캔(A층)에 없으므로 그 목록에는 뜨지 않는다.
   *
   * 출력 패널을 닫고 나면 되돌아갈 자리가 없어 "돌고 있는데 멈출 손잡이가 없는" 프로세스가 되므로
   * 여기 따로 세운다 — 새 상태를 만들지 않고 같은 실행 세션 스토어를 접두사로 거른다.
   */
  const adhocRuns = useMemo(
    () =>
      Object.values(sessions)
        .filter((s) => s.agentId === agentId && s.configId.startsWith(ADHOC_RUN_PREFIX))
        .sort((a, b) => b.startedAt - a.startedAt),
    [sessions, agentId],
  );

  const runningCount = countRunning(sessions, agentId);

  if (!rootPath) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-gray-500">
        {t('ide.debug.noProject')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — 제목 + 실행 중 수 + 새로고침 */}
      <div className="flex items-center gap-1 border-b border-gray-700/60 px-2 py-1.5">
        <span className="flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.debug.title')}
        </span>
        {runningCount > 0 && (
          <span className="rounded bg-amber-500/20 px-1 text-[12px] font-bold tabular-nums text-amber-300">
            {runningCount}
          </span>
        )}
        <button
          type="button"
          onClick={loadConfigs}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.debug.refresh')}
          aria-label={t('ide.debug.refresh')}
        >
          <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {/* 디버그 모드 스위치 — 같은 구성을 디버거가 붙을 수 있게 켠다. */}
          <label className="flex cursor-pointer items-start gap-2 rounded border border-gray-700/60 bg-gray-800/40 px-2 py-1.5">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
              className="mt-0.5 h-3 w-3 accent-amber-500"
            />
            <span className="flex-1">
              <span className="block text-[12px] font-semibold text-gray-200">{t('ide.debug.debugMode')}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-gray-500">{t('ide.debug.debugModeHint')}</span>
            </span>
          </label>

          {/* A층 — 실행 구성 */}
          <section>
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
              {t('ide.debug.configs')}
            </h3>
            {configs.length === 0 ? (
              <p className="px-1 py-2 text-[12px] leading-snug text-gray-600">{t('ide.debug.noConfigs')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {configs.map((cfg) => {
                  const runId = runIdFor(agentId, cfg.id);
                  const session = sessions[runId];
                  const running = !!session && session.status !== 'exited';
                  const failed = !!session && session.status === 'exited' && (session.exitCode ?? 0) !== 0;
                  // ⑩ — 이 실행에 붙어 있는 디버그 세션(없으면 null).
                  const debugSession = findSessionByRun(debugSessions, runId);
                  /**
                   * ⑫ — "디버거가 붙기를 기다리는 중". `--inspect-brk`·`suspend=y`·`--wait-for-client`
                   * 는 전부 붙을 때까지 프로세스를 세워 두므로, 붙지 않은 동안 화면은 아무 일도
                   * 안 일어난 것처럼 보였다. 그 상태를 이제 그대로 적는다.
                   */
                  const waitingForDebugger =
                    running && !!session?.debugMode && session.debugApplied && !debugSession;
                  const attachError = attachErrors[runId];
                  return (
                    <li key={cfg.id} className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200" title={cfg.reason}>
                          {cfg.name}
                        </span>
                        {/*
                          ⑫ — `request:'attach'` 구성은 종전에 **버튼만 막혀 있었다**(우리가 띄우지
                          않으니 실행할 것이 없다는 이유로). 이제 그 구성이 가리키는 포트로 공통
                          디버그 층이 **진짜로 붙는다** — attach 구성의 본래 뜻이 그것이다.
                        */}
                        {cfg.attachOnly && !!cfg.port && !debugSession && (
                          <button
                            type="button"
                            onClick={() => handleAttachDebugger(runId, cfg, cfg.port)}
                            className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[12px] text-sky-300 transition-colors hover:bg-sky-500/30"
                          >
                            {t('ide.debug.connectDebugger')}
                          </button>
                        )}
                        {running ? (
                          <button
                            type="button"
                            onClick={() => void stopRun(runId)}
                            className="rounded p-0.5 text-rose-400 transition-colors hover:bg-gray-700 hover:text-rose-300"
                            title={t('ide.debug.stop')}
                            aria-label={t('ide.debug.stop')}
                          >
                            <StopIcon />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRun(cfg)}
                            disabled={cfg.attachOnly || !config}
                            className="rounded p-0.5 text-emerald-400 transition-colors hover:bg-gray-700 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-gray-600"
                            title={cfg.attachOnly ? t('ide.debug.attachOnly') : t('ide.debug.run')}
                            aria-label={t('ide.debug.run')}
                          >
                            <PlayIcon />
                          </button>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className={`rounded px-1 text-[12px] font-medium ${SOURCE_TONE[cfg.source]}`}>
                          {t(SOURCE_LABEL_KEY[cfg.source])}
                        </span>
                        {running && (
                          <span className="flex items-center gap-0.5 text-[12px] text-amber-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                            {t('ide.debug.running')}
                          </span>
                        )}
                        {session?.debugMode && session.debugPort && (
                          <span className="text-[12px] text-sky-300">:{session.debugPort}</span>
                        )}
                        {waitingForDebugger && (
                          <span className="flex items-center gap-0.5 text-[12px] text-sky-300">
                            <svg className="h-3 w-3 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="9" />
                              <path d="M12 7v5l3 2" />
                            </svg>
                            {t('ide.debug.waitingForDebugger')}
                          </span>
                        )}
                        {session && session.status === 'exited' && (
                          <span className={`text-[12px] ${failed ? 'text-rose-400' : 'text-gray-500'}`}>
                            {t('ide.debug.exitCode', { code: session.exitCode ?? 0 })}
                          </span>
                        )}
                      </div>
                      {session?.debugMode && !session.debugApplied && (
                        <p className="mt-0.5 text-[12px] leading-snug text-amber-400/80">
                          {t('ide.debug.notApplied')}
                        </p>
                      )}
                      {session && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openOutput(runId)}
                            className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600"
                          >
                            {t('ide.debug.output')}
                          </button>
                          {session.status === 'exited' && (
                            <button
                              type="button"
                              onClick={() => handleRun(cfg)}
                              className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600"
                            >
                              {t('ide.debug.restart')}
                            </button>
                          )}
                          {failed && !isReadOnlyAgent && (
                            <button
                              type="button"
                              onClick={() => handleSendFailure(runId)}
                              disabled={sentRunIds[runId]}
                              className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[12px] text-rose-300 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
                            >
                              {sentRunIds[runId] ? t('ide.debug.sentToAgent') : t('ide.debug.sendToAgent')}
                            </button>
                          )}
                          {/*
                            ⑩⑫ — 공통 디버그 층. 언리얼(delegated)만 빼고 어느 런타임이든 같은
                            버튼 두 개다: 붙거나(중단점·스텝·변수), 붙지 않고 그냥 진행하거나.
                          */}
                          {running && session.debugMode && cfg.runtime !== 'unreal' && !debugSession && (
                            <button
                              type="button"
                              onClick={() => handleAttachDebugger(runId, cfg, session.debugPort)}
                              className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[12px] text-sky-300 transition-colors hover:bg-sky-500/30"
                            >
                              {t('ide.debug.connectDebugger')}
                            </button>
                          )}
                          {waitingForDebugger && cfg.runtime === 'node' && session.debugPort && (
                            <button
                              type="button"
                              onClick={() => handleReleaseWait(runId, session.debugPort as number)}
                              className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600"
                              title={t('ide.debug.releaseWaitHint')}
                            >
                              {t('ide.debug.releaseWait')}
                            </button>
                          )}
                          {/* 언리얼은 포트가 아니라 pid 로 붙는다 — 디버그로 띄운 에디터가 살아 있을 때만. */}
                          {cfg.runtime === 'unreal' && running && session.debugMode && (
                            <button
                              type="button"
                              onClick={() => handleAttachUnreal(runId)}
                              className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[12px] text-cyan-300 transition-colors hover:bg-cyan-500/30"
                            >
                              {t('ide.debug.attachDebugger')}
                            </button>
                          )}
                        </div>
                      )}
                      {attachState[runId] && (
                        <p
                          className={`mt-0.5 text-[12px] leading-snug ${attachState[runId]?.ok ? 'text-cyan-300/90' : 'text-amber-400/80'}`}
                        >
                          {attachState[runId]?.ok
                            ? t('ide.debug.attachOk')
                            : t(`ide.debug.attachError.${attachState[runId]?.reason ?? 'unknown'}`, {
                                defaultValue: t('ide.debug.attachError.unknown'),
                              })}
                        </p>
                      )}
                      {/* ⑩ — 붙기 실패 사유는 그대로 적는다("어댑터가 없다"와 "포트가 안 열렸다"는 할 일이 다르다). */}
                      {attachError && (
                        <p className="mt-0.5 text-[12px] leading-snug text-amber-400/80">
                          {t(`ide.debug.sessionError.${attachError}`, { defaultValue: attachError })}
                        </p>
                      )}
                      {/* ⑩ — 붙어 있으면 조작판(계속·스텝·콜스택·변수·워치)이 그 자리에 펼쳐진다. */}
                      {debugSession && <IDEDebugSessionPanel session={debugSession} />}
                    </li>
                  );
                })}
              </ul>
            )}
            {scanned.length > 0 && (
              <p className="mt-1 truncate px-1 text-[12px] text-gray-600" title={scanned.join(' · ')}>
                {t('ide.debug.scanned', { files: scanned.join(' · ') })}
              </p>
            )}
          </section>

          {/* A층 곁 — 본문(⑬ (h))에서 눌러 띄운 실행. 하나도 없으면 자리 자체가 없다. */}
          {adhocRuns.length > 0 && (
            <section>
              <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                {t('ide.debug.adhocRuns')}
              </h3>
              <ul className="flex flex-col gap-1">
                {adhocRuns.map((run) => {
                  const running = run.status !== 'exited';
                  const failed = !running && (run.exitCode ?? 0) !== 0;
                  return (
                    <li key={run.runId} className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200" title={run.command}>
                          {run.name}
                        </span>
                        {running ? (
                          <button
                            type="button"
                            onClick={() => void stopRun(run.runId)}
                            className="rounded p-0.5 text-rose-400 transition-colors hover:bg-gray-700 hover:text-rose-300"
                            title={t('ide.debug.stop')}
                            aria-label={t('ide.debug.stop')}
                          >
                            <StopIcon />
                          </button>
                        ) : (
                          <span className={`text-[12px] ${failed ? 'text-rose-400' : 'text-gray-500'}`}>
                            {t('ide.debug.exitCode', { code: run.exitCode ?? 0 })}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openOutput(run.runId)}
                          className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600"
                        >
                          {t('ide.debug.output')}
                        </button>
                        {running && (
                          <span className="flex items-center gap-1 text-[12px] text-amber-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                            {t('ide.debug.running')}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* B층 — 에이전트 디버그 도구(MCP) */}
          <section>
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
              {t('ide.debug.mcpTitle')}
            </h3>
            <p className="mb-1 px-1 text-[12px] leading-snug text-gray-600">{t('ide.debug.mcpHint')}</p>
            <ul className="flex flex-col gap-1">
              {MCP_SERVER_PRESETS.map((preset) => (
                <li key={preset.id} className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
                  <label className="flex cursor-pointer items-start gap-1.5">
                    <input
                      type="checkbox"
                      checked={enabledMcp.has(preset.id)}
                      onChange={() => handleToggleMcp(preset.id)}
                      disabled={!config || savingMcp}
                      className="mt-0.5 h-3 w-3 accent-sky-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-gray-200">{t(preset.labelKey)}</span>
                      <span className="block truncate text-[12px] text-gray-500" title={preset.name}>{preset.name}</span>
                    </span>
                  </label>
                  {preset.requiresKey && enabledMcp.has(preset.id) && (
                    <p className="mt-0.5 text-[12px] leading-snug text-amber-400/80">{t(preset.requiresKey)}</p>
                  )}
                  <a
                    href={preset.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-block text-[12px] text-sky-400 hover:text-sky-300 hover:underline"
                  >
                    {t('ide.debug.docs')}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1 px-1 text-[12px] leading-snug text-gray-600">{t('ide.debug.mcpApplyHint')}</p>
          </section>

          {/*
            §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층: 어느 런타임을 지금 붙일 수 있는가.
            **없으면 없다고 적는다**(⑦ 외부 디버거 목록과 같은 규율) — 버튼이 안 먹는 이유를
            사용자가 화면에서 읽을 수 있어야 한다.
          */}
          <section>
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
              {t('ide.debug.adapterTitle')}
            </h3>
            <p className="mb-1 px-1 text-[12px] leading-snug text-gray-600">{t('ide.debug.adapterHint')}</p>
            <ul className="flex flex-col gap-1">
              {debugAdapters.map((adapter) => (
                <li
                  key={adapter.runtime}
                  className="flex items-center gap-1 rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-gray-200">
                      {t(`ide.debug.runtime.${adapter.runtime}`, { defaultValue: adapter.runtime })}
                    </span>
                    <span className="block truncate text-[12px] text-gray-500" title={adapter.execPath ?? adapter.licence}>
                      {adapter.licence}
                    </span>
                  </span>
                  {adapter.available ? (
                    <span className="rounded bg-emerald-500/15 px-1 text-[12px] font-medium text-emerald-300">
                      {t('ide.debug.adapterReady')}
                    </span>
                  ) : adapter.backend === 'delegated' ? (
                    <span className="text-[12px] text-gray-600">{t('ide.debug.adapterDelegated')}</span>
                  ) : (
                    <a
                      href={adapter.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] text-sky-400 hover:text-sky-300 hover:underline"
                      title={t(adapter.installKey)}
                    >
                      {t('ide.debug.adapterMissing')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* C층 — 외부 디버거 위임 */}
          <section>
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
              {t('ide.debug.externalTitle')}
            </h3>
            <p className="mb-1 px-1 text-[12px] leading-snug text-gray-600">{t('ide.debug.externalHint')}</p>
            <ul className="flex flex-col gap-1">
              {debuggers.map((dbg) => (
                <li
                  key={dbg.id}
                  className="flex items-center gap-1 rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-gray-200">{dbg.name}</span>
                    {dbg.reason && <span className="block truncate text-[12px] text-gray-500">{dbg.reason}</span>}
                  </span>
                  {dbg.available ? (
                    <button
                      type="button"
                      onClick={() => handleLaunchExternal(dbg.id)}
                      className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600"
                    >
                      {t('ide.debug.open')}
                    </button>
                  ) : (
                    <span className="text-[12px] text-gray-600">{t('ide.debug.notInstalled')}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ScrollFade>
    </div>
  );
});
