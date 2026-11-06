import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LOCAL_KEEP_LOADED_CHOICES, LOCAL_MODEL_IDLE_UNLOAD_MS, LOCAL_RELAY_DEFAULT_MAX_ROUNDS, LOCAL_RELAY_MAX_ROUNDS_LIMIT,
  LOCAL_RELAY_VERIFY_COMMAND_MAX, LOCAL_TIDY_AT_CHOICES,
  type LocalAssistOptions, type LocalKvCacheType, type LocalMoeOffload, type LocalTidyMethod, type LocalToolOutputCap,
} from '@vibisual/shared';
import { ChoiceChips, SectionTitle, ToggleRow } from './LocalAssistControls.js';

interface Props {
  assist: LocalAssistOptions;
  onPatch: (patch: Partial<LocalAssistOptions>) => void;
  disabled: boolean;
}

/** §5.19 (J) ② — 엔진·컨텍스트·진행 세 묶음. 칸 하나를 바꾸면 그 칸만 얹어 저장한다(프리셋 이름은 custom). */
export function LocalAssistOptionGroups({ assist, onPatch, disabled }: Props): React.JSX.Element {
  const { t } = useTranslation();
  // 글자 칸은 칠 때마다 저장하지 않는다 — 손을 떼면(blur) 한 번.
  const [verify, setVerify] = useState(assist.relayVerifyCommand ?? '');
  const [rounds, setRounds] = useState(String(assist.relayMaxRounds ?? ''));
  useEffect(() => { setVerify(assist.relayVerifyCommand ?? ''); }, [assist.relayVerifyCommand]);
  useEffect(() => { setRounds(String(assist.relayMaxRounds ?? '')); }, [assist.relayMaxRounds]);

  const kv: LocalKvCacheType = assist.kvCache ?? 'f16';
  const moe: LocalMoeOffload = assist.moeOffload ?? 'auto';
  const tidyAt = assist.tidyAt ?? 0;
  const tidyMethod: LocalTidyMethod = assist.tidyMethod ?? 'mask';
  const cap: LocalToolOutputCap = assist.toolOutputCap ?? 'normal';
  const keepMinutes = assist.keepLoadedMinutes ?? LOCAL_MODEL_IDLE_UNLOAD_MS / 60_000;

  return (
    <div className="flex flex-col gap-2.5">
      <SectionTitle>{t('ide.localAssist.section.engine')}</SectionTitle>
      <span className="text-[12px] leading-relaxed text-gray-500">{t('ide.localAssist.engine.restartHint')}</span>
      <ChoiceChips<LocalKvCacheType>
        label={t('ide.localAssist.kvCache.label')} hint={t('ide.localAssist.kvCache.hint')} value={kv} disabled={disabled}
        options={[{ value: 'f16', label: t('ide.localAssist.kvCache.f16') }, { value: 'q8_0', label: 'q8_0' }, { value: 'q4_0', label: 'q4_0' }]}
        onChange={(v) => onPatch({ kvCache: v === 'f16' ? undefined : v })}
      />
      <ChoiceChips<LocalMoeOffload>
        label={t('ide.localAssist.moe.label')} hint={t('ide.localAssist.moe.hint')} value={moe} disabled={disabled}
        options={[{ value: 'auto', label: t('ide.localAssist.moe.auto') }, { value: 'cpu', label: t('ide.localAssist.moe.cpu') }]}
        onChange={(v) => onPatch({ moeOffload: v === 'auto' ? undefined : v })}
      />
      <ToggleRow
        label={t('ide.localAssist.lowSpec.label')} hint={t('ide.localAssist.lowSpec.hint')} checked={assist.lowSpecSafe === true}
        disabled={disabled} onChange={(on) => onPatch({ lowSpecSafe: on })}
      />

      <SectionTitle>{t('ide.localAssist.section.context')}</SectionTitle>
      <ChoiceChips<number>
        label={t('ide.localAssist.tidyAt.label')} hint={t('ide.localAssist.tidyAt.hint')} value={tidyAt} disabled={disabled}
        options={[{ value: 0, label: t('ide.localAssist.tidyAt.off') }, ...LOCAL_TIDY_AT_CHOICES.map((p) => ({ value: p, label: t('ide.localAssist.tidyAt.value', { percent: p }) }))]}
        onChange={(v) => onPatch({ tidyAt: v > 0 ? v : undefined })}
      />
      {tidyAt > 0 && (
        <ChoiceChips<LocalTidyMethod>
          label={t('ide.localAssist.tidyMethod.label')} hint={t(`ide.localAssist.tidyMethod.hint.${tidyMethod}`)} value={tidyMethod} disabled={disabled}
          options={(['mask', 'summarize', 'handoff', 'ask'] as const).map((m) => ({ value: m, label: t(`ide.localAssist.tidyMethod.${m}`) }))}
          onChange={(v) => onPatch({ tidyMethod: v })}
        />
      )}
      <ChoiceChips<LocalToolOutputCap>
        label={t('ide.localAssist.outputCap.label')} hint={t('ide.localAssist.outputCap.hint')} value={cap} disabled={disabled}
        options={(['short', 'normal', 'long'] as const).map((c) => ({ value: c, label: t(`ide.localAssist.outputCap.${c}`) }))}
        onChange={(v) => onPatch({ toolOutputCap: v === 'normal' ? undefined : v })}
      />
      <ToggleRow
        label={t('ide.localAssist.keepFull.label')} hint={t('ide.localAssist.keepFull.hint')} checked={assist.keepFullOutput === true}
        disabled={disabled} onChange={(on) => onPatch({ keepFullOutput: on })}
      />

      <SectionTitle>{t('ide.localAssist.section.progress')}</SectionTitle>
      <ToggleRow
        label={t('ide.localAssist.planFirst.label')} hint={t('ide.localAssist.planFirst.hint')} checked={assist.planFirst === true}
        disabled={disabled} onChange={(on) => onPatch({ planFirst: on })}
      />
      <ToggleRow
        label={t('ide.localAssist.relay.label')} hint={t('ide.localAssist.relay.hint')} checked={assist.relay === true}
        disabled={disabled} onChange={(on) => onPatch({ relay: on })}
      />
      {assist.relay && (
        <div className="flex flex-col gap-1.5 border-l border-gray-700 pl-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-gray-400">{t('ide.localAssist.relay.verify')}</span>
            <input
              type="text" value={verify} maxLength={LOCAL_RELAY_VERIFY_COMMAND_MAX} disabled={disabled}
              placeholder={t('ide.localAssist.relay.verifyPlaceholder')}
              onChange={(e) => setVerify(e.target.value)}
              onBlur={() => { if (verify.trim() !== (assist.relayVerifyCommand ?? '')) onPatch({ relayVerifyCommand: verify.trim() || undefined }); }}
              className="w-full min-w-0 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 outline-none focus:border-teal-500/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-gray-400">{t('ide.localAssist.relay.maxRounds')}</span>
            <input
              type="number" min={1} max={LOCAL_RELAY_MAX_ROUNDS_LIMIT} value={rounds} disabled={disabled}
              placeholder={String(LOCAL_RELAY_DEFAULT_MAX_ROUNDS)}
              onChange={(e) => setRounds(e.target.value)}
              onBlur={() => {
                const n = Number(rounds);
                const next = rounds.trim() && Number.isFinite(n) && n >= 1 ? Math.min(LOCAL_RELAY_MAX_ROUNDS_LIMIT, Math.floor(n)) : undefined;
                if (next !== assist.relayMaxRounds) onPatch({ relayMaxRounds: next });
              }}
              className="w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 outline-none focus:border-teal-500/60"
            />
          </label>
        </div>
      )}
      <ToggleRow
        label={t('ide.localAssist.resume.label')} hint={t('ide.localAssist.resume.hint')} checked={assist.resume === true}
        disabled={disabled} onChange={(on) => onPatch({ resume: on })}
      />
      <ChoiceChips<number>
        label={t('ide.localAssist.keepLoaded.label')} hint={t('ide.localAssist.keepLoaded.hint')} value={keepMinutes} disabled={disabled}
        options={LOCAL_KEEP_LOADED_CHOICES.map((m) => ({ value: m, label: t('ide.localAssist.keepLoaded.value', { minutes: m }) }))}
        onChange={(v) => onPatch({ keepLoadedMinutes: v * 60_000 === LOCAL_MODEL_IDLE_UNLOAD_MS ? undefined : v })}
      />
    </div>
  );
}
