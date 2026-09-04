/**
 * voiceAsrService.ts — §5.5 #17-38 ⑫ 오프라인 받아쓰기 **설치·상태**.
 *
 * §5.19 (B) 로컬 엔진 설치가 세운 규약을 그대로 탄다 — 새 레일을 발명하지 않는다:
 *  · 인스톨러에 동봉하지 않고 **처음 쓰려 할 때 받는다**(모델이 650MB 다).
 *  · 판올림 번호를 코드에 박지 않고 **릴리스 목록에서 그때 있는 자산**을 고른다.
 *  · 설치 여부는 플래그가 아니라 **디스크의 실물**로 판정한다(폴더를 지웠으면 다시 설치 창).
 *  · 진행 상황은 in-flight 세션 + WS push(§5.7 #23-1 패턴).
 *
 * **여기가 §5.19 와 다른 한 가지 — 한 창에 걸음이 둘이다.** 엔진(약 20MB)과 모델(약 650MB)을
 * 잇달아 받으므로 막대가 두 번 0 으로 돌아가면 사용자는 처음부터 다시 받는 줄 안다. 그래서
 * 진행률은 **두 걸음을 합친 하나**(`doneBytes`/`grandTotalBytes`)로 낸다.
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
  SHERPA_ASR_MODELS_API,
  SHERPA_RELEASES_LIST_API,
  VOICE_ASR,
  VOICE_ASR_ENGINE_DIR_NAME,
  VOICE_ASR_MODEL_DIR_NAME,
  VOICE_ASR_RELEASE_SCAN_MAX,
  VOICE_MODEL_DISK_APPROX_BYTES,
  pickVoiceEngineAsset,
  pickVoiceModelAsset,
  voiceEngineBinName,
  voiceModelDiskName,
  voiceModelRoleForFile,
  type VoiceAsrInstallProgress,
  type VoiceAsrInstallStage,
  type VoiceAsrState,
  type VoiceModelRole,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

/** 설치 메타 — 어떤 릴리스의 어떤 자산·어떤 저장소를 깔았는지. 없으면 "모르는 설치"로 본다. */
const META_NAME = '.vibisual-voice.json';

interface InstallMeta {
  engineVersion?: string;
  engineAsset?: string;
  /**
   * 어느 릴리스 자산으로 깔린 모델인가.
   *
   * 옛 설치(허깅페이스 제3자 export)는 **파일 이름이 지금과 같다** — 있는지만 보면 "설치됨"이
   * 되고, 그 사용자는 엔진이 즉사하는 모델을 영영 물린 채 산다. 이 칸이 비어 있으면 옛 설치다.
   */
  modelAsset?: string;
}

export function voiceEngineDir(): string {
  return path.join(os.homedir(), '.vibisual', VOICE_ASR_ENGINE_DIR_NAME);
}

export function voiceModelDir(): string {
  return path.join(os.homedir(), '.vibisual', VOICE_ASR_MODEL_DIR_NAME);
}

/**
 * 폴더 안에서 실행본을 찾는다.
 *
 * 자산은 `sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts/bin/…` 처럼 **한두 겹 아래**에
 * 들어 있다. 압축 안의 최상위 폴더 이름이 판올림마다 달라지므로 이름을 박지 않고 훑는다
 * (§5.19 `findServerBin` 과 같은 이유).
 */
export function findVoiceEngineBin(root: string, platform: NodeJS.Platform = process.platform): string | null {
  const want = voiceEngineBinName(platform);
  const stack: string[] = [root];
  let guard = 0;
  while (stack.length > 0 && guard < 4000) {
    guard += 1;
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === want) return full;
    }
  }
  return null;
}

function readMeta(): InstallMeta {
  try {
    const raw = fs.readFileSync(path.join(voiceEngineDir(), META_NAME), 'utf8');
    return JSON.parse(raw) as InstallMeta;
  } catch {
    return {};
  }
}

