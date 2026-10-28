/**
 * §5.13 (R-9) — 그림 보기 창 풀기 계획(원본 해상도로 풀면 6000×4000 한 장이 약 96MB): 처음엔 맞춤 × 배율을 256 단위로(원본 이하)
 * · 원본이 1.5배 안이면 원본을 바로 · 원본은 1.1배 넘게 촘촘할 때 붙들고 충분해지면 놓기 · 커지면 다시, 작아지면 그대로
 * · 숨으면 내려놓기·끊기·URL 되돌리기·비트맵 닫기(원문 검사).
 */
import { describe, it, expect } from 'vitest';
import { IMAGE_VIEW } from '@vibisual/shared';

import {
  VIEWER_FIT_MARGIN_PX, neededWidthPx, planImageView, previewWidthFor, viewDirectly, viewerFitScale, wantsFullResolution,
  type ImageViewInput,
} from './imageViewPlan.js';

const PHOTO = { width: 6000, height: 4000 };
const STAGE = { width: 900, height: 600 };

function input(over: Partial<ImageViewInput> = {}): ImageViewInput {
  const natural = over.natural ?? PHOTO;
  const stage = over.stage ?? STAGE;
  return {
    natural,
    stage,
    devicePixelRatio: 1,
    scale: viewerFitScale(natural, stage),
    previewRequested: 0,
    previewWidth: 0,
    holdingFull: false,
    ...over,
  };
}

describe('viewerFitScale · neededWidthPx — 보이는 만큼의 장치 픽셀', () => {
  it('맞춤 배율은 무대 여백을 뺀 자리에 맞추고 키우지 않는다(종전 보기 창 식 그대로)', () => {
    expect(viewerFitScale(PHOTO, STAGE)).toBeCloseTo(Math.min((900 - VIEWER_FIT_MARGIN_PX) / 6000, (600 - VIEWER_FIT_MARGIN_PX) / 4000));
    expect(viewerFitScale({ width: 64, height: 64 }, STAGE)).toBe(1);
    expect(viewerFitScale(PHOTO, { width: 0, height: 0 })).toBe(1);
    expect(viewerFitScale(PHOTO, { width: 10, height: 10 })).toBe(0);
  });

  it('필요 너비는 배율 × 화면 배율이고 원본을 넘지 않는다(배율 1 미만 화면은 1 로 본다)', () => {
    expect(neededWidthPx(6000, 0.5, 1)).toBe(3000);
    expect(neededWidthPx(6000, 0.5, 2)).toBe(6000);
    expect(neededWidthPx(6000, 2, 1)).toBe(6000);
    expect(neededWidthPx(6000, 0.1, 0.5)).toBe(600);
    expect(neededWidthPx(0, 1, 1)).toBe(0);
  });
});

describe('① 처음엔 창에 맞는 크기만 — 임시 저화질', () => {
  it('6000×4000 사진을 900×600 무대에 열면 1024 너비로만 푼다(원본을 풀지 않는다)', () => {
    const plan = planImageView(input());
    expect(plan).toEqual({ direct: false, previewWidth: 1024, full: false });
    // 원본 해상도의 1/34 화소 — 약 96MB 대신 3MB 남짓.
    expect((1024 * (1024 * 4000 / 6000)) / (6000 * 4000)).toBeLessThan(0.05);
  });

  it('고해상 화면은 그 배율만큼 더 촘촘히 푼다', () => {
    expect(planImageView(input({ devicePixelRatio: 2 })).previewWidth).toBe(1792);
  });

  it('미리보기 너비는 256 단위로 올려 잡고 원본 너비를 넘지 않는다', () => {
    expect(previewWidthFor(1, 6000)).toBe(IMAGE_VIEW.previewStepPx);
    expect(previewWidthFor(852, 6000)).toBe(1024);
    expect(previewWidthFor(1025, 6000)).toBe(1280);
    expect(previewWidthFor(5000, 3000)).toBe(3000);
  });
});

describe('② 원본이 미리보기의 1.5배 안이면 원본을 바로 그린다', () => {
  it('작은 아이콘 · 무대만 한 그림은 미리보기 없이 원본', () => {
    expect(planImageView(input({ natural: { width: 512, height: 512 } }))).toEqual({ direct: true, previewWidth: 0, full: true });
    expect(planImageView(input({ natural: { width: 1400, height: 900 } })).direct).toBe(true);
    expect(viewDirectly(1536, 1024)).toBe(true);
    expect(viewDirectly(1537, 1024)).toBe(false);
  });

  it('무대를 아직 못 잰 판(0×0)은 원본으로 친다 — 부르는 쪽이 화면 크기를 넣는다', () => {
    expect(planImageView(input({ stage: { width: 0, height: 0 }, scale: 1 })).direct).toBe(true);
  });
});

