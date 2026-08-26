/**
 * §5.10 Project Brain — 2단 기억(프로젝트/에이전트) 서비스.
 *
 * 카드 1장 = 마크다운 파일 1개(`<root>/.vibisual/brain/{project|agents/<agentId>}/<id>.md`).
 * **파일이 원본(SSOT)** — §3.2 단일 창구의 명시적 예외(identity.json·AppState 동격). 사람이 직접
 * 열어 읽고 고칠 수 있다. 이 서비스는 디스크를 스캔해 in-memory 인덱스로 들고, REST 로만 본문을
 * 내려준다(스냅샷에는 요약만 실린다 — §9 perf). 모든 쓰기는 atomicWriteFileSync(§3.2.1 ①)만 사용.
 *
 * 프로젝트 루트별 1 인스턴스 — 모듈 레벨 Map(getBrainService)로 lazy 관리. projectGraph 가
 * getSnapshot 에서 getSummary()/주입 이벤트를 조회한다(this.root 로 키).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { atomicWriteFileSync } from './statePersistence.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey } from './pathKey.js';
import {
  BRAIN_REF_FLUSH_MS,
  BRAIN_DEDUP_JACCARD_THRESHOLD,
  BRAIN_SEARCH_MAX_RESULTS,
  BRAIN_BIGRAM_MIN_SCORE,
  BRAIN_STALE_THRESHOLD_MS,
  BRAIN_FEED_SECTION_SIZE,
  BRAIN_RANK_W_RELEVANCE,
  BRAIN_RANK_W_HELPFUL,
  BRAIN_RANK_W_FRESHNESS,
  BRAIN_RANK_W_PINNED,
  BRAIN_HELPFUL_SMOOTH_ALPHA,
  BRAIN_HELPFUL_SMOOTH_BETA,
  BRAIN_FRESHNESS_HALF_LIFE_MS,
  BRAIN_DEMOTE_IMPRESSION_MIN,
  BRAIN_DEMOTE_FACTOR,
  BRAIN_RESURFACE_MIN_AGE_MS,
  BRAIN_TOPICS,
  BRAIN_ALWAYS_RULE_MAX,
  BRAIN_TOPIC_MISC,
  BRAIN_TOPIC_MISC_TITLE,
  BRAIN_TOPIC_MISC_WHEN_TO_READ,
  BRAIN_CONTRADICT_JACCARD_MIN,
  BRAIN_SUPERSEDE_CANDIDATE_MAX,
  BRAIN_NEGATION_PATTERN,
  BRAIN_ANCHOR_SHA_LEN,
  BRAIN_ANCHOR_MAX_FILE_BYTES,
  BRAIN_STALE_REPORT_ARCHIVE_MIN,
  BRAIN_TOPIC_CARD_BUDGET,
  BRAIN_PROJECT_CARD_BUDGET,
  BRAIN_AGENT_CARD_BUDGET,
  BRAIN_OPERATOR_CARD_BUDGET,
  BRAIN_TOPIC_DOC_CORE_N,
  BRAIN_ARCHIVE_DIRNAME,
  BRAIN_ARCHIVE_LIST_MAX,
  BRAIN_DEMOTE_UNREFERENCED_MS,
  BRAIN_AUTHORITY_RANK,
  BRAIN_OBSERVATION_KEEP,
  BRAIN_POLICY_TYPES,
  BRAIN_MIGRATION_DUP_TITLE_MIN,
  type BrainTopicIndexEntry,
  type BrainAnchor,
  type BrainAuthority,
  type BrainCard,
  type BrainCardInput,
  type BrainCardScope,
  type BrainCardType,
  type BrainCurrentEntry,
  type BrainObservation,
  type BrainSaveResult,
  type BrainSummary,
  type BrainFeed,
  type BrainFeedSectionKey,
  type BrainVerifyState,
} from '@vibisual/shared';
import {
  authorityOf,
  buildCanonicalIndex,
  canBeVerified,
  findSupersedeRepairs,
  listContestedSlots,
  parseAppliesTo,
  scopeKeyOf,
  scopeMatchesContext,
  serializeAppliesTo,
  slotKey,
  strongerAuthority,
  verifyStateOf,
} from './brainCanonical.js';
import { logger } from '../logger.js';

/** frontmatter 검증용 허용 값 집합(모르는 값은 미기재로 취급 — 조용한 오염 방지). */
const VERIFY_STATES: ReadonlySet<string> = new Set<BrainVerifyState>([
  'candidate', 'verified', 'needs-check', 'contested', 'rejected',
]);
const AUTHORITIES: ReadonlySet<string> = new Set(Object.keys(BRAIN_AUTHORITY_RANK));
const POLICY_TYPES: ReadonlySet<string> = new Set(BRAIN_POLICY_TYPES);

const BRAIN_SUBDIR = '.vibisual/brain';

/** §5.10 v3.78 — 부정 극성 감지(모듈 레벨 1회 컴파일 — 저장 핫패스에서 매번 만들지 않는다). */
const NEGATION_RE = new RegExp(BRAIN_NEGATION_PATTERN, 'i');

interface IndexEntry {
  card: BrainCard;
  filePath: string;
  mtimeMs: number;
}

/** 카드 ID 발급 — CommentBox/CaptureBubble 선례와 동일 패턴. */
function newCardId(): string {
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 텍스트 → 토큰 집합(소문자, 유니코드 문자/숫자 시퀀스). 한글은 공백 단위 청크로 잡힌다. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const m = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (m) for (const t of m) if (t.length >= 2) out.add(t);
  return out;
}

/** Jaccard 토큰 겹침(교집합/합집합). 저장 전 중복 검사용. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * §5.10 v3.78 — **문자 bigram 집합**(토큰 안에서만 만든다 — 단어 경계를 넘는 잡음 방지).
 *
 * 한국어는 조사·어미가 붙어 같은 뜻도 토큰이 달라진다("붙여라"/"붙이지", "수집기는"/"수집기를").
 * 그래서 토큰 Jaccard 만으로는 **분명한 모순도 겹침 0.23** 밖에 안 나와 판정을 놓쳤다(실측).
 * 문자 bigram 은 조사가 바뀌어도 어간이 겹쳐 이 문제를 넘는다.
 *
 * 다만 **"동일" 판정은 종전 토큰 Jaccard 그대로** 둔다 — bigram 은 느슨해서 무관한 카드까지
 * 하나로 합칠 위험이 있다. bigram 은 부정 극성 반전이 함께 성립할 때(= 모순)만 쓴다.
 */
export function charBigrams(text: string): Set<string> {
  const out = new Set<string>();
  const m = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!m) return out;
  for (const tok of m) {
    if (tok.length === 1) { out.add(tok); continue; }
    for (let i = 0; i + 1 < tok.length; i++) out.add(tok.slice(i, i + 2));
  }
  return out;
}

/**
 * §5.10 v2 (C) — **질의 커버리지**: 물어본 것 중 몇 할이 그 문서에 들어 있는가.
 *
 * 중복 판정에는 Jaccard 가 맞지만(두 카드가 서로 얼마나 같은가), **검색에는 맞지 않는다** —
 * 본문이 길수록 분모가 커져 **맞는 카드일수록 점수가 떨어지기** 때문이다. 검색에서 알고 싶은
 * 것은 "이 문서가 내 질의를 다루는가"이므로 분모는 질의여야 한다.
 * 스킬 집행 선택(`brainSkillService`)도 같은 함수를 쓴다 — 판정이 두 벌이 되지 않게.
 */
export function coverage(query: Set<string>, hay: Set<string>): number {
  if (query.size === 0) return 0;
  let hit = 0;
  for (const t of query) if (hay.has(t)) hit++;
  return hit / query.size;
}

/** 경로 정규화(forward-slash·후행 슬래시 제거 + **대소문자를 실제로 무시하는 FS 에서만** 소문자).
 *  파일 일치 비교용 — linux 에서 접으면 `src/Foo.ts` 카드가 `src/foo.ts` 에 붙는다. */
function normPath(p: string): string {
  return pathKey(p);
}

/** 카드의 연결 파일들 중 대상 경로와 일치하는 게 있는가(절대 vs 상대 suffix 허용, 오탐 최소). */
function fileListMatches(cardFiles: string[], target: string): boolean {
  const nt = normPath(target);
  for (const f of cardFiles) {
    const nf = normPath(f);
    if (!nf) continue;
    if (nf === nt) return true;
    if (nt.endsWith('/' + nf) || nf.endsWith('/' + nt)) return true;
  }
  return false;
}

// ─── frontmatter(YAML-lite) 직렬화/파싱 — 새 의존성 없이 손으로 ───

function escapeScalar(v: string): string {
  // 개행만 제거(단일 라인 스칼라 보장). 콜론 등은 첫 ': ' 이후 전부를 값으로 읽으므로 안전.
  return v.replace(/\r?\n/g, ' ').trim();
}

function serializeCard(card: BrainCard): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${card.id}`);
  lines.push(`type: ${card.type}`);
  lines.push(`scope: ${card.scope}`);
  if (card.agentId) lines.push(`agentId: ${card.agentId}`);
  lines.push(`title: ${escapeScalar(card.title)}`);
  if (card.sourceSessionId) lines.push(`sourceSessionId: ${card.sourceSessionId}`);
  lines.push(`createdAt: ${card.createdAt}`);
  lines.push(`updatedAt: ${card.updatedAt}`);
  if (card.lastReferencedAt != null) lines.push(`lastReferencedAt: ${card.lastReferencedAt}`);
  lines.push(`refCount: ${card.refCount}`);
  if (card.helpfulCount != null && card.helpfulCount > 0) lines.push(`helpfulCount: ${card.helpfulCount}`);
  if (card.lastHelpfulAt != null) lines.push(`lastHelpfulAt: ${card.lastHelpfulAt}`);
  if (card.pinned) lines.push(`pinned: true`);
  lines.push(`status: ${card.status}`);
  if (card.supersededNote) lines.push(`supersededNote: ${escapeScalar(card.supersededNote)}`);
  lines.push(`seen: ${card.seen ? 'true' : 'false'}`);
  // §5.10 v3.74 — 주제 축(프로젝트 층 전용) + 상시 규칙 플래그.
  if (card.topic) lines.push(`topic: ${escapeScalar(card.topic)}`);
  if (card.always) lines.push(`always: true`);
  // §5.10 v3.78 — 유효기간 2축(여는 축 = createdAt) + 대체 체인 + 재검증 상태.
  if (card.validUntil != null) lines.push(`validUntil: ${card.validUntil}`);
  if (card.supersededBy) lines.push(`supersededBy: ${card.supersededBy}`);
  if (card.supersedes && card.supersedes.length > 0) lines.push(`supersedes: ${card.supersedes.join(',')}`);
  if (card.verifyState) lines.push(`verifyState: ${card.verifyState}`);
  if (card.staleReports != null && card.staleReports > 0) lines.push(`staleReports: ${card.staleReports}`);
  if (card.promotedFrom) lines.push(`promotedFrom: ${card.promotedFrom}`);
  // §5.10 v3.81 — SSOT 축(진실 주소 · 적용 범위 · 권위 · 검증 시각 · 관찰 이력).
  if (card.canonicalKey) lines.push(`canonicalKey: ${escapeScalar(card.canonicalKey)}`);
  const scopeLine = serializeAppliesTo(card.appliesTo);
  if (scopeLine) lines.push(`appliesTo: ${scopeLine}`);
  if (card.authority) lines.push(`authority: ${card.authority}`);
  if (card.value) lines.push(`value: ${escapeScalar(card.value)}`);
  if (card.verifiedAt != null) lines.push(`verifiedAt: ${card.verifiedAt}`);
  if (card.reviewAfter != null) lines.push(`reviewAfter: ${card.reviewAfter}`);
  if (card.observedCount != null && card.observedCount > 0) lines.push(`observedCount: ${card.observedCount}`);
  if (card.files.length > 0) {
    lines.push('files:');
    for (const f of card.files) lines.push(`  - ${escapeScalar(f)}`);
  }
  // §5.10 v3.78 — 코드 앵커. 한 줄 = `path\tsha\tcommit\tat\teditedSince\tlastEditedAt`(빈 칸 허용).
  //   경로에 탭이 들어갈 일이 없어 YAML 중첩 없이 사람이 읽을 수 있는 한 줄로 유지한다.
  if (card.anchors && card.anchors.length > 0) {
    lines.push('anchors:');
    for (const a of card.anchors) {
      const cells = [a.path, a.sha ?? '', a.commit ?? '', String(a.at), String(a.editedSince ?? 0), String(a.lastEditedAt ?? '')];
      lines.push(`  - ${escapeScalar(cells.join('\t'))}`);
    }
  }
  // §5.10 v3.81 — 관찰 이력. 한 줄 = `at\tsessionId\tauthority`(앵커와 같은 문법).
  if (card.observations && card.observations.length > 0) {
    lines.push('observations:');
    for (const o of card.observations) {
      lines.push(`  - ${escapeScalar([String(o.at), o.sessionId ?? '', o.authority].join('\t'))}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(card.body ?? '');
  return lines.join('\n');
}

