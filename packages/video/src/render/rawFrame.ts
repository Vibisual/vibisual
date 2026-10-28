/**
 * §5.13 (W) 38-1 — 숨은 창이 찍은 날 비트맵을 캔버스에 옮긴다. main 의 `toPNG()` 는 메인 스레드에서 한 장 332ms(실측 Electron 31·2561×1368, 그동안 서버도 멈춘다)라
 * `toBitmap()`(2.4ms)을 넘긴다. 불투명은 `VideoFrame`(`BGRX`/`RGBX`)으로 GPU 가 그리고, 투명·`VideoFrame` 없음은 `rawToStraightRgba` 로.
 * 바이트 순서는 플랫폼마다 다를 수 있어("platform-dependent") main 이 1×1 빨간 점으로 판정해 싣는다(`order`) — 가정하지 않고 인자로 받아 둘 다 시험한다.
 */

import type { Ctx2D } from './canvas2d.js';

export type BitmapOrder = 'bgra' | 'rgba';

/** 숨은 창 한 장의 날 픽셀(실제 픽셀 크기 — 화면 배율이 곱해져 문서보다 클 수 있다). */
export interface RawFrame {
  readonly kind: 'raw';
  readonly width: number;
  readonly height: number;
  readonly order: BitmapOrder;
  /** 알파가 미리 곱해져 있는가(창 캡처 비트맵은 그렇다). */
  readonly premultiplied: boolean;
  readonly data: ArrayBuffer;
}

/**
 * 1×1 빨간 점(RGBA 255,0,0,255) PNG — main 이 `nativeImage` 로 열어 `toBitmap()` 의 바이트 순서를 판정한다.
 * (우리가 만든 4바이트 픽셀을 zlib 으로 감싼 것 — 실측: Windows 에서 [0,0,255,255] = BGRA.)
 */
export const RED_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

/** 빨간 점 한 개의 비트맵 바이트 → 순서. 둘 다 아니면 null(그때는 PNG 길로 물러선다). */
export function bitmapOrderOf(bytes: ArrayLike<number>): BitmapOrder | null {
  const b0 = bytes[0] ?? -1;
  const b1 = bytes[1] ?? -1;
  const b2 = bytes[2] ?? -1;
  if (b0 >= 250 && b1 <= 5 && b2 <= 5) return 'rgba';
  if (b2 >= 250 && b1 <= 5 && b0 <= 5) return 'bgra';
  return null;
}

export function isRawFrame(v: unknown): v is RawFrame {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return r['kind'] === 'raw'
    && typeof r['width'] === 'number' && typeof r['height'] === 'number'
    && (r['order'] === 'bgra' || r['order'] === 'rgba')
    && r['data'] instanceof ArrayBuffer;
}

/**
 * 날 비트맵 → 곧은 알파 RGBA(순수). `order` 가 `bgra` 면 빨강·파랑을 바꾸고, 미리 곱한 알파면 풀어 준다(알파 0 은 검은 투명).
 */
export function rawToStraightRgba(data: ArrayLike<number>, order: BitmapOrder, premultiplied: boolean): Uint8ClampedArray<ArrayBuffer> {
  const n = data.length - (data.length % 4);
  const out = new Uint8ClampedArray(new ArrayBuffer(n));
  const swap = order === 'bgra';
  for (let i = 0; i < n; i += 4) {
    const a = data[i + 3] ?? 0;
    let r = (swap ? data[i + 2] : data[i]) ?? 0;
    let g = data[i + 1] ?? 0;
    let b = (swap ? data[i] : data[i + 2]) ?? 0;
    if (premultiplied) {
      if (a === 0) { r = 0; g = 0; b = 0; }
      else if (a < 255) {
        r = Math.min(255, Math.round((r * 255) / a));
        g = Math.min(255, Math.round((g * 255) / a));
        b = Math.min(255, Math.round((b * 255) / a));
      }
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

/**
 * 날 프레임을 캔버스의 (0,0,width,height) 에 그린다(브라우저). 크기가 다르면 매끈하게 줄이거나 키운다.
 * 반환값은 찍힌 해상도 / 문서 해상도의 작은 쪽(1 이상이면 손실 없음 — 1 보다 작으면 호출부가 경고한다).
 */
export async function drawRawFrame(ctx: Ctx2D, frame: RawFrame, width: number, height: number, alpha: boolean): Promise<number> {
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const ratio = Math.min(frame.width / Math.max(1, width), frame.height / Math.max(1, height));
  if (!alpha && typeof VideoFrame === 'function') {
    try {
      const vf = new VideoFrame(new Uint8Array(frame.data), {
        format: frame.order === 'bgra' ? 'BGRX' : 'RGBX',
        codedWidth: frame.width,
        codedHeight: frame.height,
        timestamp: 0,
      });
      try {
        ctx.drawImage(vf, 0, 0, width, height);
      } finally {
        vf.close();
      }
      return ratio;
    } catch {
      // 이 환경의 VideoFrame 이 이 형식을 모르면 순수 변환으로 물러선다.
    }
  }
  const rgba = rawToStraightRgba(new Uint8Array(frame.data), frame.order, frame.premultiplied);
  const image = new ImageData(rgba, frame.width, frame.height);
  if (frame.width === width && frame.height === height) {
    ctx.putImageData(image, 0, 0);
    return ratio;
  }
  const bitmap = await createImageBitmap(image);
  try {
    ctx.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  return ratio;
}
