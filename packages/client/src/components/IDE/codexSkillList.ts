import type { CodexSkillEntry, CodexSkillSource } from '@vibisual/shared';

/**
 * §5.25 (M-1) 코덱스 스킬 칸의 판정(화면 밖이라 시험이 붙는다). 클로드에 있어도 코덱스에 없는 조작은 만들지 않는다:
 * 삭제 ✗(기존 스킬 보존, 공유는 별도 섹션) · 사용 횟수 ✗(코덱스 CLI 만 안다 — 지어낸 숫자가 된다, §5.25 (L)) ·
 * 드래그 재정렬 ✗(`skillOrder` 는 `project|global|plugin` 출처로 묶여 코덱스 출처를 넣으면 순서가 서로 덮인다 — 이름순 + 즐겨찾기).
 */

/** Codex explicit skill invocation uses `$name`; `/skills` opens the picker. */
export function codexSkillInsertText(name: string): string {
  return `$${name} `;
}

/** 클로드와 같은 `appState.skillFavorites` 를 쓰되 접두로 가른다 — 같은 이름(`review`)의 별이 두 엔진에 함께 켜지지 않게. */
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

/** 출처 없는 항목은 `user` — `source` 없는 옛 스냅샷은 홈만 읽던 때라 전부 홈 것이다. */
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

/** 즐겨찾기도 검색에 걸린다 — 안 맞는 즐겨찾기가 남으면 찾은 것이 흐려진다. */
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