/** 파일 텍스트 → BrainCard. frontmatter 없거나 손상 시 null. scope/agentId 는 파일 위치로 보정. */
function parseCard(text: string, fallback: { scope: BrainCardScope; agentId?: string; id: string }): BrainCard | null {
  if (!text.startsWith('---')) return null;
  const firstNl = text.indexOf('\n');
  if (firstNl < 0) return null;
  const rest = text.slice(firstNl + 1);
  const closeIdx = rest.indexOf('\n---');
  if (closeIdx < 0) return null;
  const fmBlock = rest.slice(0, closeIdx);
  let body = rest.slice(closeIdx + 4); // skip '\n---'
  if (body.startsWith('\n')) body = body.slice(1);
  if (body.startsWith('\n')) body = body.slice(1);

  const fm: Record<string, string> = {};
  const files: string[] = [];
  const anchorLines: string[] = [];
  const observationLines: string[] = [];
  /** 지금 읽고 있는 리스트 블록(`files:` / `anchors:` / `observations:`) — 없으면 null. */
  let listKey: 'files' | 'anchors' | 'observations' | null = null;
  for (const raw of fmBlock.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (listKey && /^\s+-\s/.test(line)) {
      const item = line.replace(/^\s+-\s/, '').trimEnd();
      if (listKey === 'files') files.push(item.trim());
      else if (listKey === 'anchors') anchorLines.push(item);
      else observationLines.push(item);
      continue;
    }
    listKey = null;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const key = line.slice(0, ci).trim();
    const val = line.slice(ci + 1).trim();
    if (key === 'files') { listKey = 'files'; if (val) files.push(val); continue; }
    if (key === 'anchors') { listKey = 'anchors'; if (val) anchorLines.push(val); continue; }
    if (key === 'observations') { listKey = 'observations'; if (val) observationLines.push(val); continue; }
    fm[key] = val;
  }

  // §5.10 v3.78 — 앵커 한 줄 → BrainAnchor. 손상 줄은 조용히 버린다(카드 자체는 살린다).
  const anchors: BrainAnchor[] = [];
  for (const line of anchorLines) {
    const cells = line.split('\t');
    const p = (cells[0] ?? '').trim();
    if (!p) continue;
    const at = Number(cells[3]);
    const editedSince = Number(cells[4]);
    const lastEditedAt = Number(cells[5]);
    anchors.push({
      path: p,
      sha: cells[1]?.trim() || undefined,
      commit: cells[2]?.trim() || undefined,
      at: Number.isFinite(at) && at > 0 ? at : 0,
      ...(Number.isFinite(editedSince) && editedSince > 0 ? { editedSince } : {}),
      ...(Number.isFinite(lastEditedAt) && lastEditedAt > 0 ? { lastEditedAt } : {}),
    });
  }

  // §5.10 v3.81 — 관찰 한 줄 → BrainObservation. 손상 줄은 조용히 버린다(카드 자체는 살린다).
  const observations: BrainObservation[] = [];
  for (const line of observationLines) {
    const cells = line.split('\t');
    const at = Number(cells[0]);
    if (!Number.isFinite(at) || at <= 0) continue;
    const auth = (cells[2] ?? '').trim();
    observations.push({
      at,
      ...(cells[1]?.trim() ? { sessionId: cells[1].trim() } : {}),
      authority: AUTHORITIES.has(auth) ? (auth as BrainAuthority) : 'ai-inference',
    });
  }

  const type = (fm.type as BrainCardType) || 'fact';
  const scope = (fm.scope as BrainCardScope) || fallback.scope;
  const card: BrainCard = {
    id: fm.id || fallback.id,
    type,
    scope,
    agentId: fm.agentId || fallback.agentId,
    title: fm.title || '(제목 없음)',
    body: body.trimEnd(),
    files,
    sourceSessionId: fm.sourceSessionId || undefined,
    createdAt: Number(fm.createdAt) || Date.now(),
    updatedAt: Number(fm.updatedAt) || Number(fm.createdAt) || Date.now(),
    lastReferencedAt: fm.lastReferencedAt ? Number(fm.lastReferencedAt) : undefined,
    refCount: Number(fm.refCount) || 0,
    helpfulCount: fm.helpfulCount ? Number(fm.helpfulCount) || 0 : 0,
    lastHelpfulAt: fm.lastHelpfulAt ? Number(fm.lastHelpfulAt) : undefined,
    pinned: fm.pinned === 'true' || undefined,
    status: (fm.status as BrainCard['status']) || 'active',
    supersededNote: fm.supersededNote || undefined,
    seen: fm.seen === 'true' ? true : fm.seen === 'false' ? false : undefined,
    // §5.10 v3.74 — 없으면 undefined 로 두고 ensureLoaded 의 백필이 채운다(구버전 카드 하위호환).
    topic: fm.topic || undefined,
    always: fm.always === 'true' ? true : undefined,
    // §5.10 v3.78 — 전부 optional. 구버전 카드는 값이 없어 "열려 있고 검증 OK"로 읽힌다.
    validUntil: fm.validUntil ? Number(fm.validUntil) || undefined : undefined,
    supersededBy: fm.supersededBy || undefined,
    supersedes: fm.supersedes ? fm.supersedes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    // §5.10 v3.81 — 5값으로 확장. 모르는 값·미기재는 undefined 로 두고 `verifyStateOf` 가
    //   `candidate` 로 읽는다(엄격안 — 구버전 카드는 아직 검증 안 된 것).
    verifyState: VERIFY_STATES.has(fm.verifyState ?? '') ? (fm.verifyState as BrainVerifyState) : undefined,
    staleReports: fm.staleReports ? Number(fm.staleReports) || undefined : undefined,
    promotedFrom: fm.promotedFrom || undefined,
    anchors: anchors.length > 0 ? anchors : undefined,
    // §5.10 v3.81 — SSOT 축. 전부 optional 이라 구버전 카드는 값 없이 그대로 읽힌다.
    canonicalKey: fm.canonicalKey || undefined,
    appliesTo: fm.appliesTo ? parseAppliesTo(fm.appliesTo) : undefined,
    authority: AUTHORITIES.has(fm.authority ?? '') ? (fm.authority as BrainAuthority) : undefined,
    value: fm.value || undefined,
    verifiedAt: fm.verifiedAt ? Number(fm.verifiedAt) || undefined : undefined,
    reviewAfter: fm.reviewAfter ? Number(fm.reviewAfter) || undefined : undefined,
    observedCount: fm.observedCount ? Number(fm.observedCount) || undefined : undefined,
    observations: observations.length > 0 ? observations : undefined,
  };
  if (scope === 'project') card.agentId = undefined;
  return card;
}

// ─── §5.10 v3.78 유효기간 · 극성 · 앵커 ───

/**
 * **안 닫힌 카드인가** — 주입·주제 문서·색인·검색·요약·피드가 공유하는 단일 판정.
 *
 * v3.78 의 핵심 규약: 갱신은 옛 카드를 지우는 게 아니라 `validUntil` 을 채워 **닫는다**. 닫힌 카드는
 * 현재 상태 어디에도 나오지 않고 대체 체인 조회에서만 보인다(현재는 깨끗, 이력은 남는다).
 */
export function isOpenCard(card: BrainCard): boolean {
  return card.validUntil == null;
}

/** 화면·주입에 나올 자격 — 열려 있고 보관되지 않은 카드. ghost 는 포함(재검토 필요 표시일 뿐). */
function isLiveCard(card: BrainCard): boolean {
  return isOpenCard(card) && card.status !== 'archived';
}

/**
 * §5.10 v3.78 — **부정 극성**. "A 를 써라" vs "A 를 쓰지 마라"는 토큰이 대부분 겹쳐 Jaccard 가
 * 높게 나오는데, 종전 구현은 그걸 "동일"로 판정해 한 카드 안에 상반된 문장을 밀어 넣었다.
 * 극성이 뒤집혔는지를 따로 보면 그 경우를 **모순**으로 갈라낼 수 있다.
 */
export function hasNegation(text: string): boolean {
  return NEGATION_RE.test(text);
}

/** 카드/입력의 판정용 텍스트(제목 + 본문). */
function cardText(c: { title: string; body: string }): string {
  return `${c.title}\n${c.body}`;
}

/**
 * §5.10 v3.74 — 카드의 주제 자동 분류. 제목·본문·연결 파일 경로를 합쳐 `BRAIN_TOPICS` 패턴에
 * 순서대로 대보고 첫 일치를 쓴다(목록 순서 = 우선순위). 어디에도 안 걸리면 `misc`.
 *
 * 제목 가중을 위해 제목을 두 번 넣는다 — 본문에 지나가듯 나온 단어보다 제목이 주제를 더 잘 나타낸다.
 */
export function classifyTopic(input: { title: string; body?: string; files?: string[] }): string {
  const hay = `${input.title}\n${input.title}\n${input.body ?? ''}\n${(input.files ?? []).join('\n')}`;
  for (const t of BRAIN_TOPICS) {
    try {
      if (new RegExp(t.match, 'i').test(hay)) return t.slug;
    } catch {
      // 잘못된 패턴은 건너뛴다(상수 오타가 분류 전체를 막지 않도록).
    }
  }
  return BRAIN_TOPIC_MISC;
}

/**
 * §5.10 v3.78 — 파일 내용 해시(sha256 앞 `BRAIN_ANCHOR_SHA_LEN` 자). 없거나 너무 크면 undefined.
 * 저장·무효화 경로에서만 불리는 저빈도 연산이라 동기 read 로 충분하다(핫패스 아님).
 */
export function fileSha(absPath: string): string | undefined {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile() || st.size > BRAIN_ANCHOR_MAX_FILE_BYTES) return undefined;
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, BRAIN_ANCHOR_SHA_LEN);
  } catch {
    return undefined;
  }
}

/** git HEAD 짧은 해시(루트별 캐시 — 카드 여러 장을 연달아 저장할 때 git 을 반복 스폰하지 않는다). */
const headCache = new Map<string, { commit: string | undefined; at: number }>();
const HEAD_CACHE_TTL_MS = 30_000;

export function gitHead(root: string): string | undefined {
  const hit = headCache.get(root);
  const now = Date.now();
  if (hit && now - hit.at < HEAD_CACHE_TTL_MS) return hit.commit;
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    commit = undefined; // git 저장소가 아니거나 git 이 없다 — 앵커는 해시만으로도 동작한다.
  }
  headCache.set(root, { commit, at: now });
  return commit;
}

export class BrainService {
  private readonly root: string;
  private readonly index = new Map<string, IndexEntry>();
  private loaded = false;
  /** §5.10 v3.81 — frontmatter 가 깨져 인덱스에 못 실은 파일들(검역 목록). 삭제하지 않는다. */
  private quarantined: string[] = [];
  /** 참조 카운트 flush 대기(디바운스) — id → true. */
  private pendingRefFlush = new Set<string>();
  private refFlushTimer: NodeJS.Timeout | null = null;

  constructor(projectRoot: string) {
    this.root = projectRoot.replace(/\\/g, '/');
  }

  private brainRoot(): string {
    return path.join(this.root, BRAIN_SUBDIR);
  }
  private projectDir(): string {
    return path.join(this.brainRoot(), 'project');
  }
  private agentsDir(agentId?: string): string {
    return agentId
      ? path.join(this.brainRoot(), 'agents', agentId)
      : path.join(this.brainRoot(), 'agents');
  }
  /**
   * §5.10 v2 (G) — **운영자 프로필 층**(3층째). AI 가 관찰한 사용자 경향이 여기 산다.
   * CLAUDE.md 는 사람이 쓴 규칙, 이쪽은 AI 가 본 것 — 둘을 한 파일에 섞지 않는다.
   * **로컬 파일 뿐**이며 외부로 나가지 않는다(원격 사용자 모델링은 쓰지 않는다).
   */
  private userDir(): string {
    return path.join(this.brainRoot(), 'user');
  }
  /**
   * §5.10 v3.74 — 주제 문서 디렉터리(읽기용 파생물). 원본은 어디까지나 카드 파일.
   * v3.75 — agentId 를 주면 그 에이전트 전용 하위 디렉터리(두 층 모두 주제 축을 갖는다).
   */
  private topicsDir(agentId?: string): string {
    return agentId
      ? path.join(this.brainRoot(), 'topics', 'agents', agentId)
      : path.join(this.brainRoot(), 'topics');
  }
  /** §5.10 v3.74 — 주제 문서 절대 경로(색인에 실어 에이전트가 Read 로 바로 열게 한다). */
  topicDocPath(slug: string, agentId?: string): string {
    return path.join(this.topicsDir(agentId), `${slug}.md`).replace(/\\/g, '/');
  }
  /**
   * §5.10 v3.78 — 보관 카드가 사는 곳(`archive/project`, `archive/agents/<agentId>`).
   * **파일을 지우지 않고 옮긴다** — "정리됨" 목록에서 되돌릴 수 있어야 하고, 자동 삭제 금지 원칙과
   * 충돌하지 않아야 한다(휴지통과 같은 문법).
   */
  private archiveDir(scope: BrainCardScope, agentId?: string): string {
    if (scope === 'agent' && agentId) {
      return path.join(this.brainRoot(), BRAIN_ARCHIVE_DIRNAME, 'agents', agentId);
    }
    if (scope === 'user') return path.join(this.brainRoot(), BRAIN_ARCHIVE_DIRNAME, 'user');
    return path.join(this.brainRoot(), BRAIN_ARCHIVE_DIRNAME, 'project');
  }