function writeMeta(patch: InstallMeta): void {
  const dir = voiceEngineDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, META_NAME), JSON.stringify({ ...readMeta(), ...patch }, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[voiceAsr] meta write failed: ${String(err)}`);
  }
}

/**
 * 모델 쪽 설치 메타 — **모델 폴더 안에** 둔다.
 *
 * 엔진 메타(`META_NAME`)와 한 파일로 묶지 않는 이유: 사용자가 엔진 폴더만 지우면 모델은
 * 멀쩡한데 "어느 자산으로 깔았는지"를 잃어 682MB 를 다시 받게 된다. 설명하는 대상 옆에
 * 두면 그 일이 없다(§5.19 (B) "판정은 플래그가 아니라 디스크의 실물" 과 같은 결 —
 * 이 파일도 모델 폴더를 지우면 함께 사라진다).
 */
const MODEL_META_NAME = '.vibisual-voice-model.json';

interface ModelMeta {
  /** 릴리스 자산 파일명. **이 값이 곧 이주 표식**이다(옛 허깅페이스 설치에는 없다). */
  asset?: string;
  /** 그 자산이 실린 릴리스 태그. */
  release?: string;
}

export function readModelMeta(dir: string = voiceModelDir()): ModelMeta {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MODEL_META_NAME), 'utf8')) as ModelMeta;
  } catch {
    return {};
  }
}

function writeModelMeta(dir: string, patch: ModelMeta): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MODEL_META_NAME), JSON.stringify(patch, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[voiceAsr] model meta write failed: ${String(err)}`);
  }
}

/** 인식기가 요구하는 네 조각. 하나라도 없으면 엔진이 뜨지 않는다. */
const MODEL_ROLES: readonly VoiceModelRole[] = ['encoder', 'decoder', 'joiner', 'tokens'];

/**
 * 네 조각이 **전부, 비어 있지 않게** 디스크에 있는가.
 *
 * 종전에는 조각마다 **바이트 수를 박아 두고 대조**했다. 파일을 하나씩 받던 때에는 그것이
 * 반쪽 파일을 걸러 주는 유일한 장치였지만, 이제는 압축본 하나를 받아 풀므로 그 자리가
 * **`downloadResumable` 의 크기 검증 + tar 의 성공 여부**로 옮겨 갔다(반쯤 받힌 압축본은
 * 풀리지 않고, 풀리다 만 폴더는 조각이 모자란다). 남은 위험은 "이름은 있는데 0바이트"뿐이라
 * 그것만 본다 — 박아 둔 숫자는 판올림 한 번에 낡고, 낡으면 멀쩡한 설치가 미설치로 읽힌다.
 */
