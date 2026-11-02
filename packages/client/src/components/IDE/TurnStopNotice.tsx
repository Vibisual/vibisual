import { useTranslation } from 'react-i18next';

/** One quiet boundary at the end of a stopped turn, shared by session and combined views. */
export function TurnStopNotice({ labelKey, sessionLabel }: { labelKey: string; sessionLabel?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const label = sessionLabel ? `${sessionLabel} · ${t(labelKey)}` : t(labelKey);
  if (labelKey === 'ide.turnStop.cancelled') {
    return (
      <div role="separator" aria-label={label} title={label} className="mx-4 my-3 flex items-center gap-3 text-[12px] leading-4 text-gray-500 max-md:mx-2.5">
        <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-gray-700/60" />
        <span aria-hidden="true" className="shrink-0 font-medium tracking-wide">stop</span>
        <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-gray-700/60" />
      </div>
    );
  }
  return (
    <div className="mx-2 my-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-[12px] font-medium text-amber-300 max-md:mx-1 max-md:px-2.5">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></svg>
      <span>{label}</span>
    </div>
  );
}
