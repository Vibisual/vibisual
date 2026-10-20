import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * §5.13 (X) 39-8 — 앱 화면이 **지금 보이는가**(앱 이름 없음 — 코어 통로).
 *
 * 앱 안 창은 다른 프로젝트 탭으로 가면 `display:none` 으로 숨되 마운트된 채로 남는다(편집 중인 장면·선택·자리를 잃지 않으려고 —
 * `AppWindowHost`). 그래서 숨은 동안에도 앱의 폴링·무대·미리 굽기가 그대로 돌았다. 창 틀이 이 문맥으로 "창 안에서 보이는가"를
 * 내려 주고, 앱은 숨은 동안 쉰다. 문맥이 없는 자리(바깥 창·시험)는 늘 보이는 것으로 친다.
 *
 * 바깥 창의 최소화·가려짐은 창 틀이 아니라 문서가 말한다(`document.visibilityState`) — `useAppVisible` 이 둘을 함께 본다.
 * 재생처럼 **사람이 일부러 켠 것**은 창 안에서 숨을 때만 멈추는 편이 맞다(다른 창에 가렸다고 소리가 끊기면 안 된다) — 그래서
 * 둘을 따로도 준다.
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
