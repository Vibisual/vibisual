/**
 * §5.11 — 슬롯이 할 일이 있는지 먼저 가린다(순수 함수). 훅은 이른 반환보다 먼저 도므로, 바깥은 이 종류 기여를 내는 모듈이 있는지만 보고
 * 있을 때만 무거운 훅(버블마다 구독 열두 개)의 안쪽을 그린다.
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
