import { useTranslation } from 'react-i18next';
import type { AgentEngineKind } from '@vibisual/shared';
import { EngineIcon } from './engineIcons.js';
export const ENGINES: AgentEngineKind[] = ['claude', 'codex', 'local'];
export function ProviderTabs({ value, onChange, disabled = false }: { value: AgentEngineKind; onChange: (engine: AgentEngineKind) => void; disabled?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return <div role="tablist" aria-label={t('providers.provider')} className="mb-4 flex gap-2">{ENGINES.map(engine => <button type="button" role="tab" aria-selected={engine === value} key={engine} disabled={disabled} onClick={() => onChange(engine)} className={`flex items-center gap-2 rounded border px-3 py-2 text-xs disabled:opacity-40 ${engine === value ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}><EngineIcon kind={engine} className="h-4 w-4" />{t(`providers.${engine}`)}</button>)}</div>;
}
