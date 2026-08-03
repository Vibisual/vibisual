import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TodoItem } from '@vibisual/shared';
import type { StreamPlan } from './streamItems.js';

interface PlanBlockProps {
  item: StreamPlan;
}

/** 완료 — 체크 */
function DoneGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 진행 중 — 가운데가 찬 원 */
function ActiveGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 대기 — 빈 원 */
function PendingGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/** 계획 헤더 — 체크리스트 */
function PlanGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 7 2 2 3.5-3.5" />
      <path d="m3 16 2 2 3.5-3.5" />
      <path d="M13 7h8M13 17h8" />
    </svg>
  );
}

const ROW_STYLE: Record<TodoItem['status'], { text: string; glyph: string; icon: React.JSX.Element }> = {
  completed: { text: 'text-gray-500 line-through decoration-gray-600', glyph: 'text-emerald-400/70', icon: <DoneGlyph /> },
  in_progress: { text: 'text-sky-100 font-medium', glyph: 'text-sky-400', icon: <ActiveGlyph /> },
  pending: { text: 'text-gray-400', glyph: 'text-gray-600', icon: <PendingGlyph /> },
};

/**
 * §5.5 #17-12 — 계획 블록(`TodoWrite` 승격 렌더).
 *
 * "에이전트가 무엇을 하려는지"를 실행 초반에 보여줘 사용자가 멈출지 말지 판단하게 하는 표면.
 * 진행 중 단계를 강조하고 완료/전체를 함께 띄운다. 같은 턴의 옛 계획(`superseded`)은 한 줄로 접혀,
 * 펼치면 그때의 계획을 그대로 볼 수 있다(계획은 하나, 갱신 이력은 소음).
 */
export const PlanBlock = memo(function PlanBlock({ item }: PlanBlockProps): React.JSX.Element {
  const { t } = useTranslation();
  // 기본 펼침 여부는 "지금 유효한 계획인가"로 정해진다 — 더 새 계획이 오면(superseded) 사용자가 따로 건드리지
  //   않은 한 자동으로 접힌다. 사용자가 직접 토글하면 그 선택(override)이 이긴다.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? !item.superseded;
  const setOpen = (): void => setOverride(!open);
  const done = item.todos.filter((td) => td.status === 'completed').length;
  const total = item.todos.length;

  if (item.superseded && !open) {
    return (
      <div className="mx-2 my-0.5 max-md:mx-1">
        <button
          type="button"
          onClick={setOpen}
          className="flex w-full items-center gap-2 rounded px-2.5 py-1 text-left text-[12px] text-gray-600 transition-colors hover:bg-gray-800/40 hover:text-gray-400"
        >
          <PlanGlyph />
          <span className="truncate">{t('ide.plan.superseded')}</span>
          <span className="flex-shrink-0 tabular-nums text-gray-700">{t('ide.plan.progress', { done, total })}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 max-md:mx-1 ${item.superseded ? 'border-gray-700' : 'border-sky-500/60'}`}>
      <button
        type="button"
        onClick={setOpen}
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
          item.superseded ? 'bg-gray-800/20 hover:bg-gray-800/40' : 'bg-sky-500/5 hover:bg-sky-500/10'
        }`}
      >
        <span className={item.superseded ? 'text-gray-500' : 'text-sky-300'}><PlanGlyph /></span>
        <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wide ${item.superseded ? 'text-gray-500' : 'text-sky-300'}`}>
          {item.superseded ? t('ide.plan.superseded') : t('ide.plan.title')}
        </span>
        <span className="flex-shrink-0 text-[11px] tabular-nums text-gray-500">{t('ide.plan.progress', { done, total })}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 border-t border-gray-800/60 bg-gray-950/40 px-3 py-2">
          {item.todos.map((td, i) => {
            const style = ROW_STYLE[td.status];
            return (
              <li key={i} className={`flex items-start gap-2 text-[12.5px] leading-relaxed ${style.text}`}>
                <span className={`mt-0.5 ${style.glyph}`}>{style.icon}</span>
                <span className="min-w-0 flex-1 break-words">{td.content}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