  private cardFilePath(card: Pick<BrainCard, 'id' | 'scope' | 'agentId' | 'status'>): string {
    if (card.status === 'archived') return path.join(this.archiveDir(card.scope, card.agentId), `${card.id}.md`);
    const dir = card.scope === 'agent' && card.agentId
      ? this.agentsDir(card.agentId)
      : card.scope === 'user'
        ? this.userDir()
        : this.projectDir();
    return path.join(dir, `${card.id}.md`);
  }

  /** 디스크에서 lazy 로드(1회). 스캔 실패는 조용히 빈 인덱스. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.scanDir(this.projectDir(), 'project', undefined);
      const agentsRoot = this.agentsDir();
      if (fs.existsSync(agentsRoot)) {
        for (const ent of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
          if (ent.isDirectory()) this.scanDir(path.join(agentsRoot, ent.name), 'agent', ent.name);
        }
      }
      // §5.10 v2 (G) — 운영자 프로필 층. 폴더가 없으면 조용히 건너뛴다(축을 안 켠 사용자에겐 없다).
      this.scanDir(this.userDir(), 'user', undefined);
      // v3.78 — 보관 카드도 인덱스에 싣는다(되돌리기·이력 조회 대상이라 안 실으면 "정리됨" 목록이 빈다).
      this.scanDir(this.archiveDir('project'), 'project', undefined, true);
      this.scanDir(this.archiveDir('user'), 'user', undefined, true);
      const archAgents = path.join(this.brainRoot(), BRAIN_ARCHIVE_DIRNAME, 'agents');
      if (fs.existsSync(archAgents)) {
        for (const ent of fs.readdirSync(archAgents, { withFileTypes: true })) {
          if (ent.isDirectory()) this.scanDir(path.join(archAgents, ent.name), 'agent', ent.name, true);
        }
      }
    } catch (e) {
      logger.warn('[brain] initial scan failed', e as Error);
    }
    this.backfillTopics();
    this.repairSupersedeChains();
    if (this.quarantined.length > 0) {
      logger.warn(`[brain] 검역 ${this.quarantined.length}건 — frontmatter 가 깨져 읽지 못한 카드 파일: ${this.quarantined.slice(0, 3).join(', ')}`);
    }
  }

  /** §5.10 v3.81 — 검역된(파싱 실패) 카드 파일 경로들. 파일은 그대로 있고 사람이 고치면 살아난다. */
  listQuarantined(): string[] {
    this.ensureLoaded();
    return [...this.quarantined];
  }

  /**
   * §5.10 v3.81-C — **대체 거래 자가복구**(부팅 1회). 새 카드는 `supersedes` 를 담아 **먼저** 쓰이고
   * 옛 카드 닫기가 뒤따르는데, 그 사이에 죽으면 옛 카드가 열린 채 남는다. 의도는 새 카드 파일에
   * 이미 적혀 있으므로 로더가 그것만 보고 거래를 완료한다 — 저널·잠금 파일이 필요 없는 이유.
   */
  private repairSupersedeChains(): void {
    const repairs = findSupersedeRepairs([...this.index.values()].map((e) => e.card));
    if (repairs.length === 0) return;
    for (const { old, by } of repairs) {
      old.validUntil = by.createdAt;
      old.supersededBy = by.id;
      old.updatedAt = Date.now();
      try { this.writeCard(old); } catch { /* best effort — 다음 부팅에 다시 시도된다 */ }
    }
    logger.info(`[brain] supersede 거래 복구: ${repairs.length}건(중단된 승격을 완료)`);
  }

  /**
   * §5.10 v3.74 — 구버전 프로젝트 카드(`topic` 없음)에 주제를 채운다.
   * 채운 뒤엔 frontmatter 에 남으므로 **1회성**(다음 부팅부터 0건). 실패해도 조용히 넘어가고,
   * 메모리 카드에는 어차피 분류 결과가 들어가므로 색인/문서는 정상 동작한다.
   */
  private backfillTopics(): void {
    let n = 0;
    for (const entry of [...this.index.values()]) {
      const c = entry.card;
      if (c.topic) continue;
      c.topic = classifyTopic(c);
      try { this.writeCard(c); n++; } catch { /* best effort */ }
    }
    if (n > 0) logger.info(`[brain] topic backfill: ${n} card(s) classified`);
  }

