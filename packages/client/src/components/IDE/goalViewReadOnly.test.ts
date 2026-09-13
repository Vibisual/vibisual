/**
 * §5.5 #17-17 ⑬ — **사이드바 목표 뷰는 읽는 창이다**를 소스 규약으로 못 박는다.
 *
 * ① 은 처음부터 "목표는 사용자가 적는 칸이 아니라 세션이 스스로 쓰는 것"이라고 못 박았는데,
 * 같은 절의 ④·⑧(c) 가 "클릭해 수정 · 단계 추가 입력 · 항목 삭제"를 화면 규격으로 적어 둔 탓에
 * 208px 사이드바에 쓰기 입구가 다섯이나 서 있었다. ⑫ 가 조작 창구를 무대로 옮긴 뒤로 그 다섯은
 * **두 번째 창구**가 됐다 — 같은 일을 두 곳에서 하면 어느 쪽이 진짜인지 알 수 없다.
 *
 * 되돌아가기 쉬운 부류다(입력칸 하나를 다시 다는 것은 5줄이다). 화면 시험이 없는 자리라
 * 소스 스캔이 유일한 방어다 — 클라 테스트에는 DOM 이 없으므로 렌더가 아니라 **소스 글자**를 본다.
 */

import { describe, expect, it } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const locales = import.meta.glob('../../i18n/locales/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const sidebar = (): string => {
  const src = tsx['./IDESidebar.tsx'];
  if (src === undefined) throw new Error('IDESidebar.tsx 를 못 찾음');
  return src;
};

/** 목표 뷰 구역만 잘라 본다 — 사이드바에는 다른 뷰(스킬 등)의 입력칸이 함께 산다. */
function goalSection(): string {
  const src = sidebar();
  const at = src.indexOf('const GOAL_SAMPLE_STEPS');
  const end = src.indexOf('// ─── 뷰 라우터 ───');
  expect(at, '목표 뷰 구역의 머리(GOAL_SAMPLE_STEPS)를 못 찾음').toBeGreaterThan(-1);
  expect(end, '뷰 라우터 경계를 못 찾음').toBeGreaterThan(at);
  return src.slice(at, end);
}

/** 12 로케일의 `ide.goal` 묶음. 파일 이름이 곧 로케일이다. */
function goalBundles(): [string, Record<string, unknown>][] {
  return Object.entries(locales).map(([path, json]) => {
    const locale = (path.split('/').pop() ?? '').replace(/\.json$/u, '');
    const ide = (json as { ide?: { goal?: Record<string, unknown> } }).ide;
    expect(ide?.goal, `${locale} 에 ide.goal 이 없다`).toBeTruthy();
    return [locale, ide?.goal ?? {}];
  });
}

describe('⑬(a) 목표 뷰에는 쓰기 입구가 없다', () => {
  const section = goalSection();

  it('글을 받는 칸이 하나도 없다 — 문장도 단계도 여기서 만들지 않는다', () => {
    expect(section).not.toContain('<textarea');
    expect(section).not.toContain('<input');
  });

  it('쓰기 상태가 남아 있지 않다 — 폼이 사라졌으면 그 상태도 사라져야 한다', () => {
    for (const gone of ['setEditing', 'newStep', 'setDraft', 'addStep', 'removeStep', 'toggleStep']) {
      expect(section, `${gone} 이 남아 있다`).not.toContain(gone);
    }
  });

  it('진행 갱신 문(`/progress`)을 화면이 부르지 않는다 — 체크·삭제를 걷었으므로', () => {
    expect(section).not.toContain('setSessionGoalProgress');
  });

  it('단계는 무대·지도와 같은 조각으로 그린 표식이다 — 누를 수 있어 보이지 않는다(⑪(n)④)', () => {
    expect(section).toContain('<StepMark');
    expect(sidebar()).toContain("from './StageGlyph.js'");
  });

  it('⑬(b) 목표를 **끝내는** 손잡이는 남는다 — 닫는 것은 사용자의 몫이다(⑩)', () => {
    expect(section).toContain("t('ide.goal.achieve')");
    expect(section).toContain("t('ide.goal.resume')");
    expect(section).toContain("t('ide.goal.delete')");
    // 그 셋은 있던 문장을 그대로 되보낸다 — 새 문장을 만드는 곳은 이제 없다.
    expect(section).toContain('text: goal.text');
  });
});

