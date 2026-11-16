import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveTransform, type VideoDoc, type VideoDocOp, type VideoItem, type VideoTransform } from '@vibisual/video';

/**
 * §5.13 (V) 37-21 (C) — 끄는 동안의 배치 사본. 끄는 동안에는 문서에 쓰지 않고 화면만 먼저 바뀐다(값 손잡이의 `previewDoc` 위에 한 겹 —
 * 무대는 `setDoc` 으로 상자만 다시 놓는다). 놓으면 `updateItem{transform}` **한 번**(평소 편집 경로 — 되돌리기 한 칸).
 * 바꾼 칸만 지금 문서 값 위에 얹는다(그사이 에이전트가 고친 투명도·회전을 덮지 않게). 문서가 그 값을 가지면 걷는다.
 */

/** 화살표 키로 옮긴 뒤 이만큼 잠잠하면 저장한다(ms) — 값 손잡이(`useLocalProps`)와 같은 묶음. 실패 뒤 다시 해 보는 간격도 같다. */
const SAVE_DELAY_MS = 450;

export type TransformPatch = Readonly<Pick<VideoTransform, 'x' | 'y' | 'width' | 'height'>>;

export interface LocalTransform {
  /** 배치 덮어쓰기를 입힌 사본(없으면 받은 문서 그대로). */
  readonly previewDoc: VideoDoc | null;
  /** 끄는 동안의 배치(문서에 쓰지 않는다). `null` 이면 걷는다(취소). */
  readonly preview: (itemId: string, patch: TransformPatch | null) => void;
  /** 놓았다 — 한 번 저장한다. */
  readonly commit: (itemId: string, patch: TransformPatch) => void;
  /** 화살표 키 — 문서 px 만큼 옮기고, 잠잠해지면 한 번 저장한다. */
  readonly nudge: (itemId: string, dx: number, dy: number) => void;
  readonly pending: boolean;
}

interface Override { readonly itemId: string; readonly patch: TransformPatch }

function findItem(doc: VideoDoc | null, itemId: string): VideoItem | undefined {
  return doc?.tracks.flatMap((t) => t.items).find((i) => i.id === itemId);
}

/** 문서의 그 아이템이 이미 그 칸들을 갖고 있나. */
function holds(item: VideoItem, patch: TransformPatch): boolean {
  const have = (item.transform ?? {}) as Readonly<Record<string, unknown>>;
  return Object.entries(patch).every(([key, value]) => have[key] === value);
}

