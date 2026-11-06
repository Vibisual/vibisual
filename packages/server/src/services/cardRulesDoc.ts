/** §5.5 #17-28 ⑧(f) — 실행 규칙과 선택적 근거 문서는 사용자 레포 밖에 둔다. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AGENT_CARD_KINDS, CARD_RULES_DOCUMENT, buildAgentCardCommonGuide, buildAgentCardGuide, type AgentRuleShell } from '@vibisual/shared';

import { logger } from '../logger.js';

/** 문서가 사는 곳 — 사용자 레포 밖(`~/.vibisual/rules`). */
function docPath(): string {
  return path.join(os.homedir(), '.vibisual', 'rules', 'cards.md');
}

/** 이번 부팅에서 이미 확인했는가(같은 내용을 스폰마다 다시 쓰지 않는다). */
let ensured: string | undefined;
const ensuredGuides = new Map<AgentRuleShell, string>();

function writeDocument(file: string, content: string): void {
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = null;
  }
  if (current !== content) fs.writeFileSync(file, content, 'utf8');
}

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
    writeDocument(p, CARD_RULES_DOCUMENT);
    ensured = p.replace(/\\/g, '/');
    return ensured;
  } catch (err) {
    logger.warn(`[card-rules-doc] write failed: ${err instanceof Error ? err.message : String(err)}`);
    ensured = '';
    return undefined;
  }
}

/** 공통과 세 종류가 모두 준비된 경우에만 경로를 반환한다. 실패하면 호출자가 전체 규약을 주입한다. */
export function ensureAgentCardGuides(shell: AgentRuleShell): string | undefined {
  const cached = ensuredGuides.get(shell);
  if (cached !== undefined) return cached || undefined;
  const dir = path.join(os.homedir(), '.vibisual', 'rules', 'cards-v1', shell);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeDocument(path.join(dir, 'common.md'), buildAgentCardCommonGuide(shell));
    for (const kind of AGENT_CARD_KINDS) {
      writeDocument(path.join(dir, `${kind}.md`), buildAgentCardGuide(kind, shell));
    }
    const normalized = dir.replace(/\\/g, '/');
    ensuredGuides.set(shell, normalized);
    return normalized;
  } catch (err) {
    logger.warn(`[card-guides] write failed: ${err instanceof Error ? err.message : String(err)}`);
    ensuredGuides.set(shell, '');
    return undefined;
  }
}

/** 테스트용 — 다음 호출에서 디스크 내용을 다시 확인한다. */
export function resetCardRulesDocCache(): void {
  ensured = undefined;
  ensuredGuides.clear();
}
