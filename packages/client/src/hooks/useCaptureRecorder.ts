import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_PLAYTEST } from '@vibisual/shared';

import { pickRecorderMime } from '../components/BubbleMap/playtestClip.js';
import { useCapturePlaytestStore } from '../stores/capturePlaytest.js';

// §5.9 플레이테스트 — 라이브 캡처 스트림을 클립으로 담는 녹화기.
//
// 담는 대상은 **이미 붙어 있는 그 MediaStream**(useCaptureStream 이 준 것) 하나다. 두 번째
// getUserMedia 도, 새 캡처 레이어도 만들지 않는다 — 화면에 보이는 그 화면이 그대로 녹화된다.
// 결과 Blob 은 렌더러 메모리에만 살고(서버·WS ❌) `capturePlaytest` 스토어가 상한을 걸어 보관한다.

export interface UseCaptureRecorderOptions {
  captureBubbleId: string;
  /** 파일명·클립 목록에 남는 소스명. */
  sourceName: string;
  /** 지금 붙어 있는 라이브 스트림. null 이면 녹화를 시작할 수 없다. */
  stream: MediaStream | null;
}

export interface CaptureRecorder {
  /** 이 환경에서 녹화가 가능한가(MediaRecorder 지원 + 스트림 있음). */
  available: boolean;
  recording: boolean;
  /** 녹화 경과(ms) — 헤더·패널의 시간 표시용(0.25초마다 갱신). */
  elapsedMs: number;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** 실패 사유 한 줄(조용한 무동작 ❌). */
  error: string | null;
  clearError: () => void;
}

function makeClipId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `clip-${crypto.randomUUID()}`
    : `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCaptureRecorder({
  captureBubbleId,
  sourceName,
  stream,
}: UseCaptureRecorderOptions): CaptureRecorder {
  const recording = useCapturePlaytestStore((s) => s.recording[captureBubbleId] !== undefined);
  const startRecording = useCapturePlaytestStore((s) => s.startRecording);
  const stopRecording = useCapturePlaytestStore((s) => s.stopRecording);
  const addClip = useCapturePlaytestStore((s) => s.addClip);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const autoStopRef = useRef(false);
  const sourceNameRef = useRef(sourceName);
  sourceNameRef.current = sourceName;

  const supported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
  const available = supported && stream !== null;

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) {
      stopRecording(captureBubbleId);
      return;
    }
    if (rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* 이미 멈춘 녹화기 — onstop 이 마무리한다 */
      }
    }
  }, [captureBubbleId, stopRecording]);

  const start = useCallback(() => {
    if (recorderRef.current) return;
    if (!supported) {
      setError('unsupported');
      return;
    }
    if (!stream) {
      setError('noStream');
      return;
    }
    setError(null);
    const mime = pickRecorderMime((m) => window.MediaRecorder.isTypeSupported(m));
    let rec: MediaRecorder;
    try {
      rec = new window.MediaRecorder(stream, mime === null ? undefined : { mimeType: mime });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'recorder failed');
      return;
    }

    chunksRef.current = [];
    autoStopRef.current = false;
    startedAtRef.current = Date.now();
    recorderRef.current = rec;

    rec.ondataavailable = (e: BlobEvent): void => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = (): void => {
      setError('recorderError');
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {
        /* onstop 이 마무리한다 */
      }
    };
    rec.onstop = (): void => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      recorderRef.current = null;
      const wasAuto = autoStopRef.current;
      autoStopRef.current = false;
      stopRecording(captureBubbleId);
      setElapsedMs(0);
      if (chunks.length === 0) {
        setError('emptyClip');
        return;
      }
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      const at = Date.now();
      addClip({
        id: makeClipId(),
        captureBubbleId,
        url: URL.createObjectURL(blob),
        blob,
        // webm 은 duration 메타가 비어 오는 일이 잦다 — 벽시계로 잰 값이 진실이다(창이 실제 길이를
        // 알게 되면 setClipDuration 으로 갱신한다).
        durationMs: Math.max(1, at - startedAtRef.current),
        at,
        sourceName: sourceNameRef.current,
        mimeType: type,
        sizeBytes: blob.size,
        ...(wasAuto ? { autoStopped: true } : {}),
      });
    };

    try {
      rec.start(CAPTURE_PLAYTEST.TIMESLICE_MS);
    } catch (e) {
      recorderRef.current = null;
      setError(e instanceof Error ? e.message : 'recorder failed');
      return;
    }
    startRecording(captureBubbleId);
    setElapsedMs(0);
  }, [addClip, captureBubbleId, startRecording, stopRecording, stream, supported]);

  const toggle = useCallback(() => {
    if (recorderRef.current) stop();
    else start();
  }, [start, stop]);

  // 경과 시간 + 길이 상한 자동 정지. 누르고 잊어도 메모리가 무한히 자라지 않게 스스로 끊는다.
  useEffect(() => {
    if (!recording) return;
    const limitMs = CAPTURE_PLAYTEST.MAX_CLIP_SECONDS * 1000;
    const iv = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= limitMs && recorderRef.current) {
        autoStopRef.current = true;
        stop();
      }
    }, 250);
    return () => clearInterval(iv);
  }, [recording, stop]);

  // 스트림이 바뀌거나(화질 프리셋 변경 등으로 재획득) 사라지면 지금까지 담은 것을 클립으로 마감한다.
  // 끊긴 스트림에 녹화기를 매달아 두면 그 뒤 구간이 통째로 비고 사용자는 그 사실을 모른다.
  const streamRef = useRef(stream);
  useEffect(() => {
    if (streamRef.current !== stream && recorderRef.current) stop();
    streamRef.current = stream;
  }, [stream, stop]);

  // 언마운트 — 녹화기를 남기지 않는다(마감된 클립은 스토어에 남는다).
  useEffect(() => () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* 마감 실패는 표시에 영향 없음 */
      }
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { available, recording, elapsedMs, start, stop, toggle, error, clearError };
}
