import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';

// Hook 리스너 신원(port + token) 영속화 — SCENARIO.md §3.7.
//
// 기존엔 매 실행마다 동적 포트(`listen(0)`)와 랜덤 토큰을 새로 만들었다. 그 결과 앱을 재실행하면
// 포트·토큰이 둘 다 바뀌어, 이전 인스턴스가 스폰한(=옛 포트/토큰이 프롬프트에 구워진) 외부 claude
// 서브에이전트의 loopback curl(작업 신고/질문/검수)이 connection refused 로 끊겼다.
//
// 해법: 첫 실행 때 동적으로 정한 포트·토큰을 userData 에 저장하고, 이후 실행마다 그 값을 그대로
// 재사용한다. 소스에 박힌 상수가 아니라(동적), 한 번 정해지면 재실행해도 동일하게 유지된다(안정).
// 단일 인스턴스 락(index.ts)이 두 인스턴스의 포트 경쟁을 막으므로 같은 포트 재바인드는 안전하다.
//
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
 * 신원 파일의 절대 경로 — 카드 엔드포인트 curl 이 "호출 시점에" 현재 포트·토큰을 읽도록
 * 서버 코어에 주입하기 위해 노출(§4 v2.71). 매 부팅마다 saveHookIdentity 가 실제 바인드
 * 포트·토큰으로 이 파일을 갱신하므로, 여기서 읽으면 재기동·포트변경 후에도 항상 live 값이다.
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
  const preferredPort =
    typeof persisted?.port === 'number' && persisted.port > 0 ? persisted.port : 0;
  return { token, preferredPort };
}

/** 실제 바인드된 포트·토큰을 확정 저장 — 다음 실행이 같은 값을 재사용하도록. */
export function saveHookIdentity(id: HookIdentity): void {
  const p = identityPath();
  try {
    writeFileSync(p, JSON.stringify(id, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[hook-identity] failed to persist ${p}: ${String(err)}`);
  }
}
