/**
 * externalFolderView.ts — §2.1 · 외부 폴더 버블의 **무엇을 보여 줄까** 판정.
 *
 * 접합 트리는 폭발을 막았지만 정보를 통째로 삼켰다(실측: `external_folder` 33개가 최상위 3개로
 * 접혔고 그중 홈 하나가 25곳을 삼킨 채 활동 0 · 위성 0 · 화면 숫자는 직속 자식 수 `4`). 원인은
 * 접는 기준이 **경로 구조**라는 것이다 — 경로는 에이전트가 무엇을 하는지와 무관하다. 그래서
 * 이 모듈은 접는 기준을 **활동**으로 옮기는 판정 넷을 소유한다:
 *
 * - (B) `externalPromotionScore` / `pickPromotedExternalFolders` — 예산 안에서 무엇을 최상위에 세울까.
 * - (C) `isVolatileSegment` / `volatileFoldTarget` — 세션마다 새로 생기는 자리를 어디로 접을까.
 * - (D) `externalPlaceKeyFor` — 그 자리를 사람이 읽는 이름으로 부를 수 있나.
 *
 * **서버가 트리를 세울 때와 클라이언트가 그릴 때가 같은 답을 내야 한다** — 두 벌이 되면 한쪽만
 * 고쳐져 "숫자는 올랐는데 화면은 그대로"가 된다(§2.1 #3 이 셸 토크나이저를 한 벌로 묶은 규율).
 *
 * 순수 함수 모듈이다 — 디스크 접근 ❌ · `process.platform` 읽기 ❌ · `Date.now()` 읽기 ❌
 * (시각·플랫폼·홈·임시 디렉터리는 전부 **인자로 받는다**). 그래서 값이 결정적이고,
 * 실기가 없는 개발기 한 대에서 세 OS 를 단위 테스트로 고정할 수 있다.
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

/**
 * 이 절대경로가 **알려진 자리**인가. 맞으면 i18n 키 접미사, 아니면 `null`.
 *
 * 돌려주는 것은 **키**다(문구 ❌) — 서버에는 i18n 런타임이 없고 화면 문구는 12개 로케일이라,
 * 라벨을 여기서 완성하면 그 사용자에게는 읽을 수 없는 글자가 된다(§5.11 플러그인 `strings.ts`
 * 와 같은 판단). 화면 문구는 클라이언트가 `canvas.externalPlace.<키>` 로 고른다.
 *
 * **경로를 바꾸지 않는다** — 이 판정은 표시 전용이라 노드 키·`absolutePath` 에 관여하지 않는다.
 * 그래서 대소문자 접기도 여기서는 안전한 쪽(무조건 접기)이 아니라 `pathKey` 규약을 그대로 따른다.
 */
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
 * §2.1 (D) — 자리 이름 옆에 남길 **구분자**. 같은 이름이 여럿 생기는 자리에서만 뜻이 있다.
 *
 * 이름만으로 라벨을 갈아 끼우면 `~/.claude/projects/<A>` 와 `<B>` 가 **둘 다 "Claude 기록"** 이
 * 되어, 읽히게 만들려던 것이 오히려 구분을 지운다. 그래서 여럿이 생기는 자리는 그 자리를 가르는
 * 조각을 함께 돌려준다.
 *
 * Claude 가 경로를 `-` 로 이어 만든 slug(`c--users-dev-work-…-vibisual`)는 통째로는 읽을 수
 * 없지만 **마지막 조각이 프로젝트 이름**이다. 그 조각만 남기면 "Claude 기록 · vibisual" 이 된다.
 *
 * 뽑을 것이 없으면 빈 문자열이다 — 화면은 그때 **종전 라벨로 돌아간다**(없는 이름을 지어내지
 * 않는다). 구분자가 필요 없는 자리(홈 · 캐시 · 설치 위치처럼 하나뿐인 곳)도 빈 문자열이다.
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

