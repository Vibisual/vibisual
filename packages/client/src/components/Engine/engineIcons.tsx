import type { AgentEngineKind } from '@vibisual/shared';

/**
 * §5.25 (C) — 세 엔진의 **글리프 정본**.
 *
 * 엔진 선택 관문(`EngineChooserGate`)·옵션창 계정 칸(`AccountTab`)·엔진 칸(`EnginesSection`)이
 * 같은 그림을 쓴다. 화면마다 따로 그리면 한쪽만 바뀌는 날이 오고, 그러면 같은 엔진이 자리마다
 * 다른 얼굴을 갖는다 — §5.25 (B) 가 "세 형제가 나란히 선다"고 말한 것이 그 순간 깨진다.
 *
 * 이모지가 아니라 lucide 톤의 stroke SVG 다(CLAUDE.md UI 규약). 색은 `currentColor` 로 받아
 * 부모의 `text-*` 가 결정한다 — 그래서 같은 글리프가 관문에서는 크게, 목록에서는 작게, 꺼진
 * 자리에서는 흐리게 나온다.
 */
export function EngineIcon({ kind, className }: {
  kind: AgentEngineKind;
  className?: string;
}): React.JSX.Element {
  const cls = className ?? 'h-6 w-6';
  const common = {
    viewBox: '0 0 24 24',
    className: cls,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'codex') {
    return (
      <svg {...common}>
        <path d="M16 18l6-6-6-6" />
        <path d="M8 6l-6 6 6 6" />
      </svg>
    );
  }
  if (kind === 'local') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );
}
