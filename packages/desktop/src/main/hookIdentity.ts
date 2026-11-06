import { readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';

// Hook 리스너 신원(port + token) 영속화 — SCENARIO.md §3.7.
// 첫 실행에 동적으로 정한 포트·토큰을 userData 에 저장해 재실행마다 재사용한다 — 바뀌면 옛 포트/토큰이 프롬프트에 구워진
// 외부 claude 서브에이전트의 loopback curl(작업 신고/질문/검수)이 connection refused 로 끊긴다.
// 단일 인스턴스 락(index.ts)이 포트 경쟁을 막아 같은 포트 재바인드는 안전하다.
// userData 는 앱 인스턴스 설정 + secrets + 오토업데이터 상태 전용(프로젝트 데이터 ❌ — §3.5).

const IDENTITY_FILENAME = 'hook-listener.json';

export interface HookIdentity {
  /** 마지막으로 실제 바인드된 loopback 포트. 다음 실행이 같은 포트를 선호 포트로 재사용. */
  port: number;
  /** loopback 인증 토큰. 한 번 만들면 계속 유지. */
  token: string;
}

function identityPath(): string {
  return join(app.getPath('userData'), IDENTITY_FILENAME);
}

/**
 * 신원 파일의 절대 경로 — 카드 엔드포인트 curl 이 호출 시점에 현재 포트·토큰을 읽도록 서버 코어에 주입한다(§4).
 * 매 부팅 `saveHookIdentity` 가 실제 바인드 값으로 갱신하므로 재기동·포트 변경 뒤에도 live 값이다.
 */
export function hookIdentityPath(): string {
  return identityPath();
}

function readPersisted(): Partial<HookIdentity> | null {
  const p = identityPath();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      port: typeof obj['port'] === 'number' ? obj['port'] : undefined,
      token: typeof obj['token'] === 'string' ? obj['token'] : undefined,
    };
  } catch (err) {
    console.warn(`[hook-identity] failed to read ${p}: ${String(err)}`);
    return null;
  }
}

/**
 * 저장된 토큰·선호 포트를 돌려준다. 토큰이 없으면 새로 만들고(아직 저장 ❌ — 실제 바인드 후
 * saveHookIdentity 로 포트와 함께 확정 저장한다), 선호 포트가 없으면 0(=동적 할당)을 준다.
 */
export function loadHookIdentity(): { token: string; preferredPort: number } {
  const persisted = readPersisted();
  const token = persisted?.token ?? randomBytes(24).toString('hex');
  // 손상된 저장값도 listen() 의 동기 예외로 부팅을 막으면 안 된다. 신원 토큰은 유지하고
  // 실제 TCP 포트로 쓸 수 있는 정수만 재사용한다(0은 새 동적 포트를 요청하는 내부 값).
  const preferredPort =
    typeof persisted?.port === 'number' && Number.isInteger(persisted.port)
      && persisted.port >= 1 && persisted.port <= 65535 ? persisted.port : 0;
  return { token, preferredPort };
}

/** 서버의 `atomicWriteFileSync` 모양. 제거기 정리 모드(`hookCleanup.ts`)가 이 모듈을 읽어도 서버 코어를 끌고 오지 않게 본체가 넣어 준다. */
export type AtomicWrite = (filePath: string, data: string, mode?: number) => void;

/**
 * 실제 바인드된 포트·토큰을 확정 저장 — 다음 실행이 같은 값을 재사용하도록.
 * 원자 교체(§3.2.1-1)라 쓰기가 중간에 실패해도 이전 포트·토큰이 남는다 — 직접 덮어쓰면 반쪽 JSON 이 되어 다음 부팅이 새 신원을 만든다.
 */
export function saveHookIdentity(id: HookIdentity, write: AtomicWrite): void {
  const p = identityPath();
  try {
    // 토큰 하나면 훅 리스너 화이트리스트 전체에 닿으므로 다른 사용자 계정이 못 읽게 0600(실효는 mac·linux, Windows 는 no-op).
    write(p, JSON.stringify(id, null, 2) + '\n', 0o600);
    try {
      chmodSync(p, 0o600);
    } catch {
      /* 파일시스템이 권한을 다루지 않는 경우 */
    }
  } catch (err) {
    console.warn(`[hook-identity] failed to persist ${p}: ${String(err)}`);
  }
}
