/**
 * §5.11 v4.30 — 슬롯 사전 판정 고정 테스트.
 *
 * 배지 슬롯은 모든 버블 안에 들어가므로, 여기서 "할 일 없음"을 못 걸러 내면 켠 플러그인이 하나도 없는
 * 사용자까지 버블마다 스토어 구독 열두 개를 문다. 기본값이 전부 비활성이라 그게 대부분의 사용자다.
 */
import { describe, it, expect } from 'vitest';
import type { PluginClientModule } from '@vibisual/plugins';
import { modulesForSlot } from './slots.js';

const mod = (id: string, parts: Partial<PluginClientModule>): PluginClientModule =>
  ({
    manifest: {
      id, name: id, version: '1.0.0', category: 'observability',
      descriptionKey: `panel.plugins.${id}.desc`, enabledByDefault: false,
      contributes: ['panelSection'], clientOnly: true,
    },
    ...parts,
  }) as PluginClientModule;

const stub = { key: 'k', match: () => true, render: () => null };

const BADGE = mod('badge-only', { bubbleBadges: [stub] });
const PANEL = mod('panel-only', { panelSections: [stub] });
const HEADER = mod('header-only', { headerItems: [{ key: 'h', render: () => null }] });
const NOTHING = mod('nothing', {});
const EMPTY_ARRAYS = mod('empty', { bubbleBadges: [], panelSections: [], headerItems: [] });

describe('슬롯 사전 판정', () => {
  it('그 종류를 내는 모듈만 남긴다', () => {
    expect(modulesForSlot([BADGE, PANEL, HEADER], 'bubbleBadge').map((m) => m.manifest.id)).toEqual(['badge-only']);
    expect(modulesForSlot([BADGE, PANEL, HEADER], 'panelSection').map((m) => m.manifest.id)).toEqual(['panel-only']);
    expect(modulesForSlot([BADGE, PANEL, HEADER], 'headerItem').map((m) => m.manifest.id)).toEqual(['header-only']);
  });

  it('아무것도 안 켰으면 빈 배열 — 바깥 슬롯이 훅을 열기 전에 끝난다', () => {
    expect(modulesForSlot([], 'bubbleBadge')).toEqual([]);
  });

  it('선언이 없는 모듈은 세지 않는다', () => {
    expect(modulesForSlot([NOTHING], 'bubbleBadge')).toEqual([]);
  });

  it('빈 배열로 선언한 것도 "할 일 없음"이다 — 길이 0 을 통과시키면 사전 판정이 무의미해진다', () => {
    expect(modulesForSlot([EMPTY_ARRAYS], 'bubbleBadge')).toEqual([]);
    expect(modulesForSlot([EMPTY_ARRAYS], 'panelSection')).toEqual([]);
    expect(modulesForSlot([EMPTY_ARRAYS], 'headerItem')).toEqual([]);
  });

  it('한 모듈이 여러 종류를 내면 각 슬롯에 다 걸린다', () => {
    const both = mod('both', { bubbleBadges: [stub], panelSections: [stub] });
    expect(modulesForSlot([both], 'bubbleBadge')).toHaveLength(1);
    expect(modulesForSlot([both], 'panelSection')).toHaveLength(1);
    expect(modulesForSlot([both], 'headerItem')).toHaveLength(0);
  });

  it('원래 순서를 지킨다 — 배지가 켤 때마다 자리를 바꾸면 안 된다', () => {
    const a = mod('a', { bubbleBadges: [stub] });
    const b = mod('b', { bubbleBadges: [stub] });
    expect(modulesForSlot([a, NOTHING, b], 'bubbleBadge').map((m) => m.manifest.id)).toEqual(['a', 'b']);
  });
});
