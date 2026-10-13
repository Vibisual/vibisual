import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildDrawList,
  chapterIdOf,
  hitTest,
  opRect,
  type HitRect,
  type HitResult,
  type ResolvedTimeline,
  type VideoDoc,
  type VideoNote,
} from '@vibisual/video';
import type { StagePick } from '@vibisual/video/render';

import type { PreviewEdit, PreviewPin, PreviewRing } from './StudioPreview.js';
import type { StudioPointed } from './studioAgentMessage.js';
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

/** 지나갈 때 컴포지션 안쪽을 묻는 간격(ms) — 마우스가 움직일 때마다 묻지 않는다. */
const HOVER_PICK_MS = 90;
/** 메모 핀이 보이는 시각 폭(초) — 그 핀의 시각 근처에서만 화면에 선다. */
const PIN_WINDOW_S = 0.5;

export interface PreviewInteraction {
  readonly rings: readonly PreviewRing[];
  readonly pins: readonly PreviewPin[];
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
}

export function usePreviewInteraction(d: {
  doc: VideoDoc | null;
  timeline: ResolvedTimeline | null;
  playhead: number;
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
  const docId = d.doc?.id ?? '';

  useEffect(() => { setHover(null); setEdit(null); setNoteDraft(null); setActiveNoteId(null); setPointedRings([]); }, [docId]);
  useEffect(() => { if (d.interaction === 'none') setHover(null); if (d.interaction !== 'note') setNoteDraft(null); }, [d.interaction]);
  // 칩을 지우면 그 테도 걷는다.
  useEffect(() => {
    setPointedRings((rings) => rings.filter((r) => d.pointed.some((p) => p.itemId === r.itemId && (p.path ?? '') === r.path)));
  }, [d.pointed]);

  /** 동기 판정(문서 기하) — 아이템 단위. */
  const hitAt = useCallback((x: number, y: number) => {
    const { doc, timeline, playhead } = dRef.current;
    return doc && timeline ? hitTest(doc, timeline, playhead, x, y) : undefined;
  }, []);

  /** 컴포지션이면 무대에 안쪽을 묻는다(무대가 없거나 답이 없으면 아이템 단위). */
  const pickDeep = useCallback(async (x: number, y: number): Promise<{ hit: HitResult; pick: StagePick | null } | null> => {
    const hit = hitAt(x, y);
    if (!hit) return null;
    if (hit.op.kind !== 'composition' || dRef.current.mode !== 'stage') return { hit, pick: null };
    const pick = await dRef.current.pickAt(x, y);
    return { hit, pick: pick && pick.op.itemId === hit.op.itemId ? pick : null };
  }, [hitAt]);

  const onHover = useCallback((x: number, y: number): void => {
    if (dRef.current.interaction === 'none') return;
    const hit = hitAt(x, y);
    if (!hit) { setHover(null); return; }
    if (hit.op.kind !== 'composition' || dRef.current.mode !== 'stage') { setHover(hit.rect); return; }
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
          t: cur.playhead,
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
        const asset = item.assetId ? doc.assets[item.assetId] : undefined;
        const file = item.kind === 'composition' && asset?.source.kind === 'file' ? asset.source.path : undefined;
        const ownText = typeof item.props?.['text'] === 'string' ? (item.props['text'] as string) : undefined;
        const text = pick?.element?.text || ownText || item.label;
        const path = pick?.element?.path;
        cur.addPointed({
          itemId: item.id,
          t: cur.playhead,
          kind: item.kind,
          ...(file ? { file } : {}),
          ...(path ? { path } : {}),
          ...(text ? { text } : {}),
          ...(pick?.element?.prop ? { prop: pick.element.prop } : {}),
        });
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

  const rings: PreviewRing[] = [];
  // 고른 것의 상자(앱 색 테) — 위에 다른 것이 덮여 있어도 고른 것의 자리를 보인다.
  if (d.selectedItemId && d.doc && d.timeline) {
    const op = buildDrawList(d.doc, d.timeline, d.playhead).find((o) => o.itemId === d.selectedItemId);
    if (op && op.kind !== 'caption') rings.push({ id: 'selected', rect: opRect(op), tone: 'selected' });
  }
  for (const r of pointedRings) rings.push({ id: `pointed-${r.itemId}-${r.path}`, rect: r.rect, tone: 'pointed' });
  if (hover) rings.push({ id: 'hover', rect: hover, tone: 'hover' });

  const pins: PreviewPin[] = d.notes
    .filter((n) => n.status !== 'closed' && (Math.abs(n.t - d.playhead) <= PIN_WINDOW_S || n.id === activeNoteId))
    .map((n) => ({ id: n.id, n: n.n, x: n.x, y: n.y, status: n.status, active: n.id === activeNoteId }));

  const editProps: PreviewEdit | null = edit ? {
    rect: edit.rect,
    value: edit.value,
    fontSize: edit.fontSize,
    onCommit: (value) => { setEdit(null); if (value !== edit.value) dRef.current.onSetProp(edit.itemId, edit.key, value); },
    onCancel: () => setEdit(null),
  } : null;

  return {
    rings, pins, edit: editProps, noteDraft, activeNoteId, setActiveNoteId,
    onHover, onLeave, onPress, onDoublePress, commitNote, cancelNote: () => setNoteDraft(null),
  };
}
