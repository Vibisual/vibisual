/**
 * §2.1 — shared `externalFolderView.ts` 고정 시험(요약 · 예산 · 접기 · 이름).
 *
 * 판정은 shared 순수 함수지만 shared 패키지에는 러너가 없으므로 여기서 고정한다
 * (`bashWritePaths.test.ts`·`webToolEntry.test.ts` 와 같은 자리). **플랫폼·시각·홈·임시
 * 디렉터리를 전부 인자로 넘긴다** — 개발기 한 대에서 세 OS 를 다 재기 위함이고, 그것이 이 모듈이
 * `process.platform`·`Date.now()` 를 읽지 않는 이유다(멀티플랫폼 1축).
 */
import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_PROMOTION_HALF_LIFE_MS,
  EXTERNAL_TOP_BUDGET_BOUNDS,
  EXTERNAL_TOP_BUDGET_DEFAULT,
  externalPlaceHint,
  externalPlaceKeyFor,
  externalPromotionScore,
  heatValueOf,
  isVolatileSegment,
  normalizeExternalTopBudget,
  pickPromotedExternalFolders,
  volatileFoldTarget,
  volatilePlaceOf,
} from '@vibisual/shared';

const UUID = '6926b71f-4898-481d-a4f0-df5629adb392';

describe('isVolatileSegment — 매번 새로 생기는 자리만 참', () => {
  it('UUID · 긴 16진 · 긴 숫자는 휘발이다', () => {
    expect(isVolatileSegment(UUID)).toBe(true);
    expect(isVolatileSegment('0d5d8b48-ab3f-4bbc-a955-bba3df72f171')).toBe(true);
    expect(isVolatileSegment('a1b2c3d4e5f60718')).toBe(true); // 16자 hex
    expect(isVolatileSegment('1788742189706')).toBe(true); // epoch ms
  });

  it('평범한 폴더명을 휘발로 넘겨짚지 않는다 — 오탐하면 그 폴더는 영영 자기 버블을 못 갖는다', () => {
    for (const name of ['tasks', 'memory', 'scripts', 'i18n', 'v2', '2026', 'abc123', 'deadbeef', '']) {
      expect(isVolatileSegment(name)).toBe(false);
    }
  });
});

describe('volatileFoldTarget — 어디로 접을까', () => {
  it('첫 휘발 세그먼트 직전까지가 흡수해 갈 자리다', () => {
    const abs = `c:/users/dev/appdata/local/temp/claude/proj/${UUID}/tasks`;
    expect(volatileFoldTarget(abs)).toEqual({
      abs: 'c:/users/dev/appdata/local/temp/claude/proj',
      volatile: UUID,
    });
  });

  it('휘발 세그먼트가 없으면 접지 않는다', () => {
    expect(volatileFoldTarget('c:/tmp/i18n')).toBeNull();
    expect(volatileFoldTarget('/srv/profile/.claude/skills/gpt-image')).toBeNull();
  });

  it('접으면 루트만 남는 자리는 접지 않는다 — 만진 적 없는 드라이브가 최상위에 서면 안 된다', () => {
    expect(volatileFoldTarget(`c:/${UUID}/tasks`)).toBeNull();
    expect(volatileFoldTarget(`/${UUID}`)).toBeNull();
  });

  it('volatilePlaceOf 는 "세션 N곳"을 세는 키를 돌려준다', () => {
    expect(volatilePlaceOf(`/tmp/claude/proj/${UUID}/tasks/a.json`)).toBe(UUID);
    expect(volatilePlaceOf('/tmp/claude/proj/tasks/a.json')).toBeNull();
  });
});

