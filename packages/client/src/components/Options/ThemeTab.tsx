/**
 * §4 앱 테마 — 옵션창의 **테마** 칸.
 *
 * 카드를 누르면 **그 자리에서 칠하고 저장한다** — 언어와 같은 즉시 축이라 푸터 [적용]과 무관하다
 * (테마는 눈으로 보고 고르는 것이라, 적용을 눌러야 바뀌면 고르는 동안 비교할 수가 없다).
 * 저장값은 `UserDefaults.appearance.themeId` 하나이고, 다른 창(별창·지휘통제실)도
 * `user_defaults_updated` 로 함께 바뀐다. 창 바탕·제목줄 단추는 desktop main 이 같은 값으로 다시 칠한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listAppThemes, resolveAppTheme, type ResolvedAppTheme } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useSelectedAppThemeId } from '../../theme/useAppTheme.js';
import { ThemePreviewCard, useThemeLabel } from './ThemePreviewCard.js';
import { ThemeCustomSection } from './ThemeCustomSection.js';
import { BubbleAppearanceSection } from './BubbleAppearanceSection.js';

interface ThemeGroupProps {
  title: string;
  themes: readonly ResolvedAppTheme[];
  activeId: string;
  onPick: (id: string) => void;
}

function ThemeGroup({ title, themes, activeId, onPick }: ThemeGroupProps): React.JSX.Element | null {
  if (themes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{title}</span>
      <div className="grid grid-cols-3 gap-2 max-md:grid-cols-2">
        {themes.map((theme) => (
          <ThemePreviewCard key={theme.id} theme={theme} selected={theme.id === activeId} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

export function ThemeTab(): React.JSX.Element {
  const { t } = useTranslation();
  const catalog = useGraphStore((s) => s.appThemes);
  const loadAppThemes = useGraphStore((s) => s.loadAppThemes);
  const setAppTheme = useGraphStore((s) => s.setAppTheme);
  const selectedId = useSelectedAppThemeId();
  const [saveFailed, setSaveFailed] = useState(false);

  // 칸에 들어올 때마다 폴더를 다시 읽는다 — 파일을 고치고 돌아온 사람이 [다시 읽기]를 찾지 않아도 되게.
  useEffect(() => {
    void loadAppThemes({ rescan: true });
  }, [loadAppThemes]);

  const custom = catalog?.themes;
  const all = useMemo(() => {
    const list = custom ?? [];
    return listAppThemes(list).map((d) => resolveAppTheme(d.id, list));
  }, [custom]);
  const active = useMemo(() => resolveAppTheme(selectedId, custom ?? []), [selectedId, custom]);
  const activeName = useThemeLabel(active).name;
  const dark = all.filter((x) => x.source === 'builtin' && x.kind === 'dark');
  const light = all.filter((x) => x.source === 'builtin' && x.kind === 'light');
  const mine = all.filter((x) => x.source === 'custom');

  const pick = useCallback((id: string): void => {
    setSaveFailed(false);
    void setAppTheme(id).then((ok) => {
      if (!ok) setSaveFailed(true);
    });
  }, [setAppTheme]);

  return (
    <div className="flex flex-col gap-5">
      <div className="border-b border-gray-700/50 pb-2">
        <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.categories.theme', { defaultValue: 'Theme' })}</h4>
        <p className="mt-1 text-[12px] text-gray-500">{t('panel.options.theme.intro')}</p>
      </div>

      {/* 고른 사용자 테마를 못 찾았다(파일을 지웠거나 옮겼다) — 목록을 받은 뒤에만 말한다(받기 전엔 모른다). */}
      {active.fellBack && catalog && (
        <div role="status" className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] leading-snug text-amber-200">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
          {t('panel.options.theme.missing', { id: selectedId, fallback: activeName })}
        </div>
      )}
      {saveFailed && (
        <p role="alert" className="text-[12px] text-red-400">{t('panel.options.theme.saveFailed')}</p>
      )}

      <ThemeGroup title={t('panel.options.theme.groupDark')} themes={dark} activeId={active.id} onPick={pick} />
      <ThemeGroup title={t('panel.options.theme.groupLight')} themes={light} activeId={active.id} onPick={pick} />
      <ThemeCustomSection catalog={catalog} themes={mine} activeId={active.id} baseTheme={active} onPick={pick} />
      <BubbleAppearanceSection />
    </div>
  );
}