export function modelFilesPresent(dir: string): boolean {
  for (const role of MODEL_ROLES) {
    try {
      if (fs.statSync(path.join(dir, voiceModelDiskName(role))).size <= 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function dirBytes(dir: string): number {
  let total = 0;
  const stack = [dir];
  let guard = 0;
  while (stack.length > 0 && guard < 8000) {
    guard += 1;
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 지워지는 중일 수 있다 — 합계 하나 때문에 상태 조회가 죽으면 안 된다. */
        }
      }
    }
  }
  return total;
}

// ─── in-flight 설치 ──────────────────────────────────────────────────────────

interface InstallSession extends VoiceAsrInstallProgress {
  abort: AbortController;
  lastPushAt: number;
}

let inflight: InstallSession | null = null;

function toProgress(s: InstallSession): VoiceAsrInstallProgress {
  const out: VoiceAsrInstallProgress = {
    installId: s.installId,
    stage: s.stage,
    receivedBytes: s.receivedBytes,
    totalBytes: s.totalBytes,
    doneBytes: s.doneBytes,
    grandTotalBytes: s.grandTotalBytes,
  };
  if (s.item !== undefined) out.item = s.item;
  if (s.error !== undefined) out.error = s.error;
  return out;
}

/**
 * 진행률을 민다. `force` 가 아니면 `PROGRESS_PUSH_MS` 간격으로 접는다 —
 * 650MB 를 청크마다 밀면 그 브로드캐스트만으로 프레임을 먹는다(§9 배치 규약과 같은 결).
 */
function pushProgress(force = false): void {
  const s = inflight;
  if (!s) return;
  const now = Date.now();
  if (!force && now - s.lastPushAt < VOICE_ASR.PROGRESS_PUSH_MS) return;
  s.lastPushAt = now;
  const msg: WSMessage = { type: 'voice_asr_progress', timestamp: now, payload: toProgress(s) };
  broadcast(msg);
}

function setStage(stage: VoiceAsrInstallStage, item?: string): void {
  const s = inflight;
  if (!s) return;
  s.stage = stage;
  if (item !== undefined) s.item = item;
  pushProgress(true);
}

export function getInflightVoiceInstall(): VoiceAsrInstallProgress | null {
  return inflight ? toProgress(inflight) : null;
}

/** §5.19 (B) — **디스크의 실물**로 판정한다. 플래그를 믿었다가 폴더를 지운 사용자가 첫 대화에서 죽는다. */
export function getVoiceAsrState(): VoiceAsrState {
  const engineRoot = voiceEngineDir();
  const modelRoot = voiceModelDir();
  const bin = findVoiceEngineBin(engineRoot);
  const meta = readMeta();
  const modelMeta = readModelMeta(modelRoot);
  /**
   * **자산 표식이 없으면 깔린 것으로 치지 않는다.**
   *
   * 폐기된 허깅페이스 경로로 받은 옛 설치는 파일 이름이 지금과 똑같아서(`encoder.onnx` …)
   * 있는지만 보면 "설치됨"이 된다. 그런데 그 `encoder.onnx` 는 **엔진이 적재하다 즉사**하는
   * 물건이라(⑫), 그대로 두면 그 사용자는 700MB 를 받아 두고도 마이크를 누를 때마다
   * 20초 뒤 실패만 본다. 표식이 비어 있으면 설치 창을 다시 띄워 **한 번 더 받게** 한다.
   */
  const modelOk = modelFilesPresent(modelRoot) && modelMeta.asset !== undefined;
  const engineOk = bin !== null;
  const state: VoiceAsrState = {
    engineInstalled: engineOk,
    modelInstalled: modelOk,
    ready: engineOk && modelOk,
    diskBytes: dirBytes(engineRoot) + dirBytes(modelRoot),
  };
  if (meta.engineVersion !== undefined) state.engineVersion = meta.engineVersion;
  if (modelOk && modelMeta.asset !== undefined) state.modelAsset = modelMeta.asset;
  const running = getInflightVoiceInstall();
  if (running) state.install = running;
  return state;
}

// ─── 내려받기 ────────────────────────────────────────────────────────────────

/**
 * 받는다. **이어받는다** — 650MB 를 회선이 한 번 끊겼다고 처음부터 다시 받게 하지 않는다.
 *
 * `<dest>.part` 가 있으면 그 길이부터 `Range` 로 이어 붙이고, 서버가 이어주기를 거절하면
 * (206 이 아니라 200) 그 자리에서 처음부터 다시 받는다 — **거절을 무시하고 이어 붙이면
 * 앞부분이 두 번 들어간 파일이 만들어지고, 크기가 맞아 검증까지 통과한다.**
 */
async function downloadResumable(
  url: string,
  dest: string,
  expectedBytes: number,
  signal: AbortSignal,
  onBytes: (received: number, total: number) => void,
): Promise<void> {
  const part = `${dest}.part`;
  let already = 0;
  try {
    already = fs.statSync(part).size;
  } catch {
    already = 0;
  }
  if (expectedBytes > 0 && already > expectedBytes) {
    // 예상보다 크면 우리가 아는 파일이 아니다 — 이어 붙이지 말고 버린다.
    await fsp.rm(part, { force: true });
    already = 0;
  }

  const headers: Record<string, string> = {};
  if (already > 0) headers['range'] = `bytes=${String(already)}-`;
  const res = await fetch(url, { redirect: 'follow', headers, signal });
  if (!res.ok || !res.body) throw new Error(`download ${String(res.status)} ${url}`);

  const resumed = already > 0 && res.status === 206;
  if (already > 0 && !resumed) {
    await fsp.rm(part, { force: true });
    already = 0;
  }

  const remaining = Number(res.headers.get('content-length') ?? 0);
  const total = expectedBytes > 0 ? expectedBytes : already + remaining;
  let received = already;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onBytes(received, total);
  });
  await pipeline(body, fs.createWriteStream(part, resumed ? { flags: 'a' } : { flags: 'w' }));

  // 스트림이 끝났다는 것은 "다 받았다"가 아니다 — 중간에 끊긴 응답도 정상 종료로 보인다.
  const finalSize = fs.statSync(part).size;
  if (total > 0 && finalSize !== total) {
    throw new Error(`download truncated (${String(finalSize)}/${String(total)}) ${url}`);
  }
  await fsp.rm(dest, { force: true });
  await fsp.rename(part, dest);
}

