import { useMemo } from 'react';
import { previewLaneOf, previewTooLarge } from '@vibisual/shared';

import { thumbBakeBox, thumbPixelSize, useSteadyThumbnail, type ThumbState } from '../../apps/appThumbnails.js';
import { usePreviewGrant } from '../../apps/previewBudget.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { fileMediaTarget, type FileFace, type FileMediaTarget } from '../../utils/fileFaceView.js';

/**
 * §5.1 #2-1 (A) — 파일 버블 렌즈의 미리보기. 앱 위성 화면과 **같은 기억 장소**(`appThumbnails` — 열쇠·상한·동시 건수·시간
 * 상한 공유)를 쓴다 — 무엇을 어떻게 굽는지는 그 확장자를 받겠다고 선언한 앱이 정하고(`face.appId`), 여기는 일감만 만든다.
 *
 * - 굽는 크기는 `APP_THUMB.bakeStep` 칸으로 올려 잡는다 — 히트맵·별자리로 지름이 조금 바뀔 때마다 다시 굽지 않게.
 * - 크기가 바뀌어 다시 굽는 동안은 앞 그림을 그대로 둔다(`useSteadyThumbnail`).
 * - 프로젝트 루트 밖이면 일감을 만들지 않는다(미디어 창구가 루트 밖을 막는다 — 얼굴의 글리프로 남는다).
 * - 렌즈와 이름 줄이 같은 열쇠로 부르므로 굽는 것은 한 번이다(같은 기억 칸을 나눠 구독한다).
 *
 * §5.1 #2-1 (G) — **앱을 무겁게 하는 미리보기는 굽지 않는다.** ① 파일 기준(스냅샷의 `fileSize` 로 종류별 상한 — 요청 0건)을
 * 넘으면 일감이 없고, ②③ 화면 기준 · 한눈 기준(`usePreviewGrant` — 작게 보이면 · 한 화면 속 상한 밖이면)이 허락하지 않아도
 * 일감이 없다. 일감이 없으면 렌즈는 갈래 아이콘이다. ④ 움직이는 동안 쉬기는 기억 장소가 한다.
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
  const roots = useMemo(() => Object.values(projects).map((p) => p.path), [projects]);
  const target = useMemo(
    () => (face !== null && face.media && face.appId !== null ? fileMediaTarget(absPath, roots) : null),
    [face, absPath, roots],
  );
  // ① 파일 기준 — 굽기 전에 가른다(요청 0건). 크기를 모르면 굽는 함수가 먼저 묻는다.
  const tooLarge = target !== null && previewTooLarge(target.rel, opts.bytes);
  // ②③ 화면 기준 · 한눈 기준 — 이름을 올린 자리 중 허락받은 것만 굽고 그린다.
  const granted = usePreviewGrant(target !== null && !tooLarge && opts.id ? `face:${opts.id}` : null, size, {
    active: opts.active === true,
    last: opts.last ?? 0,
  });
  const box = thumbBakeBox(size, size);
  const px = thumbPixelSize(box.width, box.height, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const appId = face?.appId ?? null;
  const lane = face ? previewLaneOf(face.kind) ?? undefined : undefined;
  const allowed = target !== null && !tooLarge && (opts.id === undefined || granted);
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
  return { state, target, blocked: tooLarge ? 'tooLarge' : null };
}
