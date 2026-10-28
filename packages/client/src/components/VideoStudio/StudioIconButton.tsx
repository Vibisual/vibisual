import { useRef } from 'react';
import { HoverTooltip } from '../Layout/HoverTooltip.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/** §5.13 (V) 37-1 — 스튜디오 아이콘 단추(툴팁에 이름 + `shortcutLabel()` 키). 켬은 앱 색 링(`--vs-accent`) — 앱 색은 선택·진행 표시에만. */
export interface StudioIconButtonProps {
  readonly icon: StudioIconName;
  readonly label: string;
  /** 툴팁 두 번째 줄(단축키 등). */
  readonly hint?: string | undefined;
  readonly onClick: () => void;
  /** §5.13 (Y) 40-10 ① — 주면 `pointerdown`(주 단추)에서 부르고 뒤따르는 클릭 하나를 삼킨다(0.1초 반응). 키보드는 `onClick` 한 번. */
  readonly onPress?: (() => void) | undefined;
  readonly active?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  /** 글자도 함께 보일 때(머리줄 단추 등). */
  readonly text?: string | undefined;
  readonly className?: string | undefined;
}

export function StudioIconButton(p: StudioIconButtonProps): React.JSX.Element {
  const pressed = useRef(false);
  // 터치에서는 손가락 표적으로 키운다(레일·조작 줄·정밀 편집이 전부 이 단추다). 레일 폭 48px 안에 40px 이 들어간다.
  const box = p.size === 'sm' ? 'h-7 min-w-7 pointer-coarse:h-9 pointer-coarse:min-w-9' : 'h-8 min-w-8 pointer-coarse:h-10 pointer-coarse:min-w-10';
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
        onPointerDown={p.onPress ? (e) => {
          // Ctrl 을 쥔 누름은 맡지 않는다 — mac 에서 Ctrl+클릭은 보조 클릭(오른쪽 클릭)이다. win/linux 는 뒤따르는 클릭이 종전대로 맡는다.
          if (e.button !== 0 || e.ctrlKey || p.disabled) return;
          pressed.current = true;
          p.onPress?.();
        } : undefined}
        onClick={(e) => {
          // 누른 순간 이미 불렀으면 그 클릭만 삼킨다. 키보드·보조 기술의 클릭(`detail === 0`)은 늘 부른다 — 단추를 누른 채 밖으로 끌어
          // 떼면 클릭이 오지 않아 표시가 남는데, 그때 다음 Space·Enter 가 삼켜지지 않게.
          const fromPress = pressed.current && e.detail > 0;
          pressed.current = false;
          if (fromPress) return;
          p.onClick();
        }}
        className={`flex ${box} shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 transition-colors duration-150 ease-out disabled:cursor-default disabled:opacity-35 ${tone} ${p.className ?? ''}`}
      >
        <StudioIcon name={p.icon} />
        {p.text ? <span className="text-[12px] font-medium">{p.text}</span> : null}
      </button>
    </HoverTooltip>
  );
}