/** 압축을 푸는 명령 후보. `.tar.bz2` 는 세 OS 의 tar 가 전부 자동 판별한다(`-xf`). */
export function voiceExtractAttempts(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
  sysTarPath?: string,
): Array<{ cmd: string; args: string[] }> {
  const args = ['-xf', archivePath, '-C', destDir];
  if (platform === 'win32') {
    // PATH 의 `tar` 를 믿으면 안 된다 — Git 계열 GNU tar 가 잡히면 `C:` 를 원격 호스트로 읽어
    // `Cannot connect to C:` 로 죽는다(§5.19 실측). System32 bsdtar 를 절대 경로로 먼저.
    const sysTar =
      sysTarPath ?? path.join(process.env['SystemRoot'] ?? path.join('C:', 'Windows'), 'System32', 'tar.exe');
    return [
      { cmd: sysTar, args },
      { cmd: 'tar', args },
    ];
  }
  // mac 은 bsdtar, linux 는 GNU tar — 둘 다 `-xf` 로 bzip2 를 판별한다.
  // 리눅스에서 `bzip2` 가 없는 최소 설치를 만나면 `-xjf` 도 마찬가지로 죽으므로 후보를 늘리지 않는다.
  return [{ cmd: 'tar', args }];
}

function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const attempts = voiceExtractAttempts(archivePath, destDir);
  return new Promise((resolve, reject) => {
    const run = (i: number): void => {
      const a = attempts[i];
      if (!a) {
        reject(new Error('no usable tar tool'));
        return;
      }
      // 짧게 살고 손자를 만들지 않아 `processGroupSpawnOptions()` 를 붙이지 않는다 — 앱이 내려갈 때
      // 함께 죽는 편이 맞다(반쯤 푼 폴더는 크기 검사에 걸려 다음 실행에서 다시 받는다).
      const child = spawn(a.cmd, a.args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      // `error` 와 `close` 는 둘 다 뜬다 — 가드가 없으면 한 번의 실패가 다음 도구를 두 벌 띄워
      // 같은 폴더에 동시에 풀고, 서로의 쓰기에 파일이 잘린다(§5.19 실측).
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
        once(() => {
          if (code === 0) resolve();
          else if (i + 1 < attempts.length) run(i + 1);
          else reject(new Error(`extract failed (${a.cmd} exit ${String(code)}) ${err.slice(0, 300)}`));
        });
      });
    };
    run(0);
  });
}

/**
 * 푼 폴더를 **평탄하게** 만든다 — 네 조각을 모델 폴더 바로 아래 **우리 이름**으로 놓는다.
 *
 * 자산은 `sherpa-onnx-nemotron-…-560ms-int8-2026-06-11/encoder.int8.onnx` 처럼 한 겹 아래에,
 * 그리고 판올림마다 달라지는 이름으로 들어 있다(`findVoiceEngineBin` 이 실행본을 훑는 것과
 * 같은 이유). 여기서 한 번 정리해 두면 **엔진에 넘기는 인자가 흔들리지 않는다** —
 * `voiceRecognizerService` 는 `voiceModelDiskName(role)` 네 개만 알면 된다.
 *
 * 곁다리(README·test_wavs)는 옮기지 않고 남은 폴더째 지운다 — 셋 다 안 쓰는데 `test_wavs`
 * 하나가 수 MB 다.
 */
