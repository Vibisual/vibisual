/**
 * §5.3 #10-5 — **설정 덜어내기 뷰**가 지켜야 하는 것들.
 *
 * 사용자 지시: 오케스트라처럼 활동바에 칸을 세우고 프로젝트 전체·에이전트·이 세션만 3단으로 켜면,
 * 이 세션이 동작주일 때 **배제한 목록**과 **덜어낸 목록**을 보여 주고 그 상태로 일하게.
 *
 * 여기서 잠그는 것:
 *   ① 활동바 자리 — 오케스트라 **바로 뒤**, 로컬 엔진 버블에는 서지 않는다(턴 사본을 깎을 CLI 축이 없다).
 *   ② 저장 창구 둘만 쓴다 — 켬/끔 = `/scope`, 규칙 끄기 = `/settings`. 다른 길로 쓰면 서버 검증을 비껴간다.
 *   ③ 두 목록은 **각각 제 판**이다 — 덜어낸 것과 배제한 것을 한 판에 섞지 않는다.
 *   ④ 규칙·사유·남긴 까닭의 이름표가 en 에 다 있다 — 없으면 키 문자열이 그대로 뜬다.
 *   ⑤ 저장된 설정을 화면이 고치지 않는다 — 이 칸은 `/api/agent-config` 를 부르지 않는다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다.
 * ko 를 비롯한 11개 로케일은 `/i18n-sync` 가 채운다 — 그래서 여기서는 en 만 묻는다.
 */
import { describe, it, expect } from 'vitest';
import { CONFIG_TRIM_PROTECTED, CONFIG_TRIM_RULES, CONFIG_TRIM_SCOPE_ORDER } from '@vibisual/shared';
import { DEFAULT_ACTIVITY_ORDER, activityItem } from './ideActivityItems.js';
import { isViewAllowedForProvider } from './ideProviderViews.js';
import en from '../../i18n/locales/en.json';

const tsx = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const viewSrc = (): string => tsx['./IDEConfigTrimView.tsx'] ?? '';
const sidebarSrc = (): string => tsx['./IDESidebar.tsx'] ?? '';
const iconSrc = (): string => tsx['./ideActivityIcons.tsx'] ?? '';
const barSrc = (): string => tsx['./IDEActivityBar.tsx'] ?? '';

const readIn = (root: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    root,
  );

describe('§5.3 #10-5 설정 덜어내기 — 활동바 자리', () => {
  it('활동바 표에 서고, 자리는 오케스트라 **바로 뒤**다', () => {
    const order = [...DEFAULT_ACTIVITY_ORDER];
    const orchestra = order.indexOf('orchestra');
    expect(orchestra, '오케스트라 칸이 있어야 한다').toBeGreaterThan(-1);
    expect(order.indexOf('configTrim'), '설정 덜어내기 칸이 오케스트라 바로 뒤에 없다').toBe(orchestra + 1);
    expect(activityItem('configTrim')?.labelKey).toBe('ide.activityBar.configTrim');
    expect(activityItem('configTrim')?.accent).toMatch(/^border-[a-z]+-\d{3}$/);
    expect(typeof readIn(en, 'ide.activityBar.configTrim')).toBe('string');
    expect(iconSrc()).toContain("case 'configTrim':");
  });

  it('Claude·Codex 버블에는 서고, 로컬 엔진 버블에는 서지 않는다', () => {
    expect(isViewAllowedForProvider('configTrim', undefined)).toBe(true);
    expect(isViewAllowedForProvider('configTrim', 'codex-cli')).toBe(true);
    expect(isViewAllowedForProvider('configTrim', 'local-model')).toBe(false);
  });

  it('사이드바가 이 뷰를 제 칸으로 연다', () => {
    expect(sidebarSrc()).toContain("import { IDEConfigTrimView } from './IDEConfigTrimView.js'");
    expect(sidebarSrc()).toMatch(/configTrim:\s*IDEConfigTrimView/);
  });

  it('점등은 그 세션에 실제로 켜져 있는가로 — 활동바가 shared 판정을 그대로 쓴다', () => {
    const src = barSrc();
    expect(src).toContain('resolveConfigTrimEnabled');
    expect(src).toMatch(/subAgentId:\s*activeSessionId\s*\?\?\s*undefined/);
  });
});

