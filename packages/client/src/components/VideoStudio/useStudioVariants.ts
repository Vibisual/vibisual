import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { anchorItemRef, chapterIdOf, effectivePick, type ChapterVariant, type ResolvedTimeline, type VideoDoc, type VideoDocOp, type VideoEngineKind } from '@vibisual/video';

import type { StudioComposerState } from './useStudioComposer.js';

/**
 * §5.13 (V) 37-14 — **두 엔진 나란히**. 구슬 메뉴의 [두 엔진 나란히] → 그 장면에 갈래 둘(Claude·Codex)을 만들고 각 엔진의
 * 에이전트(없으면 기존 스폰 경로로 만들어 같은 노드에 잇는다 — `useStudioAgent.send`)에게 자기 갈래로 짓게 한다. 지금 장면의
 * 아이템은 첫 갈래(Claude)의 것으로 옮겨 적는다 — 아무것도 버리지 않는다. 고르기 전에는 첫 갈래가 보인다.
 * [이걸로] → 장면 `pick`. [안 고른 쪽 지우기] → 고르지 않은 갈래의 아이템과 갈래 기록을 지운다(사람이 누를 때만).
 */
const ENGINES: readonly VideoEngineKind[] = ['claude', 'codex'];

function newVariantId(doc: VideoDoc, chapterId: string, engine: VideoEngineKind): string {
  const used = new Set((doc.chapters ?? []).flatMap((c) => (c.variants ?? []).map((v) => v.id)));
  const base = `${chapterId}-${engine}`.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48);
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

export interface StudioVariants {
  /** 비교 판을 띄운 장면(없으면 null). */
  readonly compareChapterId: string | null;
  readonly openCompare: (chapterId: string) => void;
  readonly closeCompare: () => void;
  readonly start: (chapterId: string) => Promise<void>;
  readonly pick: (chapterId: string, variantId: string) => void;
  readonly dropUnpicked: (chapterId: string) => void;
  readonly busy: boolean;
}

