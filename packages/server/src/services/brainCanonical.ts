/**
 * §5.10 v3.81-B — **Canonical Knowledge 계층.** "지금 진실인 것"을 카드 파일에서 **계산**한다.
 *
 * ## 왜 레지스트리 파일이 아니라 계산인가
 *
 * `canonicalKey|scopeKey → cardId` 를 디스크에 따로 두면 카드와 레지스트리가 **서로 다른 진실**을
 * 말할 수 있는 이중 구조가 된다(그러면 둘을 맞추는 수복 코드가 또 필요하고, 사람이 md 를 직접 고치면
 * 레지스트리는 옛 카드를 계속 가리킨다). 우리는 부팅 때 어차피 전량 스캔을 하므로, 인덱스를 그 스캔의
 * **순수 함수**로 두면 ① 재생성 멱등이 공짜로 성립하고 ② 사람이 파일을 고쳐도 다음 스캔에 반영되며
 * ③ 승격 중 크래시도 파일만 보고 복구할 수 있다.
 *
 * ## 유일성 규칙
 *
 * 같은 `canonicalKey + scopeKey` 슬롯에 **자격자(verified·열림·미보관·유효기간 내)가 2 이상이면
 * 누구도 current 가 되지 않는다**(전원 `contested`). 최신 날짜 같은 이유로 한쪽을 자동 낙점하지
 * 않는 것이 이 설계의 핵심 — 미해결 충돌에서 임의로 고른 진실이 가장 위험한 낡은 기억이 된다.
 *
 * 이 모듈은 **읽기 전용 순수 함수만** 담는다. 파일 쓰기는 전부 `brainService` 가 한다.
 */
import {
  BRAIN_AUTHORITY_RANK,
  BRAIN_AUTHORITY_VERIFIABLE_MIN,
  BRAIN_SCOPE_AXES,
  type BrainAppliesTo,
  type BrainAuthority,
  type BrainCard,
  type BrainCurrentEntry,
  type BrainVerifyState,
} from '@vibisual/shared';

/** 구버전 카드(필드 없음) = **아직 검증 안 된 것**. 엄격안(사용자 결정 2026-07-31)의 기본값. */
export function verifyStateOf(card: Pick<BrainCard, 'verifyState'>): BrainVerifyState {
  return card.verifyState ?? 'candidate';
}

/** 권위 미기재 = 가장 낮은 랭크(AI 추론). 자동 승격 경로가 없다는 뜻이기도 하다. */
export function authorityOf(card: Pick<BrainCard, 'authority'>): BrainAuthority {
  return card.authority ?? 'ai-inference';
}

/** 이 권위로 `verified` 가 될 수 있는가(요건 9 — 출처 없는 AI 추론의 자동 승격 차단). */
export function canBeVerified(authority: BrainAuthority): boolean {
  return (BRAIN_AUTHORITY_RANK[authority] ?? 0) >= BRAIN_AUTHORITY_VERIFIABLE_MIN;
}

/** 두 권위 중 강한 쪽. 같은 값을 다시 관찰했을 때 카드의 권위를 끌어올리는 데 쓴다. */
export function strongerAuthority(a: BrainAuthority, b: BrainAuthority): BrainAuthority {
  return (BRAIN_AUTHORITY_RANK[a] ?? 0) >= (BRAIN_AUTHORITY_RANK[b] ?? 0) ? a : b;
}

// ─── 적용 범위(appliesTo) ───

/** 빈 값·`*`(전체)·공백은 축에서 지운다 — "전체"는 축을 **안 쓰는 것**으로 표현한다. */
export function normalizeAppliesTo(a?: BrainAppliesTo | null): BrainAppliesTo {
  const out: BrainAppliesTo = {};
  if (!a) return out;
  for (const axis of BRAIN_SCOPE_AXES) {
    const v = (a as Record<string, unknown>)[axis];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || t === '*') continue;
    (out as Record<string, string>)[axis] = t;
  }
  return out;
}

/**
 * 정규화된 범위 문자열 — **축 이름 오름차순**(`branch=main;project=vibisual`). 빈 문자열 = 전역.
 * 슬롯 키의 절반이므로 정렬이 결정적이어야 한다(객체 키 순서에 기대면 안 된다).
 */
