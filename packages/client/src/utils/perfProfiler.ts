// perfProfiler — DebugPanel FPS 저하 자동 프로파일러 (SCENARIO §7.7 DebugPanel 확장).
//
// 목적: 캔버스/IDE 가 40 FPS 아래로 떨어질 때 "왜 느려지는지" 를 사람이 복붙해 분석할 수 있는
// 리포트로 남긴다. 상시 프로파일링은 하지 않는다 — 평상시 비용 0, **트리거된 순간에만** 1분간
// PerformanceObserver 를 붙였다 뗀다(사용자 성능 우려 반영).
//
// 주 수집원: LoAF(Long Animation Frames) — Chromium 123+/Electron 31 지원. longtask 와 달리
// 프레임을 늘린 **스크립트(sourceURL·functionName·duration)** attribution 을 준다("어느 함수가
// 프레임을 잡았나"). 미지원 환경은 longtask 로 폴백(스크립트 attribution 없음, blocking 시간만).
//
// React <Profiler> 는 쓰지 않는다 — 프로덕션 react-dom 은 onRender 를 호출하지 않고, 쓰려면
// 상시 오버헤드가 붙는 profiling 빌드가 필요하다. LoAF 가 함수 단위까지 더 정확히 잡는다.

/** 40 FPS 아래로 떨어질 때 자동 진입하는 임계 FPS. */
export const PERF_TRIGGER_FPS = 40;
/**
 * v3.72 — 입력 지연(Event Timing) 자동 트리거 임계(ms).
 *
 * FPS 만으로는 "타자가 밀린다" 를 **구조적으로 못 잡는다**. rAF FPS 는 합성기의 프레임 간격이라
 * 키 입력 → 화면 반영 지연과 별개다: 키 하나가 150ms 걸려도 rAF 는 계속 75fps 로 돈다.
 * 그래서 사용자가 "버벅인다" 고 느끼는 순간에 수집해도 리포트는 "FPS 정상 / 긴 프레임 없음" 이 된다.
 * 입력 지연은 Event Timing API 로 직접 재야 한다(이 상수 이상 걸린 인터랙션이 트리거).
 */
export const PERF_SLOW_INTERACTION_MS = 200;
/** 세션 중 수집할 인터랙션 하한(ms). Event Timing 스펙 최소값이 16. */
const INTERACTION_THRESHOLD_MS = 16;
/** 한 세션 수집 길이(ms). */
export const PERF_SESSION_MS = 60_000;
/** 자동 트리거 쿨다운(ms) — 한 번 수집하면 이 시간 내엔 재수집하지 않는다. */
export const PERF_COOLDOWN_MS = 60 * 60 * 1000; // 1시간
/** 마지막 자동 수집 시각을 담는 localStorage 키(쿨다운 영속 — 재시작/패널 재오픈에도 유지). */
const LAST_RUN_KEY = 'vibisual:perf:lastAutoRun';
/** 리포트에 싣는 상위 스크립트/프레임 개수. */
const TOP_N = 12;

export interface PerfScriptAgg {
  /** sourceURL + functionName 그룹 키 */
  key: string;
  sourceURL: string;
  functionName: string;
  /** 이 스크립트가 프레임을 잡은 총 시간(ms) */
  totalMs: number;
  /** 등장 프레임 수 */
  count: number;
}

export interface PerfWorstFrame {
  startTime: number;
  durationMs: number;
  blockingMs: number;
  /** 이 프레임에서 가장 오래 잡은 스크립트 요약 */
  topScript?: string;
  /** v3.72 LoAF 단계 분해(ms) — 스크립트가 안 잡힌 긴 프레임의 "그럼 어디서 갔나" 를 답한다. */
  phases?: PerfFramePhases;
}

/**
 * v3.72 — LoAF 프레임 1개의 단계 분해(ms).
 *
 * 종전엔 duration/blocking/scripts 만 남겨서, 스크립트가 안 잡힌 긴 프레임은 리포트에 원인칸이
 * 전부 `-` 로 찍혔다(정확히 사용자가 받은 그 리포트). LoAF 는 `renderStart`·`styleAndLayoutStart`·
 * `desiredRenderStart` 를 함께 주므로 프레임을 아래 4구간으로 쪼갤 수 있다 — 스크립트가 0 이어도
 * 스타일/레이아웃인지, 페인트인지, 애초에 프레임 시작이 밀린 건지(queue wait)가 드러난다.
 */
