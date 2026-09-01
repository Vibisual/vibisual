import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BackgroundTaskProbeResult, BackgroundTaskVerdict, FinishedSubagentTask, RunningSubagentTask,
} from '@vibisual/shared';
import { taskKindKey } from './runningSubagents.js';

/**
 * 이만큼 자식의 도구 이벤트가 끊기면 "무응답"으로 적는다. 죽었다고 단정하지 않는다 —
 * 폴링·긴 단일 호출은 정상적으로 조용할 수 있으므로, 판단 재료만 주고 결정은 사용자가 한다.
 */
const NO_RESPONSE_HINT_MS = 3 * 60 * 1000;

// §5.5 #17-9 ⑦ — "실행 중 서브에이전트" 뷰의 카드 두 장.
//
// 도는 카드(`RunningTaskRow`)는 ⑦(a) 의 자식 활동 — 지금 무슨 도구를 무엇에 대고 쓰는지 + 누적 호출 수 —
// 를 얹고, 끝난 카드(`FinishedTaskRow`)는 ⑦(b) 의 결과(부모가 받아 든 자식의 최종 보고)를 접힌 채 담는다.
// 뷰 본체와 갈라 둔 것은 파일 200줄 규칙 때문이며, 두 카드가 같은 시간 표기를 쓰기 때문이기도 하다.

/** 경과 시간 — 초/분/시간 단위로 짧게. 1초마다 갱신되는 now 를 받아 순수 계산으로 유지. */
export function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** 시작 시각 `HH:MM` — 얼마나 오래 붙잡고 있는지를 경과와 함께 읽게. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const CHIP = 'min-w-0 truncate rounded px-1 py-px text-[12px] font-semibold';
const KIND_CHIP = 'flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-px text-[12px] font-semibold';

/** 도구 글리프 — lucide `terminal-square` 톤. 색은 부모의 `text-*` 가 정한다. */
function ToolGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

