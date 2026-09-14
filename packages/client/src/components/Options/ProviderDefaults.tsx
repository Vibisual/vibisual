import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { providerForEngine, resolveAgentDefaults, resolveCodexPermission, type AgentConfig, type AgentEngineKind, type UserDefaultsPatch } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { pickDefaultCodexModel } from '../Codex/codexModelEntry.js';
import { codexInheritedOptionFor, codexInheritedValueText } from '../Codex/codexInheritedLabel.js';
import { useCodexEffectiveConfig } from '../Codex/useCodexEffectiveConfig.js';
import { pickDefaultModel } from '../LocalModel/localModelEntry.js';
import { localContextPlaceholder, localTemperaturePlaceholder, useLocalSampling } from '../LocalModel/localEffective.js';

export function ProviderDefaults({ engine, projectPath, onDirtyChange }: { engine: AgentEngineKind; projectPath?: string; onDirtyChange?: (dirty: boolean) => void }): React.JSX.Element {
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
  const updateProvider = (patch: object): void => { setDirty(true); setStatus(''); setDraft(d => ({ ...d, provider: { ...provider!, ...patch } })); };
  // §5.25 (G-2) — 빈 선택지에 "기본값" 대신 **지금 새 에이전트에 실제로 물릴 값**을 적는다.
  //   모델: 비워 두면 버블을 처음 열 때 코덱스는 목록 첫 모델(`resolveCodexEntry`), 로컬은 가장 최근에 받은 모델
  //   (`resolveLocalEntry`)에 매인다. 목록은 스냅샷으로 오므로 여기서 비어 있으면 서버에도 없다 — 그때는 설치 창에서 고른다.
  //   나머지 칸은 에이전트 설정 창과 같은 판정·같은 문구다(새 에이전트라 도구 위임 연결은 없다).
  const codexBound = codexModels?.find(m => m.slug === provider?.modelId) ?? (codexModels ? pickDefaultCodexModel(codexModels) ?? undefined : undefined);
  const localBoundId = provider?.modelId && localModels?.some(m => m.id === provider.modelId) ? provider.modelId : pickDefaultModel(localModels ?? [])?.id ?? '';
  const codexConfig = useCodexEffectiveConfig(engine === 'codex');
  const localSampling = useLocalSampling(engine === 'local' ? localBoundId : '');
  const codexInherited = (field: 'reasoningEffort' | 'webSearch' | 'modelVerbosity'): { label: string; description: string } => codexInheritedOptionFor(t, field, { config: codexConfig, model: codexBound, modelsLoaded: true, sandbox: resolveCodexPermission(draft.permissionMode).sandbox });
  const modelEmpty = ((): { label: string; description: string } => {
    const first = engine === 'codex' ? codexBound : localModels?.find(m => m.id === localBoundId);
    if (!first) return { label: t('providers.modelChosenOnOpen'), description: '' };
    return {
      label: t('panel.agentConfig.effective.resolved', { value: 'slug' in first ? first.displayName || first.slug : first.name, source: t(engine === 'codex' ? 'providers.modelSource.codexFirst' : 'providers.modelSource.localLatest') }),
      description: t(engine === 'codex' ? 'providers.modelSourceTip.codexFirst' : 'providers.modelSourceTip.localLatest'),
    };
  })();
  const tempHint = localTemperaturePlaceholder(t, localSampling);
  const contextHint = localContextPlaceholder(t, localSampling);
  const save = async (): Promise<void> => {
    setBusy(true); setStatus('');
    try {
      const patch: UserDefaultsPatch = projectPath ? { projectEngineConfigs: { [projectPath]: { [engine]: draft } } } : { engineConfigs: { [engine]: draft } };
      const response = await fetch('/api/user-defaults', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('save');
      apply(data.userDefaults); setDirty(false); setStatus('saved');
    } catch { setStatus('saveFailed'); } finally { setBusy(false); }
  };
  const cls = 'w-full rounded border border-gray-700 bg-gray-950 p-2 text-xs';
  return <div className="flex flex-col gap-4">
    {engine === 'codex' && <div className="grid grid-cols-2 gap-3">{([
      ['webSearch', ['disabled', 'cached', 'live']], ['modelVerbosity', ['low', 'medium', 'high']],
    ] as const).map(([field, values]) => <label key={field} className="text-xs text-gray-300">{t(`providers.${field}`)}<select className={cls} value={provider?.[field] ?? ''} onChange={e => updateProvider({ [field]: e.target.value || undefined })}><option value="" title={codexInherited(field).description}>{codexInherited(field).label}</option>{values.map(value => <option key={value} value={value}>{codexInheritedValueText(t, field, value)}</option>)}</select></label>)}</div>}
    <label className="text-xs text-gray-300">{t('providers.model')}
      {engine === 'claude' ? <input className={cls} value={draft.model ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, model: e.target.value })); }} /> : <select className={cls} value={provider?.modelId ?? ''} onChange={e => updateProvider({ modelId: e.target.value, modelName: engine === 'codex' ? codexModels?.find(m => m.slug === e.target.value)?.displayName : localModels?.find(m => m.id === e.target.value)?.name })}>
        <option value="" title={modelEmpty.description}>{modelEmpty.label}</option>
        {provider?.modelId && !(engine === 'codex' ? codexModels?.some(m => m.slug === provider.modelId) : localModels?.some(m => m.id === provider.modelId)) && <option value={provider.modelId}>{provider.modelId}</option>}
        {engine === 'codex' ? codexModels?.map(m => <option key={m.slug} value={m.slug}>{m.displayName || m.slug}</option>) : localModels?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </label>
    {engine === 'codex' && <label className="text-xs text-gray-300">{t('providers.effort')}<select className={cls} value={provider?.reasoningEffort ?? ''} onChange={e => updateProvider({ reasoningEffort: e.target.value || undefined })}><option value="" title={codexInherited('reasoningEffort').description}>{codexInherited('reasoningEffort').label}</option>{codexModels?.find(m => m.slug === provider?.modelId)?.reasoningLevels.map(e => <option key={e} value={e}>{e}</option>)}</select></label>}
    {engine === 'local' && <><label className="text-xs text-gray-300">{t('providers.context')}<input type="number" min={512} step={512} className={cls} value={provider?.contextSize ?? ''} placeholder={contextHint.text} title={contextHint.title} onChange={e => updateProvider({ contextSize: e.target.value ? Number(e.target.value) : undefined })} /></label><label className="text-xs text-gray-300">{t('providers.temperature')}<input type="number" min={0} max={2} step={0.1} className={cls} value={provider?.temperature ?? ''} placeholder={tempHint.text} title={tempHint.title} onChange={e => updateProvider({ temperature: e.target.value ? Number(e.target.value) : undefined })} /></label></>}
    <label className="text-xs text-gray-300">{t('providers.rules')}<textarea className={cls} rows={4} value={draft.rules ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, rules: e.target.value })); }} /></label>
    <div className="flex items-center gap-3"><button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded bg-blue-600 px-4 py-2 text-xs disabled:opacity-40">{t('providers.save')}</button>{status && <span role="status" className={`text-xs ${status === 'saved' ? 'text-green-400' : 'text-red-400'}`}>{t(`providers.${status}`)}</span>}</div>
  </div>;
}