describe('⑬(c) [뷰 보기]는 상시다', () => {
  const section = goalSection();

  it('머리글이 갈림보다 **앞**이다 — 목표가 없어도 무대로 갈 손잡이가 남는다', () => {
    const button = section.indexOf("t('ide.goal.openStage')");
    const branch = section.indexOf('{!goal ? (');
    expect(button, '[뷰 보기]를 못 찾음').toBeGreaterThan(-1);
    expect(branch, '목표 유무 갈림을 못 찾음').toBeGreaterThan(-1);
    expect(button).toBeLessThan(branch);
  });

  it('목표 뷰가 조기 반환으로 갈리지 않는다 — 갈리면 그 갈래에는 머리글이 없다', () => {
    const view = section.slice(section.indexOf('function GoalView'));
    expect(view).not.toMatch(/if \([^)]*\)\s*\{?\s*\n?\s*return \(/u);
  });

  it('퍼센트는 목표가 있을 때만 그린다 — 없는 진행을 0% 라고 말하지 않는다(⑩)', () => {
    expect(section).toContain('{goal && (');
  });
});

describe('⑬(d) 목표가 없으면 예시 창이 선다', () => {
  const section = goalSection();

  it('실제 카드와 같은 뼈대를 그린다 — 문장 · 진행 막대 · 단계 셋', () => {
    expect(section).toContain("t('ide.goal.sample.badge')");
    expect(section).toContain("t('ide.goal.sample.text')");
    expect(section).toContain('GOAL_SAMPLE_STEPS');
    const marks = [...section.matchAll(/status: '(done|in_progress|pending)'/gu)].map((m) => m[1]);
    expect(marks).toEqual(['done', 'in_progress', 'pending']);
  });

  it('읽는 기계에는 들리지 않는다 — 없는 목표를 있는 것처럼 읽지 않게', () => {
    const sample = section.slice(section.indexOf('function GoalSample'), section.indexOf('function GoalView'));
    expect(sample).toContain('aria-hidden');
  });

  it('세션을 아직 고르지 않았을 때도 같은 예시가 선다(안내 문구만 다르다)', () => {
    expect(section).toContain("t(activeSessionId ? 'ide.goal.waiting' : 'ide.goal.pickSession')");
  });
});

describe('⑬(e) 걷어낸 문자열은 12 로케일 어디에도 남지 않는다', () => {
  /** 쓰기 입구가 있던 시절의 키. 남아 있으면 다음 사람이 그 화면이 아직 있다고 믿는다. */
  const GONE = [
    'setManually', 'textPlaceholder', 'textHint', 'create', 'update', 'cancel',
    'editHint', 'toggleStep', 'removeStep', 'addStepPlaceholder',
  ];

  it('로케일 파일이 지원 언어 수만큼 잡힌다 — 못 읽으면 아래 검사가 조용히 통과한다', () => {
    expect(goalBundles().length).toBe(SUPPORTED_UI_LOCALES.length);
  });

  for (const [locale, goal] of goalBundles()) {
    it(`${locale} — 걷어낸 키가 없고 예시 문자열이 다 있다`, () => {
      const left = GONE.filter((k) => k in goal);
      expect(left, `${locale} 에 남은 키: ${left.join(', ')}`).toEqual([]);
      const sample = goal.sample as Record<string, string> | undefined;
      expect(sample, `${locale} 에 예시 문자열이 없다`).toBeTruthy();
      for (const k of ['badge', 'text', 'stepDone', 'stepRunning', 'stepPending']) {
        expect(typeof sample?.[k], `${locale}.sample.${k}`).toBe('string');
      }
    });
  }

  it('걷어낸 키를 부르는 코드도 남지 않았다 — 없는 문자열을 부르면 화면에 키가 그대로 뜬다', () => {
    const all = Object.values(tsx).join('\n');
    for (const k of GONE) expect(all, `ide.goal.${k} 를 아직 부른다`).not.toContain(`ide.goal.${k}`);
  });
});
