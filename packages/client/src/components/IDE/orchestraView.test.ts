/**
 * §5.3 #10-4 · §5.5 #16-1 (H) — **오케스트라 뷰**가 지켜야 하는 것들.
 *
 * 사용자 지시(2026-09-19): 활동바에서 프로젝트·에이전트 2단으로 켜고 끄고, 절감 방안은 지난 분석을
 * **그대로** 싣고, 명령을 넣으면 전부 자동 적용이 아니라 **지휘자가 스스로 맞는 것을 골라** 하게.
 *
 * 여기서 잠그는 것:
 *   ① 활동바 자리 — 절차 감지 **바로 뒤**, 로컬 엔진 버블에는 서지 않는다(가로채기가 로컬을 건너뛴다).
 *   ② 저장 창구 둘만 쓴다 — 화면이 다른 길로 설정을 쓰면 서버 검증(`invalid-field`)을 비껴간다.
 *   ③ 원문은 shared 상수에서만 — 화면에 원문을 베껴 두면 두 벌이 되고, 한쪽만 고쳐져 "그대로"가 깨진다.
 *   ④ 수치 절감을 약속하지 않는다 — 화면 문구(en·ko)에 퍼센트 숫자 ❌. 원문의 추정은 이름표를 달고서만.
 *   ⑤ 화면이 부르는 i18n 키가 en·ko 에 다 있다 — 없으면 키 문자열이 그대로 뜬다.
 *   ⑥ 켬/끔 글리프는 절차 감지와 한 벌 — 같은 3값 순환이 두 그림이면 서로 다른 스위치로 읽힌다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다.
 */
import { describe, it, expect } from 'vitest';
import {
  ORCHESTRA_ANALYSIS_INSIGHTS,
  ORCHESTRA_BEST_PRACTICES,
  ORCHESTRA_CONDUCTOR_PERMISSIONS,
  ORCHESTRA_IMMEDIATE_VALUES,
  ORCHESTRA_INTENTS,
  ORCHESTRA_MEMBER_ENGINES,
  ORCHESTRA_RUN_PHASES,
  ORCHESTRA_SCOPE_ORDER,
  ORCHESTRA_STRATEGIES,
  ORCHESTRA_TOPOLOGIES,
} from '@vibisual/shared';
import { DEFAULT_ACTIVITY_ORDER, activityItem } from './ideActivityItems.js';
import { isViewAllowedForProvider } from './ideProviderViews.js';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';

const tsx = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const viewSrc = (): string => tsx['./IDEOrchestraView.tsx'] ?? '';
const sidebarSrc = (): string => tsx['./IDESidebar.tsx'] ?? '';
const iconSrc = (): string => tsx['./ideActivityIcons.tsx'] ?? '';

const readIn = (root: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    root,
  );

