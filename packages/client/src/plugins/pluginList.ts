/**
 * §5.11 v4.24 — Plugins 창 목록 계산 — 순수 함수.
 *
 * 카드가 111종이 되면서 **평면 목록으로는 못 고르는 화면**이 됐다. 이름을 알아도 스크롤로 찾아야 하고,
 * 무엇을 켜 뒀는지는 끝까지 훑어야 알 수 있다. 목록을 거르고 묶는 판단만 여기로 떼어 두고,
 * 창은 결과를 그리기만 한다(`panelOrder.ts` 와 같은 이유 — 규칙이 컴포넌트 안에 있으면 테스트가 못 붙는다).
 *
 * 원칙 셋.
 *  ① **켠 것이 먼저** — 무엇을 켜 뒀는지가 창을 열자마자 보여야 한다. 분류 안에서 켠 것을 위로 올린다.
 *  ② **찾는 말은 이름에만 있지 않다** — 사람은 "치명적"이 아니라 "권한"으로 찾는다. 설명도 함께 본다.
 *  ③ **빈 분류는 내지 않는다** — 걸러낸 뒤 남은 것이 없는 머리글은 화면의 소음일 뿐이다.
 */
import type { PluginCategory, PluginManifest } from '@vibisual/shared';

/** 분류를 내보이는 순서. 위험한 것부터 — 켤지 말지 판단이 가장 급한 순서다. */
export const PLUGIN_CATEGORY_ORDER: readonly PluginCategory[] = [
  'security', 'observability', 'workflow', 'experimental',
];

export interface PluginListGroup {
  category: PluginCategory;
  items: PluginManifest[];
}

export interface PluginListOptions {
  query: string;
  onlyEnabled: boolean;
  enabled: ReadonlySet<string>;
  /** 설명 본문을 꺼내는 함수 — 번역된 문장으로 찾을 수 있어야 한다. */
  describe: (manifest: PluginManifest) => string;
}

const norm = (s: string): string => s.toLowerCase().trim();

function matches(manifest: PluginManifest, needle: string, describe: PluginListOptions['describe']): boolean {
  if (needle === '') return true;
  if (norm(manifest.name).includes(needle) || manifest.id.includes(needle)) return true;
  // 설명 조회는 번역 함수를 타므로 이름이 먼저 걸린 경우에는 부르지 않는다.
  return norm(describe(manifest)).includes(needle);
}

export function groupPlugins(
  manifests: readonly PluginManifest[],
  { query, onlyEnabled, enabled, describe }: PluginListOptions,
): PluginListGroup[] {
  const needle = norm(query);
  const kept = manifests.filter(
    (m) => (!onlyEnabled || enabled.has(m.id)) && matches(m, needle, describe),
  );

  const groups: PluginListGroup[] = [];
  for (const category of PLUGIN_CATEGORY_ORDER) {
    const items = kept
      .filter((m) => m.category === category)
      // 켠 것을 위로, 같은 상태끼리는 이름순. 켤 때마다 자리가 크게 흔들리지 않도록 이름순을 고정 축으로 둔다.
      .sort((a, b) => {
        const onDiff = Number(enabled.has(b.id)) - Number(enabled.has(a.id));
        return onDiff !== 0 ? onDiff : a.name.localeCompare(b.name);
      });
    if (items.length > 0) groups.push({ category, items });
  }
  return groups;
}

/** 걸러진 뒤에도 유효한 선택인가 — 아니면 첫 항목으로 옮긴다(빈 화면을 남기지 않는다). */
export function resolveSelection(groups: PluginListGroup[], current: string): string {
  for (const g of groups) {
    if (g.items.some((m) => m.id === current)) return current;
  }
  return groups[0]?.items[0]?.id ?? '';
}
