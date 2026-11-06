import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBubblePastFile } from '@vibisual/shared';
import { APP_LINKED_ITEMS, linkedFileName } from '@vibisual/shared';

import type { AppLinkedFoldGroup, AppLinkedItem } from '../../apps/registry.js';
import { thumbnailAppFor } from '../../apps/appLinkedItems.js';
import type { AppLinkedSatellitesProps } from './AppLinkedSatellites.js';
import { BEAD_FILL, BeadPicture, KindGlyph, itemTitle, stageStyle } from './linkedBeadParts.js';
import { glanceRowGroups, pillWidth } from './linkedBeads.js';

/**
 * §5.4 #36 (J) ⑤ — 앱이 접기·알약을 선언한 노드의 구슬 줄: 장면은 길이에 비례한 알약(안에 대표 그림 · 테는 단계 · 바뀐 장면엔 앱 색 점 ·
 * AI 가 만지는 장면은 숨 쉰다), 소재·지난 결과는 칩 하나(「소재 N」·「지난 결과 N」)로 접고 누르면 펼친다(휘발). `+N` 은 펼친 묶음 안에만.
 * 한 번 누르면 노드 화면이 그 장면을 보이고(`onFocusItem`), 두 번이면 편집기 — 구슬은 `nodrag nopan`.
 */

const NO_OPEN: ReadonlySet<AppLinkedFoldGroup> = new Set();
const PILL_BASE = 'nodrag nopan pointer-events-auto relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border transition-transform duration-150 hover:scale-[1.08]';

