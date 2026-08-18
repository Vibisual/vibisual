import { Suspense, lazy, useMemo } from 'react';

import { getInternalApp, type AppHash } from './index.js';

/**
 * §5.13 (O) v4.48 — 앱 창 호스트.
 *
 * `#app=<id>&mode=<mode>` 를 받아 **레지스트리에서 로더를 꺼내** 그 화면을 늦게 부른다.
 * 코어의 `main.tsx` 가 앱 이름도 화면 이름도 모르게 하는 자리다 — 앱이 늘어도 부팅
 * 분기는 이것 하나 그대로다.
 *
 * 못 찾는 앱·화면이면 조용히 빈 창을 내지 않고 무엇이 없는지 적는다(설치 전 열림,
 * 오래된 창 복원, 오타 전부 여기서 드러난다).
 */
export function AppShellHost({ hash }: { hash: AppHash }): React.JSX.Element {
  const app = getInternalApp(hash.appId);
  const loader = app?.shells[hash.mode];

  const Shell = useMemo(
    () => (loader ? lazy(async () => ({ default: await loader() })) : null),
    [loader],
  );

  if (!Shell) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 p-8 text-center text-sm text-gray-400">
        <div>
          <p className="font-semibold text-gray-200">
            {app ? `알 수 없는 화면: ${hash.mode}` : `알 수 없는 앱: ${hash.appId}`}
          </p>
          <p className="mt-1 text-xs text-gray-500">{`#app=${hash.appId}&mode=${hash.mode}`}</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950" />}>
      <Shell appId={hash.appId} params={hash.params} />
    </Suspense>
  );
}
