/**
 * §5.11 v4.30 — 슬롯이 실제로 할 일이 있는지 먼저 가리는 판단 — 순수 함수.
 *
 * 배지 슬롯은 **모든 버블 안에** 들어간다. 그런데 그 안에서 컨텍스트를 만드느라 버블마다 스토어 구독을
 * 열두 개씩 달았다 — 켠 플러그인이 하나도 없어도. 기본값이 전부 비활성이므로, 아직 아무것도 안 켠
 * 사용자가 그 비용을 그대로 낸다. 호스트 주석은 "기여가 없으면 캔버스 렌더 비용 0"이라고 적고 있었지만,
 * 훅은 이른 반환보다 먼저 돈다.
 *
 * 그래서 슬롯을 둘로 가른다. 바깥은 **이 종류의 기여를 내는 모듈이 있는지만** 보고, 있을 때만 무거운
 * 훅을 가진 안쪽을 그린다. 그 판단을 여기 순수 함수로 두어 테스트로 고정한다.
 */
import type { PluginClientModule } from '@vibisual/plugins';

export type SlotKind = 'bubbleBadge' | 'panelSection' | 'headerItem';

const PICK: Record<SlotKind, (m: PluginClientModule) => number> = {
  bubbleBadge: (m) => (m.bubbleBadges ?? []).length,
  panelSection: (m) => (m.panelSections ?? []).length,
  headerItem: (m) => (m.headerItems ?? []).length,
};

/** 이 슬롯에 실제로 무언가를 내는 모듈만 남긴다. 없으면 빈 배열 — 바깥 슬롯은 그대로 `null` 을 낸다. */
export function modulesForSlot(modules: readonly PluginClientModule[], kind: SlotKind): PluginClientModule[] {
  const size = PICK[kind];
  return modules.filter((m) => size(m) > 0);
}
