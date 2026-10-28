import { create } from 'zustand';
import { WEB_OPEN_TARGET_DEFAULT, normalizeWebOpenTarget, type WebOpenTarget } from '@vibisual/shared';

/**
 * §5.23 「더블클릭」 — 도메인 버블 더블클릭 때 마지막 주소를 **어디서** 여는가(바깥 브라우저 · 앱 안 iframe 탭). `graphStore` 밖(기계의 값).
 * 영속은 서버(`/api/web-fold`), 다른 창은 WS `web_open_target_updated`. 더블클릭은 **동기로** 읽는다(읽기 전이면 기본값).
 */

interface WebOpenTargetState {
  target: WebOpenTarget;
  /** 서버에서 한 번이라도 받아 왔는가. */
  loaded: boolean;
  /** 서버·WS·옵션창 저장 응답에서 온 값을 반영(정규화는 shared 한 곳). */
  apply: (raw: unknown) => void;
  /** 서버에서 읽어 온다 — 캔버스가 처음 설 때 한 번. 못 읽으면 기본값 그대로. */
  fetchTarget: () => Promise<void>;
}

export const useWebOpenTargetStore = create<WebOpenTargetState>((set, get) => ({
  target: WEB_OPEN_TARGET_DEFAULT,
  loaded: false,

  apply: (raw) => {
    const target = normalizeWebOpenTarget(raw);
    if (get().loaded && get().target === target) return;
    set({ target, loaded: true });
  },

  fetchTarget: async () => {
    try {
      const res = await fetch('/api/web-fold');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { openTarget?: unknown };
      get().apply(data?.openTarget);
    } catch {
      // 못 읽으면 기본값(바깥 브라우저) 그대로 — 더블클릭이 통째로 죽는 것보다 낫다.
      set({ loaded: true });
    }
  },
}));
