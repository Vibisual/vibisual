/**
 * §5.5 #17-38 ⑫ 오프라인 인식기 자식 프로세스의 수명. §5.19 (D) — 엔진은 자식으로 격리한다(메인이 서버 코어라 적재 실패·메모리 부족이 앱을 끌어내리면 안 된다).
 * 오디오는 이 프로세스를 거치지 않는다(16kHz float32 를 IPC 로 부으면 메인 스레드를 먹는다 — §9) — 엔진을 띄워 포트만 알리고 렌더러가 곧장 보낸다.
 * ⚠ 엔진에 바인드 주소 옵션이 없어(2026-09-02 소스 확인 — `--port` 뿐) 같은 랜에서 붙을 수 있다 — 그래서 말하는 동안에만 켜고 조용해지면 내린다.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { VOICE_ASR, voiceModelDiskName } from '@vibisual/shared';
import { logger } from '../logger.js';
import { processGroupSpawnOptions, terminateChildTree } from './processTree.js';
import { findVoiceEngineBin, modelFilesPresent, voiceEngineDir, voiceModelDir } from './voiceAsrService.js';

/** 아무도 말하지 않으면 이만큼 뒤에 자식을 내린다 — 650MB 를 잊은 채 붙들고 있지 않는다. */
const IDLE_SHUTDOWN_MS = 3 * 60_000;

interface RunningEngine {
  child: ChildProcess;
  port: number;
  startedAt: number;
}

let running: RunningEngine | null = null;
let starting: Promise<number> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
/** 지금 이 엔진을 쓰고 있는 받아쓰기 세션들. 비면 유휴 시계가 돈다. */
const holders = new Set<string>();

/** 빈 포트를 OS 에 물어 고른다 — 고정 포트(6006)면 두 벌째 앱이 조용히 실패하고 남이 쥔 포트에 죽는다(§3.7 훅 리스너와 같은 이유). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error('no free port'));
      });
    });
  });
}

/**
 * 포트가 실제로 받기 시작했는가(프로세스가 떴다고 열린 것은 아니다).
 * ⚠ 자식이 죽었으면 바로 그만둔다 — 기다리면 즉사한 판(⑫)에서 20초 뒤 사유 없는 "포트를 안 열었다"만 뜬다.
 */
function waitForPort(port: number, deadline: number, exited: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      if (exited()) {
        reject(new Error('engine exited before opening its port'));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('engine did not open its port in time'));
        return;
      }
      const sock = net.connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

/**
 * mac·linux 동적 링커에 우리 `lib` 을 알린다 — 없으면 `libonnxruntime` 을 못 찾아 즉사한다(Windows 는 실행본 옆 DLL 을 먼저 찾는다).
 * `process.platform` 을 안에서 읽지 않는다(세 OS 를 Windows 에서 시험).
 */
export function engineEnvFor(
  base: NodeJS.ProcessEnv,
  libDirs: readonly string[],
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform === 'win32' || libDirs.length === 0) return base;
  const key = platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const prev = base[key];
  const joined = [...libDirs, ...(prev ? [prev] : [])].join(':');
  return { ...base, [key]: joined };
}

/** 실행본 옆(`bin/`)과 그 형제(`lib/`) — 자산마다 배치가 달라 둘 다 넣는다. */
export function engineLibDirs(binPath: string): string[] {
  const binDir = path.dirname(binPath);
  const parent = path.dirname(binDir);
  const dirs = [binDir, path.join(parent, 'lib')];
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (holders.size === 0) stopVoiceEngine();
  }, IDLE_SHUTDOWN_MS);
}


/**
 * 엔진이 돌고 있으면 그 포트를, 아니면 띄우고 나서 그 포트를 돌려준다.
 * 동시에 여러 창이 불러도 **한 벌만** 뜬다(같은 promise 를 나눠 가진다).
 */
export async function ensureVoiceEngine(): Promise<number> {
  if (running) {
    clearIdleTimer();
    return running.port;
  }
  if (starting) return starting;

  starting = (async (): Promise<number> => {
    const bin = findVoiceEngineBin(voiceEngineDir());
    if (bin === null) throw new Error('voice engine not installed');
    const modelRoot = voiceModelDir();
    if (!modelFilesPresent(modelRoot)) throw new Error('voice model not installed');

    const port = await freePort();
    const args = [
      `--port=${String(port)}`,
      `--tokens=${path.join(modelRoot, voiceModelDiskName('tokens'))}`,
      `--encoder=${path.join(modelRoot, voiceModelDiskName('encoder'))}`,
      `--decoder=${path.join(modelRoot, voiceModelDiskName('decoder'))}`,
      `--joiner=${path.join(modelRoot, voiceModelDiskName('joiner'))}`,
      // 이 옵션을 안 주면 엔진이 **지금 작업 폴더에 `log.txt` 를 만든다** — 그 폴더는 우리가
      // 고른 곳이 아니라 앱이 뜬 자리라(사용자 프로젝트일 수도 있다) 남의 트리를 더럽힌다.
      `--log-file=${path.join(voiceEngineDir(), 'engine-log.txt')}`,
      // 우리는 한 사람이 한 번에 말한다 — 묶음 처리를 크게 잡을 이유가 없고,
      // 짧게 돌수록 중간 글자가 빨리 뜬다.
      '--max-batch-size=1',
      '--loop-interval-ms=10',
      '--num-work-threads=2',
      '--num-io-threads=1',
    ];

    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: engineEnvFor(process.env, engineLibDirs(bin), process.platform),
      ...processGroupSpawnOptions(),
    });

    // 엔진이 죽으면서 남기는 말은 **원인 그 자체**다(모델을 못 읽었다·포트가 물렸다).
    // 버리면 화면에는 "포트를 안 열었다"만 남는다.
    let tail = '';
    const keep = (buf: Buffer): void => {
      tail = (tail + buf.toString()).slice(-2000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);

    let exited = false;
    child.on('exit', (code) => {
      exited = true;
      if (running?.child === child) running = null;
      if (code !== 0 && code !== null) logger.warn(`[voiceAsr] engine exited ${String(code)}: ${tail.slice(-400)}`);
    });

    try {
      await waitForPort(port, Date.now() + VOICE_ASR.ENGINE_START_TIMEOUT_MS, () => exited);
    } catch (err) {
      if (!exited) terminateChildTree(child);
      throw new Error(`${err instanceof Error ? err.message : String(err)} — ${tail.slice(-300)}`);
    }

    running = { child, port, startedAt: Date.now() };
    armIdleTimer();
    return port;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** 받아쓰기 하나가 시작한다 — 유휴 시계를 멈춘다. */
export function holdVoiceEngine(sessionId: string): void {
  holders.add(sessionId);
  clearIdleTimer();
}

/** 받아쓰기 하나가 끝난다 — 마지막 하나가 놓으면 유휴 시계가 돈다. */
export function releaseVoiceEngine(sessionId: string): void {
  holders.delete(sessionId);
  if (holders.size === 0 && running) armIdleTimer();
}

export function stopVoiceEngine(): void {
  clearIdleTimer();
  holders.clear();
  const cur = running;
  running = null;
  if (cur) terminateChildTree(cur.child);
}

export function getVoiceEnginePort(): number | null {
  return running?.port ?? null;
}
