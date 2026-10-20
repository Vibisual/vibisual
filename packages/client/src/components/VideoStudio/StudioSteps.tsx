import { useTranslation } from 'react-i18next';

/**
 * §5.13 (V) 37-1 — 빈 화면이 말하는 **세 걸음**(말하기 → 기획 승인 → 값으로 다듬기). 따로 안내 투어 창을 만들지 않고, 시작 화면과
 * 빈 패널이 이 그림으로 지금 단계를 보인다. 버블 언어 — 세 원을 궤도선으로 잇고, 지금 단계의 원만 앱 색 링이다.
 * 반응형 — 자리가 모자라면(폰 폭 시작 화면 · 좁은 AI 칸 · 긴 번역) 걸음이 아랫줄로 접힌다(넘쳐 가로 스크롤이 생기지 않게).
 */
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
