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
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  LLAMA_RELEASES_LIST_API,
  parseAssetSha256,
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
const ENGINE_BACKEND_ORDER: readonly LocalEngineBackend[] = ['cuda', 'vulkan', 'cpu'];
/** 설치 메타 — 어떤 빌드의 어떤 백엔드를 깔았는지. 이 파일이 없으면 "모르는 설치"로 본다. */
const META_NAME = '.vibisual-engine.json';

/** 릴리스 목록에서 훑을 개수 — 쓸 수 있는 자산을 가진 릴리스를 찾을 때까지 이만큼만 본다.
 *  (실제 `per_page` 는 shared 의 `LLAMA_RELEASES_LIST_API` 에 박혀 있다 — 둘을 함께 옮길 것.) */
const RELEASE_SCAN_MAX = 20;

/**
 * 릴리스 **목록** 조회 URL — `…/releases/latest` 를 쓰면 안 된다.
 *
 * llama.cpp 가 릴리스 체계를 바꿔 `latest` 자리에 **자산이 `nightly-tag.txt` 하나뿐인**
 * `v0.3.0` 이 앉았다(2026-08-26 실측). 실제 플랫폼 바이너리 33종은 전부 `b#####` **prerelease**
 * 태그에만 붙는다. 그래서 종전 코드는 `pickAsset` 이 모든 백엔드에 null 을 돌려 →
 * `llama-server not found after extract` → **전 플랫폼에서 로컬 엔진 설치 100% 실패**였다.
 * 목록을 받아 "쓸 수 있는 자산을 실제로 가진 가장 최근 릴리스"를 우리가 고른다.
 * prerelease 여부로 거르지 않는다 — 거르면 다시 아무것도 남지 않는다.
 *
 */
const RELEASES_LIST_API = LLAMA_RELEASES_LIST_API;

interface EngineMeta {
  build: string;
  backends: LocalEngineBackend[];
  installedAt: number;
  /** macOS 등 같은 자산을 공유하는 백엔드는 검증된 폴더 한 벌을 가리킨다. */
  backendDirs?: Partial<Record<LocalEngineBackend, LocalEngineBackend>>;
}

/** 엔진이 놓이는 폴더. 모델과 형제로 둔다(`~/.vibisual/engine`). */
export function engineDir(): string {
  return path.join(os.homedir(), '.vibisual', LOCAL_ENGINE_DIR_NAME);
}

/** 폴더 안에서 `llama-server` 를 찾는다. 자산에 따라 한 겹 아래에 들어 있을 수 있다. */
function findServerBin(dir: string, platform: NodeJS.Platform = process.platform): string | null {
  const binName = platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const isFile = (file: string): boolean => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  };
  const direct = path.join(dir, binName);
  if (isFile(direct)) return direct;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const nested = path.join(dir, e.name, binName);
    if (isFile(nested)) return nested;
  }
  return null;
}

/** 검증용 한 번 띄우기의 상한 — 여기서 넘어가면 그 설치는 어차피 못 쓴다. */
const SMOKE_TIMEOUT_MS = 30_000;
/** 갓 쓴 파일을 백신이 훑는 동안 실행이 한 번 막히는 일이 있다 — 한 박자 쉬고 한 번 더 묻는다. */
const SMOKE_RETRY_DELAY_MS = 2_000;

/** 이미지 헤더를 읽을 때 한 번에 당겨 오는 최대 바이트(Mach-O 는 로드 커맨드가 길 수 있다). */
const IMAGE_HEADER_MAX_BYTES = 256 * 1024;

/** PE(Windows) — 섹션 테이블이 가리키는 마지막 바이트. */
function peImageEnd(head: Buffer, read: number): number | null {
  if (read < 64 || head.readUInt16LE(0) !== 0x5a4d) return null; // MZ 가 아니면 우리 판단 밖
  const pe = head.readUInt32LE(0x3c);
  if (pe + 24 > read || head.readUInt32LE(pe) !== 0x00004550) return null;
  const sectionCount = head.readUInt16LE(pe + 6);
  const table = pe + 24 + head.readUInt16LE(pe + 20);
  if (table + sectionCount * 40 > read) return null;
  let end = 0;
  for (let i = 0; i < sectionCount; i += 1) {
    const s = table + i * 40;
    const rawEnd = head.readUInt32LE(s + 20) + head.readUInt32LE(s + 16);
    if (rawEnd > end) end = rawEnd;
  }
  return end;
}

