import type { CodexSkillEntry, CodexSkillSource } from '@vibisual/shared';

/**
 * codexSkillList.ts — §5.25 (M-1): 코덱스 스킬 칸의 **판정**만 모은 곳.
 *
 * 이 파일이 생긴 이유는 종전 코덱스 스킬 칸이 **읽기만 하는 정적 목록**이었기 때문이다. 클로드
 * 스킬 칸에는 클릭 삽입·즐겨찾기·출처 그룹·검색이 있는데 코덱스 칸에는 그중 하나도 없어서,
 * 같은 IDE 안에서 같은 물건이 한쪽에서만 쓸 수 있었다. 화면을 고치면서 **판정은 화면 밖으로**
 * 뺀다 — 그래야 시험이 붙고, 다음에 엔진이 하나 더 늘 때 이 규칙들을 다시 짜지 않는다.
 *
 * **클로드 것을 그대로 베끼지 않는다.** 코덱스에 없는 조작은 만들지 않는다:
 *   - **삭제·복사 ✗** — 스킬 폴더의 주인은 코덱스이고 우리는 그 폴더를 고치지 않기로 했다
 *     (§5.25 (M) ② 읽기 전용 · 안전선). 없는 권한의 손잡이를 그리는 것도 거짓말이다.
 *   - **사용 횟수 ✗** — 코덱스가 어느 스킬을 실제로 썼는지는 그쪽 CLI 가 쥐고 우리에게 주지
 *     않는다. 우리 카운터를 붙이면 화면의 숫자가 사실이 아닌 것이 된다(§5.25 (L) "모르는 것을
 *     지어내지 않은 자리" 와 같은 규율).
 *   - **드래그 재정렬 ✗** — 클로드 쪽 순서는 `skillOrder` 영속에 기대는데, 그 저장고는 출처가
 *     `project|global|plugin` 셋으로 못 박혀 있다. 코덱스 출처(`user|system|plugin`)를 거기
 *     밀어 넣으면 두 엔진의 순서가 서로를 덮어쓴다. 순서는 이름순 고정이고, 자주 쓰는 것은
 *     **즐겨찾기**가 위로 올린다.
 */

/** 코덱스 스킬을 입력창에 넣을 때의 문자열. 코덱스도 슬래시 명령으로 스킬을 부른다. */
export function codexSkillInsertText(name: string): string {
  return `/${name} `;
}

/**
 * 즐겨찾기 저장고의 키.
 *
 * **클로드와 같은 저장고(`appState.skillFavorites`)를 쓰되 접두로 가른다.** 새 영속 필드를
 * 만들지 않는 대신, 이름이 겹치는 스킬(`review` 처럼 흔한 이름)이 두 엔진에 다 있을 때
 * 한쪽 별을 켜면 다른 쪽도 켜지는 일을 막는다.
 */
export const CODEX_FAVORITE_PREFIX = 'codex:';

export function codexFavoriteKey(name: string): string {
  return `${CODEX_FAVORITE_PREFIX}${name}`;
}

/** 저장된 목록에서 코덱스 것만, 접두를 뗀 이름으로. 클로드 항목은 그대로 남는다. */
export function codexFavoriteNames(favorites: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of favorites) {
    if (f.startsWith(CODEX_FAVORITE_PREFIX)) out.push(f.slice(CODEX_FAVORITE_PREFIX.length));
  }
  return out;
}

/** 별을 켜고 끈 뒤의 **전체** 목록(클로드 항목 보존). 저장 API 가 전체 치환이라 그렇게 만든다. */
export function toggleCodexFavorite(favorites: readonly string[], name: string): string[] {
  const key = codexFavoriteKey(name);
  return favorites.includes(key) ? favorites.filter((f) => f !== key) : [...favorites, key];
}

/**
 * 출처가 없는 항목은 `user` 로 읽는다.
 *
 * 옛 스냅샷(홈만 읽던 시절)에는 `source` 가 없는데, 그때 목록은 **전부 홈 것**이었다 —
 * 그래서 이 기본값은 넘겨짚기가 아니라 그 시절의 사실이다.
 */
export function codexSkillSourceOf(skill: CodexSkillEntry): CodexSkillSource {
  return skill.source ?? 'user';
}

/** 검색어 한 줄이 이 스킬에 걸리는가. 이름·설명·플러그인 이름을 본다. */
export function codexSkillMatches(skill: CodexSkillEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (skill.name.toLowerCase().includes(q)) return true;
  if (skill.description?.toLowerCase().includes(q)) return true;
  if (skill.pluginName?.toLowerCase().includes(q)) return true;
  return false;
}

export interface CodexSkillGroups {
  /** 즐겨찾기 — 출처 무관, 별 누른 순서. 출처 그룹에서는 빠진다(같은 것을 두 번 그리지 않는다). */
  favorites: CodexSkillEntry[];
  /** 사용자가 직접 넣은 것 — `~/.codex/skills/<이름>/`. */
  user: CodexSkillEntry[];
  /** 코덱스가 기본으로 얹는 것 — `~/.codex/skills/.system/`. */
  system: CodexSkillEntry[];
  /** 플러그인이 실은 것. */
  plugin: CodexSkillEntry[];
  /** 검색으로 걸러지기 **전** 전체 개수. 헤더가 "3 / 15" 를 말할 수 있게. */
  total: number;
  /** 검색으로 걸러진 뒤 개수. */
  shown: number;
}

/**
 * 목록을 화면이 그릴 모양으로 — 검색으로 거르고, 즐겨찾기를 뽑아 올리고, 출처로 나눈다.
 *
 * **즐겨찾기는 검색에도 걸린다** — 검색 중에 안 맞는 즐겨찾기가 남아 있으면 "찾은 것"이
 * 무엇인지 흐려진다(클로드 칸과 같은 규칙은 아니지만, 검색이 없던 그쪽과 상황이 다르다).
 */
export function groupCodexSkills(
  skills: readonly CodexSkillEntry[],
  favoriteNames: readonly string[],
  query: string,
): CodexSkillGroups {
  const favSet = new Set(favoriteNames);
  const matched = skills.filter((s) => codexSkillMatches(s, query));

  // 즐겨찾기는 **별 누른 순서**로. 같은 이름이 두 자리에 있으면(실측: `spreadsheets`) 둘 다 올린다.
  const favorites: CodexSkillEntry[] = [];
  for (const name of favoriteNames) {
    for (const s of matched) {
      if (s.name === name) favorites.push(s);
    }
  }

  const user: CodexSkillEntry[] = [];
  const system: CodexSkillEntry[] = [];
  const plugin: CodexSkillEntry[] = [];
  for (const s of matched) {
    if (favSet.has(s.name)) continue;
    const src = codexSkillSourceOf(s);
    if (src === 'system') system.push(s);
    else if (src === 'plugin') plugin.push(s);
    else user.push(s);
  }

  return { favorites, user, system, plugin, total: skills.length, shown: matched.length };
}
