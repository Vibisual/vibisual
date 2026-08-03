/**
 * §5.11 v3.93 — 4차 배치 판정 고정 테스트.
 *
 * 점검 카드 골격(`defineInspector`)이 spec 을 그대로 신뢰하므로, 등급 계산이 들어간 것은 순수 함수로
 * 빼서 여기서 못 박는다. 함께 검증하는 것은 **골격 자체의 계약** — 배지가 문턱 아래에서는 안 붙고,
 * 선언한 데이터 축(`needs`)이 매니페스트와 어긋나지 않는다는 것.
 */
import { describe, it, expect } from 'vitest';
import { defineDriftLevel } from './instruction-drift/drift.js';
import { PLUGIN_MANIFESTS, PLUGIN_DATA_NEEDS, validateRegistry } from './registry.js';
import { PLUGIN_CLIENT_MODULES } from './client.js';

describe('instruction-drift 등급', () => {
  it('상시 규칙이 없으면 표류를 논하지 않는다', () => {
    expect(defineDriftLevel(false, 100).key).toBe('noRules');
  });

  it('규칙이 있고 세션이 짧으면 아직 선명하다', () => {
    expect(defineDriftLevel(true, 5).key).toBe('fresh');
  });

  it('턴이 쌓일수록 등급이 올라간다', () => {
    expect(defineDriftLevel(true, 25).key).toBe('rising');
    expect(defineDriftLevel(true, 40).key).toBe('high');
  });
});

describe('등록부 계약', () => {
  it('id 규약 위반·중복이 없다', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('모든 플러그인은 기본 비활성으로 시작한다', () => {
    expect(PLUGIN_MANIFESTS.filter((m) => m.enabledByDefault)).toEqual([]);
  });

  it('매니페스트와 클라이언트 모듈이 1:1 로 짝을 이룬다', () => {
    const manifestIds = PLUGIN_MANIFESTS.map((m) => m.id).sort();
    const moduleIds = PLUGIN_CLIENT_MODULES.map((m) => m.manifest.id).sort();
    expect(moduleIds).toEqual(manifestIds);
  });

  it('배지를 선언한 플러그인만 배지 기여를 갖는다', () => {
    for (const mod of PLUGIN_CLIENT_MODULES) {
      const declared = mod.manifest.contributes.includes('bubbleBadge');
      expect(Boolean(mod.bubbleBadges?.length)).toBe(declared);
    }
  });

  /**
   * 배지 말고 나머지 슬롯도 같은 규율을 받아야 한다. 선언과 구현이 어긋나면 두 방향 모두 조용하다 —
   * **선언만 있으면** 창은 "여기에 보입니다"라고 적어 두고 정작 아무것도 안 그려지고,
   * **구현만 있으면** 창의 기여 목록이 실제 화면보다 적게 말한다. 둘 다 켜 본 사람만 알게 된다.
   */
  it('패널·설정·헤더 기여도 선언과 구현이 일치한다', () => {
    const mismatched: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      const pairs: [string, boolean][] = [
        ['panelSection', Boolean(mod.panelSections?.length)],
        ['settingsSection', Boolean(mod.settingsSection)],
        ['headerItem', Boolean(mod.headerItems?.length)],
      ];
      for (const [kind, implemented] of pairs) {
        const declared = mod.manifest.contributes.includes(kind as 'panelSection');
        if (declared !== implemented) mismatched.push(`${mod.manifest.id}:${kind} 선언=${declared} 구현=${implemented}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('데이터를 쓰는 플러그인은 needs 로 선언한다 — 선언 없이 받는 경로는 없다', () => {
    for (const mod of PLUGIN_CLIENT_MODULES) {
      for (const need of mod.needs ?? []) {
        expect(PLUGIN_DATA_NEEDS).toContain(need);
      }
    }
  });

  /**
   * 등급은 선택 필드라 안 달아도 타입이 통과하고 화면도 그려진다 — 그래서 조용히 빠진다. 빠지면 호스트가
   * `neutral` 로 폴백하는데, `neutral` 은 **접힘 대상**이다. 즉 등급을 잊은 카드는 문제를 보고하는
   * 순간에도 "더 보기" 뒤로 숨는다. 실제로 손으로 쓴 패널 6장이 전부 이 상태였고, `lethal-trifecta` 와
   * `rogue-agent` 가 거기 포함돼 있었다.
   */
  it('모든 패널 카드가 등급을 선언한다 — 빠지면 경고가 접힌다', () => {
    const missing: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      for (const section of mod.panelSections ?? []) {
        if (!section.severity) missing.push(`${mod.manifest.id}:${section.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
