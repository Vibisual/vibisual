import { LAB_RULES_BEGIN, LAB_RULES_END, type AgentConfig, type LabResultStatus, type LabVariant, type QueuedCommand } from '@vibisual/shared';

/**
 * §5.18 — 변형 하나의 설정 조립. 기준 config 전량을 스프레드한 위에 변형 축만 덮는다.
 * 부분 페이로드를 저장하면 나머지 필드(도구·스킬 등)가 날아가므로 랩의 두 쓰기 경로(실행 스폰 · 승격)는 늘 이 함수를 지난다.
 */
export function mergeLabVariantConfig(base: AgentConfig, variant: Pick<LabVariant, 'config'>, extraRules?: string): AgentConfig {
  const cfg = variant.config;
  const rules = (() => {
    const existing = (base.rules ?? '').replace(new RegExp(`${LAB_RULES_BEGIN}[\\s\\S]*?${LAB_RULES_END}\\n?`, 'g'), '');
    if (extraRules === undefined) return existing;
    return existing.trim() ? `${extraRules}\n\n${existing}` : extraRules;
  })();
  return {
    ...base,
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.effort ? { effort: cfg.effort } : {}),
    ...(cfg.permissionMode ? { permissionMode: cfg.permissionMode } : {}),
    ...(cfg.maxTurns !== undefined ? { maxTurns: cfg.maxTurns } : {}),
    ...(extraRules !== undefined ? { rules } : {}),
  };
}

/** 이 회차의 마지막 명령이 판정 근거 — 오류면 failed, 사용자 중지면 stopped, 나머지 완료는 success(§5.18, 서버 판정). */
export function labResultStatus(last: Pick<QueuedCommand, 'status' | 'result'>): LabResultStatus {
  if (last.status === 'error') return 'failed';
  if (typeof last.result === 'string' && last.result.startsWith('[Stopped by user]')) return 'stopped';
  return 'success';
}

/** 명령들의 토큰 합. 하나도 못 읽었으면 그 축은 `undefined` — 0 으로 채우면 "공짜로 끝났다"가 된다(§5.18). */
export function sumLabTokens(done: readonly Pick<QueuedCommand, 'inputTokens' | 'outputTokens'>[]): { inputTokens?: number; outputTokens?: number } {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const cmd of done) {
    if (typeof cmd.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + cmd.inputTokens;
    if (typeof cmd.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + cmd.outputTokens;
  }
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
}
