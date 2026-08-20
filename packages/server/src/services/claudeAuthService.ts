import { spawn } from 'node:child_process';
import {
  CLAUDE_AUTH_PROBE_TIMEOUT_MS,
  CLAUDE_AUTH_LOGOUT_TIMEOUT_MS,
} from '@vibisual/shared';
import type { ClaudeAuthStatus, ClaudeAuthProbeError } from '@vibisual/shared';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { logger } from '../logger.js';

/**
 * §4 v4.82 — 앱 안 Claude 로그인. 상태 판정 · 로그아웃의 서버 창구.
 *
 * **자격증명은 우리가 읽지도 쓰지도 않는다.** 판정은 `claude auth status --json`, 로그아웃은
 * `claude auth logout` 으로 전부 CLI 에 위임한다(§4 v3.62 사용량 조회가 세운 "토큰 파일은 읽기
 * 전용" 원칙보다 한 걸음 더 — 여기선 읽지도 않는다). 로그인은 브라우저 왕복이 필요한 인터랙션
 * 이라 서버가 아니라 임베디드 PTY(desktop terminalManager, §4 v2.63 · §5.5 #17-20 ④ v4.74 실행
 * 런처)에서 돌고, 그 성패는 다시 이 서비스의 재조회로 확인한다.
 *
 * `error` 가 있는 상태는 "로그아웃"이 아니라 **"모름"** 이다 — CLI 를 못 찾거나 응답이 없을 때
 * 로그인 팝업을 띄우면 멀쩡히 일하던 사용자를 모달로 막게 되므로, 클라는 `error` 가 없을 때만
 * 팝업을 연다.
 */

/** `claude auth status --json` 원문 → ClaudeAuthStatus. 형식이 다르면 null(파싱 실패). */
export function parseAuthStatus(raw: string, now: number): ClaudeAuthStatus | null {
  // CLI 가 배너/경고를 앞에 찍을 수 있어 첫 `{` 부터 마지막 `}` 까지만 떼어 파싱한다.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o['loggedIn'] !== 'boolean') return null;

  const str = (key: string): string | undefined =>
    typeof o[key] === 'string' && (o[key] as string).length > 0 ? (o[key] as string) : undefined;

  return {
    loggedIn: o['loggedIn'],
    ...(str('authMethod') ? { authMethod: str('authMethod') } : {}),
    ...(str('apiProvider') ? { apiProvider: str('apiProvider') } : {}),
    ...(str('email') ? { email: str('email') } : {}),
    ...(str('orgId') ? { orgId: str('orgId') } : {}),
    ...(str('orgName') ? { orgName: str('orgName') } : {}),
    ...(str('subscriptionType') ? { subscriptionType: str('subscriptionType') } : {}),
    checkedAt: now,
  };
}

interface RunResult {
  code: number | null;
  out: string;
  /** spawn 자체가 실패했거나(바이너리 없음) 타임아웃으로 죽였을 때. */
  failure?: 'spawn' | 'timeout';
}

/** claude 하위명령 1회 실행 — stdout+stderr 합본. 실패해도 throw 하지 않는다. */
function runClaude(args: string[], timeoutMs: number): Promise<RunResult> {
  let binPath: string | undefined;
  try {
    binPath = getClaudeBin()?.binPath;
  } catch {
    /* PATH 미발견 */
  }
  if (!binPath) return Promise.resolve({ code: null, out: '', failure: 'spawn' });

  return new Promise<RunResult>((resolve) => {
    let done = false;
    let out = '';
    const finish = (r: RunResult): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binPath, args, {
        // Windows 의 claude 는 보통 `claude.cmd` shim 이라 셸 경유가 필요하다(terminalManager 주석과 동일 사유).
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return finish({ code: null, out: '', failure: 'spawn' });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ code: null, out, failure: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (c) => {
      out += String(c);
    });
    child.stderr?.on('data', (c) => {
      out += String(c);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      noteClaudeSpawnFailure(err);
      finish({ code: null, out, failure: 'spawn' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, out });
    });
  });
}

function unknownStatus(error: ClaudeAuthProbeError): ClaudeAuthStatus {
  return { loggedIn: false, error, checkedAt: Date.now() };
}

class ClaudeAuthService {
  private cached: ClaudeAuthStatus | null = null;
  /** 동시 호출 합류 — 폴링·REST·로그인 팝업이 겹쳐도 CLI 는 한 번만 돈다. */
  private inflight: Promise<ClaudeAuthStatus> | null = null;

  get(): ClaudeAuthStatus | null {
    return this.cached;
  }

  /** `claude auth status --json` 재조회. 실패해도 throw 하지 않고 error 가 실린 상태를 준다. */
  async refresh(): Promise<ClaudeAuthStatus> {
    if (this.inflight) return this.inflight;
    this.inflight = this.probe().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async probe(): Promise<ClaudeAuthStatus> {
    const res = await runClaude(['auth', 'status', '--json'], CLAUDE_AUTH_PROBE_TIMEOUT_MS);
    if (res.failure === 'spawn') {
      this.cached = unknownStatus('cli-missing');
      return this.cached;
    }
    if (res.failure === 'timeout') {
      this.cached = unknownStatus('timeout');
      return this.cached;
    }
    const parsed = parseAuthStatus(res.out, Date.now());
    if (!parsed) {
      // 구버전 CLI 라 `auth` 하위명령 자체가 없을 수도 있다 — 그때도 "모름"이지 로그아웃이 아니다.
      logger.warn(`[claudeAuth] status parse failed (exit=${String(res.code)}): ${res.out.slice(0, 200)}`);
      this.cached = unknownStatus('parse');
      return this.cached;
    }
    this.cached = parsed;
    return parsed;
  }

  /**
   * `claude auth logout` 실행 후 상태 재조회.
   *
   * 사용자가 옵션창에서 명시적으로 누른 경우에만 호출된다(확인 1회 후). 로그아웃 자체가 실패해도
   * 재조회한 현재 상태를 그대로 돌려준다 — 화면이 실제 상태와 어긋나지 않게.
   */
  async logout(): Promise<{ ok: boolean; status: ClaudeAuthStatus; error?: string }> {
    const res = await runClaude(['auth', 'logout'], CLAUDE_AUTH_LOGOUT_TIMEOUT_MS);
    const status = await this.refresh();
    if (res.failure || (res.code !== null && res.code !== 0)) {
      const detail = res.failure ?? `exit ${String(res.code)}`;
      logger.warn(`[claudeAuth] logout failed (${detail}): ${res.out.slice(0, 200)}`);
      // CLI 가 실패해도 상태가 로그아웃이면 성공으로 본다(이미 로그아웃돼 있던 경우 등).
      return status.loggedIn
        ? { ok: false, status, error: res.out.trim().slice(0, 300) || detail }
        : { ok: true, status };
    }
    return { ok: true, status };
  }
}

export const claudeAuthService = new ClaudeAuthService();
