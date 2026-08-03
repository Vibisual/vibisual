/**
 * §5.10 v3.81 단계 ① — **읽기 전용 dry-run 감사기.**
 *
 * 저장고(Evidence)와 SSOT(Canonical Knowledge)를 가르기 전에, 지금 있는 카드가 **어느 쪽에 속할
 * 자격이 있는지**를 먼저 세어 본다. 이 모듈은 **파일을 한 바이트도 쓰지 않는다** — 디스크 접근은
 * 출처 검증을 위한 `existsSync`/해시 읽기뿐이다.
 *
 * ## 설계 규약
 *
 * - **순수 입력**: 카드 배열을 받는다(서비스 내부를 뒤지지 않는다). 그래서 테스트가 디스크 없이 돈다.
 * - **재실행 멱등**: 보고서에 시각·난수를 넣지 않는다. 같은 카드 집합이면 몇 번을 돌려도 deep-equal.
 *   목록 정렬도 전부 결정적(점수 → id 사전순)이라 Map/Set 순회 순서에 흔들리지 않는다.
 * - **자동 승격 ❌**: 키를 "제안"할 뿐 확정하지 않고, 출처가 온전한 카드도 `reVerifiable`(사람이
 *   확인하면 올릴 수 있음)로만 보고한다. `pinned`·`always` 라는 이유로 봐주는 경로도 없다.
 * - **유사도는 판정이 아니라 보고**: 중복·충돌은 "후보"로만 싣는다. 실제 병합·닫기는 사람 승인 경로.
 *
 * 판정에 쓰는 유사도 함수는 `brainService` 의 것을 **그대로 재사용**한다 — 감사기가 별도 구현을
 * 들고 있으면 "저장 경로가 실제로 무엇을 중복으로 보는가"와 보고서가 어긋난다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BRAIN_CANONICAL_AREAS,
  BRAIN_CANONICAL_TYPES,
  BRAIN_EXPERIENCE_TYPES,
  BRAIN_MIGRATION_DUP_TITLE_MIN,
  BRAIN_KEY_SUBJECT_FILE_PATTERN,
  BRAIN_MIGRATION_LIST_MAX,
  BRAIN_SCOPE_SPLIT_PATTERN,
  BRAIN_TOPICS,
  BRAIN_TOPIC_MISC,
  type BrainCard,
  type BrainMigrationConflictPair,
  type BrainMigrationCounts,
  type BrainMigrationDuplicateGroup,
  type BrainMigrationKeySuggestion,
  type BrainMigrationNote,
  type BrainMigrationReport,
} from '@vibisual/shared';
import { charBigrams, hasNegation, jaccard, fileSha, isOpenCard } from './brainService.js';

/** §5.10 v3.81 단계 ⑨ — 이행 적용 1건의 결과(무엇이 어떻게 바뀌었는지). */
export interface BrainMigrationApplyEntry {
  id: string;
  title: string;
  canonicalKey: string;
  verifyState: 'candidate' | 'verified';
  authority: string;
  /** 왜 이 상태가 됐는지(사람이 읽는 한 줄). */
  why: string;
}

/** §5.10 v3.81 단계 ⑨ — 이행 적용 결과 전문. */
export interface BrainMigrationApplyResult {
  /** 실제로 쓰지 않고 계획만 돌려줬는가. */
  dryRun: boolean;
  /** 키가 부여된 카드. */
  applied: BrainMigrationApplyEntry[];
  /** 이미 키가 있어 건너뛴 카드 수(재실행 멱등의 증거). */
  skipped: number;
  /** 키를 만들 근거가 없어 저장고에만 남는 카드 수. */
  evidenceOnly: number;
  /** 이행 후 current 로 확정된 슬롯 수. */
  currentSlots: number;
  /** 이행 후 값이 갈린 슬롯 수. */
  contestedSlots: number;
}

/** 적용 범위 축 언급 탐지(모듈 레벨 1회 컴파일). */
const SCOPE_SPLIT_RE = new RegExp(BRAIN_SCOPE_SPLIT_PATTERN, 'i');

