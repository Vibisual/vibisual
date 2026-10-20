import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildDrawList,
  chapterIdOf,
  hitTest,
  opBounds,
  opRect,
  parsePropIndex,
  scenePropText,
  type HitRect,
  type HitResult,
  type HitTestOptions,
  type ResolvedTimeline,
  type VideoDoc,
  type VideoItem,
  type VideoNote,
} from '@vibisual/video';
import type { StagePick } from '@vibisual/video/render';

import type { PreviewEdit, PreviewPin, PreviewRing } from './StudioPreview.js';
import type { PreviewInspectLevel, PreviewInspectLevels } from './previewInspect.js';
import { buildStudioPickClipboard, type StudioPointed } from './studioAgentMessage.js';
import { previewTextMeasure } from './previewMeasure.js';
import { inlineTextKey } from './valueFields.js';

/**
 * §5.13 (V) 37-6·37-7 — 미리보기 위의 **손짓**: 고르기(평소) · 가리키기(`P`) · 메모 꽂기(`N`) · 더블클릭 제자리 고치기.
 *
 * - 기본 씬·글자·도형은 문서 기하(그리기 목록의 상자 — `hitTest`)로 바로 고른다(위에 있는 것부터).
 * - 컴포지션 안쪽은 무대가 샌드박스에 **읽기 전용** `pick` 을 묻는다(DOM 을 바꾸지 않는다 — 1.5초 상한, 답이 없으면 아이템 단위).
 * - 가리키면 실버 테가 남고 AI 입력창에 '가리킨 것' 칩이 붙는다(문서·아이템 id, 시각, 컴포지션 파일, 요소 경로, 글자).
 * - 메모는 그 시각·자리(화면 비율)에 번호 원으로 꽂히고, 아래 아이템·요소도 함께 적힌다.
 * - 글자는 더블클릭으로 제자리에서 고친다 — 값 손잡이와 **같은 경로**(낙관 갱신 + 저장)다.
 */
export interface NoteDraft {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly itemId?: string;
  readonly chapterId?: string;
  readonly element?: string;
}

/**
 * 안쪽을 물을 아이템인가 — 기본 씬(제목·부제·목록 줄 — 캔버스는 그리기와 같은 계산, 무대는 실제 요소)과 모델·편집 이미지는 두
 * 미리보기 모드 모두, 컴포지션은 무대에서만(공급자 어댑터).
 */
export function asksInside(kind: string, mode: 'canvas' | 'stage'): boolean {
  return kind === 'scene' || (kind === 'composition' && mode === 'stage') || kind === 'model' || kind === 'image';
}

/** 캔버스 미리보기는 기본 씬을 칠한 자리로 판정한다(씬 위 빈 곳은 그 아래 것). 무대는 CSS 배치라 종전 그대로. */
export function previewHitOptions(mode: 'canvas' | 'stage'): HitTestOptions | undefined {
  return mode === 'canvas' ? { measure: previewTextMeasure() } : undefined;
}

