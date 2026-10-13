import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * §5.13 (V) 37-1·37-17 — 앱 화면이 **자기 창의 머리줄**을 쓰는 일반 통로(앱 이름 없음).
 *
 * 종전에는 앱 창 머리줄(앱 이름)과 앱 화면 자신의 머리줄(또 앱 이름)이 위아래로 겹쳐 위쪽 크롬이 두세 줄이 됐다.
 * 이제 창 틀(앱 안 창·바깥 창)이 이 문맥을 앱 화면에 주고, 앱은 ① 창 제목을 정하고(`setTitle` — 머리줄 글자·끌어낼 때
 * 가상 창의 이름 띠·OS 창 제목) ② 머리줄 안의 빈 자리(`slot`)를 쓴다고 알리면(`claim`) 그 자리에 자기 머리줄 내용을
 * 그린다 — 그때 창 틀은 자기 제목 글자를 그리지 않는다. 창 이동은 그 자리의 빈 곳으로 그대로 되고(포털이라 창 틀이
 * 네이티브로 받는다 — `useAppChromeSlotGestures`), 입력·단추는 창 틀의 끌기 판정(`button, input, … [data-window-nodrag]`)이
 * 비켜 준다.
 *
 * 창 틀은 앱이 **무엇을** 그리는지 모른다(§5.13 (P-4)). 문맥이 없는 자리(IDE 무대·시험)에서는 `useAppChrome()` 이
 * `null` 이고, 앱은 같은 내용을 자기 머리줄 한 줄로 그린다.
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
 * §5.13 (S-11) — 앱이 쓰는 머리줄 자리에서도 **타이틀바와 같은 손짓**이 된다(빈 곳을 잡고 끌기·밖으로 빼기·두 번 눌러 최대화).
 *
 * 앱 화면은 머리줄 내용을 이 자리에 **포털**로 그린다. React 이벤트는 DOM 이 아니라 React 트리를 따라 오르므로, 그 내용
 * 위에서 누른 손은 창 틀 타이틀바의 `onMouseDown` 에 닿지 않고 앱 화면 쪽으로만 올라갔다 — 머리줄이 타이틀바 거의 전부를
 * 덮는 판(영상 스튜디오)에서는 창을 잡을 자리가 아이콘 하나뿐이라 "드래그해도 안 움직인다"가 됐다(사용자 보고). 그래서 창
 * 틀이 그 자리에서 **네이티브로** 받아 같은 손잡이에 넘긴다. 입력·단추는 손잡이의 끌기 판정이 그대로 비켜 준다.
 *
 * 자리 자체(앱이 덮지 않은 빈 칸)를 누른 것은 React 가 이미 타이틀바로 보낸다 — 여기서도 받으면 한 누름이 두 번 끌기를
 * 시작하므로 건너뛴다.
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
