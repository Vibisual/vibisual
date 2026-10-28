import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcessGuardSettings } from '@vibisual/shared';
import {
  DEFAULT_PROCESS_GUARD_SETTINGS,
  MEMORY_PRESSURE_FLOOR_MIN_BYTES,
  MEMORY_PRESSURE_FLOOR_RATIO,
  PROCESS_GUARD_LIMITS,
  PROCESS_GUARD_TICK_MS,
  PROCESS_MEMORY_CAP_FLOOR_BYTES,
  resolveProcessMemoryCap,
} from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';
import { ToggleRow } from './BgTaskProbeSection.js';
import { formatBytes } from '../../utils/insuranceView.js';

/**
 * §5.3 #9-2 — 에이전트가 띄운 프로세스 보호(손자까지 묶고, 폭주한 것만 멈추고, 세션이 끝나면 정리). 2026-10-12 grep 둘이 커밋 97GB 를 먹어 앱이 꺼졌다.
 * 자동으로 끊는 기능이라 세기를 사용자가 정한다(⑭(g)). 머신 단위 설정 — 자기 REST 를 직접 읽고 쓰고 미저장 여부만 창에 올린다.
 */

const API_BASE = '';

interface ProcessGuardSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ProcessGuardResponse {
  settings: ProcessGuardSettings;
  /** 이 컴퓨터의 실메모리 — "실제 상한"을 같은 shared 함수로 미리 보여 주는 재료. */
  totalMemBytes?: number;
}

export function ProcessGuardSection({ onDirtyChange }: ProcessGuardSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ProcessGuardSettings>(DEFAULT_PROCESS_GUARD_SETTINGS);
  const [saved, setSaved] = useState<ProcessGuardSettings>(DEFAULT_PROCESS_GUARD_SETTINGS);
  const [totalMemBytes, setTotalMemBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = useMemo(
    () => (Object.keys(DEFAULT_PROCESS_GUARD_SETTINGS) as (keyof ProcessGuardSettings)[])
      .some((k) => settings[k] !== saved[k]),
    [settings, saved],
  );

  const accept = useCallback((data: ProcessGuardResponse): void => {
    setSettings(data.settings);
    setSaved(data.settings);
    if (typeof data.totalMemBytes === 'number' && data.totalMemBytes > 0) setTotalMemBytes(data.totalMemBytes);
  }, []);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/process-guard-settings`);
      if (!res.ok) throw new Error(String(res.status));
      accept(await res.json() as ProcessGuardResponse);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, [accept]);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/process-guard-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 서버는 들어온 축만 덮어쓰지만(부분 갱신), 이 폼은 네 축을 통째로 편집하므로 통째로 보낸다.
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(String(res.status));
      accept(await res.json() as ProcessGuardResponse);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [settings, accept]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const off = !settings.enabled;
  const patch = (p: Partial<ProcessGuardSettings>): void => setSettings((s) => ({ ...s, ...p }));
  // 서버가 묶음에 싣는 값과 **같은 함수**로 계산한다 — 화면과 실제가 갈리면 이 줄이 거짓말이 된다.
  const capNow = totalMemBytes !== null ? resolveProcessMemoryCap(totalMemBytes, settings.memoryCapPercent) : null;

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.processGuardTitle')}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.processGuardIntro')}
      </p>

      <ToggleRow
        checked={settings.enabled}
        onChange={(v) => patch({ enabled: v })}
        label={t('panel.options.advanced.processGuardEnabled')}
        desc={t('panel.options.advanced.processGuardEnabledDesc')}
      />

      <div className={`flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${off ? 'opacity-40' : ''}`}>
        <label className="text-xs text-gray-200">
          {t('panel.options.advanced.processGuardCap')}
        </label>
        <NumberStepper
          value={settings.memoryCapPercent}
          onChange={(n) => patch({ memoryCapPercent: n })}
          min={PROCESS_GUARD_LIMITS.memoryCapPercent.min}
          max={PROCESS_GUARD_LIMITS.memoryCapPercent.max}
          step={PROCESS_GUARD_LIMITS.memoryCapPercent.step}
          disabled={off || busy !== null}
          widthClassName="w-20"
          ariaLabel={t('panel.options.advanced.processGuardCap')}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.processGuardCapDesc', {
            floor: formatBytes(PROCESS_MEMORY_CAP_FLOOR_BYTES),
            seconds: Math.round(PROCESS_GUARD_TICK_MS / 1000),
          })}
        </p>
        {!off && totalMemBytes !== null && (
          <p className="text-[12px] leading-snug text-gray-400">
            {capNow === null
              ? t('panel.options.advanced.processGuardCapNone')
              : t('panel.options.advanced.processGuardCapNow', { size: formatBytes(capNow) })}
          </p>
        )}
      </div>

      <ToggleRow
        checked={settings.pressureKill}
        disabled={off}
        onChange={(v) => patch({ pressureKill: v })}
        label={t('panel.options.advanced.processGuardPressure')}
        desc={t('panel.options.advanced.processGuardPressureDesc', {
          // 숫자는 상수에서 받는다 — 문장에 박으면 상수를 바꿨을 때 12개 언어 문장이 함께 틀린다.
          ratio: `${Math.round(MEMORY_PRESSURE_FLOOR_RATIO * 100)}%`,
          min: formatBytes(MEMORY_PRESSURE_FLOOR_MIN_BYTES),
        })}
      />

      <ToggleRow
        checked={settings.reapOnSessionEnd}
        disabled={off}
        onChange={(v) => patch({ reapOnSessionEnd: v })}
        label={t('panel.options.advanced.processGuardReap')}
        desc={t('panel.options.advanced.processGuardReapDesc')}
      />

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.advanced.bgProbeLoadError')
            : t('panel.options.advanced.bgProbeSaveError')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={!dirty || busy !== null}
          onClick={() => { void save(); }}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-500"
        >
          {busy === 'save' ? t('panel.options.storage.saving') : t('panel.options.storage.save')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setSettings(DEFAULT_PROCESS_GUARD_SETTINGS)}
          className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-white/[0.04]"
        >
          {t('panel.options.storage.reset')}
        </button>
        {dirty && (
          <span className="text-[12px] text-amber-400">
            {t('panel.options.storage.unsaved')}
          </span>
        )}
      </div>
    </div>
  );
}