/** subject 를 뽑아도 되는 파일(패키지 소스 모듈)인가 — 문서·스크립트·설정 제외. */
const SUBJECT_FILE_RE = new RegExp(BRAIN_KEY_SUBJECT_FILE_PATTERN, 'i');

/** 알려진 주제 slug 집합 — 여기 없는 값은 수기 편집·구버전으로 본다. */
const KNOWN_TOPICS: ReadonlySet<string> = new Set([...BRAIN_TOPICS.map((t) => t.slug), BRAIN_TOPIC_MISC]);

const CANONICAL_TYPES: ReadonlySet<string> = new Set(BRAIN_CANONICAL_TYPES);
const EXPERIENCE_TYPES: ReadonlySet<string> = new Set(BRAIN_EXPERIENCE_TYPES);

/** 층 식별자 — 중복·충돌은 같은 층 안에서만 따진다(`saveCard` 의 후보 선정과 같은 기준). */
function layerOf(card: BrainCard): string {
  return card.scope === 'agent' ? `agent:${card.agentId ?? '?'}` : 'project';
}

/** 화면·이력 조회에 살아 있는 카드(열림 + 미보관). 감사 대상 대부분은 이 집합이다. */
function isLive(card: BrainCard): boolean {
  return isOpenCard(card) && card.status !== 'archived';
}

function note(card: BrainCard, reason: string, detail?: string): BrainMigrationNote {
  return {
    id: card.id,
    title: card.title,
    scope: card.scope,
    ...(card.agentId ? { agentId: card.agentId } : {}),
    reason,
    ...(detail ? { detail } : {}),
  };
}

/** 목록 상한 — 잘려도 `counts` 가 전체를 알려주므로 정보는 잃지 않는다. */
function cap<T>(list: T[]): T[] {
  return list.length > BRAIN_MIGRATION_LIST_MAX ? list.slice(0, BRAIN_MIGRATION_LIST_MAX) : list;
}

/** id 사전순 — 동점 정렬을 결정적으로 만드는 최종 타이브레이커. */
function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 파일 경로 → `canonicalKey` 의 subject 마디. `packages/server/src/services/brainService.ts`
 * → `brain-service`. 확장자·인덱스성 이름은 버리고 카멜케이스를 kebab 으로 편다.
 *
 * **패키지 소스 모듈에서만 뽑는다**(`BRAIN_KEY_SUBJECT_FILE_PATTERN`) — 실측에서 `docs/SCENARIO.md`
 * 나 `scripts/reinstall.mjs` 가 첫 파일로 걸려 카드 내용과 무관한 `client.scenario` 류 키를 만들어
 * 냈다. 그런 파일은 지식의 *주제*가 아니라 함께 언급된 *증거*다.
 *
 * **한국어 제목에서 키를 만들지 않는다** — 로마자 변환은 결정적일 수 없고, 억지로 만든 키는
 * 안정적인 의미 주소라는 목적을 배신한다. 근거가 없으면 제안 자체를 하지 않는다.
 */
export function subjectFromFile(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, '/');
  if (!SUBJECT_FILE_RE.test(norm)) return null;
  const base = path.basename(norm).replace(/\.[a-z0-9]+$/i, '');
  if (!base || /^(index|main|types|constants)$/i.test(base)) return null;
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s.]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return kebab || null;
}

/**
 * 파일 경로 → `canonicalKey` 의 area 마디. `packages/client/src/…` → `client`.
 *
 * **주제(topic)가 아니라 파일의 패키지에서 뽑는다.** 실측에서 주제 기반 area 는 파일과 자주
 * 어긋났다(`server.detail-panel` — DetailPanel 은 클라, `client.project-graph` — projectGraph 는 서버).
 * 주제는 사람이 읽는 분류축이지 코드 소속이 아니므로, 소속은 경로에서 직접 읽는 것이 맞다.
 */
