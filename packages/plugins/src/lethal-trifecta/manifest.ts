/**
 * §5.11 v3.88 — 첫 플러그인 매니페스트.
 *
 * 서버 상태·영속 0 인 **순수 파생 계산 + 표시 전용** 플러그인이라 커널 배관 검증용으로 가장 싸다.
 * 실패해도 걷어내는 비용이 거의 없다.
 */
import type { PluginManifest } from '@vibisual/shared';

export const LETHAL_TRIFECTA_ID = 'lethal-trifecta';

export const lethalTrifectaManifest: PluginManifest = {
  id: LETHAL_TRIFECTA_ID,
  name: 'Lethal Trifecta',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.lethalTrifecta.desc',
  enabledByDefault: false,
  contributes: ['bubbleBadge', 'panelSection', 'agentPrompt'],
  clientOnly: false,
};
