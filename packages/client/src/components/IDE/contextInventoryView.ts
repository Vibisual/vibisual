/**
 * §5.5 #17-28 v4.96 — 주입원 목록의 **화면 로직**(정렬·검색·묶음).
 *
 * React 를 물지 않는 순수 함수라 단위 테스트로 고정된다. 화면(`IDEContextView`)은 이 결과를 그리기만 한다.
 */
import type { ContextSourceCategory, ContextSourceItem } from '@vibisual/shared';

/** 정렬 축 — 사용자가 말한 "분류·검색·우선순위·날짜·토큰" 을 그대로 축으로 세운다. */
export type ContextSortKey = 'tokens' | 'updated' | 'name' | 'category';

/** 화면에 세우는 분류 순서 — 우리가 손댈 수 있는 것부터, 못 건드리는 것은 뒤로. */
export const CONTEXT_CATEGORY_ORDER: ContextSourceCategory[] = [
  'vibisual',
  'plugins',
  'memory',
  'instructions',
  'skills',
  'tools',
  'system',
];

/** 분류 라벨의 i18n 키. */
export const CONTEXT_CATEGORY_LABEL_KEY: Record<ContextSourceCategory, string> = {
  vibisual: 'ide.context.cat.vibisual',
  plugins: 'ide.context.cat.plugins',
  memory: 'ide.context.cat.memory',
  instructions: 'ide.context.cat.instructions',
  skills: 'ide.context.cat.skills',
  tools: 'ide.context.cat.tools',
  system: 'ide.context.cat.system',
};

/** 검색어가 걸리는 자리 — 제목·부연·경로·id·내역 파일명까지(경로 조각으로도 찾을 수 있게). */
export function matchesQuery(item: ContextSourceItem, translatedTitle: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    translatedTitle,
    item.title,
    item.detail ?? '',
    item.path ?? '',
    item.id,
    ...(item.children ?? []).flatMap((c) => [c.title, c.path ?? '']),
  ].join('\n').toLowerCase();
  return hay.includes(q);
}

/**
 * 정렬. **같은 값이면 항상 같은 순서**가 되도록 마지막에 id 로 못 박는다 —
 * 목록이 새로 고쳐질 때마다 줄이 자리를 바꾸면 토글을 누르기 어렵다.
 */
export function sortItems(items: ContextSourceItem[], key: ContextSortKey, desc: boolean, titleOf: (i: ContextSourceItem) => string): ContextSourceItem[] {
  const dir = desc ? -1 : 1;
  return [...items].sort((a, b) => {
    let d = 0;
    if (key === 'tokens') d = a.tokens - b.tokens;
    else if (key === 'updated') d = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
    else if (key === 'name') d = titleOf(a).localeCompare(titleOf(b));
    else {
      d = CONTEXT_CATEGORY_ORDER.indexOf(a.category) - CONTEXT_CATEGORY_ORDER.indexOf(b.category);
      if (d === 0) d = b.tokens - a.tokens; // 분류 안에서는 무거운 것부터(어디서 새는지 먼저 보이게).
      return dir === 1 ? d : -d;
    }
    if (d !== 0) return dir * d;
    return a.id.localeCompare(b.id);
  });
}

/** 분류 묶음 — `category` 정렬일 때만 머리글을 세운다(다른 축에서는 한 줄로 죽 늘어놓는 편이 읽힌다). */
export function groupByCategory(items: ContextSourceItem[]): { category: ContextSourceCategory; items: ContextSourceItem[] }[] {
  const out: { category: ContextSourceCategory; items: ContextSourceItem[] }[] = [];
  for (const cat of CONTEXT_CATEGORY_ORDER) {
    const group = items.filter((i) => i.category === cat);
    if (group.length > 0) out.push({ category: cat, items: group });
  }
  // 목록에 없는 분류(나중에 추가된 것)도 빠뜨리지 않는다.
  const known = new Set(CONTEXT_CATEGORY_ORDER);
  const rest = items.filter((i) => !known.has(i.category));
  if (rest.length > 0) out.push({ category: rest[0]!.category, items: rest });
  return out;
}

/** 토큰 표기 — 1,234 / 12.3K. 화면 폭이 좁아 네 자리부터 줄인다. */
export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/** 켜진 것 합계 / 전체 합계 — 머리에 서는 "지금 이 프롬프트가 얼마짜리인가". */
export function sumTokens(items: ContextSourceItem[]): { enabled: number; total: number } {
  let enabled = 0;
  let total = 0;
  for (const i of items) {
    total += i.tokens;
    if (i.enabled) enabled += i.tokens;
  }
  return { enabled, total };
}
