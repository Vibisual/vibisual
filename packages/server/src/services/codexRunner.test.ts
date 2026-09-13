/**
 * §5.25 (F)(H) — 코덱스 스폰 인자 조립 · 파일 쓰기 추출 고정 시험.
 *
 * 인자 조립이 틀리면 **모든 코덱스 턴이 같은 방식으로** 죽는데, 그 사고는 실제로 돌려보기 전에는
 * 보이지 않는다. 실제로 우리는 이미 두 번 그 자리에 빠졌다:
 *   ① `exec -a never` → `exec` 에는 `--ask-for-approval` 이 없다(루트 명령 전용).
 *   ② `-m` 을 안 주면 사용자 `config.toml` 의 기본 모델에 끌려가 400 이 난다.
 * 두 사고를 시험으로 못박는다.
 */
import { describe, it, expect } from 'vitest';
import { buildCodexExecArgs, extractFileWrites } from './codexRunner.js';
import { normalizeAgentProvider } from '@vibisual/shared';

describe('Codex execution settings', () => {
  it('preserves overrides through normalization and sends them on new and resumed turns', () => {
    const provider = normalizeAgentProvider({ kind: 'codex-cli', modelId: 'test-model', webSearch: 'live', modelVerbosity: 'low', networkAccess: false })!;
    expect(provider.networkAccess).toBe(false);
    for (const resumeThreadId of [undefined, 'thread-existing']) {
      const args = buildCodexExecArgs({ ...provider, model: provider.modelId, cwd: '/work', resumeThreadId });
      expect(args).toContain('web_search=live');
      expect(args).toContain('model_verbosity=low');
      expect(args).toContain('sandbox_workspace_write.network_access=false');
    }
  });

  it('inherits unset options and rejects invalid persisted values', () => {
    const provider = normalizeAgentProvider({ kind: 'codex-cli', modelId: 'test', webSearch: 'invalid', modelVerbosity: 'invalid', networkAccess: 'true' })!;
    expect(provider).toEqual({ kind: 'codex-cli', modelId: 'test' });
    const args = buildCodexExecArgs({ ...provider, model: provider.modelId, cwd: '/work' });
    expect(args.some((arg) => /^(web_search|model_verbosity|sandbox_workspace_write.network_access)=/.test(arg))).toBe(false);
  });

  it('does not apply workspace network policy to other sandboxes', () => {
    for (const permissionMode of ['plan', 'bypassPermissions']) {
      const args = buildCodexExecArgs({ cwd: '/work', model: 'test', permissionMode, networkAccess: true });
      expect(args).not.toContain('sandbox_workspace_write.network_access=true');
    }
  });
});

const base = { cwd: '/work/proj', model: 'gpt-5.1-codex' };

/** 인자 배열에서 `flag` 바로 뒤 값. 없으면 undefined. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** `-c key=value` 오버라이드에서 key 의 값. */
function overrideOf(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && args[i + 1]?.startsWith(`${key}=`)) return args[i + 1]?.slice(key.length + 1);
  }
  return undefined;
}

describe('buildCodexExecArgs — 언제나 들어가는 것', () => {
  it('exec 로 시작하고 JSONL 을 켠다', () => {
    const args = buildCodexExecArgs(base);
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
  });

  it('git 저장소가 아닌 폴더에서도 돌게 한다', () => {
    // 이게 없으면 코덱스가 실행을 거절해, 저장소 밖 폴더를 연 사용자는 아무 답도 못 받는다.
    expect(buildCodexExecArgs(base)).toContain('--skip-git-repo-check');
  });

  it('작업 폴더와 모델을 **항상 명시**한다', () => {
    const args = buildCodexExecArgs(base);
    expect(valueAfter(args, '-C')).toBe('/work/proj');
    // 모델을 생략하면 사용자 config.toml 의 기본 모델로 떨어져 400 이 난다(2026-09-07 실측).
    expect(valueAfter(args, '-m')).toBe('gpt-5.1-codex');
  });

  it('`exec` 에 없는 `-a` 를 쓰지 않는다 — 승인 정책은 설정 오버라이드로 싣는다', () => {
    const args = buildCodexExecArgs(base);
    expect(args).not.toContain('-a');
    expect(args).not.toContain('--ask-for-approval');
    expect(overrideOf(args, 'approval_policy')).toBeTruthy();
  });

  it('사용자 설정 파일을 건드리는 인자를 쓰지 않는다', () => {
    const args = buildCodexExecArgs(base);
    // 우회 플래그는 어떤 경로로도 쓰지 않는다(§5.25 경계).
    expect(args.some((a) => a.includes('dangerously'))).toBe(false);
  });
});

