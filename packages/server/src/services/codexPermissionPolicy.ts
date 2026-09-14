import {
  AUDIT_RISK_KINDS,
  canCodexPromptForPermission,
  isAuditRiskEnabled,
  type AuditBoundaryConfig,
} from '@vibisual/shared';

/**
 * §5.25 (H) — 코덱스 버블의 권한 판정. 클로드 경로(`/api/permission-check` 의 모드 단축)와 같은 창구·
 * 같은 원장·같은 승인 카드를 쓰되, **두 계층을 따로 본다**:
 *
 *  - **권한 모드**는 코덱스가 집행한다(샌드박스 + 승인 정책). 우리 몫은 코덱스가 샌드박스 밖 실행을
 *    물을 때(PermissionRequest) 그 질문을 승인 카드로 옮기는 것뿐이다.
 *  - **감사 경계**는 모드와 무관한 별도 필터다. 실행 전(PreToolUse) 위험 호출을 붙잡아 카드로 묻는다.
 *
 * 순수 함수라 서버 없이 모드 × 경계 × 이벤트를 전부 시험한다.
 */

export type CodexPermissionHookEvent = 'PreToolUse' | 'PermissionRequest';

export type CodexPermissionPlan =
  /** 통과. `policy` 는 원장에 정책 결정으로 적을 사유(없으면 결정을 비워 둔다 — 코덱스가 이어서 판정한다). */
  | { kind: 'allow'; reason: 'plan' | 'bypass' | 'sandbox'; policy?: 'bypass' | 'plan' }
  /** 바로 앞 카드에서 허용된 같은 호출 — 다시 묻지 않는다. */
  | { kind: 'allow'; reason: 'approved' }
  /** 묻지 않고 거부. `reason` 은 훅이 문구를 고르는 약속된 마커다. */
  | { kind: 'deny'; reason: 'dont-ask' | 'codex-no-prompt' }
  /** 승인 카드로 사람에게 묻는다. */
  | { kind: 'ask' };

export function planCodexPermission(input: {
  event: CodexPermissionHookEvent;
  permissionMode: string | undefined;
  /** 감사 경계가 이 호출을 붙잡는가(위험 종류가 켜진 종류와 겹친다). */
  escalate: boolean;
  /**
   * 같은 호출을 방금 승인 카드에서 허용했으면 그 몫을 하나 쓰고 true. **물을 자리에서만** 부른다 —
   * 묻지 않고 끝나는 호출이 몫을 먼저 써 버리면 정작 재시도가 다시 묻는다.
   */
  consumeApproval: () => boolean;
}): CodexPermissionPlan {
  const mode = input.permissionMode || 'default';
  if (input.event === 'PreToolUse') {
    // `plan` 은 경계가 건드리지 않는다 — 클로드 경로와 같다(읽기 전용 샌드박스가 실행을 막는다).
    if (mode === 'plan') return { kind: 'allow', reason: 'plan', policy: 'plan' };
    if (!input.escalate) {
      return mode === 'bypassPermissions'
        ? { kind: 'allow', reason: 'bypass', policy: 'bypass' }
        : { kind: 'allow', reason: 'sandbox' };
    }
    if (input.consumeApproval()) return { kind: 'allow', reason: 'approved' };
    // `dontAsk` 는 묻지 않는 모드다 — 경계가 붙잡은 호출을 물을 수 없으니 거부한다.
    if (mode === 'dontAsk') return { kind: 'deny', reason: 'dont-ask' };
    return { kind: 'ask' };
  }
  // PermissionRequest — 코덱스가 샌드박스 밖 실행을 묻는다. 모드가 답을 정한다.
  if (mode === 'bypassPermissions') return { kind: 'allow', reason: 'bypass', policy: 'bypass' };
  if (mode === 'dontAsk') return { kind: 'deny', reason: 'dont-ask' };
  if (!canCodexPromptForPermission(mode)) return { kind: 'deny', reason: 'codex-no-prompt' };
  if (input.consumeApproval()) return { kind: 'allow', reason: 'approved' };
  return { kind: 'ask' };
}

