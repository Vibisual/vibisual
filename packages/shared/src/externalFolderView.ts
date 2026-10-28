/**
 * §2.1 — 외부 폴더 버블 표시 판정(승격 · 휘발 자리 접기 · 자리 이름). 경로 구조가 아니라 활동으로 접는다(경로로 접으면 홈 하나가 수십 곳을 활동 0 으로 삼킨다 — 실측).
 * 서버와 클라가 같은 답을 내야 한다(§2.1 #3). 순수 — 시각·플랫폼·홈·임시 디렉터리는 인자로 받는다(세 OS 단위 테스트).
 */
import {
  EXTERNAL_PLACE_PATTERNS,
  EXTERNAL_PROMOTION_HALF_LIFE_MS,
  EXTERNAL_PROMOTION_PER_PARENT,
  EXTERNAL_TOP_BUDGET_BOUNDS,
  EXTERNAL_TOP_BUDGET_DEFAULT,
} from './constants.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

// ─────────────────────────────────────────────────────────────────────────────
// (D) 사람이 읽는 이름
// ─────────────────────────────────────────────────────────────────────────────

/** 알려진 자리를 찾을 때 필요한 바깥 사실. shared 는 이것들을 스스로 알 수 없어 **받는다**. */
export interface ExternalPlaceContext {
  /** `os.homedir()`. 없으면 `home` 기준 패턴은 건너뛴다. */
  home?: string | null;
  /** `os.tmpdir()`. 없으면 `temp` 기준 패턴은 건너뛴다. */
  temp?: string | null;
  /** 경로 비교에 대소문자를 접을지 정하는 플랫폼(§ 멀티플랫폼 1축). */
  platform: PlatformName;
}

/** 알려진 자리면 i18n 키 접미사, 아니면 `null` — 서버엔 i18n 런타임이 없어 키를 준다(클라가 `canvas.externalPlace.<키>`). 표시 전용 — 노드 키는 안 바꾸고 대소문자는 `pathKey` 규약. */
export function externalPlaceKeyFor(absolutePath: string, ctx: ExternalPlaceContext): string | null {
  const abs = pathKey(absolutePath, ctx.platform);
  const home = ctx.home ? pathKey(ctx.home, ctx.platform) : null;
  const temp = ctx.temp ? pathKey(ctx.temp, ctx.platform) : null;

  for (const pattern of EXTERNAL_PLACE_PATTERNS) {
    if (pattern.base === 'any') {
      if (pattern.test.test(abs)) return pattern.key;
      continue;
    }
    const base = pattern.base === 'home' ? home : temp;
    if (!base) continue;
    const rel = relativeUnder(abs, base);
    if (rel === null) continue;
    if (pattern.test.test(rel)) return pattern.key;
  }
  return null;
}

/**
 * §2.1 (D) — 자리 이름 옆 구분자(여러 `~/.claude/projects/<slug>` 가 다 "Claude 기록"이 되지 않게). slug 의 마지막 조각 = 프로젝트 이름.
 * 뽑을 것이 없거나 하나뿐인 자리면 빈 문자열 — 화면은 기존 라벨로 돌아간다.
 */
export function externalPlaceHint(absolutePath: string, placeKey: string): string {
  const segments = normalizePathShape(absolutePath).split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? '';
  const slugTail = (slug: string): string => {
    const parts = slug.split('-').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  };
  const afterMarker = (marker: string): string => {
    const at = segments.lastIndexOf(marker);
    return at >= 0 ? (segments[at + 1] ?? '') : '';
  };
  switch (placeKey) {
    case 'claudeProject': return slugTail(lastSegment);
    // `…/projects/<slug>/memory` — 가르는 것은 자기 이름이 아니라 부모 slug 다.
    case 'claudeMemory': return slugTail(segments[segments.length - 2] ?? '');
    case 'claudeSkills': return afterMarker('skills');
    case 'claudeAgents': return afterMarker('agents');
    case 'claudeTemp': return slugTail(afterMarker('claude'));
    default: return '';
  }
}

