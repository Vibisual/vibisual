import { describe, expect, it } from 'vitest';
import { buildCodexReviewArgs, effectiveReviewTarget } from './codexReviewService.js';

/**
 * §5.25 (N) — `codex review` 인자 조립.
 *
 * 못 박는 것 셋: ① **위험 플래그가 새지 않는다**(`--dangerously-*` 금지 — 안전선),
 * ② **값이 필요한 대상에 빈 값이 실리지 않는다**(빈 브랜치 이름은 엉뚱한 것을 보게 한다),
 * ③ **권한 표는 스폰 경로와 같은 한 벌**을 쓴다(두 벌이면 한쪽만 고쳐진다).
 */

describe('buildCodexReviewArgs', () => {
  const BASE = { cwd: 'C:/work/proj' } as const;

  it('언제나 review 하위명령 + 작업 폴더로 시작한다', () => {
    const args = buildCodexReviewArgs({ ...BASE, mode: 'uncommitted' });
    expect(args[0]).toBe('review');
    expect(args).toContain('-C');
    expect(args[args.indexOf('-C') + 1]).toBe('C:/work/proj');
  });

  it('세 대상을 각각 그 플래그로 옮긴다', () => {
    expect(buildCodexReviewArgs({ ...BASE, mode: 'uncommitted' })).toContain('--uncommitted');

    const base = buildCodexReviewArgs({ ...BASE, mode: 'base', target: 'main' });
    expect(base[base.indexOf('--base') + 1]).toBe('main');
    expect(base).not.toContain('--uncommitted');

    const commit = buildCodexReviewArgs({ ...BASE, mode: 'commit', target: 'abc1234' });
    expect(commit[commit.indexOf('--commit') + 1]).toBe('abc1234');
    expect(commit).not.toContain('--uncommitted');
  });

  it('값이 필요한데 비었으면 **미커밋 변경으로 떨어진다**(빈 값을 넘기지 않는다)', () => {
    for (const target of [undefined, '', '   ']) {
      const args = buildCodexReviewArgs({ ...BASE, mode: 'base', ...(target === undefined ? {} : { target }) });
      expect(args).toContain('--uncommitted');
      expect(args).not.toContain('--base');
    }
  });

  it('위험 플래그는 어떤 조합에서도 실리지 않는다', () => {
    for (const permissionMode of [undefined, 'default', 'plan', 'acceptEdits', 'bypassPermissions', '이상한값']) {
      const args = buildCodexReviewArgs({
        ...BASE, mode: 'uncommitted', ...(permissionMode ? { permissionMode } : {}),
      });
      expect(args.join(' ')).not.toContain('dangerously');
      // 승인 정책은 루트 전용 플래그가 아니라 설정 오버라이드로 실린다(`exec` 와 같은 규약).
      expect(args).not.toContain('--ask-for-approval');
      expect(args).toContain('-s');
      expect(args.some((a) => a.startsWith('approval_policy='))).toBe(true);
    }
  });

  it('권한 모드가 샌드박스 값으로 이어진다(스폰 경로와 같은 표)', () => {
    const sandboxOf = (permissionMode?: string): string => {
      const args = buildCodexReviewArgs({ ...BASE, mode: 'uncommitted', ...(permissionMode ? { permissionMode } : {}) });
      return args[args.indexOf('-s') + 1] ?? '';
    };
    // 미설정은 앱 전체 규약대로 `default` 로 읽힌다(작업 폴더 쓰기).
    expect(sandboxOf(undefined)).toBe(sandboxOf('default'));
    // 계획 모드는 읽기 전용이어야 한다 — 리뷰가 파일을 고치면 그건 리뷰가 아니다.
    expect(sandboxOf('plan')).toBe('read-only');
  });
});

describe('effectiveReviewTarget', () => {
  it('화면이 "무엇을 봤는지"를 정직하게 적을 수 있게 떨어진 뒤의 값을 준다', () => {
    expect(effectiveReviewTarget('base', 'main')).toEqual({ mode: 'base', target: 'main' });
    expect(effectiveReviewTarget('commit', ' abc ')).toEqual({ mode: 'commit', target: 'abc' });
    // 값이 없으면 실제로 도는 것은 미커밋 변경이므로 기록도 그렇게 남는다.
    expect(effectiveReviewTarget('base', '')).toEqual({ mode: 'uncommitted' });
    expect(effectiveReviewTarget('commit', undefined)).toEqual({ mode: 'uncommitted' });
    expect(effectiveReviewTarget('uncommitted', 'ignored')).toEqual({ mode: 'uncommitted' });
  });
});
