/**
 * localHardwareService.ts — §5.19 (E) 이 PC 가 감당할 수 있는 크기.
 *
 * **하드웨어를 알아맞히지 않는다 — 엔진에게 묻는다.** 모델을 실제로 돌릴 주체가
 * `llama-server --list-devices` 로 자기가 쓸 수 있는 장치와 남은 메모리를 그대로 말해 준다.
 * 벤더별 분기도, 새 네이티브 의존성도, VRAM 을 추측하는 산수도 필요 없고, **엔진이 못 쓰는
 * 장치는 애초에 안 나오므로** "화면엔 보이는데 못 쓰는" 어긋남이 생기지 않는다.
 *
 * 이 값은 **표시와 권유**에만 쓴다. 실행을 막는 데 쓰지 않는다 — 레이어 오프로드는 여전히
 * 엔진 자동이고, 안 되면 CPU 로 떨어져 느리게라도 도는 것이 §5.19 (D) 의 약속이다.
 *
 * **CPU·시스템 메모리는 엔진에게 묻지 않는다** — 엔진이 깔려 있든 아니든 이 PC 의 사실이라
 * `node:os` 에서 바로 읽는다. §5.19 (F) "자원은 한 벌뿐"을 사용자가 눈으로 확인하는 자리
 * (사용량 팝업의 올모델 탭)가 이 값을 먹는다 — 구독 한도가 없는 엔진에서 "이 턴이 무엇을
 * 쓰고 있나"에 답하는 것은 토큰이 아니라 이 PC 의 자원이기 때문이다.
 */
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { LocalDeviceInfo, LocalHardwareInfo } from '@vibisual/shared';
import { logger } from '../logger.js';
import { getEngineState } from './localEngineService.js';

/** 장치 목록은 자주 바뀌지 않는다 — 매 조회마다 프로세스를 띄우지 않는다. */
const CACHE_TTL_MS = 60_000;
/** 장치 나열이 이보다 오래 걸리면 그 답은 필요 없다(화면이 기다리게 두지 않는다). */
const PROBE_TIMEOUT_MS = 15_000;
const MIB = 1024 * 1024;

let cached: LocalHardwareInfo | null = null;
let cachedAt = 0;
/** 동시에 여러 화면이 물어도 프로세스는 한 번만 띄운다. */
let inflight: Promise<LocalHardwareInfo> | null = null;

/**
 * CPU 점유율의 최소 측정 창(코어 하나 기준 경과 ms). 스냅샷은 자주 돌아서 창이 너무 짧으면
 * 표본 잡음이 그대로 게이지에 실린다 — 창이 안 찼으면 답을 새로 내지 않고 기준점도 그대로 둔다.
 */
export const CPU_MIN_WINDOW_MS = 200;

/** CPU 누적 시간 표본. 점유율은 값 하나로는 안 나오고 **두 시점의 차이**로만 나온다. */
export interface CpuSample {
  idle: number;
  total: number;
}

/** 직전 표본과 그때 낸 답 — 다음 호출이 이것과 견준다. */
let lastCpuSample: CpuSample | null = null;
let lastCpuPercent = -1;

/**
 * `Vulkan0: NVIDIA GeForce RTX 4090 (24138 MiB, 23370 MiB free)` 한 줄을 읽는다.
 * 형식이 바뀌면 조용히 못 읽은 것으로 둔다 — 파싱 실패가 기능을 죽이면 안 된다.
 */
export function parseDeviceLine(line: string): LocalDeviceInfo | null {
  const m = /^\s*(\S+?):\s*(.+?)\s*\(\s*(\d+)\s*MiB\s*,\s*(\d+)\s*MiB\s+free\s*\)\s*$/.exec(line);
  if (!m) return null;
  const total = Number(m[3]);
  const free = Number(m[4]);
  if (!Number.isFinite(total) || !Number.isFinite(free)) return null;
  return { name: `${m[1] ?? ''}: ${m[2] ?? ''}`, totalBytes: total * MIB, freeBytes: free * MIB };
}

/** 출력 전체에서 장치 줄만 추린다(`(none)` 이면 빈 배열 — 가속 장치가 없다는 뜻). */
export function parseDevices(output: string): LocalDeviceInfo[] {
  const out: LocalDeviceInfo[] = [];
  for (const line of output.split('\n')) {
    const device = parseDeviceLine(line);
    if (device) out.push(device);
  }
  return out;
}

/**
 * 두 누적 표본 사이의 CPU 점유율(0~100). **모르면 -1 을 준다** — 답이 없을 때 0 을 주면
 * 화면이 "CPU 가 놀고 있다"는 거짓을 말한다(§5.19 (E) 와 같은 규율).
 *
 * -1 이 되는 경우는 셋이다: ① 표본이 하나뿐(첫 호출), ② 카운터가 되감겼다(절전 복귀·코어 수
 * 변동), ③ 아직 측정 창이 안 찼다.
 *
 * 순수 함수로 둔 이유는 이 산수가 **세 OS 에서 똑같기** 때문이다 — `os.cpus()` 가 주는 값은
 * 개발 PC 에서 재현할 수 없지만, 여기서 틀리면 win/mac/linux 가 한꺼번에 틀린다.
 */
export function computeCpuPercent(
  prev: CpuSample | null,
  next: CpuSample,
  cores: number,
  minWindowMs: number = CPU_MIN_WINDOW_MS,
): number {
  if (!prev || cores <= 0) return -1;
  const totalDelta = next.total - prev.total;
  const idleDelta = next.idle - prev.idle;
  if (totalDelta <= 0 || idleDelta < 0) return -1; // 되감김 — 지어내지 않는다
  if (totalDelta / cores < minWindowMs) return -1; // 창이 안 찼다
  const busy = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.min(100, Math.max(0, Math.round(busy * 10) / 10));
}

