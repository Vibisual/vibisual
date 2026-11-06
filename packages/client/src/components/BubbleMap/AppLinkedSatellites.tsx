import { Fragment, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBubblePastFile } from '@vibisual/shared';
import { APP_LINKED_ITEMS, linkedFileName } from '@vibisual/shared';

import type { AppLinkedFoldGroup, AppLinkedItem } from '../../apps/registry.js';
import { thumbnailAppFor } from '../../apps/appLinkedItems.js';
import { layoutBeadRow } from './linkedBeads.js';
import { BEAD_FILL, BeadPicture, KindGlyph, itemTitle, stageStyle } from './linkedBeadParts.js';
import { AppLinkedGlanceRow } from './AppLinkedGlanceRow.js';

/**
 * §5.4 #36 (H) ③ — 앱 노드 아래 구슬 줄. 무엇을 꿸지는 앱이 `linkedItems` 로 선언하고 코어는 그 목록과 지난 결과만 그린다(앱 이름 ❌ — §5.13 (P-4)).
 * 장면 = 번호 구슬(테가 단계: 기획 점선·승인 실선·짓는 중 아래 반·끝 채움) · 소재 = 종류 아이콘(그림·영상은 미리보기) · 지난 결과 = 점선 테.
 * AI 가 만지는 것은 바깥 고리가 숨 쉰다. 구슬은 `nodrag nopan`. 더블클릭: 장면·소재 = 노드 편집기, 지난 결과 = 그 파일을 그 앱으로. 제목·파일 이름은 번역 ❌.
 */

type Bead =
  | { readonly type: 'item'; readonly item: AppLinkedItem }
  | { readonly type: 'past'; readonly past: AppBubblePastFile };

export interface AppLinkedSatellitesProps {
  /** 앱이 선언한 "연결된 것"(장면 · 소재). */
  readonly items: readonly AppLinkedItem[];
  /** 노드의 지난 결과(최근 것부터). */
  readonly pastFiles: readonly AppBubblePastFile[];
  /** 노드 크기(캔버스 px) — 줄은 노드 아래 가운데에 매달린다. */
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  /** 앱 색(밝은 쪽) — 실·테·아이콘. */
  readonly glow: string;
  /** 그 노드의 앱 — 지난 결과의 미리보기를 굽는다. */
  readonly appId: string;
  /** 그 노드의 앱 아이콘 — 지난 결과의 미리보기를 못 구웠을 때. */
  readonly appIcon: React.ReactNode;
  /** 프로젝트 루트 절대 경로(모르면 미리보기를 굽지 않는다). */
  readonly projectId: string | undefined;
  readonly onOpenNode: () => void;
  readonly onOpenPast: (file: string) => void;
  readonly onContextMenu: (e: React.MouseEvent) => void;
  /** §5.4 #36 (J) ⑤ — 앱이 접으라고 선언한 묶음(칩). 이것이나 알약 구슬이 있으면 접는 줄로 그린다. */
  readonly fold?: readonly AppLinkedFoldGroup[] | undefined;
  /** §5.4 #36 (J) ⑤ — `stageFocus` 구슬을 한 번 눌렀다(노드 화면이 그것을 보인다). 앱 화면이 없으면 없다. */
  readonly onFocusItem?: ((itemId: string) => void) | undefined;
}

export const AppLinkedSatellites = memo(function AppLinkedSatellites(props: AppLinkedSatellitesProps): React.JSX.Element | null {
  // §5.4 #36 (J) ⑤ — 접기·알약은 앱이 읽기 결과로 선언한다. 선언하지 않은 앱 노드는 종전 구슬 줄 그대로다.
  if (props.fold !== undefined || props.items.some((i) => i.pill === true)) return <AppLinkedGlanceRow {...props} />;
  return <AppLinkedBeadRow {...props} />;
});