  /** `archived` = true 면 그 디렉터리에서 읽은 카드의 상태를 보관으로 고정(위치가 진실). */
  private scanDir(dir: string, scope: BrainCardScope, agentId?: string, archived = false): void {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const filePath = path.join(dir, ent.name);
      const id = ent.name.replace(/\.md$/, '');
      try {
        const stat = fs.statSync(filePath);
        const text = fs.readFileSync(filePath, 'utf8');
        const card = parseCard(text, { scope, agentId, id });
        if (!card) {
          // v3.81 — **검역.** 사람이 직접 고치다 frontmatter 를 깨뜨린 파일은 조용히 사라지는 대신
          //   목록에 남아 보고된다(제약: "스키마가 잘못된 수동 편집 파일을 조용히 현재 진실로
          //   편입하지 말고 검역 또는 오류 보고"). 파일은 그대로 두고 인덱스에만 안 넣는다.
          this.quarantined.push(filePath.replace(/\\/g, '/'));
          continue;
        }
        if (archived) card.status = 'archived';
        else if (card.status === 'archived') card.status = 'active'; // 사람이 되돌려 놓은 파일 존중.
        this.index.set(card.id, { card, filePath, mtimeMs: stat.mtimeMs });
      } catch { /* 손상 파일 skip */ }
    }
  }

  /** mtime 이 바뀌었으면 디스크에서 다시 읽어 인덱스 갱신(사람이 직접 편집한 경우 반영). */
  private refreshIfStale(id: string): void {
    const entry = this.index.get(id);
    if (!entry) return;
    try {
      const stat = fs.statSync(entry.filePath);
      if (stat.mtimeMs === entry.mtimeMs) return;
      const text = fs.readFileSync(entry.filePath, 'utf8');
      const card = parseCard(text, { scope: entry.card.scope, agentId: entry.card.agentId, id });
      if (card) this.index.set(id, { card, filePath: entry.filePath, mtimeMs: stat.mtimeMs });
    } catch { /* 삭제됐으면 다음 스캔에서 정리 */ }
  }

  private writeCard(card: BrainCard): void {
    const filePath = this.cardFilePath(card);
    try {
      atomicWriteFileSync(filePath, serializeCard(card));
    } catch (err) {
      // v3.71: 죽은 워크트리(`.git` 없음) 루트면 atomicWriteFileSync 가 거부한다 — 폴더를
      // 되살리지 않기 위함. 인덱스도 갱신하지 않아 "저장됐다"고 착각하지 않는다.
      logger.warn(`brain: card write skipped (${card.id}): ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    let mtimeMs = Date.now();
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { /* best effort */ }
    this.index.set(card.id, { card, filePath, mtimeMs });
  }

  // ─── public API ───

  /**
   * 카드 목록(옵션: scope/agentId 필터). 최신 갱신순.
   *
   * v3.78 — 기본은 **열려 있고 보관되지 않은** 카드만. 닫힌 카드(대체됨)/보관 카드는 현재 상태가
   * 아니라 이력이므로 `includeClosed`·`includeArchived` 를 명시할 때만 나온다.
   */
  listCards(filter?: {
    scope?: BrainCardScope;
    agentId?: string;
    includeClosed?: boolean;
    includeArchived?: boolean;
  }): BrainCard[] {
    this.ensureLoaded();
    let cards = [...this.index.values()].map((e) => e.card);
    if (filter?.scope) cards = cards.filter((c) => c.scope === filter.scope);
    if (filter?.agentId) cards = cards.filter((c) => c.agentId === filter.agentId);
    if (!filter?.includeClosed) cards = cards.filter(isOpenCard);
    if (!filter?.includeArchived) cards = cards.filter((c) => c.status !== 'archived');
    return cards.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * §5.10 v3.78 — **대체 이력 체인**. 이 카드가 닫은 옛 카드들(과거 방향) + 이 카드를 닫은
   * 새 카드들(현재 방향)을 한 번에 돌려준다. 기억 화면 카드 상세의 "왜 바뀌었는지" 뷰.
   */
  getSupersedeChain(id: string): { older: BrainCard[]; newer: BrainCard[] } {
    this.ensureLoaded();
    const card = this.index.get(id)?.card;
    if (!card) return { older: [], newer: [] };
    const older: BrainCard[] = [];
    for (const oid of card.supersedes ?? []) {
      const c = this.index.get(oid)?.card;
      if (c) older.push(c);
    }
    const newer: BrainCard[] = [];
    let cursor = card.supersededBy;
    const guard = new Set<string>([id]);
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const c = this.index.get(cursor)?.card;
      if (!c) break;
      newer.push(c);
      cursor = c.supersededBy;
    }
    return { older, newer };
  }

  getCard(id: string): BrainCard | undefined {
    this.ensureLoaded();
    this.refreshIfStale(id);
    return this.index.get(id)?.card;
  }

  /**
   * §5.10 v3.78 — **카드 저장 단일 창구. 카드는 한 번 쓰이면 불변이다.**
   *
   * 같은 층(+에이전트)의 **열린** 카드 중 토큰 겹침 상위 `BRAIN_SUPERSEDE_CANDIDATE_MAX` 장을
   * **동일 / 보완 / 모순**으로 3분류한다.
   *
   * - **동일**(겹침 ≥ `BRAIN_DEDUP_JACCARD_THRESHOLD` 이면서 극성 동일) → 새 카드를 만들지 않고
   *   기존 카드의 **참조 시각만** 갱신한다. 종전처럼 본문에 `— 갱신(날짜):` 를 append 하지 않는다 —
   *   그 append 가 본문을 불려 Jaccard 분모를 키웠고, 그래서 **다음번엔 같은 지식이 문턱을 못 넘어
   *   새 카드로 분기**했다(자주 배우는 주제일수록 중복이 늘어나는 자기모순).
   * - **모순**(입력의 `contradicts` 지목, 또는 겹침 ≥ `BRAIN_CONTRADICT_JACCARD_MIN` 이면서 부정
   *   극성이 뒤집힘) → 새 카드를 만들고 **옛 카드를 닫는다**(`validUntil` = 새 카드 시작 시각,
   *   `supersededBy`). 옛 요지 한 줄은 새 카드 `supersededNote` 에 남아 이력이 끊기지 않는다.
   * - **보완** → 그냥 새 카드.
   *
   * 저장과 동시에 연결 파일의 **코드 앵커**(내용 해시 + git HEAD)를 박는다 — 이후 그 파일이
   * Edit/Write 되면 `noteFilesEdited` 가 이 카드를 "확인 필요"로 전이시킨다.
   */
  saveCard(input: BrainCardInput): BrainCard {
    return this.saveCardDetailed(input).card;
  }

  /**
   * §5.10 v3.81-F — **키가 있는 입력의 저장.** 유사도가 아니라 **슬롯**(`canonicalKey`+범위)으로 판정한다.
   *
   * - 슬롯이 비어 있으면 → `candidate` 로 저장(현재 진실이 되려면 검증이 따로 필요하다).
   * - 슬롯에 같은 값이 이미 있으면 → **카드를 늘리지 않고 관찰만 적립**(요건 3). 권위가 더 높으면 승격.
   * - 슬롯에 다른 값이 있으면 → 새 candidate 를 만들고 **기존 것을 `contested` 로**. 옛 값을 덮거나
   *   지우지 않는다 — 그리고 그 슬롯은 current 를 잃는다(요건 5, "어느 값도 임의로 진실이 되지 않는다").
   *
   * 반환이 null 이면 "키 경로가 아니다"라는 뜻이라 호출부가 기존 유사도 경로로 넘어간다.
   */
  private saveIntoSlot(input: BrainCardInput, now: number): BrainSaveResult | null {
    const key = input.canonicalKey?.trim();
    if (!key) return null;
    const scopeKey = scopeKeyOf(input.appliesTo);
    const slot = slotKey(key, scopeKey);
    const authority: BrainAuthority = input.authority ?? 'ai-inference';

    // 같은 슬롯의 **열린** 카드들(검증 상태와 무관 — candidate 끼리도 값이 같으면 합쳐야 한다).
    const inSlot = [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => c.canonicalKey === key
        && slotKey(c.canonicalKey, scopeKeyOf(c.appliesTo)) === slot
        && isLiveCard(c));

    const sameValue = (c: BrainCard): boolean => {
      if (input.value && c.value) return c.value.trim().toLowerCase() === input.value.trim().toLowerCase();
      if (input.value || c.value) return false; // 한쪽만 값이 있으면 같다고 볼 근거가 없다
      // 값이 없으면 진술문(제목)으로 본다. 이미 같은 슬롯이라 문턱은 이행 감사와 같은 축을 쓴다.
      return jaccard(charBigrams(c.title), charBigrams(input.title)) >= BRAIN_MIGRATION_DUP_TITLE_MIN;
    };

    const twin = inSlot.find(sameValue);
    if (twin) {
      // 같은 값의 재발견 — **카드를 만들지 않는다.** 관찰만 적립하고 권위를 끌어올린다.
      const obs: BrainObservation = {
        at: now,
        ...(input.sourceSessionId ? { sessionId: input.sourceSessionId } : {}),
        authority,
      };
      twin.observations = [...(twin.observations ?? []), obs].slice(-BRAIN_OBSERVATION_KEEP);
      twin.observedCount = (twin.observedCount ?? 0) + 1;
      twin.authority = strongerAuthority(authorityOf(twin), authority);
      twin.lastReferencedAt = now;
      twin.updatedAt = now;
      this.writeCard(twin);
      return { card: twin, outcome: 'same', closedIds: [] };
    }

    // 값이 다르다 — 새 candidate 를 만든다. 옛 값을 덮거나 지우지 ❌.
    const card = this.buildCard(input, now, 'candidate', authority);
    this.writeCard(card);

    // **누가 현재 진실을 흔들 수 있는가는 권위가 정한다.** 새 주장의 권위가 기존 것보다 낮으면
    // 기존 진실을 끌어내리지 않고 후보로만 남긴다 — 안 그러면 AI 추론 한 줄이 사용자가 승인한
    // 진실을 매번 무효화해(= current 소실) 시스템이 침묵하게 된다. 권위가 같거나 높을 때만
    // 진짜 충돌로 보고 양쪽 다 `contested` 로 내린다(요건 5 — 그때는 아무도 현재 진실이 아니다).
    const rank = (a: BrainAuthority): number => BRAIN_AUTHORITY_RANK[a] ?? 0;
    const challenged = inSlot.filter((o) => rank(authority) >= rank(authorityOf(o)));
    for (const other of challenged) {
      const st = verifyStateOf(other);
      if (st === 'verified' || st === 'candidate') {
        other.verifyState = 'contested';
        other.updatedAt = now;
        this.writeCard(other);
      }
    }
    if (challenged.length > 0) {
      card.verifyState = 'contested';
      this.writeCard(card);
      logger.info(`[brain] 슬롯 충돌 — ${slot} 에 값이 ${challenged.length + 1}개(current 없음, 검토 큐로)`);
    } else if (inSlot.length > 0) {
      logger.info(`[brain] 슬롯 ${slot} 에 권위가 낮은 다른 값이 후보로 접수됨(현재 진실은 유지)`);
    }
    this.enforceBudgets(card.scope === 'agent' ? card.agentId : undefined, card.scope);
    this.rebuildTopicDocs(card.scope === 'agent' ? card.agentId : undefined);
    return { card, outcome: 'new', closedIds: [] };
  }

  /** 입력 → 새 카드 객체(주제 분류·앵커·검증 상태 포함). 저장은 호출부가 한다. */
  private buildCard(input: BrainCardInput, now: number, verifyState: BrainVerifyState, authority?: BrainAuthority): BrainCard {
    const card: BrainCard = {
      id: newCardId(),
      type: input.type,
      scope: input.scope,
      agentId: input.scope === 'agent' ? input.agentId : undefined,
      title: escapeScalar(input.title).slice(0, 200) || '(제목 없음)',
      body: input.body ?? '',
      files: [...(input.files ?? [])],
      sourceSessionId: input.sourceSessionId,
      createdAt: now,
      updatedAt: now,
      refCount: 0,
      pinned: input.pinned || undefined,
      status: 'active',
      seen: input.seen ?? false,
      always: input.scope === 'project' && input.type === 'rule' ? (input.always || undefined) : undefined,
      promotedFrom: input.promotedFrom || undefined,
      verifyState,
      ...(input.canonicalKey ? { canonicalKey: input.canonicalKey.trim() } : {}),
      ...(input.appliesTo ? { appliesTo: input.appliesTo } : {}),
      ...(authority ? { authority } : {}),
      ...(input.value ? { value: input.value } : {}),
    };
    card.topic = input.topic || classifyTopic(card);
    card.anchors = this.buildAnchors(card.files);
    return card;
  }

  /** `saveCard` 의 판정 결과까지 돌려주는 형태(REST 응답·테스트·로그용). */
  saveCardDetailed(input: BrainCardInput): BrainSaveResult {
    this.ensureLoaded();
    const now = Date.now();
    // v3.81 — 진실 주소가 있으면 슬롯 규칙이 우선한다(유사도는 키 없는 증거 카드에만 남는다).
    const bySlot = this.saveIntoSlot(input, now);
    if (bySlot) return bySlot;
    const inputText = cardText({ title: input.title, body: input.body });
    const inputTokens = tokenize(inputText);
    const inputGrams = charBigrams(inputText);
    const inputNeg = hasNegation(inputText);

    // 후보 = 같은 층/에이전트의 **열린** 카드(닫힌 카드는 이미 과거라 다시 닫을 것도, 겹칠 것도 없다).
    // `score` = 토큰 Jaccard(동일 판정용, 종전 그대로) / `gram` = 문자 bigram(모순 판정용).
    const scored: { card: BrainCard; score: number; gram: number }[] = [];
    for (const { card } of this.index.values()) {
      if (card.scope !== input.scope) continue;
      if (input.scope === 'agent' && card.agentId !== input.agentId) continue;
      if (!isLiveCard(card)) continue;
      const text = cardText(card);
      const score = jaccard(inputTokens, tokenize(text));
      const gram = jaccard(inputGrams, charBigrams(text));
      if (score > 0 || gram > 0) scored.push({ card, score, gram });
    }
    scored.sort((a, b) => (b.score - a.score) || (b.gram - a.gram));
    const candidates = scored.slice(0, BRAIN_SUPERSEDE_CANDIDATE_MAX);

    // 리플렉션이 명시 지목한 모순 대상(제일 강한 신호 — 유사도 계산을 건너뛴다).
    const explicit = input.contradicts ? this.index.get(input.contradicts)?.card : undefined;
    const explicitOk = explicit
      && explicit.scope === input.scope
      && (input.scope !== 'agent' || explicit.agentId === input.agentId)
      && isLiveCard(explicit);

    const toClose: BrainCard[] = [];
    if (explicitOk && explicit) toClose.push(explicit);

    for (const { card, score, gram } of candidates) {
      if (toClose.some((c) => c.id === card.id)) continue;
      const negFlip = hasNegation(cardText(card)) !== inputNeg;
      if (score >= BRAIN_DEDUP_JACCARD_THRESHOLD && !negFlip) {
        // 동일 — 이미 아는 것이다. **참조 시각만** 올리고 끝낸다(본문 불변).
        // refCount 는 올리지 않는다. 그 값의 의미는 "에이전트에게 노출된 임프레션"이고, 랭킹은
        // "많이 노출됐는데 helpful 0 이면 강등"으로 읽는다 — 재추출을 노출로 세면 **자주 배우는
        // 지식일수록 강등**되는 거꾸로 된 신호가 된다.
        card.lastReferencedAt = now;
        this.pendingRefFlush.add(card.id);
        this.scheduleRefFlush();
        return { card, outcome: 'same', closedIds: [] };
      }
      // 모순 = "같은 대상 이야기(bigram 겹침)" + "지시가 뒤집혔다(부정 극성 반전)".
      if (Math.max(score, gram) >= BRAIN_CONTRADICT_JACCARD_MIN && negFlip) toClose.push(card);
    }

    // v3.81 — 키 없는 카드도 `candidate` 로 시작한다(저장됐다 ≠ 진실이다).
    const card = this.buildCard(input, now, 'candidate', input.authority);

    // v3.81-C — **쓰기 순서를 뒤집었다.** 종전에는 옛 카드를 먼저 닫고 새 카드를 나중에 써서, 그
    //   사이에 죽으면 진실이 통째로 증발했다(옛 것은 닫혔는데 새 것은 없다). 이제 의도(`supersedes`)를
    //   담은 새 카드를 **먼저** 원자적으로 쓰고, 옛 카드 닫기는 그 뒤에 한다 — 중간에 죽어도 부팅
    //   로더(`repairSupersedeChains`)가 새 카드만 보고 거래를 완료할 수 있다. 저널·잠금 불필요.
    const closedIds = toClose.map((c) => c.id);
    if (closedIds.length > 0) {
      card.supersedes = closedIds;
      // 이전 내용 "요지 한 줄"만 남긴다(본문 전량 복사 ❌ — 그러면 카드가 append 시절로 돌아간다).
      const notes = toClose.map((old) =>
        `${old.title}${old.body ? ` — ${(old.body.split('\n').find((l) => l.trim()) ?? '').trim()}` : ''}`);
      card.supersededNote = escapeScalar(notes.join(' / ')).slice(0, 400);
    }
    this.writeCard(card);

    // 모순 카드 닫기 — 삭제 ❌. 새 카드의 시작 시각이 옛 카드의 종료 시각이 된다(유효기간 2축).
    for (const old of toClose) {
      old.validUntil = now;
      old.supersededBy = card.id;
      old.updatedAt = now;
      this.writeCard(old);
    }

    this.enforceBudgets(card.scope === 'agent' ? card.agentId : undefined, card.scope);
    this.rebuildTopicDocs(card.scope === 'agent' ? card.agentId : undefined);
    return { card, outcome: closedIds.length > 0 ? 'superseded' : 'new', closedIds };
  }

  /**
   * §5.10 v3.78 — 연결 파일들의 코드 앵커를 만든다(내용 해시 + 저장 시점 git HEAD).
   * 파일이 없거나 너무 크면 해시 없이 경로만 박는다 — 그래도 "그 파일이 편집됐다"는 세지므로
   * 무효화 신호는 살아 있다.
   */
  private buildAnchors(files: string[]): BrainAnchor[] | undefined {
    if (files.length === 0) return undefined;
    const commit = gitHead(this.root);
    const at = Date.now();
    return files.map((f) => {
      const abs = path.isAbsolute(f) ? f : path.join(this.root, f);
      const sha = fileSha(abs);
      return { path: f, ...(sha ? { sha } : {}), ...(commit ? { commit } : {}), at };
    });
  }

  /**
   * 부분 업데이트(사용자 편집). undefined 필드는 기존값 유지(PUT-wipe 함정 회피).
   * scope/agentId 변경은 promoteCard 를 쓴다(파일 이동 필요) — 여기서는 무시.
   */
  updateCard(id: string, partial: Partial<Omit<BrainCard, 'id' | 'scope' | 'agentId' | 'createdAt'>>): BrainCard | null {
    this.ensureLoaded();
    this.refreshIfStale(id);
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    if (partial.type !== undefined) c.type = partial.type;
    if (partial.title !== undefined) c.title = escapeScalar(partial.title);
    if (partial.body !== undefined) c.body = partial.body;
    if (partial.files !== undefined) c.files = [...partial.files];
    if (partial.sourceSessionId !== undefined) c.sourceSessionId = partial.sourceSessionId;
    if (partial.lastReferencedAt !== undefined) c.lastReferencedAt = partial.lastReferencedAt;
    if (partial.refCount !== undefined) c.refCount = partial.refCount;
    if (partial.pinned !== undefined) c.pinned = partial.pinned || undefined;
    if (partial.status !== undefined) c.status = partial.status;
    if (partial.supersededNote !== undefined) c.supersededNote = partial.supersededNote;
    if (partial.seen !== undefined) c.seen = partial.seen;
    // v3.74 — 주제/상시 규칙 수기 지정(피드 편집·REST). 프로젝트 층에서만 의미.
    if (partial.topic !== undefined) c.topic = partial.topic || classifyTopic(c);
    if (partial.always !== undefined) c.always = (c.scope === 'project' && c.type === 'rule' && partial.always) || undefined;
    // v3.81 — SSOT 축 수기 편집(기억 화면·REST·마이그레이션). undefined 는 기존값 유지.
    if (partial.canonicalKey !== undefined) c.canonicalKey = partial.canonicalKey?.trim() || undefined;
    if (partial.appliesTo !== undefined) c.appliesTo = partial.appliesTo;
    if (partial.authority !== undefined) c.authority = partial.authority;
    if (partial.value !== undefined) c.value = partial.value || undefined;
    if (partial.reviewAfter !== undefined) c.reviewAfter = partial.reviewAfter;
    if (partial.verifyState !== undefined) c.verifyState = partial.verifyState;
    // v3.81 — 대체 체인 3필드도 부분 업데이트 대상이다. 종전에는 여기 없어서 REST·테스트가
    //   "닫힌 카드"를 만들 수 없었고, 승격 중단 시나리오를 재현할 수단도 없었다.
    if (partial.validUntil !== undefined) c.validUntil = partial.validUntil;
    if (partial.supersededBy !== undefined) c.supersededBy = partial.supersededBy;
    if (partial.supersedes !== undefined) c.supersedes = partial.supersedes;
    // v3.78 → v3.81 — 사람이 본문·연결 파일을 손봤다는 건 내용이 달라졌다는 뜻이다. 앵커를 현재
    //   해시로 다시 박되, **검증은 자동으로 회복시키지 않는다**(편집 ≠ 확인). 후보로 되돌리고
    //   사용자가 [현재 진실로 확인]을 누르면 그때 올라간다 — 편집이 곧 승격이던 자리가
    //   "손대기만 해도 진실이 되는" 구멍이었다.
    if (partial.body !== undefined || partial.files !== undefined || partial.title !== undefined) {
      c.anchors = this.buildAnchors(c.files);
      c.staleReports = undefined;
      if (partial.verifyState === undefined) c.verifyState = 'candidate';
    }
    c.updatedAt = Date.now();
    this.writeCard(c);
    // v3.74 — 문서 내용에 반영되는 변경일 때만 재생성(markSeen 등 표시용 갱신에서 헛돌지 않게).
    const affectsDoc = partial.type !== undefined || partial.title !== undefined || partial.body !== undefined
      || partial.files !== undefined || partial.topic !== undefined || partial.status !== undefined;
    if (affectsDoc) this.rebuildTopicDocs(c.scope === 'agent' ? c.agentId : undefined);
    return c;
  }

  deleteCard(id: string): boolean {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return false;
    const wasAgentId = entry.card.scope === 'agent' ? entry.card.agentId : undefined;
    try { fs.rmSync(entry.filePath, { force: true }); } catch { /* best effort */ }
    this.index.delete(id);
    this.pendingRefFlush.delete(id);
    this.rebuildTopicDocs(wasAgentId);
    return true;
  }

  /** 개별(agent) 카드를 프로젝트 두뇌로 승격 — 이동(복사 ❌). 파일 삭제 후 project 로 재기록. */
  promoteCard(id: string): BrainCard | null {
    this.ensureLoaded();
    this.refreshIfStale(id);
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    if (c.scope === 'project') return c;
    const oldPath = entry.filePath;
    // v3.75 — 떠나는 층(에이전트)의 문서도 재생성 대상이다. 안 그러면 승격된 카드가
    //   그 에이전트 주제 문서에 그대로 남아 두 층에 겹쳐 보인다(테스트가 잡은 결함).
    const fromAgentId = c.agentId;
    c.scope = 'project';
    c.agentId = undefined;
    // v3.78 — **원 소유 에이전트 링크를 남긴다.** 종전 승격은 순수 이동이라 그 에이전트가 자기가
    //   키운 지식을 통째로 잃었다(두 층 분리의 취지와 어긋난다). 링크가 남으면 에이전트 스코프에서도
    //   "내가 올린 기억"으로 되짚을 수 있다.
    if (fromAgentId) c.promotedFrom = fromAgentId;
    c.updatedAt = Date.now();
    // v3.74 — 에이전트 층엔 주제가 없으므로 승격 시점에 분류한다(프로젝트 층은 주제 필수).
    if (!c.topic) c.topic = classifyTopic(c);
    // v3.78 — 층이 바뀌면 앵커 기준도 새로 잡는다(프로젝트 층은 코드에 매인 지식).
    c.anchors = this.buildAnchors(c.files);
    this.writeCard(c); // project 위치에 새로 기록(index 의 filePath 갱신)
    const newPath = this.cardFilePath(c);
    if (path.resolve(oldPath) !== path.resolve(newPath)) {
      try { fs.rmSync(oldPath, { force: true }); } catch { /* best effort */ }
    }
    this.rebuildTopicDocs();
    if (fromAgentId) this.rebuildTopicDocs(fromAgentId);
    return c;
  }

  /** "최근 저장" 검토함 확인 — seen=true. */
  markSeen(id: string): BrainCard | null {
    return this.updateCard(id, { seen: true });
  }

  /**
   * 경량 텍스트 검색 — 벡터·새 의존성 없음. title 토큰 매치×3 + body×1 + 파일 경로 세그먼트×2,
   * 동점은 최근 참조/갱신순. 두 층 합산(scope 필터 없으면 프로젝트+에이전트 전부).
   */
  search(query: string, opts?: { scope?: BrainCardScope; agentId?: string; limit?: number }): BrainCard[] {
    this.ensureLoaded();
    const qTokens = tokenize(query);
    const qBigrams = charBigrams(query);
    if (qTokens.size === 0 && qBigrams.size === 0) return [];
    const limit = opts?.limit ?? BRAIN_SEARCH_MAX_RESULTS;
    const scored: { card: BrainCard; score: number }[] = [];
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') continue;
      // v3.78 — 닫힌 카드(대체됨)는 현재 사실이 아니다. 검색에도 나오지 않는다.
      if (!isOpenCard(card)) continue;
      if (opts?.scope && card.scope !== opts.scope) continue;
      if (opts?.agentId && card.scope === 'agent' && card.agentId !== opts.agentId) continue;
      const titleT = tokenize(card.title);
      const bodyT = tokenize(card.body);
      const fileT = tokenize(card.files.join(' '));
      let score = 0;
      for (const t of qTokens) {
        if (titleT.has(t)) score += 3;
        if (bodyT.has(t)) score += 1;
        if (fileT.has(t)) score += 2;
      }
      // §5.10 v2 (C) — 어절이 하나도 안 맞을 때만 문자 bigram 으로 한 번 더 본다.
      //   한국어는 조사·어미가 붙어 "수집기"로 "수집기는"을 못 찾는데, 실측에서 카드 327장 중
      //   263장(80%)이 한 번도 노출된 적 없던 것의 일부가 바로 이 미스였다.
      //   어절이 맞은 카드의 순위는 건드리지 않으려고 **0점일 때만** 적용하고 최저 점수를 준다.
      if (score === 0 && qBigrams.size > 0) {
        const hayB = charBigrams(`${card.title} ${card.body} ${card.files.join(' ')}`);
        if (coverage(qBigrams, hayB) >= BRAIN_BIGRAM_MIN_SCORE) score = 1;
      }
      if (score > 0) scored.push({ card, score });
    }
    // v3.49 — 토큰 필터를 통과한 후보를 랭킹 함수로 정렬(관련도 우세 — ctx.text=query, ghost 유지).
    const ranked = this.rankCards(scored.map((s) => s.card), { text: query }, { includeHidden: true });
    return ranked.slice(0, limit).map((r) => r.card);
  }

  /**
   * §5.10 v3.49 유튜브식 랭킹 — score = W_RELEVANCE·관련도 + W_HELPFUL·도움률 + W_FRESHNESS·신선도
   * + W_PINNED·pinned(가중치 합 1.0). 관련도 = ctx.text 토큰 매칭(title×3/body×1/files×2 를 qTokens×3 로
   * 정규화, 0..1) + ctx.files 경로 겹침(매칭 파일수/ctx.files수). ctx 가 아예 없으면 0.5 중립.
   * 도움률 = (helpfulCount+α)/(refCount+β) Laplace 스무딩(0..1 clamp). 신선도 =
   * 2^(-(now-max(updatedAt,lastHelpfulAt))/HALF_LIFE). 노출(refCount)≥임계인데 helpful 0 이면 강등 계수를 곱한다.
   * status ghost/archived 는 기본 제외(opts.includeHidden 로 포함 — 검색은 ghost 유지).
   */
  rankCards(
    cards: BrainCard[],
    ctx: { text?: string; files?: string[] },
    opts?: { includeHidden?: boolean },
  ): Array<{ card: BrainCard; score: number }> {
    const now = Date.now();
    const hasText = !!ctx.text?.trim();
    const hasFiles = !!(ctx.files && ctx.files.length > 0);
    const qTokens = hasText ? tokenize(ctx.text as string) : null;
    const out: Array<{ card: BrainCard; score: number }> = [];
    for (const card of cards) {
      // v3.78 — 닫힌 카드는 includeHidden 과 무관하게 랭킹 대상이 아니다(현재 상태가 아니므로).
      if (!isOpenCard(card)) continue;
      if (!opts?.includeHidden && (card.status === 'ghost' || card.status === 'archived')) continue;
      // 관련도(0..1)
      let rel: number;
      if (!hasText && !hasFiles) {
        rel = 0.5;
      } else {
        let textRel = 0;
        if (qTokens && qTokens.size > 0) {
          const titleT = tokenize(card.title);
          const bodyT = tokenize(card.body);
          const fileT = tokenize(card.files.join(' '));
          let s = 0;
          for (const t of qTokens) {
            if (titleT.has(t)) s += 3;
            if (bodyT.has(t)) s += 1;
            if (fileT.has(t)) s += 2;
          }
          textRel = Math.min(1, s / (qTokens.size * 3));
        }
        let fileRel = 0;
        if (hasFiles) {
          let m = 0;
          for (const f of ctx.files as string[]) if (fileListMatches(card.files, f)) m++;
          fileRel = (ctx.files as string[]).length > 0 ? m / (ctx.files as string[]).length : 0;
        }
        if (hasText && hasFiles) rel = Math.min(1, 0.6 * textRel + 0.4 * fileRel);
        else rel = hasText ? textRel : fileRel;
      }
      // 도움률(Laplace 스무딩, 0..1)
      const helpful = card.helpfulCount ?? 0;
      const helpfulRate = Math.min(
        1,
        (helpful + BRAIN_HELPFUL_SMOOTH_ALPHA) / (card.refCount + BRAIN_HELPFUL_SMOOTH_BETA),
      );
      // 신선도(0..1) — 도움됨 시각도 활동으로 인정.
      const lastActive = Math.max(card.updatedAt, card.lastHelpfulAt ?? 0);
      const freshness = Math.pow(2, -(now - lastActive) / BRAIN_FRESHNESS_HALF_LIFE_MS);
      let score =
        BRAIN_RANK_W_RELEVANCE * rel +
        BRAIN_RANK_W_HELPFUL * helpfulRate +
        BRAIN_RANK_W_FRESHNESS * freshness +
        BRAIN_RANK_W_PINNED * (card.pinned ? 1 : 0);
      // 낡은 기억 자동 침전 — 많이 노출됐는데 도움 0 이면 강등.
      if (card.refCount >= BRAIN_DEMOTE_IMPRESSION_MIN && helpful === 0) score *= BRAIN_DEMOTE_FACTOR;
      out.push({ card, score });
    }
    out.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ar = a.card.lastReferencedAt ?? a.card.updatedAt;
      const br = b.card.lastReferencedAt ?? b.card.updatedAt;
      return br - ar;
    });
    return out;
  }

  /**
   * §5.10 v3.49 — 우더블클릭 피드(유튜브 홈 방식). pool = 요청 scope 정확히(project 카드 또는 그 agent 카드),
   * active(ghost/archived 제외)만. 섹션 4종을 각 BRAIN_FEED_SECTION_SIZE 상한으로 채우고,
   * related>recent>frequent>resurface 우선순위로 섹션 간 중복을 제거한다.
   * - related: rankCards top(ctx 없으면 도움률·신선도 폴백). agent scope 면 project 카드도 후보에 합류(scope 필드로 층 표시).
   * - recent: createdAt 내림차순(최근 배운 것).
   * - frequent: helpfulCount>0 을 helpfulCount 내림차순(자주 쓰는=도움됨 상위).
   * - resurface: 미참조이거나 마지막 참조 후 BRAIN_RESURFACE_MIN_AGE_MS 초과 — 오래된 참조 우선(필터버블 방지).
   * totalCount = pool 크기.
   */
  getFeed(opts: {
    scope: BrainCardScope;
    agentId?: string;
    ctx?: { text?: string; files?: string[] };
  }): BrainFeed {
    this.ensureLoaded();
    const ctx = opts.ctx ?? {};
    const isActive = (c: BrainCard): boolean => isOpenCard(c) && c.status !== 'archived' && c.status !== 'ghost';
    const pool = (opts.scope === 'agent'
      ? this.listCards({ scope: 'agent', agentId: opts.agentId })
      : this.listCards({ scope: 'project' })
    ).filter(isActive);
    const relatedPool = opts.scope === 'agent'
      ? [...pool, ...this.listCards({ scope: 'project' }).filter(isActive)]
      : pool;

    const used = new Set<string>();
    const take = (sorted: BrainCard[]): BrainCard[] => {
      const picked: BrainCard[] = [];
      for (const c of sorted) {
        if (used.has(c.id)) continue;
        picked.push(c);
        used.add(c.id);
        if (picked.length >= BRAIN_FEED_SECTION_SIZE) break;
      }
      return picked;
    };

    const now = Date.now();
    const related = take(this.rankCards(relatedPool, ctx).map((r) => r.card));
    const recent = take([...pool].sort((a, b) => b.createdAt - a.createdAt));
    const frequent = take(
      pool.filter((c) => (c.helpfulCount ?? 0) > 0)
        .sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0)),
    );
    const resurface = take(
      pool.filter((c) => c.lastReferencedAt == null || now - c.lastReferencedAt > BRAIN_RESURFACE_MIN_AGE_MS)
        .sort((a, b) => (a.lastReferencedAt ?? 0) - (b.lastReferencedAt ?? 0)),
    );

    const sections: Record<BrainFeedSectionKey, BrainCard[]> = { related, recent, frequent, resurface };
    return { sections, totalCount: pool.length };
  }

  /** 특정 파일들에 연결된 실수/교훈 카드(파일 접근 경고용). 보관·닫힌 카드 제외. */
  getCardsForFiles(filePaths: string[]): BrainCard[] {
    this.ensureLoaded();
    const out: BrainCard[] = [];
    for (const { card } of this.index.values()) {
      if (!isLiveCard(card)) continue;
      if (card.type !== 'mistake' && card.type !== 'lesson') continue;
      if (card.files.length === 0) continue;
      if (filePaths.some((fp) => fileListMatches(card.files, fp))) out.push(card);
    }
    return out;
  }

  /**
   * 참조 반영 — refCount++/lastReferencedAt 갱신(메모리 즉시, 파일 flush 는 디바운스).
   * 주입/검색 폭주 시 파일 쓰기 폭주를 막는다.
   */
  touchReferences(cardIds: string[]): void {
    this.ensureLoaded();
    const now = Date.now();
    for (const id of cardIds) {
      const entry = this.index.get(id);
      if (!entry) continue;
      entry.card.refCount += 1;
      entry.card.lastReferencedAt = now;
      // ghost 였는데 참조되면 활성 복귀(파일이 다시 존재한다는 신호일 수 있음 — sweep 이 재판정).
      this.pendingRefFlush.add(id);
    }
    this.scheduleRefFlush();
  }

  /** pendingRefFlush 가 있으면 디바운스 flush 타이머를 예약(touchReferences/markHelpful 공용). */
  private scheduleRefFlush(): void {
    if (this.pendingRefFlush.size > 0 && !this.refFlushTimer) {
      this.refFlushTimer = setTimeout(() => this.flushRefs(), BRAIN_REF_FLUSH_MS);
      // 프로세스 종료를 막지 않도록.
      if (typeof this.refFlushTimer.unref === 'function') this.refFlushTimer.unref();
    }
  }

  /**
   * §5.10 v3.49 — "도움됨" 신고(에이전트 helpfulMemoryIds / 사용자 👍). helpfulCount++·lastHelpfulAt 갱신.
   * touchReferences 와 동일한 디바운스 flush 를 재사용(파일 쓰기 폭주 완화). 미지 id 는 null.
   */
  markHelpful(id: string): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    entry.card.helpfulCount = (entry.card.helpfulCount ?? 0) + 1;
    entry.card.lastHelpfulAt = Date.now();
    this.pendingRefFlush.add(id);
    this.scheduleRefFlush();
    return entry.card;
  }

  private flushRefs(): void {
    this.refFlushTimer = null;
    const ids = [...this.pendingRefFlush];
    this.pendingRefFlush.clear();
    for (const id of ids) {
      const entry = this.index.get(id);
      if (entry) this.writeCard(entry.card);
    }
  }

  // ─── §5.10 v3.78 코드 변경 기반 무효화 — 이 설계의 중심 ───

  /**
   * **편집된 파일에 걸린 카드를 "확인 필요"로 전이시킨다.**
   *
   * 우리는 Edit/Write 를 훅으로 전수로 받는다(§7.4 `POST /api/brain/file-notes`) — 시중 메모리
   * 레이어가 못 보는 신호다. 종전 `sweepStaleCards` 는 파일 **삭제**만 ghost 로 잡고 **수정**은
   * 아무 신호도 만들지 않아, "코드를 고쳐도 옛 기억이 그대로 남아 새 사실과 충돌한다"는 고질병이
   * 발생하는 정확한 지점이었다.
   *
   * ⚠ 여기서 카드를 **주입에서 빼지 않는다** — 빼면 아직 유효한 규칙까지 사라진다. 대신
   * `editedSince` 를 세어 브리핑에 "이 파일이 그 뒤 N회 수정됨"을 함께 실어 보낸다(모델이 대조).
   *
   * 파일 쓰기는 참조 카운트와 같은 디바운스 flush 를 재사용한다(편집마다 디스크를 때리지 않게).
   * 반환 = 상태가 바뀐 카드 수(0 이면 호출부가 아무것도 안 해도 된다).
   */
  noteFilesEdited(filePaths: string[]): number {
    this.ensureLoaded();
    if (filePaths.length === 0) return 0;
    const now = Date.now();
    let changed = 0;
    // 같은 파일을 여러 카드가 걸고 있어도 해시는 한 번만 계산한다(훅 경로 = 편집마다 도는 자리).
    const shaCache = new Map<string, string | undefined>();
    const shaOf = (fp: string): string | undefined => {
      if (shaCache.has(fp)) return shaCache.get(fp);
      const abs = path.isAbsolute(fp) ? fp : path.join(this.root, fp);
      const v = fileSha(abs);
      shaCache.set(fp, v);
      return v;
    };
    for (const { card } of this.index.values()) {
      if (!isLiveCard(card)) continue;
      if (card.files.length === 0) continue;
      let touched = false;
      for (const fp of filePaths) {
        if (!fileListMatches(card.files, fp)) continue;
        touched = true;
        const nowSha = shaOf(fp);
        // 앵커가 없던 구버전 카드는 이 시점에 만들어 준다(다음 편집부터 해시 대조가 가능해진다).
        if (!card.anchors || card.anchors.length === 0) card.anchors = this.buildAnchors(card.files);
        const anchor = card.anchors?.find((a) => fileListMatches([a.path], fp));
        if (anchor) {
          anchor.editedSince = (anchor.editedSince ?? 0) + 1;
          anchor.lastEditedAt = now;
          // 해시가 실제로 달라졌을 때만 "확인 필요" — 포맷터가 훑고 지나간 무변경 저장은 봐준다.
          if (anchor.sha && nowSha && anchor.sha === nowSha) continue;
        }
        if (card.verifyState !== 'needs-check') {
          card.verifyState = 'needs-check';
          changed++;
        }
      }
      if (touched) {
        this.pendingRefFlush.add(card.id);
      }
    }
    this.scheduleRefFlush();
    return changed;
  }

  /**
   * §5.10 v3.78 D → v3.81 — **재검증(맞음).** 앵커를 현재 해시로 다시 박고 검증 상태를 되돌린다.
   *
   * v3.81 에서 바뀐 것: ① 되돌아가는 곳이 `undefined`(=candidate)가 아니라 **`verified`** 다.
   * ② 그러려면 권위가 필요하므로 호출부가 누구의 확인인지 밝힌다(사람 = `user-explicit`,
   * 출처 대조 = `repository-source`). ③ **에이전트의 "도움됨" 신고는 더 이상 이 경로를 부르지
   * 않는다** — 유용성 신호가 사실성 판정으로 승격되던 자리였다(§G).
   */
  reverifyCard(id: string, authority: BrainAuthority = 'user-explicit'): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    c.anchors = this.buildAnchors(c.files);
    c.staleReports = undefined;
    // 권위가 승격 가능 등급일 때만 verified 로 올린다(요건 9). 아니면 candidate 로 되돌릴 뿐.
    c.verifyState = canBeVerified(authority) ? 'verified' : 'candidate';
    c.authority = strongerAuthority(authorityOf(c), authority);
    if (c.verifyState === 'verified') c.verifiedAt = Date.now();
    c.updatedAt = Date.now();
    this.writeCard(c);
    return c;
  }

  /**
   * §5.10 v3.81 — **사용자 명시 승인.** 후보를 현재 진실로 올리는 유일한 수동 경로.
   *
   * 같은 슬롯에 이미 현재 진실이 있으면 §C 순서로 **그 카드를 닫는다**(새 카드는 이미 디스크에
   * 있으므로 `supersedes` 만 채워 다시 쓰고 → 옛 카드를 닫는다). 슬롯의 다른 후보들은 `rejected`
   * 가 아니라 그대로 남는다 — 사용자가 고른 것만 올라가고 나머지는 증거로 보존된다.
   */
  confirmCard(id: string, opts?: { authority?: BrainAuthority; reviewAfter?: number }): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    const authority = opts?.authority ?? 'user-explicit';
    if (!canBeVerified(authority)) return c; // 승격 불가 권위 — 조용히 무시(요건 9)
    // **결정·규칙은 정책이라 코드 대조로 참·거짓을 가릴 수 없다.** 출처가 아무리 온전해도
    // 사용자 명시 승인 없이는 현재 진실이 되지 않는다(§D authority — 이 가드가 승격의 단일 관문).
    if (POLICY_TYPES.has(c.type) && authority !== 'user-explicit') return c;
    const now = Date.now();

    // 같은 슬롯의 현재 진실(자기 자신 제외)을 찾는다.
    const olds = c.canonicalKey
      ? [...this.index.values()].map((e) => e.card).filter((o) =>
        o.id !== c.id
        && o.canonicalKey === c.canonicalKey
        && scopeKeyOf(o.appliesTo) === scopeKeyOf(c.appliesTo)
        && isLiveCard(o)
        && verifyStateOf(o) === 'verified')
      : [];

    c.verifyState = 'verified';
    c.authority = strongerAuthority(authorityOf(c), authority);
    c.verifiedAt = now;
    // 승인한 그 순간의 코드가 이 지식의 근거다 — 앵커를 지금 해시로 다시 박아, 이후 그 파일이
    // 바뀌면 `needs-check` 로 정확히 되돌아오게 한다(안 그러면 옛 해시 때문에 영원히 확인 필요).
    c.anchors = this.buildAnchors(c.files);
    c.staleReports = undefined;
    if (opts?.reviewAfter != null) c.reviewAfter = opts.reviewAfter;
    if (olds.length > 0) {
      c.supersedes = [...new Set([...(c.supersedes ?? []), ...olds.map((o) => o.id)])];
      const notes = olds.map((o) => o.title);
      c.supersededNote = escapeScalar([c.supersededNote, ...notes].filter(Boolean).join(' / ')).slice(0, 400);
    }
    c.updatedAt = now;
    this.writeCard(c); // ① 새 진실 먼저(의도 durable)

    for (const old of olds) { // ② 그 다음 옛 진실 닫기
      old.validUntil = now;
      old.supersededBy = c.id;
      old.updatedAt = now;
      this.writeCard(old);
    }
    // 같은 슬롯에서 다투던 후보들의 `contested` 는 이제 의미가 없다 — 후보(candidate)로 되돌린다.
    if (c.canonicalKey) {
      for (const other of this.sameSlotCards(c)) {
        if (other.id === c.id) continue;
        if (verifyStateOf(other) === 'contested') {
          other.verifyState = 'candidate';
          other.updatedAt = now;
          this.writeCard(other);
        }
      }
    }
    this.rebuildTopicDocs(c.scope === 'agent' ? c.agentId : undefined);
    return c;
  }

  /** §5.10 v3.81 — 사용자 거부. 파일은 남기고 영구히 주입·검색에서 뺀다(삭제 ❌). */
  rejectCard(id: string): BrainCard | null {
    return this.updateCard(id, { verifyState: 'rejected' });
  }

  /** 같은 슬롯(`canonicalKey`+범위)의 살아 있는 카드들. */
  private sameSlotCards(card: BrainCard): BrainCard[] {
    if (!card.canonicalKey) return [];
    const sk = scopeKeyOf(card.appliesTo);
    return [...this.index.values()].map((e) => e.card).filter((c) =>
      c.canonicalKey === card.canonicalKey && scopeKeyOf(c.appliesTo) === sk && isLiveCard(c));
  }

  // ─── §5.10 v3.81 — Canonical 계층 읽기 창구(주입·검색·화면이 전부 여기를 지난다) ───

  /** 지금 시점의 current 인덱스(계산 결과 — 캐시하지 않는다. 183장 기준 1ms 미만). */
  canonicalIndex(now = Date.now()): Map<string, BrainCurrentEntry> {
    this.ensureLoaded();
    return buildCanonicalIndex([...this.index.values()].map((e) => e.card), now);
  }

  /** current 인덱스 전체(REST·UI·테스트용). 슬롯 키 사전순. */
  listCurrentEntries(): BrainCurrentEntry[] {
    return [...this.canonicalIndex().values()]
      .sort((a, b) => (a.canonicalKey + a.scopeKey < b.canonicalKey + b.scopeKey ? -1 : 1));
  }

  /** 다투는 슬롯만(검토 큐). */
  listContested(): BrainCurrentEntry[] {
    return listContestedSlots(this.canonicalIndex());
  }

  /**
   * §5.10 v3.81-G — **AI 에게 나갈 자격이 있는 카드.** 랭킹보다 **먼저** 오는 강제 필터다.
   *
   * `current 로 선택됨 ∧ verified ∧ 범위 일치 ∧ 유효기간 내 ∧ 출처 유효 ∧ 충돌·확인필요 아님`.
   * `pinned`·`always` 도 이 필터를 우회하지 못한다(요건 7) — 그 둘은 표시·정리 정책일 뿐이다.
   * 도움률·참조 횟수·최근성은 여기 관여하지 않는다(요건: 유용성 지표는 사실성 필터를 대체 못 한다).
   */
  selectCurrent(opts?: {
    scope?: BrainCardScope;
    agentId?: string;
    /** 지금 작업의 적용 범위(branch·platform 등). 카드가 요구하는 축이 여기 없으면 제외된다. */
    context?: BrainCard['appliesTo'];
  }): BrainCard[] {
    this.ensureLoaded();
    const index = this.canonicalIndex();
    const out: BrainCard[] = [];
    for (const entry of index.values()) {
      if (entry.state !== 'current' || !entry.cardId) continue;
      const card = this.index.get(entry.cardId)?.card;
      if (!card) continue;
      if (opts?.scope && card.scope !== opts.scope) continue;
      if (opts?.agentId && card.scope === 'agent' && card.agentId !== opts.agentId) continue;
      if (!scopeMatchesContext(card.appliesTo, opts?.context)) continue;
      out.push(card);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** §5.10 v3.81 — 검토 큐: 사람의 판단을 기다리는 카드(후보·충돌·확인 필요). 최근순. */
  listReviewQueue(filter?: { scope?: BrainCardScope; agentId?: string }): BrainCard[] {
    this.ensureLoaded();
    return [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => {
        if (!isLiveCard(c)) return false;
        if (!c.canonicalKey) return false; // 키 없는 증거 카드는 SSOT 검토 대상이 아니다
        const st = verifyStateOf(c);
        if (st !== 'candidate' && st !== 'contested' && st !== 'needs-check') return false;
        if (filter?.agentId) return c.scope === 'agent' && c.agentId === filter.agentId;
        if (filter?.scope) return c.scope === filter.scope;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * §5.10 v3.78 D — **재검증 1비트 회수(낡음).** `staleMemoryIds` 신고. 확인 필요로 표시하고
   * 대체 후보로 적립하며, `BRAIN_STALE_REPORT_ARCHIVE_MIN` 회 누적되면 자동 **보관**한다
   * (파일 삭제 ❌ — "정리됨"에서 되돌릴 수 있다). pinned/always 카드는 보관하지 않는다.
   */
  markStale(id: string): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    c.staleReports = (c.staleReports ?? 0) + 1;
    c.verifyState = 'needs-check';
    c.updatedAt = Date.now();
    if (c.staleReports >= BRAIN_STALE_REPORT_ARCHIVE_MIN && !c.pinned && !c.always) {
      this.archiveCard(id);
      return this.index.get(id)?.card ?? c;
    }
    this.writeCard(c);
    return c;
  }

  /** §5.10 v3.78 — "확인 필요" 카드 목록(기억 화면 특수 항목). 최근 편집순. */
  listNeedsCheck(filter?: { scope?: BrainCardScope; agentId?: string }): BrainCard[] {
    this.ensureLoaded();
    const lastEdit = (c: BrainCard): number =>
      Math.max(0, ...(c.anchors ?? []).map((a) => a.lastEditedAt ?? 0));
    return [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => {
        if (!isLiveCard(c) || c.verifyState !== 'needs-check') return false;
        if (filter?.agentId) return c.scope === 'agent' && c.agentId === filter.agentId;
        if (filter?.scope) return c.scope === filter.scope;
        return true;
      })
      .sort((a, b) => (lastEdit(b) || b.updatedAt) - (lastEdit(a) || a.updatedAt));
  }

  /**
   * §5.10 v3.78 — 카드에 붙일 **무효화 경고 한 줄**. 브리핑·주제 문서·파일 경고가 공유한다.
   * 확인 필요가 아니면 빈 문자열(호출부가 그대로 붙여도 안전).
   */
  staleHint(card: BrainCard): string {
    if (card.verifyState !== 'needs-check') return '';
    const edited = (card.anchors ?? []).filter((a) => (a.editedSince ?? 0) > 0);
    if (edited.length === 0) return ' [확인 필요 — 낡았다는 신고가 있었음]';
    const total = edited.reduce((n, a) => n + (a.editedSince ?? 0), 0);
    const names = edited.slice(0, 2).map((a) => path.basename(a.path)).join(', ');
    const more = edited.length > 2 ? ` 외 ${edited.length - 2}개` : '';
    return ` [확인 필요 — ${names}${more} 이 그 뒤 ${total}회 수정됨]`;
  }

  // ─── §5.10 v3.78 예산제 강등 — 보관(archive) 이동 · 되돌리기 ───

  /**
   * 카드를 **보관**한다 — 파일을 지우지 않고 `archive/` 로 옮긴다(휴지통과 같은 문법).
   * `pinned`·`always` 는 강등 대상이 아니므로 호출부가 걸러 넣는다(여기서도 방어).
   */
  archiveCard(id: string): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    if (c.status === 'archived') return c;
    const oldPath = entry.filePath;
    c.status = 'archived';
    c.updatedAt = Date.now();
    this.writeCard(c);
    const newPath = this.cardFilePath(c);
    if (path.resolve(oldPath) !== path.resolve(newPath)) {
      try { fs.rmSync(oldPath, { force: true }); } catch { /* best effort */ }
    }
    return c;
  }

  /** "정리됨" 되돌리기 — 보관 카드를 원래 자리로 되돌린다. 낡음 신고 누적도 함께 비운다. */
  restoreCard(id: string): BrainCard | null {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return null;
    const c = entry.card;
    if (c.status !== 'archived') return c;
    const oldPath = entry.filePath;
    c.status = 'active';
    c.staleReports = undefined;
    c.updatedAt = Date.now();
    this.writeCard(c);
    const newPath = this.cardFilePath(c);
    if (path.resolve(oldPath) !== path.resolve(newPath)) {
      try { fs.rmSync(oldPath, { force: true }); } catch { /* best effort */ }
    }
    this.rebuildTopicDocs(c.scope === 'agent' ? c.agentId : undefined);
    return c;
  }

  /** "정리됨" 목록 — 보관된 카드(최근 보관순, `BRAIN_ARCHIVE_LIST_MAX` 상한). */
  listArchived(filter?: { scope?: BrainCardScope; agentId?: string }): BrainCard[] {
    this.ensureLoaded();
    return [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => {
        if (c.status !== 'archived') return false;
        if (filter?.agentId) return c.scope === 'agent' && c.agentId === filter.agentId;
        if (filter?.scope) return c.scope === filter.scope;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, BRAIN_ARCHIVE_LIST_MAX);
  }

  /**
   * §5.10 v3.78 E — **예산제 강등.** 주제별 정원 + 층별 총량을 넘으면 하위부터 `archived` 로 내린다.
   *
   * "선택적 망각"은 모든 메모리 시스템이 가장 못하는 항목이고, 예산 한도를 둔 망각 정책이 비용뿐
   * 아니라 품질도 지킨다. 다만 우리는 **삭제하지 않는다** — 파일을 `archive/` 로 옮기고 "정리됨"
   * 목록에서 되돌릴 수 있게 해, 이 프로젝트의 "자동 삭제 금지" 원칙과 충돌하지 않게 한다.
   *
   * 강등 우선순위(먼저 내려가는 것부터): ① 닫힌 카드는 애초에 세지 않으므로 제외 ② 확인 필요
   * ③ 장기 미참조(`BRAIN_DEMOTE_UNREFERENCED_MS`) ④ 랭킹(도움률·신선도) 하위.
   * `pinned`·`always` 는 절대 강등하지 않는다. 반환 = 이번에 보관된 카드 수.
   */
  enforceBudgets(agentId?: string, scopeOverride?: BrainCardScope): number {
    this.ensureLoaded();
    const now = Date.now();
    // §5.10 v2 (G) — 층이 셋이 됐다. agentId 가 있으면 에이전트 층, 아니면 호출부가 지정한 층
    //   (미지정이면 종전대로 프로젝트 층)이다.
    const scope: BrainCardScope = agentId ? 'agent' : (scopeOverride ?? 'project');
    const pool = [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => isLiveCard(c) && (agentId
        ? (c.scope === 'agent' && c.agentId === agentId)
        : c.scope === scope));

    /** 강등 후보 순서 — 앞이 먼저 내려간다. */
    const demoteOrder = (cards: BrainCard[]): BrainCard[] => {
      const ranked = new Map(this.rankCards(cards, {}, { includeHidden: true }).map((r) => [r.card.id, r.score]));
      return [...cards]
        // v3.81-J — **검증된 현재 진실은 예산제로 내리지 않는다.** 종전에는 랭킹만 봤기 때문에
        //   "안 쓰였다"는 이유로 확인된 진실이 보관될 수 있었다(정원은 증거 계층에 거는 것이 맞다).
        .filter((c) => !c.pinned && !c.always && verifyStateOf(c) !== 'verified')
        .sort((a, b) => {
          const tier = (c: BrainCard): number => {
            if (c.verifyState === 'needs-check') return 0;
            const last = c.lastReferencedAt ?? c.createdAt;
            if (now - last > BRAIN_DEMOTE_UNREFERENCED_MS) return 1;
            return 2;
          };
          const ta = tier(a);
          const tb = tier(b);
          if (ta !== tb) return ta - tb;
          return (ranked.get(a.id) ?? 0) - (ranked.get(b.id) ?? 0);
        });
    };

    const archived: string[] = [];
    const archiveSome = (cards: BrainCard[], overflow: number): void => {
      for (const c of demoteOrder(cards)) {
        if (archived.length >= overflow) break;
        this.archiveCard(c.id);
        archived.push(c.id);
      }
    };

    // ① 주제별 정원.
    const byTopic = new Map<string, BrainCard[]>();
    for (const c of pool) {
      const slug = c.topic || BRAIN_TOPIC_MISC;
      const list = byTopic.get(slug) ?? [];
      list.push(c);
      byTopic.set(slug, list);
    }
    for (const [, list] of byTopic) {
      const over = list.length - BRAIN_TOPIC_CARD_BUDGET;
      if (over <= 0) continue;
      const before = archived.length;
      archiveSome(list, before + over);
    }

    // ② 층별 총량(주제 정리 뒤 남은 것 기준).
    const remain = pool.filter((c) => !archived.includes(c.id));
    const cap = scope === 'agent'
      ? BRAIN_AGENT_CARD_BUDGET
      // 운영자 프로필은 **사람 얘기**라 적게 유지한다 — 많아질수록 정확도가 아니라 잡음이 는다.
      : scope === 'user' ? BRAIN_OPERATOR_CARD_BUDGET : BRAIN_PROJECT_CARD_BUDGET;
    const over = remain.length - cap;
    if (over > 0) archiveSome(remain, archived.length + over);

    if (archived.length > 0) {
      logger.info(`[brain] budget demote: ${archived.length} card(s) archived (scope=${scope}${agentId ? ` agent=${agentId}` : ''})`);
    }
    return archived.length;
  }

  /**
   * 신선도 sweep — 연결 파일이 전부 소실된 active 카드를 ghost(재검토)로. 파일이 다시 생기면 active 복귀.
   * 주기 sweep(idle sweep interval)에서 호출. 변화가 있으면 true.
   */
  sweepStaleCards(): boolean {
    this.ensureLoaded();
    let changed = false;
    for (const { card } of this.index.values()) {
      if (!isLiveCard(card)) continue;
      // v3.78 ⑤ — 파일이 없는 카드는 종전에 신선도 심사를 통째로 건너뛰어 **영구 불멸**이었다.
      //   ghost 판정은 못 하더라도(연결 파일이 없으니) 예산제 강등의 대상은 되어야 하므로
      //   여기서 continue 하지 않고 파일 검사만 건너뛴다.
      if (card.files.length === 0) continue;
      const anyExists = card.files.some((f) => {
        const abs = path.isAbsolute(f) ? f : path.join(this.root, f);
        try { return fs.existsSync(abs); } catch { return false; }
      });
      if (!anyExists && card.status === 'active') {
        card.status = 'ghost';
        card.updatedAt = Date.now();
        this.writeCard(card);
        changed = true;
      } else if (anyExists && card.status === 'ghost') {
        card.status = 'active';
        card.updatedAt = Date.now();
        this.writeCard(card);
        changed = true;
      }
    }
    // v3.78 ⑥ — 종전에는 정리 상수(`BRAIN_CLEANUP_CARD_COUNT_THRESHOLD` 등)의 소비처가 0이라
    //   삭제가 100% 수동이었다. 주기 sweep 이 예산제를 함께 돌려 총량이 저절로 묶이게 한다.
    let demoted = this.enforceBudgets();
    for (const agentId of this.agentIdsWithCards()) demoted += this.enforceBudgets(agentId);
    if (demoted > 0) {
      changed = true;
      this.rebuildAllTopicDocs();
    }
    return changed;
  }

  /** 커스텀 에이전트 영구 삭제 시 그 에이전트의 개별 기억 디렉토리 전체 삭제. */
  deleteAgentCards(agentId: string): number {
    this.ensureLoaded();
    let n = 0;
    for (const [id, entry] of [...this.index.entries()]) {
      if (entry.card.scope === 'agent' && entry.card.agentId === agentId) {
        this.index.delete(id);
        n++;
      }
    }
    try { fs.rmSync(this.agentsDir(agentId), { recursive: true, force: true }); } catch { /* best effort */ }
    // v3.78 — 보관된 카드도 그 에이전트 소유다. 여기를 빼면 영구 삭제 후에도 archive 에 남아
    //   "정리됨" 목록에 유령 카드가 뜬다(휴지통 영구 삭제 = 기억 카드 파일까지 삭제, §5.10).
    try { fs.rmSync(this.archiveDir('agent', agentId), { recursive: true, force: true }); } catch { /* best effort */ }
    // 주제 문서(파생물)도 함께 치운다 — 카드가 사라졌는데 문서만 남으면 옛 내용을 읽게 된다.
    try { fs.rmSync(this.topicsDir(agentId), { recursive: true, force: true }); } catch { /* best effort */ }
    return n;
  }

  /** §5.10 Brain 요약(스냅샷 탑재분). 본문 없음. */
  getSummary(): BrainSummary {
    this.ensureLoaded();
    let cardCount = 0;
    let unseenCount = 0;
    let needsCheckCount = 0;
    let archivedCount = 0;
    let reviewCount = 0;
    let recent: BrainCard | null = null;
    const agentCardCounts: Record<string, number> = {};
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') { archivedCount++; continue; }
      // v3.78 — 닫힌 카드는 현재 상태가 아니므로 세지 않는다(버블 "N장"이 이력까지 세면 안 준다).
      if (!isOpenCard(card)) continue;
      cardCount++;
      if (card.seen === false) unseenCount++;
      if (card.verifyState === 'needs-check') needsCheckCount++;
      // v3.81 — 사람의 판단을 기다리는 카드(키가 있는데 아직 현재 진실이 아닌 것).
      if (card.canonicalKey) {
        const st = verifyStateOf(card);
        if (st === 'candidate' || st === 'contested' || st === 'needs-check') reviewCount++;
      }
      if (!recent || card.createdAt > recent.createdAt) recent = card;
      if (card.scope === 'agent' && card.agentId) {
        agentCardCounts[card.agentId] = (agentCardCounts[card.agentId] ?? 0) + 1;
      }
    }
    // v3.81 — 현재 진실 수는 계산 인덱스에서 온다(카드 상태의 단순 합이 아니라 슬롯 유일성의 결과).
    const index = this.canonicalIndex();
    let currentCount = 0;
    let contestedCount = 0;
    for (const e of index.values()) {
      if (e.state === 'current') currentCount++;
      else if (e.state === 'contested') contestedCount++;
    }
    return {
      cardCount,
      unseenCount,
      recentCardTitle: recent?.title,
      agentCardCounts,
      ...(needsCheckCount > 0 ? { needsCheckCount } : {}),
      ...(archivedCount > 0 ? { archivedCount } : {}),
      ...(currentCount > 0 ? { currentCount } : {}),
      ...(contestedCount > 0 ? { contestedCount } : {}),
      ...(reviewCount > 0 ? { reviewCount } : {}),
    };
  }

  /** 카드 수가 존재하는가(빈 프로젝트면 스냅샷에 brain 요약을 싣지 않기 위한 판정). */
  hasAnyCards(): boolean {
    this.ensureLoaded();
    return this.index.size > 0;
  }

  // ─── §5.10 v3.74 주제 축 — 색인 + 읽기용 주제 문서 ───

  /** 주제 slug → 표시명/언제 읽나. `BRAIN_TOPICS` 에 없는 slug(구 카드·수기 편집)는 misc 표기로 폴백. */
  private topicMeta(slug: string): { title: string; whenToRead: string } {
    const def = BRAIN_TOPICS.find((t) => t.slug === slug);
    return def
      ? { title: def.title, whenToRead: def.whenToRead }
      : { title: BRAIN_TOPIC_MISC_TITLE, whenToRead: BRAIN_TOPIC_MISC_WHEN_TO_READ };
  }

  /**
   * §5.10 v3.74 — 주제 색인. **카드가 있는 주제만** 돌려준다(빈 주제를 색인에 실으면
   * 에이전트가 빈 문서를 헛읽는다). 정렬 = `BRAIN_TOPICS` 정의 순서, misc 는 항상 끝.
   * archived 카드는 세지 않는다(피드·요약과 같은 기준).
   *
   * v3.75 — `agentId` 를 주면 그 에이전트 층의 색인, 없으면 프로젝트 층 색인(두 층 대칭).
   */
  listTopicIndex(agentId?: string): BrainTopicIndexEntry[] {
    this.ensureLoaded();
    const counts = new Map<string, number>();
    for (const { card } of this.index.values()) {
      if (!isLiveCard(card)) continue;
      if (agentId ? (card.scope !== 'agent' || card.agentId !== agentId) : card.scope !== 'project') continue;
      const slug = card.topic || BRAIN_TOPIC_MISC;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    const order = new Map(BRAIN_TOPICS.map((t, i) => [t.slug, i]));
    return [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
      .map(([slug, cardCount]) => {
        const meta = this.topicMeta(slug);
        return { slug, title: meta.title, whenToRead: meta.whenToRead, cardCount, docPath: this.topicDocPath(slug, agentId) };
      });
  }

  /** 그 주제의 카드(최신 갱신순). archived 제외. v3.75 — agentId 주면 그 에이전트 층. */
  listCardsByTopic(slug: string, agentId?: string): BrainCard[] {
    this.ensureLoaded();
    return [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => {
        if (!isLiveCard(c)) return false;
        if (agentId ? (c.scope !== 'agent' || c.agentId !== agentId) : c.scope !== 'project') return false;
        return (c.topic || BRAIN_TOPIC_MISC) === slug;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** v3.75 — 카드를 가진 에이전트 id 목록(에이전트 층 문서 재생성 대상). */
  private agentIdsWithCards(): string[] {
    const ids = new Set<string>();
    for (const { card } of this.index.values()) {
      if (card.scope === 'agent' && card.agentId && isLiveCard(card)) ids.add(card.agentId);
    }
    return [...ids];
  }

  /**
   * §5.10 v3.74 — 주제 문서 본문 렌더. 카드 id 를 헤딩에 실어 에이전트가 `helpfulMemoryIds` 로
   * 도움됨을 신고할 수 있게 한다(브리핑 카드 줄과 같은 규약). 원본이 카드임을 머리에 명시해
   * 사람이 이 파일을 고쳤다가 덮어써지는 사고를 막는다.
   */
  renderTopicDoc(slug: string, agentId?: string): string {
    const all = this.listCardsByTopic(slug, agentId);
    const meta = this.topicMeta(slug);
    // v3.78 ⓖ — 종전에는 그 주제 **전량**을 문서에 부어 실측 40장짜리 문서가 나왔다(읽는 문서가
    //   아니라 덤프). 랭킹 상위 `BRAIN_TOPIC_DOC_CORE_N` 장만 펼치고 나머지는 접는다 —
    //   접힌 것도 제목·id 는 보이므로 필요하면 검색·REST 로 바로 꺼낼 수 있다.
    // v3.81 — **현재 진실과 참고 기록을 구획으로 가른다.** 같은 문서 안에서도 "지금 지켜야 하는 것"과
    //   "그때 그런 일이 있었다"가 섞여 있으면 읽는 쪽이 둘을 구별할 수 없다.
    const currentIds = new Set(this.selectCurrent().map((c) => c.id));
    const currentCards = all.filter((c) => currentIds.has(c.id));
    const evidence = all.filter((c) => !currentIds.has(c.id));
    const ranked = this.rankCards(evidence, {}, { includeHidden: true }).map((r) => r.card);
    const core = ranked.slice(0, BRAIN_TOPIC_DOC_CORE_N);
    const rest = ranked.slice(BRAIN_TOPIC_DOC_CORE_N);
    const head = [
      `<!-- 이 파일은 .vibisual/brain/{project|agents}/*.md 카드에서 자동 생성됩니다.`,
      `     원본은 카드 파일이며, 여기를 직접 고치면 다음 갱신 때 덮어써집니다. -->`,
      ``,
      `# ${meta.title}`,
      ``,
      `> **언제 읽나**: ${meta.whenToRead}`,
      `> 현재 진실 ${currentCards.length}장 · 참고 기록 ${evidence.length}장(핵심 ${core.length}장 펼침) · 갱신 ${new Date().toISOString()}`,
      ``,
    ];
    const renderCard = (c: BrainCard): string => {
      const lines = [`## [${c.id}] (${c.type}) ${c.title}${this.staleHint(c)}`];
      if (c.canonicalKey) {
        const sk = serializeAppliesTo(c.appliesTo);
        lines.push(`키: \`${c.canonicalKey}\`${sk ? ` · 범위: \`${sk}\`` : ''}`
          + `${c.verifiedAt ? ` · 검증 ${new Date(c.verifiedAt).toISOString().slice(0, 10)}` : ''}`
          + `${c.authority ? ` · 출처 권위 ${c.authority}` : ''}`);
      }
      if (c.files.length > 0) lines.push(`관련 파일: ${c.files.map((f) => `\`${f}\``).join(', ')}`);
      if (c.supersededNote) lines.push(`이전 내용: ${c.supersededNote}`);
      if (c.body.trim()) { lines.push(''); lines.push(c.body.trim()); }
      return lines.join('\n');
    };
    const body: string[] = [];
    if (currentCards.length > 0) {
      body.push(`# 현재 진실 (검증됨 — 지금 이대로 따르면 된다)`);
      body.push(...currentCards.map(renderCard));
    }
    if (core.length > 0) {
      body.push(`# 참고 기록 (경험·미검증 — 그 자체로 현재 규칙이 아니다)`);
      body.push(...core.map(renderCard));
    }
    if (rest.length > 0) {
      body.push([
        `<details>`,
        `<summary>그 외 ${rest.length}장 (덜 참조되는 기록 — 필요하면 펼쳐라)</summary>`,
        ``,
        rest.map(renderCard).join('\n\n'),
        ``,
        `</details>`,
      ].join('\n'));
    }
    return `${head.join('\n')}${body.join('\n\n')}\n`;
  }

  /**
   * §5.10 v3.74 — 주제 문서 재생성. 카드가 있는 주제는 다시 쓰고, **카드가 0이 된 주제 문서는
   * 지운다**(색인에서 빠졌는데 파일만 남으면 옛 내용을 읽게 된다). 쓰기 실패는 조용히 무시 —
   * 문서는 어디까지나 읽기용 파생물이라 실패해도 카드·색인·검색은 그대로 동작한다.
   */
  rebuildTopicDocs(agentId?: string): void {
    this.ensureLoaded();
    const live = new Set(this.listTopicIndex(agentId).map((e) => e.slug));
    for (const slug of live) {
      try {
        atomicWriteFileSync(this.topicDocPath(slug, agentId), this.renderTopicDoc(slug, agentId));
      } catch (err) {
        logger.warn(`[brain] topic doc write skipped (${slug}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const dir = this.topicsDir(agentId);
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
        if (live.has(ent.name.replace(/\.md$/, ''))) continue;
        try { fs.rmSync(path.join(dir, ent.name), { force: true }); } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  /** v3.75 — 두 층 전체 문서 재생성(프로젝트 + 카드가 있는 모든 에이전트). */
  rebuildAllTopicDocs(): void {
    this.rebuildTopicDocs();
    for (const id of this.agentIdsWithCards()) this.rebuildTopicDocs(id);
  }

  /**
   * §5.10 v3.74 — 스폰 브리핑에 상시 싣는 규칙(`always: true`). 프로젝트 층 rule 전용.
   * 참조·최근순 상한 절단(`BRAIN_ALWAYS_RULE_MAX`) — 종전 "rule 전량 주입"의 후신이되
   * 여기 들어오는 것은 "어떤 작업에서도 해당하는" 소수뿐이다.
   */
  listAlwaysRules(): BrainCard[] {
    this.ensureLoaded();
    return [...this.index.values()]
      .map((e) => e.card)
      .filter((c) => c.scope === 'project' && c.type === 'rule' && c.always === true && isLiveCard(c))
      .sort((a, b) => (b.refCount - a.refCount) || (b.updatedAt - a.updatedAt))
      .slice(0, BRAIN_ALWAYS_RULE_MAX);
  }
}

// ─── 프로젝트 루트별 인스턴스(모듈 레벨 Map, lazy) ───

const instances = new Map<string, BrainService>();

/** 프로젝트 루트의 BrainService 를 반환(없으면 생성). 루트는 forward-slash 정규화 키. */
export function getBrainService(projectRoot: string): BrainService {
  const key = projectRoot.replace(/\\/g, '/');
  let svc = instances.get(key);
  if (!svc) {
    svc = new BrainService(key);
    instances.set(key, svc);
  }
  return svc;
}

/** 테스트/재기동 정리용 — 특정 루트 인스턴스 제거. */
export function dropBrainService(projectRoot: string): void {
  instances.delete(projectRoot.replace(/\\/g, '/'));
}

/** 신선도 sweep — 알려진 모든 인스턴스에 대해. 변화가 하나라도 있으면 true. */
export function sweepAllBrainStaleCards(): boolean {
  let changed = false;
  for (const svc of instances.values()) {
    if (svc.sweepStaleCards()) changed = true;
  }
  return changed;
}

export const BRAIN_STALE_THRESHOLD = BRAIN_STALE_THRESHOLD_MS;
