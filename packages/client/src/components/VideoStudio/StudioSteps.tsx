import { useTranslation } from 'react-i18next';

/** §5.13 (V) 37-1 — 빈 화면의 세 걸음(안내 투어 창 ❌). 세 원 + 궤도선, 지금 단계만 앱 색 링. 모자라면 접는다(가로 스크롤 ❌). */
export function StudioSteps({ step, compact = false }: { readonly step: 0 | 1 | 2; readonly compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const labels = [t('panel.videoStudio.steps.say'), t('panel.videoStudio.steps.approve'), t('panel.videoStudio.steps.refine')];
  return (
    <ol className={`flex max-w-full flex-wrap items-center justify-center gap-y-1.5 ${compact ? 'gap-x-2' : 'gap-x-3'}`} aria-label={t('panel.videoStudio.steps.label')}>
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 ? <span className={`h-px ${compact ? 'w-5' : 'w-8'} border-t border-dashed border-white/20`} aria-hidden="true" /> : null}
          <span className={`flex ${compact ? 'h-5 w-5' : 'h-6 w-6'} items-center justify-center rounded-full border text-[12px] tabular-nums ${i === step ? 'border-transparent bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : i < step ? 'border-white/20 text-slate-300' : 'border-white/10 text-slate-500'}`}
            aria-current={i === step ? 'step' : undefined}>
            {i + 1}
          </span>
          <span className={`text-[12px] ${i === step ? 'font-semibold text-slate-100' : 'text-slate-500'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
