import { MEMO } from '../config.js';
import { mediaKind } from '../media.js';

export interface MediaPreview { thumb: Blob | null; width?: number; height?: number; duration?: number }

// 디코드·축소는 브라우저 코덱이 한다(JS 로 픽셀을 돌지 않는다). 목록이 이 작은 그림만 그려 원본 해상도를 디코드하지 않게 한다.
async function shrink(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  if (!width || !height) return null;
  const scale = Math.min(1, MEMO.thumbEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', MEMO.thumbQuality));
  return blob && blob.size <= MEMO.thumbMax ? blob : null;
}
async function imagePreview(file: File): Promise<MediaPreview | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    // 이미 작은 그림은 원본이 곧 미리보기다.
    return { thumb: Math.max(width, height) > MEMO.thumbEdge ? await shrink(bitmap, width, height) : null, width, height };
  } finally { bitmap.close(); }
}
function videoPreview(file: File): Promise<MediaPreview | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file); const video = document.createElement('video');
    let settled = false;
    const done = (value: MediaPreview | null): void => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); resolve(value);
    };
    // 브라우저가 못 푸는 코덱은 사건 없이 멈추기도 한다 — 미리보기 없이 올린다.
    const timer = setTimeout(() => done(null), MEMO.videoProbeMs);
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.onerror = () => done(null);
    video.onloadeddata = () => { video.currentTime = Math.min(1, (video.duration || 0) / 2); };
    video.onseeked = () => {
      const { videoWidth: width, videoHeight: height, duration } = video;
      void shrink(video, width, height).then(thumb => done({ thumb, width, height, ...(Number.isFinite(duration) ? { duration } : {}) }), () => done(null));
    };
    video.src = url;
  });
}
/** 올리기 전에 화면이 만드는 작은 미리보기와 치수. 만들 수 없는 형식·환경이면 null. */
export async function makePreview(file: File): Promise<MediaPreview | null> {
  if (typeof document === 'undefined') return null;
  const kind = mediaKind(file.name, file.type);
  if (kind === 'image') return imagePreview(file);
  if (kind === 'video') return videoPreview(file);
  return null;
}
