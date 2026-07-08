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
  topScripts: PerfScriptAgg[];
  worstFrames: PerfWorstFrame[];
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
  scripts?: ScriptTimingLike[];
  // longtask attribution 폴백
  attribution?: Array<{ name?: string; containerName?: string; containerType?: string }>;
}

type ContextProvider = () => PerfContext;
type Listener = () => void;

class PerfProfiler {
  private state: PerfState = 'idle';
  private report: PerfReport | null = null;
  private listeners = new Set<Listener>();

  // 수집 버퍼(세션 중에만 채워짐)
  private observer: PerformanceObserver | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private fpsSamples: number[] = [];
  private frames: LongFrameEntryLike[] = [];
  private startedAt = 0;
  private triggerFps = 0;
  private manual = false;
  private startContext: PerfContext | null = null;
  private ctxProvider: ContextProvider | null = null;

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
  }

  private finish(): void {
    const endContext = this.safeContext();
    this.teardown();
    const report = this.buildReport(endContext);
    this.report = report;
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

    for (const f of this.frames) {
      const blocking = f.blockingDuration ?? Math.max(0, f.duration - 50);
      totalBlockingMs += blocking;
      if (f.duration > maxDurationMs) maxDurationMs = f.duration;

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
      topScripts,
      worstFrames,
      context,
    };
    return { ...report, markdown: buildMarkdown(report) };
  }
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
  lines.push('');
  lines.push(`### 컨텍스트`);
  lines.push(`- 뷰: ${c.view} · 노드 ${c.nodes} · 엣지 ${c.edges}(활성 ${c.activeEdges}) · 에이전트 ${c.agents}`);
  lines.push(`- DOM 노드 ${c.domNodes}${c.heapUsedMB != null ? ` · JS heap ${c.heapUsedMB}MB${c.heapLimitMB != null ? `/${c.heapLimitMB}MB` : ''}` : ''}`);
  lines.push('');
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
    lines.push('| duration ms | blocking ms | 주 스크립트 |');
    lines.push('|---:|---:|---|');
    for (const f of r.worstFrames) {
      lines.push(`| ${Math.round(f.durationMs)} | ${Math.round(f.blockingMs)} | ${f.topScript ?? '-'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const perfProfiler = new PerfProfiler();
