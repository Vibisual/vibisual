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

/** 생각 중 라이브 1줄 — 왼쪽 정렬. 펄스 점 + "생각 중" + 말줄임 애니메이션. */
export function ThinkingLiveLine({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-violet-400/80" aria-hidden="true" />
      <span className="inline-flex items-baseline text-[12px] italic text-violet-300/85">
        {label}
        <ThinkingDots />
      </span>
    </div>
  );
}
