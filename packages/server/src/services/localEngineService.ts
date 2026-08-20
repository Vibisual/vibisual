/**
 * localEngineService.ts — §5.19 (B)(D) All Model 로컬 추론 엔진 설치·상태.
 *
 * **왜 인스톨러에 동봉하지 않고 여기서 받는가**: GPU 백엔드는 수십~수백 MB 라, 로컬 모델을
 * 쓰지 않는 사용자의 설치 파일까지 그만큼 무거워진다. §5.13 이 세운 "무거운 것은 설치 단계를
 * 따로 둔다"는 규약을 그대로 탄다 — 우클릭에서 처음 쓰려 할 때 팝업이 뜨고, 그 팝업이
 * 진행률을 끝까지 들고 있는다.
 *
 * **왜 빌드 번호를 박지 않는가**: 릴리스 자산은 빌드마다 새로 올라오고 옛 것은 사라진다.
 * 박아 두면 그 자산이 내려간 날 설치가 통째로 죽는다(§4 CLI 플래그 소실과 같은 계열의 사고).
 * 그래서 매번 최신 릴리스를 조회해 **그때 실제로 있는** 자산 이름으로 고른다.
 *
 * **왜 Vulkan 이 기본인가**: 한 벌이 NVIDIA·AMD·Intel 을 함께 덮고 CUDA 빌드보다 훨씬 작다.
 * CUDA 는 런타임이 없는 PC 에서 `cudart` 를 더 받아야 하므로 기본이 아니라 선택으로 둔다.
 * 사용자 장비를 재서 고르지 않는다 — 배포되는 제품이고, 안 되면 CPU 로 떨어져 느리게라도 돈다.
 *
 * 진행 상황은 §5.7 #23-1 `installLatestClaude` 의 in-flight 세션 + WS push 패턴 그대로다
 * (새 통신 레일 발명 ❌).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  LLAMA_RELEASE_LATEST_API,
  LOCAL_ENGINE_DEFAULT_BACKENDS,
  LOCAL_ENGINE_DIR_NAME,
  type LocalEngineBackend,
  type LocalEngineProgress,
  type LocalEngineState,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

const IS_WIN = process.platform === 'win32';
const SERVER_BIN_NAME = IS_WIN ? 'llama-server.exe' : 'llama-server';
/** 설치 메타 — 어떤 빌드의 어떤 백엔드를 깔았는지. 이 파일이 없으면 "모르는 설치"로 본다. */
const META_NAME = '.vibisual-engine.json';

interface EngineMeta {
  build: string;
  backends: LocalEngineBackend[];
  installedAt: number;
}

/** 엔진이 놓이는 폴더. 모델과 형제로 둔다(`~/.vibisual/engine`). */
export function engineDir(): string {
  return path.join(os.homedir(), '.vibisual', LOCAL_ENGINE_DIR_NAME);
}

