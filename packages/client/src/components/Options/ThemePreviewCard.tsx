/**
 * §4 앱 테마 — 테마 하나의 **미리보기 카드**.
 *
 * 축소판 앱(제목줄 · 캔버스와 버블 · IDE 패널 · 입력칸 · 버튼)을 **앱과 같은 Tailwind 클래스**로 그리고,
 * 그 테마의 변수를 카드 한 장에만 싣는다(`useThemeScopeVars`). 그래서 카드가 보여 주는 색은 고르면
 * 실제로 칠해질 색 그대로다 — 견본 색을 따로 적어 두면 테마와 어긋난다.
 */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedAppTheme } from '@vibisual/shared';
import { useThemeScopeVars } from '../../theme/useAppTheme.js';

/** 기본 테마는 번역된 이름·설명, 사용자 테마는 파일에 적힌 그대로. */
export function useThemeLabel(theme: ResolvedAppTheme): { name: string; description: string } {
  const { t } = useTranslation();
  if (!theme.i18nKey) return { name: theme.name, description: theme.description ?? '' };
  return {
    name: t(`panel.options.theme.builtin.${theme.i18nKey}.name`, { defaultValue: theme.name }),
    description: t(`panel.options.theme.builtin.${theme.i18nKey}.desc`, { defaultValue: theme.description ?? '' }),
  };
}

function ThemeMiniApp({ theme }: { theme: ResolvedAppTheme }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useThemeScopeVars(ref, theme);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="relative h-[84px] w-full overflow-hidden rounded-md border border-gray-700/60 bg-vb-window"
    >
      {/* 제목줄 */}
      <div className="flex h-3 items-center gap-1 bg-vb-titlebar px-1.5">
        <span className="h-1 w-6 rounded-full bg-vb-titlebar-fg/70" />
        <span className="ml-auto h-1 w-3 rounded-full bg-vb-titlebar-fg/40" />
      </div>
      <div className="flex h-[72px]">
        {/* 캔버스 — 점 무늬 대신 옅은 버블 셋과 잇는 선 */}
        <div className="relative flex-1 bg-vb-canvas">
          <span className="absolute left-[30%] top-[46%] h-px w-[22%] -rotate-12 bg-gray-500/60" />
          <span className="absolute left-[14%] top-[30%] h-6 w-6 rounded-full bg-blue-500/30 ring-1 ring-blue-400/70" />
          <span className="absolute left-[50%] top-[16%] h-4 w-4 rounded-full bg-amber-500" />
          <span className="absolute left-[44%] top-[60%] h-3 w-3 rounded-full bg-violet-500" />
          <span className="absolute bottom-1 left-1 h-1 w-8 rounded-full bg-white/10" />
        </div>
        {/* IDE 패널 — 글줄 · 코드 · 입력칸 · 버튼 */}
        <div className="flex w-[44%] flex-col gap-1 border-l border-gray-700 bg-gray-900 p-1.5">
          <span className="h-1 w-3/4 rounded-full bg-gray-200" />
          <span className="h-1 w-full rounded-full bg-gray-500" />
          <span className="h-2.5 w-full rounded-sm border border-vb-code-border bg-vb-code" />
          <span className="mt-auto h-2.5 w-full rounded-sm border border-gray-700 bg-gray-800" />
          <span className="h-2 w-1/2 self-end rounded-sm bg-blue-600" />
        </div>
      </div>
    </div>
  );
}

interface ThemePreviewCardProps {
  theme: ResolvedAppTheme;
  selected: boolean;
  onPick: (id: string) => void;
}

export function ThemePreviewCard({ theme, selected, onPick }: ThemePreviewCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const { name, description } = useThemeLabel(theme);
  const sub = theme.source === 'custom' ? (theme.author ? t('panel.options.theme.byAuthor', { author: theme.author }) : theme.file) : undefined;
  return (
    <button
      type="button"
      onClick={() => onPick(theme.id)}
      aria-pressed={selected}
      title={description || name}
      className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-700/60 hover:border-gray-500 hover:bg-white/[0.03]'
      }`}
    >
      <ThemeMiniApp theme={theme} />
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-200">{name}</span>
        {selected && (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-blue-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            {t('panel.options.theme.inUse')}
          </span>
        )}
      </span>
      {(description || sub) && (
        <span className="line-clamp-2 text-[12px] leading-snug text-gray-500">{description || sub}</span>
      )}
    </button>
  );
}
