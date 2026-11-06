import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLocalAssistPreset, patchLocalAssist, type LocalAssistOptions, type LocalAssistPreset } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';
import { LocalAssistPlanBox } from './LocalAssistPlanBox.js';
import { LocalAssistOptionGroups } from './LocalAssistOptionGroups.js';
import { currentPresetOf, PRESET_ORDER } from './localAssistViewModel.js';

interface Props {
  agentId: string;
}

const NO_OPTIONS: LocalAssistOptions = {};

/**
 * §5.19 (J) — All Model 끝까지 돕기. 프리셋 칩 → 그 탭의 계획 → 엔진·컨텍스트·진행 옵션.
 * 아무것도 켜지 않으면 종전 동작 그대로다(이 화면은 고르는 자리일 뿐 강제하지 않는다). 저장은 `provider.assist` 한 칸.
 */
export const IDELocalAssistView = memo(function IDELocalAssistView({ agentId }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const assist = useGraphStore((s) => s.agentConfigs[agentId]?.provider?.assist) ?? NO_OPTIONS;
  const setLocalAssist = useGraphStore((s) => s.setLocalAssist);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = useCallback(async (next: LocalAssistOptions) => {
    setSaving(true);
    const ok = await setLocalAssist(agentId, next);
    setSaving(false);
    setFailed(!ok);
  }, [agentId, setLocalAssist]);

  const onPreset = useCallback((p: Exclude<LocalAssistPreset, 'custom'>) => { void save(applyLocalAssistPreset(p)); }, [save]);
  const onPatch = useCallback((patch: Partial<LocalAssistOptions>) => { void save(patchLocalAssist(assist, patch)); }, [assist, save]);

  const preset = currentPresetOf(assist);
  const planningOn = assist.planFirst === true || assist.relay === true;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-1.5 pt-2">
        <span title={t('ide.localAssist.title')} className="min-w-0 flex-1 basis-20 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500">
          {t('ide.localAssist.title')}
        </span>
        {saving && <span className="ml-auto flex-shrink-0 text-[12px] text-gray-500">{t('ide.localAssist.saving')}</span>}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          <p className="break-words px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.localAssist.intro')}</p>

          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gray-300">{t('ide.localAssist.preset.label')}</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('ide.localAssist.preset.label')}>
              {PRESET_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={saving}
                  aria-pressed={preset === p}
                  title={t(`ide.localAssist.preset.hint.${p}`)}
                  onClick={() => onPreset(p)}
                  className={`rounded border px-2 py-0.5 text-[12px] font-semibold disabled:opacity-50 pointer-coarse:py-1.5 ${
                    preset === p ? 'border-teal-400/70 bg-teal-500/15 text-teal-200' : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {t(`ide.localAssist.preset.${p}`)}
                </button>
              ))}
            </div>
            <span className="text-[12px] leading-relaxed text-gray-500">
              {preset === 'custom' ? t('ide.localAssist.preset.custom') : t(`ide.localAssist.preset.hint.${preset}`)}
            </span>
          </div>

          <LocalAssistPlanBox agentId={agentId} subAgentId={activeSessionId ?? null} planningOn={planningOn} />

          <LocalAssistOptionGroups assist={assist} onPatch={onPatch} disabled={saving} />

          {failed && <p className="text-[12px] text-rose-300">{t('ide.localAssist.saveFailed')}</p>}
        </div>
      </ScrollFade>
    </div>
  );
});
