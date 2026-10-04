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
import { sessionSilenceMs } from '@vibisual/shared';
import { useNowTick } from '../../hooks/useNowTick.js';
import { liveLineClockFrom, liveLineStalled, type LiveLineMode } from '../../utils/sessionActivity.js';
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
 * §5.5 #17-18 ⑪ — 세 번째 모습이 `waiting`(대기 중)이다. 줄만 서 있고 도는 것이 없을 때의 이 줄은
 * **뛰지 않고, 말줄임도 돌지 않고, 무응답 문구도 붙지 않는다** — 셋 다 "지금 뭔가 하는 중"이라는
 * 신호인데 사실이 아니기 때문이다. 항목 자체는 그대로 떠 있다(#17-24 ② 상시 표시).
 *
 * §2.4 (무응답) — 여기에 **시간**이 없던 것이 이 버그의 핵심이었다. 말줄임만 돌아가는 줄은 3초가
 * 지났는지 30분이 지났는지 말해 주지 않아, 사용자가 "끝난 건지 끊긴 건지 이어서 하는 건지" 판단할
 * 근거가 화면 어디에도 없었다. 이제 그 자리에 경과를 적고, 문턱(`SESSION_NO_RESPONSE_MS`)을 넘으면
 * 마지막 업데이트 이후 시간임을 명시한다.
 * 조용한 추론/도구 호출을 고장으로 단정하거나 경고색으로 칠하지 않는다.
 *
 * §5.5 #17-10 ⑥-6 (턴 시계) — 평소 적는 경과는 **턴 시작**(`turnStartedAt`)부터다. 마지막 움직임부터
 * 재면 줄이 올 때마다 0 으로 되감겨 `0s`·`1s` 만 번갈아 떴다(사용자 보고 "같은 시간이 반복되거나
 * 사라지거나 0만"). 마지막 움직임은 무응답 판정과 그 문구에만 쓴다. 어느 쪽을 잴지는 `liveLineClockFrom`.
 *
 * §5.5 #17-24 ⑥ — 넷째 모습이 `compacting`(압축 중)이다. CLI 가 턴 도중에 대화를 접는 2.4~6분은 줄이
 * 오지 않는 것이 정상이라 **무응답으로 뒤집지 않고**, 경과는 **압축이 시작된 시각부터** 잰다. 일하는 중이
 * 맞으므로 점이 뛰고 말줄임이 돈다. 색은 청록 — 사고(보라)·작업(파랑)·대기(slate)와 갈린다.
 */
export function ThinkingLiveLine({
  label,
  mode = 'thinking',
  lastActivityAt = null,
  turnStartedAt = null,
  hiddenTurn = false,
  compactingSince = null,
}: {
  label: string;
  mode?: LiveLineMode;
  /** 마지막으로 움직인 시각(ms). 무응답 판정의 재료다. 모르면 `null` — 무응답으로 올리지 않는다. */
  lastActivityAt?: number | null;
  /**
   * §5.5 #17-10 ⑥-6 — 지금 턴(대기면 줄 선) 시작 시각(ms). 평소 적는 경과의 시작점이다.
   * 모르면 `null` — 그때는 평소 시간을 적지 않는다(0 으로 적지 않는다).
   */
  turnStartedAt?: number | null;
  /**
   * §5.3 #9-1 (P) — 감춘 턴(조용한 사전 압축)이 도는 중. 그 턴의 줄은 오지 않으므로 경과는 적되
   * 무응답으로 뒤집지 않는다(§5.5 #17-10 ⑥-6 — 물려받은 명령은 평소처럼 "작업 중"이다).
   */
  hiddenTurn?: boolean;
  /** §5.5 #17-24 ⑥ — `compacting` 모드일 때 CLI 가 접기 시작한 시각(ms). 그 모드의 경과는 여기서부터 잰다. */
  compactingSince?: number | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 근거가 있을 때만 시계를 돌린다 — 조용한 화면에서 초마다 리렌더하지 않기 위해.
  const compacting = mode === 'compacting';
  const now = useNowTick(lastActivityAt !== null || turnStartedAt !== null || (compacting && compactingSince !== null));
  const silence = sessionSilenceMs(lastActivityAt, now);
  /*
   * §5.5 #17-18 ⑪ — **줄 서 있는 줄은 무응답이 아니다.** 무응답 축(§2.4)은 "도는 턴이 말이
   * 없다"를 재는 것인데, 대기는 애초에 말할 턴이 시작되지 않은 상태다. 여기에 "마지막 업데이트
   * N 전"을 붙이면 오지도 않을 응답을 기다리는 것처럼 읽힌다 — 사용자가 본 그 문구다.
   * 대기 줄이 적어야 할 시간은 **줄 선 지 얼마나 됐는가** 하나뿐이다. 판정은 `liveLineStalled` 한 곳.
   */
  const waiting = mode === 'waiting';
  const stalled = liveLineStalled(mode, silence, hiddenTurn);
  // 무응답이면 마지막 업데이트부터("마지막 업데이트 N 전"), 접는 중이면 압축 시작부터, 그 밖에는 턴 시작부터
  //   — 줄이 와도 되감기지 않는다.
  const clockFrom = liveLineClockFrom(stalled, turnStartedAt, lastActivityAt, now, compacting ? compactingSince : null);
  const elapsed = clockFrom !== null ? formatElapsed(clockFrom, now) : null;
  // 대기는 **slate** — 바로 위에 쌓인 [대기] 말풍선(#17-18 ⑤)과 같은 색이라, 줄을 따로 읽지 않아도
  //   "이 줄은 저 말풍선들과 한 덩어리로 기다리는 중"이 보인다. 파랑(작업)·보라(사고)를 쓰면
  //   아무 일도 안 일어나는 화면이 도는 것처럼 보인다(그 오해가 이 색이 생긴 사고다).
  const dot = waiting ? 'bg-slate-400/70' : stalled ? 'bg-gray-500' : compacting ? 'bg-teal-400/80' : mode === 'working' ? 'bg-blue-400/80' : 'bg-violet-400/80';
  const text = waiting ? 'text-slate-300/85' : stalled ? 'text-gray-400' : compacting ? 'text-teal-300/85' : mode === 'working' ? 'text-blue-300/85' : 'text-violet-300/85';
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