async function flattenModelDir(root: string): Promise<void> {
  const found = new Map<VoiceModelRole, string>();
  const strays: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === root) strays.push(full);
        await walk(full, depth + 1);
        continue;
      }
      const role = voiceModelRoleForFile(e.name);
      if (role === null) continue;
      const prev = found.get(role);
      // 한 역할에 후보가 둘이면(`encoder.int8.onnx` / `encoder.fp32.onnx`) **우리가 고른
      // 자산의 것**인 int8 을 먼저 잡는다 — 아니면 어느 쪽이 잡힐지가 훑는 순서에 달린다.
      if (prev === undefined || (!prev.includes('int8') && e.name.includes('int8'))) {
        found.set(role, full);
      }
    }
  };
  await walk(root, 0);

  for (const [role, from] of found) {
    const to = path.join(root, voiceModelDiskName(role));
    if (path.resolve(from) === path.resolve(to)) continue;
    await fsp.rm(to, { force: true });
    await fsp.rename(from, to);
  }
  for (const dir of strays) await fsp.rm(dir, { recursive: true, force: true });
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}
interface ReleaseEntry {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

/** 쓸 수 있는 자산을 **실제로 가진** 가장 최근 릴리스와 그 자산. */
export function pickVoiceRelease(
  releases: readonly ReleaseEntry[],
  platform: NodeJS.Platform,
  arch: string,
): { release: ReleaseEntry; asset: ReleaseAsset } | null {
  for (const rel of releases.slice(0, VOICE_ASR_RELEASE_SCAN_MAX)) {
    const asset = pickVoiceEngineAsset(rel.assets ?? [], platform, arch);
    if (asset) return { release: rel, asset };
  }
  return null;
}

// ─── 설치 ────────────────────────────────────────────────────────────────────

/**
 * 엔진 + 모델을 한 흐름으로 설치한다. 동시 호출은 같은 in-flight 를 공유한다.
 *
 * **이미 있는 걸음은 건너뛴다** — 모델만 받다 끊긴 사용자가 엔진 20MB 를 다시 받지 않는다.
 */
export function installVoiceAsr(): VoiceAsrInstallProgress {
  if (inflight) return toProgress(inflight);

  const engineRoot = voiceEngineDir();
  const modelRoot = voiceModelDir();
  const engineDone = findVoiceEngineBin(engineRoot) !== null;

  const session: InstallSession = {
    installId: randomUUID(),
    stage: 'engine',
    receivedBytes: 0,
    totalBytes: 0,
    doneBytes: 0,
    // 엔진·모델 자산 크기는 **릴리스를 조회해야** 알 수 있다. 조회 전 몇 초 동안 막대가
    // 비어 보이지 않게 대략치를 잡아 두고, 자산을 고른 뒤 실제 크기로 고쳐 잡는다.
    // (고쳐 잡으면 총량이 줄어 막대가 **앞으로** 뛴다 — 뒤로 가지 않으므로 규약대로다.)
    grandTotalBytes: VOICE_MODEL_DISK_APPROX_BYTES,
    abort: new AbortController(),
    lastPushAt: 0,
  };
  inflight = session;
  pushProgress(true);

  void (async (): Promise<void> => {
    const tmpDir = path.join(os.tmpdir(), `vibisual-voice-${session.installId.slice(0, 8)}`);
    try {
      // ── 1) 엔진 ──
      if (engineDone) {
        session.doneBytes = 0;
      } else {
        setStage('engine');
        const res = await fetch(SHERPA_RELEASES_LIST_API, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'vibisual' },
          signal: session.abort.signal,
        });
        if (!res.ok) throw new Error(`release list ${String(res.status)}`);
        const releases = (await res.json()) as ReleaseEntry[];
        const picked = pickVoiceRelease(releases, process.platform, process.arch);
        if (!picked) throw new Error(`no engine asset for ${process.platform}/${process.arch}`);

        const assetBytes = picked.asset.size ?? 0;
        session.grandTotalBytes = VOICE_MODEL_DISK_APPROX_BYTES + assetBytes;
        setStage('engine', picked.asset.name);

        await fsp.mkdir(tmpDir, { recursive: true });
        const archive = path.join(tmpDir, picked.asset.name);
        await downloadResumable(
          picked.asset.browser_download_url,
          archive,
          assetBytes,
          session.abort.signal,
          (received, total) => {
            session.receivedBytes = received;
            session.totalBytes = total;
            pushProgress();
          },
        );

        setStage('extracting');
        await fsp.mkdir(engineRoot, { recursive: true });
        await extractArchive(archive, engineRoot);
        const bin = findVoiceEngineBin(engineRoot);
        if (bin === null) throw new Error('engine binary not found after extract');
        // POSIX 는 tar 가 실행 비트를 옮겨 주지만, 자산이 그것 없이 말려 있으면 spawn 이 EACCES 로 죽는다.
        if (process.platform !== 'win32') {
          try {
            await fsp.chmod(bin, 0o755);
          } catch {
            /* 이미 실행 가능하면 실패해도 상관없다. */
          }
        }
        writeMeta({ engineVersion: picked.release.tag_name ?? '', engineAsset: picked.asset.name });
        session.doneBytes += assetBytes;
        session.receivedBytes = 0;
      }

      // ── 2) 모델 ──
      // **엔진과 같은 발행처의 릴리스 자산**에서 받는다(⑫ — 제3자 export 는 엔진이 못 읽는다).
      setStage('model');
      const modelRes = await fetch(SHERPA_ASR_MODELS_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'vibisual' },
        signal: session.abort.signal,
      });
      if (!modelRes.ok) throw new Error(`model release ${String(modelRes.status)}`);
      const modelRelease = (await modelRes.json()) as ReleaseEntry;
      const modelAsset = pickVoiceModelAsset(modelRelease.assets ?? []);
      if (modelAsset === null) throw new Error('no voice model asset in the asr-models release');

