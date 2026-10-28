/**
 * §5.11 — 4차 배치 판정 고정. `defineInspector` 는 spec 을 그대로 믿으므로 등급 계산은 순수 함수로 빼서 여기서 고정한다.
 * 골격 계약도 본다 — 배지는 문턱 아래에서 안 붙고, 선언한 데이터 축(`needs`)이 매니페스트와 맞는다.
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
   * 배지 말고 다른 슬롯도 선언과 구현이 맞아야 한다 — 어긋나면 양쪽 다 조용하다
   * (선언만 있으면 창은 "여기에 보입니다"인데 안 그려지고, 구현만 있으면 기여 목록이 화면보다 적게 말한다).
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

  /** 등급은 선택 필드라 빠져도 타입·화면이 통과한다. 빠지면 호스트가 `neutral`(접힘 대상)로 폴백해 문제를 보고할 때도 "더 보기" 뒤로 숨는다. */
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
