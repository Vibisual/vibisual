import { captionFormatOf, captionImportOps, looksLikeCaptionJson, parseCaptionText, parseSrt, type CaptionCue, type VideoDoc, type VideoDocOp } from '@vibisual/video';

/**
 * §5.13 (W) 38-6 — 자막 파서·자막 아이템 연산의 정본은 순수 층(`@vibisual/video` `captions.ts`)이다 — 에이전트의
 * `POST /doc/:id/captions/import` 와 화면의 가져오기가 같은 함수를 쓴다(두 벌 ❌). 여기는 옛 이름을 잇는 얇은 자리다.
 */
export { parseSrt };

export function buildCaptionOps(doc: VideoDoc, cues: readonly CaptionCue[], label: string): VideoDocOp[] {
  return captionImportOps(doc, cues, label);
}

/**
 * 끌어 놓거나 고른 파일이 자막이면 그 연산을, 아니면 null. SRT·VTT 는 언제나 자막이고(깨졌으면 이유와 함께 던진다 — 조용히 잃지
 * 않게), JSON 은 낱말 시각 모양일 때만 자막이다(아니면 재료 — 데이터 이야기 레시피의 CSV·JSON).
 */
export async function captionOpsFromFile(doc: VideoDoc, file: File): Promise<VideoDocOp[] | null> {
  const format = captionFormatOf(file.name);
  if (!format) return null;
  const text = await file.text();
  if (format === 'json') {
    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch { return null; }
    if (!looksLikeCaptionJson(parsed)) return null;
  }
  return buildCaptionOps(doc, parseCaptionText(file.name, text).cues, file.name);
}
