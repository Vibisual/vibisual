import { APP_THUMB, PREVIEW_POLICY, previewTooLarge } from '@vibisual/shared';
import { computePeaks } from '@vibisual/audio';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { THUMB_SKIPPED_TOO_LARGE, type AppThumbnailSkip } from '../../apps/thumbnailSkip.js';
import { fetchWorkspaceMediaBlob, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibisound 노드 미리보기(파형 + 길이). 편집 화면과 같은 `decodeAudioData` + `computePeaks` 로, 다른 점 셋:
 * `OfflineAudioContext`(출력 장치 ❌) · 받기 전에 크기를 묻고 상한(§5.1 #2-1 (G) ①, `APP_THUMB.audioMaxBytes`)을 넘으면 아이콘
 * · 낮은 표본률(`PREVIEW_POLICY.audioDecodeSampleRate` — 44.1kHz 버퍼의 약 1/15. 48MB mp3 ≈ 50분이면 44.1kHz 로 약 1GB). 엔진이 거절하면 한 단계씩 올린다.
 * 막대는 최대 막대에 맞추되 거의 무음이면 키우지 않는다(잡음을 부풀리지 않게).
 */
const SILENCE = 0.02;
/** 받는 표본률이 엔진마다 달라 낮은 것부터 시도한다. */
const DECODE_RATES: readonly number[] = [PREVIEW_POLICY.audioDecodeSampleRate, 8_000, 22_050, 44_100];

function offlineContext(): OfflineAudioContext | null {
  for (const rate of DECODE_RATES) {
    try {
      return new OfflineAudioContext(1, 1, rate);
    } catch {
      /* 이 표본률은 받지 않는다 — 다음 */
    }
  }
  return null;
}

export async function renderSoundThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | AppThumbnailSkip | null> {
  const bytes = typeof req.bytes === 'number' ? req.bytes : await workspaceMediaSize(req.projectId, req.file);
  if (bytes === null || bytes <= 0) return null;
  // 기준보다 커서 일부러 굽지 않는다 — 이유를 함께 돌려준다(파일 버블의 "미리보기 생략" 툴팁).
  if (bytes > APP_THUMB.audioMaxBytes || previewTooLarge(req.file, bytes)) return THUMB_SKIPPED_TOO_LARGE;
  const blob = await fetchWorkspaceMediaBlob(req.projectId, req.file);
  if (!blob) return null;
  const ctx = offlineContext();
  if (!ctx) return null;
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const columns = APP_THUMB.peakColumns;
  const raw = computePeaks({ sampleRate: buffer.sampleRate, channels }, columns);
  const amps: number[] = [];
  let top = 0;
  for (let c = 0; c < columns; c += 1) {
    const v = Math.max(Math.abs(raw[c * 2] ?? 0), Math.abs(raw[c * 2 + 1] ?? 0));
    amps.push(v);
    if (v > top) top = v;
  }
  const gain = top > SILENCE ? 1 / top : 1;
  return {
    kind: 'wave',
    peaks: amps.map((v) => Math.min(1, v * gain)),
    ...(buffer.duration > 0 ? { durationSec: buffer.duration } : {}),
  };
}
