/**
 * ThinkingIndicator — "생각 중" 인디케이터 공용 조각.
 *
 * - ThinkingDots: "." → ".." → "..." 반복 말줄임 (CSS `.thinking-ellipsis::after`, index.css).
 * - ThinkingLiveLine: 에이전트가 실제로 생각 중일 때 본문 하단에 딱 1줄 떠 있는 라이브 인디케이터.
 *   SDK 가 생각 동안 반복해서 보내는 `system`/`thinking_tokens` 펄스를 이 1줄로 합쳐 대체한다.
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
