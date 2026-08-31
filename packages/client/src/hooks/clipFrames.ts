import { CAPTURE_PLAYTEST } from '@vibisual/shared';

import { frameTargetSize } from '../components/BubbleMap/playtestClip.js';

// 녹화 클립에서 **프레임 PNG 를 뽑는** 한 벌 — §5.9 플레이테스트 첨부(`useCapturePlaytestAttach`)와
// §5.5 #17-35 ⑨ 시연 저장(`useVerifyDemoSave`)이 **같은 코드**를 쓴다.
//
// 둘로 갈라 두면 한쪽만 고쳐진다: webm `duration=Infinity` 우회나 seek 상한 같은 것은 브라우저
// 사정이라 언젠가 다시 손대게 되는데, 그때 시연 쪽만 낡은 채로 남으면 "왜 여기서만 그림이 비지?"
// 가 된다. 계산(구간 클램프·시각 배분·파일명)은 `playtestClip` 에, **실제로 뽑는 일**은 여기에.

/** 클립에서 프레임을 뽑기 위해 필요한 것만. `PlaytestClip` 전체를 끌고 오지 않는다. */
export interface ClipFrameSource {
  /** 렌더러 메모리 Blob 의 objectURL. */
  url: string;
  /** 벽시계로 잰 길이(ms) — `<video>` 가 길이를 못 알려줄 때의 폴백. */
  durationMs: number;
}

/** 이벤트 하나를 기다린다(상한 있음). 상한을 넘기면 false — 무한 대기 ❌. */
function waitFor(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      el.removeEventListener(event, onEvent);
      clearTimeout(timer);
      resolve(ok);
    };
    const onEvent = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    el.addEventListener(event, onEvent, { once: true });
  });
}

/**
 * MediaRecorder 가 만든 webm 은 `duration` 이 `Infinity` 로 오는 경우가 있어 그대로는 seek 가
 * 어긋난다. 한 번 아주 먼 지점으로 보내면 브라우저가 길이를 확정한다(알려진 우회).
 */
async function ensureSeekable(video: HTMLVideoElement, fallbackMs: number): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  video.currentTime = 1e101;
  await waitFor(video, 'timeupdate', CAPTURE_PLAYTEST.SEEK_TIMEOUT_MS);
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  return fallbackMs;
}

/** 한 프레임을 PNG File 로. seek 가 상한 안에 안 끝나면 null(그 장은 건너뛴다). */
async function grabFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeMs: number,
  fileName: string,
): Promise<File | null> {
  video.currentTime = Math.max(0, timeMs) / 1000;
  const seeked = await waitFor(video, 'seeked', CAPTURE_PLAYTEST.SEEK_TIMEOUT_MS);
  if (!seeked || !video.videoWidth || !video.videoHeight) return null;

  const { width, height } = frameTargetSize(video.videoWidth, video.videoHeight);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new File([blob], fileName, { type: 'image/png' });
}

/**
 * 뽑아 낸 프레임 한 장 — 파일과 **그 파일이 찍힌 시각**이 한 몸이다.
 *
 * 시각을 함께 돌려주는 이유: 실패한 장은 건너뛰므로 결과 배열이 요청한 `times` 보다 짧아질 수 있다.
 * 그때 호출부가 `files[i]` 와 `times[i]` 를 짝지으면 **한 칸씩 밀린 시각**이 붙는다(시연 저장이
 * 실제로 그랬다 — 단계 시각과 그림 시각이 어긋나면 그 둘을 짝지으라는 프롬프트가 거짓이 된다).
 */
export interface ClipFrame {
  file: File;
  /** 이 장을 뽑은 클립 안 시각(ms). */
  timeMs: number;
}

/**
 * 클립에서 주어진 시각들의 프레임을 뽑는다. 오프스크린 `<video>` 한 장을 열어 시각마다 seek →
 * canvas 로 그린다. 실패한 장은 조용히 건너뛰고, 한 장도 못 뽑으면 호출부가 사유를 표시한다.
 *
 * @param nameFor 인덱스·시각으로 파일명을 짓는다(호출부마다 규칙이 다르다).
 */
export async function extractClipFrames(
  clip: ClipFrameSource,
  times: readonly number[],
  nameFor: (index: number, timeMs: number) => string,
  onProgress: (done: number) => void,
): Promise<ClipFrame[]> {
  const video = document.createElement('video');
  video.src = clip.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const canvas = document.createElement('canvas');
  const frames: ClipFrame[] = [];
  try {
    const ready = await waitFor(video, 'loadedmetadata', CAPTURE_PLAYTEST.SEEK_TIMEOUT_MS);
    if (!ready) return frames;
    await ensureSeekable(video, clip.durationMs);
    let index = 0;
    for (const timeMs of times) {
      const file = await grabFrame(video, canvas, timeMs, nameFor(index, timeMs));
      if (file) frames.push({ file, timeMs });
      index += 1;
      onProgress(index);
    }
  } finally {
    video.src = '';
    video.removeAttribute('src');
    video.load();
  }
  return frames;
}
