import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { useGraphStore, agentSessionInputKey, type ImageLightboxState } from '../../stores/graphStore.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import {
  ANNOTATION_COLORS,
  ANNOTATION_FONT_STACK,
  ANNOTATION_TOOLS,
  ANNOTATION_WIDTH_STEPS,
  EMPTY_ANNOTATION_HISTORY,
  HIGHLIGHT_ALPHA,
  arrowHead,
  baseBadgeRadius,
  baseFontSize,
  baseStrokeWidth,
  canRedo,
  canUndo,
  clearAnnotations,
  commitAnnotation,
  commitFrame,
  composeLayers,
  createAnnotation,
  exportAnnotatedImage,
  extendAnnotation,
  hasEdits,
  isCommittable,
  nextBadgeIndex,
  normalizeBox,
  penPathD,
  redoAnnotations,
  referencedLayerSrcs,
  toImagePoint,
  undoAnnotations,
  withAlpha,
  type Annotation,
  type AnnotationHistory,
  type AnnotationStyle,
  type AnnotationTool,
  type Box,
  type EditFrame,
  type Point,
  type RasterLayer,
  type RasterSource,
  type Size,
} from './imageAnnotate.js';
import {
  ALPHA_FLOOR,
  DEFAULT_TOLERANCE_PERCENT,
  TRIM_TOLERANCE,
  applyEditOp,
  aspectRatio,
  canvasToBlob,
  colorDistances,
  colorKey,
  dominantCorner,
  fitAspect,
  fullBox,
  hasTransparency,
  isCropPending,
  isFullBox,
  mimeKeepsAlpha,
  nudgeCropBox,
  opLeavesTransparency,
  parseHexColor,
  pixelAt,
  readCompositePixels,
  readPixels,
  rgbToHex,
  setCropField,
  toleranceFromPercent,
  trimBounds,
  type CropAspect,
  type CropField,
  type CropShape,
  type EditOp,
  type LayerFrame,
  type PixelBuffer,
  type Rgb,
} from './imageEdit.js';
import {
  AlphaGlyph,
  AlphaOptionsBar,
  CropGlyph,
  CropOptionsBar,
  CropOverlay,
  holdFocus,
  type AlphaMode,
} from './ImageEditBars.js';
import { putWorkspaceImage } from './workspaceImageSave.js';
import { copyImageToClipboard, resolveClipboardSurface, type ClipboardScope } from './imageClipboard.js';

// §5.5 #17-25 v4.80 — 라이트박스 안에서 이미지에 직접 표시하고, 표시가 박힌 PNG 를 그대로 첨부한다.
//
// 기본은 `보기`(도구 미선택) — 그때 오버레이는 pointer-events:none 이라 v2.61 의 보기 동작
// (배경 클릭·Esc·× 닫기)이 한 글자도 바뀌지 않는다. 도구를 고른 사람에게만 캔버스가 열린다.
// 계산은 전부 imageAnnotate.ts(순수 모듈)에 있고 여기는 입력·표시·저장 배선만 한다.
//
// ⑦ — [보기] 옆의 [자르기]·[알파 빼기]는 표시가 아니라 **그림 자체**를 고친다. 그림은 세 겹
// (바탕 래스터 · 원형 자르기가 구운 표시 · 벡터 주석)이고 편집 한 번이 되돌리기 한 칸이다.
// 픽셀·상자 계산은 imageEdit.ts, 옵션 줄과 자르기 상자는 ImageEditBars.tsx 에 있다.

const API_BASE = '';

/** [복사됨] 표시를 붙들어 두는 시간 — 누른 사람이 알아볼 만큼만 짧게. */
const COPIED_HOLD_MS = 1600;

interface ImageLightboxViewProps {
  state: ImageLightboxState;
  /** 라이트박스를 띄운 IDE 의 에이전트·세션 — 주석본을 "새 첨부"로 붙일 자리. */
  agentId: string;
  activeSessionId: string | null;
  /** 입력창이 있는 뷰인가(읽기 전용 Hook 메인 탭이면 false → [내려받기]만). */
  canAttach: boolean;
  onClose: () => void;
}

/** 막대에서 고르는 도구 — 표시 도구에 ⑦ 의 편집 도구 둘을 더한다. null 은 [보기]. */
type EditorTool = AnnotationTool | 'crop' | 'alpha';

function isAnnotationTool(tool: EditorTool | null): tool is AnnotationTool {
  return tool !== null && tool !== 'crop' && tool !== 'alpha';
}

