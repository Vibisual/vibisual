import type { AgentEngineKind } from '@vibisual/shared';
import { BRAND_ICON_PATHS } from '../BubbleMap/brandIconPaths.js';

/** §5.25 (C) — 세 엔진 글리프의 정본(관문·계정 칸·엔진 칸이 같이 쓴다 — 따로 그리면 같은 엔진이 자리마다 다른 얼굴, §5.25 (B)). 색은 `currentColor`. */
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
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor" fillRule="evenodd" stroke="none" aria-hidden="true">
        <path d={BRAND_ICON_PATHS.codex} />
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
