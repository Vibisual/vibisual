import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProviderTabs } from '../Engine/ProviderTabs.js';
export function MainProviderSelect(): React.JSX.Element {
  const { t } = useTranslation();
  const main = useGraphStore(s => s.userDefaults?.engineChoice?.kind ?? 'claude');
  const choose = useGraphStore(s => s.chooseEngine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <section className="rounded-lg border border-gray-700 p-3"><h4 className="mb-2 text-sm font-semibold">{t('providers.main')}</h4><p className="mb-3 text-xs text-gray-400">{t('providers.mainHint')}</p><ProviderTabs value={main} disabled={busy} onChange={engine => { setBusy(true); setError(false); void choose(engine).catch(() => setError(true)).finally(() => setBusy(false)); }} />{error && <p role="alert" className="text-xs text-red-400">{t('providers.saveFailed')}</p>}</section>;
}
