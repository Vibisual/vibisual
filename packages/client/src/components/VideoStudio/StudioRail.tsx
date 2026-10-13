import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { StudioIconButton } from './StudioIconButton.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/**
 * §5.13 (V) 37-1 — 왼쪽 **아이콘 레일**(48px) + 서랍(한 번에 하나). 소재 · 부품 · 스타일 · 메모 + 자막이 있으면 대본.
 * 다시 누르면 닫힌다. 서랍은 160ms 로 왼쪽에서 열린다.
 */
export type RailDrawer = 'media' | 'parts' | 'style' | 'notes' | 'transcript';

const ITEMS: ReadonlyArray<{ readonly id: RailDrawer; readonly icon: StudioIconName }> = [
  { id: 'media', icon: 'media' },
  { id: 'parts', icon: 'parts' },
  { id: 'style', icon: 'style' },
  { id: 'notes', icon: 'notes' },
  { id: 'transcript', icon: 'transcript' },
];

export interface StudioRailProps {
  readonly open: RailDrawer | null;
  readonly onOpen: (drawer: RailDrawer | null) => void;
  /** 자막이 없으면 대본 칸은 서지 않는다. */
  readonly hasTranscript: boolean;
  /** 메모 서랍 위 숫자(열린 메모 수). */
  readonly openNotes: number;
  readonly drawer: ReactNode | null;
}

export function StudioRail(p: StudioRailProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-vb-card py-2" aria-label={t('panel.videoStudio.rail.label')}>
        {ITEMS.filter((it) => it.id !== 'transcript' || p.hasTranscript).map((it) => (
          <div key={it.id} className="relative">
            <StudioIconButton icon={it.icon} label={t(`panel.videoStudio.rail.${it.id}`)} active={p.open === it.id}
              onClick={() => p.onOpen(p.open === it.id ? null : it.id)} />
            {it.id === 'notes' && p.openNotes > 0 ? (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[12px] font-semibold leading-none text-vb-window tabular-nums">{p.openNotes}</span>
            ) : null}
          </div>
        ))}
      </nav>
      {p.open && p.drawer ? (
        <aside className="flex w-72 shrink-0 animate-[vs-in-left_160ms_ease-out] flex-col border-r border-white/10 bg-vb-card" aria-label={t(`panel.videoStudio.rail.${p.open}`)}>
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3">
            <span className="flex-1 text-[13px] font-semibold text-slate-200">{t(`panel.videoStudio.rail.${p.open}`)}</span>
            <button type="button" onClick={() => p.onOpen(null)} aria-label={t('common.close', { defaultValue: 'Close' })}
              className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-100"><StudioIcon name="close" className="h-3.5 w-3.5" /></button>
          </header>
          {p.drawer}
        </aside>
      ) : null}
    </>
  );
}
