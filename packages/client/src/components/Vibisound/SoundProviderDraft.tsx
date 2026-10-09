import { useTranslation } from 'react-i18next';
import type { AudioProviderCapability, AudioProviderDraft } from '@vibisual/audio';

const CAPABILITIES: readonly AudioProviderCapability[] = ['generate', 'transcribe', 'separate', 'enhance'];
const PREFIX = 'panel.vibisound.workbench.connections';
const FIELD = 'w-full min-w-0 rounded border border-white/10 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50';

interface SoundProviderDraftProps {
  provider: AudioProviderDraft;
  disabled: boolean;
  onChange: (provider: AudioProviderDraft) => void;
  onRemove: () => void;
}

export function SoundProviderDraft({ provider, disabled, onChange, onRemove }: SoundProviderDraftProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <fieldset disabled={disabled} className="space-y-2 rounded border border-white/10 p-2.5 disabled:opacity-50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-amber-200/80">{t(`${PREFIX}.notConnected`)}</span>
        <button type="button" onClick={onRemove} className="text-xs text-gray-400 hover:text-rose-300">{t(`${PREFIX}.remove`)}</button>
      </div>
      <label className="block space-y-1 text-xs text-gray-400">
        <span>{t(`${PREFIX}.kind`)}</span>
        <select className={FIELD} value={provider.kind} onChange={(e) => onChange({ ...provider, kind: e.target.value === 'local' ? 'local' : 'api' })}>
          <option value="api">{t(`${PREFIX}.api`)}</option><option value="local">{t(`${PREFIX}.local`)}</option>
        </select>
      </label>
      <label className="block space-y-1 text-xs text-gray-400">
        <span>{t(`${PREFIX}.name`)}</span>
        <input className={FIELD} value={provider.name} maxLength={120} required onChange={(e) => onChange({ ...provider, name: e.target.value })} />
      </label>
      <label className="block space-y-1 text-xs text-gray-400">
        <span>{t(`${PREFIX}.endpoint`)}</span>
        <input className={FIELD} type="url" value={provider.endpoint} maxLength={2048} spellCheck={false} autoComplete="off"
          onChange={(e) => onChange({ ...provider, endpoint: e.target.value })} />
      </label>
      <label className="block space-y-1 text-xs text-gray-400">
        <span>{t(`${PREFIX}.model`)}</span>
        <input className={FIELD} value={provider.model} maxLength={200} spellCheck={false} autoComplete="off" onChange={(e) => onChange({ ...provider, model: e.target.value })} />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs text-gray-400">{t(`${PREFIX}.capabilitiesTitle`)}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className="flex items-center gap-1.5 text-xs text-gray-300">
              <input type="checkbox" className="accent-teal-400" checked={provider.capabilities.includes(capability)} onChange={(e) => onChange({
                ...provider, capabilities: e.target.checked ? [...provider.capabilities, capability] : provider.capabilities.filter((v) => v !== capability),
              })} />
              {t(`${PREFIX}.capabilities.${capability}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}
