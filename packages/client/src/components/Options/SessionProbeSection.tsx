import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionLivenessProbeSettings } from '@vibisual/shared';
import { SESSION_PROBE_LIMITS, SESSION_PROBE_MODELS, DEFAULT_SESSION_PROBE_SETTINGS } from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

/**
 * §2.4 — **"실행중…" 으로 서 있는 세션이 진짜로 도는 중인지 물어보는 기능의 손잡이.**
 *
 * 이 화면이 있어야 하는 이유는 ⑭(g) 와 같다. 물어보는 것도 세션을 내리는 것도 사용자 자산을
 * 건드리는 일이라, **어디까지 자동으로 할지를 사용자가 정할 수 있어야 한다.** 스위치를 만들어
 * 놓고 끌 자리를 안 주면 그것은 없는 설정과 같다(`/vibisual-qa` 결함 카탈로그의 "읽히지 않는
 * 설정 스위치").
 *
 * 손잡이는 **자동의 세기를 순서대로** 늘린다: 끄기 → 언제 물어볼지 → 물어보고 내릴지 → 누가 답할지.
 * 앞을 끄면 뒤는 의미가 없으므로 화면에서도 함께 잠근다.
 *
 * 설정은 **머신 단위**(`AppState`)라 프로젝트를 옮겨도 같다 — `BgTaskProbeSection` 과 같은 문법으로
 * 자기 REST(`/api/session-probe-settings`)를 직접 읽고 쓰고, 미저장 여부만 창에 올린다.
 */

const API_BASE = '';

interface SessionProbeSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function SessionProbeSection({ onDirtyChange }: SessionProbeSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SessionLivenessProbeSettings>(DEFAULT_SESSION_PROBE_SETTINGS);
  const [saved, setSaved] = useState<SessionLivenessProbeSettings>(DEFAULT_SESSION_PROBE_SETTINGS);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = useMemo(
    () => (Object.keys(DEFAULT_SESSION_PROBE_SETTINGS) as (keyof SessionLivenessProbeSettings)[])
      .some((k) => settings[k] !== saved[k]),
    [settings, saved],
  );

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/session-probe-settings`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: SessionLivenessProbeSettings };
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
      const res = await fetch(`${API_BASE}/api/session-probe-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 서버는 들어온 축만 덮어쓰지만(부분 갱신), 이 폼은 네 축을 통째로 편집하므로 통째로 보낸다.
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: SessionLivenessProbeSettings };
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
  const patch = (p: Partial<SessionLivenessProbeSettings>): void => setSettings((s) => ({ ...s, ...p }));
  const quietLabel = t('panel.options.advanced.sessionProbeQuiet', { defaultValue: 'Ask after this much silence (minutes)' });

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.sessionProbeTitle', { defaultValue: 'Sessions stuck on "running"' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.sessionProbeIntro', {
          defaultValue: 'A session can sit on "running" long after its work ended, because the signals that end a session are all self-reported — if one is missed, nothing takes it down. Elapsed time cannot settle it either: a session waiting on a long build looks exactly like one that quietly died. So every 10 minutes a small judging agent is asked once, about a single session, what it is waiting for and whether that is still coming.',
        })}
      </p>

      <label
        className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
          busy !== null ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
      >
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy !== null}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.advanced.sessionProbeEnabled', { defaultValue: 'Check whether running sessions are really running' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.advanced.sessionProbeEnabledDesc', {
              defaultValue: 'Off means no model is ever called for this — sessions stay on "running" until something else takes them down.',
            })}
          </span>
        </span>
      </label>

      <div className={`flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${off ? 'opacity-40' : ''}`}>
        <label className="text-xs text-gray-200">{quietLabel}</label>
        <NumberStepper
          value={settings.quietMinutes}
          onChange={(n) => patch({ quietMinutes: n })}
          min={SESSION_PROBE_LIMITS.quietMinutes.min}
          max={SESSION_PROBE_LIMITS.quietMinutes.max}
          step={SESSION_PROBE_LIMITS.quietMinutes.step}
          disabled={off || busy !== null}
          widthClassName="w-20"
          ariaLabel={quietLabel}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.sessionProbeQuietDesc', {
            defaultValue: 'Silence only decides when to ask — it never decides the answer. A session that answers "still working" is left alone for longer and longer before being asked again. 0 turns the asking off.',
          })}
        </p>
      </div>

      <label
        className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
          off || busy !== null ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
      >
        <input
          type="checkbox"
          checked={settings.autoClose}
          disabled={off || busy !== null}
          onChange={(e) => patch({ autoClose: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.advanced.sessionProbeAutoClose', { defaultValue: 'End the session when the answer is "finished"' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.advanced.sessionProbeAutoCloseDesc', {
              defaultValue: 'Off means the answer is only shown in the status bar and you decide. "Still working", "stuck" and "could not tell" never end anything either way — and nothing here kills a process; the session is simply marked as no longer running.',
            })}
          </span>
        </span>
      </label>

      <div className={`flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${off ? 'opacity-40' : ''}`}>
        <label className="text-xs text-gray-200">
          {t('panel.options.advanced.sessionProbeModel', { defaultValue: 'Model that answers' })}
        </label>
        <select
          value={settings.model}
          disabled={off || busy !== null}
          onChange={(e) => patch({ model: e.target.value })}
          className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed"
        >
          {SESSION_PROBE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.sessionProbeModelDesc', {
            defaultValue: 'It is asked once, with no tools and no access to your project — only a short tail of what that session last said and did. At most one session is asked at a time, and no more than 12 times an hour.',
          })}
        </p>
      </div>

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.advanced.sessionProbeLoadError', { defaultValue: 'Could not read the current setting.' })
            : t('panel.options.advanced.sessionProbeSaveError', { defaultValue: 'Could not save. Nothing was changed.' })}
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
          onClick={() => setSettings(DEFAULT_SESSION_PROBE_SETTINGS)}
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