export interface PerfFramePhases {
  /** desiredRenderStart → startTime: 프레임 시작 자체가 밀린 시간(합성기/메인 큐 대기). */
  waitMs: number;
  /** startTime → renderStart: 이 프레임에서 돈 작업(태스크·이벤트 핸들러·타이머). */
  workMs: number;
  /** renderStart → styleAndLayoutStart: rAF 콜백/ResizeObserver 등 렌더 단계 스크립트. */
  renderMs: number;
  /** styleAndLayoutStart → 프레임 끝: 스타일 재계산 + 레이아웃 + 페인트/합성 커밋. */
  styleLayoutMs: number;
}

/**
 * v3.72 — 인터랙션(Event Timing) 1건. "타자 칠 때 버벅인다" 를 직접 재는 유일한 지표.
 *
 * 3구간으로 쪼갠다:
 *   inputDelayMs   startTime → processingStart : 메인스레드가 이벤트를 집기까지 밀린 시간
 *   processingMs   processingStart → processingEnd : 핸들러(= React setState·렌더 커밋)
 *   presentationMs processingEnd → 프레임 표시 : 스타일/레이아웃/페인트
 * 어디가 큰지에 따라 처방이 완전히 갈린다(핸들러=상태/렌더 구조, 표시=DOM 규모/CSS 효과).
 */
export interface PerfInteraction {
  /** 이벤트 종류(keydown/input/compositionupdate/pointerdown …). */
  name: string;
  /** 총 지연(ms) — Event Timing 스펙상 8ms 단위로 반올림된다. */
  durationMs: number;
  inputDelayMs: number;
  processingMs: number;
  presentationMs: number;
  /** 이벤트를 받은 요소 요약(예: `textarea[data-ide-input]`). 대상 식별용. */
  target?: string;
}

/** 이벤트 종류별 인터랙션 집계. */
export interface PerfInteractionAgg {
  name: string;
  count: number;
  worstMs: number;
  avgMs: number;
  /** 세 구간의 평균 점유(ms) — 병목 구간을 한눈에. */
  avgInputDelayMs: number;
  avgProcessingMs: number;
  avgPresentationMs: number;
}

export interface PerfContext {
  nodes: number;
  edges: number;
  agents: number;
  activeEdges: number;
  domNodes: number;
  heapUsedMB?: number;
  heapLimitMB?: number;
  /** 'canvas' | 'ide' | 'iframe' */
  view: string;
}

export interface PerfReport {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** 트리거 순간의 FPS(수동 수집이면 그 시점 FPS) */
  triggerFps: number;
  /** 수동 [지금 수집] 인지 자동(40 FPS 하락) 인지 */
  manual: boolean;
  frames: {
    samples: number;
    minFps: number;
    avgFps: number;
    /** fps < PERF_TRIGGER_FPS 였던 초 수 */
    jankSeconds: number;
  };
  loafSupported: boolean;
  /** 관찰한 엔트리 타입 */
  observedType: 'long-animation-frame' | 'longtask' | 'none';
  longFrames: {
    count: number;
    totalBlockingMs: number;
    maxDurationMs: number;
  };
  /** v3.72 — 긴 프레임 전체의 단계별 합(ms). 스크립트 attribution 이 비어도 병목 구간은 나온다. */
  framePhaseTotals: PerfFramePhases;
  topScripts: PerfScriptAgg[];
  worstFrames: PerfWorstFrame[];
  /**
   * v3.72 — 입력 지연 요약. `supported=false` 면 Event Timing 미지원 환경.
   * `inp` = 인터랙션별 최대 지연들의 98퍼센타일(웹 표준 INP 와 같은 계산). 200ms 초과면 체감 렉.
   */
  interactions: {
    supported: boolean;
    /** 관측된 인터랙션 수(같은 interactionId 는 1건으로 합침). */
    count: number;
    inpMs: number;
    worstMs: number;
    byType: PerfInteractionAgg[];
    worst: PerfInteraction[];
  };
  context: PerfContext;
  /** 복붙용 마크다운 리포트 */
  markdown: string;
}

export type PerfState = 'idle' | 'profiling';

// --- 최소 LoAF/longtask 타입(TS lib 에 아직 없을 수 있어 자체 정의) ---
interface ScriptTimingLike {
  name?: string;
  sourceURL?: string;
  /** LoAF PerformanceScriptTiming 의 함수명 필드 */
  sourceFunctionName?: string;
  invoker?: string;
  invokerType?: string;
  duration: number;
}
interface LongFrameEntryLike {
  entryType: string;
  startTime: number;
  duration: number;
  blockingDuration?: number;
  /** LoAF 단계 타임스탬프 — 스크립트가 안 잡힌 프레임의 원인 구간을 가른다. */
  renderStart?: number;
  styleAndLayoutStart?: number;
  desiredRenderStart?: number;
  scripts?: ScriptTimingLike[];
  // longtask attribution 폴백
  attribution?: Array<{ name?: string; containerName?: string; containerType?: string }>;
}