/**
 * ELF(Linux) — 섹션 헤더 테이블의 끝이 곧 파일 끝이다(링커가 마지막에 붙인다).
 * 64비트 리틀엔디언만 본다 — 우리가 받는 자산(x86-64·aarch64 Linux)이 전부 그것이고,
 * 판단이 안 서는 것은 0 을 돌려 **아래 smokeTest 에 맡긴다**(멀쩡한 파일을 지우면 안 된다).
 */
function elfImageEnd(head: Buffer, read: number): number | null {
  if (read < 64) return null;
  if (head.readUInt32BE(0) !== 0x7f454c46) return null; // \x7F E L F
  if (head[4] !== 2 || head[5] !== 1) return null;      // ELF64 · little-endian 만
  const shoff = Number(head.readBigUInt64LE(40));
  const shentsize = head.readUInt16LE(58);
  const shnum = head.readUInt16LE(60);
  if (shoff <= 0 || shentsize <= 0 || shnum <= 0) return null;
  return shoff + shentsize * shnum;
}

/** Mach-O fat(universal) — 각 아키텍처 조각의 끝 중 가장 먼 것. 헤더는 빅엔디언이다. */
function machoFatEnd(head: Buffer, read: number): number | null {
  const magic = head.readUInt32BE(0);
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return null;
  const wide = magic === 0xcafebabf; // fat_arch_64
  const count = head.readUInt32BE(4);
  const entry = wide ? 32 : 20;
  if (count <= 0 || count > 64 || 8 + count * entry > read) return null;
  let end = 0;
  for (let i = 0; i < count; i += 1) {
    const at = 8 + i * entry;
    const offset = wide ? Number(head.readBigUInt64BE(at + 8)) : head.readUInt32BE(at + 8);
    const size = wide ? Number(head.readBigUInt64BE(at + 16)) : head.readUInt32BE(at + 12);
    if (offset + size > end) end = offset + size;
  }
  return end;
}

/**
 * Mach-O thin(macOS) — 로드 커맨드를 훑어 파일에 실제로 자리를 차지하는 끝을 구한다.
 * `LC_SEGMENT_64`(0x19) 의 `fileoff+filesize`, `LC_CODE_SIGNATURE`(0x1d) 의 `dataoff+datasize`.
 * 서명 블록이 대개 파일 맨 끝이라, 이 둘이면 "반쪽으로 풀렸다"를 잡기에 충분하다.
 */
function machoThinEnd(head: Buffer, read: number): number | null {
  const magicLE = head.readUInt32LE(0);
  const is64 = magicLE === 0xfeedfacf || magicLE === 0xcffaedfe;
  const is32 = magicLE === 0xfeedface || magicLE === 0xcefaedfe;
  if (!is64 && !is32) return null;
  const headerSize = is64 ? 32 : 28;
  if (read < headerSize) return null;
  const ncmds = head.readUInt32LE(16);
  const sizeofcmds = head.readUInt32LE(20);
  if (ncmds <= 0 || sizeofcmds <= 0 || headerSize + sizeofcmds > read) return null;
  let at = headerSize;
  let end = 0;
  for (let i = 0; i < ncmds; i += 1) {
    if (at + 8 > read) break;
    const cmd = head.readUInt32LE(at);
    const cmdsize = head.readUInt32LE(at + 4);
    if (cmdsize < 8) break;
    if (cmd === 0x19 && at + 56 <= read) {
      // segment_command_64: cmd,cmdsize,segname[16],vmaddr(8),vmsize(8),fileoff(8),filesize(8)
      const fileoff = Number(head.readBigUInt64LE(at + 40));
      const filesize = Number(head.readBigUInt64LE(at + 48));
      if (fileoff + filesize > end) end = fileoff + filesize;
    } else if (cmd === 0x01 && at + 32 <= read) {
      // segment_command(32비트): cmd,cmdsize,segname[16],vmaddr(4),vmsize(4),fileoff(4),filesize(4)
      const fileoff = head.readUInt32LE(at + 32 - 8);
      const filesize = head.readUInt32LE(at + 32 - 4);
      if (fileoff + filesize > end) end = fileoff + filesize;
    } else if (cmd === 0x1d && at + 16 <= read) {
      // linkedit_data_command: cmd,cmdsize,dataoff(4),datasize(4)
      const dataoff = head.readUInt32LE(at + 8);
      const datasize = head.readUInt32LE(at + 12);
      if (dataoff + datasize > end) end = dataoff + datasize;
    }
    at += cmdsize;
  }
  return end > 0 ? end : null;
}

