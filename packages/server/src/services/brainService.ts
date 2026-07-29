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
import { atomicWriteFileSync } from './statePersistence.js';
import {
  BRAIN_REF_FLUSH_MS,
  BRAIN_DEDUP_JACCARD_THRESHOLD,
  BRAIN_SEARCH_MAX_RESULTS,
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
  type BrainCard,
  type BrainCardInput,
  type BrainCardScope,
  type BrainCardType,
  type BrainSummary,
  type BrainFeed,
  type BrainFeedSectionKey,
} from '@vibisual/shared';
import { logger } from '../logger.js';

const BRAIN_SUBDIR = '.vibisual/brain';

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
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const m = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (m) for (const t of m) if (t.length >= 2) out.add(t);
  return out;
}

/** Jaccard 토큰 겹침(교집합/합집합). 저장 전 중복 검사용. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 경로 정규화(소문자·forward-slash·후행 슬래시 제거). 파일 일치 비교용. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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
  if (card.files.length > 0) {
    lines.push('files:');
    for (const f of card.files) lines.push(`  - ${escapeScalar(f)}`);
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
  let inFiles = false;
  for (const raw of fmBlock.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (inFiles && /^\s+-\s/.test(line)) {
      files.push(line.replace(/^\s+-\s/, '').trim());
      continue;
    }
    inFiles = false;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const key = line.slice(0, ci).trim();
    const val = line.slice(ci + 1).trim();
    if (key === 'files') { inFiles = true; if (val) files.push(val); continue; }
    fm[key] = val;
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
  };
  if (scope === 'project') card.agentId = undefined;
  return card;
}

export class BrainService {
  private readonly root: string;
  private readonly index = new Map<string, IndexEntry>();
  private loaded = false;
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
  private cardFilePath(card: Pick<BrainCard, 'id' | 'scope' | 'agentId'>): string {
    const dir = card.scope === 'agent' && card.agentId
      ? this.agentsDir(card.agentId)
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
    } catch (e) {
      logger.warn('[brain] initial scan failed', e as Error);
    }
  }

  private scanDir(dir: string, scope: BrainCardScope, agentId?: string): void {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const filePath = path.join(dir, ent.name);
      const id = ent.name.replace(/\.md$/, '');
      try {
        const stat = fs.statSync(filePath);
        const text = fs.readFileSync(filePath, 'utf8');
        const card = parseCard(text, { scope, agentId, id });
        if (card) this.index.set(card.id, { card, filePath, mtimeMs: stat.mtimeMs });
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
    atomicWriteFileSync(filePath, serializeCard(card));
    let mtimeMs = Date.now();
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { /* best effort */ }
    this.index.set(card.id, { card, filePath, mtimeMs });
  }

  // ─── public API ───

  /** 카드 목록(옵션: scope/agentId 필터). archived 포함, 최신 갱신순. */
  listCards(filter?: { scope?: BrainCardScope; agentId?: string }): BrainCard[] {
    this.ensureLoaded();
    let cards = [...this.index.values()].map((e) => e.card);
    if (filter?.scope) cards = cards.filter((c) => c.scope === filter.scope);
    if (filter?.agentId) cards = cards.filter((c) => c.agentId === filter.agentId);
    return cards.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getCard(id: string): BrainCard | undefined {
    this.ensureLoaded();
    this.refreshIfStale(id);
    return this.index.get(id)?.card;
  }

  /**
   * 카드 저장 단일 창구(중복 검사 포함). 같은 scope(+agentId) 카드 중 title+body 토큰
   * Jaccard 겹침 ≥ 문턱이면 새로 만들지 않고 기존 카드를 갱신(updatedAt·body 이력 append).
   * 반환 = 저장/갱신된 카드.
   */
  saveCard(input: BrainCardInput): BrainCard {
    this.ensureLoaded();
    const now = Date.now();
    const inputTokens = tokenize(`${input.title} ${input.body}`);

    // 중복 검사 — 같은 층/에이전트 스코프에서만.
    let best: { card: BrainCard; score: number } | null = null;
    for (const { card } of this.index.values()) {
      if (card.scope !== input.scope) continue;
      if (input.scope === 'agent' && card.agentId !== input.agentId) continue;
      const score = jaccard(inputTokens, tokenize(`${card.title} ${card.body}`));
      if (!best || score > best.score) best = { card, score };
    }

    if (best && best.score >= BRAIN_DEDUP_JACCARD_THRESHOLD) {
      const c = best.card;
      const dateStr = new Date(now).toISOString().slice(0, 10);
      // 자가 수정 금지 원칙 — 기존 본문은 남기고 갱신 이력만 append.
      const noteBody = input.body.trim();
      if (noteBody && !c.body.includes(noteBody)) {
        c.body = `${c.body}\n\n— 갱신(${dateStr}): ${noteBody}`;
      }
      // 파일 목록 합집합.
      for (const f of input.files ?? []) if (!c.files.includes(f)) c.files.push(f);
      c.updatedAt = now;
      c.status = c.status === 'ghost' ? 'active' : c.status;
      c.seen = false; // 갱신도 "최근 저장" 검토함에 다시 노출.
      this.writeCard(c);
      return c;
    }

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
    };
    this.writeCard(card);
    return card;
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
    c.updatedAt = Date.now();
    this.writeCard(c);
    return c;
  }

  deleteCard(id: string): boolean {
    this.ensureLoaded();
    const entry = this.index.get(id);
    if (!entry) return false;
    try { fs.rmSync(entry.filePath, { force: true }); } catch { /* best effort */ }
    this.index.delete(id);
    this.pendingRefFlush.delete(id);
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
    c.scope = 'project';
    c.agentId = undefined;
    c.updatedAt = Date.now();
    this.writeCard(c); // project 위치에 새로 기록(index 의 filePath 갱신)
    const newPath = this.cardFilePath(c);
    if (path.resolve(oldPath) !== path.resolve(newPath)) {
      try { fs.rmSync(oldPath, { force: true }); } catch { /* best effort */ }
    }
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
    if (qTokens.size === 0) return [];
    const limit = opts?.limit ?? BRAIN_SEARCH_MAX_RESULTS;
    const scored: { card: BrainCard; score: number }[] = [];
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') continue;
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
    const isActive = (c: BrainCard): boolean => c.status !== 'archived' && c.status !== 'ghost';
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

  /** 특정 파일들에 연결된 실수/교훈 카드(파일 접근 경고용). status archived 제외. */
  getCardsForFiles(filePaths: string[]): BrainCard[] {
    this.ensureLoaded();
    const out: BrainCard[] = [];
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') continue;
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

  /**
   * 신선도 sweep — 연결 파일이 전부 소실된 active 카드를 ghost(재검토)로. 파일이 다시 생기면 active 복귀.
   * 주기 sweep(idle sweep interval)에서 호출. 변화가 있으면 true.
   */
  sweepStaleCards(): boolean {
    this.ensureLoaded();
    let changed = false;
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') continue;
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
    return n;
  }

  /** §5.10 Brain 요약(스냅샷 탑재분). 본문 없음. */
  getSummary(): BrainSummary {
    this.ensureLoaded();
    let cardCount = 0;
    let unseenCount = 0;
    let recent: BrainCard | null = null;
    const agentCardCounts: Record<string, number> = {};
    for (const { card } of this.index.values()) {
      if (card.status === 'archived') continue;
      cardCount++;
      if (card.seen === false) unseenCount++;
      if (!recent || card.createdAt > recent.createdAt) recent = card;
      if (card.scope === 'agent' && card.agentId) {
        agentCardCounts[card.agentId] = (agentCardCounts[card.agentId] ?? 0) + 1;
      }
    }
    return {
      cardCount,
      unseenCount,
      recentCardTitle: recent?.title,
      agentCardCounts,
    };
  }

  /** 카드 수가 존재하는가(빈 프로젝트면 스냅샷에 brain 요약을 싣지 않기 위한 판정). */
  hasAnyCards(): boolean {
    this.ensureLoaded();
    return this.index.size > 0;
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