/**
 * `base` 아래의 상대 경로. 같은 자리면 빈 문자열, 아래가 아니면 `null`.
 *
 * 경계에서 슬래시를 확인한다 — 확인하지 않으면 `/home/dev2` 가 `/home/dev` 아래로 읽힌다.
 */
function relativeUnder(abs: string, base: string): string | null {
  if (abs === base) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  if (!abs.startsWith(prefix)) return null;
  return abs.slice(prefix.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// (C) 휘발 세그먼트 — 세션마다 새로 생기는 자리
// ─────────────────────────────────────────────────────────────────────────────

/** UUID 한 벌(하이픈 포함). Claude 의 세션·대화 폴더가 이 모양이다. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 하이픈 없는 긴 16진 이름(해시·임시 디렉터리). 16자 미만은 평범한 폴더명일 수 있어 세지 않는다. */
const LONG_HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
/** epoch 밀리초·초 같은 순수 숫자 이름. 10자리 미만은 버전·번호일 수 있어 세지 않는다. */
const EPOCH_SEGMENT = /^\d{10,}$/;

/** 매번 새로 생기는 자리인가 — 화이트리스트(UUID·긴 16진·긴 숫자)만 참. 오탐이면 그 폴더는 영원히 자기 버블을 못 갖는다. */
export function isVolatileSegment(segment: string): boolean {
  if (!segment) return false;
  return UUID_SEGMENT.test(segment) || LONG_HEX_SEGMENT.test(segment) || EPOCH_SEGMENT.test(segment);
}

/**
 * 첫 휘발 세그먼트 직전 경로(= 흡수할 비휘발 조상), 없으면 `null`. 세션 폴더를 프로젝트 자리에 모아 버블 하나가 "세션 N곳"을 말한다.
 * 루트만 남으면 `null`(§2.1 — 만진 적 없는 `c:` 를 세우지 않는다).
 */
export function volatileFoldTarget(absolutePath: string): { abs: string; volatile: string } | null {
  const shaped = normalizePathShape(absolutePath);
  const segments = shaped.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || !isVolatileSegment(segment)) continue;
    const head = segments.slice(0, i).join('/');
    // 루트만 남으면 접을 곳이 없다(빈 문자열 · `c:` · POSIX 루트 하나).
    if (!head || /^[A-Za-z]:$/.test(head)) return null;
    return { abs: head, volatile: segment };
  }
  return null;
}

/**
 * 이 경로가 어느 휘발 자리에 속하는지 — "세션 N곳" 을 세는 키.
 * 휘발 세그먼트가 없으면 `null`(셀 것이 없다).
 */
export function volatilePlaceOf(absolutePath: string): string | null {
  return volatileFoldTarget(absolutePath)?.volatile ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) 예산제 능동 승격
// ─────────────────────────────────────────────────────────────────────────────

/** 승격 점수를 매길 때 보는 값들. 전부 이미 있는 노드 필드다(새 영속 필드 ❌). */
export interface ExternalPromotionInput {
  activity?: number;
  readCount?: number;
  writeCount?: number;
  lastActivity?: number;
}

/**
 * 접촉 × 최근성. 접촉 = `activity` 와 `readCount + writeCount` 중 큰 쪽(하나만 보면 옛 체크포인트·도구 밖 버블이 영원히 승격 못 한다).
 * 최근성은 반감기 감쇠(계단이면 경계에서 순위가 튄다). `lastActivity` 를 모르면 0.
 */
export function externalPromotionScore(
  input: ExternalPromotionInput,
  now: number,
  halfLifeMs: number = EXTERNAL_PROMOTION_HALF_LIFE_MS,
): number {
  const heat = (input.readCount ?? 0) + (input.writeCount ?? 0);
  const touches = Math.max(input.activity ?? 0, heat);
  if (touches <= 0) return 0;
  const age = Math.max(0, now - (input.lastActivity ?? 0));
  const halfLife = halfLifeMs > 0 ? halfLifeMs : EXTERNAL_PROMOTION_HALF_LIFE_MS;
  const recency = Math.pow(0.5, age / halfLife);
  return touches * recency;
}