      const modelBytes = modelAsset.size ?? 0;
      // 실제 크기를 알았으니 총량을 고쳐 잡는다(엔진 몫은 이미 `doneBytes` 에 들어가 있다).
      session.grandTotalBytes = session.doneBytes + modelBytes;

      if (modelFilesPresent(modelRoot) && readModelMeta(modelRoot).asset === modelAsset.name) {
        // 이미 **그 자산으로** 깔려 있다 — 엔진만 다시 받은 사용자가 682MB 를 또 받지 않는다.
        session.doneBytes += modelBytes;
        session.receivedBytes = 0;
        pushProgress(true);
      } else {
        setStage('model', modelAsset.name);
        await fsp.mkdir(tmpDir, { recursive: true });
        const modelArchive = path.join(tmpDir, modelAsset.name);
        await downloadResumable(
          modelAsset.browser_download_url,
          modelArchive,
          modelBytes,
          session.abort.signal,
          (received, total) => {
            session.receivedBytes = received;
            session.totalBytes = total;
            pushProgress();
          },
        );

        setStage('extracting', modelAsset.name);
        // **풀기 전에 옛것을 비운다** — 폐기된 허깅페이스 설치가 남아 있으면 역할 파일이 섞여
        // 어느 것이 지금 자산의 것인지 알 수 없게 된다(옛 `encoder.onnx` 하나가 남아도 즉사한다).
        await fsp.rm(modelRoot, { recursive: true, force: true });
        await fsp.mkdir(modelRoot, { recursive: true });
        // 압축본은 임시 폴더에 두되 **푸는 곳은 모델 폴더**다 — 그래야 아래 평탄화가
        // 같은 파일시스템 안의 `rename` 이라 657MB 를 다시 복사하지 않는다(드라이브가 갈리면
        // `rename` 은 EXDEV 로 죽는다).
        await extractArchive(modelArchive, modelRoot);
        await flattenModelDir(modelRoot);
        session.doneBytes += modelBytes;
        session.receivedBytes = 0;
      }

      // ── 3) 검증 ──
      setStage('verifying');
      if (!modelFilesPresent(modelRoot)) throw new Error('model files incomplete after download');
      if (findVoiceEngineBin(engineRoot) === null) throw new Error('engine binary missing after install');
      // 표식은 **검증을 통과한 뒤에** 적는다 — 먼저 적으면 반쯤 풀린 폴더가 "설치됨"이 된다.
      writeModelMeta(modelRoot, { asset: modelAsset.name, release: modelRelease.tag_name ?? '' });
      setStage('ready');
    } catch (err) {
      const canceled = session.abort.signal.aborted;
      session.stage = canceled ? 'canceled' : 'error';
      if (!canceled) session.error = err instanceof Error ? err.message : String(err);
      pushProgress(true);
      if (!canceled) logger.error('[voiceAsr] install failed', err);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      // 끝난 세션은 **잠깐 남긴다** — 창이 마지막 상태(ready/error)를 읽고 스스로 물러난다.
      const finished = inflight;
      setTimeout(() => {
        if (inflight === finished) inflight = null;
      }, 5_000);
    }
  })();

  return toProgress(session);
}

/** 사용자가 중간에 그만둔다. 받다 만 `.part` 는 남긴다 — 다시 누르면 그 자리에서 이어받는다. */
export function cancelVoiceInstall(): boolean {
  if (!inflight) return false;
  inflight.abort.abort();
  return true;
}

/** 받아 둔 것을 지운다. §5.19 (B) "수십 GB 를 말없이 지우지 않는다" — 부르는 쪽이 먼저 묻는다. */
export async function removeVoiceAsr(): Promise<void> {
  cancelVoiceInstall();
  await fsp.rm(voiceEngineDir(), { recursive: true, force: true });
  await fsp.rm(voiceModelDir(), { recursive: true, force: true });
}
