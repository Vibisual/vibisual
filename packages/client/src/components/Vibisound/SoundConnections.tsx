import { useTranslation } from 'react-i18next';
import { ScrollFade } from '../ScrollFade.js';
import { SoundProviderDraft } from './SoundProviderDraft.js';
import { useAudioDelegate, type AudioDelegateProps } from './useAudioDelegate.js';
import { useSoundProviders } from './useSoundProviders.js';

const PREFIX = 'panel.vibisound.workbench.connections';
const BUTTON = 'rounded border border-white/10 px-2 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
const MAX_PROVIDERS = 24;

export interface SoundConnectionsProps extends AudioDelegateProps {}

/** Project-keyed state prevents drafts and delayed responses crossing between app windows. */
export function SoundConnections(props: SoundConnectionsProps): React.JSX.Element {
  return <SoundConnectionsBody key={props.projectId} {...props} />;
}

function SoundConnectionsBody(props: SoundConnectionsProps): React.JSX.Element {
  const { t } = useTranslation();
  const delegate = useAudioDelegate(props);
  const settings = useSoundProviders(props.projectId);
  const settingsBusy = settings.status === 'loading' || settings.status === 'saving';
  const settingsDisabled = settingsBusy || settings.status === 'loadFailed' || !props.projectId;
  const sendDisabled = props.disabled || !props.doc || !delegate.agentId || !delegate.request.trim() || delegate.status === 'submitting';
  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col rounded-lg border border-white/10 bg-gray-950/70 text-xs">
      <h2 className="shrink-0 border-b border-white/10 px-3 py-2.5 font-semibold text-gray-200">{t(`${PREFIX}.title`)}</h2>
      <ScrollFade fill className="flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><h3 className="font-medium text-gray-200">{t(`${PREFIX}.builtIn`)}</h3><span className="text-teal-300">{t(`${PREFIX}.available`)}</span></div>
            <p className="leading-relaxed text-gray-400">{t(`${PREFIX}.builtInHint`)}</p>
          </section>
          <section className="space-y-2 border-t border-white/10 pt-3">
            <h3 className="font-medium text-gray-200">{t(`${PREFIX}.claude`)}</h3>
            <p className="leading-relaxed text-gray-400">{t(`${PREFIX}.claudeHint`)}</p>
            <label className="block space-y-1 text-gray-400">
              <span>{t(`${PREFIX}.agent`)}</span>
              <select value={delegate.agentId} onChange={(e) => delegate.selectAgent(e.target.value)} disabled={!delegate.targets.length || delegate.status === 'submitting'}
                className="w-full min-w-0 rounded border border-white/10 bg-gray-950 px-2 py-1.5 text-gray-200 disabled:opacity-50">
                {!delegate.targets.length && <option value="">{t(`${PREFIX}.noAgent`)}</option>}
                {delegate.targets.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-gray-400">
              <span>{t(`${PREFIX}.request`)}</span>
              <textarea rows={3} maxLength={12000} value={delegate.request} onChange={(e) => delegate.setRequest(e.target.value)}
                className="w-full resize-y rounded border border-white/10 bg-gray-950 px-2 py-1.5 text-gray-200" placeholder={t(`${PREFIX}.requestPlaceholder`)} />
            </label>
            <button type="button" className={`${BUTTON} w-full border-teal-500/25 bg-teal-500/10 text-teal-200`} onClick={delegate.send} disabled={sendDisabled}>
              {t(`${PREFIX}.${delegate.status === 'submitting' ? 'submitting' : 'send'}`)}
            </button>
            {delegate.status === 'queued' && <p role="status" className="text-teal-300">{t(`${PREFIX}.queued`)}</p>}
            {delegate.status === 'sendFailed' && <p role="alert" className="text-amber-300">{t(`${PREFIX}.sendFailed`)}</p>}
            <p className="leading-relaxed text-gray-500">{t(`${PREFIX}.listeningHint`)}</p>
          </section>
          <section className="space-y-2 border-t border-white/10 pt-3">
            <h3 className="font-medium text-gray-200">{t(`${PREFIX}.draftsTitle`)}</h3>
            <p className="leading-relaxed text-gray-400">{t(`${PREFIX}.draftsHint`)}</p>
            <p className="leading-relaxed text-gray-500">{t(`${PREFIX}.endpointHint`)}</p>
            {settings.status === 'loadFailed' ? (
              <div className="space-y-2"><p role="alert" className="text-amber-300">{t(`${PREFIX}.loadFailed`)}</p><button type="button" className={BUTTON} onClick={settings.retry}>{t(`${PREFIX}.retry`)}</button></div>
            ) : (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void settings.save(); }}>
                {settings.providers.map((provider) => <SoundProviderDraft key={provider.id} provider={provider} disabled={settingsDisabled}
                  onChange={(next) => settings.setProviders(settings.providers.map((item) => item.id === next.id ? next : item))}
                  onRemove={() => settings.setProviders(settings.providers.filter((item) => item.id !== provider.id))} />)}
                <div className="flex flex-wrap gap-1.5">
                  {(['api', 'local'] as const).map((kind) => <button key={kind} type="button" className={BUTTON} disabled={settingsDisabled || settings.providers.length >= MAX_PROVIDERS}
                    onClick={() => settings.setProviders([...settings.providers, { id: `provider-${crypto.randomUUID()}`, kind,
                      name: t(`${PREFIX}.newProviderName`, { kind: t(`${PREFIX}.${kind}`), count: settings.providers.length + 1 }), endpoint: '', model: '', capabilities: [] }])}>
                    {t(`${PREFIX}.${kind === 'api' ? 'addApi' : 'addLocal'}`)}
                  </button>)}
                </div>
                <button className={`${BUTTON} w-full`} type="submit" disabled={settingsDisabled || !settings.dirty}>{t(`${PREFIX}.${settings.status === 'saving' ? 'saving' : 'saveDrafts'}`)}</button>
                {settings.status === 'loading' && <p role="status" className="text-gray-500">{t(`${PREFIX}.loading`)}</p>}
                {settings.status === 'saved' && <p role="status" className="text-teal-300">{t(`${PREFIX}.saved`)}</p>}
                {settings.status === 'saveFailed' && <p role="alert" className="text-amber-300">{t(`${PREFIX}.saveFailed`)}</p>}
              </form>
            )}
          </section>
        </div>
      </ScrollFade>
    </aside>
  );
}
