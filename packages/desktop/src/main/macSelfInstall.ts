/**
 * macOS `self-install` — 우리가 직접 받아 직접 교체한다. SCENARIO §4(자동 업데이트) 대체 항목.
 *
 * **왜 electron-updater 에게 맡기지 않는가.** 맥 백엔드인 Squirrel.Mac 은 코드 서명 검증을
 * **강제**해서, 무서명 빌드는 다운로드까지 성공한 뒤 적용 단계에서 반드시 실패한다. 그런데 그
 * 검증은 **Squirrel 의 적용 경로 안**에 있다 — 우리가 적용하면 그 코드가 아예 돌지 않는다.
 *
 * **왜 Gatekeeper 에 안 걸리는가.** 첫 실행 차단을 발동시키는 것은 서명 유무가 아니라
 * `com.apple.quarantine` **속성**이고, 그 속성은 **파일을 받은 프로그램이 붙인다**(브라우저는
 * 붙이고 CLI·Node 는 붙이지 않는다). 근거는 우리 저장소 안에 있다 — `.github/workflows/smoke.yml`
 * 은 사용자 상황을 재현하려고 quarantine 을 `xattr -w` 로 **손수 붙인다**(`gh release download`
 * 로 받은 dmg 에는 없어서 그냥 두면 재현이 안 된다). 우리가 받은 파일도 마찬가지로 깨끗하다.
 *
 * **무결성의 대가.** Squirrel 의 서명 검증이 빠진 자리를 GitHub 이 자산마다 주는
 * `digest`(sha256) 대조가 대신한다. 전송 중 손상·중간자는 막지만 **릴리스 자체가 바뀐 경우는
 * 못 막는다** — 서명이 막아 주던 것이 그것이라, 서명 슬롯(`MAC_CODE_SIGNED`)은 그대로 남는다.
 */

import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs, constants as FS } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MACHO_HEADER_PROBE_BYTES,
  isArchCompatible,
  macUpdateAssetName,
  readMachoArchs,
  type ProcessArch,
  type UpdateErrorCode,
} from '@vibisual/shared';

const execFileAsync = promisify(execFile);

const GITHUB_API_RELEASE = 'https://api.github.com/repos/Vibisual/vibisual/releases/tags';
/** 리다이렉트 상한. GitHub 자산은 objects.githubusercontent.com 으로 한 번 튄다. */
const MAX_REDIRECTS = 5;

export interface StagedUpdate {
  /** 임시 위치에 꺼내 둔 새 `.app` 번들 경로. */
  stagedAppPath: string;
  /** 지울 임시 작업 폴더(교체가 끝나면 통째로 삭제). */
  workDir: string;
  /** 교체 대상 — 지금 돌고 있는 `.app` 번들 경로. */
  targetAppPath: string;
  version: string;
}

export type SelfInstallPrep =
  | { ok: true; staged: StagedUpdate }
  | { ok: false; code: UpdateErrorCode; message: string };

/** 다운로드 진행 보고(퍼센트·속도) — `UpdateState` 로 그대로 흘러간다. */
export type ProgressFn = (percent: number, bytesPerSecond: number) => void;

/**
 * 지금 돌고 있는 `.app` 번들 경로.
 * `exePath` 는 `…/Vibisual.app/Contents/MacOS/Vibisual` 이므로 세 칸 위가 번들이다.
 * 번들 구조가 아니면(개발 실행 등) null.
 */
