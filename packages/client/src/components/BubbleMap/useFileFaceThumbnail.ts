import { useMemo } from 'react';
import { previewLaneOf, previewTooLarge } from '@vibisual/shared';

import { thumbnailSkipped } from '../../apps/appLinkedItems.js';
import { thumbBakeBox, thumbPixelSize, useSteadyThumbnail, type ThumbState } from '../../apps/appThumbnails.js';
import { usePreviewGrant } from '../../apps/previewBudget.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { activeProjectRoot, fileMediaTarget, type FileFace, type FileMediaTarget } from '../../utils/fileFaceView.js';

/**
 * §5.1 #2-1 (A) — 파일 버블 렌즈 미리보기. 앱 위성과 같은 기억 장소(`appThumbnails`), 굽는 법은 그 확장자를 선언한 앱(`face.appId`)이 정한다.
 * 크기는 `APP_THUMB.bakeStep` 칸으로 올리고(지름이 조금 바뀔 때마다 다시 굽지 않게) 다시 굽는 동안 앞 그림을 둔다. 렌즈·이름 줄은 같은 열쇠.
 * 루트 밖 파일은 **지금 탭의 프로젝트 + 절대경로**로 굽는다(열린 탭이 없으면 일감 없음). 움직이는 동안 쉬기는 기억 장소 몫.
 * (G) 무거운 미리보기는 굽지 않는다 — 파일·화면·한눈 기준(`fileSize`·`usePreviewGrant`)·`thumbnailSkips` 면 일감 없음. 굽는 함수가 잰 상한도 `blocked` = `tooLarge`.
 */
export function useFileFaceThumbnail(
  face: FileFace | null,
  absPath: string | undefined,
  version: number,
  size: number,
  opts: {
    /** 미리보기 자리의 이름(노드 id) — 한 화면 속 상한이 이 이름으로 고른다. */
    readonly id?: string | undefined;
    /** 스냅샷의 파일 크기(bytes). */
    readonly bytes?: number | undefined;
    readonly active?: boolean | undefined;
    readonly last?: number | undefined;
  } = {},
): { readonly state: ThumbState; readonly target: FileMediaTarget | null; readonly blocked: 'tooLarge' | null } {
  const projects = useGraphStore((s) => s.projects);
  const owner = useGraphStore(activeProjectRoot);
  const roots = useMemo(() => Object.values(projects).map((p) => p.path), [projects]);
  const target = useMemo(
    () => (face !== null && face.media && face.appId !== null ? fileMediaTarget(absPath, roots, owner) : null),
    [face, absPath, roots, owner],
  );
  // ① 파일 기준 — 굽기 전에 가른다(요청 0건). 크기를 모르면 굽는 함수가 먼저 묻는다.
  const tooLarge = target !== null && previewTooLarge(target.rel, opts.bytes);
  // ⑦ 그 앱이 못 푼다고 선언한 확장자 — 굽지 않는다(아이콘 · 툴팁 없음 — 크기 탓이 아니다).
  const skipped = target !== null && face !== null && face.appId !== null && thumbnailSkipped(face.appId, target.rel);
  // ②③ 화면 기준 · 한눈 기준 — 이름을 올린 자리 중 허락받은 것만 굽고 그린다.
  const granted = usePreviewGrant(target !== null && !tooLarge && !skipped && opts.id ? `face:${opts.id}` : null, size, {
    active: opts.active === true,
    last: opts.last ?? 0,
  });
  const box = thumbBakeBox(size, size);
  const px = thumbPixelSize(box.width, box.height, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const appId = face?.appId ?? null;
  const lane = face ? previewLaneOf(face.kind) ?? undefined : undefined;
  const allowed = target !== null && !tooLarge && !skipped && (opts.id === undefined || granted);
  const job = useMemo(
    () => (allowed && target !== null && appId !== null
      ? {
        appId, projectId: target.root, file: target.rel, version, width: px.width, height: px.height,
        ...(lane ? { lane } : {}),
        ...(typeof opts.bytes === 'number' ? { bytes: opts.bytes } : {}),
      }
      : null),
    [allowed, target, appId, version, px.width, px.height, lane, opts.bytes],
  );
  const state = useSteadyThumbnail(job);
  return { state, target, blocked: tooLarge || state.reason === 'tooLarge' ? 'tooLarge' : null };
}
