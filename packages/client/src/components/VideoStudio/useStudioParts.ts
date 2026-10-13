import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ResolvedTimeline, type TimeAnchor, type VideoAsset, type VideoDoc, type VideoDocOp, type VideoItem, type VideoTrack } from '@vibisual/video';

import { addStudioPart, listParts, partThumb, savePart, type PartItemTemplate, type PartListing } from './studioApi.js';
import { nextEditorId } from './videoEditor.js';
import type { DrawerPart } from './PartsDrawer.js';

/**
 * §5.13 (V) 37-11 — **부품 서랍**의 상태: 우리가 쓴 부품 + 내 부품 목록, 실제 정지 화면 썸네일(서랍이 열려 있을 때만, 하나씩 —
 * 서버가 프로젝트에 기억한다), 꺼내 쓰기(서버가 사본 폴더와 탐침한 소재를 주면 소재 + 아이템을 **한 패치**로 얹는다 — 되돌리기 한 번에
 * 함께 걷힌다), [부품으로 저장].
 */
export interface StudioParts {
  readonly parts: readonly DrawerPart[];
  readonly busy: boolean;
  readonly use: (partId: string, at: { readonly t: number; readonly chapterId: string | null; readonly chapterStart: number }) => Promise<void>;
  readonly save: (chapterId: string, name: string) => Promise<void>;
  readonly refresh: () => void;
}

const thumbCache = new Map<string, string>();

function trackFor(doc: VideoDoc, kind: VideoTrack['kind']): VideoTrack | undefined {
  return doc.tracks.find((t) => t.kind === kind);
}

export function useStudioParts(d: {
  project: string;
  doc: VideoDoc | null;
  timeline: ResolvedTimeline | null;
  open: boolean;
  applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>;
  onSelect: (itemId: string) => void;
  onError: (err: unknown) => void;
  onSaved: () => void;
}): StudioParts {
  const { t } = useTranslation();
  const [listing, setListing] = useState<PartListing>({ parts: [], mine: [] });
  const [tick, setTick] = useState(0);
  const [thumbTick, setThumbTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const thumbBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!d.open || d.project === '') return;
    let alive = true;
    listParts(d.project).then((l) => { if (alive) setListing(l); }).catch(() => undefined);
    return () => { alive = false; };
  }, [d.open, d.project, tick]);

  const ids = useMemo(() => [...listing.parts.map((p) => p.id), ...listing.mine.map((p) => p.id)], [listing]);
  // 썸네일 — 서랍이 열려 있을 때만, 하나씩(일꾼의 스틸 줄을 막지 않게).
  useEffect(() => {
    if (!d.open || thumbBusy.current) return;
    const todo = ids.find((id) => !thumbCache.has(JSON.stringify([d.project, id])));
    if (!todo) return;
    thumbBusy.current = true;
    const key = JSON.stringify([d.project, todo]);
    partThumb(d.project, todo)
      .then((image) => thumbCache.set(key, image))
      .catch(() => thumbCache.set(key, ''))
      .finally(() => { thumbBusy.current = false; if (mounted.current) setThumbTick((n) => n + 1); });
  }, [d.open, d.project, ids, thumbTick]);

  const parts = useMemo<DrawerPart[]>(() => [
    ...listing.parts.map((p) => ({
      id: p.id, category: p.category, name: t(`panel.videoStudio.parts.name_${p.id}`, { defaultValue: p.name }),
      thumb: thumbCache.get(JSON.stringify([d.project, p.id])) || null,
    })),
    ...listing.mine.map((p) => ({ id: p.id, category: 'mine', name: p.name, mine: true, thumb: thumbCache.get(JSON.stringify([d.project, p.id])) || null })),
    // `thumbTick` 은 기억이 찼다는 신호다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [listing, d.project, t, thumbTick]);

  const use = useCallback(async (partId: string, at: { readonly t: number; readonly chapterId: string | null; readonly chapterStart: number }): Promise<void> => {
    const doc = d.doc;
    if (!doc) return;
    setBusy(true);
    try {
      const got = await addStudioPart(d.project, doc.id, partId);
      const ops: VideoDocOp[] = got.assets.map((asset): VideoDocOp => ({ op: 'setAsset', asset }));
      let working = doc;
      let firstId: string | null = null;
      for (const tpl of got.items as readonly PartItemTemplate[]) {
        const kind = (['visual', 'audio', 'caption'] as const).includes(tpl.trackKind) ? tpl.trackKind : 'visual';
        let track = trackFor(working, kind);
        if (!track) {
          const id = nextEditorId(working, kind);
          track = { id, kind, label: kind, items: [] };
          ops.push({ op: 'addTrack', track });
          working = { ...working, tracks: [...working.tracks, track] };
        }
        let assetId = tpl.assetId;
        if (!assetId && tpl.asset && typeof tpl.asset['id'] === 'string') {
          assetId = tpl.asset['id'] as string;
          if (!(assetId in working.assets)) ops.push({ op: 'setAsset', asset: tpl.asset as unknown as VideoAsset });
        }
        const offset = at.t - at.chapterStart + tpl.relStart;
        const anchor: TimeAnchor = at.chapterId ? { chapter: at.chapterId, offset: Math.max(0, Math.round(offset * 1000) / 1000) } : Math.max(0, Math.round((at.t + tpl.relStart) * 1000) / 1000);
        const id = nextEditorId(working, 'part');
        const item: VideoItem = {
          id,
          kind: tpl.kind as VideoItem['kind'],
          at: anchor,
          duration: tpl.duration,
          ...(assetId ? { assetId } : {}),
          ...(tpl.label ? { label: tpl.label } : {}),
          ...(tpl.sceneId ? { sceneId: tpl.sceneId } : {}),
          ...(tpl.props ? { props: tpl.props } : {}),
          ...(tpl.transform ? { transform: tpl.transform as VideoItem['transform'] } : {}),
          ...(at.chapterId ? { chapterId: at.chapterId } : {}),
          ...(tpl.cues ? { cues: tpl.cues.map((c) => ({ start: at.t + c.start, end: at.t + c.end, text: c.text })) } : {}),
        };
        ops.push({ op: 'addItem', trackId: track.id, item });
        // 다음 id 가 겹치지 않게 지금 상태에 얹어 둔다(문서에는 한 패치로 간다).
        working = { ...working, tracks: working.tracks.map((tr) => (tr.id === track!.id ? { ...tr, items: [...tr.items, item] } : tr)) };
        firstId ??= id;
      }
      if (ops.length > 0 && await d.applyOps(ops) && firstId) d.onSelect(firstId);
    } catch (err) {
      d.onError(err);
    } finally {
      setBusy(false);
    }
  }, [d]);

  const save = useCallback(async (chapterId: string, name: string): Promise<void> => {
    const doc = d.doc;
    if (!doc) return;
    try {
      await savePart(d.project, doc.id, chapterId, name);
      setTick((n) => n + 1);
      d.onSaved();
    } catch (err) {
      d.onError(err);
    }
  }, [d]);

  return { parts, busy, use, save, refresh: () => setTick((n) => n + 1) };
}