/** 완료 글리프 — lucide `check` 톤. */
function DoneGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 구조된 결과 표식 — 아카이브 상자에서 꺼낸 모양(§5.5 #17-9 ⑦(b) 확장). */
function RescueGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

/** 서브에이전트 글리프 — lucide `git-branch` 톤(활동바 아이콘과 같은 계열). */
function AgentKindGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** 셸 글리프 — lucide `terminal` 톤(테두리 없는 프롬프트 꺾쇠). */
function ShellKindGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/**
 * 종류 칩 — 이 줄이 **AI 자식**인가 **셸**인가.
 *
 * 이 목록에는 성격이 아주 다른 둘이 섞인다: `Task`/`Agent` 로 띄운 서브에이전트(모델이 돌아 토큰을
 * 쓴다)와 `Bash run_in_background`·`Monitor` 로 띄운 셸(명령이 돌 뿐 토큰을 안 쓴다). 종전에는 둘
 * 다 "실행 중 서브에이전트" 한 이름으로 묶여 있어서, `tail -f` 한 줄이 **"내 AI 가 10분째 돌며
 * 토큰을 태우는 중"** 으로 읽혔다(사용자 보고). 비용도 끊는 방법도 다르므로 갈라 적는다.
 * 판정 근거는 서버가 이미 싣고 있던 `origin` 하나뿐이다 — 새 수집 경로 ❌.
 */
function KindChip({ origin }: { origin?: 'hook' | 'stream' }): React.JSX.Element {
  const { t } = useTranslation();
  const isShell = taskKindKey(origin) === 'kindShell';
  return (
    <span
      className={`${KIND_CHIP} ${isShell ? 'bg-slate-500/20 text-slate-300' : 'bg-indigo-500/20 text-indigo-300'}`}
      title={t(isShell ? 'ide.runningSubagents.kindShellTip' : 'ide.runningSubagents.kindAgentTip')}
    >
      {isShell ? <ShellKindGlyph /> : <AgentKindGlyph />}
      {t(isShell ? 'ide.runningSubagents.kindShell' : 'ide.runningSubagents.kindAgent')}
    </span>
  );
}

/** 파일에서 읽은 종료 표식 글리프 — lucide `file-check` 톤. */
function FileEndGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

/**
 * 판정 글리프 — lucide `search-check` 톤. **물어보고 답을 받았다**는 뜻이라 돋보기 안에 체크가 있다.
 * ⑭ 의 세 줄(확인 중 · 아직 도는 중 · 확인 후 자동 정리)이 전부 이 하나를 쓴다 —
 * 같은 출처(판정 에이전트 1회)에서 나온 말이라는 것을 모양으로 먼저 알리기 위함이다.
 */
function ProbeGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="m8 11 2 2 4-4" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** 세션 소멸 글리프 — lucide `power-off` 톤(전원이 빠진 자리). */
function PowerOffGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

/** 사용자가 직접 내린 표식 — 닫기와 같은 X 를 작게. */
function DismissedGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** 판정 결과별 문구·색 — 도는 카드와 끝난 카드가 **같은 말**을 쓰게 한 곳에서 정한다. */
const PROBE_TONE: Record<BackgroundTaskVerdict, { key: string; cls: string }> = {
  alive: { key: 'ide.runningSubagents.probeAlive', cls: 'text-sky-300/90' },
  unknown: { key: 'ide.runningSubagents.probeUnknown', cls: 'text-gray-400' },
  finished: { key: 'ide.runningSubagents.probeFinished', cls: 'text-amber-400/90' },
};

/**
 * §5.5 #17-9 ⑭(f) — **판정 1건을 그대로 적는다.**
 *
 * 자동으로 무엇을 하려면 그 근거가 화면에 남아야 한다. 판정이 `alive`/`unknown` 이면 항목은 그대로
 * 남고 이 블록만 붙어 "왜 30분째 떠 있는지"를 그 자리에서 답하고, `finished` 면 같은 블록이 끝난
 * 카드로 내려가 "무엇을 보고 닫았는지"를 답한다. 모델이 읽어 낸 **끝나는 조건**은 사유보다 길어서
 * 툴팁에 둔다 — 좁은 카드(`w-52`)에서 두 줄을 다 펴면 정작 사유가 안 보인다.
 */
function ProbeVerdictBlock({ probe }: { probe: BackgroundTaskProbeResult }): React.JSX.Element {
  const { t } = useTranslation();
  const tone = PROBE_TONE[probe.verdict] ?? PROBE_TONE.unknown;
  const title = probe.exitCondition
    ? t('ide.runningSubagents.probeTip', { condition: probe.exitCondition, model: probe.model ?? '?' })
    : t('ide.runningSubagents.probeTipNoCondition', { model: probe.model ?? '?' });

  return (
    <div className="mt-1 border-t border-gray-700/60 pt-1" title={title}>
      <p className={`flex items-center gap-1 text-[12px] font-semibold ${tone.cls}`}>
        <ProbeGlyph />
        <span className="min-w-0 flex-1 truncate">{t(tone.key)}</span>
        <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600"
          title={t('ide.runningSubagents.probeAt', { time: formatClock(probe.at) })}>
          {formatClock(probe.at)}
        </span>
      </p>
      {probe.reason && (
        <p className="mt-0.5 line-clamp-2 break-words text-[12px] leading-snug text-gray-400">{probe.reason}</p>
      )}
    </div>
  );
}

/** 메타 칩 줄 — 종류·타입·소속 탭·시각. 두 카드가 같은 리듬을 갖게 한 곳에 둔다. */
function MetaRow({
  origin, type, sessionLabel, clock, clockTitle,
}: {
  origin: 'hook' | 'stream' | undefined;
  type: string | undefined; sessionLabel: string | null; clock: string; clockTitle: string;
}): React.JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <KindChip origin={origin} />
      {type && <span className={`${CHIP} bg-sky-500/15 text-sky-300`}>{type}</span>}
      {sessionLabel && <span className={`${CHIP} bg-gray-700/60 font-medium text-gray-300`}>{sessionLabel}</span>}
      <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600" title={clockTitle}>{clock}</span>
    </div>
  );
}

