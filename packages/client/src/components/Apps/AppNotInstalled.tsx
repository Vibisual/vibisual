import { useTranslation } from 'react-i18next';

import { getInternalApp } from '../../apps/registry.js';
import { WindowControls } from '../Layout/WindowControls.js';

/**
 * §5.13 (N) v4.47 — "이 앱은 아직 설치되지 않았습니다" 화면.
 *
 * **앱 안에 설치 버튼을 두지 않는다.** 설치는 **캔버스 우클릭 → 앱** 과 **앱 버블**
 * 두 표면에서만 하고, 그 둘은 같은 로직(`useAppInstall`)을 쓴다. 앱마다 자기 설치
 * 화면을 가지면 앱이 늘 때마다 설치 경험이 갈라지고, 무엇이 깔려 있는지 한눈에 볼
 * 자리가 사라진다.
 *
 * 그래서 이 화면은 **막다른 길이 아니라 이정표**다 — 어디로 가야 하는지만 알려 준다.
 * (이 창까지 온 경우는 드물다. 보통은 버블이 흐리게 보여서 거기서 바로 깐다.)
 */
export function AppNotInstalled({ appId }: { appId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(appId);
  const name = app ? t(app.nameKey, { defaultValue: app.name }) : appId;

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      {/* 앱 창은 프레임이 없다 — 이 화면에도 타이틀바가 없으면 창을 옮길 수도, 닫을 수도 없다. */}
      <header className="app-drag flex h-9 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <span className="truncate text-[12px] font-medium text-gray-200">{name}</span>
        <div className="ml-auto flex items-center">
          <WindowControls />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto h-8 w-8 text-gray-500"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <path d="M14 17.5h7M17.5 14v7" />
          </svg>
          <h1 className="text-base font-semibold">
            {t('panel.appsWindow.notInstalledTitle', { defaultValue: '{{name}} 이(가) 설치되지 않았습니다', name })}
          </h1>
          <p className="text-sm leading-relaxed text-white/60">
            {t('panel.appsWindow.notInstalledBody', {
              defaultValue: '캔버스를 우클릭해 앱에서 설치하세요. 버블을 놓고 그 버블에서 바로 설치해도 됩니다.',
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
