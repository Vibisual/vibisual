import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_SHELL_SKELETON } from '@vibisual/shared';

import { getInternalApp, type AppHash } from './index.js';
import { AppBoxTierContext, useBoxTier } from '../hooks/useBoxTier.js';
import { DARK_THEME_LOCK } from '../theme/themeLock.js';
import { peekPrefetchedShell, rememberShell } from './prefetchAppShell.js';
import { markAppTiming } from './appTiming.js';

/**
 * §5.13 (X) 39-3 — 늦은 화면을 기다리는 동안의 편집기 모양 뼈대("멈춘 창"이 아니라 "열리는 중"). `delayMs` 안에 오면 그리지 않는다(번쩍임 ❌).
 * (Y) 40-10 ③ — 반복 애니메이션 없는 정적 판이다(짧은 대기의 움직임은 오히려 덜컥거린다).
 */
function ShellSkeleton(): React.JSX.Element {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), APP_SHELL_SKELETON.delayMs);
    return () => clearTimeout(timer);
  }, []);
  return (
    // 색은 테마 토큰 — 라이트 테마에서도 보이고, 화면이 들어설 때 바탕색이 번쩍이지 않는다(앱 화면도 같은 토큰을 쓴다).
    <div className="flex h-full w-full flex-col bg-vb-window" role="status" aria-busy="true" aria-label={t('ide.explorer.loading')}>
      {shown ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" aria-hidden="true">
          <div className="h-7 w-2/5 shrink-0 rounded-md bg-vb-card" />
          {/* 좁은 창에선 옆 칸이 접힌 모양 — 뼈대가 실제 배치와 다르면 열리는 순간 화면이 한 번 뒤집힌다. */}
          <div className="flex min-h-0 flex-1 gap-2">
            <div className="w-12 shrink-0 rounded-lg bg-vb-card box-narrow:hidden" />
            <div className="min-w-0 flex-1 rounded-lg bg-vb-sunken" />
            <div className="w-[clamp(200px,24%,340px)] shrink-0 rounded-lg bg-vb-card box-compact:hidden" />
          </div>
          <div className="h-14 shrink-0 rounded-lg bg-vb-card" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * §5.13 (O) — `#app=<id>&mode=<mode>` 로 레지스트리 로더를 꺼내 늦게 부른다(코어 `main.tsx` 는 앱 이름을 모른다). 없는 앱·화면이면 무엇이 없는지 적는다.
 * (S-7) 높이는 호스트가 준다 — 셸이 `h-screen` 을 주장하면 앱 안 창을 뚫는다. 앱 안 창은 `fill` 로 부모 자리를 채운다.
 */
export function AppShellHost({ hash, fill = false }: { hash: AppHash; fill?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(hash.appId);
  const loader = app?.shells[hash.mode];
  // 앱 화면의 반응형 기준은 이 상자의 폭이다(앱 안 창·OS 창 모두) — 자손은 `box-compact:`·`box-narrow:`·`box-wide:` 로 읽는다.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxTier = useBoxTier(rootRef);

  // §5.13 (X) 39-2 — 미리 받아 둔 화면(노드에 손이 올라갔을 때·한 번 열었던 화면)은 `lazy` 를 거치지 않고 **바로** 그린다. React 18
  //   의 `lazy` 는 이미 풀린 약속이어도 첫 렌더에서 한 번 멈췄다 다시 그린다. 처음 받는 화면은 받으면서 기억해 둔다.
  const Shell = useMemo(
    () => {
      if (!loader) return null;
      const ready = peekPrefetchedShell(hash.appId, hash.mode);
      if (ready) return ready;
      return lazy(async () => {
        // §5.13 (Y) 40-12 — 앱 화면 청크를 받기 시작한 때·다 받은 때(앱 이름 없이 — 값은 실행 때 온다). 계측이 이 둘을 읽는다.
        markAppTiming(`shell-start:${hash.appId}`);
        const shell = await loader();
        markAppTiming(`shell-ready:${hash.appId}`);
        rememberShell(hash.appId, hash.mode, shell);
        return { default: shell };
      });
    },
    [loader, hash.appId, hash.mode],
  );

  // ⚠ OS 창엔 `overflow-hidden` ❌ — 렌더 무대(§5.13 (F) `offscreen-capture`)는 영상 치수 고정이라 잘리면 잘린 화면이 그대로 프레임이 된다.
  // 앱 안 창은 반대로 잘라야 새지 않는다. OS 창 `h-dvh` — 폰 주소창이 아래를 가리지 않게.
  const box = fill ? 'h-full w-full overflow-hidden' : 'h-dvh w-screen';

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

  // 사람이 보는 화면(`main`)만 뼈대를 띄운다 — 숨은 일꾼·렌더 화면은 아무도 보지 않으니 그릴 일도 없다.
  const fallback = hash.mode === 'main' ? <ShellSkeleton /> : <div className="h-full w-full bg-gray-950" />;
  return (
    <div ref={rootRef} {...themeLock} className={`${box} bg-gray-950`}>
      <AppBoxTierContext.Provider value={boxTier}>
        <Suspense fallback={fallback}>
          <Shell appId={hash.appId} params={hash.params} />
        </Suspense>
      </AppBoxTierContext.Provider>
    </div>
  );
}