/** 폴더 안에서 `llama-server` 를 찾는다. 자산에 따라 한 겹 아래에 들어 있을 수 있다. */
function findServerBin(dir: string): string | null {
  const direct = path.join(dir, SERVER_BIN_NAME);
  if (fs.existsSync(direct)) return direct;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const nested = path.join(dir, e.name, SERVER_BIN_NAME);
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

function readMeta(dir: string): EngineMeta | null {
  try {
    const raw = fs.readFileSync(path.join(dir, META_NAME), 'utf8');
    const j = JSON.parse(raw) as Partial<EngineMeta>;
    if (typeof j.build !== 'string') return null;
    return {
      build: j.build,
      backends: Array.isArray(j.backends) ? (j.backends as LocalEngineBackend[]) : [],
      installedAt: typeof j.installedAt === 'number' ? j.installedAt : 0,
    };
  } catch {
    return null;
  }
}

// ─── in-flight 설치 세션 ───

interface InstallSession extends LocalEngineProgress {
  startedAt: number;
}

let inflight: InstallSession | null = null;
/** 마지막 설치 결과 — 끝난 뒤에도 화면이 "무엇이 됐는지"를 말할 수 있게 남긴다. */
let lastProgress: LocalEngineProgress | null = null;

function pushProgress(): void {
  const p = inflight ?? lastProgress;
  if (!p) return;
  const payload: LocalEngineProgress = { ...p };
  const msg: WSMessage = { type: 'local_engine_progress', timestamp: Date.now(), payload };
  broadcast(msg);
}

/**
 * §5.19 (B) — 지금 이 기기의 엔진 상태.
 * **플래그가 아니라 실물이 진실**이라, 매번 디스크를 본다(캐시 ❌ — 사용자가 폴더를 지운
 * 직후에도 화면이 맞아야 한다). 파일 몇 개 stat 이라 비용이 문제되지 않는다.
 */
export function getEngineState(): LocalEngineState {
  const dir = engineDir();
  const serverBin = findServerBin(dir);
  const meta = readMeta(dir);
  const state: LocalEngineState = {
    installed: serverBin !== null,
    build: meta?.build ?? null,
    backends: meta?.backends ?? [],
    serverBin,
    dir,
  };
  const p = inflight ?? lastProgress;
  if (p) state.progress = { ...p };
  return state;
}

/** 진행 중인 설치가 있으면 그 상태(없으면 마지막 결과, 그것도 없으면 null). */
export function getInflightEngineInstall(): LocalEngineProgress | null {
  const p = inflight ?? lastProgress;
  return p ? { ...p } : null;
}

// ─── 릴리스 자산 고르기 ───

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/**
 * 자산 이름에서 플랫폼 토큰을 고른다. llama.cpp 규약은
 * `llama-<build>-bin-<os>-<backend>-<arch>.zip` 이다(윈도우 실측 b10502).
 */
function platformToken(): string {
  if (IS_WIN) return 'win';
  if (process.platform === 'darwin') return 'macos';
  return 'ubuntu';
}

function archToken(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * 요청한 백엔드에 해당하는 자산 하나를 고른다.
 *
 * CUDA 는 자산 이름에 런타임 버전이 붙으므로(`-cuda-13.3-`) 접두만 맞추고 **가장 최신**을
 * 고른다. macOS 처럼 백엔드가 이름에 안 드러나는 릴리스도 있어, 백엔드 토큰으로 못 찾으면
 * OS+arch 만 맞는 것으로 폴백한다(그 빌드에 가속이 이미 들어 있다).
 */
function pickAsset(assets: ReleaseAsset[], backend: LocalEngineBackend): ReleaseAsset | null {
  const osTok = platformToken();
  const arch = archToken();
  const zips = assets.filter((a) => /\.zip$/i.test(a.name) && !/^cudart-/i.test(a.name));
  const exact = zips
    .filter((a) => {
      const n = a.name.toLowerCase();
      return n.includes(`-${osTok}-`) && n.includes(`-${backend}`) && n.endsWith(`-${arch}.zip`);
    })
    .sort((a, b) => b.name.localeCompare(a.name));
  if (exact.length > 0) return exact[0] ?? null;
  const loose = zips.filter((a) => {
    const n = a.name.toLowerCase();
    return n.includes(`-${osTok}`) && n.endsWith(`-${arch}.zip`);
  });
  return loose[0] ?? null;
}

// ─── 내려받기 · 풀기 ───

async function downloadTo(url: string, dest: string, onBytes: (received: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onBytes(received, total);
  });
  await pipeline(body, fs.createWriteStream(dest));
}

/**
 * zip 을 푼다.
 *
 * 의존성을 새로 들이지 않는다 — Windows 10+ 와 macOS 는 zip 을 읽는 bsdtar 를 이미 들고 있다.
 *
 * **PATH 의 `tar` 를 믿으면 안 된다(2026-08-20 실측).** 개발기처럼 Git 계열 도구가 PATH 앞에
 * 있으면 `tar` 가 GNU tar 로 잡히는데, 그 tar 는 zip 을 못 읽을 뿐 아니라 `C:\…` 의 콜론을
 * 원격 호스트로 읽어 `Cannot connect to C:` 로 죽는다. 그래서 Windows 에서는 **절대 경로의
 * System32 bsdtar 를 먼저** 쓰고, 그다음 PowerShell `Expand-Archive`(구형 Windows 폴백),
 * 마지막으로 PATH 의 `tar` 순으로 내려간다. 셋 다 실측으로 순서를 정했다.
 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  // 역슬래시 리터럴을 소스에 두지 않는다 — path.join 이 플랫폼 구분자를 붙인다.
  const sysTar = path.join(process.env['SystemRoot'] ?? path.join('C:', 'Windows'), 'System32', 'tar.exe');
  const attempts: Array<{ cmd: string; args: string[] }> = IS_WIN
    ? [
        { cmd: sysTar, args: ['-xf', zipPath, '-C', destDir] },
        {
          cmd: 'powershell',
          args: [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
          ],
        },
        { cmd: 'tar', args: ['-xf', zipPath, '-C', destDir] },
      ]
    : process.platform === 'darwin'
      ? [{ cmd: 'tar', args: ['-xf', zipPath, '-C', destDir] }]
      : [
          { cmd: 'unzip', args: ['-o', zipPath, '-d', destDir] },
          { cmd: 'tar', args: ['-xf', zipPath, '-C', destDir] },
        ];
  return new Promise((resolve, reject) => {
    const run = (i: number): void => {
      const a = attempts[i];
      if (!a) {
        reject(new Error('no usable unzip tool'));
        return;
      }
      const child = spawn(a.cmd, a.args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr?.on('data', (d: Buffer) => {
        err += d.toString();
      });
      child.on('error', () => run(i + 1));
      child.on('close', (code) => {
        // 종료 코드가 0 이어도 실제로 풀렸는지는 호출자가 `findServerBin` 으로 다시 본다.
        if (code === 0) {
          resolve();
        } else if (i + 1 < attempts.length) {
          logger.warn(`[localEngine] extract via ${a.cmd} failed (exit ${String(code)}), trying next`);
          run(i + 1);
        } else {
          reject(new Error(`extract failed (${a.cmd} exit ${String(code)}) ${err.slice(0, 300)}`));
        }
      });
    };
    run(0);
  });
}

/**
 * §5.19 (B) — 엔진 설치. 동시 호출은 같은 in-flight installId 를 공유한다.
 * 기본 백엔드는 Vulkan + CPU 두 벌이고, 호출자가 `cuda` 를 더 얹을 수 있다.
 */
export function installEngine(backends?: readonly LocalEngineBackend[]): LocalEngineProgress {
  if (inflight) return { ...inflight };

  const want: LocalEngineBackend[] = [...(backends && backends.length > 0 ? backends : LOCAL_ENGINE_DEFAULT_BACKENDS)];
  const session: InstallSession = {
    installId: randomUUID(),
    status: 'starting',
    startedAt: Date.now(),
    step: 0,
    stepCount: want.length,
    receivedBytes: 0,
    totalBytes: 0,
  };
  inflight = session;
  lastProgress = null;
  pushProgress();

  void (async (): Promise<void> => {
    const dir = engineDir();
    let tmpDir = '';
    try {
      await fsp.mkdir(dir, { recursive: true });
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vibisual-engine-'));

      const relRes = await fetch(LLAMA_RELEASE_LATEST_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'vibisual' },
      });
      if (!relRes.ok) throw new Error(`release lookup ${relRes.status}`);
      const rel = (await relRes.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
      const build = rel.tag_name ?? 'unknown';
      const assets = rel.assets ?? [];

      const got: LocalEngineBackend[] = [];
      let stepIdx = 0;
      for (const backend of want) {
        stepIdx += 1;
        const asset = pickAsset(assets, backend);
        if (!asset) {
          // 이 플랫폼에 그 백엔드 자산이 없으면 조용히 건너뛴다 — 다른 한 벌로도 돌아간다.
          logger.warn(`[localEngine] no asset for backend=${backend} platform=${platformToken()}/${archToken()}`);
          continue;
        }
        session.status = 'downloading';
        session.asset = asset.name;
        session.step = stepIdx;
        session.receivedBytes = 0;
        session.totalBytes = asset.size ?? 0;
        pushProgress();

        const zipPath = path.join(tmpDir, asset.name);
        let lastPush = 0;
        await downloadTo(asset.browser_download_url, zipPath, (received, total) => {
          session.receivedBytes = received;
          if (total > 0) session.totalBytes = total;
          // 매 청크마다 브로드캐스트하면 전선이 진행률로 도배된다 — 200ms 간격으로 충분하다.
          const now = Date.now();
          if (now - lastPush >= 200) {
            lastPush = now;
            pushProgress();
          }
        });

        session.status = 'extracting';
        pushProgress();
        await extractZip(zipPath, dir);
        got.push(backend);
      }

      session.status = 'verifying';
      pushProgress();
      const bin = findServerBin(dir);
      if (!bin) throw new Error(`llama-server not found after extract (dir=${dir})`);

      const meta: EngineMeta = { build, backends: got, installedAt: Date.now() };
      await fsp.writeFile(path.join(dir, META_NAME), JSON.stringify(meta, null, 2), 'utf8');

      session.status = 'done';
      delete session.error;
      pushProgress();
      logger.info(`[localEngine] installed build=${build} backends=${got.join(',')} bin=${bin}`);
    } catch (err) {
      session.status = 'error';
      session.error = err instanceof Error ? err.message : String(err);
      pushProgress();
      logger.error('[localEngine] install failed', err);
    } finally {
      lastProgress = { ...session };
      inflight = null;
      pushProgress();
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();

  return { ...session };
}

/**
 * §5.19 (B) — 엔진 삭제. 받아 둔 모델은 **건드리지 않는다** — 수십 GB 를 말없이 지우지
 * 않는다는 규약이라, 모델 삭제는 호출자가 따로 물어보고 모델 서비스로 지운다.
 */
export async function uninstallEngine(): Promise<void> {
  const dir = engineDir();
  await fsp.rm(dir, { recursive: true, force: true });
  lastProgress = null;
  logger.info('[localEngine] uninstalled');
}
