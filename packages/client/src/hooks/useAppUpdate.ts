import { useEffect, useState, useCallback } from 'react';
import type { UpdateState } from '@vibisual/shared';

// SCENARIO.md §4 v2.44 — 자동 업데이트(electron-updater) renderer 측 구독 훅.
//
// desktop main 의 updaterManager 가 SSOT — checking/available/downloading/downloaded/error
// 상태를 'vibisual:update:status' 로 모든 윈도우에 push 한다. 이 훅은 그 push 를 구독하고
// 마운트 시 현재 상태를 1회 fetch 한다(리스너 부착 전에 온 push 누락 보강 — useDetachedSync 선례).
//
// web/dev 모드(window.api 없음)에선 항상 null 을 반환 — 자동 업데이트는 패키지 Electron 한정.

export interface UseAppUpdate {
  /** main 이 들고 있는 현재 업데이트 상태. window.api 없으면 null. */
  state: UpdateState | null;
  /** 수동 체크 트리거. */
  check: () => void;
  /** 다운로드 완료 시 재시작+설치. */
  install: () => void;
}

export function useAppUpdate(): UseAppUpdate {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.update) return;
    // 초기 1회 fetch — onStatus 리스너 부착 전에 push 가 왔으면 놓칠 수 있어 보강.
    void api.update.getState().then(setState);
    const off = api.update.onStatus(setState);
    return () => { off(); };
  }, []);

  const check = useCallback(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (api?.update) void api.update.check().then(setState);
  }, []);

  const install = useCallback(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (api?.update) void api.update.install();
  }, []);

  return { state, check, install };
}