export function scopeKeyOf(a?: BrainAppliesTo | null): string {
  const n = normalizeAppliesTo(a);
  return [...BRAIN_SCOPE_AXES]
    .sort()
    .filter((axis) => (n as Record<string, string>)[axis] != null)
    .map((axis) => `${axis}=${(n as Record<string, string>)[axis]}`)
    .join(';');
}

/** frontmatter 한 줄 → `BrainAppliesTo`. 모르는 축·형식 오류는 조용히 버린다(카드는 살린다). */
export function parseAppliesTo(line: string): BrainAppliesTo | undefined {
  const out: Record<string, string> = {};
  for (const part of line.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const axis = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!axis || !val || val === '*') continue;
    if (!BRAIN_SCOPE_AXES.includes(axis)) continue;
    out[axis] = val;
  }
  return Object.keys(out).length > 0 ? (out as BrainAppliesTo) : undefined;
}

/** `BrainAppliesTo` → frontmatter 한 줄(빈 범위면 빈 문자열 — 호출부가 줄 자체를 생략한다). */
export function serializeAppliesTo(a?: BrainAppliesTo | null): string {
  return scopeKeyOf(a);
}

/** 슬롯 키 — 이 조합에 현재 진실은 하나뿐이어야 한다. */
export function slotKey(canonicalKey: string, scopeKey: string): string {
  return `${canonicalKey}|${scopeKey}`;
}

export type ScopeRelation = 'equal' | 'a-subsumes-b' | 'b-subsumes-a' | 'incomparable';

/**
 * 두 범위의 관계. **포섭(subsume) = 제약이 더 적은 쪽이 더 넓다.**
 * 같으면 같은 슬롯(충돌 대상), 포섭이면 조건부 공존(읽기 시 구체적인 쪽 우선),
 * 비교 불가면 공존(현재 컨텍스트가 둘 다에 맞을 때만 그 읽기에서 제외).
 */
export function scopeRelation(a?: BrainAppliesTo | null, b?: BrainAppliesTo | null): ScopeRelation {
  const na = normalizeAppliesTo(a) as Record<string, string>;
  const nb = normalizeAppliesTo(b) as Record<string, string>;
  const ka = Object.keys(na).sort();
  const kb = Object.keys(nb).sort();
  const aInB = ka.every((k) => nb[k] === na[k]);
  const bInA = kb.every((k) => na[k] === nb[k]);
  if (aInB && bInA && ka.length === kb.length) return 'equal';
  if (aInB) return 'a-subsumes-b';
  if (bInA) return 'b-subsumes-a';
  return 'incomparable';
}

/**
 * 이 카드의 범위가 지금 컨텍스트에 적용되는가.
 *
 * - 컨텍스트를 **주지 않으면**(undefined) 범위로 거르지 않는다 — 호출부가 범위를 모른다는 뜻이지
 *   "아무 범위도 아니다"라는 뜻이 아니다. 여기서 걸러 버리면 범위가 붙은 지식이 통째로 사라진다.
 * - 컨텍스트를 **주면** 엄격하게 본다: 카드가 요구하는 축이 컨텍스트에 없거나 값이 다르면 불일치다
 *   (모르는 조건을 참으로 가정하지 않는다 — 그 가정이 곧 낡은 지식의 오적용이다).
 */
export function scopeMatchesContext(card: BrainAppliesTo | undefined, ctx: BrainAppliesTo | undefined): boolean {
  if (ctx === undefined) return true;
  const n = normalizeAppliesTo(card) as Record<string, string>;
  const c = normalizeAppliesTo(ctx) as Record<string, string>;
  for (const axis of Object.keys(n)) {
    if (c[axis] !== n[axis]) return false;
  }
  return true;
}

/** 범위 구체성(축 개수) — 같은 키에 포섭 관계가 있을 때 더 구체적인 쪽을 고르는 기준. */
export function scopeSpecificity(a?: BrainAppliesTo | null): number {
  return Object.keys(normalizeAppliesTo(a)).length;
}

// ─── current 인덱스 ───

/** 열려 있는가(대체되지 않았는가). `brainService.isOpenCard` 와 같은 규약. */
function isOpen(card: BrainCard): boolean {
  return card.validUntil == null;
}

