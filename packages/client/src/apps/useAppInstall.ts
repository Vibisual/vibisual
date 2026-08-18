import { useCallback, useMemo, useState } from 'react';

import { resolveInstalledApps } from './registry.js';
import { useGraphStore } from '../stores/graphStore.js';

/**
 * §5.13 (N) v4.47 — 내부 앱 설치/삭제.
 *
 * 설치를 부르는 자리가 둘(우클릭 메뉴 · 캔버스 버블)이라 **로직은 한 곳에** 둔다.
 * 각자 fetch 를 쓰면 낙관적 반영과 실패 복구 규칙이 갈라지고, 그러면 한쪽에서만
 * "켰는데 다음에 켜면 꺼져 있는" 사고가 난다.
 *
 * 실패하면 되돌린다 — 저장이 안 됐는데 화면만 설치된 것처럼 남으면, 다음 실행에서
 * 조용히 사라진다(플러그인 토글에서 실제로 났던 사고와 같은 종류).
 */
export function useAppInstall(): {
  installed: Set<string>;
  isInstalled: (appId: string) => boolean;
  setInstalled: (appId: string, next: boolean) => Promise<void>;
  busy: boolean;
  error: string;
} {
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const applyUserDefaults = useGraphStore((s) => s.applyUserDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const installed = useMemo(() => resolveInstalledApps(userDefaults), [userDefaults]);

  const setInstalled = useCallback(
    async (appId: string, next: boolean): Promise<void> => {
      const prev = useGraphStore.getState().userDefaults;
      const current = resolveInstalledApps(prev);
      if (next) current.add(appId);
      else current.delete(appId);
      const list = [...current];

      applyUserDefaults({ ...(prev ?? {}), installedApps: list, updatedAt: Date.now() });
      setBusy(true);
      setError('');
      try {
        const res = await fetch('/api/user-defaults', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ installedApps: list }),
        });
        if (!res.ok) throw new Error(`user-defaults PUT ${res.status}`);
      } catch (err) {
        if (prev) applyUserDefaults(prev);
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [applyUserDefaults],
  );

  return {
    installed,
    isInstalled: useCallback((appId: string) => installed.has(appId), [installed]),
    setInstalled,
    busy,
    error,
  };
}