describe('externalPlaceKeyFor — 알려진 자리를 세 OS 에서 같은 규칙으로 찾는다', () => {
  const win = { home: 'c:/users/dev', temp: 'c:/users/dev/appdata/local/temp', platform: 'win32' as const };
  const mac = { home: '/Users/dev', temp: '/var/folders/xy/T', platform: 'darwin' as const };
  const linux = { home: '/home/dev', temp: '/tmp', platform: 'linux' as const };

  it('홈 기준 자리 — 구체적인 것이 먼저 걸린다', () => {
    expect(externalPlaceKeyFor('c:/users/dev/.claude/projects/c--a--b/memory', win)).toBe('claudeMemory');
    expect(externalPlaceKeyFor('c:/users/dev/.claude/projects/c--a--b', win)).toBe('claudeProject');
    expect(externalPlaceKeyFor('c:/users/dev/.claude/projects', win)).toBe('claudeProjects');
    expect(externalPlaceKeyFor('c:/users/dev/.claude', win)).toBe('claudeHome');
    expect(externalPlaceKeyFor('c:/users/dev/.vibisual/rules', win)).toBe('vibisualRules');
    expect(externalPlaceKeyFor('c:/users/dev/.codex', win)).toBe('codexHome');
  });

  it('mac · linux 도 같은 자리를 같은 키로 부른다', () => {
    expect(externalPlaceKeyFor('/Users/dev/.claude/skills/gpt-image', mac)).toBe('claudeSkills'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(externalPlaceKeyFor('/home/dev/.claude/skills/gpt-image', linux)).toBe('claudeSkills'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(externalPlaceKeyFor('/var/folders/xy/T/claude/proj', mac)).toBe('claudeTemp');
    expect(externalPlaceKeyFor('/tmp/claude/proj', linux)).toBe('claudeTemp');
  });

  it('mac 은 대소문자를 접고 linux 는 접지 않는다 — 경로 정책 그대로', () => {
    expect(externalPlaceKeyFor('/users/dev/.claude', mac)).toBe('claudeHome'); // APFS 는 무시
    expect(externalPlaceKeyFor('/HOME/dev/.claude', linux)).toBeNull(); // ext4 는 다른 폴더
  });

  it('홈 밖의 비슷한 경로를 홈 아래로 읽지 않는다 — 경계에서 슬래시를 본다', () => {
    expect(externalPlaceKeyFor('/home/dev2/.claude', linux)).toBeNull(); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('모르는 자리는 null — 없는 이름을 지어내지 않는다', () => {
    expect(externalPlaceKeyFor('d:/도구/vm/맥', win)).toBeNull();
    expect(externalPlaceKeyFor('c:/tmp/i18n', win)).toBeNull();
  });

  it('홈·임시를 모르면 그 기준 패턴은 건너뛴다(오탐 ❌)', () => {
    expect(externalPlaceKeyFor('/home/dev/.claude', { platform: 'linux' })).toBeNull(); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });
});

describe('externalPlaceHint — 같은 이름이 여럿 생기는 자리를 가른다', () => {
  it('Claude 프로젝트 slug 는 마지막 조각이 프로젝트 이름이다', () => {
    expect(externalPlaceHint('c:/users/dev/.claude/projects/c--users-dev-work-vibisual', 'claudeProject'))
      .toBe('vibisual');
    expect(externalPlaceHint('c:/users/dev/.claude/projects/c--users-dev-side-project/memory', 'claudeMemory'))
      .toBe('project');
  });

  it('스킬·에이전트는 그 폴더 이름', () => {
    expect(externalPlaceHint('/srv/profile/.claude/skills/gpt-image/scripts', 'claudeSkills')).toBe('gpt-image');
    expect(externalPlaceHint('/srv/profile/.claude/agents/reviewer', 'claudeAgents')).toBe('reviewer');
  });

  it('하나뿐인 자리는 구분자가 필요 없다', () => {
    expect(externalPlaceHint('/srv/profile/.claude', 'claudeHome')).toBe('');
    expect(externalPlaceHint('/tmp', 'tempRoot')).toBe('');
  });
});

describe('externalPromotionScore — 접촉 × 최근성', () => {
  const now = 1_000_000_000;

  it('한 번도 안 만졌으면 0', () => {
    expect(externalPromotionScore({ activity: 0, lastActivity: now }, now)).toBe(0);
  });

  it('방금 만졌으면 접촉 횟수 그대로', () => {
    expect(externalPromotionScore({ activity: 10, lastActivity: now }, now)).toBeCloseTo(10, 6);
  });

  it('반감기가 지나면 무게가 절반', () => {
    const old = now - EXTERNAL_PROMOTION_HALF_LIFE_MS;
    expect(externalPromotionScore({ activity: 10, lastActivity: old }, now)).toBeCloseTo(5, 6);
  });

  it('히트 두 칸이 없는 구버전과 activity 가 없는 쪽 — 둘 중 큰 쪽을 본다', () => {
    // 구버전 체크포인트: readCount/writeCount 가 없다.
    expect(externalPromotionScore({ activity: 8, lastActivity: now }, now)).toBeCloseTo(8, 6);
    // 히트만 있는 경우.
    expect(externalPromotionScore({ readCount: 5, writeCount: 4, lastActivity: now }, now)).toBeCloseTo(9, 6);
  });

  it('마지막 활동을 모르면 가장 오래된 것으로 본다 — 뜨거운 폴더를 밀어내지 않는다', () => {
    expect(externalPromotionScore({ activity: 10 }, now)).toBeLessThan(0.001);
  });
});

describe('pickPromotedExternalFolders — 예산 안에서 무엇을 꺼낼까', () => {
  const now = 2_000_000_000;
  const at = (ms: number) => now - ms;

  it('점수 높은 순으로 예산만큼', () => {
    const picked = pickPromotedExternalFolders([
      { key: 'cold', activity: 1, lastActivity: at(EXTERNAL_PROMOTION_HALF_LIFE_MS * 4) },
      { key: 'hot', activity: 246, lastActivity: now },
      { key: 'warm', activity: 42, lastActivity: now },
    ], 2, now);
    expect(picked).toEqual(new Set(['hot', 'warm']));
  });

  it('핀은 예산을 소비하지 않는다 — 사용자가 고정한 것이 예산 때문에 사라지면 핀이 약속이 아니다', () => {
    const picked = pickPromotedExternalFolders([
      { key: 'pinned-cold', pinned: true, activity: 1, lastActivity: at(EXTERNAL_PROMOTION_HALF_LIFE_MS * 10) },
      { key: 'hot', activity: 100, lastActivity: now },
      { key: 'warm', activity: 50, lastActivity: now },
    ], 2, now);
    expect(picked).toEqual(new Set(['pinned-cold', 'hot', 'warm']));
  });

  it('예산 0 이어도 핀은 남는다', () => {
    const picked = pickPromotedExternalFolders([
      { key: 'pinned', pinned: true, activity: 1, lastActivity: now },
      { key: 'hot', activity: 100, lastActivity: now },
    ], 0, now);
    expect(picked).toEqual(new Set(['pinned']));
  });

  it('동률은 결정적으로 갈린다 — 같은 스냅샷을 두 번 계산해도 순서가 같다', () => {
    const candidates = [
      { key: 'b', activity: 5, lastActivity: now },
      { key: 'a', activity: 5, lastActivity: now },
      { key: 'c', activity: 5, lastActivity: now },
    ];
    const once = pickPromotedExternalFolders(candidates, 2, now);
    const twice = pickPromotedExternalFolders([...candidates].reverse(), 2, now);
    expect(once).toEqual(new Set(['a', 'b']));
    expect(twice).toEqual(once);
  });

  it('후보가 예산보다 적으면 전부', () => {
    const picked = pickPromotedExternalFolders([{ key: 'only', activity: 3, lastActivity: now }], 12, now);
    expect(picked).toEqual(new Set(['only']));
  });
});

describe('normalizeExternalTopBudget — 입력을 믿고 그대로 쓰지 않는다', () => {
  it('범위를 벗어나면 경계로 접는다', () => {
    expect(normalizeExternalTopBudget(0)).toBe(EXTERNAL_TOP_BUDGET_BOUNDS.MIN);
    expect(normalizeExternalTopBudget(-5)).toBe(EXTERNAL_TOP_BUDGET_BOUNDS.MIN);
    expect(normalizeExternalTopBudget(999)).toBe(EXTERNAL_TOP_BUDGET_BOUNDS.MAX);
  });

  it('숫자가 아니면 기본값', () => {
    expect(normalizeExternalTopBudget(undefined)).toBe(EXTERNAL_TOP_BUDGET_DEFAULT);
    expect(normalizeExternalTopBudget('없음')).toBe(EXTERNAL_TOP_BUDGET_DEFAULT);
    expect(normalizeExternalTopBudget(NaN)).toBe(EXTERNAL_TOP_BUDGET_DEFAULT);
  });

  it('소수는 내림 · 숫자 문자열은 받는다', () => {
    expect(normalizeExternalTopBudget(12.9)).toBe(12);
    expect(normalizeExternalTopBudget('8')).toBe(8);
  });
});

describe('heatValueOf — 접합도 색이 산다', () => {
  it('접합은 자기 히트가 0 이라 자손 합을 본다(없으면 영원히 회색이었다)', () => {
    expect(heatValueOf({ readCount: 0, externalRollupReadCount: 46 }, 'read')).toBe(46);
  });

  it('만진 폴더·파일은 종전 동작과 같다', () => {
    expect(heatValueOf({ readCount: 24 }, 'read')).toBe(24);
    expect(heatValueOf({}, 'read')).toBe(0);
  });
});
