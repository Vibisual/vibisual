import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VIDEO_FORMATS,
  resolveTimeline,
  type VideoAsset,
  type VideoDoc,
  type VideoDocOp,
  type VideoFormatId,
} from '@vibisual/video';

import { openWorkspaceFile } from '../IDE/useWorkspaceExplorer.js';
import { buildAddSceneOps, buildAddShapeOps, buildAddTextOps, buildAssetItemOps, buildDuplicateOps, buildRemoveOps, buildSplitOps, nextEditorId } from './videoEditor.js';
import { captionOpsFromFile } from './videoCaptions.js';
import { measureAssets } from './useVideoRenderer.js';
import { createComposition, fetchStripImage, importVideoAsset, probeComposition, readDoc } from './videoApi.js';
import type { CompositionInspectorActions } from './VideoInspectorComposition.js';
import { prepareVideoImports } from './videoImportFiles.js';

/**
 * §5.13 (V) 37-1 — 스튜디오의 손 편집 동작((U) 기능은 하나도 빠지지 않는다): 얹기(장면·글자·도형·소재·컴포지션) · 가져오기(미디어·SRT) ·
 * 분할·복제·켜기/끄기·지우기 · 컴포지션 손잡이(다시 읽기·프레임 띠·파일 열기) · 제목·판형 바꾸기. 전부 평소 편집 경로(`applyOps` — 판본 검사·되돌리기)를 지난다.
 */

/** 붙일 수 있는 소재 한 개의 상한 — 가져오기와 같은 값. */
export const MEDIA_IMPORT_LIMIT = 128 * 1024 * 1024;

export interface StudioEditingDeps {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly doc: VideoDoc | null;
  readonly setDoc: (doc: VideoDoc) => void;
  readonly playhead: number;
  /** §5.13 (Y) 40-5 ① — 지금 시각(재생 중에도 정확하게 — 시계). 넣기·자르기는 누른 순간 이것을 읽는다. 없으면 `playhead`. */
  readonly readPlayhead?: () => number;
  readonly selectedItemId: string | null;
  readonly setSelectedItemId: (id: string | null) => void;
  readonly applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>;
  readonly disabled: boolean;
  readonly pendingWork: MutableRefObject<number>;
  readonly openSequence: MutableRefObject<number>;
  readonly onError: (err: unknown) => void;
  readonly onStrip: (strip: { image: string; times: readonly number[]; title: string; itemId: string }) => void;
  readonly refreshDocs: () => Promise<void>;
}

