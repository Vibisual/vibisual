import { HoverTooltip } from '../Layout/HoverTooltip.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/**
 * §5.13 (V) 37-1 — 스튜디오의 아이콘 단추(글자 단추 ❌). 툴팁에 이름과 단축키(표시는 `shortcutLabel()` 로 만든 글자)를 적는다.
 * 켬 상태는 앱 색 링(`--vs-accent`) — 앱 색은 선택·진행 표시에만 쓴다.
 */
export interface StudioIconButtonProps {
  readonly icon: StudioIconName;
  readonly label: string;
  /** 툴팁 두 번째 줄(단축키 등). */
  readonly hint?: string | undefined;
  readonly onClick: () => void;
  readonly active?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  /** 글자도 함께 보일 때(머리줄 단추 등). */
  readonly text?: string | undefined;
  readonly className?: string | undefined;
}

export function StudioIconButton(p: StudioIconButtonProps): React.JSX.Element {
  const box = p.size === 'sm' ? 'h-7 min-w-7' : 'h-8 min-w-8';
  const tone = p.active
    ? 'bg-white/10 text-slate-100 ring-1 ring-[var(--vs-accent)]'
    : 'text-slate-300 hover:bg-white/10 hover:text-slate-100';
  return (
    <HoverTooltip label={p.label} detail={p.hint} always>
      <button
        type="button"
        aria-label={p.label}
        aria-pressed={p.active === undefined ? undefined : p.active}
        disabled={p.disabled}
        onClick={p.onClick}
        className={`flex ${box} shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 transition-colors duration-150 ease-out disabled:cursor-default disabled:opacity-35 ${tone} ${p.className ?? ''}`}
      >
        <StudioIcon name={p.icon} />
        {p.text ? <span className="text-[12px] font-medium">{p.text}</span> : null}
      </button>
    </HoverTooltip>
  );
}
