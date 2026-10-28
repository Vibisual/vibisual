import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * §5.13 (X) 39-8 — 앱 화면이 보이는가. 다른 탭의 앱 안 창은 `display:none` 으로 마운트된 채 숨으므로(편집 자리 보존) 이 문맥으로 폴링·무대·굽기를 쉰다.
 * 문맥이 없으면(바깥 창·시험) 보인다고 친다. 바깥 창의 가려짐은 `document.visibilityState` — `useAppVisible` 이 둘을 본다.
 * 재생처럼 사람이 켠 것은 창 안에서 숨을 때만 멈춘다(다른 창에 가렸다고 소리가 끊기면 안 된다) — 그래서 둘을 따로도 준다.
 */
export const AppWindowShownContext = createContext<boolean>(true);

/** 창 안에서 보이는가(다른 탭으로 숨은 앱 안 창이면 false). */
export function useAppWindowShown(): boolean {
  return useContext(AppWindowShownContext);
}

function subscribeDocumentVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** 사람이 지금 이 화면을 볼 수 있는가(창 안에서 보이고, 창 자체도 최소화·가려짐이 아니다). */
export function useAppVisible(): boolean {
  const shown = useAppWindowShown();
  const visible = useSyncExternalStore(subscribeDocumentVisibility, documentVisible, () => true);
  return shown && visible;
}
