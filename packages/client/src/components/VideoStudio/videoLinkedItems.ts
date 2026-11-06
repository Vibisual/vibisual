/**
 * §5.4 #36 (J) ⑤ 영상 노드 아래 구슬 줄에 꿸 장면(`chapters`)과 소재(`assets`) — 모양·접기 규칙은 그 절.
 * 장면 대표 프레임은 §5.13 39-4 기억에 있는 것만 빌린다 — 굽기는 노드 화면 몫이라 여기서 구우면 같은 그림을 두 번 굽는다.
 * 문서·바퀴·바뀐 것은 노드 화면과 같은 기억(`videoGlance.ts`)에서 온다 — 따로 읽으면 판본마다 두 번 받는다.
 * 앱 REST 의 `project` 는 노드 화면과 같은 값 — 프로젝트 표시 이름(없으면 루트 경로)이다.
 */

import { APP_LINKED_ITEMS } from '@vibisual/shared';
import type { ChapterStatus, DocActivity, VideoAsset, VideoDoc } from '@vibisual/video';

import type {
  AppLinkedItem,
  AppLinkedItemKind,
  AppLinkedItemStage,
  AppLinkedItemsReader,
} from '../../apps/registry.js';
import { refreshGlance } from './videoGlance.js';
import { peekChapterThumbs } from './useChapterThumbs.js';

const STAGE: Readonly<Record<ChapterStatus, AppLinkedItemStage>> = {
  plan: 'plan',
  approved: 'ready',
  building: 'building',
  done: 'done',
};

const ASSET_KIND: Readonly<Record<VideoAsset['kind'], AppLinkedItemKind>> = {
  composition: 'code',
  image: 'image',
  model: 'file',
  video: 'video',
  audio: 'audio',
  font: 'font',
};

/** 소재 묶음 안의 차례 — 눈에 보이는 것이 먼저, 소리, 글꼴, AI 가 짓는 움직임(코드)은 맨 뒤(결과가 아니라 짓는 재료다). */
const ASSET_ORDER: Readonly<Record<VideoAsset['kind'], number>> = {
  image: 0,
  model: 0,
  video: 1,
  audio: 2,
  font: 3,
  composition: 4,
};

/** 구슬 미리보기를 구울 수 있는 경로인가 — 프로젝트 루트 기준 상대 경로만(절대 경로·드라이브·`..` ❌). */
export function projectRelativeAssetPath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/');
  if (p === '' || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length === 0 || segs.some((s) => s === '..')) return null;
  return segs.join('/');
}

function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '');
  return parts[parts.length - 1] ?? p;
}

/** 지금 AI 가 만지는 것(열린 바퀴의 초점). 닫힌 바퀴·초점 없음이면 없다. */
export function activeFocusOf(activity: DocActivity | null | undefined): string | undefined {
  return activity && activity.status === 'open' && typeof activity.focus === 'string' && activity.focus !== ''
    ? activity.focus
    : undefined;
}

export interface VideoLinkedOptions {
  /** AI 가 지금 만지는 장면·소재 id. */
  readonly focus?: string | undefined;
  /** 마지막 바퀴가 바꾼 장면 id. */
  readonly changed?: ReadonlySet<string> | undefined;
  /** 장면 id → 대표 프레임(기억에 있는 것만). */
  readonly thumbs?: Readonly<Record<string, string | null>> | undefined;
  /** 그림을 싣는 장면 수 상한(보이는 알약 수) — 구슬 줄 기억이 그림을 문서 장면 수만큼 붙들지 않게. */
  readonly imageLimit?: number | undefined;
}

/** 문서 → 구슬 목록(순수). 장면(알약) → 소재. `focus` 가 장면·소재 id 와 같으면 그 구슬이 숨 쉰다. */
export function videoDocLinkedItems(doc: VideoDoc, opts: VideoLinkedOptions = {}): AppLinkedItem[] {
  const { focus, changed, thumbs } = opts;
  const imageLimit = opts.imageLimit ?? Number.POSITIVE_INFINITY;
  const scenes: AppLinkedItem[] = (doc.chapters ?? []).map((c, i) => {
    const image = i < imageLimit ? thumbs?.[c.id] ?? null : null;
    return {
      id: `scene:${c.id}`,
      group: 'scene' as const,
      kind: 'scene' as const,
      label: c.title ?? '',
      index: i + 1,
      stage: STAGE[c.status] ?? 'plan',
      pill: true,
      stageFocus: true,
      ...(Number.isFinite(c.duration) && c.duration > 0 ? { durationSec: c.duration } : {}),
      ...(image ? { image } : {}),
      ...(changed?.has(c.id) ? { changed: true } : {}),
      ...(focus !== undefined && focus === c.id ? { active: true } : {}),
    };
  });
  const assets = Object.values(doc.assets)
    .filter((a): a is VideoAsset => !!a && typeof a.id === 'string')
    .sort((a, b) => (ASSET_ORDER[a.kind] ?? 9) - (ASSET_ORDER[b.kind] ?? 9));
  const parts: AppLinkedItem[] = assets.map((a) => {
    const rawPath = a.source.kind === 'file' ? a.source.path : undefined;
    const file = rawPath !== undefined ? projectRelativeAssetPath(rawPath) : null;
    return {
      id: `asset:${a.id}`,
      group: 'part' as const,
      kind: ASSET_KIND[a.kind] ?? 'file',
      label: rawPath !== undefined ? baseName(rawPath) : a.id,
      ...(file !== null ? { file } : {}),
      ...(typeof a.duration === 'number' && Number.isFinite(a.duration) && a.duration > 0 ? { durationSec: a.duration } : {}),
      ...(focus !== undefined && focus === a.id ? { active: true } : {}),
    };
  });
  return [...scenes, ...parts];
}

/** 레지스트리 `linkedItems` 가 부르는 읽기. 묶인 문서가 없는 노드(결과 파일만)에는 띄울 장면·소재가 없다 — `null`. */
export const readVibistudioLinkedItems: AppLinkedItemsReader = async (req) => {
  const docId = req.ref;
  if (docId === undefined || docId === '') return null;
  const project = req.projectName !== '' ? req.projectName : req.projectId;
  const glance = await refreshGlance(project, docId);
  if (!glance) return null;
  const focus = activeFocusOf(glance.info.activity);
  const thumbs = peekChapterThumbs(glance.wants);
  const items = videoDocLinkedItems(glance.doc, { focus, changed: glance.targets.chapters, thumbs, imageLimit: APP_LINKED_ITEMS.maxVisible });
  const pictured = items.filter((i) => i.image !== undefined).length;
  return {
    key: `${glance.doc.version}:${glance.doc.updatedAt}:${focus ?? ''}:${glance.pass?.id ?? ''}:${glance.targets.chapters.size}:${pictured}`,
    items,
    fold: ['part', 'past'],
  };
};