/**
 * 이 경로 조각이 **매번 새로 생기는 자리**인가.
 *
 * 모르는 것을 휘발로 넘겨짚지 않는다 — 화이트리스트 셋(UUID · 긴 16진 · 긴 숫자)만 참이고
 * 그 밖은 전부 거짓이다. 오탐의 대가가 크기 때문이다: 평범한 폴더를 휘발로 읽으면 그 폴더는
 * 캔버스에서 **영원히 자기 버블을 갖지 못한다**.
 */
export function isVolatileSegment(segment: string): boolean {
  if (!segment) return false;
  return UUID_SEGMENT.test(segment) || LONG_HEX_SEGMENT.test(segment) || EPOCH_SEGMENT.test(segment);
}

/**
 * 휘발 세그먼트가 있으면 **그 직전까지의 경로**를 돌려준다(= 흡수해 갈 자리). 없으면 `null`.
 *
 * `…/claude/<프로젝트>/<세션UUID>/tasks` 는 세션마다 새로 생겨 캔버스를 끝없이 쪼갠다.
 * 그 폴더에 자기 버블을 주지 않고 **가장 가까운 비휘발 조상**(`…/claude/<프로젝트>`)에 모으면,
 * 세션이 몇 개가 되든 버블은 하나이고 그 자리가 "세션 N곳"을 배지로 말한다.
 *
 * 첫 번째 휘발 세그먼트에서 자른다 — 그 아래는 전부 그 세션에 딸린 것이라 따로 셀 뜻이 없다.
 * 드라이브 루트/POSIX 루트만 남는 경우는 `null`(만진 적 없는 `c:` 를 최상위에 세우지 않는다는
 * §2.1 접합 규율과 같은 이유).
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
 * **접촉 × 최근성**. 클수록 최상위에 설 자격이 있다.
 *
 * 접촉은 `activity` 와 `readCount + writeCount` 중 큰 쪽이다 — 구버전 체크포인트에는 히트 두 칸이
 * 없고(§5.24 하위 호환), 반대로 도구가 아닌 경로로 생긴 버블은 `activity` 만 오른다. 둘 중 하나만
 * 보면 그 절반이 점수 0 이 되어 **영원히 승격되지 않는다**.
 *
 * 최근성은 반감기 지수 감쇠다. 계단(예: "10분 안"만 가점)이 아니라 연속이라 **경계에서 순위가
 * 튀지 않는다** — 튀면 같은 폴더가 화면에서 나타났다 사라졌다 한다.
 *
 * `lastActivity` 를 모르면 0 을 쓴다(가장 오래된 것으로 본다) — 모르는 것을 최신으로 넘겨짚어
 * 실제로 뜨거운 폴더를 밀어내지 않기 위해서다.
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
  /** 사용자가 핀을 꽂았나(`preservePinned`). **예산과 무관하게 항상 최상위**(사용자 결정). */
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
 * 예산 안에서 최상위에 세울 폴더를 고른다.
 *
 * - **핀은 예산을 소비하지 않는다.** 사용자가 고정한 것은 점수와 무관하게 전부 들어온다 —
 *   "예산 때문에 내가 꽂아 둔 것이 사라진다"는 것은 핀이라는 약속을 깨는 일이다.
 * - 나머지는 점수 내림차순으로 `budget` 개까지, **부모당 `perParent` 개까지**.
 *   두 번째 상한이 없으면 형제 12개가 예산을 통째로 먹어 접합 트리가 무너진다
 *   (`EXTERNAL_PROMOTION_PER_PARENT` 주석에 그 이유가 있다).
 * - **동률은 결정적으로 가른다**(최근 활동 → 키 사전순). 안 그러면 같은 스냅샷을 두 번 계산할 때
 *   순서가 달라져 화면이 이유 없이 흔들린다.
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
  // 핀은 이미 `picked` 에 들어 있다 — 그 크기로 예산을 재면 핀이 예산을 먹는다.
  //   잡는 것은 **꺼낸 개수**뿐이다(사용자 결정).
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