/** PerformanceEventTiming 최소 형태(TS lib 에 target 이 없어 자체 정의). */
interface EventTimingLike {
  name: string;
  startTime: number;
  duration: number;
  processingStart: number;
  processingEnd: number;
  interactionId?: number;
  /**
   * 스펙상 Element 지만 실제로는 `document`·텍스트 노드처럼 **tagName·hasAttribute 가 없는 대상**이
   * 실려 오기도 한다(그대로 Element 로 믿었다가 리포트 생성이 통째로 터진 원인). 런타임 판별을
   * 강제하려고 `unknown` 으로 받는다 — 해석은 describeTarget 이 한다.
   */
  target?: unknown;
}

type ContextProvider = () => PerfContext;
type Listener = () => void;

class PerfProfiler {
  private state: PerfState = 'idle';
  private report: PerfReport | null = null;
  private listeners = new Set<Listener>();

  // 수집 버퍼(세션 중에만 채워짐)
  private observer: PerformanceObserver | null = null;
  private eventObserver: PerformanceObserver | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private fpsSamples: number[] = [];
  private frames: LongFrameEntryLike[] = [];
  private events: EventTimingLike[] = [];
  private startedAt = 0;
  private triggerFps = 0;
  private manual = false;
  private startContext: PerfContext | null = null;
  private ctxProvider: ContextProvider | null = null;

  // v3.72 — 상시 감시(sentinel). DebugPanel 이 열려 있는 동안에만 무장한다(닫히면 비용 0 유지).
  //   느린 인터랙션 1건이면 즉시 세션을 연다 — 사용자가 "지금이다" 하고 60초를 맞춰 누를 필요가 없다.
  private sentinel: PerformanceObserver | null = null;
  private sentinelCtx: ContextProvider | null = null;
  private lastFps = 0;
  /** 감시 중 관측된 마지막 느린 인터랙션(ms) — 패널 실시간 표시용. */
  private lastSlowInteractionMs = 0;