/**
 * 도는 카드 — 좁은 폭(`w-52`)에 담을 수 있는 정보를 최대로.
 * ⑦(a) 이전에는 [설명·타입·경과·소속 탭·시작 시각·프롬프트]가 **띄운 순간 그대로 멈춰** 있었고,
 * 이제 그 아래 한 줄이 자식의 현재 도구를 따라 계속 바뀐다.
 */
export const RunningTaskRow = memo(function RunningTaskRow({
  task, now, sessionLabel, onDismiss,
}: {
  task: RunningSubagentTask; now: number; sessionLabel: string | null;
  /** "더 안 기다림" — 장부에서만 내린다(프로세스를 끊지 않는다). */
  onDismiss?: (taskId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const title = task.description || task.subagentType || task.agentType || t('ide.runningSubagents.untitled');
  // 오래 도는 작업(폴링 등)과 **응답이 끊긴 작업**은 경과 시간만으로는 구별되지 않는다.
  //   자식이 마지막으로 도구를 쓴 시각이 있으면 그 이후 침묵한 시간을 따로 말해 준다.
  //
  // ⑭ — 조용함을 재는 시계는 둘이다. 훅이 본 **자식의 도구 사용**(`lastActivityAt`)은 셸에는 영영
  //   안 붙고, **출력 파일이 마지막으로 바뀐 시각**(`lastOutputAt`)은 셸에만 붙는다. 뒤의 것이
  //   있으면 그것을 먼저 쓴다 — 서버가 조사 착수를 판정할 때 보는 시계와 화면의 숫자가 어긋나면
  //   "왜 아직 안 물어보나"를 사용자에게 설명할 길이 없다. 말도 갈라 쓴다: 셸이 조용한 것은
  //   무응답이 아니라 정상적인 대기일 수 있다(⑩ — 시간만으로 죽었다고 단정하지 않는다).
  const quietSince = task.lastOutputAt ?? task.lastActivityAt ?? null;
  const quietFor = quietSince !== null && now - quietSince > NO_RESPONSE_HINT_MS
    ? formatElapsed(quietSince, now)
    : null;
  const quietIsOutput = task.lastOutputAt !== undefined;

  return (
    <li className="rounded border border-sky-500/30 bg-gray-800/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-sky-400" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-gray-100" title={title}>
          {title}
        </span>
        <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[12px] font-semibold tabular-nums text-sky-200">
          {formatElapsed(task.startedAt, now)}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(task.id)}
            title={t('ide.runningSubagents.dismissTip')}
            aria-label={t('ide.runningSubagents.dismiss')}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700/60 hover:text-gray-200"
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {quietFor && (
        <p
          className={`mt-0.5 text-[12px] font-semibold ${quietIsOutput ? 'text-gray-500' : 'text-amber-300/90'}`}
          {...(quietIsOutput ? { title: t('ide.runningSubagents.quietForTip') } : {})}
        >
          {quietIsOutput
            ? t('ide.runningSubagents.quietFor', { value: quietFor })
            : t('ide.runningSubagents.noResponse', { value: quietFor })}
        </p>
      )}

      {/* ⑭(d) — 판정 에이전트가 도는 동안 서는 줄. 몇십 초로 짧지만, 이 줄이 없으면 **자동으로
          무언가 하고 있다는 사실 자체**가 화면에 없다. 그러면 항목이 갑자기 아래칸으로 내려간 것이
          사용자에게는 원인 없는 사건이 된다. */}
      {task.probing && (
        <p className="mt-0.5 flex animate-pulse items-center gap-1 text-[12px] font-semibold text-sky-300/90"
          title={t('ide.runningSubagents.probingTip')}>
          <ProbeGlyph />
          <span className="min-w-0 truncate">{t('ide.runningSubagents.probing')}</span>
        </p>
      )}

      <MetaRow
        origin={task.origin}
        type={task.subagentType ?? task.agentType}
        sessionLabel={sessionLabel}
        clock={formatClock(task.startedAt)}
        clockTitle={t('ide.runningSubagents.startedAt', { time: formatClock(task.startedAt) })}
      />

      {task.prompt && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-400"
          title={task.prompt}>
          {task.prompt}
        </p>
      )}

      {/* ⑦(a) — 자식이 도구를 한 번이라도 쓴 뒤에만 나타난다. 도구 이름 + 대상 한 줄 + 누적 호출 수. */}
      {task.currentTool && (
        <div className="mt-1 flex items-center gap-1 border-t border-gray-700/60 pt-1 text-sky-300"
          title={t('ide.runningSubagents.nowUsing')}>
          <ToolGlyph />
          <span className="flex-shrink-0 text-[12px] font-semibold">{task.currentTool}</span>
          {task.currentToolDetail && (
            <span className="min-w-0 flex-1 truncate text-[12px] font-normal text-gray-400"
              title={task.currentToolDetail}>
              {task.currentToolDetail}
            </span>
          )}
          {task.toolCount !== undefined && task.toolCount > 0 && (
            <span className="ml-auto flex-shrink-0 text-[12px] tabular-nums text-gray-500"
              title={t('ide.runningSubagents.toolUses', { count: task.toolCount })}>
              ×{task.toolCount}
            </span>
          )}
        </div>
      )}

      {/* ⑭(f) — 물어본 결과가 "아직 산다"(`alive`)거나 "모르겠다"(`unknown`)였을 때. 항목은 그대로
          남고 이 블록만 붙는다. 지금 조사 중이면 위의 "확인 중" 줄이 이미 말하고 있으므로 겹치지
          않게 감춘다. `finished` 는 여기 남지 않는다 — 그 순간 끝난 카드로 내려간다. */}
      {!task.probing && task.probe && task.probe.verdict !== 'finished' && (
        <ProbeVerdictBlock probe={task.probe} />
      )}
    </li>
  );
});

