import { useCallback } from 'react';
import { create } from 'zustand';
import { CAPTURE_PLAYTEST } from '@vibisual/shared';

import { applyClipCap } from '../components/BubbleMap/playtestClip.js';

// §5.9 플레이테스트 — 녹화 상태와 클립 보관(비영속, 렌더러 메모리).
//
// 영상은 서버·WS·체크포인트를 타지 않는다(§5.9 렌더러 전용 원칙). 그래서 클립은 여기 Blob 으로만
// 살고 앱을 다시 켜면 사라진다 — 몇 분짜리 화면 영상이 체크포인트에 눌러앉으면 §9 용량 규칙이
// 그 자리에서 깨진다. 상한이 곧 안전장치라 **개수 상한(밀려난 클립은 Blob URL 반납)** 을 여기서 건다.
//
// 스토어인 이유는 스트림을 쥔 CaptureNode(녹화기 본체)와 DetailPanel·크게 보기 창·클립 창이
// 같은 상태를 봐야 하기 때문이다(런타임 스토어 `useCaptureRuntime` 과 같은 자리, 같은 이유).

export interface PlaytestClip {
  id: string;
  captureBubbleId: string;
  /** 렌더러 메모리 Blob 의 objectURL — 클립 창의 `<video>` 와 프레임 추출이 함께 쓴다. */
  url: string;
  blob: Blob;
  /**
   * 벽시계로 잰 길이(ms). MediaRecorder 의 webm 은 `duration` 메타가 비어(Infinity) 오는 일이
   * 잦으므로 **이 값이 진실**이고, `<video>` 가 유한한 길이를 알려 주면 그때 갱신한다.
   */
  durationMs: number;
  /** 녹화를 멈춘 시각(파일명·목록 정렬). */
  at: number;
  sourceName: string;
  mimeType: string;
  sizeBytes: number;
  /** 길이 상한(§ CAPTURE_PLAYTEST.MAX_CLIP_SECONDS)에 걸려 스스로 끊긴 클립. 창이 그 사실을 알린다. */
  autoStopped?: boolean;
}

/** 녹화 중인 버블의 진행 상태. 없으면 그 버블은 녹화 중이 아니다. */
export interface PlaytestRecording {
  startedAt: number;
}

interface CapturePlaytestState {
  recording: Record<string, PlaytestRecording | undefined>;
  clips: Record<string, PlaytestClip[]>;
  /** 클립 창이 열려 있는 버블 → 보고 있는 클립 id. */
  openClipId: Record<string, string | undefined>;

  startRecording: (bubbleId: string) => void;
  stopRecording: (bubbleId: string) => void;
  /** 녹화가 끝나 만들어진 클립을 얹는다(상한 초과분은 Blob URL 을 되돌리고 버린다). */
  addClip: (clip: PlaytestClip) => void;
  removeClip: (bubbleId: string, clipId: string) => void;
  /** `<video>` 가 알려 준 실제 길이로 갱신(벽시계 추정보다 정확할 때만). */
  setClipDuration: (bubbleId: string, clipId: string, durationMs: number) => void;
  /** 클립 창 열기/닫기 — `null` 이면 닫는다. */
  openClip: (bubbleId: string, clipId: string | null) => void;
  /** 버블이 사라질 때 그 버블의 클립을 전부 반납한다(메모리 회수). */
  clearBubble: (bubbleId: string) => void;
}

function revoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* 이미 반납됐거나 지원하지 않는 환경 — 표시에 영향 없음 */
  }
}

