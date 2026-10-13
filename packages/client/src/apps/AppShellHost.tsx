import { Suspense, lazy, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getInternalApp, type AppHash } from './index.js';
import { DARK_THEME_LOCK } from '../theme/themeLock.js';

/**
 * §5.13 (O) v4.48 — 앱 창 호스트.
 *
 * `#app=<id>&mode=<mode>` 를 받아 **레지스트리에서 로더를 꺼내** 그 화면을 늦게 부른다.
 * 코어의 `main.tsx` 가 앱 이름도 화면 이름도 모르게 하는 자리다 — 앱이 늘어도 부팅
 * 분기는 이것 하나 그대로다.
 *
 * 못 찾는 앱·화면이면 조용히 빈 창을 내지 않고 무엇이 없는지 적는다(설치 전 열림,
 * 오래된 창 복원, 오타 전부 여기서 드러난다).
 *
 * §5.13 (S-7) — **높이를 주는 것은 호스트다.** 앱 셸이 스스로 `h-screen` 을 주장하면 앱 안 창
 * (`AppWindow`) 안에서 화면 높이만큼 자라 창을 뚫는다. OS 창이면 여기서 화면 한 벌(`h-screen`),
 * 앱 안 창이면 `fill` 로 부모가 준 자리를 채운다.
 */
export function AppShellHost({ hash, fill = false }: { hash: AppHash; fill?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(hash.appId);
  const loader = app?.shells[hash.mode];

  const Shell = useMemo(
    () => (loader ? lazy(async () => ({ default: await loader() })) : null),
    [loader],
  );

  // ⚠ OS 창 쪽에 `overflow-hidden` 을 걸지 않는다 — 보이지 않는 렌더 무대(§5.13 (F)
  //   `offscreen-capture`)는 영상 치수만큼 고정 크기라, 창보다 큰 무대를 잘라 내면 그 잘린 화면이
  //   그대로 프레임이 된다. 앱 안 창은 반대로 반드시 잘라야 창 밖으로 새지 않는다.
  const box = fill ? 'h-full w-full overflow-hidden' : 'h-screen w-screen';

  // §4 앱 테마 — 앱 화면은 고정 어두운 바탕을 전제로 칠해져 있어 **어두운 판을 고정**한다(`DARK_THEME_LOCK`).
  //   라이트 테마에서도 앱 화면 안은 종전 그대로이고, 그 바깥(창 머리줄·앱 안 창 테두리)만 테마를 따른다.
  //   §5.13 (V) 37-17 — 편집 화면이 테마를 따른다고 **선언한 앱**(`followsTheme`)의 `main` 화면만 묶지 않는다.
  const themeLock = app?.followsTheme === true && hash.mode === 'main' ? {} : DARK_THEME_LOCK;
  if (!Shell) {
    return (
      <div {...DARK_THEME_LOCK} className={`flex ${box} items-center justify-center bg-gray-950 p-8 text-center text-sm text-gray-400`}>
        <div>
          <p className="font-semibold text-gray-200">
            {app
              ? t('panel.appsWindow.unknownMode', { mode: hash.mode })
              : t('panel.appsWindow.unknownApp', { id: hash.appId })}
          </p>
          <p className="mt-1 text-xs text-gray-500">{`#app=${hash.appId}&mode=${hash.mode}`}</p>
        </div>
      </div>
    );
  }

  return (
    <div {...themeLock} className={`${box} bg-gray-950`}>
      <Suspense fallback={<div className="h-full w-full bg-gray-950" />}>
        <Shell appId={hash.appId} params={hash.params} />
      </Suspense>
    </div>
  );
}
