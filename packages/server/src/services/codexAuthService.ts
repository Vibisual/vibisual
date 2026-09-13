import { CODEX_AUTH_PROBE_TIMEOUT_MS, CODEX_AUTH_LOGOUT_TIMEOUT_MS } from '@vibisual/shared';
import type { CodexAuthStatus, CodexAuthProbeError } from '@vibisual/shared';
import { runCodexCli } from './codexCli.js';
import { logger } from '../logger.js';

/**
 * §5.25 (E) — 코덱스 로그인 상태 판정 · 로그아웃의 서버 창구.
 *
 * **자격증명은 우리가 읽지도 쓰지도 않는다.** 판정은 `codex login status` 한 줄이 전부이고,
 * 코덱스 홈의 `auth.json` 을 우리가 여는 일은 없다(클로드 쪽 `claudeAuthService` 와 같은 규칙 —
 * 그쪽이 세운 "토큰 파일은 읽기 전용"보다 한 걸음 더).
 *
 * 로그인 자체는 브라우저 왕복이나 기기 코드 입력이 필요한 인터랙션이라 서버가 아니라 임베디드
 * PTY 에서 돌고(§5.25 (E) — `LoginWindow` 가 클로드에 대해 이미 하는 일), 그 성패는 다시 이
 * 서비스의 재조회로 확인한다.
 *
 * `error` 가 있는 상태는 "로그아웃"이 아니라 **"모름"** 이다 — CLI 를 못 찾거나 응답이 없을 때
 * 로그인 창을 띄우면 멀쩡히 일하던 사용자를 모달로 막게 된다.
 */

/** CLI 가 로그아웃을 말할 때 쓰는 표현. 이 중 하나라도 있으면 확실한 로그아웃이다. */
const LOGGED_OUT_HINTS = ['not logged in', 'no credentials', 'please run', 'run `codex login`'];

/**
 * `codex login status` 원문 → `CodexAuthStatus`. 형식을 못 알아보면 null(파싱 실패).
 *
 * **못 알아본 것을 로그아웃으로 적지 않는다** — CLI 가 문구를 바꾼 날 멀쩡한 사용자에게
 * 로그인 창이 뜨는 것이 더 나쁜 실패이기 때문이다(클로드 쪽과 같은 판단).
 */
export function parseCodexLoginStatus(raw: string, code: number | null, now: number): CodexAuthStatus | null {
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (LOGGED_OUT_HINTS.some((h) => lower.includes(h))) {
    return { loggedIn: false, checkedAt: now };
  }

  if (lower.includes('logged in')) {
    const status: CodexAuthStatus = { loggedIn: true, checkedAt: now };
    // "Logged in using ChatGPT" / "Logged in using an API key" — CLI 표현을 우리 두 값으로만 좁힌다.
    if (lower.includes('api key')) status.authMethod = 'apiKey';
    else if (lower.includes('chatgpt')) status.authMethod = 'chatgpt';
    // 계정/이메일을 함께 말해 주면 표시용으로 싣는다(없어도 정상).
    const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text);
    if (email) status.account = email[0];
    return status;
  }

  // exit code 가 실패인데 문구도 못 알아보면 "모름"이다 — 여기서 로그아웃으로 단정하지 않는다.
  if (code !== null && code !== 0) return null;
  return null;
}

function unknownStatus(error: CodexAuthProbeError): CodexAuthStatus {
  return { loggedIn: false, error, checkedAt: Date.now() };
}

class CodexAuthService {
  private cached: CodexAuthStatus | null = null;
  /** 동시 호출 합류 — 폴링·REST·로그인 창이 겹쳐도 CLI 는 한 번만 돈다. */
  private inflight: Promise<CodexAuthStatus> | null = null;

  get(): CodexAuthStatus | null {
    return this.cached;
  }

  async refresh(): Promise<CodexAuthStatus> {
    if (this.inflight) return this.inflight;
    this.inflight = this.probe().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async probe(): Promise<CodexAuthStatus> {
    const res = await runCodexCli(['login', 'status'], CODEX_AUTH_PROBE_TIMEOUT_MS);
    if (res.failure === 'spawn') {
      this.cached = unknownStatus('cli-missing');
      return this.cached;
    }
    if (res.failure === 'timeout') {
      this.cached = unknownStatus('timeout');
      return this.cached;
    }
    const parsed = parseCodexLoginStatus(res.out, res.code, Date.now());
    if (!parsed) {
      logger.warn(`[codexAuth] status parse failed (exit=${String(res.code)}): ${res.out.slice(0, 200)}`);
      this.cached = unknownStatus('parse');
      return this.cached;
    }
    this.cached = parsed;
    return parsed;
  }

  /**
   * `codex logout` 실행 후 상태 재조회.
   *
   * 사용자가 옵션창에서 명시적으로 누른 경우에만 호출된다. CLI 가 실패해도 재조회한 현재 상태를
   * 그대로 돌려준다 — 화면이 실제 상태와 어긋나지 않게(클로드 쪽과 같은 규칙).
   */
  async logout(): Promise<{ ok: boolean; status: CodexAuthStatus; error?: string }> {
    const res = await runCodexCli(['logout'], CODEX_AUTH_LOGOUT_TIMEOUT_MS);
    const status = await this.refresh();
    if (res.failure || (res.code !== null && res.code !== 0)) {
      const detail = res.failure ?? `exit ${String(res.code)}`;
      logger.warn(`[codexAuth] logout failed (${detail}): ${res.out.slice(0, 200)}`);
      return status.loggedIn
        ? { ok: false, status, error: res.out.trim().slice(0, 300) || detail }
        : { ok: true, status };
    }
    return { ok: true, status };
  }
}

export const codexAuthService = new CodexAuthService();