/** 승격 후보 하나. `key` 는 노드 키(`__ext__…`)이고 정렬 동률을 가르는 마지막 기준이기도 하다. */
export interface ExternalPromotionCandidate extends ExternalPromotionInput {
  key: string;
  /** 사용자가 핀을 꽂았나(`preservePinned`) — 예산과 무관하게 항상 최상위. */
  pinned?: boolean;
  /**
   * 지금 이 폴더가 매달려 있는 부모(접합) 키. 한 부모에서 몰아 꺼내지 않기 위한 것이라
   * 모르면 생략해도 된다(그때는 부모당 상한이 적용되지 않는다).
   */
  parentKey?: string;
}

/** 승격 규칙의 손잡이 — 전부 선택이고, 주지 않으면 상수 기본값이 쓰인다. */
export interface ExternalPromotionOptions {
  halfLifeMs?: number;
  /** 한 부모에서 꺼낼 수 있는 자식 수. `0` 이하면 제한 없음. */
  perParent?: number;
}

/**
 * 최상위 폴더 고르기 — 핀은 예산 밖(전부 들어온다) · 나머지는 점수순 `budget` 개, 부모당 `perParent` 개(없으면 형제가 예산을 다 먹는다) ·
 * 동률은 최근 활동 → 키 사전순(같은 스냅샷이면 같은 화면).
 */
export function pickPromotedExternalFolders(
  candidates: readonly ExternalPromotionCandidate[],
  budget: number,
  now: number,
  opts: ExternalPromotionOptions = {},
): Set<string> {
  const halfLifeMs = opts.halfLifeMs ?? EXTERNAL_PROMOTION_HALF_LIFE_MS;
  const perParent = opts.perParent ?? EXTERNAL_PROMOTION_PER_PARENT;
  const picked = new Set<string>();
  const scored: { key: string; parentKey: string; score: number; last: number }[] = [];

  for (const candidate of candidates) {
    if (candidate.pinned) {
      picked.add(candidate.key);
      continue;
    }
    scored.push({
      key: candidate.key,
      parentKey: candidate.parentKey ?? '',
      score: externalPromotionScore(candidate, now, halfLifeMs),
      last: candidate.lastActivity ?? 0,
    });
  }

  scored.sort((a, b) => (b.score - a.score) || (b.last - a.last) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const room = Math.max(0, Math.floor(budget));
  const perParentCap = perParent > 0 ? Math.floor(perParent) : Infinity;
  const usedByParent = new Map<string, number>();
  // 핀은 이미 `picked` 에 있다 — 예산은 꺼낸 개수로만 잰다.
  let promotedCount = 0;
  for (const entry of scored) {
    if (promotedCount >= room) break;
    // 부모를 모르는 후보(`''`)는 서로 형제가 아니므로 한 칸에 몰아 세지 않는다.
    if (entry.parentKey) {
      const used = usedByParent.get(entry.parentKey) ?? 0;
      if (used >= perParentCap) continue;
      usedByParent.set(entry.parentKey, used + 1);
    }
    picked.add(entry.key);
    promotedCount++;
  }
  return picked;
}

/**
 * 사용자가 옵션창에 적은 예산을 쓸 수 있는 값으로 만든다.
 * 숫자가 아니거나 범위를 벗어나면 **기본값·경계로 접는다**(입력을 믿고 그대로 쓰지 않는다).
 */
export function normalizeExternalTopBudget(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EXTERNAL_TOP_BUDGET_DEFAULT;
  const floored = Math.floor(n);
  if (floored < EXTERNAL_TOP_BUDGET_BOUNDS.MIN) return EXTERNAL_TOP_BUDGET_BOUNDS.MIN;
  if (floored > EXTERNAL_TOP_BUDGET_BOUNDS.MAX) return EXTERNAL_TOP_BUDGET_BOUNDS.MAX;
  return floored;
}
