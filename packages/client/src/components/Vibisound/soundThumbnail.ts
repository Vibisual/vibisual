import { APP_THUMB, PREVIEW_POLICY, previewTooLarge } from '@vibisual/shared';
import { computePeaks } from '@vibisual/audio';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { THUMB_SKIPPED_TOO_LARGE, type AppThumbnailSkip } from '../../apps/thumbnailSkip.js';
import { fetchWorkspaceMediaBlob, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibisound 노드 화면의 미리보기: 파형 + 길이.
 *
 * 편집 화면과 같은 길로 디코딩하고(`decodeAudioData`) 같은 파형 함수(`computePeaks`)로 접는다. 다른 점은 셋이다.
 * - **소리를 내지 않는 문맥**(`OfflineAudioContext`)이라 출력 장치를 붙잡지 않는다.
 * - **통째로 받기 전에 크기를 묻는다** — 성능 기준(§5.1 #2-1 (G) ① — 압축 소리·PCM 소리의 상한, 그리고 `APP_THUMB.audioMaxBytes`)을
 *   넘으면 파형 없이 아이콘으로 둔다(긴 녹음 하나가 캔버스를 멈추지 않게).
 * - **낮은 표본률로 푼다**(`PREVIEW_POLICY.audioDecodeSampleRate`) — 48칸 파형에는 충분하고, 해독 버퍼가 44.1kHz 의 약 1/15 이다
 *   (종전: 48MB mp3 ≈ 50분 → 해독 버퍼 약 1GB). 그 표본률을 엔진이 받지 않으면 한 단계씩 올린다.
 *
 * 막대 높이는 가장 큰 막대에 맞춘다 — 조용한 녹음도 모양이 보이게. 거의 무음이면 키우지 않는다(잡음을 파형처럼 부풀리지 않게).
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
