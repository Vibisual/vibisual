import type { TFunction } from 'i18next';
import { passTouchesScene, type PassRecord, type VideoChapter } from '@vibisual/video';

import type { StudioSceneChat } from './StudioAiPanel.js';

/** §5.13 (V) 37-23 (I) — 장면별 대화 거르개 값(순수). AI 패널 거르개·카드의 [이 장면 대화]·팔레트가 같은 값을 본다. */

/** 장면 → 그 장면을 만진 바퀴 id 들. 바퀴 목록이 같으면 같은 집합을 돌려준다(대화 조립·패널 memo 가 깨지지 않게). */
const scenePassCache = new WeakMap<readonly PassRecord[], Map<string, ReadonlySet<string>>>();
export function scenePassIds(passes: readonly PassRecord[], chapterId: string): ReadonlySet<string> {
  let byScene = scenePassCache.get(passes);
  if (!byScene) { byScene = new Map(); scenePassCache.set(passes, byScene); }
  const hit = byScene.get(chapterId);
  if (hit) return hit;
  const made = new Set(passes.filter((pass) => passTouchesScene(pass, chapterId)).map((pass) => pass.id));
  byScene.set(chapterId, made);
  return made;
}

/** 대화 거르개 값 — 지금 문서에 없는 장면을 골라 둔 채면 전체로 본다. */
export function sceneChatOf(
  t: TFunction, chapters: readonly { readonly id: string; readonly chapter: VideoChapter }[], passes: readonly PassRecord[],
  value: string | null, onChange: (chapterId: string | null) => void,
): StudioSceneChat | null {
  if (chapters.length === 0) return null;
  const options = chapters.map((c, i) => ({ chapterId: c.id, label: t('panel.videoStudio.sceneReview.sceneTitle', { n: i + 1, title: c.chapter.title }) }));
  const picked = value && chapters.some((c) => c.id === value) ? value : null;
  return { value: picked, options, onChange, passIds: picked ? scenePassIds(passes, picked) : null };
}
