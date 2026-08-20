import { CAPTURE_PLAYTEST } from '@vibisual/shared';

// §5.9 플레이테스트(녹화 + 구간 프레임 첨부) — 순수 계산 한 벌.
//
// 녹화기·창·첨부 훅 셋이 같은 답을 봐야 하므로(구간이 화면에서 보이는 자리와 실제로 뽑히는 프레임이
// 어긋나면 그 즉시 못 믿는 화면이 된다) 계산은 여기 한 곳에만 두고 단위 테스트로 굳힌다.
// `captureSnap`(이어 붙이기 기하)이 같은 이유로 여기 사는 것과 같은 자리다.

/** 구간(밀리초). 클립 안에서 잘라낼 시작·끝. */
export interface ClipRange {
  startMs: number;
  endMs: number;
}

/**
 * 이 환경이 지원하는 첫 번째 녹화 컨테이너를 고른다. 하나도 없으면 `null` —
 * 호출부는 mimeType 을 지정하지 않고 브라우저 기본값으로 녹화한다(막지 않는다).
 *
 * @param isSupported `MediaRecorder.isTypeSupported` (테스트에서 갈아 끼우려고 인자로 받는다)
 */
export function pickRecorderMime(
  isSupported: (mime: string) => boolean,
  candidates: readonly string[] = CAPTURE_PLAYTEST.MIME_CANDIDATES,
): string | null {
  for (const mime of candidates) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      /* 판정 자체가 던지는 환경 — 다음 후보로 */
    }
  }
  return null;
}

/**
 * 손잡이로 잡은 구간을 클립 안으로 접어 넣는다. 밖으로 나가지 않고, 최소 길이보다 좁아지지 않는다
 * (같은 그림 N 장을 붙이는 일 방지). 클립이 최소 길이보다 짧으면 클립 전체를 돌려준다.
 */
export function clampRange(
  range: ClipRange,
  durationMs: number,
  minMs: number = CAPTURE_PLAYTEST.MIN_RANGE_MS,
): ClipRange {
  const total = Math.max(0, durationMs);
  if (total <= minMs) return { startMs: 0, endMs: total };

  let start = Math.min(Math.max(0, range.startMs), total);
  let end = Math.min(Math.max(0, range.endMs), total);
  if (end < start) [start, end] = [end, start];

  if (end - start < minMs) {
    // 좁아진 쪽을 넓힌다 — 뒤로 밀 자리가 없으면 앞으로 당긴다(구간이 클립 밖으로 나가지 않게).
    end = start + minMs;
    if (end > total) {
      end = total;
      start = total - minMs;
    }
  }
  return { startMs: start, endMs: end };
}

/**
 * 구간에서 프레임을 뽑을 시각들. **양 끝이 아니라 등분한 칸의 한가운데**를 찍는다 —
 * 정확히 끝(=클립 길이)으로 seek 하면 마지막 프레임을 못 받는 경우가 있고, 한가운데를 찍으면
 * 장수가 1이어도 자연히 "구간의 대표 한 장"이 된다.
 */
export function frameTimesFor(range: ClipRange, count: number): number[] {
  const n = Math.max(1, Math.min(Math.floor(count), CAPTURE_PLAYTEST.MAX_FRAME_COUNT));
  const start = Math.min(range.startMs, range.endMs);
  const span = Math.abs(range.endMs - range.startMs);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(start + (span * (i + 0.5)) / n);
  return out;
}

/** 새 클립을 목록 앞에 얹고 상한을 넘긴 오래된 클립을 골라낸다(호출부가 Blob URL 을 되돌린다). */
export function applyClipCap<T>(
  clips: readonly T[],
  incoming: T,
  max: number = CAPTURE_PLAYTEST.MAX_CLIPS_PER_BUBBLE,
): { kept: T[]; evicted: T[] } {
  const limit = Math.max(1, max);
  const all = [incoming, ...clips];
  return { kept: all.slice(0, limit), evicted: all.slice(limit) };
}

/** 원본 프레임을 첨부용 크기로 줄인다(가로 상한만 걸고 비율은 유지). 이미 작으면 그대로. */
export function frameTargetSize(
  videoWidth: number,
  videoHeight: number,
  maxWidth: number = CAPTURE_PLAYTEST.FRAME_MAX_WIDTH,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(videoWidth));
  const h = Math.max(1, Math.round(videoHeight));
  if (w <= maxWidth) return { width: w, height: h };
  return { width: maxWidth, height: Math.max(1, Math.round((h * maxWidth) / w)) };
}

/** 파일명에 쓸 수 있게 소스명을 접는다(공백·경로문자 → `_`, 길이 제한). */
function slugSource(sourceName: string): string {
  const slug = (sourceName || 'screen').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (slug || 'screen').slice(0, 40);
}

/** 녹화 클립 저장 파일명. */
export function clipFileName(sourceName: string, at: number, extension = 'webm'): string {
  return `playtest-${slugSource(sourceName)}-${at}.${extension}`;
}

/** 첨부 프레임 파일명 — 몇 번째 장인지와 클립 안 시각(ms)이 이름에 남는다. */
export function frameFileName(sourceName: string, index: number, timeMs: number, at: number): string {
  const ms = Math.max(0, Math.round(timeMs));
  return `playtest-${slugSource(sourceName)}-${at}-${String(index + 1).padStart(2, '0')}-${ms}ms.png`;
}

/** `0:07.3` 꼴 — 구간 손잡이·타임라인 라벨용(분:초.십분의일초). */
export function formatClipTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** `0:07` 꼴 — 클립 길이 배지용(십분의일초는 목록에서 소음이다). */
export function formatClipDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
