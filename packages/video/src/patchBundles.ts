/**
 * §5.13 (G) 묶음 op → 기존 op 열. 풀린 op 는 같은 `applyPatch` 를 지나므로 낙관적 잠금·전부 아니면 전무가 그대로다.
 * 새 장면·아이템·소재 id 는 호출자가 정한 것을 그대로 쓴다(서버가 만들지 않는다 — 미리 검사와 적용이 같은 문서를 낸다).
 */

import { checkOpShape, isBundleOpName, isRecord, type FixDraft } from './patchShape.js';
import type { PatchFix, TimeAnchor, VideoAsset, VideoBundleItem, VideoDocBundleOp, VideoDocOp, VideoItem } from './types.js';

/** 풀린 op 하나가 요청의 어디서 왔나. `paths` = 풀린 op 의 필드 뿌리 → 요청 op 안 경로(고칠 방법의 `field` 를 요청 기준으로 옮긴다). */
export interface PatchOpOrigin {
  readonly opIndex: number;
  readonly op: string;
  readonly part?: number;
  readonly paths?: Readonly<Record<string, string>>;
}

export interface ExpandedPatch {
  readonly ops: readonly VideoDocOp[];
  readonly origin: readonly PatchOpOrigin[];
  /** 묶음 op 가 하나라도 있었나 — 없으면 `ops` 는 받은 배열 그대로다. */
  readonly bundled: boolean;
}

export type ExpandResult =
  | { readonly ok: true; readonly value: ExpandedPatch }
  | { readonly ok: false; readonly opIndex: number; readonly message: string; readonly fix: readonly PatchFix[] };