/** `ide.orchestra` 아래 모든 잎 문자열 — `[키, 값]`. */
function leaves(node: unknown, prefix: string): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`));
}

/** 화면이 부르는 키 전부 — 글자 그대로 쓴 것 + 템플릿으로 조립하는 것(목록은 shared 에서 끌어온다). */
function keysUsedByView(): string[] {
  const src = viewSrc();
  const literal = [...src.matchAll(/t\('(ide\.orchestra\.[A-Za-z0-9_.-]+)'/g)].map((m) => m[1] ?? '');
  const built = [
    ...ORCHESTRA_SCOPE_ORDER.map((s) => `ide.orchestra.scope.${s}`),
    ...ORCHESTRA_STRATEGIES.map((s) => `ide.orchestra.strategy.${s.id}`),
    ...ORCHESTRA_RUN_PHASES.map((p) => `ide.orchestra.phase.${p}`),
    ...ORCHESTRA_INTENTS.map((i) => `ide.orchestra.intent.${i}`),
    ...ORCHESTRA_TOPOLOGIES.map((x) => `ide.orchestra.topology.${x}`),
    ...ORCHESTRA_CONDUCTOR_PERMISSIONS.flatMap((p) => [`ide.orchestra.permission.${p}`, `ide.orchestra.permission.${p}Hint`]),
    ...ORCHESTRA_MEMBER_ENGINES.map((e) => `ide.orchestra.member.engine.${e}`),
  ];
  return [...new Set([...literal, ...built])].filter((k) => k !== '');
}

describe('§5.3 #10-4 오케스트라 — 활동바 자리', () => {
  it('활동바 표에 서고, 자리는 절차 감지 **바로 뒤**다', () => {
    const order = [...DEFAULT_ACTIVITY_ORDER];
    const auto = order.indexOf('autoGoal');
    expect(auto, '절차 감지 칸이 있어야 한다').toBeGreaterThan(-1);
    expect(order.indexOf('orchestra'), '오케스트라 칸이 절차 감지 바로 뒤에 없다').toBe(auto + 1);
    expect(activityItem('orchestra')?.labelKey).toBe('ide.activityBar.orchestra');
    expect(typeof readIn(en, 'ide.activityBar.orchestra')).toBe('string');
    expect(typeof readIn(ko, 'ide.activityBar.orchestra')).toBe('string');
    expect(iconSrc()).toContain("case 'orchestra':");
  });

  it('Claude·Codex 버블에는 서고, 로컬 엔진 버블에는 서지 않는다 — 서버가 로컬을 가로채지 않는다', () => {
    expect(isViewAllowedForProvider('orchestra', undefined)).toBe(true);
    expect(isViewAllowedForProvider('orchestra', 'codex-cli')).toBe(true);
    expect(isViewAllowedForProvider('orchestra', 'local-model')).toBe(false);
  });

  it('사이드바가 이 뷰를 제 칸으로 연다', () => {
    expect(sidebarSrc()).toContain("import { IDEOrchestraView } from './IDEOrchestraView.js'");
    expect(sidebarSrc()).toMatch(/orchestra:\s*IDEOrchestraView/);
  });
});

describe('§5.3 #10-4 오케스트라 — 뷰가 지키는 것', () => {
  it('저장은 서버 두 창구로만 간다(켬/끔 = /scope, 세부 설정 = /settings)', () => {
    const src = viewSrc();
    expect(src, '뷰 파일이 없다').not.toBe('');
    const apis = new Set([...src.matchAll(/'(\/api\/[^'?]+)/g)].map((m) => m[1]));
    expect([...apis].sort()).toEqual(['/api/orchestra/scope', '/api/orchestra/settings']);
    // 전량 교체 PUT 을 쓰지 않는다 — 켬/끔 칸은 /scope 한 길이라 패치 타입에서 빠져 있어야 한다.
    expect(src).toMatch(/Exclude<keyof OrchestraSettings, 'enabledProject' \| 'enabledAgents' \| 'updatedAt'>/);
  });

  it('원문은 shared 상수에서만 온다 — 화면 소스에 원문 문장을 베껴 두지 않는다', () => {
    const src = viewSrc();
    for (const s of ORCHESTRA_STRATEGIES) {
      expect(src, `#${s.no} 요소 원문이 뷰에 베껴져 있다`).not.toContain(s.element);
      expect(src, `#${s.no} 방법 원문이 뷰에 베껴져 있다`).not.toContain(s.methods);
    }
    for (const line of [...ORCHESTRA_ANALYSIS_INSIGHTS, ...ORCHESTRA_IMMEDIATE_VALUES]) {
      expect(src).not.toContain(line);
    }
    for (const b of ORCHESTRA_BEST_PRACTICES) expect(src).not.toContain(b.advice);
    // 표·통찰·우수 사례·바로 바꿀 값·출처를 전부 싣는다 — 하나라도 빠지면 "그대로"가 아니다.
    for (const name of [
      'ORCHESTRA_STRATEGIES', 'ORCHESTRA_ANALYSIS_TABLE_TITLE', 'ORCHESTRA_ANALYSIS_TABLE_HEADER', 'ORCHESTRA_ANALYSIS_SUM',
      'ORCHESTRA_ANALYSIS_INSIGHTS', 'ORCHESTRA_BEST_PRACTICES', 'ORCHESTRA_BEST_PRACTICES_HEADER',
      'ORCHESTRA_IMMEDIATE_VALUES', 'ORCHESTRA_SOURCES',
    ]) {
      expect(src, `${name} 를 화면이 싣지 않는다`).toMatch(new RegExp(`\\b${name}\\b[^,]*[.)\\]}]`));
    }
  });

  it('원문의 예상 절감은 "원문의 추정" 이름표 곁에서만 그린다', () => {
    const src = viewSrc();
    const uses = [...src.matchAll(/strategy\.saving/g)].length;
    expect(uses).toBeGreaterThan(0);
    // 접힌 줄에서 절감을 보일 때는 반드시 이름표가 같은 줄에 선다.
    expect(src).toMatch(/t\('ide\.orchestra\.strategies\.estimate'\)\}\s*<RichText text=\{strategy\.saving\}/);
  });

  it('화면 문구(en·ko)는 절감 퍼센트를 약속하지 않는다', () => {
    for (const [name, root] of [['en', en], ['ko', ko]] as const) {
      for (const [key, value] of leaves(readIn(root, 'ide.orchestra'), 'ide.orchestra')) {
        expect(value, `${name} ${key} 에 숫자 퍼센트가 있다`).not.toMatch(/\d\s*%/);
      }
    }
  });

  it('화면이 부르는 i18n 키가 en·ko 에 전부 있다', () => {
    const keys = keysUsedByView();
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(typeof readIn(en, key), `en 에 ${key} 가 없다`).toBe('string');
      expect(typeof readIn(ko, key), `ko 에 ${key} 가 없다`).toBe('string');
    }
  });

  it('켬/끔 글리프는 절차 감지 스위치와 한 벌이다', () => {
    const src = viewSrc();
    expect(src).toContain("import { ScopeGlyph } from './autoGoalScope.js'");
    // 가로줄·체크·X 를 여기서 다시 그리지 않는다.
    expect(src).not.toContain('M5 12h14');
    expect(src).not.toContain('M18 6 6 18');
  });

  it('로컬 엔진·손으로 만들지 않은 버블·Auto Agent 버블·터미널 모드에서 도는 척하지 않는다', () => {
    const src = viewSrc();
    for (const key of ['localEngine', 'notCustom', 'autoBubble', 'terminal']) {
      expect(src).toContain(`t('ide.orchestra.blocked.${key}')`);
    }
    // Auto Agent 요약은 클라가 버블 경로로, 서버가 세션 id 로 건다 — 둘 다 본다.
    expect(src).toMatch(/autoAgentSummaries\[a\.path\]\s*\?\?\s*s\.autoAgentSummaries\[agentId\]/);
  });

  it('화면에 이모지를 쓰지 않는다(주석의 표시는 화면이 아니다)', () => {
    const code = viewSrc().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
