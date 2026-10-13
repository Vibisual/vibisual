import { APP_THUMB } from '@vibisual/shared';
import { computePeaks } from '@vibisual/audio';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { fetchWorkspaceMediaBlob, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibisound 노드 화면의 미리보기: 파형 + 길이.
 *
 * 편집 화면과 같은 길로 디코딩하고(`decodeAudioData`) 같은 파형 함수(`computePeaks`)로 접는다. 다른 점은 둘이다.
 * - **소리를 내지 않는 문맥**(`OfflineAudioContext`)이라 출력 장치를 붙잡지 않는다.
 * - **통째로 받기 전에 크기를 묻는다** — `APP_THUMB.audioMaxBytes` 를 넘으면 파형 없이 아이콘으로 둔다(긴 녹음 하나가
 *   캔버스를 멈추지 않게).
 *
 * 막대 높이는 가장 큰 막대에 맞춘다 — 조용한 녹음도 모양이 보이게. 거의 무음이면 키우지 않는다(잡음을 파형처럼 부풀리지 않게).
 */
const SILENCE = 0.02;

export async function renderSoundThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const bytes = await workspaceMediaSize(req.projectId, req.file);
  if (bytes === null || bytes <= 0 || bytes > APP_THUMB.audioMaxBytes) return null;
  const blob = await fetchWorkspaceMediaBlob(req.projectId, req.file);
  if (!blob) return null;
  let buffer: AudioBuffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await blob.arrayBuffer());
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
