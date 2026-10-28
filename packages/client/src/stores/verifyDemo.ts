import { create } from 'zustand';
import type { VerificationTarget } from '@vibisual/shared';

// §5.5 #17-35 ⑨⑩ — 시연 녹화의 비영속 런타임 상태(레코드는 서버 SSOT, 영상 Blob 은 `capturePlaytest`). 검증 뷰·녹화 호스트·시연 창이 함께 본다.
// **녹화기를 사이드바가 쥐면 안 된다** — 뷰가 접히면 언마운트 정리가 녹화를 끊어 ⑩ 이 빈다.

/** 이 탭이 찍기로 한 캡처 소스 한 벌. 창 핸들은 재시작마다 바뀌므로 영속하지 않는다. */
export interface VerifyDemoSource {
  sourceId: string;
  sourceName: string;
  sourceKind?: 'window' | 'screen';
}

/**
 * 지금 무엇을 위해 녹화하고 있는가.
 * - `demo` — 사람이 절차를 해 보이는 중(멈추면 시연 창이 뜬다)
 * - `run`  — 검증이 도는 동안의 화면 증거(⑩, 그 run 이 닫히면 저절로 멈춘다)
 */
export interface VerifyRecordingTarget {
  agentId: string;
  subAgentId: string;
  purpose: 'demo' | 'run';
  /** `purpose==='run'` 일 때 그 검증 id — 멈출 때 이 줄에 클립을 붙인다. */
  runId?: string;
}

/** 시연 창이 열려 있을 때 무엇을 보고 있는가. */
export interface VerifyDemoWindowState {
  subAgentId: string;
  agentId: string;
  /** `capturePlaytest` 의 클립 id. */
  clipId: string;
  /** `save` = 절차로 저장, `view` = ⑩ 증거 되돌려 보기. */
  mode: 'save' | 'view';
}

interface VerifyDemoState {
  /** Editable connection per session. Durable copies live on demos and runs on the server. */
  target: Record<string, VerificationTarget | undefined>;
  setTarget: (subAgentId: string, target: VerificationTarget | null) => void;
  /** subAgentId → 고른 캡처 소스. 고른 적이 없으면 undefined(⑩ 스위치를 켤 수 없다). */
  source: Record<string, VerifyDemoSource | undefined>;
  /** 소스 피커가 열려 있는 탭(그리고 무엇을 위해 여는가). null 이면 닫힘. */
  pickerFor: { agentId: string; subAgentId: string; purpose: 'demo' | 'run' | 'connect' } | null;
  /** 지금 녹화 중인 대상. null 이면 아무것도 안 찍는 중(호스트가 이 값만 보고 움직인다). */
  recordingFor: VerifyRecordingTarget | null;
  /** 호스트가 붙인 라이브 스트림 — 사이드바 미리보기가 이걸 `<video>` 에 건다. */
  stream: MediaStream | null;
  /** 스트림을 못 붙였을 때의 사유(조용한 무동작 ❌). */
  streamError: string | null;
  /** 열려 있는 시연 창. null 이면 닫힘(한 번에 하나 — 한 검증은 한 절차다). */
  window: VerifyDemoWindowState | null;
  /** subAgentId → 다음 검증을 녹화할 것인가(⑩). */
  recordRun: Record<string, boolean | undefined>;
  /** subAgentId → 실행 폼에서 고른 시연 id. 없으면 안 싣는다(종전과 같은 프롬프트). */
  pickedDemo: Record<string, string | undefined>;
  /** runId → 그 검증이 도는 동안 찍힌 클립 id(⑩ 증거). 앱을 다시 켜면 사라진다. */
  runClip: Record<string, string | undefined>;

  setSource: (subAgentId: string, source: VerifyDemoSource | null) => void;
  openPicker: (agentId: string, subAgentId: string, purpose: 'demo' | 'run' | 'connect') => void;
  closePicker: () => void;
  startRecording: (target: VerifyRecordingTarget) => void;
  stopRecording: () => void;
  setStream: (stream: MediaStream | null, error: string | null) => void;
  openWindow: (state: VerifyDemoWindowState) => void;
  closeWindow: () => void;
  setRecordRun: (subAgentId: string, on: boolean) => void;
  setPickedDemo: (subAgentId: string, demoId: string | null) => void;
  setRunClip: (runId: string, clipId: string | null) => void;
}

export const useVerifyDemoStore = create<VerifyDemoState>((set, get) => ({
  target: {},
  setTarget: (subAgentId, target): void => {
    const next = { ...get().target };
    if (target) next[subAgentId] = target;
    else delete next[subAgentId];
    set({ target: next });
  },
  source: {},
  pickerFor: null,
  recordingFor: null,
  stream: null,
  streamError: null,
  window: null,
  recordRun: {},
  pickedDemo: {},
  runClip: {},

  setSource: (subAgentId, source): void => {
    const next = { ...get().source };
    if (source === null) {
      delete next[subAgentId];
      // 소스를 놓으면 녹화 스위치도 함께 내린다 — 찍을 대상이 없는데 켜져 있으면 거짓말이다.
      const rec = { ...get().recordRun };
      delete rec[subAgentId];
      set({ source: next, recordRun: rec });
      return;
    }
    next[subAgentId] = source;
    set({ source: next });
  },

  openPicker: (agentId, subAgentId, purpose): void => set({ pickerFor: { agentId, subAgentId, purpose } }),
  closePicker: (): void => set({ pickerFor: null }),

  startRecording: (target): void => set({ recordingFor: target, streamError: null }),
  stopRecording: (): void => set({ recordingFor: null }),
  // 실패 후 스트림 정리가 null 을 보내도 원인을 지우지 않는다. 다음 녹화 시작이 오류를 지운다.
  setStream: (stream, error): void => set({ stream, streamError: error ?? get().streamError }),

  openWindow: (state): void => set({ window: state }),
  closeWindow: (): void => set({ window: null }),

  setRecordRun: (subAgentId, on): void => {
    const next = { ...get().recordRun };
    if (on) next[subAgentId] = true;
    else delete next[subAgentId];
    set({ recordRun: next });
  },

  setPickedDemo: (subAgentId, demoId): void => {
    const next = { ...get().pickedDemo };
    if (demoId === null) delete next[subAgentId];
    else next[subAgentId] = demoId;
    set({ pickedDemo: next });
  },

  setRunClip: (runId, clipId): void => {
    const next = { ...get().runClip };
    if (clipId === null) delete next[runId];
    else next[runId] = clipId;
    set({ runClip: next });
  },
}));

/**
 * §5.5 #17-35 ⑨-1 — 녹화기 키. 시연엔 캡처 버블이 없어 이 접두어로 `useCaptureRecorder`·`capturePlaytest` 의 저장소를 빌려 쓴다 —
 * 버블 id 와 절대 겹치지 않아야 한다(`capture-…` vs `verify:…`).
 */
export function verifyRecorderKey(subAgentId: string): string {
  return `verify:${subAgentId}`;
}
