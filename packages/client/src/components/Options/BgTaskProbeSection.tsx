import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackgroundTaskProbeSettings } from '@vibisual/shared';
import { BG_TASK_PROBE_LIMITS, BG_TASK_PROBE_MODELS, DEFAULT_BG_TASK_PROBE_SETTINGS } from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

/**
 * §5.5 #17-9 ⑭(g) — **조용한 백그라운드 작업을 스스로 판정하는 기능의 손잡이.**
 *
 * 이 화면이 있어야 하는 이유는 ⑩ 의 금지와 짝이다. 시간만으로 죽었다고 단정하는 회수는
 * 금지돼 있고(정당한 대기를 끊어 버린다), ⑭ 는 그 자리를 **모델에게 한 번 물어서** 메운다.
 * 물어보는 것도 죽이는 것도 사용자 자산을 건드리는 일이라, **어디까지 자동으로 할지를
 * 사용자가 정할 수 있어야 한다** — Claude Code 의 `cleanupPeriodDays` 가 정책은 옳고 끄는 UI 가
 * 없어 반발을 산 그 자리(#59248·#64999)를 여기서 미리 막는다.
 *
 * 네 손잡이는 **자동의 세기를 순서대로** 늘린다: 끄기 → 언제 물어볼지 → 물어보고 닫을지 →
 * 닫으면서 프로세스까지 끊을지. 앞을 끄면 뒤는 의미가 없으므로 화면에서도 함께 잠근다.
 *
 * 설정은 **머신 단위**(`AppState`)라 프로젝트를 옮겨도 같다 — 보존 설정과 같은 문법으로
 * 자기 REST(`/api/bg-task-probe-settings`)를 직접 읽고 쓰고, 미저장 여부만 창에 올린다.
 */

const API_BASE = '';

interface BgTaskProbeSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** 체크박스 한 줄 — 세 개가 같은 리듬을 갖도록 한 곳에 둔다(설명은 항상 값 아래에). */
function ToggleRow({
  checked, onChange, disabled, label, desc,
}: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; desc: string;
}): React.JSX.Element {
  return (
    <label
      className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
        disabled ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-gray-200">{label}</span>
        <span className="text-[12px] leading-snug text-gray-500">{desc}</span>
      </span>
    </label>
  );
}

