/**
 * §5.5 #17-28 ⑧(f) — 카드 규약의 **이유**를 담은 문서를 디스크에 한 장 놓는다. 프롬프트에는 결론만 싣고 요약이 이 경로를 가리킨다.
 * **읽기를 강제하지 않는다** — 규약이 실린 271 세션 중 255(94%)가 카드를 써서, 강제하면 거의 모든 세션이 읽고 그 내용이 도구 결과로 남아 재열람된다(실측 3,408 → 3,729 토큰). 애매할 때만 여는 예비 경로다.
 * 사용자 레포가 아니라 `~/.vibisual/rules/` 에 쓴다 — 남의 저장소를 오염시키지 않는다(`mcpConfigService` 의 `~/.vibisual/mcp/` 와 같은 규율).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CARD_RULES_DOCUMENT } from '@vibisual/shared';

import { logger } from '../logger.js';

/** 문서가 사는 곳 — 사용자 레포 밖(`~/.vibisual/rules`). */
function docPath(): string {
  return path.join(os.homedir(), '.vibisual', 'rules', 'cards.md');
}

/** 이번 부팅에서 이미 확인했는가(같은 내용을 스폰마다 다시 쓰지 않는다). */
let ensured: string | undefined;

/**
 * 문서를 최신 내용으로 맞추고 **프롬프트에 적을 절대경로**를 돌려준다.
 * 쓰기 실패면 `undefined` — 요약에서 "애매하면 읽어라" 줄이 빠진다(없는 파일을 가리키면 그 턴을 헛되이 태운다).
 * 경로는 forward-slash 로 정규화한다 — Windows 역슬래시가 프롬프트 안에서 이스케이프로 읽히지 않게.
 */
export function ensureCardRulesDoc(): string | undefined {
  if (ensured !== undefined) return ensured || undefined;
  const p = docPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let current: string | null = null;
    try {
      current = fs.readFileSync(p, 'utf8');
    } catch {
      current = null;
    }
    if (current !== CARD_RULES_DOCUMENT) fs.writeFileSync(p, CARD_RULES_DOCUMENT, 'utf8');
    ensured = p.replace(/\\/g, '/');
    return ensured;
  } catch (err) {
    logger.warn(`[card-rules-doc] write failed: ${err instanceof Error ? err.message : String(err)}`);
    ensured = '';
    return undefined;
  }
}

/** 테스트용 — 다음 호출이 다시 쓰도록 캐시를 버린다. */
export function resetCardRulesDocCache(): void {
  ensured = undefined;
}
