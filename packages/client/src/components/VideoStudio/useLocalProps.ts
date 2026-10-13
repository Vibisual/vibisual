import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoDoc, VideoDocOp, VideoItem } from '@vibisual/video';

/**
 * §5.13 (V) 37-5 — 값 손잡이의 **낙관 갱신**: 값을 바꾸면 화면은 먼저 바뀌고(지금 문서에 그 값을 입힌 사본 — `previewDoc`),
 * 저장은 뒤에서 묶어 한 번 한다(`updateItem{props}` — 평소 편집 경로라 되돌리기가 된다). 컴포지션은 사본의 값이 바뀌면 무대가
 * 프레임을 다시 열지 않고 데이터 메시지로 맞춘다(`HtmlSceneStage` — 묶인 곳이 없을 때만 다시 연다).
 *
 * 덮어쓰기는 **바꾼 열쇠만** 든다 — 저장할 때 그 순간의 문서 값 위에 얹는다(그 사이 에이전트가 다른 값을 고쳤으면 그것을
 * 지우지 않는다). 저장이 끝나 문서가 그 값을 가지면 덮어쓰기를 걷는다. 문서가 바뀌면(다른 문서) 버린다.
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
  readonly pending: boolean;
}

export function useLocalProps(doc: VideoDoc | null, applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>): LocalProps {
  const [overrides, setOverrides] = useState<Readonly<Record<string, Patch>>>({});
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const docRef = useRef(doc);
  docRef.current = doc;
  const applyRef = useRef(applyOps);
  applyRef.current = applyOps;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);
  const docId = doc?.id ?? '';

  // 다른 문서로 가면 덮어쓰기를 버린다(그 문서의 것이 아니다).
  useEffect(() => {
    setOverrides({});
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [docId]);

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
  }, [doc]);

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
  }, []);

  const schedule = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setProp = useCallback((itemId: string, key: string, value: unknown): void => {
    setOverrides((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? {}), [key]: value } }));
    schedule();
  }, [schedule]);

  const flush = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); save(); }
  }, [save]);

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

  return { previewDoc, setProp, flush, pending: Object.keys(overrides).length > 0 };
}