export function BgTaskProbeSection({ onDirtyChange }: BgTaskProbeSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BackgroundTaskProbeSettings>(DEFAULT_BG_TASK_PROBE_SETTINGS);
  const [saved, setSaved] = useState<BackgroundTaskProbeSettings>(DEFAULT_BG_TASK_PROBE_SETTINGS);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = useMemo(
    () => (Object.keys(DEFAULT_BG_TASK_PROBE_SETTINGS) as (keyof BackgroundTaskProbeSettings)[])
      .some((k) => settings[k] !== saved[k]),
    [settings, saved],
  );

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/bg-task-probe-settings`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: BackgroundTaskProbeSettings };
      setSettings(data.settings);
      setSaved(data.settings);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, []);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/bg-task-probe-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 서버는 들어온 축만 덮어쓰지만(부분 갱신), 이 폼은 네 축을 통째로 편집하므로 통째로 보낸다.
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: BackgroundTaskProbeSettings };
      setSettings(data.settings);
      setSaved(data.settings);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [settings]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const off = !settings.enabled;
  const patch = (p: Partial<BackgroundTaskProbeSettings>): void => setSettings((s) => ({ ...s, ...p }));

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.bgProbeTitle', { defaultValue: 'Quiet background tasks' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.bgProbeIntro', {
          defaultValue: 'A background command that goes quiet is not necessarily finished — one that waits for something is quiet by design, so Vibisual never closes an item on elapsed time alone. Instead, when an item has been quiet for a long while with no end marker, a small judging agent is asked once whether the command has a condition under which it ends by itself and whether that condition is already met.',
        })}
      </p>

      <ToggleRow
        checked={settings.enabled}
        onChange={(v) => patch({ enabled: v })}
        label={t('panel.options.advanced.bgProbeEnabled', { defaultValue: 'Ask about quiet tasks' })}
        desc={t('panel.options.advanced.bgProbeEnabledDesc', {
          defaultValue: 'Off means no model is ever called for this — quiet items simply stay on the list until you remove them.',
        })}
      />

      <div className={`flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${off ? 'opacity-40' : ''}`}>
        <label className="text-xs text-gray-200">
          {t('panel.options.advanced.bgProbeQuiet', { defaultValue: 'Ask after this much silence (minutes)' })}
        </label>
        <NumberStepper
          value={settings.quietMinutes}
          onChange={(n) => patch({ quietMinutes: n })}
          min={BG_TASK_PROBE_LIMITS.quietMinutes.min}
          max={BG_TASK_PROBE_LIMITS.quietMinutes.max}
          step={BG_TASK_PROBE_LIMITS.quietMinutes.step}
          disabled={off || busy !== null}
          widthClassName="w-20"
          ariaLabel={t('panel.options.advanced.bgProbeQuiet', { defaultValue: 'Ask after this much silence (minutes)' })}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.bgProbeQuietDesc', {
            defaultValue: 'Silence only decides when to ask — it never decides the answer. 0 turns the asking off.',
          })}
        </p>
      </div>

      <ToggleRow
        checked={settings.autoClose}
        disabled={off}
        onChange={(v) => patch({ autoClose: v })}
        label={t('panel.options.advanced.bgProbeAutoClose', { defaultValue: 'Clear the item when the answer is "finished"' })}
        desc={t('panel.options.advanced.bgProbeAutoCloseDesc', {
          defaultValue: 'Off means the answer is only written onto the card and you decide. "Still running" and "could not tell" never clear anything either way.',
        })}
      />

      <ToggleRow
        checked={settings.killProcess}
        disabled={off || !settings.autoClose}
        onChange={(v) => patch({ killProcess: v })}
        label={t('panel.options.advanced.bgProbeKill', { defaultValue: 'Also stop the processes it had started' })}
        desc={t('panel.options.advanced.bgProbeKillDesc', {
          defaultValue: 'Clearing the list alone leaves the command running. Only processes under that session whose command line matches this task are touched.',
        })}
      />

      <div className={`flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${off ? 'opacity-40' : ''}`}>
        <label className="text-xs text-gray-200">
          {t('panel.options.advanced.bgProbeModel', { defaultValue: 'Model that answers' })}
        </label>
        <select
          value={settings.model}
          disabled={off || busy !== null}
          onChange={(e) => patch({ model: e.target.value })}
          className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed"
        >
          {BG_TASK_PROBE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.bgProbeModelDesc', {
            defaultValue: 'It is asked once, with no tools and no access to your project — only the command text and a short tail of its output.',
          })}
        </p>
      </div>

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.advanced.bgProbeLoadError', { defaultValue: 'Could not read the current setting.' })
            : t('panel.options.advanced.bgProbeSaveError', { defaultValue: 'Could not save. Nothing was changed.' })}
        </p>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={!dirty || busy !== null}
          onClick={() => { void save(); }}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-500"
        >
          {busy === 'save'
            ? t('panel.options.storage.saving', { defaultValue: 'Saving…' })
            : t('panel.options.storage.save', { defaultValue: 'Save' })}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setSettings(DEFAULT_BG_TASK_PROBE_SETTINGS)}
          className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-white/[0.04]"
        >
          {t('panel.options.storage.reset', { defaultValue: 'Restore defaults' })}
        </button>
        {dirty && (
          <span className="text-[12px] text-amber-400">
            {t('panel.options.storage.unsaved', { defaultValue: 'Not applied yet' })}
          </span>
        )}
      </div>
    </div>
  );
}