/** 고칠 방법 초안을 요청 기준으로(순번·묶음 몇 번째·경로). */
export function placeFix(draft: FixDraft, origin: PatchOpOrigin): PatchFix {
  let field = draft.field;
  if (field !== undefined && origin.paths) {
    const root = field.split(/[.[]/, 1)[0] ?? '';
    const mapped = origin.paths[root];
    if (mapped !== undefined) field = `${mapped}${field.slice(root.length)}`;
  }
  return {
    ...draft,
    ...(field !== undefined ? { field } : {}),
    opIndex: origin.opIndex,
    op: origin.op,
    ...(origin.part !== undefined ? { part: origin.part } : {}),
  };
}

function chapterAnchor(chapterId: string, offset: number | undefined): TimeAnchor {
  return offset === undefined ? { chapter: chapterId } : { chapter: chapterId, offset };
}

function sceneItemOp(chapterId: string, entry: VideoBundleItem): VideoDocOp {
  const item: VideoItem = { ...entry.item, chapterId, at: entry.item.at ?? chapterAnchor(chapterId, entry.offset) };
  return { op: 'addItem', trackId: entry.trackId, item, ...(entry.beforeItemId !== undefined ? { beforeItemId: entry.beforeItemId } : {}) };
}

/** 묶음 하나 → 기존 op 열과 각 op 의 경로 지도. 모양 검사를 통과한 묶음만 받는다. */
function expandBundle(op: VideoDocBundleOp): Array<{ op: VideoDocOp; paths: Record<string, string> }> {
  const out: Array<{ op: VideoDocOp; paths: Record<string, string> }> = [];
  const assets = (list: readonly VideoAsset[] | undefined): void => {
    (list ?? []).forEach((asset, i) => out.push({ op: { op: 'setAsset', asset }, paths: { asset: `assets[${i}]` } }));
  };
  const items = (chapterId: string, list: readonly VideoBundleItem[] | undefined): void => {
    (list ?? []).forEach((entry, i) => out.push({
      op: sceneItemOp(chapterId, entry),
      paths: { trackId: `items[${i}].trackId`, item: `items[${i}].item`, beforeItemId: `items[${i}].beforeItemId` },
    }));
  };
  switch (op.op) {
    case 'addScene':
      out.push({
        op: { op: 'addChapter', chapter: op.chapter, ...(op.beforeChapterId !== undefined ? { beforeChapterId: op.beforeChapterId } : {}) },
        paths: { chapter: 'chapter', beforeChapterId: 'beforeChapterId' },
      });
      assets(op.assets);
      items(op.chapter.id, op.items);
      return out;
    case 'fillChapter':
      // 빈 patch 라도 먼저 둔다 — 없는 장면이면 첫 op 에서 실패해 아이템이 없는 장면에 매달리지 않는다.
      out.push({ op: { op: 'updateChapter', chapterId: op.chapterId, patch: op.status !== undefined ? { status: op.status } : {} }, paths: { chapterId: 'chapterId' } });
      assets(op.assets);
      items(op.chapterId, op.items);
      return out;
    case 'placeAsset': {
      if (op.chapterId !== undefined) out.push({ op: { op: 'updateChapter', chapterId: op.chapterId, patch: {} }, paths: { chapterId: 'chapterId' } });
      out.push({ op: { op: 'setAsset', asset: op.asset }, paths: { asset: 'asset' } });
      // 모양 검사가 `at` 도 `chapterId` 도 없는 placeAsset 을 막는다.
      const at = op.item.at ?? chapterAnchor(op.chapterId as string, op.offset);
      const item: VideoItem = { ...op.item, assetId: op.asset.id, ...(op.chapterId !== undefined ? { chapterId: op.chapterId } : {}), at };
      out.push({
        op: { op: 'addItem', trackId: op.trackId, item, ...(op.beforeItemId !== undefined ? { beforeItemId: op.beforeItemId } : {}) },
        paths: { trackId: 'trackId', item: 'item', beforeItemId: 'beforeItemId' },
      });
      return out;
    }
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

/**
 * 요청 ops → 기존 op 열. 묶음이 없으면 받은 배열을 그대로 돌려준다(종전 요청은 종전 길 그대로).
 * 묶음 모양이 하나라도 틀리면 아무것도 풀지 않고 틀린 곳 전부를 돌려준다.
 */
export function expandPatchOps(ops: readonly unknown[]): ExpandResult {
  const bundled = ops.some((op) => isRecord(op) && isBundleOpName(op['op']));
  if (!bundled) {
    return {
      ok: true,
      value: { ops: ops as readonly VideoDocOp[], origin: ops.map((op, i) => ({ opIndex: i, op: isRecord(op) && typeof op['op'] === 'string' ? op['op'] : '' })), bundled: false },
    };
  }
  const fix: PatchFix[] = [];
  let firstBad = -1;
  ops.forEach((op, i) => {
    if (!isRecord(op) || !isBundleOpName(op['op'])) return;
    const errors = checkOpShape(op).filter((d) => d.level === 'error');
    if (errors.length === 0) return;
    if (firstBad < 0) firstBad = i;
    fix.push(...errors.map((d) => placeFix(d, { opIndex: i, op: String(op['op']) })));
  });
  if (firstBad >= 0) {
    const first = fix[0];
    return { ok: false, opIndex: firstBad, message: first ? `${first.field ? `${first.field}: ` : ''}${first.hint}` : 'invalid bundle op', fix };
  }

  const expanded: VideoDocOp[] = [];
  const origin: PatchOpOrigin[] = [];
  ops.forEach((op, i) => {
    const name = isRecord(op) && typeof op['op'] === 'string' ? op['op'] : '';
    if (!isRecord(op) || !isBundleOpName(name)) {
      expanded.push(op as VideoDocOp);
      origin.push({ opIndex: i, op: name });
      return;
    }
    expandBundle(op as unknown as VideoDocBundleOp).forEach((part, k) => {
      expanded.push(part.op);
      origin.push({ opIndex: i, op: name, part: k, paths: part.paths });
    });
  });
  return { ok: true, value: { ops: expanded, origin, bundled: true } };
}