/**
 * 지금 이 순간의 CPU 누적 시간. 일부 리눅스·컨테이너는 코어 목록을 **빈 배열**로 주므로
 * 그때는 null 을 준다 — 없는 값을 0 으로 꾸미면 화면이 "0코어"라고 말하게 된다.
 */
function readCpuSample(): { sample: CpuSample; model: string; cores: number } | null {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return null;
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { sample: { idle, total }, model: (cpus[0]?.model ?? '').trim(), cores: cpus.length };
}

/**
 * 표본을 하나 더 떠서 직전 것과 견준다 — 답하는 것은 "마지막으로 물어본 뒤로 CPU 가 얼마나
 * 바빴나"이고, 그래서 **부르는 주기가 곧 측정 창**이다.
 *
 * 창이 안 차서 답을 못 내면 **기준점을 옮기지 않고** 직전 답을 그대로 준다(다음 호출이 더 긴
 * 창으로 다시 잰다). 게이지가 실제치와 0 사이를 깜빡이면 읽을 수 없기 때문이다.
 */
function sampleCpuNow(): { model: string; cores: number; percent: number } {
  const read = readCpuSample();
  if (!read) return { model: '', cores: 0, percent: -1 };
  const rewound =
    lastCpuSample !== null &&
    (read.sample.total < lastCpuSample.total || read.sample.idle < lastCpuSample.idle);
  const percent = computeCpuPercent(lastCpuSample, read.sample, read.cores);
  if (percent >= 0) {
    lastCpuPercent = percent;
    lastCpuSample = read.sample; // 답을 낸 표본만 새 기준점이 된다
  } else if (!lastCpuSample || rewound) {
    lastCpuSample = read.sample; // 첫 표본이거나 되감겼다 — 기준점을 다시 세운다
    lastCpuPercent = -1; // 되감긴 뒤에도 옛 답을 보여 주면 그것이 거짓이다
  }
  return { model: read.model, cores: read.cores, percent: lastCpuPercent };
}

function runListDevices(bin: string): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string): void => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    const child = spawn(bin, ['--list-devices'], {
      cwd: path.dirname(bin),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      buf += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 이미 죽었으면 그만 */
      }
      finish(buf);
    }, PROBE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      finish('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(buf);
    });
  });
}

/**
 * 메모리·CPU 값은 늘 지금 것으로 — 캐시하는 것은 장치 목록이지 남은 양이 아니다.
 *
 * macOS 의 `os.freemem()` 은 회수 가능한 inactive 메모리를 여유로 치지 않아 활동 모니터보다
 * 적게 나온다. 표시 전용이라 그대로 두되, 그 숫자를 판정에 쓰지 않는 이유가 이것이다.
 */
function withMemory(devices: LocalDeviceInfo[], measuredAt: number): LocalHardwareInfo {
  const vramFreeBytes = devices.reduce((max, d) => Math.max(max, d.freeBytes), 0);
  const cpu = sampleCpuNow();
  return {
    devices,
    vramFreeBytes,
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    cpuModel: cpu.model,
    cpuCores: cpu.cores,
    cpuUsagePercent: cpu.percent,
    measuredAt,
  };
}

/**
 * §5.19 (E) — 이 PC 의 실측치. 엔진이 없으면 `measuredAt = 0` 으로 "아직 모름"을 말한다.
 * **모르면 모른다고 한다** — 넘겨짚어 "돌아갑니다"라고 하는 것이 가장 나쁘다.
 */
export async function getLocalHardware(): Promise<LocalHardwareInfo> {
  const engine = getEngineState();
  if (!engine.installed || !engine.serverBin) return withMemory([], 0);

  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return withMemory(cached.devices, cached.measuredAt);
  if (inflight) return inflight;

  const bin = engine.serverBin;
  inflight = (async (): Promise<LocalHardwareInfo> => {
    try {
      const devices = parseDevices(await runListDevices(bin));
      const info = withMemory(devices, Date.now());
      cached = info;
      cachedAt = Date.now();
      logger.info(
        `[localHardware] devices=${String(devices.length)}${devices.length > 0 ? ` (${devices.map((d) => d.name).join(', ')})` : ' — CPU only'}`,
      );
      return info;
    } catch (err) {
      logger.warn('[localHardware] device probe failed', err);
      return withMemory([], 0);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 스냅샷처럼 **기다릴 수 없는 자리**에서 쓰는 동기 조회. 재 둔 값이 있으면 그것을 주고,
 * 없거나 낡았으면 뒤에서 재도록 시켜 둔 뒤 지금 아는 만큼만 답한다(프로세스 스폰이
 * 스냅샷 경로를 붙잡으면 캔버스 전체가 그만큼 늦어진다 — §5.19 스냅샷은 자주 돈다).
 */
export function peekLocalHardware(): LocalHardwareInfo {
  const engine = getEngineState();
  if (!engine.installed || !engine.serverBin) return withMemory([], 0);
  if (!cached || Date.now() - cachedAt >= CACHE_TTL_MS) {
    void getLocalHardware().catch(() => undefined); // 다음 스냅샷부터 채워진다
  }
  return cached ? withMemory(cached.devices, cached.measuredAt) : withMemory([], 0);
}

/** 엔진을 새로 깔았거나 지웠으면 다시 재야 한다. */
export function invalidateLocalHardware(): void {
  cached = null;
  cachedAt = 0;
}
