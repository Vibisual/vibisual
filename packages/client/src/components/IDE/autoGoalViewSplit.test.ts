/**
 * §5.10 (P) — **목표와 절차 감지는 칸이 둘이다.**
 *
 * 사용자 지시(2026-09-12): "이 목표와 자동 목표 뷰를 서로 나눴으면 좋겠어 그리고 이름도 절차
 * 감지로 변경." 그 전까지 절차 감지는 `목표` 뷰 **아래 블록**(`IDEAutoGoalSection`)이었고, 코드
 * 주석·SSOT 는 "칸을 나누지 마라"고 적혀 있었다. 지시로 그 결정이 뒤집혔으므로 여기서 잠그는
 * 것은 **되돌아감**이다 — 블록을 목표 뷰에 도로 얹으면 스위치가 두 자리에 생기고, 그때부터
 * "켰는데 왜 안 도는지"를 찾을 길이 없어진다(#17-44 ⑧(d) 가 정독에서 겪은 그 구멍).
 *
 * 함께 잠그는 것이 이름이다. 화면 표기는 「절차 감지」이지만 **식별자는 `autoGoal` 그대로**여야
 * 한다 — REST(`/api/auto-goal/*`)·저장고(`.vibisual/skills`)·집행 축이 그 이름에 물려 있어서,
 * 새 이름을 코드로 퍼뜨리면 이미 쌓인 절차가 경로를 잃는다(§5.10 (H) 가 `brain`→「메모리」에서
 * 세운 규율 그대로).
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다.
 */
import { describe, it, expect } from 'vitest';
import { IDE_ACTIVITY_ITEMS, DEFAULT_ACTIVITY_ORDER, activityItem } from './ideActivityItems.js';
import { migrateIDEViewType } from '../../stores/graphStore.js';
import { isViewAllowedForProvider } from './ideProviderViews.js';
import en from '../../i18n/locales/en.json';

const tsx = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sidebarSrc = (): string => tsx['./IDESidebar.tsx'] ?? '';
const viewSrc = (): string => tsx['./IDEAutoGoalView.tsx'] ?? '';
const iconSrc = (): string => tsx['./ideActivityIcons.tsx'] ?? '';

const read = (dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    en as unknown,
  );

describe('§5.10 (P) 절차 감지는 제 칸을 갖는다', () => {
  it('활동바 표에 서고, 자리는 목표 **바로 뒤**다', () => {
    const order = [...DEFAULT_ACTIVITY_ORDER];
    const goal = order.indexOf('goal');
    const auto = order.indexOf('autoGoal');
    expect(goal, '목표 칸이 있어야 한다').toBeGreaterThan(-1);
    expect(auto, '절차 감지 칸이 표에 없다 — 표 밖 칸은 순서·구성에서 영영 사라진다').toBe(goal + 1);
  });

  it('저장·복원이 조용히 되돌리지 않는다 — 옛 `brain` 은 이 칸으로 내려앉는다', () => {
    expect(migrateIDEViewType('autoGoal')).toBe('autoGoal');
    // 기억 정리 칸이 하던 일 중 살아남은 것(되풀이 → 스킬)이 여기 있으므로 도착지도 여기다.
    expect(migrateIDEViewType('brain')).toBe('autoGoal');
  });

  it('그림·이름을 갖는다 — 이름은 i18n 키로, 그림은 활동바·구성 패널 공용 글리프로', () => {
    const item = activityItem('autoGoal');
    expect(item?.labelKey).toBe('ide.activityBar.autoGoal');
    // 하드코딩 ❌ — 키가 en.json 에 없으면 화면에 키 문자열이 그대로 뜬다.
    expect(typeof read('ide.activityBar.autoGoal')).toBe('string');
    expect(iconSrc()).toContain("case 'autoGoal':");
  });

  it('어느 엔진의 버블에서도 선다 — 되풀이 관찰도 절차 파일도 우리가 쌓는 것이다', () => {
    for (const kind of [undefined, 'codex-cli', 'local-model']) {
      expect(isViewAllowedForProvider('autoGoal', kind), String(kind)).toBe(true);
    }
  });

  it('뷰 라우터가 그 칸의 화면을 갖는다 — 입구만 있고 화면이 없으면 빈 사이드바가 된다', () => {
    expect(sidebarSrc()).toContain('autoGoal: IDEAutoGoalView');
  });
});

describe('§5.10 (P) 목표 뷰로 되돌아가지 않는다', () => {
  it('목표 뷰가 절차 감지 블록을 다시 얹지 않는다', () => {
    const src = sidebarSrc();
    // 옛 블록(`IDEAutoGoalSection`)은 파일째 사라졌다 — 이름이 되살아나면 그 자리로 돌아간 것이다.
    expect(src).not.toContain('IDEAutoGoalSection');
    expect(tsx['./IDEAutoGoalSection.tsx'], '옛 블록 파일이 되살아났다').toBeUndefined();
  });

  it('3층 스위치를 그리는 화면은 하나뿐이다 — 두 자리에서 켜지면 결론을 못 맞춘다', () => {
    const drawers = Object.entries(tsx)
      .filter(([path]) => path !== './autoGoalScope.tsx')
      .filter(([, src]) => src.includes('<AutoGoalScopeRows'))
      .map(([path]) => path);
    expect(drawers).toEqual(['./IDEAutoGoalView.tsx']);
  });

  it('세션을 안 골랐어도 화면이 선다 — 프로젝트·에이전트 층은 세션 없이 켤 수 있다', () => {
    const src = viewSrc();
    // 조기 반환으로 화면을 접으면 켜는 자리 자체가 사라진다(#17-44 ⑧(c) 가 정독에서 고친 구멍).
    expect(src).not.toMatch(/if \(!activeSessionId\) return/);
    expect(src).toContain('<AutoGoalScopeRows');
  });
});

describe('§5.10 (P) 이름은 화면에서만 바뀐다', () => {
  it('식별자는 `autoGoal` 그대로다 — 새 이름을 코드로 퍼뜨리지 않는다', () => {
    expect(IDE_ACTIVITY_ITEMS.some((i) => i.view === 'autoGoal')).toBe(true);
    // 'procedureDetection' 같은 새 식별자가 생기면 REST·저장고·집행 축과 이름이 갈린다.
    for (const [path, src] of Object.entries(tsx)) {
      expect(src.includes('procedureDetection'), `${path} 에 새 식별자가 생겼다`).toBe(false);
    }
  });

  it('화면 문자열은 활동바·뷰 머리글이 같은 축을 쓴다', () => {
    // 뷰 머리글은 `ide.autoGoal.title`, 활동바 칸은 `ide.activityBar.autoGoal` — 둘 다 en.json 에 있어야 한다.
    expect(typeof read('ide.autoGoal.title')).toBe('string');
    expect(viewSrc()).toContain("t('ide.autoGoal.title')");
  });
});
