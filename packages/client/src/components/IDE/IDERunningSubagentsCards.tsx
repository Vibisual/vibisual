import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinishedSubagentTask, RunningSubagentTask } from '@vibisual/shared';

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

const CHIP = 'min-w-0 truncate rounded px-1 py-px text-[9px] font-semibold';

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

/** 메타 칩 줄 — 타입·소속 탭·시각. 두 카드가 같은 리듬을 갖게 한 곳에 둔다. */
function MetaRow({
  type, sessionLabel, clock, clockTitle,
}: {
  type: string | undefined; sessionLabel: string | null; clock: string; clockTitle: string;
}): React.JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {type && <span className={`${CHIP} bg-sky-500/15 text-sky-300`}>{type}</span>}
      {sessionLabel && <span className={`${CHIP} bg-gray-700/60 font-medium text-gray-300`}>{sessionLabel}</span>}
      <span className="flex-shrink-0 text-[9px] tabular-nums text-gray-600" title={clockTitle}>{clock}</span>
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
  const quietSince = task.lastActivityAt ?? null;
  const quietFor = quietSince !== null && now - quietSince > NO_RESPONSE_HINT_MS
    ? formatElapsed(quietSince, now)
    : null;

  return (
    <li className="rounded border border-sky-500/30 bg-gray-800/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-sky-400" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-gray-100" title={title}>
          {title}
        </span>
        <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[9px] font-semibold tabular-nums text-sky-200">
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
        <p className="mt-0.5 text-[9.5px] font-semibold text-amber-300/90">
          {t('ide.runningSubagents.noResponse', { value: quietFor })}
        </p>
      )}

      <MetaRow
        type={task.subagentType ?? task.agentType}
        sessionLabel={sessionLabel}
        clock={formatClock(task.startedAt)}
        clockTitle={t('ide.runningSubagents.startedAt', { time: formatClock(task.startedAt) })}
      />

      {task.prompt && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[10.5px] leading-snug text-gray-400"
          title={task.prompt}>
          {task.prompt}
        </p>
      )}

      {/* ⑦(a) — 자식이 도구를 한 번이라도 쓴 뒤에만 나타난다. 도구 이름 + 대상 한 줄 + 누적 호출 수. */}
      {task.currentTool && (
        <div className="mt-1 flex items-center gap-1 border-t border-gray-700/60 pt-1 text-sky-300"
          title={t('ide.runningSubagents.nowUsing')}>
          <ToolGlyph />
          <span className="flex-shrink-0 text-[10px] font-semibold">{task.currentTool}</span>
          {task.currentToolDetail && (
            <span className="min-w-0 flex-1 truncate text-[9.5px] font-normal text-gray-400"
              title={task.currentToolDetail}>
              {task.currentToolDetail}
            </span>
          )}
          {task.toolCount !== undefined && task.toolCount > 0 && (
            <span className="ml-auto flex-shrink-0 text-[9px] tabular-nums text-gray-500"
              title={t('ide.runningSubagents.toolUses', { count: task.toolCount })}>
              ×{task.toolCount}
            </span>
          )}
        </div>
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

  return (
    <li className="rounded border border-gray-700/70 bg-gray-800/30 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-emerald-400">
        <DoneGlyph />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-gray-300" title={title}>
          {title}
        </span>
        <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[9px] font-semibold tabular-nums text-gray-300"
          title={t('ide.runningSubagents.duration', { value: formatElapsed(task.startedAt, task.endedAt) })}>
          {formatElapsed(task.startedAt, task.endedAt)}
        </span>
      </div>

      <MetaRow
        type={task.subagentType ?? task.agentType}
        sessionLabel={sessionLabel}
        clock={formatClock(task.endedAt)}
        clockTitle={t('ide.runningSubagents.endedAt', { time: formatClock(task.endedAt) })}
      />

      {task.result ? (
        <>
          {/* ⑦(b) 확장 — 이 보고는 **부모 세션에 전달되지 않았다**. 우리가 기록에서 건진 것이라는
              사실을 적지 않으면, 사용자는 부모가 받아 든 결과로 읽고 "그럼 왜 이어서 일을 안 했나"를
              영영 이해할 수 없다. */}
          {task.resultRescued && (
            <p className="mt-1 flex items-center gap-1 text-[9.5px] font-semibold text-amber-400/90"
              title={t('ide.runningSubagents.resultRescuedTitle')}>
              <RescueGlyph />
              <span className="min-w-0 truncate">{t('ide.runningSubagents.resultRescued')}</span>
            </p>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="mt-1 block w-full text-left" title={t('ide.runningSubagents.toggleResult')}>
            <p className={`whitespace-pre-wrap break-words text-[10.5px] leading-snug text-gray-400 ${open ? '' : 'line-clamp-4'}`}>
              {task.result}
            </p>
          </button>
        </>
      ) : (
        <p className="mt-1 text-[10px] italic text-gray-600">{t('ide.runningSubagents.noResult')}</p>
      )}

      {task.toolCount !== undefined && task.toolCount > 0 && (
        <p className="mt-1 text-[9px] tabular-nums text-gray-600">
          {t('ide.runningSubagents.toolUses', { count: task.toolCount })}
        </p>
      )}
    </li>
  );
});
