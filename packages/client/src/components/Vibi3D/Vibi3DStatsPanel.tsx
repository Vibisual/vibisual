import { useTranslation } from 'react-i18next';
import type { Vibi3DStats } from '@vibisual/shared';

export function Vibi3DStatsPanel({ stats }: { stats?: Vibi3DStats }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!stats) return null;
  const label = (key: string): string => t(`panel.vibi3d.stats.${key}`);
  return <details className="mt-3 min-w-0 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg">
    <summary className="cursor-pointer pointer-coarse:py-2">{label('title')}</summary>
    <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-2 gap-y-1">
      {(['objects', 'instances', 'triangles', 'drawCalls'] as const).map(key => <div key={key} className="contents">
        <dt className="truncate">{label(key)}</dt><dd className="min-w-0 truncate text-right tabular-nums">{stats[key]?.toLocaleString() ?? '—'}</dd>
      </div>)}
      <dt className="truncate">{label('textureBytes')}</dt><dd className="text-right tabular-nums">{(stats.textureBytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</dd>
    </dl>
    <p className="mt-2 opacity-70">{label('estimated')}</p>
    {stats.warnings.map(warning => <p role="status" className="mt-1 break-words" key={warning.metric}>
      {t('panel.vibi3d.stats.warning', { metric: label(warning.metric), value: warning.value.toLocaleString(), limit: warning.limit.toLocaleString() })}
    </p>)}
  </details>;
}
