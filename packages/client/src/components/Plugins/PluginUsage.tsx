/**
 * §5.11 v4.39 — "이 카드를 켜면 뭘 보게 되는가".
 *
 * 설명 문장만으로는 켤지 말지 정하기 어렵다. 그래서 설명을 누르면 **이 카드가 실제로 하는 일**을 편다.
 *
 * 중요한 것은 이 내용을 **따로 지어 쓰지 않는다**는 점이다. 세 가지 모두 카드가 이미 선언한 것에서 나온다.
 *  · 어디에 보이나 → `manifest.contributes`
 *  · 무엇을 읽나 → `module.needs`(데이터 축)
 *  · 어떤 값을 보여 주나 → `module.usage.checkKeys` 로 만든 **실제 행 이름**(12개 로케일에 이미 번역돼 있다)
 *
 * 손으로 쓴 예시였다면 111장 × 12로케일이 필요하고, 카드가 바뀌면 조용히 거짓말이 된다.
 * 이 방식은 카드가 바뀌면 설명도 같이 바뀐다.
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
