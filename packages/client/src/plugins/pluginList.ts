/**
 * §5.11 — Plugins 창 목록 거르기·묶기(순수 함수). ① 분류 안에서 켠 것을 위로 ② 설명도 찾는다("치명적"이 아니라 "권한"으로 찾는다)
 * ③ 걸러 낸 뒤 빈 분류는 내지 않는다 ④ 노출 게이트 — 켜도 고정 문장만 내는 카드는 §7.7 디버그 모드에서만 선다.
 */
import type { PluginCategory, PluginManifest } from '@vibisual/shared';
import { hasOwnToggle } from '@vibisual/plugins';

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
  /**
   * §5.11 노출 게이트 — 프로젝트를 훑지 않는 카드까지 세울지(§7.7 디버그 모드). 기본은 `enforcesProject` 만.
   * 켜 둔 것은 항상 세운다 — 사라지면 "안 보이는데 프롬프트에는 실리는" 유령이 된다.
   */
  showDraft?: boolean;
}

const norm = (s: string): string => s.toLowerCase().trim();

/** 켜면 이 프로젝트를 실제로 훑어 집행하는가 — 목록 기본 노출 판정(§5.11). */
export function isProjectEnforcing(manifest: PluginManifest): boolean {
  return manifest.enforcesProject === true;
}

function matches(manifest: PluginManifest, needle: string, describe: PluginListOptions['describe']): boolean {
  if (needle === '') return true;
  if (norm(manifest.name).includes(needle) || manifest.id.includes(needle)) return true;
  // 설명 조회는 번역 함수를 타므로 이름이 먼저 걸린 경우에는 부르지 않는다.
  return norm(describe(manifest)).includes(needle);
}

export function groupPlugins(
  manifests: readonly PluginManifest[],
  { query, onlyEnabled, enabled, describe, showDraft = false }: PluginListOptions,
): PluginListGroup[] {
  const needle = norm(query);
  const kept = manifests.filter(
    (m) => (!onlyEnabled || enabled.has(m.id))
      // §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드는 켜져 있어도 이 목록에 서지 않는다.
      //   세우면 그 칸이 두 번째 관문이 되어 "뷰에서 켰는데 안 돈다"가 만들어진다.
      && !hasOwnToggle(m)
      // 노출 게이트 — 디버그 모드가 아니면 아직 안 만들어진 카드는 뺀다. 단 **켠 것은 남긴다**:
      //   목록에서 사라지면 끌 방법이 없어지고, 그동안 프롬프트에는 계속 실린다.
      && (showDraft || isProjectEnforcing(m) || enabled.has(m.id))
      && matches(m, needle, describe),
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
