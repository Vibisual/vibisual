import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * §5.13 (V) 37-1·37-17 — 앱 화면이 자기 창의 머리줄을 쓰는 통로(크롬이 두세 줄로 겹치지 않게). `setTitle` 은 머리줄·가상 창 띠·OS 창 제목,
 * `claim` 하면 빈 자리(`slot`)에 자기 내용을 그리고 틀은 제목을 그리지 않는다. 슬롯은 포털이라 끌기는 `useAppChromeSlotGestures` 가 받는다.
 * 문맥이 없으면(IDE 무대·시험) `useAppChrome()` 이 `null` — 앱이 자기 머리줄 한 줄로 그린다.
 */
export interface AppChrome {
  /** 창 제목. `null` 이면 창 틀의 기본(버블 이름 → 앱 이름). */
  readonly setTitle: (title: string | null) => void;
  /** 머리줄 안의 빈 자리 — 창 틀이 그려 준 요소. 아직 안 섰으면 `null`. */
  readonly slot: HTMLElement | null;
  /** 머리줄 자리를 쓴다고 알린다. 돌려준 함수로 놓는다(언마운트 때). */
  readonly claim: () => () => void;
}

export const AppChromeContext = createContext<AppChrome | null>(null);

/** 앱 화면 쪽 — 창 틀이 머리줄 자리를 주는가. */
export function useAppChrome(): AppChrome | null {
  return useContext(AppChromeContext);
}

export interface AppChromeHost {
  /** 앱 화면에 내려 줄 문맥 값. */
  readonly chrome: AppChrome;
  /** 앱이 정한 창 제목(없으면 `null`). */
  readonly title: string | null;
  /** 앱이 머리줄 자리를 쓰는 중인가 — 그러면 창 틀은 자기 제목 글자를 그리지 않는다. */
  readonly claimed: boolean;
  /** 머리줄 자리 요소를 받는 ref 콜백. */
  readonly slotRef: (el: HTMLElement | null) => void;
}

/** 창 틀 쪽 — 머리줄 자리 상태 한 벌. 창마다 하나(앱 안 창 여러 개가 서로의 제목을 덮지 않게). */
export function useAppChromeHost(): AppChromeHost {
  const [title, setTitleState] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const setTitle = useCallback((next: string | null): void => {
    const clean = next?.trim() ?? '';
    setTitleState(clean === '' ? null : clean);
  }, []);
  const claim = useCallback((): (() => void) => {
    setClaims((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setClaims((n) => Math.max(0, n - 1));
    };
  }, []);
  const chrome = useMemo<AppChrome>(() => ({ setTitle, slot, claim }), [setTitle, slot, claim]);
  return { chrome, title, claimed: claims > 0, slotRef: setSlot };
}

/** 창 틀이 머리줄 자리에서 받는 손짓 — 타이틀바의 손잡이와 같은 것을 넘긴다. */
export interface AppChromeSlotGestures {
  /** 누름 — 끌어 옮기기(와 밖으로 빼기)의 시작. */
  readonly onPress: (e: MouseEvent) => void;
  /** 두 번 누름 — 최대화/복원. */
  readonly onDoublePress: (e: MouseEvent) => void;
}

/**
 * §5.13 (S-11) — 포털 내용의 React 이벤트는 타이틀바 `onMouseDown` 에 닿지 않아, 슬롯 위 누름을 네이티브로 받아 같은 손잡이에 넘긴다(입력·단추는 비켜 준다).
 * 슬롯의 빈 칸 누름은 React 가 이미 보내므로 건너뛴다 — 받으면 끌기가 두 번 시작된다.
 */
export function useAppChromeSlotGestures(slot: HTMLElement | null, gestures: AppChromeSlotGestures): void {
  // 최신 손잡이를 ref 로 — 손잡이가 바뀔 때마다 리스너를 다시 달지 않는다.
  const gesturesRef = useRef(gestures);
  gesturesRef.current = gestures;
  useEffect(() => {
    if (!slot) return;
    const press = (e: MouseEvent): void => { if (e.target !== slot) gesturesRef.current.onPress(e); };
    const doublePress = (e: MouseEvent): void => { if (e.target !== slot) gesturesRef.current.onDoublePress(e); };
    slot.addEventListener('mousedown', press);
    slot.addEventListener('dblclick', doublePress);
    return () => {
      slot.removeEventListener('mousedown', press);
      slot.removeEventListener('dblclick', doublePress);
    };
  }, [slot]);
}
