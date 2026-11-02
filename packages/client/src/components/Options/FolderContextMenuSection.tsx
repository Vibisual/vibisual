import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderContextMenuStatus, FolderContextMenuTarget } from '@vibisual/shared';

/**
 * §4 폴더 우클릭으로 프로젝트 열기 — 스위치(`UserDefaults.advanced.folderContextMenu`, 기본 켬). 같은 `advanced` 칸의 다른 값과
 * 한 벌로 [적용]해야 서로 안 덮으므로 값은 창이 든다. 상태 줄은 desktop main 이 OS 에 실제로 적은 결과를 그대로 보인다.
 */

const API_BASE = '';

const TARGET_KEYS: Record<FolderContextMenuTarget, string> = {
  'windows-explorer': 'windowsExplorer',
  'macos-finder': 'macosFinder',
  nautilus: 'nautilus',
  caja: 'caja',
  dolphin: 'dolphin',
  nemo: 'nemo',
};

interface FolderContextMenuSectionProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function FolderContextMenuSection({ enabled, onChange }: FolderContextMenuSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<FolderContextMenuStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/folder-context-menu`);
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json() as { status: FolderContextMenuStatus | null };
      setStatus(body.status);
      setLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const targets = status?.targets ?? [];
  let statusText: string | null = null;
  let statusWarn = false;
  if (loadError) {
    statusText = t('panel.options.advanced.folderMenuStatusError', { error: loadError, defaultValue: 'Could not update the menu: {{error}}' });
    statusWarn = true;
  } else if (loaded && !status) {
    // 데스크톱 main 이 아직 한 번도 적지 않았다 — 켠 직후이거나 브라우저 화면이다.
    statusText = typeof window !== 'undefined' && window.api
      ? t('panel.options.advanced.folderMenuStatusChecking', { defaultValue: 'Applying the menu. Check again in a moment.' })
      : t('panel.options.advanced.folderMenuStatusDesktopOnly', { defaultValue: 'Available in the desktop app.' });
  } else if (status) {
    if (status.reason === 'dev-build') {
      statusText = t('panel.options.advanced.folderMenuStatusDevBuild', { defaultValue: 'This is a development run, so the menu is left to the installed app.' });
    } else if (status.reason === 'no-file-manager') {
      statusText = t('panel.options.advanced.folderMenuStatusNoFileManager', { defaultValue: 'No supported file manager was found (Files, Caja, Dolphin or Nemo).' });
      statusWarn = true;
    } else if (status.reason === 'unsupported-platform') {
      statusText = t('panel.options.advanced.folderMenuStatusUnsupported', { defaultValue: 'Not available on this system.' });
    } else if (status.reason === 'error') {
      statusText = t('panel.options.advanced.folderMenuStatusError', { error: status.error ?? '', defaultValue: 'Could not update the menu: {{error}}' });
      statusWarn = true;
    } else if (status.installed && targets.length > 0) {
      const names = targets.map((target) => t(`panel.options.advanced.folderMenuTargets.${TARGET_KEYS[target]}`, { defaultValue: target }));
      let list = names.join(', ');
      try { list = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names); } catch { /* 옛 엔진 — 쉼표로 */ }
      statusText = t('panel.options.advanced.folderMenuStatusInstalled', { targets: list, defaultValue: 'Added to {{targets}}.' });
    } else {
      statusText = t('panel.options.advanced.folderMenuStatusOff', { defaultValue: 'Not shown in the menu.' });
    }
  }

  // 어디에 숨어 있는지 — 실제로 적은 자리에 맞는 것만.
  const hints: string[] = [];
  if (status?.installed) {
    if (targets.includes('windows-explorer')) hints.push(t('panel.options.advanced.folderMenuHintWindows', { defaultValue: 'On Windows 11 it is under “Show more options”.' }));
    if (targets.includes('macos-finder')) hints.push(t('panel.options.advanced.folderMenuHintMac', { defaultValue: 'In Finder it is under “Quick Actions” or “Services”.' }));
    if (targets.includes('nautilus') || targets.includes('caja')) hints.push(t('panel.options.advanced.folderMenuHintScripts', { defaultValue: 'In Files and Caja it is under “Scripts”.' }));
  }

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.folderMenuTitle', { defaultValue: 'Folder right-click menu' })}
      </h4>
      <p className="max-w-prose text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.folderMenuIntro', {
          defaultValue: 'Right-click a folder in your file manager and choose “Open project in Vibisual” to open it here as a project. If Vibisual is not running, it starts and opens that folder.',
        })}
      </p>

      <label className="flex cursor-pointer items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 hover:border-gray-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-500"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.advanced.folderMenuEnabled', { defaultValue: 'Show “Open project in Vibisual” when you right-click a folder' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.advanced.folderMenuEnabledDesc', { defaultValue: 'Applied when you save. Turning it off removes the item from the menu.' })}
          </span>
        </span>
      </label>

      {statusText && (
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className={`text-[12px] leading-snug ${statusWarn ? 'text-amber-300/90' : 'text-gray-400'}`}>
              {statusText}
            </p>
            {hints.map((hint) => (
              <p key={hint} className="text-[12px] leading-snug text-gray-500">{hint}</p>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => { void load(); }}
            title={t('panel.options.advanced.folderMenuRefresh', { defaultValue: 'Check again' })}
            aria-label={t('panel.options.advanced.folderMenuRefresh', { defaultValue: 'Check again' })}
            className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200 disabled:opacity-40 pointer-coarse:p-2.5"
          >
            <svg
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