/**
 * 실행 이미지가 잘렸는지 본다 — 헤더가 가리키는 마지막 바이트가 파일 끝을 넘으면 그 파일은 반쪽이다.
 * 부족한 바이트 수를 돌려준다(0 이면 온전하거나 판단 대상 밖).
 *
 * 해시 목록도 새 의존성도 필요 없다 — **자산이 스스로 자기 길이를 말한다.**
 * PE(win) 만 보던 것을 Mach-O(mac)·ELF(linux)까지 넓혔다. 종전에는 `.dll|.exe` 확장자 + `MZ`
 * 매직만 봐서 mac/linux 에서는 **항상 빈 배열**이었고, 반쯤 풀린 `.dylib`/`.so` 는 설치가
 * "완료"로 끝난 뒤 첫 사용 순간에야 정체 모를 로더 오류로 터졌다.
 */
function imageShortfall(file: string): number {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    if (size < 64) return 0;
    fd = fs.openSync(file, 'r');
    const want = Math.min(size, IMAGE_HEADER_MAX_BYTES);
    const head = Buffer.alloc(want);
    const read = fs.readSync(fd, head, 0, want, 0);
    const end =
      peImageEnd(head, read) ?? machoFatEnd(head, read) ?? machoThinEnd(head, read) ?? elfImageEnd(head, read);
    if (end === null) return 0; // 우리가 아는 형식이 아니면 여기서 단정하지 않는다
    return end > size ? end - size : 0;
  } catch {
    return 0; // 못 읽으면 여기서 단정하지 않는다 — 아래 실제 실행이 다시 판정한다
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔으면 그만 */
      }
    }
  }
}

/**
 * 폴더 안에서 잘린 실행 이미지들(`이름 (-N B)`).
 *
 * 확장자로 거르지 않는다 — POSIX 실행본은 확장자가 아예 없고(`llama-server`), 공유 라이브러리는
 * `.dylib` / `.so` / `.so.1.2` 처럼 제각각이다. 매직 넘버가 형식을 말해 주므로 폴더의 파일을
 * 그대로 훑고 아닌 것은 `imageShortfall` 이 0 으로 흘려보낸다(헤더 몇 KB 만 읽는다).
 *
 * 설치 검증과 §5.19 (D) 엔진 기동 앞머리가 **같은 판정**을 쓰도록 여기서만 정의한다.
 */
export function truncatedImages(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bad: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const short = imageShortfall(path.join(dir, entry.name));
    if (short > 0) bad.push(`${entry.name} (-${String(short)}B)`);
  }
  return bad;
}

/**
 * 실제로 뜨는지 한 번 띄워 본다. 포트를 잡지 않는 `--version` 을 쓴다 — 검증이 부작용을
 * 남기면 안 된다. 문제가 없으면 `null`, 있으면 사람이 읽을 수 있는 사유.
 */
function smokeTest(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const child = spawn(bin, ['--version'], {
      cwd: path.dirname(bin),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 이미 죽었으면 그만 */
      }
      finish('engine did not answer --version in time');
    }, SMOKE_TIMEOUT_MS);
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      finish(e.message);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = err.trim().slice(-200);
      finish(code === 0 ? null : `exit ${String(code)}${tail ? ` — ${tail}` : ''}`);
    });
  });
}