/**
 * 권한 훅을 못 붙였을 때 턴을 거절해야 하는가. 승인 모드이거나, 경계가 켜져 이 모드에서 호출을
 * 붙잡을 수 있으면 훅이 곧 집행이다 — 없이 돌면 사용자가 고른 설정이 조용히 꺼진다.
 * (`plan`·`dontAsk` 는 읽기 전용 샌드박스라 훅 없이도 위험 호출이 실행되지 않는다.)
 */
export function codexPermissionHooksRequired(
  permissionMode: string | undefined,
  boundary: AuditBoundaryConfig | undefined,
): boolean {
  const mode = permissionMode || 'default';
  if (canCodexPromptForPermission(mode)) return true;
  if (mode === 'plan' || mode === 'dontAsk') return false;
  return AUDIT_RISK_KINDS.some((kind) => isAuditRiskEnabled(boundary, kind));
}

/**
 * 같은 호출을 가리키는 열쇠. 코덱스는 재시도에 새 `tool_use_id` 를 주고, 승인 요청에는 모델이 쓴
 * 설명(`description`)을 덧붙인다(실측 — 명령 본문은 세 번 모두 같다). 그래서 명령 본문으로 잇고,
 * 명령이 없는 도구(MCP)는 설명을 뺀 입력 전체로 잇는다. 요약(200자 절단)은 쓰지 않는다 — 앞이 같은
 * 두 명령이 한 열쇠로 묶이면 허용하지 않은 명령이 통과한다.
 */
export function codexApprovalKey(
  agentId: string,
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): string {
  const input = toolInput ?? {};
  const body = typeof input['command'] === 'string'
    ? input['command']
    : JSON.stringify(Object.keys(input).filter((key) => key !== 'description').sort().map((key) => [key, input[key]]));
  return JSON.stringify([agentId, sessionId, toolName, body]);
}

/** 원장 합치기 창(`auditLog.ts` 의 대기 표식)과 같은 2분. */
export const CODEX_APPROVAL_TTL_MS = 120_000;

/**
 * §5.25 (H) — **같은 호출을 두 번 묻지 않기.** 샌드박스 밖이 필요한 명령은 코덱스에서
 * PreToolUse(1차) → 샌드박스 실패 → PreToolUse(재시도) → PermissionRequest 로 흐른다. 1차에서 경계
 * 카드가 허용되면 재시도 한 번과 승인 요청 한 번을 그 답으로 덮는다(무응답 허용 정책도 사용자가 고른
 * 답이다 — 덮지 않으면 한 명령에 60초 대기가 세 번 쌓인다). 몫은 한 번씩이고 2분이 지나면 사라진다.
 *
 * PermissionRequest 에는 `tool_use_id` 가 없어, 그 답을 적을 원장 줄도 여기서 이어 준다.
 */
export class CodexApprovalMemory {
  private readonly grants = new Map<string, { at: number; preToolUse: number; permissionRequest: number }>();
  private readonly entries = new Map<string, { at: number; entryId: string }>();

  constructor(
    private readonly ttlMs: number = CODEX_APPROVAL_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  grant(key: string): void {
    this.sweep();
    this.grants.set(key, { at: this.now(), preToolUse: 1, permissionRequest: 1 });
  }

  /** 이 이벤트 몫이 남아 있으면 하나 쓰고 true. */
  consume(key: string, event: CodexPermissionHookEvent): boolean {
    this.sweep();
    const grant = this.grants.get(key);
    if (!grant) return false;
    const slot = event === 'PreToolUse' ? 'preToolUse' : 'permissionRequest';
    if (grant[slot] <= 0) return false;
    grant[slot] -= 1;
    if (grant.preToolUse <= 0 && grant.permissionRequest <= 0) this.grants.delete(key);
    return true;
  }

  /** 이 호출의 가장 최근 원장 줄. */
  rememberEntry(key: string, entryId: string): void {
    this.sweep();
    this.entries.set(key, { at: this.now(), entryId });
  }

  entryFor(key: string): string | undefined {
    this.sweep();
    return this.entries.get(key)?.entryId;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, grant] of this.grants) if (grant.at < cutoff) this.grants.delete(key);
    for (const [key, entry] of this.entries) if (entry.at < cutoff) this.entries.delete(key);
  }
}
