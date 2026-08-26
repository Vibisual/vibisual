/**
 * §5.5 #17-20 ⑩ v4.94 — 어댑터가 이 컴퓨터에 있는가 + 붙을 프로세스가 어느 pid 인가.
 *
 * 두 물음 모두 **없으면 없다고 답한다**(⑦ 외부 디버거 탐지와 같은 규율). 화면이 "설치되어
 * 있지 않음" 을 그 자리에 적어야 사용자가 "왜 이 버튼이 안 먹지" 로 헤매지 않는다.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { DEBUG_ADAPTERS } from '@vibisual/shared';
import type { DebugBackendKind, RunRuntime } from '@vibisual/shared';

import { resolveBinary } from '../binLocator.js';

/** 외부 명령 조회는 짧게 — 없으면 없는 것이고, 오래 기다릴 이유가 없다. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * `available: false` 의 사유. 불리언 하나만 주면 화면이 **"안 깔았다"와 "우리가 못 찾았다"를
 * 구분하지 못한다** — 앞은 설치 안내가 맞고, 뒤는 "PATH 를 못 봤다"는 우리 쪽 사정이라
 * 안내문이 달라야 한다(mac 에서 dlv/codelldb/debugpy 가 정확히 뒤쪽으로 오진됐다).
 *
 * - `not-installed` — 보강된 PATH + 알려진 설치 위치 어디에도 없다.
 * - `no-adapter`    — 이 런타임엔 붙일 어댑터 자체가 없다(언리얼 `delegated` 등).
 */
export type DebugAdapterUnavailableReason = 'not-installed' | 'no-adapter';

/** `GET /api/debug/adapters` 의 한 줄. */
export interface DebugAdapterAvailability {
  runtime: RunRuntime;
  backend: DebugBackendKind;
  /** 지금 이 컴퓨터에서 쓸 수 있는가(cdp 는 런타임 내장이라 늘 true). */
  available: boolean;
  /** 찾은 실행 파일 경로(있으면). */
  execPath?: string;
  /** `available: false` 일 때만. 화면이 안내문을 가르는 근거. */
  unavailableReason?: DebugAdapterUnavailableReason;
  licence: string;
  installKey: string;
  docsUrl: string;
}

/**
 * 어댑터 실행 파일의 절대경로 — 없으면 null.
 *
 * 종전엔 `where`/`which` 한 번이었다. 그 둘은 **우리 프로세스의 PATH** 만 보는데, Finder 로 띄운
 * macOS 앱의 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 넉 줄뿐이라 `~/go/bin/dlv`,
 * `~/.cargo/bin/codelldb`, Homebrew 의 `debugpy` 가 **깔려 있어도 전부 "없음"** 으로 나왔다.
 * `binLocator` 는 보강된 PATH + 알려진 설치 위치를 함께 본다.
 */
function resolveCommand(command: string): string | null {
  return resolveBinary(command);
}

/**
 * 표의 모든 줄을 훑어 "지금 쓸 수 있는지" 를 붙여 돌려준다.
 * `delegated`(언리얼)는 붙는 대상이 아니므로 목록에는 남기되 available=false 로 둔다.
 */
export function listDebugAdapters(): DebugAdapterAvailability[] {
  return DEBUG_ADAPTERS.map((spec) => {
    if (spec.backend === 'cdp') {
      return {
        runtime: spec.runtime,
        backend: spec.backend,
        available: true,
        licence: spec.licence,
        installKey: spec.installKey,
        docsUrl: spec.docsUrl,
      };
    }
    if (spec.backend === 'delegated' || !spec.adapter) {
      return {
        runtime: spec.runtime,
        backend: spec.backend,
        available: false,
        unavailableReason: 'no-adapter',
        licence: spec.licence,
        installKey: spec.installKey,
        docsUrl: spec.docsUrl,
      };
    }
    const execPath = resolveCommand(spec.adapter.command);
    return {
      runtime: spec.runtime,
      backend: spec.backend,
      available: !!execPath,
      ...(execPath ? { execPath } : { unavailableReason: 'not-installed' as const }),
      licence: spec.licence,
      installKey: spec.installKey,
      docsUrl: spec.docsUrl,
    };
  });
}

/**
 * 명령줄에 이 조각이 들어 있는 프로세스의 pid.
 *
 * `attach:'pid'` 런타임(.NET·Rust 등)은 포트가 아니라 pid 로 붙는데, 우리는 PTY 로 띄우므로
 * 우리 손의 pid 는 셸의 것이다 — 그래서 실제 대상 프로세스를 한 번 조회해야 한다.
 * (§5.5 #17-20 ⑦-2 언리얼 에디터 pid 조회와 같은 방법을 런타임 무관하게 일반화한 것.)
 */
export function findPidByCommandLine(needle: string): number | null {
  const target = needle.trim().toLowerCase();
  if (!target) return null;

  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      ).trim();
      if (!out) return null;
      const parsed: unknown = JSON.parse(out);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        const rec = row as { ProcessId?: unknown; CommandLine?: unknown };
        const pid = typeof rec.ProcessId === 'number' ? rec.ProcessId : null;
        const cmd = typeof rec.CommandLine === 'string' ? rec.CommandLine.toLowerCase() : '';
        // 우리 자신(조회 명령)과 셸은 걸리지 않게 — 조각이 파일명일 때가 대부분이라 충분하다.
        if (pid && pid !== process.pid && cmd.includes(target)) return pid;
      }
    } catch {
      /* 조회 실패 = 못 찾음 */
    }
    return null;
  }

  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceAt = trimmed.indexOf(' ');
      if (spaceAt < 0) continue;
      const pid = Number(trimmed.slice(0, spaceAt));
      const args = trimmed.slice(spaceAt + 1).toLowerCase();
      if (Number.isFinite(pid) && pid !== process.pid && args.includes(target)) return pid;
    }
  } catch {
    /* 조회 실패 = 못 찾음 */
  }
  return null;
}

/**
 * 실행 명령에서 "이 프로세스를 알아볼 조각" 을 고른다 — 첫 번째로 나오는 파일 이름
 * (`dotnet run --project Foo/Foo.csproj` → `foo.csproj`, `cargo run` → `cargo`).
 * 못 고르면 첫 토큰을 그대로 쓴다(그것이라도 있는 편이 없는 것보다 낫다).
 */
export function commandFingerprint(command: string): string {
  const tokens = command.split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('-'));
  const withExt = tokens.find((t) => /\.(csproj|sln|dll|exe|uproject|rs|py|js|ts|go)$/i.test(t));
  const picked = withExt ?? tokens[0] ?? '';
  return path.basename(picked);
}