function readMeta(dir: string): EngineMeta | null {
  try {
    const raw = fs.readFileSync(path.join(dir, META_NAME), 'utf8');
    const j = JSON.parse(raw) as Partial<EngineMeta>;
    if (typeof j.build !== 'string') return null;
    return {
      build: j.build,
      backends: Array.isArray(j.backends) ? j.backends.filter((b) => ENGINE_BACKEND_ORDER.includes(b)) : [],
      installedAt: typeof j.installedAt === 'number' ? j.installedAt : 0,
      backendDirs: j.backendDirs,
    };
  } catch {
    return null;
  }
}

export interface EngineCandidate {
  backend: LocalEngineBackend;
  serverBin: string;
}

/** GPU 로더가 실패해도 CPU 실행본은 별도로 남는다. 구형 평면 설치도 계속 읽는다. */
export function getEngineCandidates(
  dir: string = engineDir(),
  platform: NodeJS.Platform = process.platform,
): EngineCandidate[] {
  const meta = readMeta(dir);
  const candidates: EngineCandidate[] = [];
  for (const backend of ENGINE_BACKEND_ORDER) {
    const alias = meta?.backendDirs?.[backend];
    const folder = alias && ENGINE_BACKEND_ORDER.includes(alias) ? alias : backend;
    const serverBin = findServerBin(path.join(dir, folder), platform);
    if (serverBin) candidates.push({ backend, serverBin });
  }
  if (candidates.length > 0) return candidates;
  const legacy = findServerBin(dir, platform);
  if (!legacy) return [];
  return [{ backend: meta?.backends.find((b) => b !== 'cpu') ?? meta?.backends[0] ?? 'vulkan', serverBin: legacy }];
}

