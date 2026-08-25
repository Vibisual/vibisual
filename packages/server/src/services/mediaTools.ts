/**
 * mediaTools.ts — §5.13 (R-8) (e) **변환기(ffmpeg)를 찾고, 없으면 설치를 대행한다.**
 *
 * 우리는 ffmpeg 을 **배포하지 않는다.** 실측한 두 이유 때문이다 — `@ffmpeg/core`(wasm)는 64.7MB 에
 * GPL-2.0-or-later 라 동봉하면 라이선스가 앱 전체로 번지고, 정적 빌드는 `ffmpeg.exe` 하나가 223MB 다.
 * 대신 **이미 있으면 쓰고, 없으면 사용자가 누를 때만** 표준 설치 경로(winget·brew)로 깔아 준다.
 *
 * "코덱을 받는다"가 아니라 "변환기를 받는다"는 점이 이 파일의 전제다(§5.13 (R-8) (a)) — Chromium 은
 * 시스템 코덱을 쓰지 않으므로 코덱팩을 깔아도 우리 창에서는 아무 일도 일어나지 않는다.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MediaToolsInfo } from '@vibisual/shared';

import { logger } from '../logger.js';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** 실행 파일 이름 — 윈도우만 확장자가 붙는다. */
function binName(base: string): string {
  return IS_WIN ? `${base}.exe` : base;
}

/**
 * PATH 에서 찾는다. `where`/`which` 는 여러 줄을 낼 수 있어 **첫 줄만** 쓴다.
 * 셸을 거치지 않으므로(execFile) 경로에 공백이 있어도 안전하다.
 */
function fromPath(base: string): string | null {
  try {
    const out = execFileSync(IS_WIN ? 'where.exe' : 'which', [base], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

/**
 * PATH 에 없을 때 훑는 자리들.
 *
 * winget 으로 깔면 링크가 PATH 에 잡히기까지 셸 재시작이 필요할 수 있어(설치 직후가 정확히 그 상황),
 * 패키지 폴더를 직접 본다 — "깔았는데 못 찾는다"가 가장 나쁜 실패다.
 */
function knownLocations(base: string): string[] {
  const home = os.homedir();
  const name = binName(base);
  if (IS_WIN) {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    const wingetPackages = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    const found: string[] = [
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', name),
      path.join('C:', 'ffmpeg', 'bin', name),
      path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'ffmpeg', 'bin', name),
    ];
    // winget 패키지 폴더는 `Gyan.FFmpeg_…/ffmpeg-8.1-full_build/bin/ffmpeg.exe` 처럼 한 겹 더 들어간다.
    try {
      for (const entry of fs.readdirSync(wingetPackages, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/ffmpeg/i.test(entry.name)) continue;
        const pkgDir = path.join(wingetPackages, entry.name);
        for (const inner of fs.readdirSync(pkgDir, { withFileTypes: true })) {
          if (inner.isDirectory()) found.push(path.join(pkgDir, inner.name, 'bin', name));
        }
        found.push(path.join(pkgDir, 'bin', name));
      }
    } catch {
      /* winget 을 안 쓰는 PC — 그냥 넘어간다 */
    }
    return found;
  }
  return [
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
    '/usr/bin/' + name,
    path.join(home, '.local', 'bin', name),
  ];
}

function resolveBinary(base: string): string | null {
  const onPath = fromPath(base);
  if (onPath && fs.existsSync(onPath)) return onPath;
  for (const candidate of knownLocations(base)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* 접근 불가 — 다음 후보 */
    }
  }
  return null;
}

/** `ffmpeg -version` 첫 줄에서 판올림만 뽑는다. 실패하면 null(있다는 사실은 경로가 이미 말했다). */
function readVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/)[0] ?? '';
    const m = /ffmpeg version (\S+)/i.exec(first);
    return m?.[1] ?? (first.slice(0, 60) || null);
  } catch {
    return null;
  }
}

/**
 * 탐지 결과 캐시.
 *
 * 매번 PATH 를 훑으면 파일 하나 열 때마다 프로세스가 두 번 뜬다. 값이 바뀔 수 있는 자리는
 * **설치를 마쳤을 때 하나뿐**이므로 그때만 버린다(§4 `claudeBin` 지연 캐시와 같은 규율).
 */
let cached: MediaToolsInfo | null = null;

export function invalidateMediaToolsCache(): void {
  cached = null;
}

/** 이 PC 의 변환기 상태. `force` 면 캐시를 무시하고 다시 훑는다. */
export function detectMediaTools(force = false): MediaToolsInfo {
  if (cached && !force) return cached;

  const ffmpegPath = resolveBinary('ffmpeg');
  const ffprobePath = resolveBinary('ffprobe');
  const info: MediaToolsInfo = {
    available: ffmpegPath !== null,
    ffmpegPath,
    ffprobePath,
    version: ffmpegPath ? readVersion(ffmpegPath) : null,
    // 설치를 대행할 수 있는 표준 경로가 이 OS 에 있는가. 없으면 화면은 공식 페이지를 안내한다.
    installer: IS_WIN ? 'winget' : IS_MAC ? 'brew' : null,
  };
  cached = info;
  return info;
}

/**
 * 변환기를 설치한다. **사용자가 [설치] 를 눌렀을 때만** 불린다 — 조용히 무언가를 내려받지 않는다.
 *
 * 우리가 바이너리를 나르지 않고 그 OS 의 표준 패키지 관리자에게 맡기는 이유는 (e) 의 라이선스·용량
 * 판단 그대로다. 설치가 끝나면 캐시를 버리고 다시 훑어 "이제 됩니다"를 그 자리에서 답한다.
 */
export async function installMediaTools(): Promise<{ ok: boolean; message: string; info: MediaToolsInfo }> {
  const installer = detectMediaTools().installer;
  if (installer === null) {
    return { ok: false, message: 'no-installer', info: detectMediaTools(true) };
  }

  const [cmd, args] =
    installer === 'winget'
      ? ['winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']]
      : ['brew', ['install', 'ffmpeg']];

  logger.info(`[media-tools] 변환기 설치 시작: ${cmd} ${args.join(' ')}`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = '';
    const keep = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-2000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', (err) => {
      logger.warn(`[media-tools] 설치 실패: ${err.message}`);
      resolve(-1);
    });
    child.on('close', (c) => {
      if (c !== 0) logger.warn(`[media-tools] 설치가 코드 ${String(c)} 로 끝났습니다: ${tail.slice(-400)}`);
      resolve(c ?? -1);
    });
  });

  invalidateMediaToolsCache();
  const info = detectMediaTools(true);
  // 설치 명령이 0 이 아니어도 **실제로 깔렸으면 성공**이다(winget 은 이미 설치돼 있을 때도 0 이 아닌 코드를 낸다).
  const ok = info.available;
  return { ok, message: ok ? 'installed' : `exit ${String(code)}`, info };
}