export function useLocalTransform(doc: VideoDoc | null, applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>): LocalTransform {
  const [override, setOverrideState] = useState<Override | null>(null);
  const overrideRef = useRef<Override | null>(null);
  const setOverride = useCallback((next: Override | null): void => { overrideRef.current = next; setOverrideState(next); }, []);
  const docRef = useRef(doc);
  docRef.current = doc;
  const applyRef = useRef(applyOps);
  applyRef.current = applyOps;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 37-21 (L) — 끌기가 시작될 때의 덮어쓰기(취소가 돌아갈 자리)와 그때 저장을 기다리고 있었나. `undefined` = 끄는 중이 아님.
   * 같은 아이템의 기다리던 키 저장은 끌기가 품고(사본 위에서 끌므로), 다른 아이템의 것은 지금 내보낸다(덮어쓰기는 한 아이템뿐).
   */
  const dragBase = useRef<{ readonly override: Override | null; readonly waiting: boolean } | undefined>(undefined);
  const docId = doc?.id ?? '';

  const stopTimer = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // 다른 문서로 가면 버린다(그 문서의 것이 아니다).
  useEffect(() => { stopTimer(); setOverride(null); dragBase.current = undefined; }, [docId, stopTimer, setOverride]);
  useEffect(() => stopTimer, [stopTimer]);

  // 문서가 그 값을 가지면(저장됐다) 걷는다. 아이템이 사라졌어도 걷는다.
  useEffect(() => {
    const cur = overrideRef.current;
    if (!doc || !cur) return;
    const item = findItem(doc, cur.itemId);
    if (!item || holds(item, cur.patch)) { if (!timer.current) setOverride(null); }
  }, [doc, setOverride]);

  const save = useCallback((itemId: string, patch: TransformPatch, attempt: number): void => {
    timer.current = null;
    const drop = (): void => { if (overrideRef.current?.itemId === itemId) setOverride(null); };
    const item = findItem(docRef.current, itemId);
    if (!item || holds(item, patch)) { drop(); return; }
    const transform: VideoTransform = { ...(item.transform ?? {}), ...patch };
    void applyRef.current([{ op: 'updateItem', itemId, patch: { transform } }]).then((ok) => {
      if (ok) return;
      // 다른 저장이 도는 중·판본 충돌 — 한 번만 다시 해 본다. 또 실패하면 화면이 문서로 돌아간다(저장 안 된 값을 붙들지 않는다).
      if (attempt < 1 && overrideRef.current?.itemId === itemId) { timer.current = setTimeout(() => save(itemId, patch, attempt + 1), SAVE_DELAY_MS); return; }
      drop();
    });
  }, [setOverride]);

  const startDrag = useCallback((itemId: string): void => {
    if (dragBase.current !== undefined) return;
    const pending = overrideRef.current;
    const waiting = timer.current !== null;
    stopTimer();
    if (pending && pending.itemId !== itemId) {
      if (waiting) save(pending.itemId, pending.patch, 0);
      dragBase.current = { override: null, waiting: false };
      return;
    }
    dragBase.current = { override: pending, waiting };
  }, [stopTimer, save]);

  const preview = useCallback((itemId: string, patch: TransformPatch | null): void => {
    if (patch) {
      startDrag(itemId);
      setOverride({ itemId, patch });
      return;
    }
    // 취소 — 이번 끌기 몫만 걷는다(끌기 전에 기다리던 저장은 다시 건다).
    const base = dragBase.current;
    dragBase.current = undefined;
    if (base === undefined) return;
    stopTimer();
    const back = base.override;
    const item = back ? findItem(docRef.current, back.itemId) : undefined;
    if (!back || !item || (!base.waiting && holds(item, back.patch))) { setOverride(null); return; }
    setOverride(back);
    if (base.waiting) timer.current = setTimeout(() => save(back.itemId, back.patch, 0), SAVE_DELAY_MS);
  }, [startDrag, stopTimer, setOverride, save]);

  const commit = useCallback((itemId: string, patch: TransformPatch): void => {
    startDrag(itemId);
    dragBase.current = undefined;
    stopTimer();
    setOverride({ itemId, patch });
    save(itemId, patch, 0);
  }, [startDrag, stopTimer, setOverride, save]);

  const nudge = useCallback((itemId: string, dx: number, dy: number): void => {
    const current = docRef.current;
    const item = findItem(current, itemId);
    if (!current || !item) return;
    const pending = overrideRef.current;
    // 다른 아이템의 기다리던 저장은 먼저 내보낸다(덮어쓰기는 한 번에 한 아이템).
    if (pending && pending.itemId !== itemId && timer.current) { stopTimer(); save(pending.itemId, pending.patch, 0); }
    const base = resolveTransform(current.size, item.transform);
    const prev = pending?.itemId === itemId ? pending.patch : {};
    const patch: TransformPatch = { ...prev, x: (prev.x ?? base.x) + dx, y: (prev.y ?? base.y) + dy };
    stopTimer();
    setOverride({ itemId, patch });
    timer.current = setTimeout(() => save(itemId, patch, 0), SAVE_DELAY_MS);
  }, [stopTimer, setOverride, save]);

  const previewDoc = useMemo<VideoDoc | null>(() => {
    if (!doc || !override) return doc;
    return {
      ...doc,
      tracks: doc.tracks.map((track) => (track.items.some((item) => item.id === override.itemId)
        ? { ...track, items: track.items.map((item) => (item.id === override.itemId ? { ...item, transform: { ...(item.transform ?? {}), ...override.patch } } : item)) }
        : track)),
    };
  }, [doc, override]);

  return { previewDoc, preview, commit, nudge, pending: override !== null };
}
