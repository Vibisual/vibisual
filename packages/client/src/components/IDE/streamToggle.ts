/**
 * §5.5 #17-16 ③④ 접이식 블록의 펼침 상태 + 펼침 클릭 표식. 컴포넌트 밖 모듈 Map 이다 — 가상 리스트가 화면 밖 항목을 언마운트해 `useState` 면 다시 접힌다.
 * id 는 이벤트 id 기반이라 세션끼리 안 겹친다. 표시 전용(영속 ❌).
 */
import { useCallback, useState } from 'react';

/** id → 펼침 여부. 접힘(기본값)은 저장하지 않고 지운다(오래 산 세션에서 무한히 자라지 않게). */
const openState = new Map<string, boolean>();

/**
 * 스크롤러가 "펼치는 클릭"을 알아보는 표식.
 * 헤더 버튼에 `{...streamToggleProps(open)}` 를 펴 넣으면 `data-stream-toggle` + `aria-expanded` 가 붙고,
 * IDEMainArea 의 스크롤러 클릭 리스너가 `closest('[data-stream-toggle]')` 로 잡아 바닥 추종을 선해제한다.
 */
export const STREAM_TOGGLE_ATTR = 'data-stream-toggle';

/** 접이식 헤더 버튼에 펴 넣을 속성 묶음(표식 + 접근성 상태). */
export function streamToggleProps(open: boolean): { [STREAM_TOGGLE_ATTR]: string; 'aria-expanded': boolean } {
  return { [STREAM_TOGGLE_ATTR]: '', 'aria-expanded': open };
}

/**
 * 언마운트를 견디는 펼침 상태. 첫 마운트 때만 `defaultOpen` 을 쓰고, 그 뒤로는 저장된 값이 이긴다.
 * 반환값은 `useState` 와 같은 모양이라 기존 `open`/`setOpen` 호출부를 그대로 쓸 수 있다.
 */
export function useStreamToggle(id: string, defaultOpen = false): [boolean, () => void] {
  const [open, setOpen] = useState(() => openState.get(id) ?? defaultOpen);
  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next === defaultOpen) openState.delete(id); else openState.set(id, next);
      return next;
    });
  }, [id, defaultOpen]);
  return [open, toggle];
}

/** 테스트용 — 모듈 저장소 비우기. */
export function resetStreamToggles(): void {
  openState.clear();
}