describe('③ 원본은 확대해 더 촘촘해야 할 때만 — 문턱 둘', () => {
  it('미리보기가 아직 없으면 원본을 붙들지 않고 미리보기를 기다린다', () => {
    expect(planImageView(input({ scale: 1 })).full).toBe(false);
  });

  it('맞춤 화면 · 한 번 살짝 확대(1.1배 안)는 미리보기, 그 너머는 원본', () => {
    const fit = viewerFitScale(PHOTO, STAGE);
    const base = { previewRequested: 1024, previewWidth: 1024 };
    expect(planImageView(input({ ...base, scale: fit })).full).toBe(false);
    expect(planImageView(input({ ...base, scale: 1100 / 6000 })).full).toBe(false);
    expect(planImageView(input({ ...base, scale: 1200 / 6000 })).full).toBe(true);
    expect(planImageView(input({ ...base, scale: 1 })).full).toBe(true);
  });

  it('붙든 원본은 미리보기로 충분해질 때(필요 ≤ 미리보기)까지 놓지 않는다', () => {
    expect(wantsFullResolution(1100, 1024, true)).toBe(true);
    expect(wantsFullResolution(1100, 1024, false)).toBe(false);
    expect(wantsFullResolution(1024, 1024, true)).toBe(false);
    expect(wantsFullResolution(1, 0, false)).toBe(true);
  });
});

describe('④ 창이 커지면 다시 풀고, 작아져도 줄여 다시 풀지 않는다', () => {
  it('최대화하면 그 맞춤 크기로 다시 풀고, 다시 푸는 동안 원본까지 풀지 않는다', () => {
    const grown = planImageView(input({ stage: { width: 1800, height: 1200 }, previewRequested: 1024, previewWidth: 1024 }));
    expect(grown.previewWidth).toBe(1792);
    expect(grown.full).toBe(false);
    // 키운 창에서 사용자가 더 확대하면 그때는 원본이다.
    expect(planImageView(input({ stage: { width: 1800, height: 1200 }, previewRequested: 1024, previewWidth: 1024, scale: 0.5 })).full).toBe(true);
  });

  it('창을 다시 줄여도 이미 푼 너비 그대로다', () => {
    expect(planImageView(input({ previewRequested: 1792, previewWidth: 1792 })).previewWidth).toBe(1792);
  });

  it('브라우저가 청한 것보다 작게 풀어도 다시 풀기를 되풀이하지 않는다(청한 너비로 판단)', () => {
    const plan = planImageView(input({ previewRequested: 1024, previewWidth: 683 }));
    expect(plan.previewWidth).toBe(1024);
  });
});

describe('⑤ 보기 창 배선 — 숨으면 내려놓고, 닫으면 끊고 되돌린다', () => {
  const sources = import.meta.glob(['./VibimageViewer.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const viewer = sources['./VibimageViewer.tsx'] ?? '';

  it('판단은 이 모듈 한 곳에서 온다', () => {
    expect(viewer).toContain('planImageView(');
    expect(viewer).toContain('viewerFitScale(');
  });

  it('숨은 지 hiddenReleaseMs 가 지나면 내려놓고, 받던 것은 끊는다', () => {
    expect(viewer).toContain('useAppVisible()');
    expect(viewer).toContain('IMAGE_VIEW.hiddenReleaseMs');
    expect(viewer).toContain('ctrl.abort()');
    expect(viewer).toMatch(/fetchWorkspaceMediaBlob\(root, file, \{ signal: ctrl\.signal \}\)/);
  });

  it('원본 URL 은 되돌리고, 늦게 풀린 비트맵은 닫는다 · 원본을 놓는 것은 조금 뒤다', () => {
    expect(viewer).toContain('URL.revokeObjectURL(url)');
    expect(viewer).toContain('bitmap.close()');
    expect(viewer).toContain('IMAGE_VIEW.fullReleaseDelayMs');
    expect(viewer).toContain("getContext('bitmaprenderer')");
  });
});