export const useCapturePlaytestStore = create<CapturePlaytestState>((set, get) => ({
  recording: {},
  clips: {},
  openClipId: {},

  startRecording: (bubbleId): void => {
    set({ recording: { ...get().recording, [bubbleId]: { startedAt: Date.now() } } });
  },

  stopRecording: (bubbleId): void => {
    const next = { ...get().recording };
    delete next[bubbleId];
    set({ recording: next });
  },

  addClip: (clip): void => {
    const prev = get().clips[clip.captureBubbleId] ?? [];
    const { kept, evicted } = applyClipCap(prev, clip, CAPTURE_PLAYTEST.MAX_CLIPS_PER_BUBBLE);
    for (const gone of evicted) revoke(gone.url);
    set({
      clips: { ...get().clips, [clip.captureBubbleId]: kept },
      // 방금 찍은 클립을 바로 보게 연다 — 녹화를 멈춘 사람이 다음에 할 일이 그것이다.
      openClipId: { ...get().openClipId, [clip.captureBubbleId]: clip.id },
    });
  },

  removeClip: (bubbleId, clipId): void => {
    const prev = get().clips[bubbleId] ?? [];
    const target = prev.find((c) => c.id === clipId);
    if (target) revoke(target.url);
    const kept = prev.filter((c) => c.id !== clipId);
    const open = { ...get().openClipId };
    if (open[bubbleId] === clipId) {
      const fallback = kept[0]?.id;
      if (fallback === undefined) delete open[bubbleId];
      else open[bubbleId] = fallback;
    }
    set({ clips: { ...get().clips, [bubbleId]: kept }, openClipId: open });
  },

  setClipDuration: (bubbleId, clipId, durationMs): void => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const prev = get().clips[bubbleId] ?? [];
    let changed = false;
    const next = prev.map((c) => {
      if (c.id !== clipId || Math.abs(c.durationMs - durationMs) < 50) return c;
      changed = true;
      return { ...c, durationMs };
    });
    if (changed) set({ clips: { ...get().clips, [bubbleId]: next } });
  },

  openClip: (bubbleId, clipId): void => {
    const open = { ...get().openClipId };
    if (clipId === null) delete open[bubbleId];
    else open[bubbleId] = clipId;
    set({ openClipId: open });
  },

  clearBubble: (bubbleId): void => {
    for (const clip of get().clips[bubbleId] ?? []) revoke(clip.url);
    const clips = { ...get().clips };
    const open = { ...get().openClipId };
    const recording = { ...get().recording };
    delete clips[bubbleId];
    delete open[bubbleId];
    delete recording[bubbleId];
    set({ clips, openClipId: open, recording });
  },
}));

/** 버블이 사라질 때 그 클립을 반납한다(스토어 밖에서 부르는 자리 — graphStore 삭제 경로). */
export function clearCapturePlaytest(bubbleId: string): void {
  useCapturePlaytestStore.getState().clearBubble(bubbleId);
}

export interface CapturePlaytestView {
  recording: PlaytestRecording | undefined;
  clips: PlaytestClip[];
  openClipId: string | undefined;
}

const EMPTY_CLIPS: PlaytestClip[] = [];

/** 특정 버블의 녹화 상태·클립 목록·열린 클립. 노드·패널·창이 같은 것을 본다. */
export function useCapturePlaytest(bubbleId: string): CapturePlaytestView {
  const recording = useCapturePlaytestStore((s) => s.recording[bubbleId]);
  const clips = useCapturePlaytestStore((s) => s.clips[bubbleId]) ?? EMPTY_CLIPS;
  const openClipId = useCapturePlaytestStore((s) => s.openClipId[bubbleId]);
  return { recording, clips, openClipId };
}

/** 이 버블이 지금 녹화 중인가 — 상태 칩처럼 한 값만 필요한 곳(리렌더 최소화). */
export function useIsPlaytestRecording(bubbleId: string): boolean {
  return useCapturePlaytestStore((s) => s.recording[bubbleId] !== undefined);
}

/** 녹화 시작/중지 토글에 필요한 것만 묶어 준다. */
export function usePlaytestControls(bubbleId: string): {
  start: () => void;
  stop: () => void;
  open: (clipId: string | null) => void;
} {
  const startRecording = useCapturePlaytestStore((s) => s.startRecording);
  const stopRecording = useCapturePlaytestStore((s) => s.stopRecording);
  const openClip = useCapturePlaytestStore((s) => s.openClip);
  const start = useCallback(() => startRecording(bubbleId), [bubbleId, startRecording]);
  const stop = useCallback(() => stopRecording(bubbleId), [bubbleId, stopRecording]);
  const open = useCallback((clipId: string | null) => openClip(bubbleId, clipId), [bubbleId, openClip]);
  return { start, stop, open };
}
