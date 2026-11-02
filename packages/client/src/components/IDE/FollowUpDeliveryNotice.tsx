import { useTranslation } from 'react-i18next';
import type { FollowUpDeliveryDisplay } from './followUpDelivery.js';

export function FollowUpDeliveryNotice({ delivery, showLabel = true }: {
  delivery: FollowUpDeliveryDisplay;
  showLabel?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const warning = delivery.state === 'unavailable' || delivery.state === 'uncertain';
  return (
    <div role="status" aria-live="polite" className={`space-y-1 text-[12px] leading-relaxed ${warning ? 'text-amber-200/90' : 'text-sky-200/80'}`}>
      {showLabel && <div className="font-medium">{t(`ide.mainArea.liveDelivery.${delivery.state}`)}</div>}
      {delivery.reason && <p>{t(`ide.mainArea.liveDelivery.reason.${delivery.reason}`)}</p>}
      <p>{t(`ide.mainArea.liveDelivery.hint.${delivery.state}`, {
        wait: t('ide.mainArea.dispatchMode.wait'), immediate: t('ide.mainArea.dispatchMode.immediate'),
      })}</p>
    </div>
  );
}
