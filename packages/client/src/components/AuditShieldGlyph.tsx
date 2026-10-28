// §5.22 / §7.20 — 감사 방패 글리프. 헤더 필(AuditPill)과 타임라인 팝업이 같은 그림을 써야 꺼짐 사선이 화면마다 같은 신호다.

interface AuditShieldGlyphProps {
  /** 경계가 꺼져 있으면 방패에 사선을 하나 얹는다("지금은 안 묻는다"). */
  off: boolean;
  /** 크기·색은 부모가 정한다(색은 `currentColor` 로 따라간다). */
  className?: string;
}

export function AuditShieldGlyph({
  off,
  className = 'h-3.5 w-3.5',
}: AuditShieldGlyphProps): React.JSX.Element {
  return (
    <svg
      className={`flex-shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5 7.5-9.5V6Z" />
      {off && <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  );
}
