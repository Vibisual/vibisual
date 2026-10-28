/**
 * §5.13 (Q) — 콘티를 받는 자리. 코어는 이 파일을 이름으로 모른다(레지스트리 `storyboard.accept` 늦은 로더로만 — 앱이 없으면 안 실린다, §5.13 (P-1)).
 * 계산은 `@vibisual/video` 순수 함수, 여기는 REST 순서만.
 */

import { buildStoryboardOps } from '@vibisual/video';
import type { StoryboardHandoffArgs, StoryboardHandoffResult } from '../../apps/registry.js';
import { createDoc, patchDoc, startRender } from './videoApi.js';

/** 이 앱의 id. 레지스트리 항목과 같은 값이어야 한다. */
const APP_ID = 'vibistudio';

/** 문서 제목 — 콘티 제목이 없으면 첫 컷 제목, 그것도 없으면 무제. */
function docTitle(args: StoryboardHandoffArgs): string {
  const fromConti = args.conti.title?.trim();
  if (fromConti) return fromConti;
  const first = args.conti.frames[0]?.title?.trim();
  return first && first !== '' ? first : 'Storyboard';
}

export async function acceptStoryboard(args: StoryboardHandoffArgs): Promise<StoryboardHandoffResult> {
  const title = docTitle(args);
  const doc = await createDoc(args.projectId, title);

  const ops = buildStoryboardOps({ frames: args.conti.frames, preset: args.preset, title });
  // 방금 만든 문서라 `baseVersion` 은 그 문서의 것 그대로다 — 낙관적 잠금 규약은 이 한 줄로 지켜진다.
  await patchDoc(args.projectId, doc.id, doc.version, ops);

  if (args.render === false) {
    return { appId: APP_ID, docId: doc.id, status: 'queued' };
  }

  const job = await startRender(args.projectId, doc.id);
  return { appId: APP_ID, docId: doc.id, jobId: job.id, status: job.status };
}
