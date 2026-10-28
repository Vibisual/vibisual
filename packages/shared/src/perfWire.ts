/**
 * §5.13 (Y) 40-12 — 계측 메모리(main·preload → 렌더러), 단위 KB(Electron 그대로). 렌더러 칸은 preload `process.getProcessMemoryInfo()`
 * (`residentSet` 은 Linux·Windows 만)·`getBlinkMemoryInfo()`, 프로세스 칸은 main `app.getAppMetrics()` 종류별 묶음(`privateBytes` 는 Windows 만).
 */
export interface PerfProcessMemoryWire {
  /** 프로세스 종류(`Browser` · `Tab` · `GPU` · `Utility` …). */
  readonly type: string;
  readonly count: number;
  readonly workingSetKB: number;
  readonly privateKB?: number;
}

export interface PerfRendererMemoryWire {
  readonly privateKB?: number;
  readonly residentKB?: number;
  readonly blinkAllocatedKB?: number;
  readonly blinkTotalKB?: number;
}

export interface PerfMemoryWire {
  readonly renderer: PerfRendererMemoryWire | null;
  readonly processes: readonly PerfProcessMemoryWire[];
}

/** `app.getAppMetrics()` 의 한 줄에서 쓰는 칸만. */
export interface AppMetricLike {
  readonly type: string;
  readonly memory: { readonly workingSetSize: number; readonly privateBytes?: number };
}

/** 종류별로 더한다(종류 이름 순). `privateBytes` 가 하나도 없으면 그 칸을 비운다. */
export function summarizeProcessMetrics(metrics: readonly AppMetricLike[]): PerfProcessMemoryWire[] {
  const byType = new Map<string, { count: number; workingSetKB: number; privateKB: number; hasPrivate: boolean }>();
  for (const metric of metrics) {
    const row = byType.get(metric.type) ?? { count: 0, workingSetKB: 0, privateKB: 0, hasPrivate: false };
    row.count += 1;
    row.workingSetKB += Number.isFinite(metric.memory.workingSetSize) ? metric.memory.workingSetSize : 0;
    if (typeof metric.memory.privateBytes === 'number' && Number.isFinite(metric.memory.privateBytes)) {
      row.privateKB += metric.memory.privateBytes;
      row.hasPrivate = true;
    }
    byType.set(metric.type, row);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, row]) => ({ type, count: row.count, workingSetKB: row.workingSetKB, ...(row.hasPrivate ? { privateKB: row.privateKB } : {}) }));
}