  getState(): PerfState {
    return this.state;
  }
  getReport(): PerfReport | null {
    return this.report;
  }
  /** 현재 세션 경과(ms) — profiling 중일 때만 의미. */
  elapsedMs(): number {
    return this.state === 'profiling' ? Date.now() - this.startedAt : 0;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** 매초 FPS 샘플 공급(DebugPanel useRenderFps 에서 호출). profiling 중이 아니면 버림. */
  recordFps(fps: number): void {
    if (fps > 0) this.lastFps = fps;
    if (this.state !== 'profiling') return;
    this.fpsSamples.push(fps);
  }

  /**
   * 자동 트리거 판정: idle 이고, fps 가 0 초과 임계 미만이며, 쿨다운이 지났으면 세션 시작.
   * DebugPanel 이 매초(fps 갱신 시) 호출.
   */
  maybeTrigger(fps: number, ctxProvider: ContextProvider): void {
    if (this.state !== 'idle') return;
    if (!(fps > 0 && fps < PERF_TRIGGER_FPS)) return;
    if (!this.cooldownPassed()) return;
    this.start(fps, false, ctxProvider);
  }

  /** 감시 중 마지막으로 관측된 느린 인터랙션(ms). 0 = 아직 없음. 표시 전용. */
  getLastSlowInteractionMs(): number {
    return this.lastSlowInteractionMs;
  }

  /**
   * v3.72 — 느린 인터랙션 감시 무장(DebugPanel mount 시). 임계 초과 인터랙션이 관측되면
   * 쿨다운을 지켜 자동으로 수집 세션을 연다. 브라우저가 어차피 INP 용으로 재고 있는 값을 받아만
   * 보므로(durationThreshold 로 느린 것만 통지) 상시 비용은 사실상 0 이다.
   */
  armSentinel(ctxProvider: ContextProvider): void {
    this.sentinelCtx = ctxProvider;
    if (this.sentinel) return;
    try {
      this.sentinel = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as EventTimingLike[]) {
          if (e.duration < PERF_SLOW_INTERACTION_MS) continue;
          this.lastSlowInteractionMs = Math.round(e.duration);
          this.emit();
          if (this.state !== 'idle') continue;
          if (!this.cooldownPassed()) continue;
          const ctx = this.sentinelCtx;
          if (ctx) this.start(this.lastFps, false, ctx);
        }
      });
      this.sentinel.observe({
        type: 'event',
        buffered: false,
        durationThreshold: PERF_SLOW_INTERACTION_MS,
      } as PerformanceObserverInit);
    } catch {
      this.sentinel = null; // Event Timing 미지원 — FPS 트리거만 남는다.
    }
  }

  /** 감시 해제(DebugPanel unmount 시) — 평상시 비용 0 원칙 유지. */
  disarmSentinel(): void {
    if (this.sentinel) {
      try {
        this.sentinel.disconnect();
      } catch {
        /* ignore */
      }
      this.sentinel = null;
    }
    this.sentinelCtx = null;
  }

  /** 사용자 [지금 수집] — 쿨다운 무시하고 즉시 세션 시작. 현재 FPS 를 트리거값으로 기록. */
  forceStart(fps: number, ctxProvider: ContextProvider): void {
    if (this.state !== 'idle') return;
    this.start(fps, true, ctxProvider);
  }

  private cooldownPassed(): boolean {
    try {
      const raw = window.localStorage.getItem(LAST_RUN_KEY);
      if (!raw) return true;
      const last = Number(raw);
      if (!Number.isFinite(last)) return true;
      return Date.now() - last >= PERF_COOLDOWN_MS;
    } catch {
      return true;
    }
  }
  /** 다음 자동 수집까지 남은 ms(쿨다운). 0 이면 지금 가능. */
  cooldownRemainingMs(): number {
    try {
      const raw = window.localStorage.getItem(LAST_RUN_KEY);
      if (!raw) return 0;
      const last = Number(raw);
      if (!Number.isFinite(last)) return 0;
      return Math.max(0, PERF_COOLDOWN_MS - (Date.now() - last));
    } catch {
      return 0;
    }
  }

  private start(fps: number, manual: boolean, ctxProvider: ContextProvider): void {
    this.state = 'profiling';
    this.startedAt = Date.now();
    this.triggerFps = fps;
    this.manual = manual;
    this.ctxProvider = ctxProvider;
    this.fpsSamples = [];
    this.frames = [];
    this.events = [];
    try {
      this.startContext = ctxProvider();
    } catch {
      this.startContext = null;
    }

    const type = this.pickObservedType();
    if (type !== 'none') {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as LongFrameEntryLike[]) {
            // longtask/LoAF 공통: 프레임/태스크 하나를 버퍼에 적재.
            this.frames.push(e);
          }
        });
        this.observer.observe({ type, buffered: false } as PerformanceObserverInit);
      } catch {
        this.observer = null;
      }
    }
    this.observedType = type;

    // v3.72 — 입력 지연 수집. LoAF 와 별개 관측원이다: 프레임이 길지 않아도(FPS 정상이어도)
    //   키 입력이 밀리는 경우가 있고, 그게 바로 "타자 칠 때 버벅인다" 의 정체다.
    try {
      this.eventObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as EventTimingLike[]) {
          this.events.push(e);
        }
      });
      this.eventObserver.observe({
        type: 'event',
        buffered: false,
        durationThreshold: INTERACTION_THRESHOLD_MS,
      } as PerformanceObserverInit);
    } catch {
      this.eventObserver = null;
    }

    this.sessionTimer = setTimeout(() => this.finish(), PERF_SESSION_MS);
    this.emit();
  }

  private observedType: PerfReport['observedType'] = 'none';

  private pickObservedType(): PerfReport['observedType'] {
    try {
      const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
        .supportedEntryTypes;
      if (supported?.includes('long-animation-frame')) return 'long-animation-frame';
      if (supported?.includes('longtask')) return 'longtask';
    } catch {
      /* ignore */
    }
    return 'none';
  }

  /** 세션 조기 중단(사용자가 패널 닫는 등) — 리포트는 만들지 않고 버린다. */
  cancel(): void {
    if (this.state !== 'profiling') return;
    this.teardown();
    this.state = 'idle';
    this.emit();
  }

  private teardown(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch {
        /* ignore */
      }
      this.observer = null;
    }
    if (this.eventObserver) {
      try {
        this.eventObserver.disconnect();
      } catch {
        /* ignore */
      }
      this.eventObserver = null;
    }
  }

  private finish(): void {
    const endContext = this.safeContext();
    this.teardown();
    try {
      this.report = this.buildReport(endContext);
    } catch (err) {
      // 리포트 생성이 실패해도 세션은 반드시 닫는다. 여기서 예외가 새어 나가면 state 가
      // 'profiling' 에 묶여 이후 수집(자동·[지금 수집])이 영구히 막힌다 — 실제로 발생한 사고다.
      // 직전 리포트는 지우지 않는다(실패했다고 이전 수집 결과까지 잃을 이유가 없다).
      console.error('[perfProfiler] 성능 리포트 생성 실패', err);
    }
    this.state = 'idle';
    try {
      window.localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    this.emit();
  }

  private safeContext(): PerfContext | null {
    try {
      return this.ctxProvider ? this.ctxProvider() : null;
    } catch {
      return null;
    }
  }

  private buildReport(endContext: PerfContext | null): PerfReport {
    const endedAt = Date.now();
    const samples = this.fpsSamples;
    const minFps = samples.length ? Math.min(...samples) : 0;
    const avgFps = samples.length
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : 0;
    const jankSeconds = samples.filter((f) => f > 0 && f < PERF_TRIGGER_FPS).length;

    // LoAF/longtask 집계
    let totalBlockingMs = 0;
    let maxDurationMs = 0;
    const scriptAgg = new Map<string, PerfScriptAgg>();
    const worst: PerfWorstFrame[] = [];

    const phaseTotals: PerfFramePhases = { waitMs: 0, workMs: 0, renderMs: 0, styleLayoutMs: 0 };

    for (const f of this.frames) {
      const blocking = f.blockingDuration ?? Math.max(0, f.duration - 50);
      totalBlockingMs += blocking;
      if (f.duration > maxDurationMs) maxDurationMs = f.duration;

      const phases = framePhases(f);
      if (phases) {
        phaseTotals.waitMs += phases.waitMs;
        phaseTotals.workMs += phases.workMs;
        phaseTotals.renderMs += phases.renderMs;
        phaseTotals.styleLayoutMs += phases.styleLayoutMs;
      }

      let frameTopScript: string | undefined;
      let frameTopMs = 0;
      if (f.scripts && f.scripts.length) {
        for (const s of f.scripts) {
          const sourceURL = shortenUrl(s.sourceURL ?? s.invoker ?? s.name ?? '(unknown)');
          const functionName = s.sourceFunctionName ?? s.invoker ?? '(anonymous)';
          const key = `${sourceURL} · ${functionName}`;
          const prev = scriptAgg.get(key);
          if (prev) {
            prev.totalMs += s.duration;
            prev.count += 1;
          } else {
            scriptAgg.set(key, { key, sourceURL, functionName, totalMs: s.duration, count: 1 });
          }
          if (s.duration > frameTopMs) {
            frameTopMs = s.duration;
            frameTopScript = `${functionName} (${Math.round(s.duration)}ms) — ${sourceURL}`;
          }
        }
      } else if (f.attribution && f.attribution.length) {
        // longtask 폴백 — 스크립트 단위 없음, 컨테이너만.
        const a = f.attribution[0];
        const name = a?.containerName ?? a?.name ?? a?.containerType ?? 'self';
        frameTopScript = `${name} (longtask, ${Math.round(f.duration)}ms)`;
      }

      worst.push({
        startTime: f.startTime,
        durationMs: f.duration,
        blockingMs: blocking,
        topScript: frameTopScript,
        phases,
      });
    }

    const topScripts = [...scriptAgg.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, TOP_N);
    const worstFrames = worst.sort((a, b) => b.durationMs - a.durationMs).slice(0, TOP_N);
    const context = endContext ?? this.startContext ?? emptyContext();

    const report: Omit<PerfReport, 'markdown'> = {
      startedAt: this.startedAt,
      endedAt,
      durationMs: endedAt - this.startedAt,
      triggerFps: this.triggerFps,
      manual: this.manual,
      frames: { samples: samples.length, minFps, avgFps, jankSeconds },
      loafSupported: this.observedType === 'long-animation-frame',
      observedType: this.observedType,
      longFrames: { count: this.frames.length, totalBlockingMs: Math.round(totalBlockingMs), maxDurationMs: Math.round(maxDurationMs) },
      framePhaseTotals: {
        waitMs: Math.round(phaseTotals.waitMs),
        workMs: Math.round(phaseTotals.workMs),
        renderMs: Math.round(phaseTotals.renderMs),
        styleLayoutMs: Math.round(phaseTotals.styleLayoutMs),
      },
      topScripts,
      worstFrames,
      interactions: this.buildInteractions(),
      context,
    };
    return { ...report, markdown: buildMarkdown(report) };
  }

  /**
   * v3.72 — Event Timing 집계. INP 는 웹 표준과 같은 방식으로 계산한다:
   * 같은 `interactionId` 의 이벤트들(keydown/input/keyup 한 묶음)은 **가장 긴 것 1건**으로 접고,
   * 그 값들의 98퍼센타일을 취한다. interactionId 가 0 인 이벤트(스크롤 등 비인터랙션)는 제외.
   */
  private buildInteractions(): PerfReport['interactions'] {
    const supported = this.eventObserver !== null || this.events.length > 0;
    const detail: PerfInteraction[] = this.events.map((e) => toInteraction(e));

    // interactionId 별 최대 지연 → INP 퍼센타일 모수.
    const byId = new Map<number, number>();
    for (const e of this.events) {
      const id = e.interactionId ?? 0;
      if (id === 0) continue;
      byId.set(id, Math.max(byId.get(id) ?? 0, e.duration));
    }
    const perInteraction = [...byId.values()].sort((a, b) => a - b);
    const inpMs = perInteraction.length
      ? Math.round(perInteraction[Math.min(perInteraction.length - 1, Math.floor(perInteraction.length * 0.98))] ?? 0)
      : 0;
    const worstMs = detail.reduce((m, d) => Math.max(m, d.durationMs), 0);

    // 이벤트 종류별 집계 — 어느 입력이, 어느 구간에서 밀리는지.
    const agg = new Map<string, { count: number; worst: number; total: number; delay: number; proc: number; pres: number }>();
    for (const d of detail) {
      const cur = agg.get(d.name) ?? { count: 0, worst: 0, total: 0, delay: 0, proc: 0, pres: 0 };
      cur.count += 1;
      cur.worst = Math.max(cur.worst, d.durationMs);
      cur.total += d.durationMs;
      cur.delay += d.inputDelayMs;
      cur.proc += d.processingMs;
      cur.pres += d.presentationMs;
      agg.set(d.name, cur);
    }
    const byType: PerfInteractionAgg[] = [...agg.entries()]
      .map(([name, v]) => ({
        name,
        count: v.count,
        worstMs: Math.round(v.worst),
        avgMs: Math.round(v.total / v.count),
        avgInputDelayMs: Math.round(v.delay / v.count),
        avgProcessingMs: Math.round(v.proc / v.count),
        avgPresentationMs: Math.round(v.pres / v.count),
      }))
      .sort((a, b) => b.worstMs - a.worstMs)
      .slice(0, TOP_N);

    return {
      supported,
      count: byId.size,
      inpMs,
      worstMs: Math.round(worstMs),
      byType,
      worst: detail.sort((a, b) => b.durationMs - a.durationMs).slice(0, TOP_N),
    };
  }
}

