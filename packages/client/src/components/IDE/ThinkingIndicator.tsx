/**
 * ThinkingIndicator — "생각 중" 인디케이터 + 그 뒤에 남는 **단계 자국** 공용 조각.
 *
 * - ThinkingDots: "." → ".." → "..." 반복 말줄임 (CSS `.thinking-ellipsis::after`, index.css).
 * - ThinkingLiveLine: 에이전트가 실제로 생각 중일 때 본문 하단에 딱 1줄 떠 있는 라이브 인디케이터.
 *   SDK 가 생각 동안 반복해서 보내는 `system`/`thinking_tokens` 펄스를 이 1줄로 합쳐 대체한다.
 * - StepTraceLine / WriteTraceLine / TurnSummaryLine (§5.5 #17-39): 끝난 뒤 남는 자국.
 *   문구는 전부 `stepTraceText.ts` 가 만들고 여기서는 **모양만** 정한다.
 *
 * 라이브 줄과 사고 자국이 **같은 자리·같은 색·같은 점**인 것은 의도다 — 도는 동안의 `생각 중 …` 이
 * 끝나면 그 자리에서 `1분 13초 동안 사고함` 으로 가라앉는다(새 모양을 발명하지 않는다).
 */

import { useTranslation } from 'react-i18next';
import { SESSION_NO_RESPONSE_MS, sessionSilenceMs } from '@vibisual/shared';
import { useNowTick } from '../../hooks/useNowTick.js';
import { formatElapsed } from './elapsed.js';

/** "." → ".." → "..." 반복. 폭 고정으로 라벨이 흔들리지 않는다. */
export function ThinkingDots(): React.JSX.Element {
  return <span className="thinking-ellipsis inline-block w-[1.1em] text-left" aria-hidden="true" />;
}

/**
 * 라이브 1줄 — 왼쪽 정렬. 펄스 점 + 라벨 + 말줄임 애니메이션 + **얼마나 됐는지**.
 *
 * §5.5 #17-24 ② ③ — 에이전트가 작동하는 **내내** 떠 있고, 사고 중이냐(`thinking`) 그 외 작업 중이냐
 * (`working`)에 따라 라벨과 색만 갈린다. "작업 중"은 이 항목의 생멸이 아니라 **줄 안의 움직임**이 알린다.
 *
 * §2.4 (무응답) — 여기에 **시간**이 없던 것이 이 버그의 핵심이었다. 말줄임만 돌아가는 줄은 3초가
 * 지났는지 30분이 지났는지 말해 주지 않아, 사용자가 "끝난 건지 끊긴 건지 이어서 하는 건지" 판단할
 * 근거가 화면 어디에도 없었다. 이제 마지막 움직임 이후 흐른 시간을 그 자리에 적고, 문턱
 * (`SESSION_NO_RESPONSE_MS`)을 넘으면 마지막 업데이트 이후 시간임을 명시한다.
 * 조용한 추론/도구 호출을 고장으로 단정하거나 경고색으로 칠하지 않는다.
 */
export function ThinkingLiveLine({
  label,
  mode = 'thinking',
  lastActivityAt = null,
}: {
  label: string;
  mode?: 'thinking' | 'working';
  /** 마지막으로 움직인 시각(ms). 모르면 `null` — 그때는 시간을 적지 않는다(0 으로 적지 않는다). */
  lastActivityAt?: number | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 근거가 있을 때만 시계를 돌린다 — 조용한 화면에서 초마다 리렌더하지 않기 위해.
  const now = useNowTick(lastActivityAt !== null);
  const silence = sessionSilenceMs(lastActivityAt, now);
  const stalled = silence !== null && silence >= SESSION_NO_RESPONSE_MS;
  const elapsed = silence !== null && lastActivityAt !== null ? formatElapsed(lastActivityAt, now) : null;
  const dot = stalled ? 'bg-gray-500' : mode === 'working' ? 'bg-blue-400/80' : 'bg-violet-400/80';
  const text = stalled ? 'text-gray-400' : mode === 'working' ? 'text-blue-300/85' : 'text-violet-300/85';
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      {/* No pulse during an output gap; neither progress nor failure is inferred. */}
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${stalled ? '' : 'animate-pulse'} ${dot}`} aria-hidden="true" />
      <span className={`inline-flex items-baseline text-[12px] italic ${text}`}>
        {label}
        {!stalled && <ThinkingDots />}
      </span>
      {elapsed !== null && (
        <span
          className="flex-shrink-0 text-[12px] tabular-nums text-gray-500"
          title={stalled ? t('ide.mainArea.stallHint') : undefined}
        >
          {stalled ? t('ide.runningSubagents.noResponse', { value: elapsed }) : elapsed}
        </span>
      )}
    </div>
  );
}

/**
 * §5.5 #17-39 — **사고 자국**. 끝난 사고 런이 그 자리에 남기는 한 줄(`1분 13초 동안 사고함 · 4,182자`).
 *
 * 라이브 1줄과 같은 자리·같은 색이되 **점이 뛰지 않는다**(끝난 일이라 움직일 이유가 없다).
 * 펼침 화살표를 달지 않는 이유는 펼칠 것이 없어서다 — 사고 원문은 #17-15 대로 어디에도 남기지 않는다.
 */
export function StepTraceLine({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400/45" aria-hidden="true" />
      <span className="text-[12px] italic text-violet-300/55">{text}</span>
    </div>
  );
}

/**
 * §5.5 #17-39 — **작성 자국**. 본문 말풍선 바로 아래 붙는 회색 한 줄(`1,904자 작성 · 21초`).
 * 말풍선의 부속이라 왼쪽 여백을 말풍선에 맞추고 색을 한 단계 더 죽인다(본문을 읽는 눈을 뺏지 않는다).
 */
export function WriteTraceLine({ text }: { text: string }): React.JSX.Element {
  return <div className="mt-0.5 text-[12px] text-slate-400/55">{text}</div>;
}
