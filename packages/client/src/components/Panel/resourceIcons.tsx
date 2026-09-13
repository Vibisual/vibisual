/**
 * 사용량 팝업 올모델 탭의 자원 글리프 (§5.19 (F)) — CPU · 시스템 메모리 · 가속 장치.
 *
 * lucide 톤의 인라인 stroke SVG 다(이모지 금지 규약). 색은 `currentColor` 로 받아 부모의
 * `text-*` 가 정하게 둔다 — 다크/라이트와 활성/비활성을 따로 그리지 않기 위해서다.
 */

const ICON = 'h-3.5 w-3.5 flex-shrink-0';

const COMMON = {
  className: ICON,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function CpuIcon(): React.JSX.Element {
  return (
    <svg {...COMMON}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  );
}

export function RamIcon(): React.JSX.Element {
  return (
    <svg {...COMMON}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M2 14h20M7 18v2M12 18v2M17 18v2" />
    </svg>
  );
}

export function DeviceIcon(): React.JSX.Element {
  return (
    <svg {...COMMON}>
      <path d="m12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z" />
      <path d="m22 12.7-9.2 4.1a2 2 0 0 1-1.6 0L2 12.7" />
      <path d="m22 17.7-9.2 4.1a2 2 0 0 1-1.6 0L2 17.7" />
    </svg>
  );
}