describe('§5.3 #10-5 설정 덜어내기 — 뷰가 지키는 것', () => {
  it('저장은 서버 두 창구로만 간다(켬/끔 = /scope, 규칙 끄기 = /settings)', () => {
    const src = viewSrc();
    expect(src, '뷰 파일이 없다').not.toBe('');
    const apis = new Set([...src.matchAll(/'(\/api\/[^'?]+)/g)].map((m) => m[1]));
    expect([...apis].sort()).toEqual(['/api/config-trim/scope', '/api/config-trim/settings']);
  });

  it('저장된 설정을 이 칸이 고치지 않는다 — 깎는 것은 그 턴의 사본뿐이다', () => {
    const src = viewSrc();
    expect(src).not.toContain('/api/agent-config');
    expect(src).toContain("t('ide.configTrim.storedSafe')");
  });

  it('덜어낸 목록과 배제 목록은 **각각 제 판**이다', () => {
    const src = viewSrc();
    expect(src).toContain('data-config-trim-pane="trimmed"');
    expect(src).toContain('data-config-trim-pane="excluded"');
    for (const key of ['trimmedPane', 'excludedPane']) {
      for (const leaf of ['title', 'lead', 'empty']) {
        expect(src, `${key}.${leaf} 를 화면이 부르지 않는다`).toContain(`t('ide.configTrim.${key}.${leaf}')`);
      }
    }
    // 덜어낸 줄은 **덜어내기 전 값**을 같이 보인다(무엇이 사라졌는지 사용자가 확인할 수 있게).
    expect(src).toContain("t('ide.configTrim.before',");
  });

  it('스위치는 세 단을 다 그리고, 켬/끔 글리프는 절차 감지와 한 벌이다', () => {
    const src = viewSrc();
    // 세 줄은 shared 판정(`configTrimScopeStates`)을 그대로 map 한다 — 화면이 층을 다시 접지 않는다.
    expect(src).toContain('configTrimScopeStates');
    expect(src).toContain('data-config-trim-scope={s.scope}');
    for (const scope of CONFIG_TRIM_SCOPE_ORDER) {
      expect(typeof readIn(en, `ide.configTrim.scope.${scope}`), `en 에 ${scope} 이름이 없다`).toBe('string');
    }
    expect(src).toContain("import { ScopeGlyph } from './autoGoalScope.js'");
  });
});

describe('§5.3 #10-5 이름표는 표에서 나온다', () => {
  it('규칙 스물한 줄 전부 en 이름표가 있고, 화면이 끄기 목록으로 그린다', () => {
    expect(CONFIG_TRIM_RULES.length).toBeGreaterThan(0);
    for (const rule of CONFIG_TRIM_RULES) {
      expect(typeof readIn(en, `ide.configTrim.rule.${rule.id}`), `en 에 ${rule.id} 이름표가 없다`).toBe('string');
    }
    expect(viewSrc()).toContain('data-config-trim-rule');
    expect(viewSrc()).toContain('CONFIG_TRIM_RULES');
  });

  it('덜어낸 까닭·남긴 까닭도 전부 en 이름표가 있다', () => {
    for (const reason of new Set(CONFIG_TRIM_RULES.map((r) => r.reason))) {
      expect(typeof readIn(en, `ide.configTrim.reason.${reason}`), `en 에 ${reason} 이 없다`).toBe('string');
    }
    const keeps = new Set<string>([...CONFIG_TRIM_PROTECTED.map((p) => p.keep), 'unknown', 'rule-off']);
    for (const keep of keeps) {
      expect(typeof readIn(en, `ide.configTrim.keep.${keep}`), `en 에 ${keep} 이 없다`).toBe('string');
    }
  });

  it('화면이 글자 그대로 부르는 키도 en 에 다 있다', () => {
    const literal = [...viewSrc().matchAll(/t\('(ide\.configTrim\.[A-Za-z0-9_.-]+)'/g)].map((m) => m[1] ?? '');
    expect(new Set(literal).size).toBeGreaterThan(15);
    for (const key of new Set(literal)) {
      expect(typeof readIn(en, key), `en 에 ${key} 가 없다`).toBe('string');
    }
  });

  it('화면에 이모지를 쓰지 않는다(주석의 표시는 화면이 아니다)', () => {
    const code = viewSrc().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
