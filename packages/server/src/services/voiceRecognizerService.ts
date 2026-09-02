/**
 * voiceRecognizerService.ts — §5.5 #17-38 ⑫ 오프라인 인식기 **자식 프로세스의 수명**.
 *
 * §5.19 (D) 가 세운 규율 그대로다 — **엔진은 자식 프로세스로 격리한다.** 메인 프로세스가 곧
 * 서버 코어라(§3.7), 650MB 모델 적재 실패나 메모리 부족이 앱 전체를 끌고 내려가면 안 된다.
 *
 * **오디오는 이 프로세스를 지나가지 않는다.** 16kHz float32 는 초당 64KB 인데, 그것을 IPC 로
 * 메인 스레드에 부으면 §9 가 몇 장에 걸쳐 지켜 온 그 스레드를 우리가 다시 먹는 꼴이 된다.
 * 그래서 이 서비스가 하는 일은 **엔진을 띄우고 포트를 알려 주는 것까지**이고, 표본은 화면
 * (렌더러)이 그 포트로 곧장 보낸다.
 *
 * ⚠ **포트는 열려 있는 동안이 곧 노출면이다.** 엔진에는 바인드 주소 옵션이 없어(2026-09-02
 * 소스 확인 — `--port` 하나뿐) 같은 랜의 다른 기계가 붙을 수 있다. 붙어 봐야 **자기가 보낸
 * 소리를 자기가 돌려받을 뿐**이라 우리 대화가 새지는 않지만, 남의 CPU 를 쓰는 문은 열려 있다.
 * 그래서 **말하는 동안에만 켜고**(마이크를 누를 때 뜬다) 조용해지면 스스로 내린다.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  VOICE_ASR,
  VOICE_MODEL_SOURCES,
  voiceModelDiskName,
  type VoiceModelSource,
} from '@vibisual/shared';
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

/**
 * 비어 있는 포트를 **OS 에게 물어서** 고른다.
 *
 * 고정 포트(6006)를 쓰면 앱을 두 벌 띄웠을 때 뒤엣것이 조용히 실패하고, 남의 프로그램이
 * 그 포트를 쥐고 있으면 우리 잘못이 아닌 이유로 받아쓰기가 죽는다(§3.7 훅 리스너가 동적
 * 포트를 쓰는 것과 같은 이유).
 */
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

/** 그 포트가 실제로 받아 주기 시작했는가 — 프로세스가 떴다고 포트가 열린 것은 아니다. */
function waitForPort(port: number, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
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
 * mac·linux 의 동적 링커에게 우리가 푼 `lib` 을 알려 준다.
 *
 * 이 두 줄이 없으면 실행본은 뜨자마자 `libonnxruntime` 을 못 찾아 죽고, 화면에는 원인이 아니라
 * "엔진이 포트를 안 열었다"만 뜬다. Windows 는 DLL 을 실행본 옆에서 먼저 찾으므로 필요 없다.
 * **`process.platform` 을 함수 안에서 읽지 않는다** — 세 OS 를 Windows 에서 테스트하기 위해서다.
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

function activeModelSource(): VoiceModelSource | null {
  const dir = voiceModelDir();
  for (const s of VOICE_MODEL_SOURCES) if (modelFilesPresent(s, dir)) return s;
  return null;
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
    const source = activeModelSource();
    if (source === null) throw new Error('voice model not installed');

    const modelRoot = voiceModelDir();
    const port = await freePort();
    const args = [
      `--port=${String(port)}`,
      `--tokens=${path.join(modelRoot, voiceModelDiskName('tokens'))}`,
      `--encoder=${path.join(modelRoot, voiceModelDiskName('encoder'))}`,
      `--decoder=${path.join(modelRoot, voiceModelDiskName('decoder'))}`,
      `--joiner=${path.join(modelRoot, voiceModelDiskName('joiner'))}`,
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
      await waitForPort(port, Date.now() + VOICE_ASR.ENGINE_START_TIMEOUT_MS);
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