describe('buildCodexExecArgs — 권한 모드가 두 축으로 옮겨진다(§5.25 (H))', () => {
  const sandboxOf = (mode?: string): string | undefined =>
    valueAfter(buildCodexExecArgs({ ...base, ...(mode ? { permissionMode: mode } : {}) }), '-s');
  const approvalOf = (mode?: string): string | undefined =>
    overrideOf(buildCodexExecArgs({ ...base, ...(mode ? { permissionMode: mode } : {}) }), 'approval_policy');

  it('기본·편집허용은 작업폴더 쓰기 + 요청 시 승인', () => {
    expect(sandboxOf('default')).toBe('workspace-write');
    expect(approvalOf('default')).toBe('on-request');
    expect(sandboxOf('acceptEdits')).toBe('workspace-write');
  });

  it('자동 진행은 쓰기는 되되 승인은 묻지 않는다', () => {
    expect(sandboxOf('auto')).toBe('workspace-write');
    expect(approvalOf('auto')).toBe('never');
  });

  it('계획·묻지않기는 읽기 전용으로 내린다 — 계획 모드가 파일을 고치면 안 된다', () => {
    expect(sandboxOf('plan')).toBe('read-only');
    expect(approvalOf('plan')).toBe('never');
    expect(sandboxOf('dontAsk')).toBe('read-only');
  });

  it('권한 우회 모드만 전면 허용으로 간다', () => {
    expect(sandboxOf('bypassPermissions')).toBe('danger-full-access');
    expect(approvalOf('bypassPermissions')).toBe('never');
  });

  it('설정이 없으면 기본 모드와 같다 — 코덱스만 조용히 읽기 전용이 되지 않는다', () => {
    // 앱 전체가 `permissionMode || 'default'` 로 읽는다. 여기서만 읽기 전용으로 떨어뜨리면
    //   설정을 만진 적 없는 사용자는 파일이 안 고쳐지는 이유를 화면에서 볼 수 없다.
    expect(sandboxOf(undefined)).toBe('workspace-write');
    expect(approvalOf(undefined)).toBe('on-request');
  });

  it('모르는 값은 **가장 좁은 쪽**으로 떨어진다 — 넓은 권한으로 넘겨짚지 않는다', () => {
    // 나중에 추가될 모드가 조용히 전면 허용이 되는 사고를 막는다.
    expect(sandboxOf('made-up-mode')).toBe('read-only');
    expect(approvalOf('made-up-mode')).toBe('on-request');
  });
});

describe('buildCodexExecArgs — 선택 인자', () => {
  it('이어가기에서도 exec 전용 cwd/sandbox 옵션은 resume 앞에 온다', () => {
    const args = buildCodexExecArgs({ ...base, resumeThreadId: 'thr_123' });
    const resumeAt = args.indexOf('resume');
    expect(args.slice(resumeAt, resumeAt + 2)).toEqual(['resume', 'thr_123']);
    // 현재 CLI는 `exec resume <id> -C ... -s ...`를 파싱 단계에서 거부한다.
    expect(args.indexOf('-C')).toBeLessThan(resumeAt);
    expect(args.indexOf('-s')).toBeLessThan(resumeAt);
  });

  it('이어갈 스레드가 없으면 resume 을 넣지 않는다', () => {
    expect(buildCodexExecArgs(base)).not.toContain('resume');
  });

  it('추론 강도는 있을 때만 실린다', () => {
    expect(overrideOf(buildCodexExecArgs(base), 'model_reasoning_effort')).toBeUndefined();
    expect(overrideOf(buildCodexExecArgs({ ...base, reasoningEffort: 'high' }), 'model_reasoning_effort')).toBe('high');
  });

  it('첨부 이미지는 첫 턴과 이어가기 모두 Codex vision 입력으로 넘긴다', () => {
    const images = ['/work/a.png', '/work/with space/b.jpg'];
    for (const resumeThreadId of [undefined, 'thr_123']) {
      const args = buildCodexExecArgs({
        ...base,
        images,
        ...(resumeThreadId ? { resumeThreadId } : {}),
      });
      expect(args.filter((arg) => arg === '-i')).toHaveLength(2);
      expect(args).toContain(images[0]);
      expect(args).toContain(images[1]);
    }
  });
});

describe('extractFileWrites — 캔버스 파일 버블은 사후에만 흘린다', () => {
  it('완료된 file_change 의 경로를 뽑는다', () => {
    const line =
      '{"type":"item.completed","item":{"id":"f1","type":"file_change","changes":[{"path":"src/a.ts"},{"path":"src/b.ts"}]}}';
    expect(extractFileWrites(line)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('시작 줄은 세지 않는다 — 아직 고쳐지지 않은 파일에 쓰기 화살표를 세우면 거짓이다', () => {
    const line =
      '{"type":"item.started","item":{"id":"f1","type":"file_change","changes":[{"path":"src/a.ts"}]}}';
    expect(extractFileWrites(line)).toEqual([]);
  });

  it('명령 실행은 파일 쓰기가 아니다', () => {
    const line = '{"type":"item.completed","item":{"id":"c1","type":"command_execution","exit_code":0}}';
    expect(extractFileWrites(line)).toEqual([]);
  });

  it('JSON 이 아니거나 모양이 다르면 빈 배열', () => {
    expect(extractFileWrites('')).toEqual([]);
    expect(extractFileWrites('codex banner line')).toEqual([]);
    expect(extractFileWrites('{ broken')).toEqual([]);
    expect(extractFileWrites('{"type":"item.completed"}')).toEqual([]);
  });
});
