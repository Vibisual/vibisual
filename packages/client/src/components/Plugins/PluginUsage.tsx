/**
 * §5.11 — 카드를 켜면 뭘 보게 되나. 손으로 쓰지 않고 선언에서 만든다(`manifest.contributes` · `module.needs` · `module.usage.checkKeys` 행 이름)
 * — 카드가 바뀌면 설명도 따라 바뀐다.
 */
import { useTranslation } from 'react-i18next';
import type { PluginManifest } from '@vibisual/shared';
import { getClientModule } from '@vibisual/plugins/client';

interface PluginUsageProps {
  manifest: PluginManifest;
  enabled: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[12px] text-gray-600">{label}</span>
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-gray-400">{children}</div>
    </div>
  );
}

const Chips = ({ items }: { items: string[] }): React.JSX.Element => (
  <span className="flex flex-wrap gap-1">
    {items.map((x) => (
      <span key={x} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-gray-300">{x}</span>
    ))}
  </span>
);

export function PluginUsage({ manifest, enabled }: PluginUsageProps): React.JSX.Element {
  const { t } = useTranslation();
  const mod = getClientModule(manifest.id);
  const usage = mod?.usage;

  const where = manifest.contributes.map((c) => t(`panel.plugins.contribution.${c}`));
  const reads = (mod?.needs ?? []).map((n) => t(`panel.plugins.need.${n}`));
  const shows = usage ? usage.checkKeys.map((k: string) => t(`panel.plugins.${usage.i18nKey}.${k}`)) : [];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
      <Row label={t('panel.plugins.usage.where')}>
        <Chips items={where} />
        {usage?.badgeIsConditional && (
          <p className="mt-1 text-gray-500">{t('panel.plugins.usage.badgeOnlyWhenNotable')}</p>
        )}
      </Row>

      <Row label={t('panel.plugins.usage.reads')}>
        {reads.length > 0 ? <Chips items={reads} /> : <span className="text-gray-500">{t('panel.plugins.usage.readsConfigOnly')}</span>}
      </Row>

      {shows.length > 0 && (
        <Row label={t('panel.plugins.usage.shows')}>
          <Chips items={shows} />
        </Row>
      )}

      <Row label={t('panel.plugins.usage.howTo')}>
        {enabled ? t('panel.plugins.usage.howToOn') : t('panel.plugins.usage.howToOff')}
      </Row>
    </div>
  );
}
