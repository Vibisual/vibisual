import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionLoop, SessionLoopMode, SessionLoopContextMode, SubAgent } from '@vibisual/shared';
import { isReadOnlyHookAgent } from '@vibisual/shared';
import {
  SESSION_LOOP_MAX_ITERATIONS,
  SESSION_LOOP_DEFAULT_TOTAL,
  SESSION_LOOP_MAX_INTERVAL_MS,
  SESSION_LOOP_PATH_MAX,
} from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay, agentSessionInputKey } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { useSessionFormDraft } from '../../stores/sessionFormDrafts.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-11 ⑨ v4.51 — 세션 반복 실행(루프) 설정 뷰.
//
// 스킬(#17-4)·목표(#17-17 ④) 뷰와 같은 자리(사이드바 `w-52`)에 뜬다 — 루프 설정은 화면을
// 가로채는 것이 아니라 **세션이 지금 무엇을 하는지 보면서** 곁눈으로 만지는 것이기 때문
// (v4.51 이전의 덮개 패널 `IDELoopPanel` 은 폐지).
//
// 설정 단위는 **지금 열려 있는 IDE 세션 탭 하나**다. 탭을 바꾸면 그 탭의 루프가 보인다.
//
// §5.5 #17-11 ⑬ — 폼 값은 `서버 값(바탕) ← 세션별 초안(사용자가 건드린 칸)` 병합이다.
// 종전엔 12개 `useState` 를 activeSessionId 가 바뀔 때마다 서버 값으로 되채웠는데, [시작] 전
// 입력은 서버에 없으므로 **다른 탭에 다녀오면 쳐 둔 값이 전부 사라졌다**. 이제 손댄 칸은
// `useSessionFormDraft` 가 탭·뷰·앱 재시작을 건너 붙잡고, 손대지 않은 칸만 스냅샷을 따라간다.
//
// 실행·계수·정지는 전부 서버(SSOT)가 한다. 이 컴포넌트는 폼을 PUT 으로 보내고,
// 되돌아오는 graph_snapshot 의 `sessionLoops` 를 그대로 그린다(낙관적 진행 표시 ❌).

const EMPTY_SUBS: SubAgent[] = [];

/** §5.5 #17-11 ⑬ — 초안 저장소에서 이 폼을 가리키는 이름. */
const LOOP_FORM_ID = 'ide.loop';

/** 화면이 다루는 폼 값 한 벌 — 초안에 담기도록 전부 원시 타입이다(숫자 칸은 빈 값 허용을 위해 문자열). */
type LoopFormValues = {
  command: string;
  mode: SessionLoopMode;
  total: number;
  intervalSec: number;
  stopOnError: boolean;
  contextMode: SessionLoopContextMode;
  maxCostUsd: string;
  maxKTokens: string;
  maxMinutes: string;
  progressFile: string;
  oneTaskPerRound: boolean;
  commitEachRound: boolean;
  commandFile: string;
};

/** 낡은 초안이 모르는 문자열을 들고 있어도 화면이 깨지지 않게 되돌린다. */
function asLoopMode(value: string): SessionLoopMode {
  return value === 'infinite' ? 'infinite' : 'count';
}

function asContextMode(value: string): SessionLoopContextMode {
  return value === 'compact' || value === 'clear' ? value : 'none';
}