export function useStudioEditing(d: StudioEditingDeps) {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [compositionBusy, setCompositionBusy] = useState(false);
  const { doc, applyOps, playhead, selectedItemId } = d;
  // §5.13 (Y) 40-5 ① — 상태 재생 머리는 재생 중 시작 자리에 머문다(멈출 때·옮길 때만 바뀐다). 동작은 누른 순간의 시각을 읽는다.
  const readRef = useRef<() => number>(() => playhead);
  readRef.current = d.readPlayhead ?? ((): number => playhead);
  const at = useCallback((): number => readRef.current(), []);

  const insert = useCallback(async (ops: readonly VideoDocOp[]): Promise<boolean> => {
    const added = ops.flatMap((op) => op.op === 'addItem' ? [op.item] : op.op === 'addTrack' ? [...op.track.items] : []).at(-1);
    const success = await applyOps(ops);
    if (success && added) d.setSelectedItemId(added.id);
    return success;
  }, [applyOps, d]);

  const addScene = useCallback((scene: string): void => {
    if (doc) void insert(buildAddSceneOps(doc, scene, at(), t(`panel.videoStudio.editor.scene_${scene}`)));
  }, [doc, insert, at, t]);
  const addText = useCallback((): void => { if (doc) void insert(buildAddTextOps(doc, at(), t('panel.videoStudio.editor.addText'))); }, [doc, insert, at, t]);
  const addShape = useCallback((): void => { if (doc) void insert(buildAddShapeOps(doc, at(), t('panel.videoStudio.editor.addShape'))); }, [doc, insert, at, t]);
  const addAsset = useCallback((asset: VideoAsset): void => {
    if (!doc) return;
    const label = doc.tracks.flatMap((track) => track.items).find((item) => item.assetId === asset.id)?.label ?? asset.id;
    void insert(buildAssetItemOps(doc, asset, at(), label));
  }, [doc, insert, at]);

  const selected = useMemo(() => (doc ? resolveTimeline(doc).items.find((item) => item.id === selectedItemId) : undefined), [doc, selectedItemId]);
  const canSplit = !!selected && selected.kind !== 'scene' && playhead > selected.start && playhead < selected.end;
  const split = useCallback((): void => {
    const now = at();
    if (doc && selectedItemId && selected && selected.kind !== 'scene' && now > selected.start && now < selected.end) void insert(buildSplitOps(doc, selectedItemId, now));
  }, [doc, selectedItemId, selected, insert, at]);
  const duplicate = useCallback((): void => { if (doc && selectedItemId) void insert(buildDuplicateOps(doc, selectedItemId)); }, [doc, selectedItemId, insert]);
  const toggle = useCallback((): void => {
    if (!doc || !selectedItemId) return;
    const current = doc.tracks.flatMap((tr) => tr.items).find((i) => i.id === selectedItemId);
    if (current) void applyOps([{ op: 'updateItem', itemId: selectedItemId, patch: { enabled: current.enabled === false } }]);
  }, [doc, selectedItemId, applyOps]);
  const remove = useCallback((): void => {
    if (doc && selectedItemId) void applyOps(buildRemoveOps(doc, selectedItemId)).then((ok) => { if (ok) d.setSelectedItemId(null); });
  }, [doc, selectedItemId, applyOps, d]);

  /** 미디어·SRT 를 차례로 들인다(화면·소리 줄마다 이어서). (U) 의 가져오기 그대로. */
  const importFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (!doc || d.disabled || files.length === 0) return;
    const scope = d.openSequence.current;
    setImporting(true); d.pendingWork.current += 1;
    let current = doc;
    const startAt = at();
    const cursor = { visual: startAt, audio: startAt };
    try {
      if (files.reduce((sum, file) => sum + file.size, 0) > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
      for (const file of await prepareVideoImports(files)) {
        if (scope !== d.openSequence.current) break;
        let ops: VideoDocOp[];
        let lane: 'visual' | 'audio' | null = null;
        // §5.13 (W) 38-6 — SRT·VTT·낱말 시각 JSON 은 자막으로(받아쓰기 결과를 그대로 들인다).
        const captionOps = await captionOpsFromFile(current, file);
        if (captionOps) ops = captionOps;
        else {
          if (file.size > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
          const asset = await importVideoAsset(d.projectName, file);
          lane = asset.kind === 'audio' ? 'audio' : 'visual';
          const measured = (await measureAssets(d.projectName, [asset]))[asset.id];
          if (!measured || (asset.kind !== 'image' && asset.kind !== 'model' && !(measured.duration && measured.duration > 0))) throw new Error(t('panel.videoStudio.fileUnreadable', { name: file.name }));
          ops = buildAssetItemOps(current, { ...asset,
            ...(measured.duration !== null ? { duration: measured.duration } : {}),
            ...(measured.width !== null ? { width: measured.width } : {}),
            ...(measured.height !== null ? { height: measured.height } : {}),
            ...(measured.hasAudio !== undefined ? { hasAudio: measured.hasAudio } : {}),
          }, cursor[lane], file.name);
        }
        if (scope !== d.openSequence.current || !(await insert(ops))) break;
        current = (await readDoc(d.projectName, doc.id)).doc;
        if (lane) {
          const inserted = new Set(ops.flatMap((op) => op.op === 'addItem' ? [op.item.id] : op.op === 'addTrack' ? op.track.items.map((item) => item.id) : []));
          cursor[lane] = Math.max(cursor[lane], ...resolveTimeline(current).items.filter((item) => inserted.has(item.id)).map((item) => item.end));
        }
      }
      void d.refreshDocs();
    } catch (error) { d.onError(error); }
    finally { d.pendingWork.current -= 1; setImporting(false); }
  }, [doc, d, at, insert, t]);

  /** 빈 코드 컴포지션 뼈대를 만들어 재생 머리 자리에 얹는다(되돌리기 가능). */
  const addComposition = useCallback(async (): Promise<void> => {
    if (!doc || d.disabled) return;
    const scope = d.openSequence.current;
    setCompositionBusy(true); d.pendingWork.current += 1;
    try {
      const label = t('panel.videoStudio.composition.newLabel');
      const created = await createComposition(d.projectName, { name: 'motion', title: label, width: doc.size.width, height: doc.size.height });
      const probe = await probeComposition(d.projectName, created.path);
      if (scope !== d.openSequence.current) return;
      const asset: VideoAsset = {
        id: nextEditorId(doc, 'comp-src'), kind: 'composition', source: { kind: 'file', path: probe.path },
        ...(probe.duration !== undefined ? { duration: probe.duration } : {}),
        ...(probe.width !== undefined ? { width: probe.width } : {}),
        ...(probe.height !== undefined ? { height: probe.height } : {}),
        mode: probe.mode, lint: probe.lint, contentHash: probe.contentHash,
        ...(probe.propsDecl ? { propsDecl: probe.propsDecl } : {}),
        ...(probe.responsive ? { responsive: true } : {}),
      };
      await insert(buildAssetItemOps(doc, asset, at(), label));
    } catch (err) { d.onError(err); }
    finally { d.pendingWork.current -= 1; setCompositionBusy(false); }
  }, [doc, d, insert, at, t]);

  /**
   * §5.13 (T-6)(T-10) — 이미 프로젝트 안에 있는 컴포지션(들여온 묶음의 HTML)을 탐침해 소재로 들이고 재생 머리 자리에 얹는다
   * (소재 + 아이템 한 패치 — 되돌리기 가능).
   */
  const addCompositionFromPath = useCallback(async (path: string, label: string): Promise<void> => {
    if (!doc || d.disabled) return;
    const scope = d.openSequence.current;
    setCompositionBusy(true); d.pendingWork.current += 1;
    try {
      const probe = await probeComposition(d.projectName, path);
      if (scope !== d.openSequence.current) return;
      const asset: VideoAsset = {
        id: nextEditorId(doc, 'comp-pack'), kind: 'composition', source: { kind: 'file', path: probe.path },
        ...(probe.duration !== undefined ? { duration: probe.duration } : {}),
        ...(probe.width !== undefined ? { width: probe.width } : {}),
        ...(probe.height !== undefined ? { height: probe.height } : {}),
        mode: probe.mode, lint: probe.lint, contentHash: probe.contentHash,
        ...(probe.propsDecl ? { propsDecl: probe.propsDecl } : {}),
        ...(probe.responsive ? { responsive: true } : {}),
      };
      await insert(buildAssetItemOps(doc, asset, at(), label));
    } catch (err) { d.onError(err); }
    finally { d.pendingWork.current -= 1; setCompositionBusy(false); }
  }, [doc, d, insert, at]);

  const compositionActions = useMemo<CompositionInspectorActions>(() => ({
    busy: compositionBusy,
    onReload: (asset) => {
      if (!doc || asset.source.kind !== 'file') return;
      const path = asset.source.path;
      const id = doc.id;
      void (async () => {
        setCompositionBusy(true);
        try { await probeComposition(d.projectName, path, id, asset.id); d.setDoc((await readDoc(d.projectName, id)).doc); }
        catch (err) { d.onError(err); }
        finally { setCompositionBusy(false); }
      })();
    },
    onStrip: (itemId) => {
      if (!doc) return;
      const item = doc.tracks.flatMap((track) => track.items).find((entry) => entry.id === itemId);
      void (async () => {
        setCompositionBusy(true);
        try { const r = await fetchStripImage(d.projectName, doc.id, itemId); d.onStrip({ image: r.image, times: r.times, title: item?.label ?? itemId, itemId }); }
        catch (err) { d.onError(err); }
        finally { setCompositionBusy(false); }
      })();
    },
    onOpenFile: (path) => openWorkspaceFile(d.projectRoot, path),
  }), [compositionBusy, doc, d]);

  const rename = useCallback((title: string): void => { void applyOps([{ op: 'setDoc', patch: { title } }]); }, [applyOps]);
  const setFormat = useCallback((format: VideoFormatId): void => {
    const size = VIDEO_FORMATS[format];
    void applyOps([{ op: 'setDoc', patch: { size: { width: size.width, height: size.height } } }]);
  }, [applyOps]);

  return {
    importing, compositionBusy, selected, canSplit, insert, addScene, addText, addShape, addAsset, split, duplicate, toggle, remove,
    importFiles, addComposition, addCompositionFromPath, compositionActions, rename, setFormat,
  };
}

export type StudioEditing = ReturnType<typeof useStudioEditing>;
