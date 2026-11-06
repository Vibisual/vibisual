/**
 * §5.26 (E) — 훅 경로(`UserPromptSubmit` 의 `additionalContext`)로 싣는 복원 브리핑. 판정을 시험하려고 라우트 밖으로 뺐다.
 * 우리가 조립하는 세션은 스폰 경로(`assembleContextParts`)가 싣는다 — 여기서도 꺼내면 두 통로가 한 마커를 다투고,
 * 이긴 쪽이 엉뚱한 자리(턴 도중 [작업에 반영] 메시지 옆)에 싣는다. 키는 소유자 태그 재작성 전의 CLI 세션 id 다.
 */
import type { CompactMarker } from '@vibisual/shared';
import { buildRecoveryBlock, hasNotCarried } from './compactDiff.js';

export interface HookRecoveryDeps {
  /** 이 CLI 세션의 프롬프트를 우리가 조립하는가(헤드리스 sub). CMD(PTY)·바깥 세션은 `false`. */
  isAssembledByUs: (claudeSessionId: string) => boolean;
  /** 주입원 창의 `vibisual.compact-recovery` 스위치(§5.5 #17-28). */
  enabled: () => boolean;
  /** 꺼내며 못 박는다(`takeCompactBriefing`). */
  take: (claudeSessionId: string) => CompactMarker | undefined;
}

export function takeHookRecoveryBriefing(claudeSessionId: string, deps: HookRecoveryDeps): string {
  if (!claudeSessionId) return '';
  // 꺼내기 **전에** 거른다 — 꺼낸 뒤 버리면 `briefedAt` 이 찍혀 스폰 경로가 실을 마커가 사라진다.
  if (deps.isAssembledByUs(claudeSessionId) || !deps.enabled()) return '';
  const marker = deps.take(claudeSessionId);
  if (!marker?.outcome || !hasNotCarried(marker.outcome.notCarried)) return '';
  return buildRecoveryBlock(marker.outcome.notCarried);
}
