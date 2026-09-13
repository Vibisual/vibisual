import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TokenSaverSettings, TokenSaverPreset, NumericTokenSaverKey } from '@vibisual/shared';
import { DEFAULT_TOKEN_SAVER_SETTINGS, TOKEN_SAVER_LIMITS, TOKEN_SAVER_PRESET_VALUES, AVAILABLE_AUTOCOMPACT_VALUES } from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

/**
 * §5.3 #9-1 — **토큰 절약 손잡이.**
 *
 * 실측(2026-09-11)에서 입력 토큰의 96.5%가 `cache_read` 였다 — 돈이 나가는 자리는 "새로 보낸 것"이
 * 아니라 **"이미 보낸 것을 매 턴 다시 읽는 것"** 이다. 그래서 이 화면의 손잡이들은 하나같이
 * *한 턴에 실리는 양*과 *그 양을 몇 번 다시 읽는가*를 건드린다.
 *
 * 화면 순서는 **효과가 큰 것부터**다: 문맥이 자라는 속도(J) → 한 턴에 쓰는 양(K) → 언제 접나(L) →
 * 덤으로 도는 호출(M) → 몇이 동시에 도나(N) → 어떻게 띄우나(O) → 얼마나 오래 끄나(P).
 *
 * `SessionProbeSection`·`BgTaskProbeSection` 과 **같은 문법**이다 — 머신 단위 설정이라 자기
 * REST(`/api/token-saver-settings`)를 직접 읽고 쓰고, 미저장 여부만 창에 올린다.
 */

const API_BASE = '';

/** 숫자 칸 렌더 순서 — 화면의 순서가 곧 효과의 순서다(위가 크다). */
const NUMERIC_ORDER: NumericTokenSaverKey[] = [
  'bashMaxOutputChars',
  'mcpMaxOutputTokens',
  'maxOutputTokens',
  'maxThinkingTokens',
  'autoCompactPct',
  'maxConcurrentAgents',
  'spawnStaggerMs',
  'sessionTurnBudget',
];

const PRESETS: Exclude<TokenSaverPreset, 'custom'>[] = ['off', 'balanced', 'saver'];