function findItem(doc: VideoDoc | null, itemId: string): VideoItem | undefined {
  for (const track of doc?.tracks ?? []) {
    const item = track.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return undefined;
}

/**
 * §5.4 #15 (C) — Alt 인스펙터에게 주는 답(문서 픽셀): 가장 안쪽(그 글자·그 요소)이 먼저, 그다음 그 아이템. 복사 글은 가리키기
 * 칩과 **같은 말**(`pointedFromPick` → `describePointed`)에 문서·프로젝트·파일 자리를 얹은 것이다.
 */
export function previewInspectLevels(
  ctx: { readonly projectName: string; readonly duration: number; readonly t: number },
  doc: VideoDoc,
  hit: HitResult,
  pick: StagePick | null,
): PreviewInspectLevels {
  const item = hit.op.resolved.item;
  const kind = item.kind === 'scene' && item.sceneId ? `scene:${item.sceneId}` : item.kind;
  const clip = (p: StudioPointed): string => buildStudioPickClipboard({ projectName: ctx.projectName, doc, duration: ctx.duration }, p);
  const own = pointedFromPick(doc, hit, null, ctx.t);
  const itemLevel: PreviewInspectLevel = { rect: hit.rect, label: `${item.id} (${kind})`, text: own.text ?? '', clipboard: clip(own) };
  const el = pick?.element;
  if (!pick || !el) return [itemLevel];
  const inner = el.prop ?? el.objectId ?? (el.path !== '' ? el.path : el.tag);
  return [{ rect: pick.rect, label: `${item.id} › ${inner}`, text: el.text, clipboard: clip(pointedFromPick(doc, hit, pick, ctx.t)) }, itemLevel];
}

/**
 * §5.13 (V) 37-6 · (R-10) — what the user pointed at, as the agent will read it: the item, the object inside it (a model
 * node or an editable image layer — id, adapter, bounds, properties) and the editable source revision the asset came from.
 */
export function pointedFromPick(doc: VideoDoc, hit: HitResult, pick: StagePick | null, t: number): StudioPointed {
  const item = hit.op.resolved.item;
  const asset = item.assetId ? doc.assets[item.assetId] : undefined;
  const file = (item.kind === 'composition' || item.kind === 'model' || item.kind === 'image') && asset?.source.kind === 'file' ? asset.source.path : undefined;
  const ownText = typeof item.props?.['text'] === 'string' ? (item.props['text'] as string) : undefined;
  const text = pick?.element?.text || ownText || item.label;
  const path = pick?.element?.path;
  return {
    itemId: item.id,
    bounds: pick?.rect ?? hit.rect,
    t,
    kind: item.kind,
    ...(item.kind === 'scene' && item.sceneId ? { scene: item.sceneId } : {}),
    ...(file ? { file } : {}),
    ...(path ? { path } : {}),
    ...(pick?.element?.objectId ? { objectId: pick.element.objectId } : {}),
    ...(pick?.element?.adapter ? { adapter: pick.element.adapter } : {}),
    ...(pick?.element?.properties ? { properties: pick.element.properties } : {}),
    ...(asset?.creationSource ? { source: asset.creationSource } : {}),
    ...(text ? { text } : {}),
    ...(pick?.element?.prop ? { prop: pick.element.prop } : {}),
  };
}

/** 지나갈 때 컴포지션 안쪽을 묻는 간격(ms) — 마우스가 움직일 때마다 묻지 않는다. */
const HOVER_PICK_MS = 90;
/** 메모 핀이 보이는 시각 폭(초) — 그 핀의 시각 근처에서만 화면에 선다. */
const PIN_WINDOW_S = 0.5;

export interface PreviewInteraction {
  readonly rings: readonly PreviewRing[];
  readonly pins: readonly PreviewPin[];
  /**
   * §5.13 (Y) 40-5 — 그 시각의 테·핀. 재생 중에는 셸이 다시 그려지지 않으므로(재생 머리 상태는 멈출 때만 바뀐다) 미리보기 부품이
   * 시계를 굵게 구독해 이것을 부른다 — 재생 중에도 고른 것의 테와 그 시각 메모 핀이 따라간다.
   */
  readonly overlaysAt: (t: number) => { readonly rings: readonly PreviewRing[]; readonly pins: readonly PreviewPin[] };
  readonly edit: PreviewEdit | null;
  readonly noteDraft: NoteDraft | null;
  readonly activeNoteId: string | null;
  readonly setActiveNoteId: (id: string | null) => void;
  readonly onHover: (x: number, y: number) => void;
  readonly onLeave: () => void;
  readonly onPress: (x: number, y: number) => void;
  readonly onDoublePress: (x: number, y: number) => void;
  readonly commitNote: (text: string) => void;
  readonly cancelNote: () => void;
  /** §5.4 #15 (C) — Alt 인스펙터가 미리보기 안 (문서 픽셀) 자리를 물을 때의 답. */
  readonly inspect: (x: number, y: number) => PreviewInspectLevels | Promise<PreviewInspectLevels>;
}

export function usePreviewInteraction(d: {
  /** Alt 인스펙터 복사 글에 싣는 프로젝트 이름. */
  projectName: string;
  doc: VideoDoc | null;
  timeline: ResolvedTimeline | null;
  playhead: number;
  /** §5.13 (Y) 40-5 — 지금 시각(재생 중에도 정확하게 — 시계). 없으면 `playhead`. */
  readPlayhead?: () => number;
  mode: 'canvas' | 'stage';
  interaction: 'none' | 'point' | 'note';
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  pickAt: (x: number, y: number) => Promise<StagePick | null>;
  addPointed: (p: StudioPointed) => void;
  pointed: readonly StudioPointed[];
  notes: readonly VideoNote[];
  addNote: (input: { t: number; x: number; y: number; text: string; itemId?: string; chapterId?: string; element?: string }) => Promise<VideoNote | null>;
  onSetProp: (itemId: string, key: string, value: unknown) => void;
  /** 메모를 꽂으면 메모 서랍을 연다. */
  onNoteAdded: (note: VideoNote) => void;
}): PreviewInteraction {
  const [hover, setHover] = useState<HitRect | null>(null);
  const [edit, setEdit] = useState<{ itemId: string; key: string; rect: HitRect; value: string; fontSize: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  /** 가리킨 것의 테(칩이 남아 있는 동안 — 아이템 id + 요소 경로로 짝을 맞춘다). */
  const [pointedRings, setPointedRings] = useState<readonly { itemId: string; path: string; rect: HitRect }[]>([]);
  const hoverAsk = useRef<{ busy: boolean; want: { x: number; y: number } | null; last: number }>({ busy: false, want: null, last: 0 });
  const dRef = useRef(d);
  dRef.current = d;
  /** 손짓 순간의 시각 — 재생 중에도 시계를 읽는다(재생 머리 상태는 멈출 때만 바뀐다). */
  const nowT = (): number => dRef.current.readPlayhead?.() ?? dRef.current.playhead;
  const docId = d.doc?.id ?? '';

  useEffect(() => { setHover(null); setEdit(null); setNoteDraft(null); setActiveNoteId(null); setPointedRings([]); }, [docId]);
  useEffect(() => { if (d.interaction === 'none') setHover(null); if (d.interaction !== 'note') setNoteDraft(null); }, [d.interaction]);
  // 칩을 지우면 그 테도 걷는다.
  useEffect(() => {
    setPointedRings((rings) => rings.filter((r) => d.pointed.some((p) => p.itemId === r.itemId && (p.path ?? '') === r.path)));
  }, [d.pointed]);

  /** 동기 판정(문서 기하) — 아이템 단위. 캔버스는 기본 씬을 칠한 자리로(씬 위 빈 곳은 그 아래 것). */
  const hitAt = useCallback((x: number, y: number) => {
    const { doc, timeline, mode } = dRef.current;
    return doc && timeline ? hitTest(doc, timeline, nowT(), x, y, previewHitOptions(mode)) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 안쪽을 물을 수 있는 아이템이면 묻는다(답이 없으면 아이템 단위). 컴포지션은 무대에만 있고, 모델·편집 이미지는 무대든
   * canvas2d 미리보기든 같은 공급자 어댑터가 답한다(§5.13 (R-10)).
   */
  const pickDeep = useCallback(async (x: number, y: number): Promise<{ hit: HitResult; pick: StagePick | null } | null> => {
    const hit = hitAt(x, y);
    if (!hit) return null;
    if (!asksInside(hit.op.kind, dRef.current.mode)) return { hit, pick: null };
    const pick = await dRef.current.pickAt(x, y);
    return { hit, pick: pick && pick.op.itemId === hit.op.itemId ? pick : null };
  }, [hitAt]);

  const onHover = useCallback((x: number, y: number): void => {
    if (dRef.current.interaction === 'none') return;
    const hit = hitAt(x, y);
    if (!hit) { setHover(null); return; }
    if (!asksInside(hit.op.kind, dRef.current.mode)) { setHover(hit.rect); return; }
    // 컴포지션 안쪽 — 묻는 동안 들어온 자리는 마지막 하나만(상한 간격).
    const ask = hoverAsk.current;
    ask.want = { x, y };
    if (ask.busy) return;
    const run = async (): Promise<void> => {
      ask.busy = true;
      while (ask.want) {
        const at = ask.want;
        ask.want = null;
        const wait = HOVER_PICK_MS - (Date.now() - ask.last);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        ask.last = Date.now();
        const pick = await dRef.current.pickAt(at.x, at.y);
        if (dRef.current.interaction === 'none') { setHover(null); break; }
        setHover(pick?.rect ?? hitAt(at.x, at.y)?.rect ?? null);
      }
      ask.busy = false;
    };
    void run();
  }, [hitAt]);

  const onLeave = useCallback((): void => { setHover(null); hoverAsk.current.want = null; }, []);

  const onPress = useCallback((x: number, y: number): void => {
    const cur = dRef.current;
    const doc = cur.doc;
    if (!doc) return;
    if (cur.interaction === 'note') {
      void (async () => {
        const found = await pickDeep(x, y);
        const item = found?.hit.op.resolved.item;
        const chapterId = item ? chapterIdOf(item) : undefined;
        const element = found?.pick?.element?.path;
        setNoteDraft({
          x: Math.max(0, Math.min(1, x / doc.size.width)),
          y: Math.max(0, Math.min(1, y / doc.size.height)),
          t: nowT(),
          ...(item ? { itemId: item.id } : {}),
          ...(chapterId ? { chapterId } : {}),
          ...(element ? { element } : {}),
        });
      })();
      return;
    }
    if (cur.interaction === 'point') {
      void (async () => {
        const found = await pickDeep(x, y);
        if (!found) return;
        const { hit, pick } = found;
        const item = hit.op.resolved.item;
        const path = pick?.element?.path;
        cur.addPointed(pointedFromPick(doc, hit, pick, nowT()));
        cur.setSelectedItemId(item.id);
        const rect = pick?.rect ?? hit.rect;
        setPointedRings((rings) => [...rings.filter((r) => !(r.itemId === item.id && r.path === (path ?? ''))), { itemId: item.id, path: path ?? '', rect }].slice(-4));
      })();
      return;
    }
    const hit = hitAt(x, y);
    cur.setSelectedItemId(hit ? hit.op.itemId : null);
  }, [hitAt, pickDeep]);

  const onDoublePress = useCallback((x: number, y: number): void => {
    void (async () => {
      const found = await pickDeep(x, y);
      if (!found) return;
      const { hit, pick } = found;
      const item = hit.op.resolved.item;
      const cur = dRef.current;
      cur.setSelectedItemId(item.id);
      // 컴포지션 안의 값에 묶인 글자([data-vibi-prop]).
      if (item.kind === 'composition') {
        const prop = pick?.element?.prop;
        if (!prop || !pick?.rect) return;
        const asset = item.assetId ? cur.doc?.assets[item.assetId] : undefined;
        const decl = asset?.propsDecl?.find((p) => p.name === prop);
        if (decl && decl.type !== 'text') return;
        const raw = item.props?.[prop];
        const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : decl?.default !== undefined ? String(decl.default) : pick.element?.text ?? '';
        setEdit({ itemId: item.id, key: prop, rect: pick.rect, value, fontSize: Math.max(12, pick.rect.height * 0.6) });
        return;
      }
      // 기본 씬의 글자 값(제목·부제·이름·목록 줄 …) — 누른 그 글자 자리에서 그 값을 고친다(배열 칸이면 그 칸만).
      if (item.kind === 'scene' && pick?.element?.prop && pick.rect) {
        const value = scenePropText(hit.op, pick.element.prop);
        if (value !== null) {
          setEdit({ itemId: item.id, key: pick.element.prop, rect: pick.rect, value, fontSize: pick.element.fontSize ?? Math.max(12, pick.rect.height * 0.6) });
          return;
        }
      }
      const key = inlineTextKey(item);
      if (!key) return;
      const raw = item.props?.[key];
      const fontSize = typeof item.props?.['fontSize'] === 'number' ? (item.props['fontSize'] as number) : 48;
      setEdit({ itemId: item.id, key, rect: opRect(hit.op), value: typeof raw === 'string' ? raw : '', fontSize });
    })();
  }, [pickDeep]);

  const commitNote = useCallback((text: string): void => {
    const draft = noteDraft;
    setNoteDraft(null);
    if (!draft) return;
    void dRef.current.addNote({ ...draft, text: text.trim() }).then((note) => {
      if (note) { setActiveNoteId(note.id); dRef.current.onNoteAdded(note); }
    });
  }, [noteDraft]);

  /**
   * §5.4 #15 (C) — Alt 인스펙터의 물음. 가리키기(`P`)와 **같은 판정**이다 — 문서 기하로 아이템을 찾고, 안쪽을 아는 것(기본 씬·
   * 컴포지션·모델·편집 이미지)이면 그 안을 묻는다. 아무것도 없는 자리면 빈 답(판 그대로 DOM 으로 집힌다).
   */
  const inspect = useCallback((x: number, y: number): PreviewInspectLevels | Promise<PreviewInspectLevels> => {
    const cur = dRef.current;
    const doc = cur.doc;
    if (!doc) return [];
    const hit = hitAt(x, y);
    if (!hit) return [];
    const ctx = { projectName: cur.projectName, duration: cur.timeline?.duration ?? 0, t: nowT() };
    if (!asksInside(hit.op.kind, cur.mode)) return previewInspectLevels(ctx, doc, hit, null);
    return cur.pickAt(x, y).then(
      (pick) => previewInspectLevels(ctx, doc, hit, pick && pick.op.itemId === hit.op.itemId ? pick : null),
      () => previewInspectLevels(ctx, doc, hit, null),
    );
  }, [hitAt]);

  const { selectedItemId, doc: viewDoc, timeline: viewTimeline, mode: viewMode, notes: viewNotes } = d;
  const overlaysAt = useCallback((t: number): { rings: PreviewRing[]; pins: PreviewPin[] } => {
    const rings: PreviewRing[] = [];
    // 고른 것의 상자(앱 색 테) — 위에 다른 것이 덮여 있어도 고른 것의 자리를 보인다. 캔버스의 기본 씬은 칠한 자리로.
    if (selectedItemId && viewDoc && viewTimeline) {
      const op = buildDrawList(viewDoc, viewTimeline, t).find((o) => o.itemId === selectedItemId);
      if (op && op.kind !== 'caption') rings.push({ id: 'selected', rect: opBounds(viewDoc, op, previewHitOptions(viewMode)), tone: 'selected' });
    }
    for (const r of pointedRings) rings.push({ id: `pointed-${r.itemId}-${r.path}`, rect: r.rect, tone: 'pointed' });
    if (hover) rings.push({ id: 'hover', rect: hover, tone: 'hover' });
    const pins: PreviewPin[] = viewNotes
      .filter((n) => n.status !== 'closed' && (Math.abs(n.t - t) <= PIN_WINDOW_S || n.id === activeNoteId))
      .map((n) => ({ id: n.id, n: n.n, x: n.x, y: n.y, status: n.status, active: n.id === activeNoteId }));
    return { rings, pins };
  }, [selectedItemId, viewDoc, viewTimeline, viewMode, viewNotes, pointedRings, hover, activeNoteId]);
  const { rings, pins } = overlaysAt(d.playhead);

  const editProps: PreviewEdit | null = edit ? {
    rect: edit.rect,
    value: edit.value,
    fontSize: edit.fontSize,
    onCommit: (value) => {
      setEdit(null);
      if (value === edit.value) return;
      const slot = parsePropIndex(edit.key);
      if (!slot) { dRef.current.onSetProp(edit.itemId, edit.key, value); return; }
      // 배열 칸(목록 줄·코드 줄) — 지금 문서의 배열은 그대로 두고 그 칸만 바꿔 넣는다(그사이 AI 가 고친 다른 칸을 덮지 않게).
      const list = findItem(dRef.current.doc, edit.itemId)?.props?.[slot.key];
      if (!Array.isArray(list) || slot.index >= list.length) return;
      const next = list.slice();
      next[slot.index] = value;
      dRef.current.onSetProp(edit.itemId, slot.key, next);
    },
    onCancel: () => setEdit(null),
  } : null;

  return {
    rings, pins, overlaysAt, edit: editProps, noteDraft, activeNoteId, setActiveNoteId,
    onHover, onLeave, onPress, onDoublePress, commitNote, cancelNote: () => setNoteDraft(null), inspect,
  };
}