/** LoAF 단계 타임스탬프 → 4구간 분해. 필드가 없으면(폴백 longtask 등) undefined. */
function framePhases(f: LongFrameEntryLike): PerfFramePhases | undefined {
  if (typeof f.renderStart !== 'number' || f.renderStart <= 0) return undefined;
  const end = f.startTime + f.duration;
  const styleStart = typeof f.styleAndLayoutStart === 'number' && f.styleAndLayoutStart > 0
    ? f.styleAndLayoutStart
    : f.renderStart;
  const desired = typeof f.desiredRenderStart === 'number' && f.desiredRenderStart > 0
    ? f.desiredRenderStart
    : f.startTime;
  const clamp = (n: number): number => (n > 0 ? n : 0);
  return {
    waitMs: clamp(f.startTime - desired),
    workMs: clamp(f.renderStart - f.startTime),
    renderMs: clamp(styleStart - f.renderStart),
    styleLayoutMs: clamp(end - styleStart),
  };
}

/** PerformanceEventTiming → 3구간 분해 + 대상 요약. */
function toInteraction(e: EventTimingLike): PerfInteraction {
  const clamp = (n: number): number => (n > 0 ? Math.round(n) : 0);
  return {
    name: e.name,
    durationMs: Math.round(e.duration),
    inputDelayMs: clamp(e.processingStart - e.startTime),
    processingMs: clamp(e.processingEnd - e.processingStart),
    presentationMs: clamp(e.startTime + e.duration - e.processingEnd),
    target: describeTarget(e.target),
  };
}

