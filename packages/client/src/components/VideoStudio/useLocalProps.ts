import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoDoc, VideoDocOp, VideoItem } from '@vibisual/video';

/**
 * §5.13 (V) 37-5 — 값 손잡이의 낙관 갱신: 화면은 먼저 바뀌고(값을 입힌 사본 `previewDoc`) 저장은 뒤에서 묶어 한 번(`updateItem{props}` — 평소 편집 경로라 되돌리기가 된다).
 * 컴포지션은 무대가 프레임을 다시 열지 않고 데이터 메시지로 맞춘다(`HtmlSceneStage` — 묶인 곳이 없을 때만 다시 연다).
 * 덮어쓰기는 바꾼 열쇠만 들고 저장 순간의 문서 값 위에 얹는다(그 사이 에이전트가 고친 다른 값을 지우지 않게). 문서가 그 값을 가지면 걷고, 다른 문서로 바뀌면 버린다.
 */

/** 마지막 손길 뒤 이만큼 잠잠하면 저장한다(ms) — 끄는 동안 패치가 쏟아지지 않게. */
const SAVE_DELAY_MS = 450;

type Patch = Readonly<Record<string, unknown>>;

function findItem(doc: VideoDoc | null, itemId: string): VideoItem | undefined {
  return doc?.tracks.flatMap((t) => t.items).find((i) => i.id === itemId);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface LocalProps {
  /** 덮어쓰기를 입힌 사본(덮어쓰기가 없으면 문서 그대로). 미리보기·값 카드가 이것을 본다. */
  readonly previewDoc: VideoDoc | null;
  /** 값 하나를 바꾼다(화면 먼저, 저장은 뒤에서). */
  readonly setProp: (itemId: string, key: string, value: unknown) => void;
  /** 지금 기다리는 저장을 바로 한다(문서를 떠나기 전 등). */
  readonly flush: () => void;
  /**
   * §5.13 (V) 37-21 (H) — 미리보기에서 끄는 동안 저장을 붙든다(`true`). 놓으면(`false`) 평소처럼 잠잠해진 뒤 한 번 저장한다 —
   * 끌다 잠깐 멈춰도 판본이 둘로 갈리지 않게.
   */
  readonly hold: (on: boolean) => void;
  /**
   * 끌기 취소 — 그 열쇠들을 붙들기 시작한 때(`hold(true)`)의 덮어쓰기로 되돌린다. 그때 저장을 기다리던 값은 남아 저장되고,
   * 그때 없던 열쇠는 걷혀 문서 값으로 돌아간다(붙들지 않았으면 걷기만).
   */
  readonly revertProps: (itemId: string, keys: readonly string[]) => void;
  readonly pending: boolean;
}

export function useLocalProps(doc: VideoDoc | null, applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>): LocalProps {
  const [overrides, setOverridesState] = useState<Readonly<Record<string, Patch>>>({});
  // 렌더를 기다리지 않고 늘 최신 — 붙들기 시작 순간의 덮어쓰기를 떠 두어야 한다(같은 손짓 안의 setProp 뒤에도 맞게).
  const overridesRef = useRef(overrides);
  const setOverrides = useCallback((next: Readonly<Record<string, Patch>> | ((prev: Readonly<Record<string, Patch>>) => Readonly<Record<string, Patch>>)): void => {
    const value = typeof next === 'function' ? next(overridesRef.current) : next;
    if (value === overridesRef.current) return;
    overridesRef.current = value;
    setOverridesState(value);
  }, []);
  const docRef = useRef(doc);
  docRef.current = doc;
  const applyRef = useRef(applyOps);
  applyRef.current = applyOps;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);
  const held = useRef(false);
  /** 붙들기 시작 순간의 덮어쓰기 — 취소가 되돌아갈 자리(붙들지 않았으면 null). */
  const heldFrom = useRef<Readonly<Record<string, Patch>> | null>(null);
  /** 걷힌 뒤(언마운트)에는 저장을 새로 걸지 않는다 — 끌기 정리가 그때 `hold(false)` 를 불러도 판본이 생기지 않게. */
  const alive = useRef(true);
  const docId = doc?.id ?? '';

  // 다른 문서로 가면 덮어쓰기를 버린다(그 문서의 것이 아니다).
  useEffect(() => {
    setOverrides({});
    heldFrom.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [docId, setOverrides]);

  // 문서가 이미 그 값을 가지면(저장됐다·에이전트가 같은 값을 적었다) 그 열쇠를 걷는다.
  useEffect(() => {
    if (!doc) return;
    setOverrides((prev) => {
      let changed = false;
      const next: Record<string, Patch> = {};
      for (const [itemId, patch] of Object.entries(prev)) {
        const item = findItem(doc, itemId);
        if (!item) { changed = true; continue; }
        const left: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (sameValue(item.props?.[k], v)) changed = true;
          else left[k] = v;
        }
        if (Object.keys(left).length > 0) next[itemId] = left;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [doc, setOverrides]);

  const save = useCallback((): void => {
    timer.current = null;
    const current = docRef.current;
    const pending = overridesRef.current;
    if (!current) return;
    const ops: VideoDocOp[] = [];
    for (const [itemId, patch] of Object.entries(pending)) {
      const item = findItem(current, itemId);
      if (!item) continue;
      const props = { ...(item.props ?? {}), ...patch };
      if (sameValue(props, item.props ?? {})) continue;
      ops.push({ op: 'updateItem', itemId, patch: { props } });
    }
    if (ops.length === 0) return;
    void applyRef.current(ops).then((ok) => {
      if (ok) { retries.current = 0; return; }
      // 실패(다른 저장이 도는 중·판본 충돌로 다시 읽음)면 한 번만 다시 해 본다 — 바꾼 열쇠만 얹으므로 에이전트의 다른 값을
      //   지우지 않는다. 또 실패하면 화면이 문서로 돌아가도록 덮어쓰기를 걷는다(저장되지 않은 값을 붙들고 있지 않는다).
      if (retries.current < 1) {
        retries.current += 1;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(save, SAVE_DELAY_MS);
        return;
      }
      retries.current = 0;
      setOverrides({});
    });
  }, [setOverrides]);

  const schedule = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (held.current || !alive.current) return;
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, []);

  const setProp = useCallback((itemId: string, key: string, value: unknown): void => {
    setOverrides((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? {}), [key]: value } }));
    schedule();
  }, [schedule, setOverrides]);

  const flush = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); save(); }
  }, [save]);

  const hold = useCallback((on: boolean): void => {
    if (on && !held.current) heldFrom.current = overridesRef.current;
    if (!on) heldFrom.current = null;
    held.current = on;
    schedule();
  }, [schedule]);

  const revertProps = useCallback((itemId: string, keys: readonly string[]): void => {
    const before = heldFrom.current?.[itemId] ?? {};
    const item = findItem(docRef.current, itemId);
    setOverrides((prev) => {
      const patch = prev[itemId] ?? {};
      const left: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([key]) => !keys.includes(key)));
      // 그때 기다리던 값은 되살린다 — 문서가 이미 그 값이면 덮어쓸 것이 없다.
      for (const key of keys) {
        if (item && key in before && !sameValue(item.props?.[key], before[key])) left[key] = before[key];
      }
      if (sameValue(left, patch)) return prev;
      const { [itemId]: _dropped, ...rest } = prev;
      return Object.keys(left).length > 0 ? { ...rest, [itemId]: left } : rest;
    });
  }, [setOverrides]);

  const previewDoc = useMemo<VideoDoc | null>(() => {
    if (!doc) return null;
    const ids = Object.keys(overrides);
    if (ids.length === 0) return doc;
    return {
      ...doc,
      tracks: doc.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => {
          const patch = overrides[item.id];
          return patch ? { ...item, props: { ...(item.props ?? {}), ...patch } } : item;
        }),
      })),
    };
  }, [doc, overrides]);

  return { previewDoc, setProp, flush, hold, revertProps, pending: Object.keys(overrides).length > 0 };
}
