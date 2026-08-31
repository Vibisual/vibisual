import { create } from 'zustand';

// §5.5 #17-35 ⑨⑩ — 시연 녹화의 **런타임 상태**(비영속, 렌더러 메모리).
//
// 시연 레코드 자체는 서버가 SSOT 라 `graphStore` 에 있고, 영상 Blob 은 §5.9 규약대로
// `capturePlaytest` 에 산다 — 이 파일은 그 둘을 잇는 얇은 층이다.
//
// 스토어인 이유는 **세 자리가 같은 상태를 봐야** 하기 때문이다:
//   · 검증 뷰(사이드바)      — 누르고, 미리보기를 보고, 목록을 그린다
//   · 녹화 호스트(IDE 루트)  — 실제 스트림·녹화기를 쥔다
//   · 시연 창(캔버스 자리)   — 되돌려 보고 절차로 저장한다
// 특히 녹화기를 **사이드바가 쥐면 안 된다** — 활동바에서 다른 항목을 눌러 뷰가 접히는 순간
// 언마운트 정리가 녹화를 끊어, ⑩(검증이 도는 동안의 화면)이 통째로 빈다.

/** 이 탭이 찍기로 한 캡처 소스 한 벌. 창 핸들은 재시작마다 바뀌므로 영속하지 않는다. */
export interface VerifyDemoSource {
  sourceId: string;
  sourceName: string;
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
  /** subAgentId → 고른 캡처 소스. 고른 적이 없으면 undefined(⑩ 스위치를 켤 수 없다). */
  source: Record<string, VerifyDemoSource | undefined>;
  /** 소스 피커가 열려 있는 탭(그리고 무엇을 위해 여는가). null 이면 닫힘. */
  pickerFor: { agentId: string; subAgentId: string; purpose: 'demo' | 'run' } | null;
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
  openPicker: (agentId: string, subAgentId: string, purpose: 'demo' | 'run') => void;
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
  setStream: (stream, error): void => set({ stream, streamError: error }),

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
 * §5.5 #17-35 ⑨-1 — 녹화기 키.
 *
 * `useCaptureRecorder`·`capturePlaytest` 는 캡처 버블 id 로 키를 매기지만, 시연에는 **버블이 없다**
 * (사용자 지시 — 캡처 버블을 만들지 않는다). 그 스토어들이 문자열 키 `Record` 라 이 접두어 하나로
 * 같은 저장소를 그대로 빌려 쓴다. 버블 id 와 절대 겹치지 않는 모양이어야 한다(`capture-…` vs `verify:…`).
 */
export function verifyRecorderKey(subAgentId: string): string {
  return `verify:${subAgentId}`;
}
