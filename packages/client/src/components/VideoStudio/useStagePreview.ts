import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { resolveTimeline, type VideoDoc } from '@vibisual/video';
import { HtmlSceneStage, type CompositionFrameEvent, type MediaProvider, type StagePick, type StageText } from '@vibisual/video/render';

import { makeCompositionSrc } from './compositionUrl.js';

/**
 * §5.13 (T-4)(T-7) — 코드 컴포지션이 든 문서의 **미리보기 = 같은 DOM 무대를 줄여 띄운 것**.
 *
 * 미리보기는 즉시성 때문에 canvas2d 로 그려 왔지만 canvas2d 는 HTML 을 그릴 수 없다. 그래서 컴포지션이 있으면 렌더 무대와
 * 같은 `HtmlSceneStage`(샌드박스 iframe 포함)를 미리보기 칸 안에 세우고 칸 크기에 맞춰 줄인다 — 사람이 보는 것과 일꾼이
 * 찍는 것이 같은 무대다. 문서가 바뀔 때마다 무대를 새로 세우지 않는다(`setDoc` — 같은 코드·같은 데이터의 프레임은 그대로).
 *
 * 컴포지션은 **보이는 자리**에 있어야 한다 — 화면 밖의 교차 출처 프레임은 브라우저가 그리기를 멈춘다(무대 머리말 ⚠).
 */
export interface StagePreview {
  /** t 초의 모습으로 맞춘다. 도는 동안 들어온 요청은 마지막 하나만 남겼다가 그린다(앞뒤로 튀지 않게). */
  readonly seek: (t: number) => void;
  /**
   * §5.13 (V) 37-6 — 문서 픽셀 (x, y) 아래 맨 위의 것. 컴포지션이면 샌드박스에 읽기 전용으로 그 자리 요소를 묻는다(1.5초 상한 —
   * 답이 없으면 아이템 단위). 무대가 없으면 null.
   */
  readonly pickAt: (x: number, y: number) => Promise<StagePick | null>;
  /** §5.13 (V) 37-9 — 지금 시각에 컴포지션들 안에서 보이는 글자 상자(문서 픽셀). */
  readonly inspectTexts: () => Promise<StageText[]>;
}

export function useStagePreview(opts: {
  readonly enabled: boolean;
  readonly project: string;
  readonly doc: VideoDoc | null;
  readonly media: MediaProvider | null | undefined;
  readonly host: RefObject<HTMLDivElement>;
  readonly onEvent?: (itemId: string, event: CompositionFrameEvent) => void;
}): StagePreview {
  const { enabled, project, doc, media, host } = opts;
  const stageRef = useRef<HtmlSceneStage | null>(null);
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;
  const loop = useRef<{ busy: boolean; want: number | null }>({ busy: false, want: null });
  /** 마지막으로 요청받은 시각 — 무대를 새로 세운 직후 그 자리를 바로 그린다. */
  const lastWanted = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;

  const seek = useCallback((t: number): void => {
    lastWanted.current = t;
    const state = loop.current;
    state.want = t;
    if (state.busy) return;
    state.busy = true;
    void (async () => {
      try {
        while (state.want !== null) {
          const at = state.want;
          state.want = null;
          const stage = stageRef.current;
          if (!stage) break;
          await stage.seek(at);
        }
      } catch {
        // 미리보기는 엄격하지 않다 — 컴포지션 오류는 `onEvent` 로 이미 알렸다.
      } finally {
        state.busy = false;
      }
    })();
  }, []);

  /** 무대를 칸에 맞춘다 — 가운데 두고 비율을 지켜 줄인다(레터박스). */
  const fit = useCallback((): void => {
    const stage = stageRef.current;
    const box = host.current;
    const current = docRef.current;
    if (!stage || !box || !current) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const { width, height } = current.size;
    if (bw <= 0 || bh <= 0 || width <= 0 || height <= 0) return;
    const scale = Math.min(bw / width, bh / height);
    const left = (bw - width * scale) / 2;
    const top = (bh - height * scale) / 2;
    const el = stage.element;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }, [host]);

  const docId = doc?.id ?? '';
  // 무대는 문서(id)·소재 공급자·프로젝트가 바뀔 때만 새로 세운다.
  useEffect(() => {
    const box = host.current;
    const current = docRef.current;
    if (!enabled || !box || !current || !media) return;
    const stage = new HtmlSceneStage({
      doc: current,
      timeline: resolveTimeline(current),
      media,
      container: box,
      compositionSrc: makeCompositionSrc(project, current),
      onCompositionEvent: (itemId, event) => onEventRef.current?.(itemId, event),
    });
    stageRef.current = stage;
    fit();
    seek(lastWanted.current);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    observer?.observe(box);
    return () => {
      observer?.disconnect();
      if (stageRef.current === stage) stageRef.current = null;
      stage.dispose();
    };
    // 문서 내용이 바뀌는 것은 아래 효과가 `setDoc` 으로 받는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, media, project, fit, host, seek]);

  useEffect(() => {
    if (!doc) return;
    stageRef.current?.setDoc(doc, resolveTimeline(doc));
    fit();
    seek(lastWanted.current);
  }, [doc, fit, seek]);

  const pickAt = useCallback(async (x: number, y: number): Promise<StagePick | null> => {
    const stage = stageRef.current;
    if (!stage) return null;
    try { return await stage.pickAt(x, y); } catch { return null; }
  }, []);

  const inspectTexts = useCallback(async (): Promise<StageText[]> => {
    const stage = stageRef.current;
    if (!stage) return [];
    try { return await stage.inspectTexts(); } catch { return []; }
  }, []);

  return { seek, pickAt, inspectTexts };
}
