import type { TFunction } from 'i18next';
import { APP_LINKED_ITEMS, fileFaceKindOf, previewLaneOf } from '@vibisual/shared';

import type { AppLinkedItem, AppLinkedItemKind, AppLinkedItemStage } from '../../apps/registry.js';
import { thumbPixelSize, useAppThumbnail } from '../../apps/appThumbnails.js';
import { usePreviewGrant } from '../../apps/previewBudget.js';

/**
 * §5.4 #36 (H) ③ · (J) ⑤ — 구슬 줄 부품 한 벌(테 모양 · 종류 아이콘 · 구슬 안 미리보기 · 툴팁). 구슬 줄(`AppLinkedSatellites`)과
 * 접는 줄(`AppLinkedGlanceRow`)이 같은 것을 그린다 — 두 벌이면 같은 단계가 줄마다 다른 테로 보인다.
 */

/** 구슬 바탕 — 노드 화면(`#07090D`)과 같은 어둠이라 구슬이 그 노드의 것으로 읽힌다. */
export const BEAD_FILL = '#07090D';

export function stageStyle(stage: AppLinkedItemStage | undefined, glow: string): React.CSSProperties {
  switch (stage) {
    case 'plan':
      return { borderStyle: 'dashed', borderColor: `${glow}B3`, background: BEAD_FILL, color: glow };
    case 'proposed':
      // 제안 대기 — 기획과 같은 점선이되 테를 또렷하게(사람이 고를 차례다).
      return { borderStyle: 'dashed', borderColor: glow, background: BEAD_FILL, color: glow };
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
export function KindGlyph({ kind }: { kind: AppLinkedItemKind }): React.JSX.Element {
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
      case 'shape':
        // 도형 레이어 — 네모와 원이 겹친 그림(우리가 그린 획).
        return <path d="M3 3h10v10H3zM13.5 9a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" />;
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
export function BeadPicture({
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
  // §5.1 #2-1 (G) ②③ — 구슬 안 미리보기도 화면 기준(구슬 크기에 맞춘 문턱)·한눈 기준 안에서만 굽고 그린다.
  const granted = usePreviewGrant(appId !== null && projectId !== undefined ? `bead:${appId}:${projectId}:${file}` : null, inner, { small: true });
  const lane = previewLaneOf(fileFaceKindOf(file)) ?? undefined;
  const state = useAppThumbnail(
    granted && appId !== null && projectId !== undefined
      ? { appId, projectId, file, version, width: px.width, height: px.height, ...(lane ? { lane } : {}) }
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

/** 구슬 툴팁 — 이름·단계·길이·바뀜·AI 가 만지는 중 + 손짓 안내(한 번 누르면 화면에 · 두 번이면 편집기). 제목은 사용자 내용이라 번역하지 않는다. */
export function itemTitle(item: AppLinkedItem, t: TFunction): string {
  const lines: string[] = [];
  if (item.group === 'scene' && typeof item.index === 'number') {
    // 번호 구슬이 세는 것 — 장면(영상) · 만드는 단계(3D) · 고르기 전 제안(그림). §5.1 #2-1 (F) 앱별.
    const word = item.numbered ?? 'scene';
    lines.push(
      item.label !== ''
        ? t(`canvas.linkedItems.${word}`, { index: item.index, title: item.label })
        : t(`canvas.linkedItems.${word}Untitled`, { index: item.index }),
    );
    if (item.stage) lines.push(t(`canvas.linkedItems.stage.${item.stage}`));
    if (typeof item.pictureCount === 'number' && item.pictureCount > 0) {
      lines.push(t('canvas.linkedItems.pictures', { count: item.pictureCount }));
    }
  } else {
    lines.push(`${t(`canvas.linkedItems.kind.${item.kind}`)} · ${item.label}`);
  }
  if (typeof item.durationSec === 'number' && item.durationSec > 0) {
    lines.push(t('canvas.linkedItems.seconds', { seconds: formatSeconds(item.durationSec) }));
  }
  if (item.changed === true) lines.push(t('canvas.linkedItems.changed'));
  if (item.active === true) lines.push(t('canvas.linkedItems.active'));
  const hint = item.stageFocus === true
    ? t('canvas.linkedItems.focusHint')
    : t('panel.apps.openHint', { defaultValue: '더블클릭하면 열립니다.' });
  return `${lines.join(' · ')}\n${hint}`;
}
