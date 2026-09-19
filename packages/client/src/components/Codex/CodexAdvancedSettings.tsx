import { useTranslation } from 'react-i18next';
import type { AgentProvider } from '@vibisual/shared';

export type CodexAdvancedDraft = Pick<AgentProvider, 'reasoningSummary' | 'personality' | 'serviceTier' | 'autoCompactTokenLimit'>;

/** Shared by project defaults and individual agents; all fields reach codex exec.
 * Keys: https://learn.chatgpt.com/docs/config-file/config-reference
 */
export function CodexAdvancedSettings({ value, onChange }: {
  value: CodexAdvancedDraft; onChange: (patch: CodexAdvancedDraft) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const cls = 'mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-xs text-gray-200';
  return <fieldset className="flex flex-col gap-3 rounded border border-gray-700/60 p-3">
    <legend className="px-1 text-xs font-semibold text-gray-300">{t('providers.codexAdvanced')}</legend>
    {([
      ['reasoningSummary', ['auto', 'concise', 'detailed', 'none']],
      ['personality', ['none', 'friendly', 'pragmatic']],
    ] as const).map(([field, choices]) => <label key={field} className="text-xs text-gray-300">
      {t(`providers.${field}`)}
      <select className={cls} value={value[field] ?? ''} onChange={e => onChange({ [field]: e.target.value || undefined })}>
        <option value="">{t('providers.inheritSetting')}</option>
        {choices.map(choice => <option key={choice} value={choice}>{t(`providers.codexValues.${choice}`)}</option>)}
      </select>
    </label>)}
    <p className="text-[12px] text-gray-500">{t('providers.personalityHint')}</p>
    <label className="text-xs text-gray-300">{t('providers.serviceTier')}
      <input className={cls} value={value.serviceTier ?? ''} placeholder={t('providers.inheritSetting')} onChange={e => onChange({ serviceTier: e.target.value.trim() || undefined })} />
      <span className="mt-1 block text-[12px] text-gray-500">{t('providers.serviceTierHint')}</span>
    </label>
    <label className="text-xs text-gray-300">{t('providers.autoCompactTokenLimit')}
      <input type="number" min={1} step={1} className={cls} value={value.autoCompactTokenLimit ?? ''} placeholder={t('providers.inheritSetting')}
        onChange={e => { const n = Number(e.target.value); onChange({ autoCompactTokenLimit: Number.isSafeInteger(n) && n > 0 ? n : undefined }); }} />
    </label>
  </fieldset>;
}