/** 남은 시간 — 초/분 단위로 짧게. 1초 틱 now 를 받아 순수 계산으로 유지. */
function formatRemaining(nextRunAt: number, now: number): string {
  const sec = Math.max(0, Math.ceil((nextRunAt - now) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/** §5.5 #17-11 ⑫(a) — 누적 토큰 한 줄 표기(좁은 폭이라 k/M 로 접는다). */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** §5.5 #17-11 ⑫(a) — 경과 시간 한 줄 표기. */
function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

interface Props {
  agentId: string;
}

export const IDELoopView = memo(function IDELoopView({ agentId }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const loop: SessionLoop | undefined = useGraphStore((s) => (activeSessionId ? s.sessionLoops[activeSessionId] : undefined));
  const subs = useGraphStore((s) => s.subAgents[agentId]) ?? EMPTY_SUBS;
  const subLabels = useGraphStore((s) => s.subAgentLabels);
  const saveSessionLoop = useGraphStore((s) => s.saveSessionLoop);
  const endSessionLoop = useGraphStore((s) => s.endSessionLoop);

  const sessionLabel = useMemo(() => {
    if (!activeSessionId) return null;
    return subLabels[activeSessionId] ?? subs.find((s) => s.id === activeSessionId)?.label ?? activeSessionId;
  }, [activeSessionId, subs, subLabels]);

  // 바탕값 — 서버에 저장돼 있는 이 탭의 루프 설정(없으면 기본값).
  //   `maxCostUsd`·`maxKTokens`·`maxMinutes` 는 빈 칸(=무제한)을 표현해야 하므로 문자열로 둔다.
  const base = useMemo<LoopFormValues>(() => ({
    command: loop?.command ?? '',
    mode: loop?.mode ?? 'count',
    total: loop?.total ?? SESSION_LOOP_DEFAULT_TOTAL,
    intervalSec: Math.round((loop?.intervalMs ?? 0) / 1000),
    stopOnError: loop?.stopOnError ?? true,
    // §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 처리(없음/압축/초기화).
    contextMode: loop?.contextMode ?? 'none',
    // §5.5 #17-11 ⑫(a) — 예산 상한. 화면 단위는 달러 / 천 토큰 / 분, 빈 값이면 무제한.
    maxCostUsd: loop?.maxCostUsd ? String(loop.maxCostUsd) : '',
    maxKTokens: loop?.maxTokens ? String(Math.round(loop.maxTokens / 1000)) : '',
    maxMinutes: loop?.maxDurationMs ? String(Math.round(loop.maxDurationMs / 60000)) : '',
    // §5.5 #17-11 ⑫(c)(d)(e)(f) — 회차 프롬프트 규약.
    progressFile: loop?.progressFile ?? '',
    oneTaskPerRound: loop?.oneTaskPerRound ?? false,
    commitEachRound: loop?.commitEachRound ?? false,
    commandFile: loop?.commandFile ?? '',
  }), [loop]);

  // §5.5 #17-11 ⑬ — 이 탭에 쳐 둔 초안이 바탕값을 덮는다. 탭을 옮겼다 와도, 뷰를 접었다 펴도,
  // 앱을 껐다 켜도 남는다. 손대지 않은 칸은 계속 서버 스냅샷을 따라간다.
  const scopeId = activeSessionId ? agentSessionInputKey(agentId, activeSessionId) : null;
  const [form, patchForm, clearLoopDraft] = useSessionFormDraft(LOOP_FORM_ID, scopeId, base);
  const {
    command, total, intervalSec, stopOnError,
    maxCostUsd, maxKTokens, maxMinutes,
    progressFile, oneTaskPerRound, commitEachRound, commandFile,
  } = form;
  const mode = asLoopMode(form.mode);
  const contextMode = asContextMode(form.contextMode);

  // 다음 회차까지 남은 시간 표시용 1초 틱 — 이 뷰가 열려 있는 동안만 돈다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // §5.5 #17-29 — 훅 버블은 읽기 전용. 루프는 회차마다 명령을 넣으므로 [시작]을 잠근다.
  const isReadOnlyAgent = useGraphStore((s) => isReadOnlyHookAgent(s.nodeMap[agentId]));

  // §5.5 #17-11 ⑫(f) — 본문을 파일에서 읽는 루프는 본문 칸이 비어 있어도 시작할 수 있다.
  const canSubmit = !isReadOnlyAgent && !!activeSessionId && (command.trim().length > 0 || commandFile.trim().length > 0);

  const handleStart = useCallback(() => {
    if (!activeSessionId || (!command.trim() && !commandFile.trim())) return;
    // 빈 칸 = 무제한. 숫자가 아니면 0(무제한)으로 떨어뜨린다 — 서버도 같은 규칙으로 다시 거른다.
    const num = (v: string): number => {
      const n = Number(v.trim());
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    void saveSessionLoop({
      agentId,
      subAgentId: activeSessionId,
      command: command.trim(),
      mode,
      ...(mode === 'count' ? { total: Math.min(Math.max(1, total), SESSION_LOOP_MAX_ITERATIONS) } : {}),
      intervalMs: Math.min(Math.max(0, Math.round(intervalSec * 1000)), SESSION_LOOP_MAX_INTERVAL_MS),
      stopOnError,
      contextMode,
      maxCostUsd: num(maxCostUsd),
      maxTokens: Math.round(num(maxKTokens) * 1000),
      maxDurationMs: Math.round(num(maxMinutes) * 60_000),
      progressFile: progressFile.trim(),
      oneTaskPerRound,
      commitEachRound,
      commandFile: commandFile.trim(),
      enabled: true,
    }).then(
      // §5.5 #17-11 ⑬ — 저장이 끝났으면 초안은 역할을 다했다(그 값은 이제 서버가 갖는다).
      clearLoopDraft,
      // 저장이 실패하면 초안을 그대로 남긴다 — 사용자가 친 값을 여기서 잃으면 안 된다.
      () => undefined,
    );
  }, [
    activeSessionId, agentId, command, mode, total, intervalSec, stopOnError, contextMode,
    maxCostUsd, maxKTokens, maxMinutes, progressFile, oneTaskPerRound, commitEachRound, commandFile,
    saveSessionLoop, clearLoopDraft,
  ]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    void endSessionLoop(agentId, activeSessionId, 'stop');
  }, [activeSessionId, agentId, endSessionLoop]);

  const handleDelete = useCallback(() => {
    if (!activeSessionId) return;
    void endSessionLoop(agentId, activeSessionId, 'delete');
  }, [activeSessionId, agentId, endSessionLoop]);

  // 세션 탭이 없으면 설정 대상이 없다 — 루프가 "세션 단위"라는 사실을 화면이 먼저 말한다.
  if (!activeSessionId) {
    return (
      <div className="flex flex-col gap-1 p-2">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.loop.title')}</span>
        <p className="px-1 py-2 text-[12px] leading-relaxed text-gray-500">{t('ide.loop.pickSession')}</p>
      </div>
    );
  }

  const statusLabel = loop ? t(`ide.loop.status.${loop.status}`) : null;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-1 px-3 pt-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.loop.title')}</span>
        {statusLabel && (
          <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold ${
            loop?.enabled ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-700/70 text-gray-300'
          }`}>
            {statusLabel}
          </span>
        )}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {/* 대상 세션 — 이 설정이 어느 탭의 것인지. */}
          <p className="break-words px-0.5 text-[12px] leading-relaxed text-gray-500">
            {t('ide.loop.scopeSession', { label: sessionLabel ?? activeSessionId })}
          </p>

          {/* 진행 상태 — 루프가 있을 때만. */}
          {loop && (
            <div className={`rounded border px-2 py-1.5 ${loop.enabled ? 'border-amber-500/40 bg-amber-500/5' : 'border-gray-700 bg-gray-800/60'}`}>
              <div className="flex items-center gap-1.5">
                {loop.enabled && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />}
                <span className="text-[12px] font-bold text-gray-100">
                  {loop.mode === 'count'
                    ? t('ide.loop.progressCount', { done: loop.completed, total: loop.total ?? 0 })
                    : t('ide.loop.progressInfinite', { done: loop.completed })}
                </span>
              </div>
              {/* §5.5 #17-11 ⑪·⑫(b) — 회차 사이 정리가 도는 동안에는 그 사실을 말한다(회차로 오인 방지). */}
              {loop.pendingCompactCommandId && (
                <p className="mt-1 text-[12px] text-amber-300/90">
                  {loop.contextMode === 'clear' ? t('ide.loop.clearing') : t('ide.loop.compacting')}
                </p>
              )}
              {/* §5.5 #17-11 ⑫(a) — 이번 사이클에 쓴 값. 상한이 있으면 `쓴 값 / 상한` 으로 보인다. */}
              {(loop.spentTokens > 0 || loop.spentCostUsd > 0 || loop.cycleStartedAt) && (
                <p className="mt-1 break-words text-[12px] leading-relaxed text-gray-400">
                  {t('ide.loop.spent', {
                    cost: loop.maxCostUsd
                      ? `$${loop.spentCostUsd.toFixed(2)}/$${loop.maxCostUsd}`
                      : `~$${loop.spentCostUsd.toFixed(2)}`,
                    tokens: loop.maxTokens
                      ? `${formatTokens(loop.spentTokens)}/${formatTokens(loop.maxTokens)}`
                      : formatTokens(loop.spentTokens),
                    elapsed: loop.cycleStartedAt
                      ? (loop.maxDurationMs
                        ? `${formatElapsed(now - loop.cycleStartedAt)}/${formatElapsed(loop.maxDurationMs)}`
                        : formatElapsed(now - loop.cycleStartedAt))
                      : '-',
                  })}
                </p>
              )}
              {loop.status === 'waiting' && loop.nextRunAt != null && loop.nextRunAt > now && (
                <p className="mt-1 text-[12px] text-gray-400">
                  {t('ide.loop.nextIn', { time: formatRemaining(loop.nextRunAt, now) })}
                </p>
              )}
              {loop.lastError && (
                <p className="mt-1 break-words text-[12px] leading-relaxed text-red-400">
                  {t('ide.loop.lastError', { message: loop.lastError })}
                </p>
              )}
            </div>
          )}

          {/* 반복할 명령 */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.commandLabel')}
            </span>
            <textarea
              value={command}
              onChange={(e) => patchForm({ command: e.target.value })}
              rows={4}
              placeholder={t('ide.loop.commandPlaceholder')}
              className="scrollbar-thin w-full resize-y rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-[12px] leading-relaxed text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
            />
            <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.commandHint')}</span>
          </label>

          {/* §5.5 #17-11 ⑫(f) — 매 회차 이 파일을 새로 읽어 본문으로 쓴다(도는 중에 고쳐도 반영). */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.commandFileLabel')}
            </span>
            <input
              type="text"
              value={commandFile}
              maxLength={SESSION_LOOP_PATH_MAX}
              onChange={(e) => patchForm({ commandFile: e.target.value })}
              placeholder={t('ide.loop.commandFilePlaceholder')}
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
            />
            <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.commandFileHint')}</span>
          </label>

          {/* 반복 방식 — 좁은 폭이라 세로로 쌓는다. */}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.modeLabel')}
            </span>
            <div className="flex items-center gap-1.5">
              <label className="flex flex-1 items-center gap-1.5 text-[12px] text-gray-200">
                <input
                  type="radio"
                  checked={mode === 'count'}
                  onChange={() => patchForm({ mode: 'count' })}
                  className="accent-amber-500"
                />
                {t('ide.loop.modeCount')}
              </label>
              <input
                type="number"
                min={1}
                max={SESSION_LOOP_MAX_ITERATIONS}
                value={total}
                disabled={mode !== 'count'}
                onChange={(e) => patchForm({ total: Number(e.target.value) || 1 })}
                className="w-14 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] tabular-nums text-gray-100 outline-none focus:border-amber-500/60 disabled:opacity-40"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-200">
              <input
                type="radio"
                checked={mode === 'infinite'}
                onChange={() => patchForm({ mode: 'infinite' })}
                className="accent-amber-500"
              />
              {t('ide.loop.modeInfinite')}
            </label>
          </div>

          {/* 회차 간 대기 */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.intervalLabel')}
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={Math.floor(SESSION_LOOP_MAX_INTERVAL_MS / 1000)}
                value={intervalSec}
                onChange={(e) => patchForm({ intervalSec: Math.max(0, Number(e.target.value) || 0) })}
                className="w-16 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] tabular-nums text-gray-100 outline-none focus:border-amber-500/60"
              />
              <span className="text-[12px] text-gray-400">{t('ide.loop.intervalUnit')}</span>
            </div>
            <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.intervalHint')}</span>
          </label>

          {/* 오류 시 정지 */}
          <label className="flex items-start gap-1.5 text-[12px] leading-snug text-gray-200">
            <input
              type="checkbox"
              checked={stopOnError}
              onChange={(e) => patchForm({ stopOnError: e.target.checked })}
              className="mt-0.5 flex-shrink-0 accent-amber-500"
            />
            {t('ide.loop.stopOnError')}
          </label>

          {/* §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 처리. 긴 루프의 실질 상한은 횟수가 아니라 컨텍스트다. */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.contextModeLabel')}
            </span>
            <select
              value={contextMode}
              onChange={(e) => patchForm({ contextMode: asContextMode(e.target.value) })}
              className="w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[12px] text-gray-100 outline-none focus:border-amber-500/60"
            >
              <option value="none">{t('ide.loop.contextModeNone')}</option>
              <option value="compact">{t('ide.loop.contextModeCompact')}</option>
              <option value="clear">{t('ide.loop.contextModeClear')}</option>
            </select>
            <span className="text-[12px] leading-relaxed text-gray-500">
              {contextMode === 'clear' ? t('ide.loop.contextModeClearHint') : t('ide.loop.contextModeCompactHint')}
            </span>
          </label>

          {/* §5.5 #17-11 ⑫(a) — 예산 상한. 빈 칸이면 무제한이고, 판정은 회차 경계에서만 난다. */}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.budgetLabel')}
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={0.5}
                value={maxCostUsd}
                onChange={(e) => patchForm({ maxCostUsd: e.target.value })}
                placeholder="0"
                className="w-16 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] tabular-nums text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
              />
              <span className="text-[12px] text-gray-400">{t('ide.loop.budgetCostUnit')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={10}
                value={maxKTokens}
                onChange={(e) => patchForm({ maxKTokens: e.target.value })}
                placeholder="0"
                className="w-16 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] tabular-nums text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
              />
              <span className="text-[12px] text-gray-400">{t('ide.loop.budgetTokenUnit')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={5}
                value={maxMinutes}
                onChange={(e) => patchForm({ maxMinutes: e.target.value })}
                placeholder="0"
                className="w-16 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] tabular-nums text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
              />
              <span className="text-[12px] text-gray-400">{t('ide.loop.budgetTimeUnit')}</span>
            </div>
            <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.budgetHint')}</span>
          </div>

          {/* §5.5 #17-11 ⑫(c) — 진행 파일. 압축·초기화로 대화가 날아가도 여기서 이어받는다. */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              {t('ide.loop.progressFileLabel')}
            </span>
            <input
              type="text"
              value={progressFile}
              maxLength={SESSION_LOOP_PATH_MAX}
              onChange={(e) => patchForm({ progressFile: e.target.value })}
              placeholder={t('ide.loop.progressFilePlaceholder')}
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
            />
            <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.progressFileHint')}</span>
          </label>

          {/* §5.5 #17-11 ⑫(d) — 회차당 한 가지 일 규칙(맨 위와 규칙란 양쪽에 들어간다). */}
          <label className="flex flex-col gap-0.5">
            <span className="flex items-start gap-1.5 text-[12px] leading-snug text-gray-200">
              <input
                type="checkbox"
                checked={oneTaskPerRound}
                onChange={(e) => patchForm({ oneTaskPerRound: e.target.checked })}
                className="mt-0.5 flex-shrink-0 accent-amber-500"
              />
              {t('ide.loop.oneTask')}
            </span>
            <span className="pl-5 text-[12px] leading-relaxed text-gray-500">{t('ide.loop.oneTaskHint')}</span>
          </label>

          {/* §5.5 #17-11 ⑫(e) — 회차 커밋 규약(커밋은 에이전트가 한다 — 서버는 git 을 건드리지 않는다). */}
          <label className="flex flex-col gap-0.5">
            <span className="flex items-start gap-1.5 text-[12px] leading-snug text-gray-200">
              <input
                type="checkbox"
                checked={commitEachRound}
                onChange={(e) => patchForm({ commitEachRound: e.target.checked })}
                className="mt-0.5 flex-shrink-0 accent-amber-500"
              />
              {t('ide.loop.commitEachRound')}
            </span>
            <span className="pl-5 text-[12px] leading-relaxed text-gray-500">{t('ide.loop.commitEachRoundHint')}</span>
          </label>

          {/* 조작 */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-800 pt-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canSubmit}
              className="rounded bg-amber-600 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loop?.enabled ? t('ide.loop.restart') : t('ide.loop.start')}
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={!loop?.enabled}
              className="rounded border border-gray-600 px-2 py-1 text-[12px] font-semibold text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('ide.loop.stop')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!loop}
              className="ml-auto rounded border border-red-500/40 px-2 py-1 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('ide.loop.delete')}
            </button>
          </div>

          <p className="text-[12px] leading-relaxed text-gray-500">{t('ide.loop.note')}</p>
        </div>
      </ScrollFade>
    </div>
  );
});
