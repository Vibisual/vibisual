import { bindingParts } from './bindingLabel.js';

/** 단축키 칩(순수 표시) — 상시로 박지 않는다(툴팁·메뉴 우측·오버레이·설정 표에서만), 레이아웃을 밀지 않는다, 새 색 ❌. 글자 12px 하한(§9). */

interface KeyCapProps {
  /** 정규 바인딩 문자열(`Ctrl+Shift+Z`). 비어 있으면 아무것도 그리지 않는다. */
  binding: string | null | undefined;
  /** 어두운 배경 위(오버레이)인지 — 대비를 한 단계 올린다. */
  tone?: 'muted' | 'strong';
  /** `sm` 은 항목 한둘의 조밀한 메뉴용(§5.4 #34) — 기본 칩은 줄 높이를 20px 로 민다. 글자는 둘 다 12px(§9). */
  size?: 'sm' | 'md';
  className?: string;
}

export function KeyCap({ binding, tone = 'muted', size = 'md', className }: KeyCapProps): React.JSX.Element | null {
  const parts = bindingParts(binding);
  if (parts.length === 0) return null;

  const capTone = tone === 'strong'
    ? 'border-gray-500 bg-gray-800 text-gray-100'
    : 'border-gray-700 bg-gray-800/60 text-gray-400';

  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 ${className ?? ''}`}>
      {parts.map((part, i) => (
        <span
          key={`${part}-${i}`}
          className={`inline-flex items-center justify-center rounded border font-mono text-xs leading-none ${
            size === 'sm' ? 'h-[18px] min-w-[1.125rem] px-0.5' : 'h-5 min-w-[1.25rem] px-1'
          } ${capTone}`}
        >
          {part}
        </span>
      ))}
    </span>
  );
}