/** 진단에 결정적이라 셀렉터에 살려 두는 data 속성(있으면 첫 번째 것으로 표기). */
const TARGET_ATTRS = ['data-ide-input', 'data-slash-active', 'data-testid'] as const;

/**
 * 이벤트 대상 요소를 사람이 읽을 짧은 셀렉터로. IDE 입력창(`data-ide-input`)처럼 진단에 결정적인
 * data 속성은 살려 둔다 — "IDE 입력창에서 밀린다" 를 리포트만 보고 판정할 수 있어야 한다.
 *
 * 대상은 **Element 라고 믿을 수 없다**: Event Timing 은 `document`·텍스트 노드처럼 `tagName` 도
 * `hasAttribute` 도 없는 값을 준다. 종전엔 `el.tagName.toLowerCase()` 를 바로 불러 TypeError 로
 * 리포트 생성 전체가 죽었으므로(수집 60초가 통째로 버려짐), 여기서는 필드마다 런타임 판별한다.
 */
export function describeTarget(target: unknown): string | undefined {
  if (!target || typeof target !== 'object') return undefined;
  const node = target as Partial<Element> & { nodeName?: unknown };
  const rawTag =
    typeof node.tagName === 'string'
      ? node.tagName
      : typeof node.nodeName === 'string'
        ? node.nodeName // document → '#document', 텍스트 노드 → '#text'
        : '';
  const tag = rawTag ? rawTag.toLowerCase() : '(unknown)';
  if (typeof node.hasAttribute === 'function') {
    for (const attr of TARGET_ATTRS) {
      if (node.hasAttribute(attr)) return `${tag}[${attr}]`;
    }
  }
  const cls = typeof node.getAttribute === 'function' ? node.getAttribute('class') : null;
  if (cls) {
    const first = cls.split(/\s+/)[0];
    if (first) return `${tag}.${first}`;
  }
  return tag;
}

