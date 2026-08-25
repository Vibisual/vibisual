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

/** 메모리 값은 늘 지금 것으로 — 캐시하는 것은 장치 목록이지 남은 양이 아니다. */
function withMemory(devices: LocalDeviceInfo[], measuredAt: number): LocalHardwareInfo {
  const vramFreeBytes = devices.reduce((max, d) => Math.max(max, d.freeBytes), 0);
  return {
    devices,
    vramFreeBytes,
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
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