function AppLinkedBeadRow({
  items,
  pastFiles,
  nodeWidth,
  nodeHeight,
  glow,
  appId,
  appIcon,
  projectId,
  onOpenNode,
  onOpenPast,
  onContextMenu,
}: AppLinkedSatellitesProps): React.JSX.Element | null {
  const { t } = useTranslation();

  const row = useMemo(() => {
    const scenes: Bead[] = [];
    const parts: Bead[] = [];
    for (const item of items) (item.group === 'scene' ? scenes : parts).push({ type: 'item', item });
    const past: Bead[] = pastFiles.map((p) => ({ type: 'past', past: p }));
    return layoutBeadRow<Bead>([scenes, parts, past]);
  }, [items, pastFiles]);

  if (row.width === 0) return null;

  const size = APP_LINKED_ITEMS.beadSize;
  const drop = APP_LINKED_ITEMS.dropY;
  const height = drop + size / 2 + 4;
  const left = (nodeWidth - row.width) / 2;
  const hangX = nodeWidth / 2 - left;
  const xs = row.slots.map((s) => s.x).concat(row.moreX !== null ? [row.moreX] : []);
  const firstX = Math.min(hangX, ...xs);
  const lastX = Math.max(hangX, ...xs);
  const threadColor = glow;

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const beadBase = 'nodrag nopan pointer-events-auto absolute flex items-center justify-center overflow-hidden rounded-full border transition-transform duration-150 hover:scale-[1.12]';

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left, top: nodeHeight, width: row.width, height }}
      role="group"
      aria-label={t('canvas.linkedItems.rowLabel')}
    >
      {/* 노드에서 내려온 실 + 구슬을 꿴 가로 실(구슬 뒤에 깔린다). */}
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={row.width} height={height} aria-hidden="true">
        <path
          d={`M${hangX},0 V${drop} M${firstX},${drop} H${lastX}`}
          fill="none"
          stroke={threadColor}
          strokeOpacity={APP_LINKED_ITEMS.threadOpacity}
          strokeWidth={1}
          strokeLinecap="round"
        />
      </svg>
      {row.slots.map(({ item: bead, x }) => {
        const pos: React.CSSProperties = { left: x - size / 2, top: drop - size / 2, width: size, height: size, borderWidth: 1.5 };
        if (bead.type === 'past') {
          const file = bead.past.file;
          const title = `${t('canvas.linkedItems.past')} · ${linkedFileName(file)}\n${t('canvas.linkedItems.openPastHint')}`;
          return (
            <button
              key={`past:${file}`}
              type="button"
              title={title}
              aria-label={title}
              className={beadBase}
              style={{ ...pos, borderStyle: 'dashed', borderColor: `${glow}99`, background: BEAD_FILL, color: glow, opacity: 0.9 }}
              onPointerDown={stop}
              onClick={stop}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenPast(file);
              }}
              onContextMenu={onContextMenu}
            >
              <BeadPicture
                appId={appId}
                projectId={projectId}
                file={file}
                version={bead.past.at ?? 0}
                fallback={<span className="flex [&>svg]:h-3 [&>svg]:w-3">{appIcon}</span>}
              />
            </button>
          );
        }
        const item = bead.item;
        const title = itemTitle(item, t);
        const isScene = item.group === 'scene' && typeof item.index === 'number';
        const visual = isScene
          ? stageStyle(item.stage, glow)
          : { borderStyle: 'solid' as const, borderColor: `${glow}73`, background: BEAD_FILL, color: glow };
        // 장면·단계 구슬도 그림을 가질 수 있다(Vibi3D 단계의 대표 캡처) — 그 확장자를 받는 앱이 굽는다.
        const pictureApp = item.file !== undefined && (isScene || item.kind === 'image' || item.kind === 'video')
          ? thumbnailAppFor(item.file)
          : null;
        const steppedPicture = isScene && pictureApp !== null && item.file !== undefined;
        return (
          <Fragment key={item.id}>
          {steppedPicture ? (
            // 그림이 든 단계 구슬의 번호 — 구슬 밖 왼쪽 위(구슬은 안을 잘라 그리므로 안에 두면 잘린다).
            <span
              aria-hidden="true"
              className="pointer-events-none absolute z-10 flex items-center justify-center rounded-full border text-[12px] font-semibold leading-none tabular-nums"
              style={{
                left: x - size / 2 - 6,
                top: drop - size / 2 - 6,
                minWidth: 16,
                height: 16,
                padding: '0 3px',
                borderColor: glow,
                background: BEAD_FILL,
                color: glow,
              }}
            >
              {item.index}
            </span>
          ) : null}
          <button
            type="button"
            title={title}
            aria-label={title}
            className={beadBase}
            style={{ ...pos, ...visual }}
            onPointerDown={stop}
            onClick={stop}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpenNode();
            }}
            onContextMenu={onContextMenu}
          >
            {isScene && pictureApp !== null && item.file !== undefined ? (
              // 단계 구슬 — 안은 그 단계의 대표 그림(번호는 구슬 밖 왼쪽 위 표식 — 아래). 구슬을 늘어놓으면 자라는 과정이다.
              <BeadPicture
                appId={pictureApp}
                projectId={projectId}
                file={item.file}
                version={0}
                fallback={<span className="text-[12px] font-semibold leading-none tabular-nums">{item.index}</span>}
              />
            ) : isScene ? (
              <span className="text-[12px] font-semibold leading-none tabular-nums">{item.index}</span>
            ) : pictureApp !== null && item.file !== undefined ? (
              <BeadPicture appId={pictureApp} projectId={projectId} file={item.file} version={0} fallback={<KindGlyph kind={item.kind} />} />
            ) : (
              <KindGlyph kind={item.kind} />
            )}
            {item.active === true ? (
              // AI 가 지금 만지는 것 — 바깥 고리가 숨 쉰다(motion-safe: 움직임 줄이기면 멈춘 고리).
              <span
                className="pointer-events-none absolute -inset-[3px] rounded-full border motion-safe:animate-pulse"
                style={{ borderColor: glow }}
                aria-hidden="true"
              />
            ) : null}
          </button>
          </Fragment>
        );
      })}
      {row.moreX !== null ? (
        <span
          className="pointer-events-auto absolute flex items-center justify-center rounded-full border text-[12px] font-semibold leading-none tabular-nums"
          style={{
            left: row.moreX - size / 2,
            top: drop - size / 2,
            width: size,
            height: size,
            borderWidth: 1,
            borderColor: `${glow}59`,
            background: BEAD_FILL,
            color: glow,
          }}
          // 같은 뜻의 문구는 키 하나(i18n 규칙) — 목록 넘침 문구를 그대로 쓴다.
          title={t('ide.list.moreItems', { count: row.more })}
          onContextMenu={onContextMenu}
        >
          +{row.more}
        </span>
      ) : null}
    </div>
  );
}