/**
 * 끝난 카드 — ⑦(b). 결과는 접힌 채 4줄만 보이고, 누르면 전문(최대 1,200자)이 펼쳐진다.
 * 결과가 아직 안 붙었으면(= `PostToolUse(Task)` 미도달, 또는 사용자가 중지시킨 자식) 그 사실을 적는다.
 */
export const FinishedTaskRow = memo(function FinishedTaskRow({
  task, sessionLabel,
}: { task: FinishedSubagentTask; sessionLabel: string | null }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const title = task.description || task.subagentType || task.agentType || t('ide.runningSubagents.untitled');
  // ⑭ — 초록 체크는 "스스로 끝났다"는 뜻이다. **우리가 닫은 것**에까지 그 표를 달면 카드가 거짓말을
  //   한다. 아래 사유 줄이 이미 설명하지만, 사용자가 먼저 보는 것은 목록의 왼쪽 글리프 한 줄이다.
  const selfEnded = task.closedBy !== 'probe' && task.closedBy !== 'user';

  return (
    <li className="rounded border border-gray-700/70 bg-gray-800/30 px-2 py-1.5">
      <div className={`flex items-center gap-1.5 ${selfEnded ? 'text-emerald-400' : 'text-gray-500'}`}>
        {selfEnded ? <DoneGlyph /> : task.closedBy === 'probe' ? <ProbeGlyph /> : <DismissedGlyph />}
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-gray-300" title={title}>
          {title}
        </span>
        <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[12px] font-semibold tabular-nums text-gray-300"
          title={t('ide.runningSubagents.duration', { value: formatElapsed(task.startedAt, task.endedAt) })}>
          {formatElapsed(task.startedAt, task.endedAt)}
        </span>
      </div>

      <MetaRow
        origin={task.origin}
        type={task.subagentType ?? task.agentType}
        sessionLabel={sessionLabel}
        clock={formatClock(task.endedAt)}
        clockTitle={t('ide.runningSubagents.endedAt', { time: formatClock(task.endedAt) })}
      />

      {/* §5.5 #17-9 ⑬ — 끝 통지가 안 와서 **출력 파일의 종료 표식**으로 회수한 항목. 종전에는 결과
          칸이 "결과가 오지 않았습니다"로만 남아 성공인지 실패인지 알 길이 없었는데, 표식에는 그 답이
          들어 있다. 색으로 한 번 더 말한다 — 0 이면 emerald, 그 외·중지면 rose. */}
      {(task.exitCode !== undefined || task.killed) && (
        <p
          className={`mt-1 flex items-center gap-1 text-[12px] font-semibold ${
            task.exitCode === 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}`}
          title={t('ide.runningSubagents.exitFromFileTip')}
        >
          <FileEndGlyph />
          <span className="min-w-0 truncate">
            {task.killed
              ? t('ide.runningSubagents.exitKilled')
              : t('ide.runningSubagents.exitCode', { code: task.exitCode })}
          </span>
        </p>
      )}

      {/* §5.5 #17-9 ⑭ — **무엇 때문에 내려갔는가.** 내리는 길이 다섯으로 늘었는데 카드가 전부
          똑같이 "끝남"으로만 보이면, 사용자는 스스로 끝난 것과 우리가 닫은 것을 구별할 수 없다.
          그 구별이 없으면 자동 정리는 신뢰를 잃는다 — 그래서 **우리가 손을 댄 세 길만** 적는다.
          `notification`(정상 보고)과 `end-marker`(종료 표식)는 이미 위 줄들이 답을 했다. */}
      {task.closedBy === 'probe' && task.probe && <ProbeVerdictBlock probe={task.probe} />}

      {task.closedBy === 'process-gone' && (
        <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-gray-500"
          title={t('ide.runningSubagents.closedByProcessGoneTip')}>
          <PowerOffGlyph />
          <span className="min-w-0 truncate">{t('ide.runningSubagents.closedByProcessGone')}</span>
        </p>
      )}

      {task.closedBy === 'user' && (
        <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-gray-500"
          title={t('ide.runningSubagents.dismissTip')}>
          <DismissedGlyph />
          <span className="min-w-0 truncate">{t('ide.runningSubagents.closedByUser')}</span>
        </p>
      )}

      {/* ⑭(e) — 장부만 지우면 그 셸은 계속 산다(실측: 목적을 다한 `tail`·`grep` 6개가 그렇게 남아
          있었다). 함께 끊었으면 몇 개였는지 적는다. 0 이면 이미 없었다는 뜻이라 적지 않는다. */}
      {task.killedProcesses !== undefined && task.killedProcesses > 0 && (
        <p className="mt-1 text-[12px] tabular-nums text-gray-600"
          title={t('ide.runningSubagents.killedProcessesTip')}>
          {t('ide.runningSubagents.killedProcesses', { count: task.killedProcesses })}
        </p>
      )}

      {task.result ? (
        <>
          {/* ⑦(b) 확장 — 이 보고는 **부모 세션에 전달되지 않았다**. 우리가 기록에서 건진 것이라는
              사실을 적지 않으면, 사용자는 부모가 받아 든 결과로 읽고 "그럼 왜 이어서 일을 안 했나"를
              영영 이해할 수 없다. */}
          {task.resultRescued && (
            <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-amber-400/90"
              title={t('ide.runningSubagents.resultRescuedTitle')}>
              <RescueGlyph />
              <span className="min-w-0 truncate">{t('ide.runningSubagents.resultRescued')}</span>
            </p>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="mt-1 block w-full text-left" title={t('ide.runningSubagents.toggleResult')}>
            <p className={`whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-400 ${open ? '' : 'line-clamp-4'}`}>
              {task.result}
            </p>
          </button>
        </>
      ) : task.exitCode === undefined && !task.killed && task.closedBy !== 'probe' ? (
        // 종료 표식으로 회수한 항목은 위 줄이 이미 답을 했다 — 같은 자리에서 "결과가 오지 않았다"를
        //   또 말하면 서로 어긋나 보인다. ⑭ 로 닫힌 항목도 마찬가지다: 판정 블록이 이미 사유를
        //   적었는데 그 아래에 "결과가 오지 않았습니다"가 또 서면 둘 중 무엇을 믿을지 알 수 없다.
        <p className="mt-1 text-[12px] italic text-gray-600">{t('ide.runningSubagents.noResult')}</p>
      ) : null}

      {task.toolCount !== undefined && task.toolCount > 0 && (
        <p className="mt-1 text-[12px] tabular-nums text-gray-600">
          {t('ide.runningSubagents.toolUses', { count: task.toolCount })}
        </p>
      )}
    </li>
  );
});
