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

/** "." → ".." → "..." 반복. 폭 고정으로 라벨이 흔들리지 않는다. */
export function ThinkingDots(): React.JSX.Element {
  return <span className="thinking-ellipsis inline-block w-[1.1em] text-left" aria-hidden="true" />;
}

/**
 * 라이브 1줄 — 왼쪽 정렬. 펄스 점 + 라벨 + 말줄임 애니메이션.
 *
 * §5.5 #17-24 ② ③ — 에이전트가 작동하는 **내내** 떠 있고, 사고 중이냐(`thinking`) 그 외 작업 중이냐
 * (`working`)에 따라 라벨과 색만 갈린다. "작업 중"은 이 항목의 생멸이 아니라 **줄 안의 움직임**이 알린다.
 */
export function ThinkingLiveLine({ label, mode = 'thinking' }: { label: string; mode?: 'thinking' | 'working' }): React.JSX.Element {
  const dot = mode === 'working' ? 'bg-blue-400/80' : 'bg-violet-400/80';
  const text = mode === 'working' ? 'text-blue-300/85' : 'text-violet-300/85';
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <span className={`h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full ${dot}`} aria-hidden="true" />
      <span className={`inline-flex items-baseline text-[12px] italic ${text}`}>
        {label}
        <ThinkingDots />
      </span>
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