function areaFromFile(filePath: string): string | null {
  const m = /(^|\/)packages\/([^/]+)\/src\//.exec(filePath.replace(/\\/g, '/'));
  const pkg = m?.[2];
  return pkg && BRAIN_CANONICAL_AREAS.includes(pkg) ? pkg : null;
}

/**
 * 카드 1장의 `canonicalKey` **접두 제안**(`<area>.<subject>`). 근거가 약하면 `null` — 그 카드는
 * `needsHuman` 으로 간다.
 *
 * ⚠ 이것은 완성된 키가 아니라 **접두**다. 실측에서 한 파일(`useCaptureRemoteControl.ts`)에 DPI 좌표·
 * 포인터 락·시스템 커서처럼 **서로 다른 진실 4개**가 걸려 있었다 — 파일 단위 키로 확정하면 그 넷이
 * 한 슬롯으로 뭉개져 "현재 진실은 하나"라는 불변식이 거짓 병합을 일으킨다. 그래서 접두를 공유하는
 * 카드가 둘 이상이면 `needsAspect` 를 세워 **aspect 마디는 사람이 붙이라고 보고**한다.
 */
export function suggestCanonicalKey(card: BrainCard): BrainMigrationKeySuggestion | null {
  if (!CANONICAL_TYPES.has(card.type)) return null;
  const primary = card.files.find((f) => subjectFromFile(f) != null && areaFromFile(f) != null);
  if (!primary) return null;
  const subject = subjectFromFile(primary);
  const area = areaFromFile(primary);
  if (!subject || !area) return null;
  const known = KNOWN_TOPICS.has(card.topic ?? '') && card.topic !== BRAIN_TOPIC_MISC;
  // 주제가 미분류면 신뢰도를 올리지 않는다(그 카드는 분류 검토 큐에도 함께 오른다).
  const confidence: BrainMigrationKeySuggestion['confidence'] =
    card.files.length === 1 && known ? 'high' : card.files.length <= 3 ? 'medium' : 'low';
  return {
    id: card.id,
    title: card.title,
    suggestedKey: `${area}.${subject}`,
    needsAspect: false, // 접두 충돌은 전수를 봐야 알 수 있어 analyze 에서 채운다.
    confidence,
    basis: `file=${path.basename(primary.replace(/\\/g, '/'))}${card.files.length > 1 ? ` (외 ${card.files.length - 1}개)` : ''} · topic=${card.topic ?? '없음'}`,
  };
}

/** 출처(연결 파일) 상태 판정 — 감사기의 유일한 디스크 접근 지점. */
function inspectSources(card: BrainCard, root: string): {
  kind: 'none' | 'intact' | 'missing' | 'mismatch';
  detail?: string;
} {
  if (card.files.length === 0) return { kind: 'none' };
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const f of card.files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let exists = false;
    try { exists = fs.existsSync(abs); } catch { exists = false; }
    if (!exists) { missing.push(path.basename(f)); continue; }
    const anchor = card.anchors?.find((a) => a.path === f);
    if (anchor?.sha) {
      const now = fileSha(abs);
      if (now && now !== anchor.sha) mismatched.push(path.basename(f));
    }
  }
  if (missing.length > 0) {
    return { kind: 'missing', detail: `파일 없음: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` 외 ${missing.length - 3}개` : ''}` };
  }
  if (mismatched.length > 0) {
    return { kind: 'mismatch', detail: `앵커 해시 불일치: ${mismatched.slice(0, 3).join(', ')}${mismatched.length > 3 ? ` 외 ${mismatched.length - 3}개` : ''}` };
  }
  // 앵커가 아예 없으면 "해시로 확인된 것"은 아니지만, 파일이 다 살아 있으므로 사람이 확인할 값어치는 있다.
  return { kind: 'intact', detail: card.anchors && card.anchors.length > 0 ? '앵커 해시 일치' : '파일 존재(앵커 없음)' };
}

