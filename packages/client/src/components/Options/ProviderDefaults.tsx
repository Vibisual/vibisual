import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { providerForEngine, resolveAgentDefaults, resolveCodexPermission, type AgentConfig, type AgentEngineKind, AVAILABLE_PERMISSION_MODES, canCodexPromptForPermission } from '@vibisual/shared';
import { CodexAdvancedSettings } from '../Codex/CodexAdvancedSettings.js';
import { CodexToolPermissions } from '../Panel/CodexToolPermissions.js';
import { providerDefaultsPatch } from './providerDefaultsDraft.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { pickDefaultCodexModel } from '../Codex/codexModelEntry.js';
import { codexInheritedOptionFor, codexInheritedValueText } from '../Codex/codexInheritedLabel.js';
import { useCodexEffectiveConfig } from '../Codex/useCodexEffectiveConfig.js';
import { pickDefaultModel } from '../LocalModel/localModelEntry.js';
import { localContextPlaceholder, localTemperaturePlaceholder, useLocalSampling } from '../LocalModel/localEffective.js';

export interface ProviderDefaultsHandle { save: () => Promise<boolean> }
export const ProviderDefaults = forwardRef<ProviderDefaultsHandle, { engine: AgentEngineKind; projectPath?: string; onDirtyChange?: (dirty: boolean) => void }>(function ProviderDefaults({ engine, projectPath, onDirtyChange }, ref): React.JSX.Element {
  const { t } = useTranslation();
  const defaults = useGraphStore(s => s.userDefaults);
  const apply = useGraphStore(s => s.applyUserDefaults);
  const codexModels = useGraphStore(s => s.codexModels?.models);
  const localModels = useGraphStore(s => s.localLlm?.models);
  const [draft, setDraft] = useState<Partial<AgentConfig>>(() => resolveAgentDefaults(defaults, engine, projectPath));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dirty) setDraft(resolveAgentDefaults(defaults, engine, projectPath)); }, [defaults, engine, projectPath, dirty]);
  const provider = draft.provider ?? providerForEngine(engine);
  const updateProvider = (patch: object): void => { setDirty(true); setStatus(''); setDraft(d => ({ ...d, provider: { ...(d.provider ?? providerForEngine(engine))!, ...patch } })); };
  const updateConfig = (patch: Partial<AgentConfig>): void => { setDirty(true); setStatus(''); setDraft(d => ({ ...d, ...patch })); };
  const refreshModels = useGraphStore(s => s.refreshCodexModels);
  useEffect(() => { if (engine === 'codex') void refreshModels(); }, [engine, refreshModels]);
  // §5.25 (G-2) — 빈 선택지에 "기본값" 대신 **지금 새 에이전트에 실제로 물릴 값**을 적는다.
  //   모델: 비워 두면 버블을 처음 열 때 코덱스는 목록 첫 모델(`resolveCodexEntry`), 로컬은 가장 최근에 받은 모델
  //   (`resolveLocalEntry`)에 매인다. 목록은 스냅샷으로 오므로 여기서 비어 있으면 서버에도 없다 — 그때는 설치 창에서 고른다.
  //   나머지 칸은 에이전트 설정 창과 같은 판정·같은 문구다(새 에이전트라 도구 위임 연결은 없다).
  const inheritedProvider = projectPath ? resolveAgentDefaults(defaults, engine).provider : undefined;
  const codexBound = codexModels?.find(m => m.slug === (provider?.modelId || inheritedProvider?.modelId)) ?? (codexModels ? pickDefaultCodexModel(codexModels) ?? undefined : undefined);
  const localBoundId = provider?.modelId && localModels?.some(m => m.id === provider.modelId) ? provider.modelId : pickDefaultModel(localModels ?? [])?.id ?? '';
  const codexConfig = useCodexEffectiveConfig(engine === 'codex', undefined, projectPath ?? '');
  const localSampling = useLocalSampling(engine === 'local' ? localBoundId : '');
  const codexInherited = (field: 'reasoningEffort' | 'webSearch' | 'modelVerbosity' | 'networkAccess'): { label: string; description: string } => inheritedProvider?.[field] !== undefined
    ? { label: t('panel.agentConfig.effective.resolved', { value: codexInheritedValueText(t, field, String(inheritedProvider[field])), source: t('providers.globalScope') }), description: t('providers.projectSettingsHint') }
    : codexInheritedOptionFor(t, field, { config: codexConfig, model: codexBound, modelsLoaded: true, sandbox: resolveCodexPermission(draft.permissionMode).sandbox });
  const modelEmpty = ((): { label: string; description: string } => {
    if (inheritedProvider?.modelId) return { label: `${inheritedProvider.modelName || inheritedProvider.modelId} (${t('providers.globalScope')})`, description: t('providers.projectSettingsHint') };
    const first = engine === 'codex' ? pickDefaultCodexModel(codexModels ?? []) : localModels?.find(m => m.id === localBoundId);
    if (!first) return { label: t('providers.modelChosenOnOpen'), description: '' };
    return {
      label: t('panel.agentConfig.effective.resolved', { value: 'slug' in first ? first.displayName || first.slug : first.name, source: t(engine === 'codex' ? 'providers.modelSource.codexFirst' : 'providers.modelSource.localLatest') }),
      description: t(engine === 'codex' ? 'providers.modelSourceTip.codexFirst' : 'providers.modelSourceTip.localLatest'),
    };
  })();
  const tempHint = localTemperaturePlaceholder(t, localSampling);
  const contextHint = localContextPlaceholder(t, localSampling);
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy(true); setStatus('');
    try {
      const patch = providerDefaultsPatch(draft, defaults, engine, projectPath);
      const response = await fetch('/api/user-defaults', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('save');
      apply(data.userDefaults); setDirty(false); setStatus('saved'); return true;
    } catch { setStatus('saveFailed'); return false; } finally { setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ save }));
  const cls = 'w-full rounded border border-gray-700 bg-gray-950 p-2 text-xs';
  return <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
    <p className="text-xs leading-relaxed text-gray-400">{t(projectPath ? 'providers.projectSettingsHint' : 'providers.globalSettingsHint')}</p>
    {engine === 'codex' && <div className="grid grid-cols-2 gap-3">{([
      ['webSearch', ['disabled', 'cached', 'live']], ['modelVerbosity', ['low', 'medium', 'high']],
    ] as const).map(([field, values]) => <label key={field} className="text-xs text-gray-300">{t(`providers.${field}`)}<select className={cls} value={provider?.[field] ?? ''} onChange={e => updateProvider({ [field]: e.target.value || undefined })}><option value="" title={codexInherited(field).description}>{codexInherited(field).label}</option>{values.map(value => <option key={value} value={value}>{codexInheritedValueText(t, field, value)}</option>)}</select></label>)}</div>}
    <label className="text-xs text-gray-300">{t('providers.model')}
      {engine === 'claude' ? <input className={cls} value={draft.model ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, model: e.target.value })); }} /> : <select className={cls} value={provider?.modelId ?? ''} onChange={e => updateProvider({ modelId: e.target.value, ...(engine === 'codex' ? { reasoningEffort: undefined } : {}), modelName: engine === 'codex' ? codexModels?.find(m => m.slug === e.target.value)?.displayName : localModels?.find(m => m.id === e.target.value)?.name })}>
        <option value="" title={modelEmpty.description}>{modelEmpty.label}</option>
        {provider?.modelId && !(engine === 'codex' ? codexModels?.some(m => m.slug === provider.modelId) : localModels?.some(m => m.id === provider.modelId)) && <option value={provider.modelId}>{provider.modelId}</option>}
        {engine === 'codex' ? codexModels?.map(m => <option key={m.slug} value={m.slug}>{m.displayName || m.slug}</option>) : localModels?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </label>
    {engine === 'codex' && <label className="text-xs text-gray-300">{t('providers.effort')}<select className={cls} value={provider?.reasoningEffort ?? ''} onChange={e => updateProvider({ reasoningEffort: e.target.value || undefined })}><option value="" title={codexInherited('reasoningEffort').description}>{codexInherited('reasoningEffort').label}</option>{provider?.reasoningEffort && !codexBound?.reasoningLevels.includes(provider.reasoningEffort) && <option value={provider.reasoningEffort}>{provider.reasoningEffort}</option>}{codexBound?.reasoningLevels.map(e => <option key={e} value={e}>{e}</option>)}</select></label>}
    {engine === 'codex' && <>
      <button type="button" onClick={() => void refreshModels()} className="self-start text-xs text-blue-400">{t('panel.agentConfig.codex.reloadModels')}</button>
      <label className="text-xs text-gray-300">{t('panel.agentConfig.permissionMode.label')}
        <select className={cls} value={draft.permissionMode ?? 'default'} onChange={e => updateConfig({ permissionMode: e.target.value })}>
          {AVAILABLE_PERMISSION_MODES.map(mode => <option key={mode} value={mode}>{t(`panel.agentConfig.codex.permission.${mode}`)}</option>)}
        </select>
        <span className="mt-1 block text-[12px] text-gray-500">{t('panel.agentConfig.codex.permissionTip')}</span>
      </label>
      <label className="text-xs text-gray-300">{t('panel.agentConfig.codex.network.label')}
        <select className={cls} disabled={resolveCodexPermission(draft.permissionMode).sandbox !== 'workspace-write'} value={provider?.networkAccess === undefined ? '' : String(provider.networkAccess)} onChange={e => updateProvider({ networkAccess: e.target.value === '' ? undefined : e.target.value === 'true' })}>
          <option value="" title={codexInherited('networkAccess').description}>{codexInherited('networkAccess').label}</option>
          {['false', 'true'].map(value => <option key={value} value={value}>{codexInheritedValueText(t, 'networkAccess', value)}</option>)}
        </select>
        <span className="mt-1 block text-[12px] text-gray-500">{t('panel.agentConfig.codex.network.tip')}</span>
      </label>
      {(canCodexPromptForPermission(draft.permissionMode) || (draft.permissionMode !== 'dontAsk' && Object.values(provider?.codexTools ?? {}).includes('ask'))) && <label className="text-xs text-gray-300">{t('panel.agentConfig.permissionTimeoutPolicy.label')}
        <select className={cls} value={draft.permissionTimeoutPolicy ?? 'allow'} onChange={e => updateConfig({ permissionTimeoutPolicy: e.target.value as 'allow' | 'deny' })}>
          {['allow', 'deny'].map(value => <option key={value} value={value}>{t(`panel.agentConfig.permissionTimeoutPolicy.${value}`)}</option>)}
        </select>
      </label>}
      <CodexAdvancedSettings value={provider ?? {}} onChange={updateProvider} />
      <fieldset className="rounded border border-gray-700/60 p-3"><legend className="px-1 text-xs font-semibold text-gray-300">{t('providers.codexTools')}</legend>
        <CodexToolPermissions value={provider?.codexTools ?? {}} onChange={codexTools => updateProvider({ codexTools })} />
      </fieldset>
    </>}
    {engine === 'local' && <><label className="text-xs text-gray-300">{t('providers.context')}<input type="number" min={512} step={512} className={cls} value={provider?.contextSize ?? ''} placeholder={contextHint.text} title={contextHint.title} onChange={e => updateProvider({ contextSize: e.target.value ? Number(e.target.value) : undefined })} /></label><label className="text-xs text-gray-300">{t('providers.temperature')}<input type="number" min={0} max={2} step={0.1} className={cls} value={provider?.temperature ?? ''} placeholder={tempHint.text} title={tempHint.title} onChange={e => updateProvider({ temperature: e.target.value ? Number(e.target.value) : undefined })} /></label></>}
    <label className="text-xs text-gray-300">{t('providers.rules')}<textarea className={cls} rows={4} value={draft.rules ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, rules: e.target.value })); }} /></label>
    {!ref && <div className="flex items-center gap-3"><button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded bg-blue-600 px-4 py-2 text-xs disabled:opacity-40">{t('providers.save')}</button>{status && <span role="status" className={`text-xs ${status === 'saved' ? 'text-green-400' : 'text-red-400'}`}>{t(`providers.${status}`)}</span>}</div>}
  </fieldset>;
});
