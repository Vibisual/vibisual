/**
 * 바깥 브라우저 열기 + 실패 안내 (§3.7).
 *
 * 앱 안의 모든 "브라우저로 열기"는 여기 한 곳을 지난다 — renderer 의
 * `window.open(url,'_blank')` → `setWindowOpenHandler` → 이 함수. 여는 길 자체는
 * 종전 그대로 `shell.openExternal` 하나이고(새 여는 길 ❌), 이 파일이 더하는 것은
 * **실패했을 때 그 사실을 화면에 알리는 것뿐**이다.
 *
 * ⚠️ **폴백은 없다(사용자 명시 결정).** WSL interop(`explorer.exe`)·`wslview`·다른
 * 브라우저를 대신 띄우지 않는다. 우리가 임의로 고른 창에 OAuth 주소를 넘기는 것은
 * 사용자가 그은 선이 아니고, 그 경로는 실기 검증도 불가능하다. 우리 몫은 "안 열렸다"를
 * 말하는 것까지다. 이 주석을 지우고 폴백을 되살리지 마라.
 *
 * ⚠️ 리눅스에서는 `shell.openExternal` 의 프라미스가 거짓말을 한다 — Electron 이
 * `xdg-open` 을 종료를 기다리지 않고 띄우기 때문에 브라우저가 하나도 없어도 2ms 만에
 * resolve 한다(실측 근거는 `@vibisual/shared` 의 `externalOpen.ts` 머리말). 그래서
 * 리눅스에서만 **열어 줄 프로그램이 있는지**를 따로 잰다.
 */

import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserWindow, shell, type WebContents } from 'electron';
import {
  LINUX_BROWSER_BINARIES,
  needsBrowserProbe,
  resolveExternalOpenNotice,
  type ExternalOpenFailure,
  type LinuxBrowserProbe,
} from '@vibisual/shared';

/** main → renderer 실패 알림 채널. preload 의 `externalOpen.onFailed` 와 **짝**이다. */
export const EXTERNAL_OPEN_FAILED_CHANNEL = 'vibisual:external-open-failed';

/** 탐침 결과 캐시 수명. 링크 클릭은 사람 속도라 이 정도면 spawn 이 몰리지 않는다. */
const PROBE_TTL_MS = 30_000;
/** 탐침 명령 상한 — 응답 없는 xdg-mime 하나가 안내를 영영 막지 않게. */
const PROBE_TIMEOUT_MS = 2_000;

let cachedProbe: { at: number; value: LinuxBrowserProbe } | null = null;
let inFlightProbe: Promise<LinuxBrowserProbe> | null = null;

/** PATH 에서 실행 가능한 파일을 찾는다 — **spawn 하지 않는다**(읽기 전용 탐침 규약). */
function resolveOnPath(command: string): string | null {
  const name = command.trim();
  if (!name) return null;
  if (isAbsolute(name)) {
    try {
      accessSync(name, fsConstants.X_OK);
      return name;
    } catch {
      return null;
    }
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // 다음 후보로.
    }
  }
  return null;
}

/**
 * `$BROWSER` 에 적힌 명령 중 실제로 풀리는 것들.
 * xdg-open 과 같은 규약으로 읽는다 — `:` 로 나뉜 목록이고 각 항목은 `%s` 자리표시자를 가질 수 있다.
 */
function resolveBrowserEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  const resolved: string[] = [];
  for (const entry of raw.split(':')) {
    const command = entry.trim().split(/\s+/)[0]?.replace(/%s/g, '');
    if (!command) continue;
    const found = resolveOnPath(command);
    if (found) resolved.push(found);
  }
  return resolved;
}

/** `xdg-mime query default x-scheme-handler/https` — 출력만 본다(종료코드는 근거가 아니다). */
function queryHttpsSchemeHandler(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'xdg-mime',
      ['query', 'default', 'x-scheme-handler/https'],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        // 명령 자체가 없으면(xdg-utils 미설치) 그냥 "모름"으로 두고 나머지 두 근거에 맡긴다.
        if (error && !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout ?? null);
      },
    );
  });
}

/** 리눅스 탐침 — 아무것도 실행하지 않고 "열어 줄 프로그램이 있나"만 읽는다. */
async function probeLinuxBrowser(): Promise<LinuxBrowserProbe> {
  const now = Date.now();
  if (cachedProbe && now - cachedProbe.at < PROBE_TTL_MS) return cachedProbe.value;
  if (inFlightProbe) return inFlightProbe;

  inFlightProbe = (async (): Promise<LinuxBrowserProbe> => {
    const binariesOnPath: string[] = [];
    for (const bin of LINUX_BROWSER_BINARIES) {
      const found = resolveOnPath(bin);
      if (found) binariesOnPath.push(found);
    }
    const value: LinuxBrowserProbe = {
      browserEnvResolved: resolveBrowserEnv(process.env.BROWSER),
      schemeHandler: await queryHttpsSchemeHandler(),
      binariesOnPath,
    };
    cachedProbe = { at: Date.now(), value };
    return value;
  })().finally(() => {
    inFlightProbe = null;
  });

  return inFlightProbe;
}

function notifyFailure(sender: WebContents | null | undefined, payload: ExternalOpenFailure): void {
  if (sender && !sender.isDestroyed()) {
    sender.send(EXTERNAL_OPEN_FAILED_CHANNEL, payload);
    return;
  }
  // 누가 눌렀는지 모르면 전 창에 알린다(`vibisual:update:status` 와 같은 규약).
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EXTERNAL_OPEN_FAILED_CHANNEL, payload);
  }
}

/**
 * 바깥 브라우저로 연다. 실패하면 그 사실을 `sender` 창에 알린다(폴백 ❌).
 *
 * **열기는 판정과 무관하게 항상 시도한다** — 탐침이 틀렸을 때(스냅·플랫팩 등 우리가
 * 못 보는 핸들러) 되던 열기를 우리 손으로 막는 쪽이 훨씬 나쁘다. 최악의 경우는
 * "열렸는데 안내도 떴다"이고, 그건 무해하다.
 */
export function openExternalWithNotice(
  url: string,
  sender?: WebContents | null,
  /** 화면 안내와 **별개로** 남길 기록이 있는 호출부(예: 업데이터 진단)를 위한 선택 훅. */
  onFailure?: (payload: ExternalOpenFailure) => void,
): void {
  let openRejected = false;
  void shell
    .openExternal(url)
    .catch((err: unknown) => {
      openRejected = true;
      console.warn('[externalOpen] openExternal failed:', err instanceof Error ? err.message : String(err));
    })
    .then(async () => {
      const linuxProbe = needsBrowserProbe(process.platform) ? await probeLinuxBrowser() : null;
      const reason = resolveExternalOpenNotice({
        platform: process.platform,
        openRejected,
        linuxProbe,
      });
      if (!reason) return;
      console.warn(`[externalOpen] ${reason} — ${url}`);
      const payload: ExternalOpenFailure = { url, reason };
      notifyFailure(sender, payload);
      onFailure?.(payload);
    })
    .catch((err: unknown) => {
      // 안내 경로가 죽어도 열기 자체는 이미 시도됐다 — 조용히 넘긴다.
      console.warn('[externalOpen] notice path failed:', err instanceof Error ? err.message : String(err));
    });
}