/** 제목 문자 bigram 유사도 — 실측상 한국어 중복이 드러나는 유일한 축(본문 토큰 Jaccard 는 전 쌍 미달). */
function titleSimilarity(a: BrainCard, b: BrainCard): number {
  return jaccard(charBigrams(a.title), charBigrams(b.title));
}

/**
 * §5.10 v3.81 — **감사 본체.** 카드 전량(닫힘·보관 포함)을 받아 이행 보고서를 만든다.
 * 파일 쓰기 ❌ · 시각/난수 ❌ · 카드 변경 ❌ (입력 객체를 수정하지 않는다).
 */
export function analyzeBrainMigration(cards: readonly BrainCard[], root: string): BrainMigrationReport {
  const normRoot = root.replace(/\\/g, '/');
  // 입력 순서에 흔들리지 않도록 먼저 결정적으로 정렬한다(호출부가 어떤 순서를 주든 같은 보고서).
  const all = [...cards].sort(byId);
  const live = all.filter(isLive);

  // ─── 집계 ───
  const byType: Record<string, number> = {};
  for (const c of live) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const counts: BrainMigrationCounts = {
    total: all.length,
    live: live.length,
    closed: all.filter((c) => !isOpenCard(c)).length,
    archived: all.filter((c) => c.status === 'archived').length,
    project: live.filter((c) => c.scope === 'project').length,
    agent: live.filter((c) => c.scope === 'agent').length,
    byType,
    canonicalCandidates: live.filter((c) => CANONICAL_TYPES.has(c.type)).length,
    experienceLayer: live.filter((c) => EXPERIENCE_TYPES.has(c.type)).length,
    needsCheck: live.filter((c) => c.verifyState === 'needs-check').length,
  };

  // ─── ① 키 제안 / ⑧ 사람 판단 필요 ───
  const keySuggestions: BrainMigrationKeySuggestion[] = [];
  const needsHuman: BrainMigrationNote[] = [];
  for (const c of live) {
    const s = suggestCanonicalKey(c);
    if (s) keySuggestions.push(s);
    if (!CANONICAL_TYPES.has(c.type)) continue;
    // 카드 1장 = 지적 1건(사유 중복 나열 ❌). **결정·규칙이 먼저** — 키를 제안했든 못 했든 사용자
    // 명시 승인 없이는 verified 가 될 수 없으므로(§D authority), 그게 이 카드의 진짜 관문이다.
    if (c.type === 'decision' || c.type === 'rule') {
      needsHuman.push(note(
        c,
        'policy-needs-approval',
        `결정·규칙은 사용자 명시 승인으로만 verified 가 된다${s ? ` (키 제안: ${s.suggestedKey})` : ' · 키 제안 불가'}`,
      ));
      continue;
    }
    if (!s) {
      // 정본 후보(fact)인데 키를 못 만든다 = 사람이 주소를 정해 줘야 한다.
      const why = c.files.length === 0
        ? '출처 없음 — 파일로 주제를 특정할 수 없다'
        : '연결 파일이 전부 문서·스크립트라 subject 를 뽑을 수 없다(패키지 소스 모듈만 인정)';
      needsHuman.push(note(c, 'key-undecidable', why));
    }
  }

  // ─── ①-b 접두를 공유하는 카드 = **aspect 로 갈라야 하는** 묶음(같은 슬롯이라는 뜻이 아니다) ───
  const byKey = new Map<string, BrainMigrationKeySuggestion[]>();
  for (const s of keySuggestions) {
    const g = byKey.get(s.suggestedKey) ?? [];
    g.push(s);
    byKey.set(s.suggestedKey, g);
  }
  const keyCollisions = [...byKey.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([key, g]) => ({ key, cards: g.sort(byId).map((s) => ({ id: s.id, title: s.title })) }))
    .sort((a, b) => (b.cards.length - a.cards.length) || (a.key < b.key ? -1 : 1));
  // 충돌한 접두는 그대로 확정할 수 없다 — 신뢰도를 낮추고 aspect 필요를 표시한다.
  for (const [, g] of byKey) {
    if (g.length < 2) continue;
    for (const s of g) {
      s.needsAspect = true;
      s.confidence = 'low';
      s.basis += ` · 같은 접두 ${g.length}장 — aspect 필요`;
    }
  }

  // ─── ②③ 중복·충돌 후보(같은 층 안에서만) ───
  const byLayer = new Map<string, BrainCard[]>();
  for (const c of live) {
    const k = layerOf(c);
    const list = byLayer.get(k) ?? [];
    list.push(c);
    byLayer.set(k, list);
  }
  const duplicateGroups: BrainMigrationDuplicateGroup[] = [];
  const conflictPairs: BrainMigrationConflictPair[] = [];
  // 층 이름 순으로 돌아 결과 순서를 고정한다.
  for (const layer of [...byLayer.keys()].sort()) {
    const list = byLayer.get(layer) ?? [];
    /** union-find — 중복은 쌍이 아니라 묶음으로 보고해야 "같은 진실 3장"이 한 줄로 보인다. */
    const parent = new Map<string, string>(list.map((c) => [c.id, c.id]));
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r) as string;
      let cur = x;
      while (parent.get(cur) !== r) { const nxt = parent.get(cur) as string; parent.set(cur, r); cur = nxt; }
      return r;
    };
    const maxSim = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as BrainCard;
        const b = list[j] as BrainCard;
        const sim = titleSimilarity(a, b);
        if (sim < BRAIN_MIGRATION_DUP_TITLE_MIN) continue;
        if (hasNegation(`${a.title}\n${a.body}`) !== hasNegation(`${b.title}\n${b.body}`)) {
          // 겹치는데 지시가 뒤집혔다 = 중복이 아니라 충돌 후보.
          conflictPairs.push({
            layer,
            similarity: Number(sim.toFixed(3)),
            reason: 'negation-flip',
            a: { id: a.id, title: a.title },
            b: { id: b.id, title: b.title },
          });
          continue;
        }
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra, rb);
        const root2 = find(a.id);
        maxSim.set(root2, Math.max(maxSim.get(root2) ?? 0, sim));
      }
    }
    const groups = new Map<string, BrainCard[]>();
    for (const c of list) {
      const r = find(c.id);
      if (r === c.id && !list.some((o) => o.id !== c.id && find(o.id) === r)) continue; // 혼자면 묶음 아님
      const g = groups.get(r) ?? [];
      g.push(c);
      groups.set(r, g);
    }
    for (const [r, g] of [...groups.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      if (g.length < 2) continue;
      duplicateGroups.push({
        layer,
        similarity: Number((maxSim.get(r) ?? 0).toFixed(3)),
        cards: g.sort(byId).map((c) => ({ id: c.id, title: c.title })),
      });
    }
  }
  conflictPairs.sort((x, y) => (y.similarity - x.similarity) || byId(x.a, y.a));
  duplicateGroups.sort((x, y) => (y.similarity - x.similarity) || byId(x.cards[0] as { id: string }, y.cards[0] as { id: string }));

  // ─── ④⑤⑦ 출처 상태 ───
  const noSource: BrainMigrationNote[] = [];
  const brokenSource: BrainMigrationNote[] = [];
  const reVerifiable: BrainMigrationNote[] = [];
  for (const c of live) {
    const s = inspectSources(c, normRoot);
    if (s.kind === 'none') {
      noSource.push(note(c, 'no-source', '연결 파일이 없어 코드 변경으로 낡음을 감지할 수 없다'));
    } else if (s.kind === 'missing' || s.kind === 'mismatch') {
      brokenSource.push(note(c, s.kind === 'missing' ? 'source-missing' : 'anchor-mismatch', s.detail));
    } else if (CANONICAL_TYPES.has(c.type)) {
      // 경험 계층은 출처가 온전해도 정본이 아니다(H) — 재검증 대상 목록에 넣지 않는다.
      reVerifiable.push(note(c, 'source-intact', s.detail));
    }
  }

  // ─── ⑥ 범위 분리 필요 ───
  const needsScopeSplit: BrainMigrationNote[] = [];
  for (const c of live) {
    const hay = `${c.title}\n${c.body}`;
    const m = hay.match(SCOPE_SPLIT_RE);
    if (m) needsScopeSplit.push(note(c, 'scope-axis-mentioned', `본문에 범위 축 언급: "${m[0]}"`));
  }

  // ─── ⑨ 미분류 ───
  const misc: BrainMigrationNote[] = [];
  const unknownTopics = new Set<string>();
  for (const c of live) {
    const t = c.topic ?? '';
    if (!t || t === BRAIN_TOPIC_MISC) misc.push(note(c, 'topic-misc', '분류 검토 큐 — 주제를 지정해야 한다'));
    if (t && !KNOWN_TOPICS.has(t)) unknownTopics.add(t);
  }

  // ─── ⑩ 즉시 제외 대상 ───
  // 지금은 이 카드들이 전부 브리핑·주제 문서·검색으로 AI 에 닿는다. 새 규칙에서 빠지는 순서대로 싣는다.
  const excludeNow: BrainMigrationNote[] = [];
  const pushExclude = (c: BrainCard, reason: string, detail: string): void => {
    if (!excludeNow.some((n) => n.id === c.id)) excludeNow.push(note(c, reason, detail));
  };
  for (const c of live) {
    if (c.verifyState === 'needs-check') pushExclude(c, 'needs-check', '출처가 바뀌어 재검증 전까지 주입 제외(§G)');
  }
  for (const c of live) {
    if (c.status === 'ghost') pushExclude(c, 'ghost', '연결 파일이 전부 사라졌다 — 검증축으로 이관 후 제외');
  }
  for (const c of live) {
    if (EXPERIENCE_TYPES.has(c.type)) {
      pushExclude(c, 'experience-layer', `${c.type} 은 경험 계층 — 기본 브리핑 제외, rule 승격 시에만 주입(§H)`);
    }
  }

  return {
    root: normRoot,
    counts,
    keySuggestions: cap(keySuggestions.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return (rank[a.confidence] - rank[b.confidence]) || byId(a, b);
    })),
    keyCollisions: cap(keyCollisions),
    duplicateGroups: cap(duplicateGroups),
    conflictPairs: cap(conflictPairs),
    noSource: cap(noSource.sort(byId)),
    brokenSource: cap(brokenSource.sort(byId)),
    needsScopeSplit: cap(needsScopeSplit.sort(byId)),
    reVerifiable: cap(reVerifiable.sort(byId)),
    needsHuman: cap(needsHuman.sort(byId)),
    unclassified: {
      misc: cap(misc.sort(byId)),
      unknownTopics: [...unknownTopics].sort(),
    },
    excludeNow: cap(excludeNow.sort(byId)),
    plan: {
      willAddFields: ['canonicalKey', 'appliesTo', 'authority', 'verifiedAt', 'reviewAfter', 'observations', 'observedCount'],
      willNotTouch: [
        '카드 본문(body) — LLM 재작성 경로 ❌',
        '기존 frontmatter 값 — 삭제·변경 ❌ (추가만)',
        '파일 위치 — project/agents/archive 그대로',
        '닫힌 카드·보관 카드 — 이력 그대로 보존',
      ],
      initialVerifyState: 'candidate',
    },
  };
}

