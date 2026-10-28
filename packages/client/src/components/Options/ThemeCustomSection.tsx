/**
 * §4 앱 테마 — 내 테마 구역. 테마는 `~/.vibisual/themes/*.json` 이고 서버가 읽는다(렌더러는 디스크를 못 읽는다).
 * [새로 만들기]는 지금 테마를 `extends` 로 잇고 의미 토큰이 다 적힌 견본을 쓴다. 파일 문제는 사용자 언어로 보인다.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppThemeCatalog, ResolvedAppTheme } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ThemePreviewCard, useThemeLabel } from './ThemePreviewCard.js';
import { ThemeIssueList } from './ThemeIssueList.js';
import { ThemeFormatHelp } from './ThemeFormatHelp.js';

type Failure = 'load' | 'create' | 'open';

interface ThemeCustomSectionProps {
  catalog: AppThemeCatalog | null;
  themes: readonly ResolvedAppTheme[];
  activeId: string;
  /** [새로 만들기]가 이어받는 테마 — 지금 칠해진 테마. */
  baseTheme: ResolvedAppTheme;
  onPick: (id: string) => void;
}

const BUTTON =
  'flex items-center gap-1.5 rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-[12px] text-gray-300 hover:bg-gray-700 disabled:opacity-40';

export function ThemeCustomSection({ catalog, themes, activeId, baseTheme, onPick }: ThemeCustomSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const loadAppThemes = useGraphStore((s) => s.loadAppThemes);
  const createAppTheme = useGraphStore((s) => s.createAppTheme);
  const openAppThemesFolder = useGraphStore((s) => s.openAppThemesFolder);
  const baseName = useThemeLabel(baseTheme).name;
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);

  const run = useCallback(async (kind: Failure, action: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      if (!(await action())) setFailed(kind);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCreate = useCallback((): void => {
    void run('create', async () => {
      const res = await createAppTheme(baseTheme.id, t('panel.options.theme.custom.copyName', { name: baseName }));
      if (!res) return false;
      setCreated(res.file);
      onPick(res.id);
      return true;
    });
  }, [run, createAppTheme, baseTheme.id, baseName, onPick, t]);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="border-b border-gray-700/50 pb-2">
        <h5 className="text-xs font-semibold text-gray-300">{t('panel.options.theme.custom.title')}</h5>
        {/* 버튼 이름은 글자로 박지 않고 받아 적는다 — 로케일마다 번역이 갈려도 안내가 가리키는 버튼은 화면의 그 버튼이다. */}
        <p className="mt-0.5 text-[12px] text-gray-500">{t('panel.options.theme.custom.desc', { reload: t('panel.options.theme.custom.reload') })}</p>
      </div>
      {catalog && <p className="break-all font-mono text-[12px] text-gray-500">{catalog.dir}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void run('open', openAppThemesFolder)} className={BUTTON}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>
          {t('panel.options.theme.custom.openFolder')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('load', () => loadAppThemes({ rescan: true }))} className={BUTTON}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg>
          {t('panel.options.theme.custom.reload')}
        </button>
        <button type="button" disabled={busy} onClick={handleCreate} className={BUTTON}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          {t('panel.options.theme.custom.create', { name: baseName })}
        </button>
      </div>
      {created && !failed && (
        <p className="text-[12px] leading-snug text-emerald-300">{t('panel.options.theme.custom.createdHint', { file: created, reload: t('panel.options.theme.custom.reload') })}</p>
      )}
      {failed && <p role="alert" className="text-[12px] text-red-400">{t(`panel.options.theme.custom.failed.${failed}`)}</p>}
      {themes.length === 0 ? (
        <p className="text-[12px] text-gray-500">{t('panel.options.theme.custom.empty')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-md:grid-cols-2">
          {themes.map((theme) => (
            <ThemePreviewCard key={theme.id} theme={theme} selected={theme.id === activeId} onPick={onPick} />
          ))}
        </div>
      )}
      <ThemeIssueList issues={catalog?.issues ?? []} />
      <ThemeFormatHelp />
    </section>
  );
}