function ChevronGlyph({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
      <path d={open ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

export const AppLinkedGlanceRow = memo(function AppLinkedGlanceRow(p: AppLinkedSatellitesProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<AppLinkedFoldGroup>>(NO_OPEN);
  const groups = glanceRowGroups(p.items, p.pastFiles, p.fold ?? [], open, APP_LINKED_ITEMS.maxVisible);
  if (groups.length === 0) return null;
  const size = APP_LINKED_ITEMS.beadSize;
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const toggle = (group: AppLinkedFoldGroup): void => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });

  const scene = (item: AppLinkedItem): React.JSX.Element => {
    const title = itemTitle(item, t);
    const visual = stageStyle(item.stage, p.glow);
    return (
      <span key={item.id} className="relative flex shrink-0">
        <button
          type="button"
          title={title}
          aria-label={title}
          className={PILL_BASE}
          style={{ ...visual, ...(item.image ? { background: BEAD_FILL } : {}), width: pillWidth(item.durationSec), height: size, borderWidth: 1.5 }}
          onPointerDown={stop}
          onClick={(e) => { e.stopPropagation(); if (item.stageFocus === true) p.onFocusItem?.(item.id); }}
          onDoubleClick={(e) => { e.stopPropagation(); p.onOpenNode(); }}
          onContextMenu={p.onContextMenu}
        >
          {item.image ? (
            <img src={item.image} alt="" draggable={false} className="pointer-events-none h-full w-full select-none object-cover" />
          ) : (
            <span className="text-[12px] font-semibold leading-none tabular-nums">{item.index}</span>
          )}
          {item.image && item.stage === 'building' ? (
            // 짓는 중 — 그림 위 아래 반을 앱 색으로 덮는다(그림이 없는 알약은 테 바탕이 같은 뜻을 말한다).
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2" style={{ background: `${p.glow}59` }} />
          ) : null}
        </button>
        {item.image && typeof item.index === 'number' ? (
          <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-black/65 px-1 text-[12px] font-semibold leading-4 tabular-nums text-white/90">
            {item.index}
          </span>
        ) : null}
        {item.changed === true ? (
          <span aria-hidden="true" className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border" style={{ background: p.glow, borderColor: BEAD_FILL }} />
        ) : null}
        {item.active === true ? (
          // AI 가 지금 만지는 장면 — 바깥 고리가 숨 쉰다(motion-safe: 움직임 줄이기면 멈춘 고리).
          <span aria-hidden="true" className="pointer-events-none absolute -inset-[3px] rounded-full border motion-safe:animate-pulse" style={{ borderColor: p.glow }} />
        ) : null}
      </span>
    );
  };

  const part = (item: AppLinkedItem): React.JSX.Element => {
    const title = itemTitle(item, t);
    const pictureApp = item.file !== undefined && (item.kind === 'image' || item.kind === 'video') ? thumbnailAppFor(item.file) : null;
    return (
      <button
        key={item.id}
        type="button"
        title={title}
        aria-label={title}
        className={PILL_BASE}
        style={{ width: size, height: size, borderWidth: 1.5, borderStyle: 'solid', borderColor: `${p.glow}73`, background: BEAD_FILL, color: p.glow }}
        onPointerDown={stop}
        onClick={stop}
        onDoubleClick={(e) => { e.stopPropagation(); p.onOpenNode(); }}
        onContextMenu={p.onContextMenu}
      >
        {pictureApp !== null && item.file !== undefined ? (
          <BeadPicture appId={pictureApp} projectId={p.projectId} file={item.file} version={0} fallback={<KindGlyph kind={item.kind} />} />
        ) : (
          <KindGlyph kind={item.kind} />
        )}
      </button>
    );
  };

  const past = (entry: AppBubblePastFile): React.JSX.Element => {
    const title = `${t('canvas.linkedItems.past')} · ${linkedFileName(entry.file)}\n${t('canvas.linkedItems.openPastHint')}`;
    return (
      <button
        key={`past:${entry.file}`}
        type="button"
        title={title}
        aria-label={title}
        className={PILL_BASE}
        style={{ width: size, height: size, borderWidth: 1.5, borderStyle: 'dashed', borderColor: `${p.glow}99`, background: BEAD_FILL, color: p.glow, opacity: 0.9 }}
        onPointerDown={stop}
        onClick={stop}
        onDoubleClick={(e) => { e.stopPropagation(); p.onOpenPast(entry.file); }}
        onContextMenu={p.onContextMenu}
      >
        <BeadPicture appId={p.appId} projectId={p.projectId} file={entry.file} version={entry.at ?? 0} fallback={<span className="flex [&>svg]:h-3 [&>svg]:w-3">{p.appIcon}</span>} />
      </button>
    );
  };

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: p.nodeWidth / 2, top: p.nodeHeight }}
      role="group"
      aria-label={t('canvas.linkedItems.rowLabel')}
    >
      {/* 노드에서 내려온 실(가운데) — 줄은 그 아래 가운데에 매달린다. */}
      <span aria-hidden="true" className="absolute left-0 top-0 w-px" style={{ height: APP_LINKED_ITEMS.dropY - size / 2, background: p.glow, opacity: APP_LINKED_ITEMS.threadOpacity }} />
      <div
        className="absolute left-0 flex -translate-x-1/2 items-center"
        style={{ top: APP_LINKED_ITEMS.dropY - size / 2, gap: APP_LINKED_ITEMS.beadGap + APP_LINKED_ITEMS.groupGap }}
      >
        {/* 구슬을 꿴 가로 실(구슬 뒤). */}
        <span aria-hidden="true" className="absolute top-1/2 h-px -translate-y-1/2" style={{ left: size / 2, right: size / 2, background: p.glow, opacity: APP_LINKED_ITEMS.threadOpacity }} />
        {groups.map((g) => (
          <div key={g.group} className="flex shrink-0 items-center" style={{ gap: APP_LINKED_ITEMS.beadGap }}>
            {g.chip ? (
              <button
                type="button"
                aria-expanded={g.chip.expanded}
                title={g.chip.expanded ? t('canvas.linkedItems.foldHide') : t('canvas.linkedItems.foldShow')}
                className="nodrag nopan pointer-events-auto relative flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border pl-2 pr-1 text-[12px] font-semibold leading-none"
                style={{ height: size, borderColor: `${p.glow}73`, background: BEAD_FILL, color: p.glow }}
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); toggle(g.group === 'past' ? 'past' : 'part'); }}
                onDoubleClick={stop}
                onContextMenu={p.onContextMenu}
              >
                {g.group === 'past'
                  ? t('canvas.linkedItems.pastChip', { count: g.total })
                  : t('canvas.linkedItems.partsChip', { count: g.total })}
                <ChevronGlyph open={g.chip.expanded} />
              </button>
            ) : null}
            {g.items.map((item) => (g.group === 'scene' ? scene(item) : part(item)))}
            {g.past.map(past)}
            {g.more > 0 ? (
              <span
                className="pointer-events-auto relative flex shrink-0 items-center justify-center rounded-full border px-1 text-[12px] font-semibold leading-none tabular-nums"
                style={{ minWidth: size, height: size, borderColor: `${p.glow}59`, background: BEAD_FILL, color: p.glow }}
                title={t('ide.list.moreItems', { count: g.more })}
                onContextMenu={p.onContextMenu}
              >
                +{g.more}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
});
