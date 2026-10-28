/**
 * 라이브 "작업 중" 1줄(ThinkingLiveLine — `thinking_tokens` 펄스도 쌓지 않고 대신한다)과 끝난 뒤 자국(StepTrace/WriteTrace/TurnSummary, 문구는 `stepTraceText.ts`).
 * 이름은 항목 id `thinking-live` 와 짝이라 둔다(라벨은 `생각 중`이 아니다). 둘은 같은 자리·점 모양, 색만 갈린다 — 작동 중은 파랑, 보라는 끝난 사고 자국에만.
 */

import { useTranslation } from 'react-i18next';
import { sessionSilenceMs } from '@vibisual/shared';
import { useNowTick } from '../../hooks/useNowTick.js';
import { liveLineClockFrom, liveLineStalled, type LiveLineMode } from '../../utils/sessionActivity.js';
import { formatElapsed } from './elapsed.js';

/** "." → ".." → "..." 반복. 폭 고정으로 라벨이 흔들리지 않는다. */
export function ThinkingDots(): React.JSX.Element {
  return <span className="thinking-ellipsis inline-block w-[1.1em] text-left" aria-hidden="true" />;
}

/**
 * 라이브 1줄 — 점 + 라벨 + 말줄임 + 경과. 작동하는 내내 떠 있다(§5.5 #17-24 ② ③). ⑦ 작동 중이면 무엇이든 `작업 중`(파랑) — 사고를 따로 적으면 큰 `Write` 입력 중에 멈춘 것으로 읽힌다.
 * §5.5 #17-18 ⑪ `waiting`: 점·말줄임·무응답 문구 없음("하는 중" 신호라 거짓이 된다). §2.4 — 문턱(`SESSION_NO_RESPONSE_MS`)을 넘으면 마지막 업데이트 이후 시간임을 밝힌다(고장색 ❌).
 * ⑥-6 평소 경과는 턴 시작부터(`liveLineClockFrom`). #17-24 ⑥ `compacting`: 턴 중 압축 2.4~6분은 줄이 없는 게 정상 — 무응답으로 안 뒤집고 압축 시작부터 잰다(청록).
 */
export function ThinkingLiveLine({
  label,
  mode = 'working',
  lastActivityAt = null,
  turnStartedAt = null,
  hiddenTurn = false,
  compactingSince = null,
}: {
  label: string;
  mode?: LiveLineMode;
  /** 마지막으로 움직인 시각(ms). 무응답 판정의 재료다. 모르면 `null` — 무응답으로 올리지 않는다. */
  lastActivityAt?: number | null;
  /** §5.5 #17-10 ⑥-6 — 지금 턴(대기면 줄 선) 시작 시각(ms). 모르면 `null` — 평소 시간을 적지 않는다(0 으로 적지 않는다). */
  turnStartedAt?: number | null;
  /** §5.3 #9-1 (P) — 감춘 턴(조용한 사전 압축)이 도는 중. 줄이 안 오므로 경과는 적되 무응답으로 뒤집지 않는다. */
  hiddenTurn?: boolean;
  /** §5.5 #17-24 ⑥ — `compacting` 모드일 때 CLI 가 접기 시작한 시각(ms). 그 모드의 경과는 여기서부터 잰다. */
  compactingSince?: number | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 근거가 있을 때만 시계를 돌린다 — 조용한 화면에서 초마다 리렌더하지 않기 위해.
  const compacting = mode === 'compacting';
  const now = useNowTick(lastActivityAt !== null || turnStartedAt !== null || (compacting && compactingSince !== null));
  const silence = sessionSilenceMs(lastActivityAt, now);
  /* §5.5 #17-18 ⑪ — 줄 서 있는 줄은 무응답이 아니다(턴이 시작되지 않았다). "마지막 업데이트 N 전"을 붙이지 않고 줄 선 지 얼마인가만 적는다. 판정은 `liveLineStalled` 한 곳. */
  const waiting = mode === 'waiting';
  const stalled = liveLineStalled(mode, silence, hiddenTurn);
  // 무응답이면 마지막 업데이트부터("마지막 업데이트 N 전"), 접는 중이면 압축 시작부터, 그 밖에는 턴 시작부터
  //   — 줄이 와도 되감기지 않는다.
  const clockFrom = liveLineClockFrom(stalled, turnStartedAt, lastActivityAt, now, compacting ? compactingSince : null);
  const elapsed = clockFrom !== null ? formatElapsed(clockFrom, now) : null;
  // 대기는 slate — 위의 [대기] 말풍선(#17-18 ⑤)과 한 덩어리로 보이게. 파랑이면 아무 일 없는 화면이 도는 것처럼 보인다.
  const dot = waiting ? 'bg-slate-400/70' : stalled ? 'bg-gray-500' : compacting ? 'bg-teal-400/80' : 'bg-blue-400/80';
  const text = waiting ? 'text-slate-300/85' : stalled ? 'text-gray-400' : compacting ? 'text-teal-300/85' : 'text-blue-300/85';
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      {/* No pulse during an output gap; neither progress nor failure is inferred. */}
      {/* 대기도 뛰지 않는다 — 뛰는 점은 "지금 무언가 일어나는 중"이라는 말이고, 대기는 그 반대다. */}
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${stalled || waiting ? '' : 'animate-pulse'} ${dot}`} aria-hidden="true" />
      <span
        className={`inline-flex items-baseline text-[12px] italic ${text}`}
        title={compacting ? t('ide.streamRenderer.compactingHint') : undefined}
      >
        {label}
        {!stalled && !waiting && <ThinkingDots />}
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

/** §5.5 #17-39 — 사고 자국(`1분 13초 동안 사고함 · 4,182자`). 끝난 일이라 점이 뛰지 않고, 사고 원문은 남기지 않아(#17-15) 펼침이 없다. */
export function StepTraceLine({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400/45" aria-hidden="true" />
      <span className="text-[12px] italic text-violet-300/55">{text}</span>
    </div>
  );
}

/** §5.5 #17-39 — 작성 자국(`1,904자 작성 · 21초`). 말풍선 부속이라 여백을 맞추고 색을 한 단계 더 죽인다(본문 읽는 눈을 뺏지 않게). */
export function WriteTraceLine({ text }: { text: string }): React.JSX.Element {
  return <div className="mt-0.5 text-[12px] text-slate-400/55">{text}</div>;
}
