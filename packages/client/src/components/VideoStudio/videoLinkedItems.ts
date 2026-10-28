/**
 * §5.4 #36 (H) ③ 영상 노드의 "연결된 것" — 노드 아래 구슬 줄에 꿸 장면과 소재.
 * - 장면(`chapters`) — 영상의 뼈대. 시간 순 번호 구슬이고 기획·승인·짓는 중·끝이 테의 모양으로 보인다. AI 가 지금 만지는 장면(판본 응답의 활동 표식)은 숨 쉰다.
 * - 소재(`assets`) — AI 가 짓는 움직임(컴포지션 코드)이 먼저, 그다음 그림·영상·소리·글꼴. 프로젝트 안 상대 경로면 코어가 그림·영상의 작은 미리보기를 굽는다.
 * 비용: 판본만 먼저 묻고(`/doc/:id/version` — 싸다) 판본이 바뀌었을 때만 문서를 읽는다. 활동 표식은 판본 응답에 오므로 그 구슬만 바꾼다.
 * 앱 REST 의 `project` 는 노드 화면(`VideoCanvasFace`)과 같은 값 — 프로젝트 표시 이름(없으면 루트 경로)이다.
 */

import type { ChapterStatus, DocActivity, VideoAsset, VideoDoc } from '@vibisual/video';

import type {
  AppLinkedItem,
  AppLinkedItemKind,
  AppLinkedItemStage,
  AppLinkedItemsReader,
} from '../../apps/registry.js';
import { readDoc, readDocVersion } from './videoApi.js';

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

/** 소재 묶음 안의 차례 — AI 가 짓는 움직임(코드)이 먼저, 그다음 눈에 보이는 것, 소리, 글꼴. */
const ASSET_ORDER: Readonly<Record<VideoAsset['kind'], number>> = {
  composition: 0,
  image: 1,
  model: 1,
  video: 2,
  audio: 3,
  font: 4,
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

/** 문서 → 구슬 목록(순수). 장면 → 소재. `focus` 가 장면·소재 id 와 같으면 그 구슬이 숨 쉰다. */
export function videoDocLinkedItems(doc: VideoDoc, focus?: string): AppLinkedItem[] {
  const scenes: AppLinkedItem[] = (doc.chapters ?? []).map((c, i) => ({
    id: `scene:${c.id}`,
    group: 'scene' as const,
    kind: 'scene' as const,
    label: c.title ?? '',
    index: i + 1,
    stage: STAGE[c.status] ?? 'plan',
    ...(Number.isFinite(c.duration) && c.duration > 0 ? { durationSec: c.duration } : {}),
    ...(focus !== undefined && focus === c.id ? { active: true } : {}),
  }));
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

/** 같은 문서는 판본이 같은 동안 다시 읽지 않는다 — 열쇠는 (project, 문서). 노드 수만큼만 남는다. */
interface DocItems {
  readonly version: number;
  readonly updatedAt: number;
  readonly items: readonly AppLinkedItem[];
}
const DOC_CACHE_MAX = 32;
const docCache = new Map<string, DocItems>();

function remember(key: string, value: DocItems): void {
  docCache.delete(key);
  docCache.set(key, value);
  while (docCache.size > DOC_CACHE_MAX) {
    const oldest = docCache.keys().next().value;
    if (oldest === undefined) break;
    docCache.delete(oldest);
  }
}

/** 레지스트리 `linkedItems` 가 부르는 읽기. 묶인 문서가 없는 노드(결과 파일만)에는 띄울 장면·소재가 없다 — `null`. */
export const readVibistudioLinkedItems: AppLinkedItemsReader = async (req) => {
  const docId = req.ref;
  if (docId === undefined || docId === '') return null;
  const project = req.projectName !== '' ? req.projectName : req.projectId;
  const version = await readDocVersion(project, docId);
  const cacheKey = JSON.stringify([project, docId]);
  let hit = docCache.get(cacheKey);
  if (!hit || hit.version !== version.version || hit.updatedAt !== version.updatedAt) {
    const env = await readDoc(project, docId);
    hit = { version: env.doc.version, updatedAt: env.doc.updatedAt, items: videoDocLinkedItems(env.doc) };
    remember(cacheKey, hit);
  }
  const focus = activeFocusOf(version.activity);
  const items = focus === undefined
    ? hit.items
    : hit.items.map((it) => (it.id === `scene:${focus}` || it.id === `asset:${focus}` ? { ...it, active: true } : it));
  return { key: `${hit.version}:${hit.updatedAt}:${focus ?? ''}`, items };
};
