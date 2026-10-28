import { useEffect, useMemo, useState } from 'react';
import { useGraphStore, selectDockSignature, selectVisibleDockedPanes } from '../../stores/graphStore.js';
import { computeDockLayout, type DockLayout, type DockedPane, type Viewport } from './ideDockLayout.js';

// §5.5 #17-1 — 자리를 비우는 쪽과 그리는 쪽이 같은 산식(이 훅)을 읽는다(App 여백·DetailPanel 미러링·창들).
// 한쪽만 고치면 IDE 는 없는데 캔버스만 잘린 빈 도크가 생긴다.

/** 지금 뷰포트(px). 창 크기가 바뀌면 도크 자리도 함께 다시 잡힌다. */
export function useViewportSize(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = (): void => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

/** 지금 화면에 실제로 그려지는 도크들(에이전트가 스냅샷에 없는 창은 자리를 먹지 않는다). */
export function useVisibleDockedPanes(): DockedPane[] {
  // **지문(원시 문자열)만** 구독한다 — 선택자가 매번 새 배열을 만들면 zustand v5 가 "캐시되지 않은
  //   스냅샷"으로 보고, `nodeMap` 을 통째로 구독하면 App 전체가 스냅샷마다 다시 그려진다.
  //   목록 자체는 지문이 달라졌을 때만 그 자리에서 새로 만든다.
  const signature = useGraphStore(selectDockSignature);
  return useMemo(
    () => selectVisibleDockedPanes(useGraphStore.getState()),
    [signature],
  );
}

/** 도크들의 자리 + 캔버스가 비워 줄 네 변 두께. */
export function useIDEDockLayout(): DockLayout {
  const panes = useVisibleDockedPanes();
  const vp = useViewportSize();
  return useMemo(() => computeDockLayout(panes, vp), [panes, vp]);
}
