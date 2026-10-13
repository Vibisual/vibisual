import { useCallback, type KeyboardEvent } from 'react';

/**
 * §5.13 (V) 37-1 — 스튜디오 단축키(판정은 `ctrlKey || metaKey`, 표시는 툴팁의 `shortcutLabel()`).
 *
 * 재생 `Space` · 프레임 `←`/`→`(Shift 10프레임) · 반복 `L` · 안전 영역 `G` · 맞춤/100% `F` · 가리키기 `P` · 메모 `N` · 나가기 `Esc`
 * + 정밀 편집의 되돌리기 `Ctrl/Cmd+Z`·다시 `Ctrl/Cmd+Shift+Z`·`Ctrl/Cmd+Y` · 복제 `Ctrl/Cmd+D` · 지우기 `Delete`/`Backspace` ·
 * 분할 `S`. 맨 숫자 키는 쓰지 않는다(캔버스 북마크가 먼저 가져간다). 입력칸·한글 조합 중에는 비켜 선다.
 */
export interface StudioKeyActions {
  readonly disabled: boolean;
  readonly hasMedia: boolean;
  readonly canSplit: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly duplicate: () => void;
  readonly remove: () => void;
  readonly split: () => void;
  readonly togglePlay: () => void;
  readonly step: (frames: number) => void;
  readonly toggleLoop: () => void;
  readonly toggleSafe: () => void;
  readonly toggleZoom: () => void;
  readonly setInteraction: (mode: 'point' | 'note') => void;
  /** Esc — 모드·열린 판을 닫는다. 닫은 것이 있으면 true. */
  readonly escape: () => boolean;
}

export function useStudioKeys(a: StudioKeyActions): (event: KeyboardEvent<HTMLDivElement>) => void {
  return useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const take = (fn: () => void): void => { event.preventDefault(); fn(); };
    if (key === 'escape') { if (a.escape()) event.preventDefault(); return; }
    if (mod && key === 'z' && !a.disabled) return take(event.shiftKey ? a.redo : a.undo);
    if (mod && key === 'y' && !a.disabled) return take(a.redo);
    if (mod && key === 'd' && !a.disabled) return take(a.duplicate);
    if (mod || event.altKey) return;
    if ((key === 'delete' || key === 'backspace') && !a.disabled) return take(a.remove);
    if (key === 's' && !a.disabled && a.canSplit) return take(a.split);
    if (key === ' ' && a.hasMedia) return take(a.togglePlay);
    if (key === 'arrowleft' || key === 'arrowright') return take(() => a.step((key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 10 : 1)));
    if (key === 'l') return take(a.toggleLoop);
    if (key === 'g') return take(a.toggleSafe);
    if (key === 'f') return take(a.toggleZoom);
    if (key === 'p') return take(() => a.setInteraction('point'));
    if (key === 'n') return take(() => a.setInteraction('note'));
  }, [a]);
}