/** [색 빼기]로 고른 색과 번짐의 출발점(natural 픽셀). */
interface KeyDraft {
  color: Rgb;
  seeds: Point[];
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `an-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 그림 한 장을 풀어 둔다. 못 풀면 null — 호출부가 "편집할 수 없다"로 알린다. */
async function loadRaster(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  return img.naturalWidth > 0 ? img : null;
}

/**
 * 편집이 만든 한 겹을 PNG blob URL 로 — 되돌리기 칸은 캔버스 대신 이 URL 만 든다.
 * 만든 URL 은 `made` 에 적어 둔다: 커밋까지 못 가고 끝나면 호출부가 그 목록으로 모두 해제한다.
 */
async function encodeLayer(source: RasterSource, transparent: boolean, made: string[]): Promise<RasterLayer | null> {
  const canvas = source instanceof HTMLCanvasElement ? source : composeLayers(source, null, []);
  if (!canvas) return null;
  const blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) return null;
  const src = URL.createObjectURL(blob);
  made.push(src);
  // 미리 풀어 둔다 — 바탕을 갈아 끼우는 순간 빈 그림이 한 번 비치지 않게.
  await loadRaster(src);
  return { src, w: canvas.width, h: canvas.height, transparent };
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password']);

/** 글자를 치는 자리인가 — 그 안의 Ctrl+Z·Ctrl+C·화살표는 그 입력의 것이다. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/** Enter 를 제 일로 쓰는 요소인가(버튼 누르기·고르기 열기 등) — 그 위의 Enter 는 적용으로 가로채지 않는다. */
function ownsEnterKey(target: EventTarget | null): boolean {
  if (isTextEntry(target)) return true;
  if (target instanceof HTMLInputElement) return target.type !== 'range';
  return target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target instanceof HTMLAnchorElement;
}

export function ImageLightboxView({
  state,
  agentId,
  activeSessionId,
  canAttach,
  onClose,
}: ImageLightboxViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const updateAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);
  const markWorkspaceImageSaved = useGraphStore((s) => s.markWorkspaceImageSaved);

  const [tool, setTool] = useState<EditorTool | null>(null);
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0] ?? '#ef4444');
  const [widthStep, setWidthStep] = useState(1);
  const [history, setHistory] = useState<AnnotationHistory>(EMPTY_ANNOTATION_HISTORY);
  const [draft, setDraft] = useState<Annotation | null>(null);
  // 원본 그림의 크기. 편집이 바탕을 바꾼 뒤로는 크기가 그 바탕(history.base)을 따른다.
  const [originalNatural, setOriginalNatural] = useState<Size>({ w: 0, h: 0 });
  // <img> 가 다 받아 둔 주소 — 바탕을 갈아 끼우는 동안 옛 그림 위에 새 크기의 겹을 그리지 않게.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // 원본에 투명이 있는가 — [알파 빼기]를 처음 열 때 한 번 잰다(아직 모르면 null).
  const [originalTransparent, setOriginalTransparent] = useState<boolean | null>(null);
  const [textDraft, setTextDraft] = useState<{ at: Point; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // ④-1 그 사이 디스크가 바뀌었을 때 — 사용자가 [그래도 저장]을 고를 때까지 덮어쓰지 않는다.
  const [fileConflict, setFileConflict] = useState(false);
  // ⑦ 자르기 — 상자는 도구를 여는 순간 고른 비율로 그림 전체에 잡힌다.
  const [cropBox, setCropBox] = useState<Box | null>(null);
  const [cropAspect, setCropAspect] = useState<CropAspect>('free');
  /**
   * 지금 비율이 [원형]이 자유 비율에서 **스스로** 맞춘 1:1 인가. 도구를 나가면 모양은 사각으로 돌아가는데 그 1:1 만 남아,
   * 다음 사각 자르기가 고른 적 없는 정사각형으로 시작했다. 사용자가 비율을 직접 고르면(1:1 을 다시 눌러도) 그 선택이다.
   */
  const autoSquareRef = useRef(false);
  const [cropShape, setCropShape] = useState<CropShape>('rect');
  // ⑦ 알파 빼기
  const [alphaMode, setAlphaMode] = useState<AlphaMode>('key');
  const [keyDraft, setKeyDraft] = useState<KeyDraft | null>(null);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_TOLERANCE_PERCENT);
  const [contiguous, setContiguous] = useState(true);
  const [fillColor, setFillColor] = useState('#ffffff');
  // 편집 한 번을 굽는 중 — 그동안 다른 편집·되돌리기·저장이 끼어들지 않는다.
  const [busy, setBusy] = useState(false);
  // 옵션 줄의 한 줄 알림(뺄 색이 없다 등). 다음 조작에서 걷힌다.
  const [notice, setNotice] = useState<string | null>(null);
  // [색 빼기] 미리보기가 지금 값으로 다 그려졌는가 — 그 전까지는 원본을 그대로 보인다.
  const [previewReady, setPreviewReady] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<Annotation | null>(null);
  const drawingRef = useRef(false);
  // 글자 입력은 Enter 와 blur 두 곳에서 확정된다 — ref 를 먼저 비워 같은 글자가 두 번 박히지 않게.
  const textDraftRef = useRef<{ at: Point; value: string } | null>(null);
  // 굽기가 끝났을 때 "그사이 스택이 움직였나"를 보는 눈 — 렌더마다 최신으로 맞춘다.
  const historyRef = useRef(history);
  historyRef.current = history;
  // setState 는 다음 렌더에야 보이므로, 같은 틱에 두 번 눌린 적용은 여기서 막는다.
  const busyRef = useRef(false);
  // 창이 닫힌 뒤 끝난 굽기가 새 겹을 등록하지 않게.
  const aliveRef = useRef(true);
  // 이 창이 만든 래스터 blob URL — 스택이 더는 가리키지 않으면 해제한다.
  const layerUrlsRef = useRef(new Set<string>());
  // 바탕 픽셀 캐시 — 같은 바탕이면 슬라이더를 움직일 때마다 다시 읽지 않는다.
  const pixelsRef = useRef<{ src: string; buf: PixelBuffer } | null>(null);
  // 고른 색까지의 거리 캐시 — 오차만 바꾸면 거리는 그대로다.
  const distRef = useRef<{ src: string; hex: string; dist: Uint8Array } | null>(null);
  // 창 전체 keydown 이 부를 처리 — 렌더마다 최신 상태로 다시 쓴다(아래 `keyHandlerRef.current = …`).
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const setTextDraftBoth = useCallback((next: { at: Point; value: string } | null) => {
    textDraftRef.current = next;
    setTextDraft(next);
  }, []);

  const items = history.items;
  const badgeFloor = history.badgeFloor ?? 0;
  const baseSrc = history.base?.src ?? state.url;
  const natural = useMemo<Size>(
    () => (history.base ? { w: history.base.w, h: history.base.h } : originalNatural),
    [history.base, originalNatural],
  );
  // 크기를 안다(막대·옵션 줄을 열 수 있다) / 화면의 <img> 가 지금 바탕을 다 받았다(겹을 그려도 된다).
  const layoutReady = natural.w > 0 && natural.h > 0;
  const ready = layoutReady && loadedSrc === baseSrc;
  const baseTransparent = history.base ? history.base.transparent : originalTransparent;
  const cropRatio = useMemo(() => aspectRatio(cropAspect, natural), [cropAspect, natural]);
  const drawTool = isAnnotationTool(tool) ? tool : null;

  // 적용을 기다리는 편집 — [적용]·Enter 가 커밋하고, 저장·복사·내려받기는 이것까지 얹어 굽는다.
  const pendingOp = useMemo<EditOp | null>(() => {
    if (tool === 'crop') {
      return cropBox && isCropPending(cropBox, cropShape, natural)
        ? { kind: 'crop', box: cropBox, shape: cropShape }
        : null;
    }
    if (tool !== 'alpha') return null;
    if (alphaMode === 'key') {
      return keyDraft
        ? {
          kind: 'key',
          color: keyDraft.color,
          seeds: keyDraft.seeds,
          tolerance: toleranceFromPercent(tolerancePct),
          contiguous,
        }
        : null;
    }
    // 메울 투명이 있을 때만 — 없는 그림에서 [투명 채우기]는 할 일이 없다.
    const fill = parseHexColor(fillColor);
    return fill && baseTransparent === true ? { kind: 'fill', color: fill } : null;
  }, [tool, cropBox, cropShape, natural, alphaMode, keyDraft, tolerancePct, contiguous, fillColor, baseTransparent]);

  const edited = hasEdits(history);
  // 닫기 확인·배경 클릭 닫기의 판정 — 적용하지 않은 편집도 잃을 작업이다.
  const dirty = edited || draft !== null || pendingOp !== null;
  const canSave = (edited || pendingOp !== null) && !busy;
  const workspace = state.workspace;
  // jpeg 는 알파를 담지 못한다 — 투명이 남을 그림이면 덮어쓰기를 막고 [투명 채우기]·[내려받기]로 안내한다.
  const jpegBlocked =
    !!workspace && !mimeKeepsAlpha(workspace.mime) && opLeavesTransparency(pendingOp, baseTransparent === true);
  const fillPreview = pendingOp?.kind === 'fill';
  const keyPreviewOn = tool === 'alpha' && alphaMode === 'key' && keyDraft !== null && ready;
  const showKeyPreview = keyPreviewOn && previewReady;
  // 체커보드 — 알파를 다루는 동안, 그리고 편집으로 투명이 생긴 뒤로는 늘. 채우기 미리보기 중엔 그 색이 깔린다.
  const showChecker = !fillPreview && (tool === 'alpha' || history.base?.transparent === true);
  const optionsOpen = (tool === 'crop' || tool === 'alpha') && layoutReady;

  // 굵기 3단은 "이미지 크기에서 뽑은 기본값"에 곱한다 — 4K 든 아이콘 캡처든 화면에서 같은 두께로 보인다.
  const style = useMemo<AnnotationStyle>(() => {
    const mul = ANNOTATION_WIDTH_STEPS[widthStep] ?? 1;
    const scale = 0.7 + mul * 0.3;
    return {
      color,
      strokeWidth: Math.max(1, baseStrokeWidth(natural) * mul),
      fontSize: Math.max(10, baseFontSize(natural) * scale),
      badgeRadius: Math.max(8, baseBadgeRadius(natural) * scale),
    };
  }, [color, widthStep, natural]);

  const setDraftBoth = useCallback((next: Annotation | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  /**
   * §5.5 #17-25 ④-2 — 이 런타임이 클립보드에 **그림**을 올릴 수 있는가.
   *
   * `null` 이면 버튼이 흐려지고 그 이유를 말한다. 전역을 한 번만 들여다보는 이유는 이 능력이
   * 창이 사는 동안 바뀌지 않기 때문이다(보안 컨텍스트는 문서 단위로 정해진다).
   */
  const clipboard = useMemo(
    () => resolveClipboardSurface(globalThis as unknown as ClipboardScope),
    [],
  );

  /**
   * 지금 화면의 바탕 픽셀 — 같은 바탕이면 캐시를 준다. 다른 출처 그림이라 읽기가 막히면 null.
   * <img> 가 아직 새 바탕을 다 받지 못했으면 읽지 않는다(옛 그림의 픽셀을 새 바탕으로 착각하지 않게).
   */
  const readBasePixels = useCallback((): PixelBuffer | null => {
    const img = imgRef.current;
    if (!img || !img.complete || img.naturalWidth <= 0 || img.getAttribute('src') !== baseSrc) return null;
    const cached = pixelsRef.current;
    if (cached && cached.src === baseSrc) return cached.buf;
    try {
      const buf = readPixels(img);
      if (!buf) return null;
      pixelsRef.current = { src: baseSrc, buf };
      return buf;
    } catch {
      return null;
    }
  }, [baseSrc]);

  /** 스택 한 칸을 캔버스가 읽을 세 겹으로. 화면의 <img> 가 그 바탕이면 그것을 그대로 쓴다. */
  const currentLayerFrame = useCallback(async (frame: EditFrame): Promise<LayerFrame | null> => {
    const src = frame.base?.src ?? state.url;
    const img = imgRef.current;
    let base: RasterSource | null = null;
    if (img && img.getAttribute('src') === src) {
      try { await img.decode(); } catch { /* 아래에서 크기로 판정한다 */ }
      if (img.getAttribute('src') === src && img.complete && img.naturalWidth > 0) base = img;
    }
    if (!base) base = await loadRaster(src);
    if (!base) return null;
    const marks = frame.marks ? await loadRaster(frame.marks.src) : null;
    if (frame.marks && !marks) return null;
    return {
      base,
      marks,
      items: frame.items,
      transparent: frame.base ? frame.base.transparent : originalTransparent,
      ...(frame.badgeFloor ? { badgeFloor: frame.badgeFloor } : {}),
    };
  }, [state.url, originalTransparent]);

  /**
   * 나가는 그림 한 장 — 스택의 지금 칸에 **적용하지 않은 편집까지** 얹어 굽는다(화면에서 본 그대로).
   * 창의 상태는 건드리지 않는다: 복사·내려받기 뒤에도 자르기 상자와 고른 색은 그대로 남는다.
   */
  const renderExport = useCallback(async (mime: string): Promise<Blob | null> => {
    const frame = await currentLayerFrame(history);
    if (!frame) return null;
    let out = frame;
    if (pendingOp) {
      const res = applyEditOp(frame, pendingOp, pendingOp.kind === 'crop' ? null : readBasePixels());
      if (res.ok) out = res.frame;
      else if (res.reason === 'failed') return null;
    }
    return await exportAnnotatedImage(out.base, out.items, mime, out.marks);
  }, [history, pendingOp, currentLayerFrame, readBasePixels]);

  /**
   * §5.5 #17-25 ④-2 — **네 번째 나가는 자리: 클립보드.**
   *
   * 내려받기(⑤)와 같은 결이라 **주석이 없어도 눌린다** — 그때는 원본 한 장이 그대로 나간다.
   * 굽기를 `await` 하지 않고 **약속째로** 넘기는 이유는 `imageClipboard.ts` 주석에 있다(쓰기가
   * 사용자 제스처 안에서 시작돼야 거절되지 않는다).
   *
   * 정의가 여기 있는 것은 취향이 아니다 — 키 처리(`keyHandlerRef`)가 렌더 중에 이 함수를 잡으므로
   * 그보다 뒤에 선언되면 TDZ 로 죽는다. 이 함수가 부르는 `renderExport` 도 같은 이유로 위에 있다.
   */
  const handleCopy = useCallback(async () => {
    if (copying || busyRef.current) return;
    setError(null);
    setCopying(true);
    try {
      const result = await copyImageToClipboard(renderExport('image/png'), clipboard);
      if (result.ok) {
        setCopied(true);
        return;
      }
      setError(t(
        result.reason === 'unsupported'
          ? 'ide.imageAnnotate.copyUnsupported'
          : result.reason === 'denied'
            ? 'ide.imageAnnotate.copyDenied'
            : 'ide.imageAnnotate.copyFailed',
        { download: t('ide.imageAnnotate.download') },
      ));
    } finally {
      setCopying(false);
    }
  }, [copying, renderExport, clipboard, t]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  /** 도구를 바꾸면 그 도구에서 벌이던 일(치던 글자·자르기 상자·고른 색·알림)은 접는다. */
  const selectTool = useCallback((next: EditorTool | null) => {
    setTool(next);
    setTextDraftBoth(null);
    setNotice(null);
    setKeyDraft(null);
    setCropBox(null);
    setCropShape('rect');
    // 모양이 사각으로 돌아가면 그 모양이 스스로 맞춘 1:1 도 함께 거둔다(사용자가 고른 비율은 남긴다).
    if (autoSquareRef.current) {
      autoSquareRef.current = false;
      setCropAspect('free');
    }
  }, [setTextDraftBoth]);

  /**
   * ⑦ 편집 한 번을 스택에 올린다 — 계산은 저장 직전 반영과 **같은** `applyEditOp` 이고, 결과는 PNG 겹으로
   * 구워 되돌리기 한 칸이 된다. 굽는 사이 스택이 움직였으면(되돌리기 등) 결과를 버린다.
   */
  const commitOp = useCallback(async (op: EditOp) => {
    if (busyRef.current) return;
    const start = historyRef.current;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const made: string[] = [];
    try {
      const frame = await currentLayerFrame(start);
      if (!frame) {
        setNotice(t('ide.imageAnnotate.edit.failed'));
        return;
      }
      const res = applyEditOp(frame, op, op.kind === 'crop' ? null : readBasePixels());
      if (!res.ok) {
        setNotice(t(
          res.reason === 'noMatch'
            ? 'ide.imageAnnotate.alpha.noMatch'
            : res.reason === 'noTransparency'
              ? 'ide.imageAnnotate.alpha.noTransparency'
              : 'ide.imageAnnotate.edit.failed',
        ));
        return;
      }
      const next = res.frame;
      const base = await encodeLayer(next.base, next.transparent ?? true, made);
      // 바탕만 바꾸는 편집(알파)은 구운 표시를 그대로 넘긴다 — 같은 겹을 다시 굽지 않는다.
      let marks: RasterLayer | null = null;
      if (next.marks === frame.marks) marks = start.marks;
      else if (next.marks) marks = await encodeLayer(next.marks, true, made);
      if (!base || (next.marks && !marks)) {
        setNotice(t('ide.imageAnnotate.edit.failed'));
        return;
      }
      if (!aliveRef.current || historyRef.current !== start) return;
      for (const url of made) layerUrlsRef.current.add(url);
      made.length = 0;
      const nextFloor = next.badgeFloor ?? 0;
      setHistory((h) => (h === start ? commitFrame(h, { items: next.items, base, marks, ...(nextFloor ? { badgeFloor: nextFloor } : {}) }) : h));
      // 자르기는 한 번이면 끝이라 [보기]로 돌아간다. 알파는 이어서 다른 색을 뺄 수 있게 도구에 남는다.
      if (op.kind === 'crop') selectTool(null);
      else setKeyDraft(null);
    } catch {
      setNotice(t('ide.imageAnnotate.edit.failed'));
    } finally {
      for (const url of made) URL.revokeObjectURL(url);
      busyRef.current = false;
      setBusy(false);
    }
  }, [currentLayerFrame, readBasePixels, selectTool, t]);

  // ─── ⑦ 자르기 ───

  /** 비율을 고르면 지금 상자 안에서 그 비율로 가장 큰 상자로 맞춘다. */
  const handleAspect = useCallback((next: CropAspect) => {
    autoSquareRef.current = false;
    setCropAspect(next);
    setNotice(null);
    const ratio = aspectRatio(next, natural);
    setCropBox((b) => fitAspect(b ?? fullBox(natural), ratio, natural));
  }, [natural]);

  const handleShape = useCallback((next: CropShape) => {
    setCropShape(next);
    setNotice(null);
    // [원형]을 자유 비율에서 켜면 원이 기본 — 1:1 로 맞춘다(비율을 다시 풀면 타원).
    if (next === 'ellipse' && cropAspect === 'free') {
      handleAspect('1:1');
      autoSquareRef.current = true;
    }
  }, [cropAspect, handleAspect]);

  const handleField = useCallback((field: CropField, value: number) => {
    setNotice(null);
    setCropBox((b) => (b ? setCropField(b, field, value, cropRatio, natural) : b));
  }, [cropRatio, natural]);

  const handleCropChange = useCallback((box: Box) => {
    setNotice(null);
    setCropBox(box);
  }, []);

  /** [여백 자동] — 표시까지 합친 화면 그대로에서, 귀퉁이 색 테두리를 걷은 상자를 잡는다. */
  const handleTrim = useCallback(async () => {
    if (busyRef.current || !layoutReady) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const frame = await currentLayerFrame(historyRef.current);
      const px = frame ? readCompositePixels(frame) : null;
      if (!px) {
        setNotice(t('ide.imageAnnotate.edit.failed'));
        return;
      }
      const box = trimBounds(px, TRIM_TOLERANCE);
      if (!box || isFullBox(box, natural)) {
        setNotice(t('ide.imageAnnotate.crop.trimNone'));
        return;
      }
      // 걷어 낸 상자는 비율이 제각각이다 — 고정 비율로 다시 맞추면 여백이 도로 들어온다.
      autoSquareRef.current = false;
      setCropAspect('free');
      setCropBox(box);
    } catch {
      setNotice(t('ide.imageAnnotate.edit.failed'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [layoutReady, currentLayerFrame, natural, t]);

  // ─── ⑦ 알파 빼기 ───

  /** [색 빼기] — 그림을 눌러 뺄 색과 번짐의 출발점을 고른다. 색은 바탕에서 읽는다(표시 색은 고르지 않는다). */
  const handlePick = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (busyRef.current || saving || !ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = toImagePoint(
      { x: e.clientX, y: e.clientY },
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      natural,
    );
    const px = readBasePixels();
    if (!px) {
      setNotice(t('ide.imageAnnotate.edit.failed'));
      return;
    }
    const picked = pixelAt(px, at);
    if (picked.a <= ALPHA_FLOOR) {
      setNotice(t('ide.imageAnnotate.alpha.pickTransparent'));
      return;
    }
    setNotice(null);
    setKeyDraft({
      color: { r: picked.r, g: picked.g, b: picked.b },
      seeds: [{
        x: Math.min(px.width - 1, Math.max(0, Math.floor(at.x))),
        y: Math.min(px.height - 1, Math.max(0, Math.floor(at.y))),
      }],
    });
  }, [saving, ready, natural, readBasePixels, t]);

  /** [배경 자동] — 귀퉁이에서 가장 많이 겹치는 색을 뺄 색으로, 그 귀퉁이들을 번짐의 출발점으로. */
  const handleAuto = useCallback(() => {
    if (busyRef.current || !ready) return;
    const px = readBasePixels();
    if (!px) {
      setNotice(t('ide.imageAnnotate.edit.failed'));
      return;
    }
    const corner = dominantCorner(px, TRIM_TOLERANCE, { skipTransparent: true });
    if (!corner) {
      setNotice(t('ide.imageAnnotate.alpha.autoNone'));
      return;
    }
    setNotice(null);
    setAlphaMode('key');
    setKeyDraft({ color: corner.color, seeds: corner.seeds });
  }, [ready, readBasePixels, t]);

  // ─── 표시 그리기 ───

  const pointFromEvent = useCallback(
    (e: React.PointerEvent): Point | null => {
      const svg = svgRef.current;
      if (!svg || natural.w <= 0 || natural.h <= 0) return null;
      const rect = svg.getBoundingClientRect();
      return toImagePoint(
        { x: e.clientX, y: e.clientY },
        { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        natural,
      );
    },
    [natural],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawTool || saving || busy) return;
      e.stopPropagation();
      e.preventDefault();
      const at = pointFromEvent(e);
      if (!at) return;
      if (drawTool === 'text') {
        setTextDraftBoth({ at, value: '' });
        return;
      }
      if (drawTool === 'number') {
        const badge = createAnnotation({
          id: newId(),
          tool: 'number',
          at,
          style,
          badgeIndex: nextBadgeIndex(items, badgeFloor),
        });
        setHistory((h) => commitAnnotation(h, badge));
        return;
      }
      drawingRef.current = true;
      // 이미지 밖으로 끌어도 계속 그려지게 포인터를 잡는다(좌표는 imageAnnotate 가 안쪽으로 클램프).
      // 포인터가 이미 사라진 드문 타이밍에는 던지므로 삼킨다 — 못 잡아도 그리기 자체는 된다.
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      setDraftBoth(createAnnotation({ id: newId(), tool: drawTool, at, style }));
    },
    [drawTool, saving, busy, pointFromEvent, style, items, badgeFloor, setDraftBoth, setTextDraftBoth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) return;
      const at = pointFromEvent(e);
      const cur = draftRef.current;
      if (!at || !cur) return;
      const next = extendAnnotation(cur, at);
      if (next !== cur) setDraftBoth(next);
    },
    [pointFromEvent, setDraftBoth],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* 이미 놓였으면 무시 */ }
      const done = draftRef.current;
      setDraftBoth(null);
      if (done && isCommittable(done)) setHistory((h) => commitAnnotation(h, done));
    },
    [setDraftBoth],
  );

  const commitText = useCallback(() => {
    const cur = textDraftRef.current;
    if (!cur) return;
    setTextDraftBoth(null);
    const ann = createAnnotation({ id: newId(), tool: 'text', at: cur.at, style, text: cur.value });
    if (isCommittable(ann)) setHistory((h) => commitAnnotation(h, ann));
  }, [style, setTextDraftBoth]);

  // ─── 나가는 자리 ───

  const uploadAnnotated = useCallback(
    async (blob: Blob, sid: string): Promise<string> => {
      const file = new File([blob], `annotated-${Date.now()}.png`, { type: 'image/png' });
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(`${API_BASE}/api/agent-attachments/${sid}/upload`, { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      return data.path;
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (saving || busyRef.current || !(edited || pendingOp)) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await renderExport('image/png');
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const target = state.attachment;
      const ownerAgentId = target?.agentId ?? agentId;
      const sid = agents.find((a) => a.id === ownerAgentId)?.path ?? null;
      if (!sid) throw new Error(t('ide.imageAnnotate.noSession'));
      const serverPath = await uploadAnnotated(blob, sid);
      const previewUrl = URL.createObjectURL(blob);
      // (a) 대기 중 첨부를 열었으면 그 자리를 교체 — 보내지도 않은 원본이 디스크에 남지 않게 옛 파일은 지운다.
      const prevEntry = target
        ? useGraphStore.getState().agentSessionInputs[agentSessionInputKey(target.agentId, target.sessionId)]
        : undefined;
      const prevAttachment = target
        ? prevEntry?.attachments.find((a) => a.tempId === target.tempId)
        : undefined;
      if (target && prevAttachment) {
        updateAttachments(target.agentId, target.sessionId, (prev) =>
          prev.map((a) => (a.tempId === target.tempId ? { ...a, previewUrl, serverPath, uploading: false } : a)),
        );
        if (prevAttachment.previewUrl && prevAttachment.previewUrl !== previewUrl) {
          URL.revokeObjectURL(prevAttachment.previewUrl);
        }
        if (prevAttachment.serverPath && prevAttachment.serverPath !== serverPath) {
          void fetch(`${API_BASE}/api/agent-attachments/${sid}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: prevAttachment.serverPath }),
          }).catch(() => {});
        }
      } else {
        // (b) 이미 보낸 이미지(또는 그새 사라진 첨부) — 지난 기록은 두고 현재 입력창에 새 첨부로 붙인다.
        updateAttachments(agentId, activeSessionId, (prev) => [
          ...prev,
          { tempId: newId(), previewUrl, serverPath, uploading: false },
        ]);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ide.imageAnnotate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [saving, edited, pendingOp, renderExport, state.attachment, agentId, activeSessionId, agents, uploadAnnotated, updateAttachments, onClose, t]);

  /**
   * §5.5 #17-25 ④-1 — 세 번째 저장 자리: **그 파일 자체를 덮어쓴다**.
   *
   * 첨부 저장(`handleSave`)과 갈라 둔 이유는 목적지가 다르기 때문이다. 규율은 편집창의 텍스트 저장과
   * 같은 것을 쓴다 — 읽을 때 본 `mtimeMs` 를 함께 보내고, 그 사이 디스크가 바뀌었으면(409) 덮어쓰지
   * 않고 사용자가 [그래도 저장]을 고르게 한다.
   */
  const handleSaveToFile = useCallback(async (force = false) => {
    const target = state.workspace;
    if (!target || saving || busyRef.current || !target.bakeable || jpegBlocked || !(edited || pendingOp)) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await renderExport(target.mime);
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const out = await putWorkspaceImage(target.root, target.path, blob, force ? 0 : target.mtimeMs, target.revision);
      if (!out.ok) {
        setFileConflict(out.status === 409);
        setError(t(out.status === 409 ? 'ide.imageAnnotate.fileConflict' : 'ide.imageAnnotate.fileSaveFailed'));
        return;
      }
      // 편집창이 이 신호를 보고 다시 읽어, 방금 그린 표시가 미리보기에 그대로 올라온다.
      markWorkspaceImageSaved(target.root, target.path);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ide.imageAnnotate.fileSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [state.workspace, saving, jpegBlocked, edited, pendingOp, renderExport, markWorkspaceImageSaved, onClose, t]);

  const handleDownload = useCallback(async () => {
    if (busyRef.current) return;
    setError(null);
    try {
      const blob = await renderExport('image/png');
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `annotated-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ide.imageAnnotate.saveFailed'));
    }
  }, [renderExport, t]);

  // ─── 효과 ───

  // 스택이 더는 가리키지 않는 겹(상한 밖으로 밀려난 칸·새 편집에 잘린 앞날)은 해제한다.
  useEffect(() => {
    const live = referencedLayerSrcs(history);
    for (const url of layerUrlsRef.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        layerUrlsRef.current.delete(url);
      }
    }
  }, [history]);

  // 창이 닫히면 이 창이 만든 겹을 모두 푼다 — ⑥ 범위 불변(편집 겹은 창과 함께 사라진다).
  useEffect(() => {
    aliveRef.current = true;
    const urls = layerUrlsRef.current;
    return () => {
      aliveRef.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // 바탕이 바뀌면(적용·되돌리기) 옛 바탕 위에서 잡은 상자·고른 색·픽셀 캐시는 더는 맞지 않는다.
  useEffect(() => {
    setCropBox(null);
    setKeyDraft(null);
    setPreviewReady(false);
    pixelsRef.current = null;
    distRef.current = null;
  }, [baseSrc]);

  // [자르기]를 열면(또는 바탕이 바뀌면) 상자를 그림 전체 — 비율을 골라 두었으면 그 비율의 가장 큰 상자로.
  useEffect(() => {
    if (tool !== 'crop' || cropBox || !layoutReady) return;
    setCropBox(fitAspect(fullBox(natural), cropRatio, natural));
  }, [tool, cropBox, layoutReady, natural, cropRatio]);

  // 원본의 투명 여부는 [알파 빼기]를 처음 열 때 한 번 잰다 — [투명 채우기]가 할 일이 있는지 알려야 한다.
  useEffect(() => {
    if (tool !== 'alpha' || originalTransparent !== null || history.base || !ready) return;
    const px = readBasePixels();
    if (px) setOriginalTransparent(hasTransparency(px));
  }, [tool, originalTransparent, history.base, ready, readBasePixels]);

  // [색 빼기] 미리보기 — 고른 색·오차·이어진 곳만을 바꿀 때마다 바탕에 적용한 모습을 캔버스에 그린다.
  // 거리는 (바탕, 색)마다 한 번만 잰다 — 오차 슬라이더를 끄는 동안은 문턱만 다시 적용된다.
  useEffect(() => {
    if (!keyPreviewOn || !keyDraft) {
      setPreviewReady(false);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const canvas = previewRef.current;
      const ctx = canvas?.getContext('2d') ?? null;
      const px = readBasePixels();
      if (!canvas || !ctx || !px) {
        setPreviewReady(false);
        return;
      }
      const hex = rgbToHex(keyDraft.color);
      let cache = distRef.current;
      if (!cache || cache.src !== baseSrc || cache.hex !== hex) {
        cache = { src: baseSrc, hex, dist: colorDistances(px, keyDraft.color) };
        distRef.current = cache;
      }
      const out = colorKey(px, {
        color: keyDraft.color,
        tolerance: toleranceFromPercent(tolerancePct),
        contiguous,
        seeds: keyDraft.seeds,
        distances: cache.dist,
      });
      if (canvas.width !== px.width) canvas.width = px.width;
      if (canvas.height !== px.height) canvas.height = px.height;
      ctx.putImageData(new ImageData(out.buffer.data, px.width, px.height), 0, 0);
      setPreviewReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [keyPreviewOn, keyDraft, tolerancePct, contiguous, baseSrc, readBasePixels]);

  // [복사됨]은 잠깐만 머문다. 다시 복사하면 타이머가 새로 잡히고, 닫히면 함께 걷힌다.
  useEffect(() => {
    if (!copied) return undefined;
    const id = window.setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [copied]);

  // 창이 뜨면 초점을 창으로 — 뒤에 깔린 입력창이 초점을 쥐고 있으면 Enter·Ctrl+Z 가 그 입력창의 것이 된다.
  // 닫히면 초점을 원래 자리로 돌려준다.
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  // 키는 창 전체에서 받는다 — 처리 내용은 렌더마다 새로 쓰는 keyHandlerRef 에 있다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc(확인창 닫기 → 치던 글자 버리기 → 자르기·알파 도구 나가기 → 닫기 확인) · Enter(⑦ 적용) ·
  // 화살표(자르기 상자 1px, Shift 10px) · Ctrl+Z / Ctrl+Shift+Z · Ctrl+Y · Ctrl+C(④-2 클립보드).
  // 글자를 치는 중이면 그 입력이 먼저다. 판정은 규약대로 `ctrlKey || metaKey` 라 mac 에서는 ⌘ 로 같다.
  keyHandlerRef.current = (e) => {
    const target = e.target;
    const root = rootRef.current;
    const inside = target instanceof Node && !!root && root.contains(target);
    // 이 창 밖(다른 창·패널)에 초점이 있으면 그 자리의 키다 — body 는 "아무 데도 아님"이라 창의 것으로 본다.
    const outside = target instanceof Element && !inside && target !== document.body && target !== document.documentElement;
    const typing = isTextEntry(target);
    if (e.key === 'Escape') {
      if (confirmDiscard) {
        setConfirmDiscard(false);
        return;
      }
      if (textDraftRef.current) {
        setTextDraftBoth(null);
        return;
      }
      // ⑦ — Esc 는 라이트박스를 닫지 않고 도구만 나간다(적용하지 않은 상자·고른 색은 버린다).
      if (tool === 'crop' || tool === 'alpha') {
        selectTool(null);
        return;
      }
      requestClose();
      return;
    }
    if (confirmDiscard || textDraftRef.current) return;
    if (e.key === 'Enter') {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (outside || (inside && ownsEnterKey(target))) return;
      if (!pendingOp || busyRef.current || saving) return;
      e.preventDefault();
      void commitOp(pendingOp);
      return;
    }
    if (
      tool === 'crop' && cropBox && e.key.startsWith('Arrow') && !typing && !outside &&
      !(e.ctrlKey || e.metaKey || e.altKey) && !busyRef.current
    ) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (dx === 0 && dy === 0) return;
      e.preventDefault();
      setNotice(null);
      setCropBox((b) => (b ? nudgeCropBox(b, dx, dy, natural) : b));
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || typing) return;
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (!busyRef.current) setHistory(e.shiftKey ? redoAnnotations : undoAnnotations);
    } else if (key === 'y') {
      e.preventDefault();
      if (!busyRef.current) setHistory(redoAnnotations);
    } else if (key === 'c' && !hasTextSelection()) {
      // 글자를 골라 둔 상태의 Ctrl/⌘+C 는 **그 글자의 것**이다 — 그때만 비켜선다.
      e.preventDefault();
      void handleCopy();
    }
  };

  // 배경 클릭으로 닫기(작업물이 없을 때만). 그림·주석 위에서 시작한 드래그는 배경에서 끝나도 안 닫힌다.
  const backdrop = useBackdropDismiss(() => { if (!dirty) onClose(); });

  const applyPending = (): void => {
    if (pendingOp) void commitOp(pendingOp);
  };

  return (
    <div
      {...backdrop}
      ref={rootRef}
      tabIndex={-1}
      className="vibi-image-lightbox fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-black/80 p-6 pt-14 outline-none"
      role="dialog"
      aria-modal="true"
      // §5.24 단축키 스코프 — 이 창은 body 로 portal 되어 IDE 창(`data-ide-overlay`) 밖에 선다. 표식이 없으면 여기서 난 키가
      //   **캔버스 스코프**로 읽혀, 초점이 창에 있는 채로 누른 `Delete` 가 캔버스에서 골라 둔 버블을 지웠다.
      data-shortcut-scope="dialog"
    >
      {/* 도구 막대 — 배경 클릭 닫기와 겹치지 않게 이벤트를 여기서 끊는다. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-w-[92vw] flex-wrap items-center justify-center gap-1 rounded-xl border border-gray-700 bg-gray-900/95 px-2 py-1.5 shadow-2xl"
      >
        <ToolbarButton
          active={tool === null}
          label={t('ide.imageAnnotate.tool.view')}
          onClick={() => selectTool(null)}
        >
          <ToolGlyph tool="view" />
        </ToolbarButton>
        {/* ⑦ 그림 자체를 고치는 두 도구 — [보기] 옆. */}
        <ToolbarButton
          active={tool === 'crop'}
          disabled={!layoutReady}
          label={t('ide.imageAnnotate.tool.crop')}
          onClick={() => selectTool('crop')}
        >
          <CropGlyph />
        </ToolbarButton>
        <ToolbarButton
          active={tool === 'alpha'}
          disabled={!layoutReady}
          label={t('ide.imageAnnotate.tool.alpha')}
          onClick={() => selectTool('alpha')}
        >
          <AlphaGlyph />
        </ToolbarButton>
        <Divider />
        {ANNOTATION_TOOLS.map((item) => (
          <ToolbarButton
            key={item}
            active={tool === item}
            label={t(`ide.imageAnnotate.tool.${item}`)}
            onClick={() => selectTool(item)}
          >
            <ToolGlyph tool={item} />
          </ToolbarButton>
        ))}
        <Divider />
        <div className="flex items-center gap-1 px-0.5" title={t('ide.imageAnnotate.color')}>
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onMouseDown={holdFocus}
              onClick={() => setColor(c)}
              className={`h-4 w-4 rounded-full border transition-transform ${
                color === c ? 'scale-125 border-white' : 'border-gray-600 hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Divider />
        <div className="flex items-center gap-0.5">
          {ANNOTATION_WIDTH_STEPS.map((mul, i) => (
            <button
              key={mul}
              type="button"
              title={t(`ide.imageAnnotate.width.${i === 0 ? 'thin' : i === 1 ? 'medium' : 'thick'}`)}
              aria-label={t(`ide.imageAnnotate.width.${i === 0 ? 'thin' : i === 1 ? 'medium' : 'thick'}`)}
              onMouseDown={holdFocus}
              onClick={() => setWidthStep(i)}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                widthStep === i ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span
                className="block rounded-full bg-current"
                style={{ width: `${6 + i * 4}px`, height: `${1.5 + i * 2}px` }}
              />
            </button>
          ))}
        </div>
        <Divider />
        <ToolbarButton
          label={t('ide.imageAnnotate.undo', { shortcut: shortcutLabel('Ctrl+Z') })}
          disabled={busy || !canUndo(history)}
          onClick={() => setHistory(undoAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
        </ToolbarButton>
        <ToolbarButton
          label={t('ide.imageAnnotate.redo', { shortcut: shortcutLabel('Ctrl+Shift+Z') })}
          disabled={busy || !canRedo(history)}
          onClick={() => setHistory(redoAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
        </ToolbarButton>
        {/* ⑦ [전체 지우기]는 표시(주석 + 원형 자르기가 구운 표시)만 — 자르기·알파는 그대로 둔다. */}
        <ToolbarButton
          label={t('ide.imageAnnotate.clear')}
          disabled={busy || (items.length === 0 && history.marks === null)}
          onClick={() => setHistory(clearAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
        </ToolbarButton>
        <Divider />
        <ToolbarButton label={t('ide.imageAnnotate.download')} disabled={busy} onClick={() => void handleDownload()}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </ToolbarButton>
        {/* ④-2 클립보드 — 다른 프로그램에 곧바로 붙이는 자리. 주석이 없어도 눌린다. */}
        <ToolbarButton
          label={
            clipboard
              ? t(copied ? 'ide.imageAnnotate.copied' : 'ide.imageAnnotate.copy', {
                shortcut: shortcutLabel('Ctrl+C'),
              })
              : t('ide.imageAnnotate.copyUnsupported', { download: t('ide.imageAnnotate.download') })
          }
          disabled={!clipboard || copying || busy}
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </ToolbarButton>
        {/* ④-1 워크스페이스 파일에서 연 팝업 — 첨부가 아니라 그 파일을 덮어쓴다(둘은 병행). */}
        {workspace && (
          <button
            type="button"
            disabled={!canSave || saving || !workspace.bakeable || jpegBlocked}
            onMouseDown={holdFocus}
            onClick={() => void handleSaveToFile()}
            title={
              !workspace.bakeable
                ? t('ide.imageAnnotate.saveFileUnsupported')
                : jpegBlocked
                  ? t('ide.imageAnnotate.fileJpegAlpha', {
                    fill: t('ide.imageAnnotate.alpha.modeFill'),
                    download: t('ide.imageAnnotate.download'),
                  })
                  : t('ide.imageAnnotate.saveFileHint', { path: workspace.path })
            }
            className="ml-1 flex h-7 items-center gap-1.5 rounded bg-emerald-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {saving ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
            {t('ide.imageAnnotate.saveFile')}
          </button>
        )}
        {canAttach && (
          <button
            type="button"
            disabled={!canSave || saving}
            onMouseDown={holdFocus}
            onClick={() => void handleSave()}
            className="ml-1 flex h-7 items-center gap-1.5 rounded bg-blue-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {saving ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            )}
            {state.attachment ? t('ide.imageAnnotate.saveReplace') : t('ide.imageAnnotate.saveAttach')}
          </button>
        )}
      </div>

      {/* ⑦ 옵션 줄 — 고른 편집 도구의 것만, 도구 막대 바로 아래에. */}
      {tool === 'crop' && layoutReady && (
        <CropOptionsBar
          box={cropBox}
          natural={natural}
          aspect={cropAspect}
          shape={cropShape}
          busy={busy || saving}
          pending={pendingOp?.kind === 'crop'}
          notice={notice}
          onAspect={handleAspect}
          onShape={handleShape}
          onField={handleField}
          onTrim={() => void handleTrim()}
          onApply={applyPending}
          onCancel={() => selectTool(null)}
        />
      )}
      {tool === 'alpha' && layoutReady && (
        <AlphaOptionsBar
          mode={alphaMode}
          keyColor={keyDraft?.color ?? null}
          tolerancePct={tolerancePct}
          contiguous={contiguous}
          fillColor={fillColor}
          baseTransparent={baseTransparent}
          busy={busy || saving}
          pending={pendingOp !== null}
          notice={notice}
          onMode={(mode) => { setAlphaMode(mode); setNotice(null); }}
          onAuto={handleAuto}
          onTolerance={(pct) => { setTolerancePct(pct); setNotice(null); }}
          onContiguous={(on) => { setContiguous(on); setNotice(null); }}
          onFillColor={(hex) => { setFillColor(hex); setNotice(null); }}
          onApply={applyPending}
          onCancel={() => selectTool(null)}
        />
      )}

      {error && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex max-w-[92vw] items-center rounded border border-red-500/40 bg-red-900/60 px-3 py-1 text-[12px] text-red-200"
        >
          <span className="min-w-0 truncate">{error}</span>
          {fileConflict && (
            <button
              type="button"
              onClick={() => { setFileConflict(false); void handleSaveToFile(true); }}
              className="ml-2 flex-shrink-0 rounded border border-red-400/50 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-red-500/20"
            >
              {t('ide.imageAnnotate.fileConflictOverwrite')}
            </button>
          )}
        </div>
      )}

      {/* 이미지 + 겹들 — 상자가 정확히 같아야 natural 좌표가 화면과 맞는다. 테두리는 바깥 상자가 그리고,
          그 안쪽(체커보드·채우기 미리보기 색)이 투명한 픽셀 뒤로 비친다. */}
      <div
        className={`relative rounded-lg border border-gray-700 shadow-2xl ${showChecker ? 'bg-alpha-checker' : ''}`}
        style={fillPreview ? { backgroundColor: fillColor } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          ref={imgRef}
          src={baseSrc}
          alt=""
          onLoad={(e) => {
            const el = e.currentTarget;
            const src = el.getAttribute('src');
            if (src === state.url) setOriginalNatural({ w: el.naturalWidth, h: el.naturalHeight });
            setLoadedSrc(src);
          }}
          className={`block max-w-[92vw] rounded-[7px] ${optionsOpen ? 'max-h-[70vh]' : 'max-h-[78vh]'} ${
            showKeyPreview ? 'invisible' : ''
          }`}
        />
        {keyPreviewOn && (
          <canvas
            ref={previewRef}
            className={`pointer-events-none absolute inset-0 h-full w-full rounded-[7px] ${showKeyPreview ? '' : 'invisible'}`}
          />
        )}
        {ready && history.marks && (
          <img
            src={history.marks.src}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full rounded-[7px]"
          />
        )}
        {ready && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${natural.w} ${natural.h}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`absolute inset-0 h-full w-full rounded-[7px] ${
              drawTool ? 'cursor-crosshair touch-none' : 'pointer-events-none'
            }`}
          >
            {items.map((ann) => (
              <AnnotationShape key={ann.id} ann={ann} />
            ))}
            {draft && <AnnotationShape ann={draft} />}
          </svg>
        )}
        {ready && tool === 'crop' && cropBox && (
          <CropOverlay
            box={cropBox}
            natural={natural}
            shape={cropShape}
            ratio={cropRatio}
            disabled={busy || saving}
            onChange={handleCropChange}
          />
        )}
        {ready && tool === 'alpha' && alphaMode === 'key' && (
          <div
            onPointerDown={handlePick}
            className={`absolute inset-0 touch-none rounded-[7px] ${busy ? 'cursor-wait' : 'cursor-crosshair'}`}
          />
        )}
        {textDraft && ready && (
          <input
            autoFocus
            value={textDraft.value}
            onChange={(e) => setTextDraftBoth(textDraft ? { ...textDraft, value: e.target.value } : textDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitText(); }
            }}
            onBlur={commitText}
            placeholder={t('ide.imageAnnotate.textPlaceholder')}
            className="absolute z-10 min-w-[7rem] rounded border border-blue-400 bg-gray-900/95 px-1.5 py-0.5 text-[12px] text-white outline-none"
            style={{
              left: `${(textDraft.at.x / natural.w) * 100}%`,
              top: `${(textDraft.at.y / natural.h) * 100}%`,
            }}
          />
        )}
      </div>

      <p className="text-[12px] text-gray-500" onClick={(e) => e.stopPropagation()}>
        {tool === 'crop'
          ? t('ide.imageAnnotate.hintCrop', { shortcut: shortcutLabel('Enter') })
          : tool === 'alpha'
            ? t(alphaMode === 'key' ? 'ide.imageAnnotate.hintAlphaKey' : 'ide.imageAnnotate.hintAlphaFill', {
              shortcut: shortcutLabel('Enter'),
            })
            : drawTool
              ? t('ide.imageAnnotate.hintDraw', { shortcut: shortcutLabel('Ctrl+Z') })
              : t('ide.imageAnnotate.hintPick')}
      </p>

      {/* v2.94 — 닫기는 Windows 네이티브 타이틀바 오버레이(우상단 ~144×36px)를 피해 top-12. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); requestClose(); }}
        aria-label={t('panel.detailPanel.close')}
        className="absolute right-4 top-12 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-gray-200 transition-colors hover:bg-black/80"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {confirmDiscard && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/70"
        >
          <div className="w-[min(22rem,90vw)] rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
            <p className="text-[13px] text-gray-200">{t('ide.imageAnnotate.discardTitle')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded border border-gray-600 px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-gray-800"
              >
                {t('ide.imageAnnotate.discardCancel')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-red-600 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-red-500"
              >
                {t('ide.imageAnnotate.discardConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 부속 ───

/**
 * 지금 화면에 **사용자가 고른 글자**가 있는가 — Ctrl/⌘+C 를 그림 복사로 가로챌지 가르는 판정.
 *
 * 없으면(대개 그렇다) 그 조합은 이 창의 것이고, 있으면 브라우저 기본 동작에 그대로 넘긴다.
 * 선택 API 가 없는 런타임에서는 "고른 글자가 없다"로 본다 — 그림 복사가 막다른 길이 되지 않게.
 */
function hasTextSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

function Divider(): React.JSX.Element {
  return <span className="mx-0.5 h-5 w-px flex-shrink-0 bg-gray-700" />;
}

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, disabled, label, onClick, children }: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled ?? false}
      // 초점을 가져가지 않는다 — 초점 받은 버튼 위의 Enter 는 그 버튼을 다시 누를 뿐이라 ⑦ 적용이 닿지 않는다.
      onMouseDown={holdFocus}
      onClick={onClick}
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      } disabled:cursor-not-allowed disabled:text-gray-700 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

/** 도구 글리프 — lucide 톤 stroke SVG (이모지 ❌). */
function ToolGlyph({ tool }: { tool: AnnotationTool | 'view' }): React.JSX.Element {
  const common = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (tool) {
    case 'view':
      return <svg {...common}><path d="m4 3 7 17 2.6-6.9L20 10.6z" /></svg>;
    case 'rect':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /></svg>;
    case 'ellipse':
      return <svg {...common}><ellipse cx="12" cy="12" rx="9" ry="7" /></svg>;
    case 'arrow':
      return <svg {...common}><line x1="5" y1="19" x2="19" y2="5" /><polyline points="10 5 19 5 19 14" /></svg>;
    case 'pen':
      return <svg {...common}><path d="M16.5 3.5a2.6 2.6 0 0 1 3.7 3.7L7.4 20 3 21l1-4.4z" /><path d="M15 5.5 18.5 9" /></svg>;
    case 'highlight':
      return <svg {...common}><path d="M9 13.5 5 17.5V21h3.5l4-4" /><path d="m12.5 17 7.2-7.2a2.6 2.6 0 0 0-3.7-3.7L8.8 13.3" /></svg>;
    case 'mask':
      return <svg {...common}><path d="M9.9 4.6A9.5 9.5 0 0 1 12 4.4c7 0 10 7.6 10 7.6a19 19 0 0 1-2.2 3.2M6.4 6.5A18 18 0 0 0 2 12s3 7.6 10 7.6a9.4 9.4 0 0 0 5.3-1.6" /><line x1="3" y1="3" x2="21" y2="21" /></svg>;
    case 'text':
      return <svg {...common}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>;
    case 'number':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M10.5 9.8 12.6 8.3V16" /></svg>;
  }
}

/** 주석 1개를 SVG 로. 캔버스(drawAnnotations)와 **같은 값**을 쓰므로 저장본이 화면과 같다. */
function AnnotationShape({ ann }: { ann: Annotation }): React.JSX.Element | null {
  switch (ann.tool) {
    case 'rect': {
      const box = normalizeBox(ann.from, ann.to);
      return (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeLinejoin="round"
        />
      );
    }
    case 'highlight': {
      const box = normalizeBox(ann.from, ann.to);
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={withAlpha(ann.color, HIGHLIGHT_ALPHA)} />;
    }
    case 'mask': {
      const box = normalizeBox(ann.from, ann.to);
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#000000" />;
    }
    case 'ellipse': {
      const box = normalizeBox(ann.from, ann.to);
      return (
        <ellipse
          cx={box.x + box.w / 2}
          cy={box.y + box.h / 2}
          rx={box.w / 2}
          ry={box.h / 2}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
        />
      );
    }
    case 'arrow': {
      const head = arrowHead(ann.from, ann.to, ann.strokeWidth);
      return (
        <g>
          <line
            x1={ann.from.x}
            y1={ann.from.y}
            x2={ann.to.x}
            y2={ann.to.y}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
          <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={ann.color} />
        </g>
      );
    }
    case 'pen':
      return (
        <path
          d={penPathD(ann.points)}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'text':
      return (
        <text
          x={ann.at.x}
          y={ann.at.y}
          fill={ann.color}
          stroke="rgba(0, 0, 0, 0.85)"
          strokeWidth={Math.max(2, ann.fontSize * 0.18)}
          paintOrder="stroke"
          fontSize={ann.fontSize}
          fontWeight={700}
          fontFamily={ANNOTATION_FONT_STACK}
          dominantBaseline="text-before-edge"
        >
          {ann.text}
        </text>
      );
    case 'number':
      return (
        <g>
          <circle
            cx={ann.at.x}
            cy={ann.at.y}
            r={ann.radius}
            fill={ann.color}
            stroke="rgba(0, 0, 0, 0.75)"
            strokeWidth={Math.max(1.5, ann.radius * 0.12)}
          />
          <text
            x={ann.at.x}
            y={ann.at.y + ann.radius * 0.04}
            fill="#0b0f19"
            fontSize={Math.round(ann.radius * 1.25)}
            fontWeight={700}
            fontFamily={ANNOTATION_FONT_STACK}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {ann.index}
          </text>
        </g>
      );
  }
}
