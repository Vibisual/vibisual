import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AppBubblePastFile } from '@vibisual/shared';
import { APP_LINKED_ITEMS, linkedFileName } from '@vibisual/shared';

import type { AppLinkedItem, AppLinkedItemKind, AppLinkedItemStage } from '../../apps/registry.js';
import { thumbnailAppFor } from '../../apps/appLinkedItems.js';
import { thumbPixelSize, useAppThumbnail } from '../../apps/appThumbnails.js';
import { layoutBeadRow } from './linkedBeads.js';

/**
 * AppLinkedSatellites.tsx — §5.4 #36 (H) ③ 앱 노드 아래 **구슬 줄**("연결된 것" 위성).
 *
 * 노드 아래 가운데에서 짧은 실이 내려와 가로 실을 잡고, 그 실에 구슬이 꿰인다 — 위성줄(구슬 줄)·궤도 위성과 같은 캔버스
 * 언어다. 무엇을 꿸지는 앱이 레지스트리 `linkedItems` 로 선언하고(장면·소재 등), 코어는 그 목록과 노드의 **지난 결과**만
 * 그린다(앱 이름을 모른다 — §5.13 (P-4)).
 *
 * - 장면: 번호 구슬. 테가 단계를 말한다 — 기획 = 점선 · 승인 = 실선 · 짓는 중 = 아래 반이 참 · 끝 = 채움.
 * - 소재: 종류 아이콘. 그림·영상 파일이면 구슬 안에 작은 미리보기(노드 화면과 같은 기억 장소 — `appThumbnails`).
 * - 지난 결과: 점선 테. 그 노드의 앱이 굽는 미리보기(그 노드에 담겼던 결과다).
 * - AI 가 지금 만지는 것은 바깥 고리가 숨 쉰다(움직임 줄이기면 멈춘다).
 *
 * 구슬은 `nodrag nopan` — 그 위에서 누른 손은 노드를 끌지 않고 열기를 기다린다. 더블클릭: 장면·소재는 노드의 편집기,
 * 지난 결과는 그 파일을 그 앱으로. 우클릭은 노드 메뉴. 이름·단계·길이는 툴팁이다(제목·파일 이름은 사용자 내용 — 번역 ❌).
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
}

/** 구슬 바탕 — 노드 화면(`#07090D`)과 같은 어둠이라 구슬이 그 노드의 것으로 읽힌다. */
const BEAD_FILL = '#07090D';

function stageStyle(stage: AppLinkedItemStage | undefined, glow: string): React.CSSProperties {
  switch (stage) {
    case 'plan':
      return { borderStyle: 'dashed', borderColor: `${glow}B3`, background: BEAD_FILL, color: glow };
    case 'ready':
      return { borderStyle: 'solid', borderColor: glow, background: BEAD_FILL, color: glow };
    case 'building':
      return {
        borderStyle: 'solid',
        borderColor: glow,
        background: `linear-gradient(to top, ${glow}66 50%, ${BEAD_FILL} 50%)`,
        color: '#FFFFFF',
      };
    case 'done':
    default:
      return { borderStyle: 'solid', borderColor: glow, background: glow, color: BEAD_FILL };
  }
}

/** 구슬 안 종류 아이콘 — lucide 톤 stroke(이모지 ❌). 장면은 아이콘 대신 번호라 여기 없다. */
function KindGlyph({ kind }: { kind: AppLinkedItemKind }): React.JSX.Element {
  const paths = ((): React.JSX.Element => {
    switch (kind) {
      case 'image':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </>
        );
      case 'video':
        return (
          <>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m10 9 5 3-5 3z" />
          </>
        );
      case 'audio':
        return <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 11v2" />;
      case 'model':
        return (
          <>
            <path d="M12 2.6 21 7.3v9.4L12 21.4 3 16.7V7.3z" />
            <path d="M3 7.3 12 12l9-4.7M12 12v9.4" />
          </>
        );
      case 'font':
        return <path d="M4 7V4h16v3M9 20h6M12 4v16" />;
      case 'code':
        return <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />;
      case 'text':
        return <path d="M17 6.1H3M21 12.1H3M15.1 18H3" />;
      case 'scene':
      case 'file':
      default:
        return (
          <>
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </>
        );
    }
  })();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

/** 구슬 안 작은 미리보기 — 그림이면 둥글게 잘라 채우고, 못 구웠거나 그림이 아니면(파형) 아이콘으로 둔다. */
function BeadPicture({
  appId,
  projectId,
  file,
  version,
  fallback,
}: {
  appId: string | null;
  projectId: string | undefined;
  file: string;
  version: number;
  fallback: React.ReactNode;
}): React.JSX.Element {
  const inner = APP_LINKED_ITEMS.beadSize - 2;
  const px = thumbPixelSize(inner, inner, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const state = useAppThumbnail(
    appId !== null && projectId !== undefined
      ? { appId, projectId, file, version, width: px.width, height: px.height }
      : null,
  );
  const thumb = state.status === 'ready' ? state.thumb : null;
  if (thumb !== null && thumb.kind === 'picture') {
    return <img src={thumb.url} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />;
  }
  return <>{fallback}</>;
}

function formatSeconds(sec: number): string {
  return sec >= 10 ? String(Math.round(sec)) : String(Math.round(sec * 10) / 10);
}

function itemTitle(item: AppLinkedItem, t: TFunction): string {
  const lines: string[] = [];
  if (item.group === 'scene' && typeof item.index === 'number') {
    lines.push(
      item.label !== ''
        ? t('canvas.linkedItems.scene', { index: item.index, title: item.label })
        : t('canvas.linkedItems.sceneUntitled', { index: item.index }),
    );
    if (item.stage) lines.push(t(`canvas.linkedItems.stage.${item.stage}`));
  } else {
    lines.push(`${t(`canvas.linkedItems.kind.${item.kind}`)} · ${item.label}`);
  }
  if (typeof item.durationSec === 'number' && item.durationSec > 0) {
    lines.push(t('canvas.linkedItems.seconds', { seconds: formatSeconds(item.durationSec) }));
  }
  if (item.active === true) lines.push(t('canvas.linkedItems.active'));
  return `${lines.join(' · ')}\n${t('panel.apps.openHint', { defaultValue: '더블클릭하면 열립니다.' })}`;
}

export const AppLinkedSatellites = memo(function AppLinkedSatellites({
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
        const pictureApp = !isScene && item.file !== undefined && (item.kind === 'image' || item.kind === 'video')
          ? thumbnailAppFor(item.file)
          : null;
        return (
          <button
            key={item.id}
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
            {isScene ? (
              <span className="text-[11px] font-semibold leading-none tabular-nums">{item.index}</span>
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
        );
      })}
      {row.moreX !== null ? (
        <span
          className="pointer-events-auto absolute flex items-center justify-center rounded-full border text-[11px] font-semibold leading-none tabular-nums"
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
});