/** 같은 볼륨에서 검증 완료본만 교체한다. 교체 실패는 기존 설치로 되돌린다. */
export async function publishEngineInstall(staged: string, dir: string): Promise<void> {
  const backup = `${dir}.previous-${randomUUID()}`;
  let hadPrevious = false;
  try {
    await fsp.rename(dir, backup);
    hadPrevious = true;
  } catch (err) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) throw err;
  }
  try {
    await fsp.rename(staged, dir);
  } catch (err) {
    if (hadPrevious) await fsp.rename(backup, dir);
    throw err;
  }
  if (hadPrevious) {
    await fsp.rm(backup, { recursive: true, force: true }).catch((err: unknown) => {
      logger.warn('[localEngine] previous engine files still in use', err);
    });
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
  const candidates = getEngineCandidates(dir);
  const serverBin = candidates[0]?.serverBin ?? null;
  const meta = readMeta(dir);
  const state: LocalEngineState = {
    installed: serverBin !== null,
    build: meta?.build ?? null,
    backends: [...new Set(candidates.map((candidate) => candidate.backend))],
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

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** `sha256:<64 hex>` — GitHub 이 자산마다 붙여 주는 무결성 지문. 옛 API·미러에는 없을 수 있다. */
  digest?: string;
}

/** GitHub 릴리스 목록의 한 줄(우리가 보는 필드만). */
export interface ReleaseEntry {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

/** 우리가 풀 수 있는 압축 형식 — **Windows 는 `.zip`, mac/linux 는 `.tar.gz` 다**(2026-08-26 실측). */
const ARCHIVE_EXT_RE = /\.(zip|tar\.gz|tgz)$/i;

/** 이 자산이 gzip tar 인가(푸는 명령이 갈린다). */
export function isTarGzName(name: string): boolean {
  return /\.(tar\.gz|tgz)$/i.test(name);
}

/**
 * 자산 이름에서 플랫폼 토큰을 고른다. llama.cpp 규약은
 * `llama-<build>-bin-<os>[-<backend>]-<arch>.<zip|tar.gz>` 이다(2026-08-26 b10631 실측).
 */
export function platformToken(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'macos';
  return 'ubuntu';
}

export function archToken(arch: string = process.arch): string {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * 이 자산이 우리 os·arch 것인지 보고, 맞으면 **백엔드 토큰**을 돌려준다(없으면 빈 문자열).
 * 아니면 null.
 *
 * 이름을 조각으로 읽는 이유: 종전의 느슨한 폴백(`includes('-ubuntu') && endsWith('-x64.zip')`)은
 * Linux 에서 `cpu` 를 찾을 때 목록 순서상 맨 앞의 **`ubuntu-openvino-2026.3-x64`(100MB)** 를
 * 집었다. "백엔드 토큰이 없는 기본 빌드"와 "다른 가속 빌드"를 구분해야 그 사고가 안 난다.
 *
 * - `llama-b10631-bin-win-vulkan-x64.zip`   → `vulkan`
 * - `llama-b10631-bin-win-cuda-13.3-x64.zip`→ `cuda-13.3`
 * - `llama-b10631-bin-ubuntu-x64.tar.gz`    → `''`(기본 빌드)
 * - `llama-b10631-bin-macos-arm64.tar.gz`   → `''`(Metal 이 이미 들어 있다)
 */
export function assetBackendToken(name: string, osTok: string, arch: string): string | null {
  const lower = name.toLowerCase();
  if (!ARCHIVE_EXT_RE.test(lower)) return null;
  if (/^cudart-/i.test(lower)) return null; // CUDA 런타임 재배포판 — 엔진이 아니다
  const base = lower.replace(ARCHIVE_EXT_RE, '');
  const marker = `-bin-${osTok}-`;
  const at = base.indexOf(marker);
  if (at < 0) return null;
  const rest = base.slice(at + marker.length);
  if (rest === arch) return '';
  if (!rest.endsWith(`-${arch}`)) return null;
  return rest.slice(0, rest.length - arch.length - 1);
}

/**
 * 요청한 백엔드에 해당하는 자산 하나를 고른다.
 *
 * 순서: ① 백엔드 토큰이 정확히 맞는 것 → ② 접두가 맞는 것(`cuda` → `cuda-13.3`, 최신 우선)
 *      → ③ **백엔드 토큰이 없는 기본 빌드**(macOS 는 Metal 포함, Linux 는 순수 CPU 빌드).
 * ③ 이 폴백인 이유: macOS 자산은 이름에 백엔드가 아예 안 들어가고, Linux 의 `cpu` 도 토큰 없이
 * `-ubuntu-x64` 로만 올라온다 — 없는 이름을 찾다 포기하면 설치가 통째로 실패한다.
 */
export function pickAsset(
  assets: readonly ReleaseAsset[],
  backend: LocalEngineBackend,
  osTok: string = platformToken(),
  arch: string = archToken(),
): ReleaseAsset | null {
  const scored: { asset: ReleaseAsset; token: string }[] = [];
  for (const asset of assets) {
    const token = assetBackendToken(asset.name, osTok, arch);
    if (token !== null) scored.push({ asset, token });
  }
  const newestFirst = (a: { asset: ReleaseAsset }, b: { asset: ReleaseAsset }): number =>
    b.asset.name.localeCompare(a.asset.name);

  const exact = scored.filter((s) => s.token === backend).sort(newestFirst);
  if (exact[0]) return exact[0].asset;
  const prefixed = scored.filter((s) => s.token.startsWith(`${backend}-`)).sort(newestFirst);
  if (prefixed[0]) return prefixed[0].asset;
  const plain = scored.filter((s) => s.token === '').sort(newestFirst);
  return plain[0]?.asset ?? null;
}

/**
 * 이 플랫폼이 실제로 쓸 수 있는 자산을 **가진** 가장 최근 릴리스.
 *
 * `latest` 를 부르지 않는 이유는 `RELEASES_LIST_API` 주석에 적혀 있다 — 그 자리에 자산이
 * `nightly-tag.txt` 하나뿐인 릴리스가 앉아 있고, 그걸 그대로 받으면 설치가 100% 실패한다.
 * prerelease 여부는 **보지 않는다**(플랫폼 바이너리가 전부 prerelease 에만 붙는다).
 */
export function pickRelease(
  releases: readonly ReleaseEntry[],
  osTok: string = platformToken(),
  arch: string = archToken(),
  backends: readonly LocalEngineBackend[] = LOCAL_ENGINE_DEFAULT_BACKENDS,
): ReleaseEntry | null {
  for (const rel of releases) {
    const assets = rel.assets ?? [];
    if (backends.some((backend) => pickAsset(assets, backend, osTok, arch))) return rel;
  }
  return null;
}

// ─── 내려받기 · 풀기 ───

/** 내려받은 파일의 SHA-256(소문자 hex). 통째로 메모리에 올리지 않는다 — 수백 MB 짜리가 온다. */
async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

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
  // 스트림이 끝났다는 것은 "다 받았다"가 아니다 — 중간에 끊긴 응답도 정상 종료로 보인다.
  //   길이를 대조하지 않으면 반쪽 zip 을 그대로 풀어 버린다.
  if (total > 0 && received !== total) {
    throw new Error(`download truncated (${String(received)}/${String(total)} bytes) ${url}`);
  }
}

/**
 * 압축을 푸는 명령 후보 — 앞에서부터 하나씩, 실패하면 다음.
 *
 * **`.tar.gz` 가 뒤늦게 들어온 이유**: mac/linux 자산은 zip 이 아니라 `.tar.gz` 다
 * (`llama-b10631-bin-macos-arm64.tar.gz`, `…-bin-ubuntu-x64.tar.gz` — 2026-08-26 실측).
 * 세 플랫폼 모두 `tar -xzf` 로 풀리고, Windows 의 `unzip`·`Expand-Archive` 와 Linux 의 `unzip`
 * 은 tar.gz 를 **못 읽으므로** 그 경우 후보에서 뺀다(엉뚱한 실패 로그를 남기지 않는다).
 *
 * **PATH 의 `tar` 를 믿으면 안 된다(2026-08-20 실측).** 개발기처럼 Git 계열 도구가 PATH 앞에
 * 있으면 `tar` 가 GNU tar 로 잡히는데, 그 tar 는 zip 을 못 읽을 뿐 아니라 `C:\…` 의 콜론을
 * 원격 호스트로 읽어 `Cannot connect to C:` 로 죽는다. 그래서 Windows 에서는 **절대 경로의
 * System32 bsdtar 를 먼저** 쓰고, 그다음 PowerShell `Expand-Archive`(구형 Windows 폴백),
 * 마지막으로 PATH 의 `tar` 순으로 내려간다. 셋 다 실측으로 순서를 정했다.
 */
export function extractAttempts(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
  sysTarPath?: string,
): Array<{ cmd: string; args: string[] }> {
  const gz = isTarGzName(archivePath);
  const tarArgs = gz ? ['-xzf', archivePath, '-C', destDir] : ['-xf', archivePath, '-C', destDir];
  if (platform === 'win32') {
    // 역슬래시 리터럴을 소스에 두지 않는다 — path.join 이 플랫폼 구분자를 붙인다.
    const sysTar = sysTarPath ?? path.join(process.env['SystemRoot'] ?? path.join('C:', 'Windows'), 'System32', 'tar.exe');
    const out: Array<{ cmd: string; args: string[] }> = [{ cmd: sysTar, args: tarArgs }];
    if (!gz) {
      out.push({
        cmd: 'powershell',
        args: [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
      });
    }
    out.push({ cmd: 'tar', args: tarArgs });
    return out;
  }
  if (platform === 'darwin') return [{ cmd: 'tar', args: tarArgs }];
  // Linux — zip 은 `unzip` 이 가장 확실하고, tar.gz 는 `unzip` 이 아예 못 읽는다.
  return gz
    ? [{ cmd: 'tar', args: tarArgs }]
    : [
        { cmd: 'unzip', args: ['-o', archivePath, '-d', destDir] },
        { cmd: 'tar', args: tarArgs },
      ];
}

/** 내려받은 압축 파일을 푼다(`.zip` · `.tar.gz` 공용). 의존성을 새로 들이지 않는다. */
function extractArchive(zipPath: string, destDir: string): Promise<void> {
  const attempts = extractAttempts(zipPath, destDir);
  return new Promise((resolve, reject) => {
    const run = (i: number): void => {
      const a = attempts[i];
      if (!a) {
        reject(new Error('no usable unzip tool'));
        return;
      }
      const child = spawn(a.cmd, a.args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      // `error` 와 `close` 는 **둘 다** 뜬다(spawn 실패 시 node 가 이어서 close 도 낸다).
      //   가드가 없으면 한 번의 실패가 다음 도구를 두 벌 띄워 같은 폴더에 동시에 풀고,
      //   가장 큰 파일이 서로의 쓰기에 잘린다 — 그 잘린 이미지가 곧 `0xC000007B` 다.
      let settled = false;
      const once = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stderr?.on('data', (d: Buffer) => {
        err += d.toString();
      });
      child.on('error', () => once(() => run(i + 1)));
      child.on('close', (code) => {
        // 종료 코드가 0 이어도 실제로 풀렸는지는 호출자가 검증 단계에서 다시 본다.
        once(() => {
          if (code === 0) {
            resolve();
          } else if (i + 1 < attempts.length) {
            logger.warn(`[localEngine] extract via ${a.cmd} failed (exit ${String(code)}), trying next`);
            run(i + 1);
          } else {
            reject(new Error(`extract failed (${a.cmd} exit ${String(code)}) ${err.slice(0, 300)}`));
          }
        });
      });
    };
    run(0);
  });
}

/** 파일 존재만으로 설치를 완료하지 않는다. 검증은 아직 공개하지 않은 폴더에서 한다. */
async function verifyEngineDirectory(dir: string): Promise<void> {
  const bin = findServerBin(dir);
  if (!bin) throw new Error('llama-server not found after extract');
  if (!IS_WIN) await fsp.chmod(bin, 0o755);
  const truncated = truncatedImages(path.dirname(bin));
  let failure = truncated.length > 0 ? `incomplete files: ${truncated.slice(0, 5).join(', ')}` : await smokeTest(bin);
  if (failure && truncated.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, SMOKE_RETRY_DELAY_MS));
    failure = await smokeTest(bin);
  }
  if (failure) throw new Error(`engine verification failed (${failure})`);
}

/**
 * §5.19 (B) — 엔진 설치. 동시 호출은 같은 in-flight installId 를 공유한다.
 * 기본 백엔드는 Vulkan + CPU 두 벌이고, 호출자가 `cuda` 를 더 얹을 수 있다.
 */
export function installEngine(backends?: readonly LocalEngineBackend[]): LocalEngineProgress {
  if (inflight) return { ...inflight };

  // CPU 는 GPU 드라이버가 없는 PC 의 회복 경로라 선택 백엔드와 항상 함께 확보한다.
  const want: LocalEngineBackend[] = [...new Set([
    ...(backends && backends.length > 0 ? backends : LOCAL_ENGINE_DEFAULT_BACKENDS),
    'cpu' as const,
  ])];
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
    let stagedDir = '';
    try {
      await fsp.mkdir(path.dirname(dir), { recursive: true });
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vibisual-engine-'));
      stagedDir = await fsp.mkdtemp(path.join(path.dirname(dir), 'engine-install-'));

      const relRes = await fetch(RELEASES_LIST_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'vibisual' },
      });
      if (!relRes.ok) throw new Error(`release lookup ${relRes.status}`);
      const parsed: unknown = await relRes.json();
      const releases: ReleaseEntry[] = Array.isArray(parsed) ? (parsed as ReleaseEntry[]) : [parsed as ReleaseEntry];
      const rel = pickRelease(releases, platformToken(), archToken(), want);
      if (!rel) {
        throw new Error(
          `no llama.cpp release with assets for ${platformToken()}/${archToken()}`
          + ` (scanned ${String(releases.length)} releases)`,
        );
      }
      const build = rel.tag_name ?? 'unknown';
      const assets = rel.assets ?? [];

      const got: LocalEngineBackend[] = [];
      const backendDirs: Partial<Record<LocalEngineBackend, LocalEngineBackend>> = {};
      const failures: string[] = [];
      /**
       * 이번 설치에서 **이미 받아 푼** 자산 이름. macOS 는 자산 이름에 백엔드가 없어
       * `vulkan`·`cpu` 두 번의 루프가 **같은 파일**로 폴백한다 — 가드가 없으면 11MB 를 두 번 받고
       * 같은 폴더에 두 번 풀어, 두 번째 tar 가 첫 번째가 쓰던 파일을 덮어쓰며 잘린 이미지를 만든다
       * (2026-08-20 사고와 같은 계열). 두 번째부터는 건너뛰되 그 백엔드도 "확보됨"으로 센다.
       */
      const fetched = new Map<string, LocalEngineBackend>();
      let stepIdx = 0;
      for (const backend of want) {
        stepIdx += 1;
        const asset = pickAsset(assets, backend);
        if (!asset) {
          // 이 플랫폼에 그 백엔드 자산이 없으면 조용히 건너뛴다 — 다른 한 벌로도 돌아간다.
          logger.warn(`[localEngine] no asset for backend=${backend} platform=${platformToken()}/${archToken()}`);
          continue;
        }
        const sharedBackend = fetched.get(asset.name);
        if (sharedBackend) {
          logger.info(`[localEngine] backend=${backend} shares asset ${asset.name} — skipping duplicate download`);
          got.push(backend);
          backendDirs[backend] = sharedBackend;
          continue;
        }
        // 실패한 GPU 자산이 CPU 의 준비까지 막으면 회복 경로가 사라진다.
        try {
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

          // **푸는 것은 코드를 실행할 자리에 파일을 놓는 일이다** — 풀기 전에 발행처 지문과 대조한다.
          //   길이 대조(`downloadTo`)는 "다 받았나"만 본다. 중간에 바뀐 바이트는 길이가 같으므로 통과한다.
          //   `digest` 는 우리가 이미 TLS 로 받은 릴리스 JSON 에 실려 오므로 요청이 늘지 않는다.
          const expected = parseAssetSha256(asset.digest);
          if (expected) {
            const actual = await sha256File(zipPath);
            if (actual !== expected) {
              // 남겨 두면 다음 설치가 이 파일을 주워 쓸 수 있다 — 그 자리에서 지운다.
              await fsp.rm(zipPath, { force: true }).catch(() => undefined);
              throw new Error(
                `engine asset checksum mismatch (${asset.name}): expected ${expected.slice(0, 16)}…,`
                + ` got ${actual.slice(0, 16)}… — install again`,
              );
            }
          } else {
            // 지문이 없다고 설치를 막지는 않는다(구형 API·미러에는 없다). 다만 검증이 없었음을 남긴다.
            logger.warn(`[localEngine] no sha256 digest for ${asset.name} — integrity unverified`);
          }

          session.status = 'extracting';
          pushProgress();
          const backendDir = path.join(stagedDir, backend);
          await fsp.mkdir(backendDir, { recursive: true });
          await extractArchive(zipPath, backendDir);
          session.status = 'verifying';
          pushProgress();
          await verifyEngineDirectory(backendDir);
          fetched.set(asset.name, backend);
          backendDirs[backend] = backend;
          got.push(backend);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failures.push(`${backend}: ${reason}`);
          logger.warn(`[localEngine] backend=${backend} unavailable; trying remaining backends`, err);
          await fsp.rm(path.join(stagedDir, backend), { recursive: true, force: true });
        }
      }

      session.status = 'verifying';
      pushProgress();
      if (got.length === 0) throw new Error(`no usable engine backend — ${failures.join('; ') || 'no matching assets'}`);
      const meta: EngineMeta = { build, backends: got, installedAt: Date.now(), backendDirs };
      await fsp.writeFile(path.join(stagedDir, META_NAME), JSON.stringify(meta, null, 2), 'utf8');
      await publishEngineInstall(stagedDir, dir);
      stagedDir = '';

      session.status = 'done';
      delete session.error;
      pushProgress();
      logger.info(`[localEngine] installed build=${build} backends=${got.join(',')}`);
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
      if (stagedDir) await fsp.rm(stagedDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();

  return { ...session };
}

/**
 * §5.19 (B) — 엔진 삭제. 받아 둔 모델은 **건드리지 않는다** — 수십 GB 를 말없이 지우지
 * 않는다는 규약이라, 모델 삭제는 호출자가 따로 물어보고 모델 서비스로 지운다.
 */
export async function uninstallEngine(): Promise<void> {
  if (inflight) throw new Error('engine installation is in progress');
  const dir = engineDir();
  await fsp.rm(dir, { recursive: true, force: true });
  lastProgress = null;
  logger.info('[localEngine] uninstalled');
}