export function resolveBundlePath(exePath: string): string | null {
  const bundle = path.resolve(exePath, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

/** GitHub 릴리스에서 이 아키텍처의 dmg 자산 정보를 찾는다. */
async function findAsset(
  version: string,
  arch: ProcessArch,
): Promise<{ url: string; sha256: string | null; name: string } | { error: string }> {
  const want = macUpdateAssetName(version, arch);
  const res = await fetch(`${GITHUB_API_RELEASE}/v${version.replace(/^v/, '')}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vibisual-updater' },
  });
  if (!res.ok) return { error: `release lookup failed (HTTP ${res.status})` };
  const body = (await res.json()) as { assets?: Array<{ name: string; browser_download_url: string; digest?: string }> };
  const asset = (body.assets ?? []).find((a) => a.name === want);
  // 이 릴리스에 **내 아키텍처 파일이 없는** 경우를 여기서 잡는다. 다른 파일로 대신 받지 않는다 —
  // 그것이 정확히 Apple Silicon 에 Intel 빌드를 까는 길이다.
  if (!asset) return { error: `${want} is not in release v${version} (this architecture was not published)` };
  const digest = asset.digest ?? '';
  return {
    url: asset.browser_download_url,
    sha256: digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : null,
    name: asset.name,
  };
}

/** 진행률을 보고하며 파일을 받고, 받은 내용의 sha256 을 돌려준다. */
function download(url: string, dest: string, onProgress?: ProgressFn): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let received = 0;
    let total = 0;
    const startedAt = Date.now();
    let lastReport = 0;

    const go = (target: string, redirects: number): void => {
      if (redirects > MAX_REDIRECTS) {
        reject(new Error('too many redirects'));
        return;
      }
      https
        .get(target, { headers: { 'User-Agent': 'vibisual-updater' } }, (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume(); // 본문을 흘려보내야 소켓이 풀린다
            go(new URL(res.headers.location, target).toString(), redirects + 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`HTTP ${status}`));
            return;
          }
          total = Number(res.headers['content-length'] ?? 0);
          const out = createWriteStream(dest);
          res.on('data', (chunk: Buffer) => {
            hash.update(chunk);
            received += chunk.length;
            // 보고는 300ms 에 한 번 — 매 청크마다 전 창에 broadcast 하면 그것만으로 UI 가 밀린다.
            const now = Date.now();
            if (onProgress && now - lastReport >= 300) {
              lastReport = now;
              const secs = Math.max(0.001, (now - startedAt) / 1000);
              onProgress(total > 0 ? Math.round((received / total) * 100) : 0, Math.round(received / secs));
            }
          });
          res.pipe(out);
          out.on('error', reject);
          out.on('finish', () => {
            out.close(() => {
              if (total > 0 && received !== total) {
                reject(new Error(`truncated download (${received}/${total} bytes)`));
                return;
              }
              resolve(hash.digest('hex'));
            });
          });
        })
        .on('error', reject);
    };

    go(url, 0);
  });
}

/** `hdiutil attach` 출력에서 마운트 지점을 뽑는다. 탭으로 갈린 마지막 칸이 경로다. */
export function parseMountPoint(hdiutilStdout: string): string | null {
  for (const line of hdiutilStdout.split('\n')) {
    const idx = line.indexOf('/Volumes/');
    if (idx !== -1) return line.slice(idx).trim();
  }
  return null;
}

/**
 * 새 버전을 받아 검사하고 임시 위치에 꺼내 둔다. **교체는 하지 않는다** —
 * 여기서 실패하면 앱은 종전 버전 그대로 산다.
 */
export async function prepareSelfInstall(opts: {
  version: string;
  arch: ProcessArch;
  exePath: string;
  onProgress?: ProgressFn;
}): Promise<SelfInstallPrep> {
  const { version, arch, exePath, onProgress } = opts;

  const targetAppPath = resolveBundlePath(exePath);
  if (!targetAppPath) {
    return { ok: false, code: 'install-failed', message: `not an .app bundle: ${exePath}` };
  }

  // 교체는 부모 폴더에서 rename 두 번으로 한다 — 그 폴더에 쓸 수 없으면 시작할 이유가 없다.
  // 170MB 를 받은 **뒤에** 권한이 없다고 알리는 것은 사용자 시간을 버리는 것이다.
  const parent = path.dirname(targetAppPath);
  try {
    await fs.access(parent, FS.W_OK);
  } catch {
    return { ok: false, code: 'not-writable', message: `no write permission: ${parent}` };
  }

  const found = await findAsset(version, arch);
  if ('error' in found) return { ok: false, code: 'download-failed', message: found.error };

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibisual-update-'));
  const dmgPath = path.join(workDir, found.name);
  let mountPoint: string | null = null;

  const cleanup = async (): Promise<void> => {
    if (mountPoint) {
      // 떼지 못한 채 남기면 다음 시도가 같은 자리에서 막힌다(release.yml 의 hdiutil 항목과 같은 뿌리).
      await execFileAsync('hdiutil', ['detach', '-force', mountPoint]).catch(() => undefined);
    }
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const actual = await download(found.url, dmgPath, onProgress);

    if (found.sha256 && actual.toLowerCase() !== found.sha256.toLowerCase()) {
      await cleanup();
      return {
        ok: false,
        code: 'checksum-mismatch',
        message: `sha256 mismatch: expected ${found.sha256}, got ${actual}`,
      };
    }

    const { stdout } = await execFileAsync('hdiutil', [
      'attach',
      '-nobrowse',
      '-readonly',
      '-noverify',
      dmgPath,
    ]);
    mountPoint = parseMountPoint(stdout);
    if (!mountPoint) {
      await cleanup();
      return { ok: false, code: 'mount-failed', message: `no mount point in hdiutil output: ${stdout.trim()}` };
    }

    const entries = await fs.readdir(mountPoint);
    const appName = entries.find((e) => e.endsWith('.app'));
    if (!appName) {
      await cleanup();
      return { ok: false, code: 'mount-failed', message: `no .app inside ${mountPoint}` };
    }
    const mountedApp = path.join(mountPoint, appName);

    // ── 아키텍처 안전장치 ────────────────────────────────────────────────
    // 파일 이름도 피드도 믿지 않는다. 번들 안 실행본의 Mach-O 헤더를 직접 읽는다.
    const execName = path.basename(appName, '.app');
    const machoPath = path.join(mountedApp, 'Contents', 'MacOS', execName);
    let head: Buffer;
    try {
      const fh = await fs.open(machoPath, 'r');
      try {
        const buf = Buffer.alloc(MACHO_HEADER_PROBE_BYTES);
        const { bytesRead } = await fh.read(buf, 0, MACHO_HEADER_PROBE_BYTES, 0);
        head = buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch (err) {
      await cleanup();
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: 'arch-mismatch', message: `cannot read ${machoPath}: ${message}` };
    }

    const archs = readMachoArchs(head);
    if (!isArchCompatible(archs, arch)) {
      await cleanup();
      return {
        ok: false,
        code: 'arch-mismatch',
        // 사용자에게 보이는 문구는 i18n 이 고르고, 이 원문은 진단 로그로 간다.
        message: `downloaded bundle is [${archs.join(', ') || 'unreadable'}] but this app runs ${arch}`,
      };
    }

    // 마운트된 볼륨은 곧 떼므로 여기서 임시 폴더로 꺼내 둔다.
    // `ditto` 를 쓰는 이유: 번들의 심볼릭 링크·확장 속성·권한을 그대로 옮긴다(`cp -R` 은 어긋난다).
    const stagedAppPath = path.join(workDir, appName);
    await execFileAsync('ditto', [mountedApp, stagedAppPath]);

    await execFileAsync('hdiutil', ['detach', mountPoint]).catch(async () => {
      await execFileAsync('hdiutil', ['detach', '-force', mountPoint as string]).catch(() => undefined);
    });
    mountPoint = null;

    // dmg 자체는 더 필요 없다 — 170MB 를 교체가 끝날 때까지 들고 있을 이유가 없다.
    await fs.rm(dmgPath, { force: true }).catch(() => undefined);

    return { ok: true, staged: { stagedAppPath, workDir, targetAppPath, version } };
  } catch (err) {
    await cleanup();
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, code: 'download-failed', message };
  }
}

/**
 * 꺼내 둔 번들로 **지금 교체**한다. 종료 정리를 마치고 `app.exit()` 직전에 한 번만 부른다.
 *
 * ⚠️ **살아 있는 자기 자신을 덮어쓰지 않는다.** 분리된 셸을 띄워 우리 pid 가 사라지기를
 * 기다린 뒤 교체하게 한다 — Windows 가 NSIS 설치기를 spawn 하고 빠지는 것과 같은 구조다.
 * 교체는 부모 폴더 안에서 rename 두 번으로 하고, 실패하면 **원래 번들을 되돌린다**
 * (교체 도중 죽어서 앱이 통째로 사라지는 것이 가장 나쁘다).
 */
export function runSwap(staged: StagedUpdate, pid: number): boolean {
  const script = [
    '#!/bin/sh',
    'set -u',
    'TARGET="$1"; STAGED="$2"; WORK="$3"; PID="$4"',
    '# ① 우리 프로세스가 실제로 사라질 때까지 기다린다(최대 60초).',
    'i=0',
    'while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done',
    'sleep 0.5',
    '# ② 같은 폴더에 새 번들을 먼저 놓는다 — 교체 창을 rename 두 번으로 줄인다.',
    'NEW="$TARGET.new"',
    'rm -rf "$NEW" "$TARGET.old"',
    'if ! ditto "$STAGED" "$NEW"; then rm -rf "$NEW"; rm -rf "$WORK"; open "$TARGET"; exit 1; fi',
    '# ③ 혹시 모를 격리 속성 제거(우리가 받았으므로 원래 없다 — 방어적).',
    'xattr -cr "$NEW" 2>/dev/null || true',
    '# ④ 두 번의 rename. 두 번째가 실패하면 원래 것을 되돌린다.',
    'if ! mv "$TARGET" "$TARGET.old"; then rm -rf "$NEW"; rm -rf "$WORK"; open "$TARGET"; exit 1; fi',
    'if ! mv "$NEW" "$TARGET"; then mv "$TARGET.old" "$TARGET"; rm -rf "$NEW" "$WORK"; open "$TARGET"; exit 1; fi',
    'rm -rf "$TARGET.old" "$WORK"',
    '# ⑤ 새 버전으로 되살린다.',
    'open "$TARGET"',
  ].join('\n');

  try {
    const child = spawn('/bin/sh', ['-c', script, 'sh', staged.targetAppPath, staged.stagedAppPath, staged.workDir, String(pid)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
