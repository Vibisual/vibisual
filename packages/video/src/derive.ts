/**
 * §5.13 (V) 37-15 — **판형 파생** (순수). 한 문서에서 16:9·9:16·1:1 문서를 만든다(`<docId>-<판형>`).
 *
 * 장면·아이템·소재를 그대로 옮기고 자리만 새 판형에 맞춘다:
 * - **실사·그림**(화면을 채우던 것) → 가운데 맞춤 **덮기(cover)** 상자 — 소재 비율 그대로 새 화면을 덮는다(넘치는 쪽은 잘린다).
 *   미리보기에서 끌어 자리를 고친다. 소재 크기를 모르면 화면 전체 상자(담기)로 둔다.
 * - **글자·도형·자막·씬** → 자리는 비율로(가운데 기준), 크기·글자 크기는 **짧은 변 비율**로.
 * - **컴포지션** → 화면을 채우던 것은 새 문서 크기를 그대로 받는다(반응형이면 `__vibi.width/height` 로 다시 짠다 — 규약 글).
 * 화면 전체를 채우던 아이템(상자 없음)은 계속 상자 없이 둔다 — 새 판형 전체가 곧 그 상자다.
 */

import { VIDEO_FORMATS } from './constants.js';
import { scaleKeyframes } from './keyframes.js';
import type { VideoAsset, VideoDoc, VideoFormatId, VideoItem, VideoTransform } from './types.js';

/** 판형마다 크기를 짧은 변 비율로 옮기는 글자·여백 속성. */
const SCALED_PROPS = ['fontSize', 'strokeWidth', 'radius', 'padding', 'bottom'] as const;

function round2(n: number): number {
  // -0 은 0 으로(덮기 상자의 가운데 맞춤이 부동소수 오차로 -0 을 내지 않게).
  return Math.round(n * 100) / 100 || 0;
}

/** 이 아이템이 화면 전체를 채우는가(상자 없음 또는 화면과 같은 상자). */
function fillsFrame(t: VideoTransform | undefined, size: VideoDoc['size']): boolean {
  if (!t || (t.x === undefined && t.y === undefined && t.width === undefined && t.height === undefined)) return true;
  const x = t.x ?? 0;
  const y = t.y ?? 0;
  const w = t.width ?? size.width;
  const h = t.height ?? size.height;
  return Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(w - size.width) < 1 && Math.abs(h - size.height) < 1;
}

/** 소재 비율로 새 화면을 덮는 가운데 상자. */
export function coverBox(mediaW: number, mediaH: number, frameW: number, frameH: number): { x: number; y: number; width: number; height: number } {
  if (!(mediaW > 0) || !(mediaH > 0)) return { x: 0, y: 0, width: frameW, height: frameH };
  const scale = Math.max(frameW / mediaW, frameH / mediaH);
  const width = mediaW * scale;
  const height = mediaH * scale;
  return { x: round2((frameW - width) / 2), y: round2((frameH - height) / 2), width: round2(width), height: round2(height) };
}

function deriveItem(item: VideoItem, from: VideoDoc['size'], to: VideoDoc['size'], assets: Readonly<Record<string, VideoAsset>>): VideoItem {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const s = Math.min(to.width, to.height) / Math.min(from.width, from.height);
  const full = fillsFrame(item.transform, from);
  const keepRest = (t: VideoTransform | undefined): Partial<VideoTransform> => ({
    ...(t?.rotation !== undefined ? { rotation: t.rotation } : {}),
    ...(t?.opacity !== undefined ? { opacity: t.opacity } : {}),
    ...(t?.scale !== undefined ? { scale: t.scale } : {}),
  });

  let transform: VideoTransform | undefined = item.transform;
  if ((item.kind === 'footage' || item.kind === 'image' || item.kind === 'model') && full) {
    const asset = item.assetId === undefined ? undefined : assets[item.assetId];
    const box = coverBox(asset?.width ?? 0, asset?.height ?? 0, to.width, to.height);
    transform = { ...box, ...keepRest(item.transform) };
  } else if (full) {
    // 화면을 채우던 것은 계속 채운다(상자 없음).
    const rest = keepRest(item.transform);
    transform = Object.keys(rest).length > 0 ? rest : undefined;
  } else if (item.transform) {
    const t = item.transform;
    const w = t.width ?? from.width;
    const h = t.height ?? from.height;
    const cx = (t.x ?? 0) + w / 2;
    const cy = (t.y ?? 0) + h / 2;
    const nw = w * s;
    const nh = h * s;
    transform = { x: round2(cx * sx - nw / 2), y: round2(cy * sy - nh / 2), width: round2(nw), height: round2(nh), ...keepRest(t) };
  }

  let props = item.props;
  if (props && item.kind !== 'footage' && item.kind !== 'audio' && item.kind !== 'composition') {
    const next: Record<string, unknown> = { ...props };
    for (const key of SCALED_PROPS) {
      const v = next[key];
      if (typeof v === 'number' && Number.isFinite(v)) next[key] = round2(v * s);
    }
    props = next;
  }

  // §5.13 (W) 38-4 — 키프레임의 이동(dx·dy)은 크기와 같은 짧은 변 비율로 옮긴다(배율·투명도·회전은 상대값이라 그대로).
  const keyframes = scaleKeyframes(item.keyframes, s);

  const { transform: _t, props: _p, keyframes: _k, ...rest } = item;
  return { ...rest, ...(transform ? { transform } : {}), ...(props ? { props } : {}), ...(keyframes ? { keyframes } : {}) };
}

/** 파생 문서의 id(`<docId>-<판형>`). 이미 판형 꼬리가 있으면 바꿔 단다(파생의 파생 ❌). */
export function derivedDocId(docId: string, format: VideoFormatId): string {
  const base = docId.replace(/-(landscape|portrait|square)$/, '');
  return `${base}-${format}`.slice(0, 64);
}

export function deriveFormatDoc(doc: VideoDoc, format: VideoFormatId, now: number): VideoDoc {
  const to = { width: VIDEO_FORMATS[format].width, height: VIDEO_FORMATS[format].height };
  const from = doc.size;
  const sourceId = doc.derivedFrom?.docId ?? doc.id;
  return {
    ...doc,
    id: derivedDocId(sourceId, format),
    title: `${doc.title.replace(/\s*\((?:16:9|9:16|1:1)\)$/, '')} (${format === 'landscape' ? '16:9' : format === 'portrait' ? '9:16' : '1:1'})`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    size: to,
    derivedFrom: { docId: sourceId, format },
    tracks: doc.tracks.map((track) => ({ ...track, items: track.items.map((item) => deriveItem(item, from, to, doc.assets)) })),
  };
}
