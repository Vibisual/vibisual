/**
 * §5.10 v2 (E) — **근거 검증(Grounding).**
 *
 * 실측에서 카드 327장 중 `verified` 가 **1장**이었다. 원인은 v3.81 D1 엄격안(전부 `candidate` 로
 * 시작)이 아니라, 그 뒤에 **기계가 통과시킬 수 있는 문이 하나도 없었다**는 데 있다 —
 * `confirmCard` 를 부르는 것은 사람뿐이었다.
 *
 * 그런데 권위 표에는 이미 그 자리가 있다: `repository-source` = "현재 코드/설정과 대조 성공
 * (앵커 해시 일치)", 랭크 4. **정의만 있고 만들어 내는 코드가 없었다**(실측 3장, 전부 수동).
 * 이 파일이 그 미배선 경로를 잇는다 — 새 승격 경로를 만드는 것이 아니라 **기존 관문
 * (`confirmCard`)을 기계가 두드릴 수 있게** 하는 것이다.
 *
 * 대조 방식은 Hermes 의 `grounded-citations` 와 같은 발상이다: 주장에 등장하는 **코드 토막**
 * (백틱 인용·식별자·경로)이 그 카드가 가리키는 파일에 **실제로 있는지** 본문과 맞춰 본다.
 * 파일이 존재하는지만 보면 아무 주장이나 통과하므로 그것으로는 부족하다.
 *
 * **정책(decision·rule)은 이 문으로 못 지나간다** — `confirmCard` 가 막는다. 정책의 참·거짓은
 * 코드 대조로 가릴 수 없고 사용자 승인만이 올릴 수 있다(§D). 그 가드는 건드리지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BRAIN_GROUNDING_MAX_FILE_BYTES,
  BRAIN_GROUNDING_MIN_ANCHOR_HIT_RATIO,
  type BrainCard,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { getBrainService } from './brainService.js';
import { getBrainSkillService } from './brainSkillService.js';

/** 백틱 인용 — 사람이 "이건 코드다"라고 직접 표시한 자리라 가장 신뢰할 만한 근거 후보. */
const BACKTICKED = /`([^`\n]{3,80})`/g;

/**
 * 코드스러운 식별자 — camelCase · snake_case · dotted · 확장자 있는 경로.
 * 일반 산문 낱말이 걸리지 않게 **모양으로** 거른다(대문자 섞임 / 밑줄 / 점 중 하나는 있어야 한다).
 */
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]{2,}(?:[.\-/][A-Za-z0-9_$]+)*/g;

function looksLikeCode(s: string): boolean {
  if (s.length < 4) return false;
  if (/[._\-/]/.test(s)) return true;             // 경로·점표기·스네이크
  if (/[a-z][A-Z]/.test(s)) return true;          // camelCase
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(s)) return true; // CONSTANT_CASE
  return false;
}

/** 카드 본문에서 **파일과 맞춰 볼 토막**을 뽑는다. 없으면 대조할 것이 없다는 뜻이다. */
export function extractEvidenceTerms(card: Pick<BrainCard, 'title' | 'body'>): string[] {
  const text = `${card.title}\n${card.body}`;
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICKED)) {
    const raw = (m[1] ?? '').trim();
    // 백틱 안이 문장이면 그대로 찾을 수 없다 — 코드스러운 것만 남긴다.
    if (raw && raw.length <= 80 && !/\s{2,}/.test(raw) && looksLikeCode(raw)) out.add(raw);
  }
  for (const m of text.matchAll(IDENTIFIER)) {
    const raw = m[0];
    if (looksLikeCode(raw)) out.add(raw);
  }
  return [...out];
}

export type GroundingReason = 'no-files' | 'anchors-missing' | 'no-terms' | 'no-evidence' | 'grounded';

export interface GroundingResult {
  grounded: boolean;
  /** 실제로 파일에서 확인된 토막들 — 왜 통과했는지의 근거. */
  matched: string[];
  /** 연결 파일 중 실제로 존재하는 비율. */
  anchorHitRatio: number;
  reason: GroundingReason;
}

function readCapped(abs: string): string | null {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > BRAIN_GROUNDING_MAX_FILE_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 이 카드의 주장이 **지금 코드에 실재하는가**를 본다. 판정만 하고 쓰기는 하지 않는다.
 *
 * 통과 조건 둘을 **모두** 넘어야 한다:
 * ① 연결 파일이 실제로 있다(비율 문턱) — 사라진 파일을 근거로 삼을 수는 없다.
 * ② 본문의 코드 토막 중 **하나 이상이 그 파일 안에 실제로 있다** — 이게 진짜 대조다.
 */
export function groundCard(root: string, card: Pick<BrainCard, 'title' | 'body' | 'files'>): GroundingResult {
  if (card.files.length === 0) {
    // 파일이 없으면 대조할 대상이 없다. 이건 실패가 아니라 **판정 불가**다.
    return { grounded: false, matched: [], anchorHitRatio: 0, reason: 'no-files' };
  }
  const contents: string[] = [];
  let present = 0;
  for (const f of card.files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const text = readCapped(abs);
    if (text == null) continue;
    present++;
    contents.push(text);
  }
  const anchorHitRatio = present / card.files.length;
  if (anchorHitRatio < BRAIN_GROUNDING_MIN_ANCHOR_HIT_RATIO) {
    return { grounded: false, matched: [], anchorHitRatio, reason: 'anchors-missing' };
  }
  const terms = extractEvidenceTerms(card);
  if (terms.length === 0) {
    return { grounded: false, matched: [], anchorHitRatio, reason: 'no-terms' };
  }
  const matched: string[] = [];
  for (const t of terms) {
    if (contents.some((c) => c.includes(t))) matched.push(t);
  }
  return matched.length > 0
    ? { grounded: true, matched, anchorHitRatio, reason: 'grounded' }
    : { grounded: false, matched: [], anchorHitRatio, reason: 'no-evidence' };
}

/**
 * 검사하고, 통과하면 **기존 승격 관문으로** 올린다.
 *
 * `confirmCard(id, { authority: 'repository-source' })` 를 그대로 쓴다 — 승격 순서·슬롯 대체·
 * 정책 가드가 전부 그 안에 이미 있고, 두 번째 승격 경로를 만들면 그 규칙이 갈라진다.
 * 실패해도 카드는 그대로 `candidate` 로 남는다(강등하지 않는다 — 증거가 없다고 틀린 것은 아니다).
 */
export function applyGrounding(root: string, cardId: string): GroundingResult | null {
  const svc = getBrainService(root);
  const card = svc.getCard(cardId);
  if (!card) return null;
  const result = groundCard(root, card);
  if (!result.grounded) return result;
  try {
    svc.confirmCard(cardId, { authority: 'repository-source' });
  } catch (e) {
    logger.warn('[brain-ground] confirm failed', e as Error);
  }
  return result;
}

/**
 * 스킬도 같은 문을 지난다 — 절차가 가리키는 파일에 그 절차의 코드 토막이 실제로 있으면
 * **초안에서 실제 절차로** 올린다. 절차는 검증되기 전까지 참고 수준이고, 그 승격을
 * 사람 손에만 맡기면 카드가 겪은 일(327장 중 verified 1장)을 그대로 반복하게 된다.
 *
 * 매칭 대상에 `description` 을 함께 넣는다 — "언제 쓰는가"에 대상 파일·함수 이름이 들어가는 일이
 * 많고, 그것이야말로 이 절차가 어디에 매여 있는지 말해 주는 문장이기 때문이다.
 */
export function applySkillGrounding(root: string, skillId: string): GroundingResult | null {
  const svc = getBrainSkillService(root);
  const skill = svc.getSkill(skillId);
  if (!skill) return null;
  const result = groundCard(root, {
    title: `${skill.name} ${skill.description}`,
    body: skill.body,
    files: skill.files,
  });
  if (!result.grounded) return result;
  try {
    svc.markVerified(skillId);
  } catch (e) {
    logger.warn('[brain-ground] skill activate failed', e as Error);
  }
  return result;
}
