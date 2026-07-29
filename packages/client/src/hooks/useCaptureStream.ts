import { useEffect, useRef, useState } from 'react';

// §5.9 화면/프로그램 캡처 버블 — 렌더러 라이브 스트림 훅.
//
// 캡처 소스 id(desktopCapturer 가 준 "screen:0:0" / "window:…")를 받아 getUserMedia 로
// 라이브 MediaStream 을 붙인다. Electron 렌더러 전용 경로 — 표준이 아닌 `mandatory.chromeMediaSource`
// 제약을 쓴다(Electron 공식 desktop capture 방식). 서버·WS 와 무관하며 스트림은 이 renderer 안에서만 산다.
//
// 창 핸들은 재시작마다 바뀌므로, 저장된 sourceId 로 소스를 못 찾으면 getUserMedia 가 실패한다 →
// error 를 반환해 버블이 "소스 없음(다시 선택)" 상태를 그리게 한다.

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

/**
 * getUserMedia desktop 제약. 표준 MediaTrackConstraints 에 없는 `mandatory` 를 담기 위해
 * 별도 타입으로 캐스팅한다(Electron/Chromium 전용).
 */
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
 * @param sourceId desktopCapturer 소스 id. 빈 문자열이면 스트림을 붙이지 않는다(미선택 상태).
 * @param enabled  false 면 스트림을 해제하고 붙이지 않는다(오프스크린 버블 절전용).
 * @param quality  해상도·FPS 상한(데이터 절감). 바뀌면 스트림을 새 제약으로 다시 획득한다.
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
