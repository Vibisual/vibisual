// §5.3 #12-3 — 자물쇠 글리프. 버블 표식·우클릭 메뉴·승인 카드가 같은 그림을 쓴다. lucide stroke, 색은 `currentColor`.

interface PathLockGlyphProps {
  /** 풀린 자물쇠(고리가 열린 모양) — [잠금 풀기]·풀린 상태를 말할 때. */
  open?: boolean;
  /** 크기는 부모가 정한다(기본은 라벨 옆 글리프 표준 `h-3.5 w-3.5`). */
  className?: string;
  /** 굵기 — 아주 작은 버블 위에서는 조금 굵게 그려야 읽힌다. */
  strokeWidth?: number;
}

export function PathLockGlyph({
  open = false,
  className = 'h-3.5 w-3.5',
  strokeWidth = 1.8,
}: PathLockGlyphProps): React.JSX.Element {
  return (
    <svg
      className={`flex-shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={open ? 'M8 11V7a4 4 0 0 1 7.75-1.4' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
    </svg>
  );
}