interface TokenSaverSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function TokenSaverSection({ onDirtyChange }: TokenSaverSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TokenSaverSettings>(DEFAULT_TOKEN_SAVER_SETTINGS);
  const [saved, setSaved] = useState<TokenSaverSettings>(DEFAULT_TOKEN_SAVER_SETTINGS);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = useMemo(
    () => (Object.keys(DEFAULT_TOKEN_SAVER_SETTINGS) as (keyof TokenSaverSettings)[])
      .some((k) => settings[k] !== saved[k]),
    [settings, saved],
  );

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/token-saver-settings`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: TokenSaverSettings };
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
      const res = await fetch(`${API_BASE}/api/token-saver-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 서버는 들어온 축만 덮어쓰지만(부분 갱신), 이 폼은 전 축을 편집하므로 통째로 보낸다.
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: TokenSaverSettings };
      setSettings(data.settings);
      setSaved(data.settings);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [settings]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  /**
   * 프리셋 고르기 — **값을 채울 뿐**이다. 저장 전까지는 서버에 아무것도 안 간다(다른 칸과 같다).
   * `preset` 문자열은 서버가 값에서 다시 판정하므로 여기서 보내는 것은 참고값이다.
   */
  const applyPreset = (name: Exclude<TokenSaverPreset, 'custom'>): void => {
    setSettings({ ...TOKEN_SAVER_PRESET_VALUES[name] });
  };

  const patch = (p: Partial<TokenSaverSettings>): void => setSettings((s) => ({ ...s, ...p }));

  /** 지금 값이 어느 프리셋인가 — 한 칸이라도 다르면 '직접 설정'. 표시 전용이다. */
  const currentPreset: TokenSaverPreset = useMemo(() => {
    for (const name of PRESETS) {
      const p = TOKEN_SAVER_PRESET_VALUES[name];
      const same = NUMERIC_ORDER.every((k) => settings[k] === p[k])
        && settings.disableNonEssentialModelCalls === p.disableNonEssentialModelCalls
        && settings.autoCompactWindow === p.autoCompactWindow;
      if (same) return name;
    }
    return 'custom';
  }, [settings]);

  const presetLabel = (name: Exclude<TokenSaverPreset, 'custom'>): string => ({
    off: t('panel.options.tokenSaver.presetOff', { defaultValue: 'Off' }),
    balanced: t('panel.options.tokenSaver.presetBalanced', { defaultValue: 'Balanced' }),
    saver: t('panel.options.tokenSaver.presetSaver', { defaultValue: 'Saver' }),
  }[name]);

  const fieldLabel = (key: NumericTokenSaverKey): string => ({
    bashMaxOutputChars: t('panel.options.tokenSaver.bashMaxOutputChars', { defaultValue: 'Max characters of shell output kept in context' }),
    mcpMaxOutputTokens: t('panel.options.tokenSaver.mcpMaxOutputTokens', { defaultValue: 'Max tokens of MCP tool output' }),
    maxOutputTokens: t('panel.options.tokenSaver.maxOutputTokens', { defaultValue: 'Max tokens the model writes per turn' }),
    maxThinkingTokens: t('panel.options.tokenSaver.maxThinkingTokens', { defaultValue: 'Max tokens spent on thinking' }),
    autoCompactPct: t('panel.options.tokenSaver.autoCompactPct', { defaultValue: 'Compact when the window is this full (%)' }),
    maxConcurrentAgents: t('panel.options.tokenSaver.maxConcurrentAgents', { defaultValue: 'Sessions allowed to run at the same time' }),
    spawnStaggerMs: t('panel.options.tokenSaver.spawnStaggerMs', { defaultValue: 'Gap between starting new sessions (ms)' }),
    sessionTurnBudget: t('panel.options.tokenSaver.sessionTurnBudget', { defaultValue: 'Compact a session after this many turns' }),
  }[key]);

  const fieldDesc = (key: NumericTokenSaverKey): string => ({
    bashMaxOutputChars: t('panel.options.tokenSaver.bashMaxOutputCharsDesc', {
      defaultValue: 'The single biggest source of context growth. Output that lands once is re-read on every later turn of that session, so cutting it here cuts it for the whole session. 0 leaves the CLI default (30,000).',
    }),
    mcpMaxOutputTokens: t('panel.options.tokenSaver.mcpMaxOutputTokensDesc', {
      defaultValue: 'Same idea for MCP tools. Nothing changes for agents with no MCP server attached. 0 leaves the CLI default.',
    }),
    maxOutputTokens: t('panel.options.tokenSaver.maxOutputTokensDesc', {
      defaultValue: 'Written tokens cost about five times what read tokens do, and everything written also stays in context. Set too low, answers get cut mid-sentence and you pay again to redo them. 0 leaves the model default.',
    }),
    maxThinkingTokens: t('panel.options.tokenSaver.maxThinkingTokensDesc', {
      defaultValue: 'Caps the length of extended thinking. Separate from turning thinking on or off, and from the effort level. 0 leaves the model default.',
    }),
    autoCompactPct: t('panel.options.tokenSaver.autoCompactPctDesc', {
      defaultValue: 'Folds the conversation earlier than the default. Only lower values take effect. Compacting is itself a large request, so folding too often costs more than it saves. 0 leaves the CLI default.',
    }),
    maxConcurrentAgents: t('panel.options.tokenSaver.maxConcurrentAgentsDesc', {
      defaultValue: 'Sixteen sessions running at once cost sixteen times as much at once. Commands over the limit are never dropped — they wait in their queue and go out as soon as a slot frees. Terminals you type in yourself are not counted. 0 means no limit.',
    }),
    spawnStaggerMs: t('panel.options.tokenSaver.spawnStaggerMsDesc', {
      defaultValue: 'Sessions started at the same instant cannot reuse each other\'s cached prefix, so each writes its own from scratch. A short gap lets the later ones read the cache instead at a tenth of the price. Only applies to brand-new sessions. 0 means no gap.',
    }),
    sessionTurnBudget: t('panel.options.tokenSaver.sessionTurnBudgetDesc', {
      defaultValue: 'A long session re-reads its whole history every turn, so the cost of leaving one running grows with the square of its length. This folds it once the turn count is reached. It never starts a new session — your conversation is kept. 0 means no limit.',
    }),
  }[key]);

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.tokenSaver.title', { defaultValue: 'Token saving' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.tokenSaver.intro', {
          defaultValue: 'Almost all of what you pay for is re-reading: measured over five hours, 96.5% of input tokens were the conversation being sent again on the next turn. So the two things worth controlling are how much lands in context per turn, and how many turns it gets re-read across. Every setting here is one of those two, and 0 always means that one is off.',
        })}
      </p>

      {/* 프리셋 — 값을 채우는 손. 고른다고 저장되지 않는다(아래 저장 버튼과 같은 규약). */}
      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <span className="text-xs text-gray-200">
          {t('panel.options.tokenSaver.preset', { defaultValue: 'Preset' })}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((name) => (
            <button
              key={name}
              type="button"
              disabled={busy !== null}
              onClick={() => applyPreset(name)}
              className={`rounded border px-2.5 py-1 text-xs disabled:opacity-40 ${
                currentPreset === name
                  ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                  : 'border-gray-700 text-gray-300 hover:bg-white/[0.04]'}`}
            >
              {presetLabel(name)}
            </button>
          ))}
          {currentPreset === 'custom' && (
            <span className="text-[12px] text-gray-400">
              {t('panel.options.tokenSaver.presetCustom', { defaultValue: 'Custom' })}
            </span>
          )}
        </div>
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.tokenSaver.presetDesc', {
            defaultValue: 'Presets only fill in the fields below — nothing is applied until you save. Off is byte-for-byte the behaviour you had before this screen existed.',
          })}
        </p>
      </div>

      {/* (Q) 압축 창 — 실측이 가리킨 단일 최대 지렛대라 숫자 칸들보다 앞에 둔다. */}
      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="text-xs text-gray-200">
          {t('panel.options.tokenSaver.autoCompactWindow', { defaultValue: 'Fold the conversation once it reaches' })}
        </label>
        <select
          value={settings.autoCompactWindow}
          disabled={busy !== null}
          onChange={(e) => patch({ autoCompactWindow: e.target.value })}
          className="w-48 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed"
        >
          <option value="">{t('panel.options.tokenSaver.autoCompactWindowOff', { defaultValue: 'Leave as configured' })}</option>
          {AVAILABLE_AUTOCOMPACT_VALUES
            .filter((v) => v && v !== 'off' && v !== 'auto')
            .map((v) => <option key={v} value={v}>{`${Number(v) / 1000}k`}</option>)}
        </select>
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.tokenSaver.autoCompactWindowDesc', {
            defaultValue: 'The largest single lever here. Measured over three days, sessions sat at a median of 186k tokens and everything above 200k accounted for 62% of all input — every turn re-reads that. Lowering the window from 400k to 200k cut input by 27%, and 100k by 59%, for the same work. It only ever tightens: an agent or a default that is already lower wins. Folding is itself a large request, so the lowest setting is not automatically the cheapest.',
          })}
        </p>
      </div>

      {NUMERIC_ORDER.map((key) => (
        <div key={key} className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
          <label className="text-xs text-gray-200">{fieldLabel(key)}</label>
          <NumberStepper
            value={settings[key]}
            onChange={(n) => patch({ [key]: n } as Partial<TokenSaverSettings>)}
            min={TOKEN_SAVER_LIMITS[key].min}
            max={TOKEN_SAVER_LIMITS[key].max}
            step={TOKEN_SAVER_LIMITS[key].step}
            disabled={busy !== null}
            widthClassName="w-24"
            ariaLabel={fieldLabel(key)}
          />
          <p className="text-[12px] leading-snug text-gray-500">{fieldDesc(key)}</p>
        </div>
      ))}

      <label
        className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
          busy !== null ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
      >
        <input
          type="checkbox"
          checked={settings.disableNonEssentialModelCalls}
          disabled={busy !== null}
          onChange={(e) => patch({ disableNonEssentialModelCalls: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.tokenSaver.disableNonEssential', { defaultValue: 'Skip background model calls for titles and summaries' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.tokenSaver.disableNonEssentialDesc', {
              defaultValue: 'These are small extra calls the CLI makes for conveniences. Session tab names here are derived from your first prompt without calling a model, so turning this on costs you almost nothing visible.',
            })}
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.tokenSaver.loadError', { defaultValue: 'Could not read the current setting.' })
            : t('panel.options.tokenSaver.saveError', { defaultValue: 'Could not save. Nothing was changed.' })}
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
          onClick={() => setSettings(DEFAULT_TOKEN_SAVER_SETTINGS)}
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
