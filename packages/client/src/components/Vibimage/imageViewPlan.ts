import { IMAGE_VIEW } from '@vibisual/shared';

/**
 * §5.13 (R-9) — 그림 **보기 창이 무엇을 얼마나 풀어 둘지**(순수). 화면은 이 답대로 미리보기를 풀고 원본을 붙들거나 놓는다.
 *
 * 2026-10-21 사용자 지시 — *"전체 사진 불러올 필요 없고 화질 잘 저화해서 불러와서 임시로 보이게 … 안보면 잘 해제"*.
 * - **처음엔 창에 맞는 크기만** — 무대 맞춤 크기 × 화면 배율을 `IMAGE_VIEW.previewStepPx` 단위로 올려 잡은 너비로 줄여 푼 미리보기
 *   (임시 저화질). 창이 커지면 그 크기로 다시 풀고, 작아져도 이미 푼 것은 그대로 쓴다(다시 풀지 않는다).
 * - **원본은 확대해 더 촘촘해야 할 때만** — 보이는 배율이 미리보기보다 `fullAboveRatio` 배 넘게 촘촘해야 하면 붙들고, 미리보기로
 *   충분해질 때까지(필요 ≤ 미리보기) 놓지 않는다(문턱이 둘이라 오르내림에 흔들리지 않는다 — 놓는 시각은 화면이 `fullReleaseDelayMs` 로 늦춘다).
 * - **원본이 미리보기의 `directMaxRatio` 배 안이면** 두 번 풀 이득이 없다 — 미리보기 없이 원본을 바로 그린다.
 *
 * 너비는 전부 **장치 픽셀**(CSS px × 화면 배율)이고, 그림 크기는 EXIF 회전을 세운 뒤의 것이다(브라우저가 세워 푼다).
 */

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** 무대 가장자리 여백(CSS px, 양쪽 합) — 맞춤 화면에서 그림이 무대 끝에 닿지 않게. */
export const VIEWER_FIT_MARGIN_PX = 32;

/** 맞춤 배율 — 무대보다 크면 줄이고, 작으면 그대로(작은 아이콘을 흐리게 키우지 않는다). 크기를 모르면 1. */
export function viewerFitScale(natural: ViewSize, stage: ViewSize): number {
  if (!(natural.width > 0) || !(natural.height > 0) || !(stage.width > 0) || !(stage.height > 0)) return 1;
  return Math.max(0, Math.min(1, (stage.width - VIEWER_FIT_MARGIN_PX) / natural.width, (stage.height - VIEWER_FIT_MARGIN_PX) / natural.height));
}

/** 지금 보이는 너비를 채우는 데 드는 장치 픽셀 너비 — 원본 너비를 넘지 않는다(배율 1 미만 화면은 1 로 본다). */
export function neededWidthPx(naturalWidth: number, scale: number, devicePixelRatio: number): number {
  if (!(naturalWidth > 0)) return 0;
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 1 ? devicePixelRatio : 1;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 0;
  return Math.min(naturalWidth, Math.ceil(naturalWidth * s * ratio));
}

/** 미리보기로 풀 너비 — 필요한 너비를 `previewStepPx` 단위로 올려 잡되 원본 너비를 넘지 않는다. */
export function previewWidthFor(neededPx: number, naturalWidth: number): number {
  const step = IMAGE_VIEW.previewStepPx;
  const up = Math.max(step, Math.ceil(Math.max(1, neededPx) / step) * step);
  return Math.min(naturalWidth, up);
}

/** 미리보기 없이 원본을 바로 그릴까 — 원본이 미리보기 너비의 `directMaxRatio` 배 안이면 두 번 풀 이득이 없다. */
export function viewDirectly(naturalWidth: number, previewWidth: number): boolean {
  return naturalWidth <= previewWidth * IMAGE_VIEW.directMaxRatio;
}

/**
 * 원본을 붙들어야 하는가. 지금 원본이 없으면 필요 너비가 미리보기의 `fullAboveRatio` 배를 넘을 때 붙들고,
 * 이미 붙들고 있으면 미리보기로 충분해질 때(필요 ≤ 미리보기)까지 놓지 않는다. 미리보기가 없으면(0) 원본이다.
 */
export function wantsFullResolution(neededPx: number, previewWidth: number, holding: boolean): boolean {
  if (!(previewWidth > 0)) return true;
  return holding ? neededPx > previewWidth : neededPx > previewWidth * IMAGE_VIEW.fullAboveRatio;
}

export interface ImageViewInput {
  /** 세운 뒤의 원본 크기(그림 px). */
  readonly natural: ViewSize;
  /** 무대 크기(CSS px). 모르면 0 — 그때는 화면 크기를 넣는다(부르는 쪽). */
  readonly stage: ViewSize;
  readonly devicePixelRatio: number;
  /** 지금 보이는 배율(맞춤이면 맞춤 배율). */
  readonly scale: number;
  /** 지금 미리보기를 청한 너비(0 = 아직 없다). 다시 풀지 판단은 이것으로 한다(브라우저가 회전을 어떻게 세든 같은 답). */
  readonly previewRequested: number;
  /** 실제로 풀린 미리보기 너비(0 = 아직 없다). 원본이 필요한지는 이것으로 본다. */
  readonly previewWidth: number;
  /** 지금 원본을 붙들고 있는가. */
  readonly holdingFull: boolean;
}

export interface ImageViewPlan {
  /** 미리보기 없이 원본을 그린다. */
  readonly direct: boolean;
  /** 풀어 둘 미리보기 너비(`direct` 면 0). 지금 청한 것보다 크면 다시 푼다. */
  readonly previewWidth: number;
  /** 원본을 붙들어야 하는가. */
  readonly full: boolean;
}

export function planImageView(input: ImageViewInput): ImageViewPlan {
  const { natural } = input;
  const fitNeed = neededWidthPx(natural.width, viewerFitScale(natural, input.stage), input.devicePixelRatio);
  const target = previewWidthFor(fitNeed, natural.width);
  if (viewDirectly(natural.width, target)) return { direct: true, previewWidth: 0, full: true };
  // 이미 푼 것보다 작게 다시 풀지 않는다 — 창을 줄였다 키울 때마다 풀지 않게.
  const previewWidth = Math.max(target, input.previewRequested);
  if (!(input.previewWidth > 0)) return { direct: false, previewWidth, full: false };
  // 다시 풀 참이면(창이 커졌다) 곧 생길 미리보기로 판단한다 — 맞춤 화면에서 창을 키웠다고 원본까지 풀지 않게.
  const basis = previewWidth > input.previewRequested ? previewWidth : input.previewWidth;
  const need = neededWidthPx(natural.width, input.scale, input.devicePixelRatio);
  return { direct: false, previewWidth, full: wantsFullResolution(need, basis, input.holdingFull) };
}
