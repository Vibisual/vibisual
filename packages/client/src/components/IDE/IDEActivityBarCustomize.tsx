import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { applyVisibleOrder, moveActivityItem } from '@vibisual/shared';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useIDEActivityBarStore } from '../../stores/ideActivityBar.js';
import { ActivityIcon } from './ideActivityIcons.js';

/**
 * §5.5 #16-1 — 활동바 **구성 패널**. 활동바 상단 버튼을 누르면 그 오른쪽에 붙어 열린다.
 *
 * 하는 일은 둘이다 — **무엇을 올려 둘지**(추가/제외)와 **어떤 차례로 둘지**(위/아래).
 * 활동바 자체에서도 길게 눌러 끌면 자리가 바뀌지만, 그 손짓은 **화면에 서 있는 칸**만 옮길 수
 * 있다. 내려놓은 칸을 도로 올리는 자리는 여기뿐이라, 두 목록을 한 화면에 나란히 둔다.
 *
 * **제외는 삭제가 아니다.** 내려놓은 칸은 아래 목록에 그대로 남아 언제든 도로 올라간다 —
 * 그래서 "없어졌다"가 아니라 "접어 뒀다"로 읽힌다.
 */
export const IDEActivityBarCustomize = memo(function IDEActivityBarCustomize({
  order,
  visible,
  hidden,
  labelOf,
  onClose,
}: {
  /** 전체 순서(제외된 것 포함). 저장은 이 순서로 한다. */
  order: readonly IDEViewType[];
  /** 지금 활동바에 실제로 서 있는 것 — 이 엔진에 없는 칸은 여기에도 없다. */
  visible: readonly IDEViewType[];
  /** 내려놓은 것(이 엔진에 없는 칸은 빼고 — 켤 수 없는 것을 켜라고 보여 주지 않는다). */
  hidden: readonly IDEViewType[];
  /** 항목 이름. `subagents` 처럼 수를 받는 라벨이 있어 활동바가 만들어 넘긴다. */
  labelOf: (view: IDEViewType) => string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setOrder = useIDEActivityBarStore((s) => s.setOrder);
  const setHiddenState = useIDEActivityBarStore((s) => s.setHiddenState);
  const resetPrefs = useIDEActivityBarStore((s) => s.resetPrefs);

  /** 보이는 목록 안에서 한 칸 옮긴다 — 안 보이는 칸의 자리는 건드리지 않는다. */
  const move = useCallback((from: number, dir: -1 | 1) => {
    const to = dir === -1 ? from - 1 : from + 2; // `to` 는 "이 칸 앞에 놓는다" 기준.
    const nextVisible = moveActivityItem(visible, from, to) as IDEViewType[];
    void setOrder(applyVisibleOrder(order, visible, nextVisible) as IDEViewType[]);
  }, [order, visible, setOrder]);

  const row = (view: IDEViewType, controls: React.ReactNode): React.JSX.Element => (
    <li key={view} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-800">
      <ActivityIcon view={view} className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">{labelOf(view)}</span>
      {controls}
    </li>
  );

  /** 작은 손잡이 — 라벨 없이 글리프만 서므로 `title`·`aria-label` 이 이름을 대신한다. */
  const iconButton = (
    label: string,
    onClick: () => void,
    path: React.ReactNode,
    disabled = false,
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-30"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {path}
      </svg>
    </button>
  );

  return (
    <div
      className="absolute left-12 top-0 z-50 flex max-h-full w-60 flex-col rounded-r border border-l-0 border-gray-700 bg-gray-900 shadow-xl"
      // IDE 창은 DOM 상 캔버스의 자식이라(§5.5 #17-6) 손짓을 여기서 멈춰 세운다 —
      // 안 그러면 패널 위 클릭·드래그가 캔버스로 새어 나가 뒤에서 버블이 끌린다.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-gray-700 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-200">
          {t('ide.activityBar.customize')}
        </span>
        {iconButton(t('ide.activityBar.resetLayout'), () => { void resetPrefs(); }, (
          <>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </>
        ))}
        {iconButton(t('common.close'), onClose, <path d="M18 6 6 18M6 6l12 12" />)}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        <p className="px-0.5 pb-1 text-[12px] text-gray-500">{t('ide.activityBar.dragHint')}</p>

        <h4 className="px-0.5 pb-0.5 pt-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
          {t('ide.activityBar.shownSection')}
        </h4>
        <ul className="flex flex-col">
          {visible.map((view, i) => row(view, (
            <>
              {iconButton(t('ide.activityBar.moveUp'), () => move(i, -1), <path d="m18 15-6-6-6 6" />, i === 0)}
              {iconButton(t('ide.activityBar.moveDown'), () => move(i, 1), <path d="m6 9 6 6 6-6" />, i === visible.length - 1)}
              {iconButton(t('ide.activityBar.exclude'), () => { void setHiddenState(view, true); }, (
                <>
                  <path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7a15 15 0 0 1-2.4 3.4" />
                  <path d="M6.6 6.6C4.3 8.1 2.6 10.4 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 4.5-1.1" />
                  <path d="m2 2 20 20" />
                </>
              ))}
            </>
          )))}
        </ul>

        <h4 className="px-0.5 pb-0.5 pt-3 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
          {t('ide.activityBar.excludedSection')}
        </h4>
        {hidden.length === 0 ? (
          <p className="px-0.5 py-1 text-[12px] text-gray-600">{t('ide.activityBar.noExcluded')}</p>
        ) : (
          <ul className="flex flex-col">
            {hidden.map((view) => row(view, (
              iconButton(t('ide.activityBar.add'), () => { void setHiddenState(view, false); }, (
                <>
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </>
              ))
            )))}
          </ul>
        )}
      </div>
    </div>
  );
});