function emptyContext(): PerfContext {
  return { nodes: 0, edges: 0, agents: 0, activeEdges: 0, domNodes: 0, view: 'unknown' };
}

/** file:///.../assets/index-xxxx.js → index-xxxx.js 처럼 파일명 위주로 줄인다. */
function shortenUrl(url: string): string {
  if (!url) return '(unknown)';
  const noQuery = url.split('?')[0] ?? url;
  const parts = noQuery.split(/[\\/]/);
  const tail = parts[parts.length - 1] || noQuery;
  return tail.length > 48 ? `…${tail.slice(-48)}` : tail;
}

function buildMarkdown(r: Omit<PerfReport, 'markdown'>): string {
  const iso = (ts: number): string => new Date(ts).toISOString();
  const c = r.context;
  const lines: string[] = [];
  lines.push(`## Vibisual 성능 프로파일 (${r.manual ? '수동' : '자동'})`);
  lines.push('');
  lines.push(`- 수집: ${iso(r.startedAt)} ~ ${iso(r.endedAt)} (${Math.round(r.durationMs / 1000)}s)`);
  lines.push(`- 트리거 FPS: ${r.triggerFps} (임계 ${PERF_TRIGGER_FPS})`);
  lines.push(`- FPS: min ${r.frames.minFps} / avg ${r.frames.avgFps} / 버벅인 초 ${r.frames.jankSeconds}/${r.frames.samples}`);
  lines.push(`- 관찰 소스: ${r.observedType}${r.loafSupported ? ' (LoAF)' : ''}`);
  lines.push(`- 긴 프레임: ${r.longFrames.count}개 / 총 blocking ${r.longFrames.totalBlockingMs}ms / 최장 ${r.longFrames.maxDurationMs}ms`);
  const it = r.interactions;
  lines.push(
    `- 입력 지연(INP): ${it.supported ? `${it.inpMs}ms · 최악 ${it.worstMs}ms · 인터랙션 ${it.count}건` : '미지원(Event Timing 없음)'}`,
  );
  lines.push('');
  lines.push(`### 판정`);
  lines.push(verdict(r));
  lines.push('');
  lines.push(`### 컨텍스트`);
  lines.push(`- 뷰: ${c.view} · 노드 ${c.nodes} · 엣지 ${c.edges}(활성 ${c.activeEdges}) · 에이전트 ${c.agents}`);
  lines.push(`- DOM 노드 ${c.domNodes}${c.heapUsedMB != null ? ` · JS heap ${c.heapUsedMB}MB${c.heapLimitMB != null ? `/${c.heapLimitMB}MB` : ''}` : ''}`);
  lines.push('');
  if (it.supported && it.byType.length) {
    lines.push(`### 입력 지연 — 이벤트 종류별 (구간 평균)`);
    lines.push('| 이벤트 | 건수 | 최악ms | 평균ms | 입력대기 | 핸들러 | 표시 |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const a of it.byType) {
      lines.push(
        `| ${a.name} | ${a.count} | ${a.worstMs} | ${a.avgMs} | ${a.avgInputDelayMs} | ${a.avgProcessingMs} | ${a.avgPresentationMs} |`,
      );
    }
    lines.push('');
  }
  if (it.supported && it.worst.length) {
    lines.push(`### 가장 느린 인터랙션 top ${it.worst.length}`);
    lines.push('| 총ms | 입력대기 | 핸들러 | 표시 | 이벤트 | 대상 |');
    lines.push('|---:|---:|---:|---:|---|---|');
    for (const d of it.worst) {
      lines.push(
        `| ${d.durationMs} | ${d.inputDelayMs} | ${d.processingMs} | ${d.presentationMs} | ${d.name} | ${d.target ?? '-'} |`,
      );
    }
    lines.push('');
  }
  const ph = r.framePhaseTotals;
  const phSum = ph.waitMs + ph.workMs + ph.renderMs + ph.styleLayoutMs;
  if (phSum > 0) {
    lines.push(`### 긴 프레임 시간이 간 곳 (LoAF 단계 합)`);
    lines.push('| 구간 | 총ms | 뜻 |');
    lines.push('|---|---:|---|');
    lines.push(`| 프레임 시작 대기 | ${ph.waitMs} | 렌더가 시작되기까지 밀린 시간 |`);
    lines.push(`| 작업(스크립트/이벤트) | ${ph.workMs} | 태스크·핸들러·타이머 |`);
    lines.push(`| 렌더 콜백 | ${ph.renderMs} | rAF·ResizeObserver 등 |`);
    lines.push(`| 스타일·레이아웃·페인트 | ${ph.styleLayoutMs} | DOM 규모/CSS 효과 비용 |`);
    lines.push('');
  }
  if (r.topScripts.length) {
    lines.push(`### 프레임을 오래 잡은 스크립트 top ${r.topScripts.length}`);
    lines.push('| 총ms | 횟수 | 함수 | 파일 |');
    lines.push('|---:|---:|---|---|');
    for (const s of r.topScripts) {
      lines.push(`| ${Math.round(s.totalMs)} | ${s.count} | ${s.functionName} | ${s.sourceURL} |`);
    }
    lines.push('');
  } else {
    lines.push(`### 스크립트 attribution 없음 (${r.observedType === 'longtask' ? 'longtask 폴백 — 함수 단위 미지원' : '긴 프레임 미포착'})`);
    lines.push('');
  }
  if (r.worstFrames.length) {
    lines.push(`### 가장 긴 프레임 top ${r.worstFrames.length}`);
    lines.push('| duration ms | blocking ms | 대기 | 작업 | 렌더 | 스타일·레이아웃 | 주 스크립트 |');
    lines.push('|---:|---:|---:|---:|---:|---:|---|');
    for (const f of r.worstFrames) {
      const p = f.phases;
      lines.push(
        `| ${Math.round(f.durationMs)} | ${Math.round(f.blockingMs)} | ${p ? Math.round(p.waitMs) : '-'} | ${p ? Math.round(p.workMs) : '-'} | ${p ? Math.round(p.renderMs) : '-'} | ${p ? Math.round(p.styleLayoutMs) : '-'} | ${f.topScript ?? '-'} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 리포트 첫머리에 붙는 한 줄 판정. 종전 리포트의 가장 큰 문제는 "숫자는 많은데 그래서 뭐가
 * 문제인지" 가 없었다는 것 — 특히 **아무 문제도 안 잡힌 수집**(정상인 순간을 60초 잰 경우)이
 * 정상이라고 말해주지 않아, 읽는 쪽이 원인을 찾아 헤매게 된다. 그 경우를 명시적으로 말한다.
 */
function verdict(r: Omit<PerfReport, 'markdown'>): string {
  const it = r.interactions;
  const jank = r.frames.jankSeconds > 0;
  const slowInput = it.supported && it.inpMs >= PERF_SLOW_INTERACTION_MS;

  if (!jank && !slowInput && r.longFrames.count === 0) {
    return '**이 수집 구간에선 문제가 재현되지 않았습니다.** FPS 저하도, 느린 입력도 없었습니다 — 느려지는 화면/조작을 하는 도중에 다시 수집하십시오.';
  }
  if (slowInput) {
    const worst = it.byType[0];
    const where = worst
      ? worst.avgProcessingMs >= worst.avgPresentationMs && worst.avgProcessingMs >= worst.avgInputDelayMs
        ? '**핸들러(JS·React 렌더)** 구간이 가장 큽니다 — 상태 갱신 범위/리렌더 구조가 원인일 가능성이 큽니다.'
        : worst.avgPresentationMs >= worst.avgInputDelayMs
          ? '**표시(스타일·레이아웃·페인트)** 구간이 가장 큽니다 — DOM 규모나 CSS 효과(blur/그림자/애니메이션) 비용이 원인일 가능성이 큽니다.'
          : '**입력 대기** 구간이 가장 큽니다 — 다른 작업이 메인스레드를 잡고 있어 이벤트가 늦게 처리됩니다.'
      : '';
    return `**입력이 느립니다 (INP ${it.inpMs}ms, 최악 ${it.worstMs}ms).** ${where}`;
  }
  if (jank) {
    return `**프레임이 떨어졌습니다 (${r.frames.jankSeconds}/${r.frames.samples}초, min ${r.frames.minFps} FPS).** 아래 단계 합에서 시간이 간 구간을 보십시오.`;
  }
  return `**체감 문제 수준은 아닙니다.** 긴 프레임 ${r.longFrames.count}개가 있었지만 FPS 저하(0초)도 느린 입력도 없었습니다.`;
}

export const perfProfiler = new PerfProfiler();