/**
 * §5.10 v3.81 단계 ⑨ — **이행 적용.** frontmatter 에 SSOT 축을 **추가만** 한다.
 *
 * 규칙(전부 사용자 결정과 설계 §I 를 그대로 옮긴 것):
 * - 본문·기존 값·파일 위치를 건드리지 않는다. 카드가 사라지거나 닫히지 않는다.
 * - **엄격안** — 모든 카드는 `candidate` 로 시작한다. `pinned`·`always` 라는 이유의 면제 ❌.
 * - `verifyIntactFacts` 를 켜면 **출처가 온전한 `fact` 만** `repository-source` 권위로 올린다
 *   (앵커 해시가 지금 파일과 일치 = 그 근거가 작성 이후 바뀌지 않았다는 기계적 확인).
 *   결정·규칙은 정책이라 코드 대조로 참·거짓을 가릴 수 없으므로 제외 — 사용자 승인 경로로만 간다.
 * - `resolutions` 로 사람이 정한 키(aspect 포함)를 덮어쓸 수 있다. 자동 제안은 접두 충돌이 없을 때만.
 * - **재실행 멱등** — 이미 `canonicalKey` 가 있는 카드는 건너뛴다.
 */
export function applyBrainMigration(
  svc: {
    listCards(f?: { includeClosed?: boolean; includeArchived?: boolean }): BrainCard[];
    updateCard(id: string, partial: Partial<BrainCard>): BrainCard | null;
    listCurrentEntries(): Array<{ state: string }>;
  },
  root: string,
  opts: {
    resolutions?: Record<string, { canonicalKey?: string; appliesTo?: Record<string, string> }>;
    verifyIntactFacts?: boolean;
    dryRun?: boolean;
  },
): BrainMigrationApplyResult {
  const normRoot = root.replace(/\\/g, '/');
  const cards = svc.listCards({ includeClosed: true, includeArchived: true });
  const report = analyzeBrainMigration(cards, normRoot);
  const resolutions = opts.resolutions ?? {};
  // 접두 충돌이 없는 제안만 자동 채택한다(충돌분은 사람이 aspect 를 정해 resolutions 로 준다).
  const autoKey = new Map<string, string>();
  for (const s of report.keySuggestions) {
    if (!s.needsAspect) autoKey.set(s.id, s.suggestedKey);
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const applied: BrainMigrationApplyEntry[] = [];
  let skipped = 0;
  let evidenceOnly = 0;

  // 카드 id 사전순 — 적용 순서를 결정적으로.
  for (const card of [...cards].sort(byId2)) {
    if (card.canonicalKey) { skipped++; continue; }
    const manual = resolutions[card.id];
    const key = manual?.canonicalKey ?? autoKey.get(card.id);
    if (!key) { evidenceOnly++; continue; }

    // 출처 무결 + fact 인 것만 자동 승격 대상(엄격안의 유일한 예외 — 기계적 대조가 가능한 경우).
    const src = inspectSources(card, normRoot);
    const intactFact = card.type === 'fact'
      && src.kind === 'intact'
      && (card.anchors?.length ?? 0) > 0
      && src.detail === '앵커 해시 일치';
    const promote = opts.verifyIntactFacts === true && intactFact;

    const patch: Partial<BrainCard> = {
      canonicalKey: key,
      appliesTo: (manual?.appliesTo as BrainCard['appliesTo']) ?? { project: path.basename(normRoot) },
      verifyState: promote ? 'verified' : 'candidate',
      authority: promote ? 'repository-source' : 'ai-inference',
      ...(promote ? { verifiedAt: card.updatedAt } : {}),
    };
    if (!opts.dryRun) svc.updateCard(card.id, patch);
    applied.push({
      id: card.id,
      title: card.title,
      canonicalKey: key,
      verifyState: promote ? 'verified' : 'candidate',
      authority: promote ? 'repository-source' : 'ai-inference',
      why: promote
        ? '출처 앵커 해시가 지금 파일과 일치하는 fact — 기계적 대조로 승격'
        : manual
          ? '사람이 지정한 키 — 검증은 사용자 확인 경로로'
          : '접두 충돌 없는 자동 제안 — 엄격안에 따라 후보로 시작',
    });
  }

  const entries = opts.dryRun ? [] : svc.listCurrentEntries();
  return {
    dryRun: opts.dryRun === true,
    applied,
    skipped,
    evidenceOnly,
    currentSlots: entries.filter((e) => e.state === 'current').length,
    contestedSlots: entries.filter((e) => e.state === 'contested').length,
  };
}

/** 카드 id 사전순(적용 순서 고정). */
function byId2(a: BrainCard, b: BrainCard): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
