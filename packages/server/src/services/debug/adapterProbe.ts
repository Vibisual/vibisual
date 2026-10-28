/**
 * §5.5 #17-20 ⑩ — 어댑터가 이 컴퓨터에 있는가 + 붙을 프로세스가 어느 pid 인가.
 * 둘 다 없으면 없다고 답한다(⑦ 외부 디버거 탐지와 같은 규율) — 화면이 "설치되어 있지 않음"을 적어야 버튼이 왜 안 먹는지 헤매지 않는다.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { DEBUG_ADAPTERS } from '@vibisual/shared';
import type { DebugBackendKind, RunRuntime } from '@vibisual/shared';

import { resolveBinary } from '../binLocator.js';

/** 외부 명령 조회는 짧게 — 없으면 없는 것이고, 오래 기다릴 이유가 없다. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * `available: false` 의 사유. 불리언만 주면 "안 깔았다"(설치 안내)와 "우리가 못 찾았다"(PATH 를 못 봤다)를 구분 못 해 안내문이 틀린다.
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
 * 어댑터 실행 파일의 절대경로(없으면 null). `where`/`which` 를 쓰지 마라 — Finder 로 띄운 macOS 앱의 최소 PATH 에서는 깔린 것도 "없음"이 된다.
 * `binLocator` 가 보강된 PATH + 알려진 위치를 본다.
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
 * 명령줄에 이 조각이 든 프로세스의 pid. `attach:'pid'` 런타임(.NET·Rust 등)은 pid 로 붙는데, PTY 로 띄우므로 우리 손의 pid 는 셸의 것이다 —
 * 실제 대상을 한 번 조회한다(§5.5 #17-20 ⑦-2 언리얼 에디터 pid 조회의 일반화).
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

/** 실행 명령에서 프로세스를 알아볼 조각 — 첫 파일 이름(`dotnet run --project Foo/Foo.csproj` → `foo.csproj`), 없으면 첫 토큰(`cargo run` → `cargo`). */
export function commandFingerprint(command: string): string {
  const tokens = command.split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('-'));
  const withExt = tokens.find((t) => /\.(csproj|sln|dll|exe|uproject|rs|py|js|ts|go)$/i.test(t));
  const picked = withExt ?? tokens[0] ?? '';
  return path.basename(picked);
}
