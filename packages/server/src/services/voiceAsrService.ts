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
  SHERPA_RELEASES_LIST_API,
  VOICE_ASR,
  VOICE_ASR_ENGINE_DIR_NAME,
  VOICE_ASR_MODEL_DIR_NAME,
  VOICE_ASR_RELEASE_SCAN_MAX,
  VOICE_MODEL_SOURCES,
  pickVoiceEngineAsset,
  voiceEngineBinName,
  voiceModelDiskName,
  voiceModelFileUrl,
  voiceModelTotalBytes,
  type VoiceAsrInstallProgress,
  type VoiceAsrInstallStage,
  type VoiceAsrState,
  type VoiceModelSource,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

/** 설치 메타 — 어떤 릴리스의 어떤 자산·어떤 저장소를 깔았는지. 없으면 "모르는 설치"로 본다. */
const META_NAME = '.vibisual-voice.json';

interface InstallMeta {
  engineVersion?: string;
  engineAsset?: string;
  modelRepo?: string;
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

/** 이 저장소의 네 조각이 **전부, 크기까지 맞게** 디스크에 있는가. */
export function modelFilesPresent(source: VoiceModelSource, dir: string): boolean {
  for (const f of source.files) {
    const target = path.join(dir, voiceModelDiskName(f.role));
    let st: fs.Stats;
    try {
      st = fs.statSync(target);
    } catch {
      return false;
    }
    // 크기를 대조하지 않으면 **반쪽 파일**을 설치 완료로 친다 — 그 상태에서 엔진은
    // "onnx 를 못 읽는다"로 죽고, 화면에는 원인이 아니라 결과만 뜬다.
    if (st.size !== f.sizeBytes) return false;
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
  const source = VOICE_MODEL_SOURCES.find((s) => s.repo === meta.modelRepo) ?? VOICE_MODEL_SOURCES[0];
  const modelOk = source !== undefined && modelFilesPresent(source, modelRoot);
  const engineOk = bin !== null;
  const state: VoiceAsrState = {
    engineInstalled: engineOk,
    modelInstalled: modelOk,
    ready: engineOk && modelOk,
    diskBytes: dirBytes(engineRoot) + dirBytes(modelRoot),
  };
  if (meta.engineVersion !== undefined) state.engineVersion = meta.engineVersion;
  if (modelOk && source !== undefined) state.modelRepo = source.repo;
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

  const source = VOICE_MODEL_SOURCES[0];
  if (!source) throw new Error('no voice model source');

  const engineRoot = voiceEngineDir();
  const modelRoot = voiceModelDir();
  const engineDone = findVoiceEngineBin(engineRoot) !== null;
  const modelBytes = voiceModelTotalBytes(source);

  const session: InstallSession = {
    installId: randomUUID(),
    stage: 'engine',
    receivedBytes: 0,
    totalBytes: 0,
    doneBytes: 0,
    // 엔진 자산 크기는 릴리스를 조회해야 알 수 있다. 조회 전에는 모델 몫만 잡아 두고,
    // 자산을 고른 뒤 총량을 늘린다(막대가 뒤로 가지 않도록 **늘리기만** 한다).
    grandTotalBytes: modelBytes,
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
        session.grandTotalBytes = modelBytes + assetBytes;
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
      setStage('model');
      await fsp.mkdir(modelRoot, { recursive: true });
      for (const f of source.files) {
        const dest = path.join(modelRoot, voiceModelDiskName(f.role));
        let have = 0;
        try {
          have = fs.statSync(dest).size;
        } catch {
          have = 0;
        }
        if (have === f.sizeBytes) {
          session.doneBytes += f.sizeBytes;
          session.receivedBytes = 0;
          pushProgress(true);
          continue;
        }
        session.item = f.file;
        session.receivedBytes = 0;
        session.totalBytes = f.sizeBytes;
        pushProgress(true);
        await downloadResumable(
          voiceModelFileUrl(source.repo, f.file),
          dest,
          f.sizeBytes,
          session.abort.signal,
          (received, total) => {
            session.receivedBytes = received;
            session.totalBytes = total;
            pushProgress();
          },
        );
        session.doneBytes += f.sizeBytes;
        session.receivedBytes = 0;
      }

      // ── 3) 검증 ──
      setStage('verifying');
      if (!modelFilesPresent(source, modelRoot)) throw new Error('model files incomplete after download');
      if (findVoiceEngineBin(engineRoot) === null) throw new Error('engine binary missing after install');
      writeMeta({ modelRepo: source.repo });
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
