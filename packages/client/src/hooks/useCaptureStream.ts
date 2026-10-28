import { useEffect, useRef, useState } from 'react';

// §5.9 캡처 버블 — desktopCapturer 소스 id 로 getUserMedia 라이브 스트림을 붙인다(Electron 전용 비표준 `mandatory.chromeMediaSource`, 이 렌더러 안에서만 산다).
// 창 핸들은 재시작마다 바뀌어 저장된 sourceId 를 못 찾으면 error → 버블이 "소스 없음(다시 선택)".

interface UseCaptureStreamResult {
  stream: MediaStream | null;
  error: string | null;
  /** 최초 획득 이전(로딩 중) — 스피너용. */
  loading: boolean;
}

/** 캡처 화질/데이터 상한 — 해상도·프레임레이트를 낮춰 CPU/대역폭을 절감(외부·모바일 접속 최적화). */
export interface CaptureQuality {
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
}

/** 화질 기본값(원본급) — quality 미지정 시 사용. */
const DEFAULT_QUALITY: CaptureQuality = { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 };

/** getUserMedia desktop 제약 — 표준 타입에 없는 `mandatory` 를 담는다(Electron/Chromium 전용). */
interface DesktopCaptureConstraints {
  audio: false;
  video: {
    mandatory: {
      chromeMediaSource: 'desktop';
      chromeMediaSourceId: string;
      maxWidth?: number;
      maxHeight?: number;
      maxFrameRate?: number;
    };
  };
}

/**
 * @param sourceId 빈 문자열이면 붙이지 않는다(미선택).
 * @param enabled false 면 스트림을 놓는다(오프스크린 버블 절전).
 * @param quality 해상도·FPS 상한 — 바뀌면 새 제약으로 다시 얻는다.
 */
export function useCaptureStream(
  sourceId: string | undefined,
  enabled = true,
  quality?: CaptureQuality,
): UseCaptureStreamResult {
  const q = quality ?? DEFAULT_QUALITY;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stop = (): void => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
    };

    if (!sourceId || !enabled) {
      stop();
      setStream(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const constraints: DesktopCaptureConstraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: q.maxWidth,
          maxHeight: q.maxHeight,
          maxFrameRate: q.maxFrameRate,
        },
      },
    };

    navigator.mediaDevices
      .getUserMedia(constraints as unknown as MediaStreamConstraints)
      .then((s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stop();
        streamRef.current = s;
        setStream(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStream(null);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [sourceId, enabled, q.maxWidth, q.maxHeight, q.maxFrameRate]);

  return { stream, error, loading };
}
