import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { providerForEngine, resolveAgentDefaults, type AgentConfig, type AgentEngineKind, type UserDefaultsPatch } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProviderTabs } from '../Engine/ProviderTabs.js';

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
    ] as const).map(([field, values]) => <label key={field} className="text-xs text-gray-300">{t(`providers.${field}`)}<select className={cls} value={provider?.[field] ?? ''} onChange={e => updateProvider({ [field]: e.target.value || undefined })}><option value="">{t('providers.default')}</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>}
    <label className="text-xs text-gray-300">{t('providers.model')}
      {engine === 'claude' ? <input className={cls} value={draft.model ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, model: e.target.value })); }} /> : <select className={cls} value={provider?.modelId ?? ''} onChange={e => updateProvider({ modelId: e.target.value, modelName: engine === 'codex' ? codexModels?.find(m => m.slug === e.target.value)?.displayName : localModels?.find(m => m.id === e.target.value)?.name })}>
        <option value="">{t('providers.default')}</option>
        {provider?.modelId && !(engine === 'codex' ? codexModels?.some(m => m.slug === provider.modelId) : localModels?.some(m => m.id === provider.modelId)) && <option value={provider.modelId}>{provider.modelId}</option>}
        {engine === 'codex' ? codexModels?.map(m => <option key={m.slug} value={m.slug}>{m.displayName || m.slug}</option>) : localModels?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </label>
    {engine === 'codex' && <label className="text-xs text-gray-300">{t('providers.effort')}<select className={cls} value={provider?.reasoningEffort ?? ''} onChange={e => updateProvider({ reasoningEffort: e.target.value || undefined })}><option value="">{t('providers.default')}</option>{codexModels?.find(m => m.slug === provider?.modelId)?.reasoningLevels.map(e => <option key={e} value={e}>{e}</option>)}</select></label>}
    {engine === 'local' && <><label className="text-xs text-gray-300">{t('providers.context')}<input type="number" min={512} step={512} className={cls} value={provider?.contextSize ?? ''} onChange={e => updateProvider({ contextSize: e.target.value ? Number(e.target.value) : undefined })} /></label><label className="text-xs text-gray-300">{t('providers.temperature')}<input type="number" min={0} max={2} step={0.1} className={cls} value={provider?.temperature ?? ''} onChange={e => updateProvider({ temperature: e.target.value ? Number(e.target.value) : undefined })} /></label></>}
    <label className="text-xs text-gray-300">{t('providers.rules')}<textarea className={cls} rows={4} value={draft.rules ?? ''} onChange={e => { setDirty(true); setDraft(d => ({ ...d, rules: e.target.value })); }} /></label>
    <div className="flex items-center gap-3"><button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded bg-blue-600 px-4 py-2 text-xs disabled:opacity-40">{t('providers.save')}</button>{status && <span role="status" className={`text-xs ${status === 'saved' ? 'text-green-400' : 'text-red-400'}`}>{t(`providers.${status}`)}</span>}</div>
  </div>;
}

export function ProjectProviderDefaults({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const main = useGraphStore(s => s.userDefaults?.engineChoice?.kind ?? 'claude');
  const projectPath = useGraphStore(s => s.activeProject ? s.projects[s.activeProject]?.path : undefined);
  const [engine, setEngine] = useState(main);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => setEngine(main), [main]);
  return <div><p className="mb-3 text-xs text-gray-400">{t(projectPath ? 'providers.projectHint' : 'providers.noProject')}</p><ProviderTabs value={engine} onChange={setEngine} disabled={dirty} />{projectPath && <ProviderDefaults key={`${projectPath}:${engine}`} engine={engine} projectPath={projectPath} onDirtyChange={setDirty} />}</div>;
}
