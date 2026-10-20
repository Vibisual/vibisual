import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EngineBridgeStatus } from '@vibisual/shared';

/**
 * §4 엔진 다리 — 옵션창 고급 탭의 손잡이.
 *
 * 스위치(`UserDefaults.advanced.engineBridge`, 기본 켬)는 옵션창의 [적용]과 **함께** 저장된다. 같은
 * `advanced` 칸의 터미널 scrollback 과 한 벌로 보내야 서로를 덮지 않으므로, 값은 창이 들고 여기는
 * 그리기만 한다. 아래 상태 줄은 서버가 지금 아는 사실(판올림·지금 붙은 세션 수)을 그대로 읽어 보여 준다 —
 * 켜 두었는데 왜 안 붙는지(판올림이 낮다·파일이 없다)를 사용자가 여기서 알 수 있어야 한다.
 */

const API_BASE = '';

interface EngineBridgeSectionProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function EngineBridgeSection({ enabled, onChange }: EngineBridgeSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EngineBridgeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${API_BASE}/api/engine-bridge`);
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json() as EngineBridgeStatus);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  let statusText: string | null = null;
  let statusWarn = false;
  if (loadError) {
    statusText = t('panel.options.advanced.engineBridgeStatusError', { defaultValue: 'Could not read the bridge status.' });
    statusWarn = true;
  } else if (status) {
    if (!status.modReady) {
      statusText = t('panel.options.advanced.engineBridgeStatusMissing', {
        defaultValue: 'The bridge files are missing from this installation, so sessions run as before.',
      });
      statusWarn = true;
    } else if (status.supported === false) {
      statusText = t('panel.options.advanced.engineBridgeStatusUnsupported', {
        version: status.cliVersion ?? '?',
        min: status.minCliVersion,
        defaultValue: 'Claude Code {{version}} cannot load mods; version {{min}} or later is needed. Sessions run as before.',
      });
      statusWarn = true;
    } else if (status.supported === null) {
      statusText = t('panel.options.advanced.engineBridgeStatusChecking', {
        defaultValue: 'Checking the Claude Code version. The bridge joins from the next session once it is confirmed.',
      });
    } else {
      statusText = t('panel.options.advanced.engineBridgeStatusReady', {
        version: status.cliVersion ?? '',
        sessions: status.sessions,
        defaultValue: 'Claude Code {{version}} can load the bridge. Sessions connected right now: {{sessions}}',
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.engineBridgeTitle', { defaultValue: 'Claude Code engine bridge' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.engineBridgeIntro', {
          defaultValue: 'Sessions that Vibisual starts carry a small Claude Code mod. From inside Claude Code it reports when a turn starts and ends (including turns you interrupt), that the process is still alive, and how full the context and usage limits are. Running and finished states then come from Claude Code itself instead of being guessed. Sessions you start outside Vibisual are never touched.',
        })}
      </p>

      <label className="flex cursor-pointer items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 hover:border-gray-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.advanced.engineBridgeEnabled', { defaultValue: 'Connect the sessions Vibisual starts (headless and CMD)' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.advanced.engineBridgeEnabledDesc', {
              defaultValue: 'Applies to sessions started after saving. Off means sessions run exactly as before, with their state taken from hooks and screen detection only.',
            })}
          </span>
        </span>
      </label>

      {statusText && (
        <div className="flex items-start gap-2">
          <p className={`flex-1 text-[12px] leading-snug ${statusWarn ? 'text-amber-300/90' : 'text-gray-400'}`}>
            {statusText}
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => { void load(); }}
            title={t('panel.options.advanced.engineBridgeRefresh', { defaultValue: 'Check again' })}
            aria-label={t('panel.options.advanced.engineBridgeRefresh', { defaultValue: 'Check again' })}
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