/**
 * **current 후보 자격.** 랭킹·유용성 신호는 여기 전혀 관여하지 않는다 —
 * 도움률·참조 횟수·pinned 는 "무엇을 먼저 보여줄까"이지 "무엇이 참인가"가 아니기 때문이다.
 */
export function isCanonicalEligible(card: BrainCard, now: number): boolean {
  if (!card.canonicalKey) return false;
  if (!isOpen(card)) return false;
  if (card.status !== 'active') return false; // archived·ghost 제외(ghost = 출처가 다 사라짐)
  if (verifyStateOf(card) !== 'verified') return false;
  if (card.reviewAfter != null && now >= card.reviewAfter) return false;
  return true;
}

/**
 * 카드 전량 → 슬롯별 current 인덱스. **순수 함수**(같은 입력이면 항상 같은 출력).
 *
 * 자격자가 0이면 `none`, 1이면 `current`, 2 이상이면 `contested`(current 없음).
 * `contenders` 는 id 사전순으로 고정해 재생성 멱등을 보장한다.
 */
export function buildCanonicalIndex(cards: readonly BrainCard[], now: number): Map<string, BrainCurrentEntry> {
  const bySlot = new Map<string, BrainCard[]>();
  for (const card of cards) {
    if (!isCanonicalEligible(card, now)) continue;
    const key = slotKey(card.canonicalKey as string, scopeKeyOf(card.appliesTo));
    const list = bySlot.get(key) ?? [];
    list.push(card);
    bySlot.set(key, list);
  }
  const out = new Map<string, BrainCurrentEntry>();
  // 슬롯 키 사전순으로 넣는다 — 내용뿐 아니라 **순회 순서까지** 결정적이어야 "재생성 멱등"이
  // 진짜로 성립한다(입력 배열 순서가 Map 삽입 순서로 새는 것을 막는다).
  for (const key of [...bySlot.keys()].sort()) {
    const list = bySlot.get(key) as BrainCard[];
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sep = key.lastIndexOf('|');
    const entry: BrainCurrentEntry = {
      canonicalKey: key.slice(0, sep),
      scopeKey: key.slice(sep + 1),
      cardId: sorted.length === 1 ? (sorted[0] as BrainCard).id : null,
      contenders: sorted.map((c) => c.id),
      state: sorted.length === 1 ? 'current' : 'contested',
    };
    out.set(key, entry);
  }
  return out;
}

/** 인덱스에서 충돌 슬롯만(검토 큐·UI 특수 항목의 데이터원). */
export function listContestedSlots(index: Map<string, BrainCurrentEntry>): BrainCurrentEntry[] {
  return [...index.values()]
    .filter((e) => e.state === 'contested')
    .sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));
}

/**
 * §5.10 v3.81-C — **대체 거래 자가복구.**
 *
 * 승격은 ① 새 카드(`supersedes: [옛id]` 포함)를 먼저 쓰고 ② 옛 카드를 닫는 2단계다. 사이에서
 * 프로세스가 죽으면 옛 카드가 열린 채 남아 같은 슬롯에 둘이 열려 있게 된다. 그런데 **의도는 이미
 * 새 카드 파일 하나에 durable 하게 적혀 있으므로**, 로더가 그것만 보고 거래를 완료할 수 있다.
 * 저널·잠금 파일이 필요 없는 이유다(멱등 — 이미 닫힌 카드는 건드리지 않는다).
 *
 * 반환 = 닫아야 할 카드와 그것을 닫는 새 카드(호출부가 실제 쓰기를 수행).
 */
export function findSupersedeRepairs(cards: readonly BrainCard[]): Array<{ old: BrainCard; by: BrainCard }> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const repairs: Array<{ old: BrainCard; by: BrainCard }> = [];
  // 새 카드 id 순으로 돌아 복구 순서를 결정적으로 만든다.
  for (const card of [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!isOpen(card)) continue;              // 자기 자신이 이미 닫혔으면 그 거래는 끝난 이야기
    if (!card.supersedes || card.supersedes.length === 0) continue;
    for (const oldId of card.supersedes) {
      const old = byId.get(oldId);
      if (!old || !isOpen(old)) continue;     // 이미 닫혔으면 할 일 없음(멱등)
      if (old.id === card.id) continue;       // 자기 참조 방어
      repairs.push({ old, by: card });
    }
  }
  return repairs;
}