export function useStudioVariants(d: {
  readonly t: TFunction;
  readonly doc: VideoDoc | null;
  readonly timeline: ResolvedTimeline | null;
  readonly applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>;
  readonly composer: StudioComposerState;
  readonly onError: (err: unknown) => void;
  /** 끝난 바퀴 id 들(판 기록의 바퀴 끝) — 갈래 바퀴가 끝나면 그 갈래를 '끝' 으로 적는다. */
  readonly endedPassIds: readonly string[];
}): StudioVariants {
  const [compareChapterId, setCompare] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(d);
  ref.current = d;
  /** 갈래 바퀴 id → 그 갈래. */
  const passes = useRef(new Map<string, { chapterId: string; variantId: string }>());

  // 갈래 바퀴가 끝나면 그 갈래를 '끝' 으로(에이전트가 적지 않았어도).
  const endedKey = d.endedPassIds.join('|');
  useEffect(() => {
    const { doc, applyOps } = ref.current;
    if (!doc || passes.current.size === 0) return;
    const ended = new Set(endedKey.split('|'));
    const byChapter = new Map<string, Set<string>>();
    for (const [passId, v] of passes.current) {
      if (!ended.has(passId)) continue;
      passes.current.delete(passId);
      byChapter.set(v.chapterId, (byChapter.get(v.chapterId) ?? new Set()).add(v.variantId));
    }
    const ops: VideoDocOp[] = [];
    for (const [chapterId, ids] of byChapter) {
      const variants = doc.chapters?.find((c) => c.id === chapterId)?.variants;
      if (!variants || !variants.some((v) => ids.has(v.id) && v.status !== 'done')) continue;
      ops.push({ op: 'updateChapter', chapterId, patch: { variants: variants.map((v) => (ids.has(v.id) ? { ...v, status: 'done' as const } : v)) } });
    }
    if (ops.length > 0) void applyOps(ops);
  }, [endedKey]);

  const start = useCallback(async (chapterId: string): Promise<void> => {
    const { doc, timeline, applyOps, composer, t } = ref.current;
    const chapter = doc?.chapters?.find((c) => c.id === chapterId);
    const resolved = timeline?.chapters.find((c) => c.id === chapterId);
    if (!doc || !chapter || !resolved) return;
    setBusy(true);
    try {
      let variants: readonly ChapterVariant[] = chapter.variants ?? [];
      if (variants.length < 2) {
        const made: ChapterVariant[] = ENGINES.map((engine) => ({ id: newVariantId(doc, chapterId, engine), engine, status: 'building' }));
        const first = made[0];
        if (!first) return;
        const ops: VideoDocOp[] = [
          { op: 'updateChapter', chapterId, patch: { variants: made } },
          // 지금 장면의 아이템은 첫 갈래로 — 사라지지 않고 비교의 한쪽이 된다.
          ...doc.tracks.flatMap((track) => track.items)
            .filter((item) => chapterIdOf(item) === chapterId && item.variantId === undefined)
            .map((item): VideoDocOp => ({ op: 'updateItem', itemId: item.id, patch: { variantId: first.id } })),
        ];
        if (!(await applyOps(ops))) return;
        variants = made;
      }
      const range = { id: resolved.id, title: chapter.title, start: resolved.start, end: resolved.end };
      for (const v of variants.slice(0, 2)) {
        const passId = await composer.sendPass(
          t('panel.videoStudio.variants.request', { title: chapter.title, engine: t(`panel.videoStudio.engines.${v.engine}`, { defaultValue: v.engine }) }),
          'variant',
          { chapter: range, variant: { chapterId, variantId: v.id, engine: v.engine } },
          v.engine,
        );
        if (passId) passes.current.set(passId, { chapterId, variantId: v.id });
      }
      setCompare(chapterId);
    } catch (err) {
      ref.current.onError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  const pick = useCallback((chapterId: string, variantId: string): void => {
    void ref.current.applyOps([{ op: 'updateChapter', chapterId, patch: { pick: variantId } }]);
  }, []);

  const dropUnpicked = useCallback((chapterId: string): void => {
    const { doc, timeline, applyOps } = ref.current;
    const chapter = doc?.chapters?.find((c) => c.id === chapterId);
    const picked = effectivePick(chapter);
    if (!doc || !chapter || !picked || chapter.pick !== picked) return;
    const drop = new Set((chapter.variants ?? []).filter((v) => v.id !== picked).map((v) => v.id));
    const doomed = doc.tracks.flatMap((track) => track.items).filter((item) => item.variantId !== undefined && drop.has(item.variantId));
    const doomedIds = new Set(doomed.map((item) => item.id));
    // 지울 아이템을 앵커로 삼은 다른 아이템은 지금 시각(숫자)으로 풀어 둔다 — 뒤가 무너지지 않게.
    const startOf = new Map((timeline?.items ?? []).map((r) => [r.id, r.start]));
    const unanchor = doc.tracks.flatMap((track) => track.items).filter((item) => {
      if (doomedIds.has(item.id) || typeof item.at === 'number') return false;
      const target = anchorItemRef(item.at);
      return target !== undefined && doomedIds.has(target) && startOf.has(item.id);
    });
    const ops: VideoDocOp[] = [
      ...unanchor.map((item): VideoDocOp => ({ op: 'updateItem', itemId: item.id, patch: { at: Math.round((startOf.get(item.id) ?? 0) * 1000) / 1000 } })),
      ...doomed.map((item): VideoDocOp => ({ op: 'removeItem', itemId: item.id })),
      { op: 'updateChapter', chapterId, patch: { variants: (chapter.variants ?? []).filter((v) => v.id === picked) } },
    ];
    void applyOps(ops);
  }, []);

  return {
    compareChapterId,
    openCompare: setCompare,
    closeCompare: () => setCompare(null),
    start,
    pick,
    dropUnpicked,
    busy,
  };
}
