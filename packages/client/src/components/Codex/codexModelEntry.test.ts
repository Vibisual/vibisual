/**
 * §5.25 (B)(G)(J) — 코덱스 버블 판정 고정 시험.
 *
 * `localModelEntry.test.ts` 와 같은 자리다. 특히 두 규칙을 못박는다:
 *  - 클로드 버블(프로바이더 없음)이 이 판정에 끌려 들어가지 않는다.
 *  - `auth.error`(모름)로는 로그인 창을 세우지 않는다 — 멀쩡히 일하던 사용자를 막지 않기 위함.
 */
import { describe, it, expect } from 'vitest';
import type { AgentConfig, CodexAuthStatus, CodexEffectiveConfig, CodexModelEntry, CodexSetupState } from '@vibisual/shared';
import {
  resolveCodexEntry,
  codexProviderOf,
  codexModelLabelOf,
  codexReasoningLevelsOf,
  pickDefaultCodexModel,
  isDefaultCodexLabel,
  resolveCodexInherited,
} from './codexModelEntry.js';

const MODELS: CodexModelEntry[] = [
  { slug: 'gpt-5.1-codex', displayName: 'GPT-5.1 Codex', reasoningLevels: ['low', 'medium', 'high'] },
  { slug: 'gpt-5.1', displayName: 'GPT-5.1', reasoningLevels: [] },
];

const READY: CodexSetupState = {
  phase: 'ready',
  canAutoInstall: true,
  installCommand: 'npm install -g @openai/codex',
  docsUrl: 'https://example.invalid',
  checkedAt: 1,
};
const MISSING: CodexSetupState = { ...READY, phase: 'missing' };
const IN: CodexAuthStatus = { loggedIn: true, checkedAt: 1 };
const OUT: CodexAuthStatus = { loggedIn: false, checkedAt: 1 };
const UNKNOWN: CodexAuthStatus = { loggedIn: false, error: 'cli-missing', checkedAt: 1 };

const codexCfg = (modelId: string): AgentConfig =>
  ({ provider: { kind: 'codex-cli', modelId } }) as unknown as AgentConfig;

describe('resolveCodexEntry — 클로드 버블을 끌어들이지 않는다', () => {
  it('프로바이더가 없으면 언제나 IDE 다', () => {
    expect(resolveCodexEntry(undefined, { setup: MISSING, auth: OUT, models: [] })).toEqual({ kind: 'ide' });
    expect(resolveCodexEntry({} as AgentConfig, { setup: MISSING, auth: OUT, models: [] })).toEqual({ kind: 'ide' });
  });

  it('로컬 프로바이더도 이 판정을 타지 않는다', () => {
    const local = { provider: { kind: 'local-llama', modelId: 'x' } } as unknown as AgentConfig;
    expect(resolveCodexEntry(local, { setup: MISSING, auth: OUT, models: [] })).toEqual({ kind: 'ide' });
  });
});

describe('resolveCodexEntry — 계단 순서(설치 → 로그인 → 모델)', () => {
  it('CLI 가 없으면 설치가 먼저다', () => {
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: MISSING, auth: IN, models: MODELS })).toEqual({
      kind: 'setup',
    });
  });

  it('CLI 는 있는데 로그아웃이면 로그인 창', () => {
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: READY, auth: OUT, models: MODELS })).toEqual({
      kind: 'login',
    });
  });

  it('판정 불가(error)는 로그아웃이 아니다 — 창을 세우지 않는다', () => {
    // 이 한 줄이 이 파일의 요점이다. "모름"으로 모달을 세우면 일하던 사용자가 막힌다.
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: READY, auth: UNKNOWN, models: MODELS })).toEqual({
      kind: 'ide',
    });
  });

  it('아직 서버 판정이 안 왔으면(null) 가로막지 않는다', () => {
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: null, auth: null, models: MODELS })).toEqual({
      kind: 'ide',
    });
  });
});

describe('resolveCodexEntry — 모델 물리기', () => {
  it('문 모델이 목록에 있으면 그대로 간다', () => {
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: READY, auth: IN, models: MODELS })).toEqual({
      kind: 'ide',
    });
  });

  it('아직 아무것도 안 물었으면 목록 첫 항목을 매어 준다', () => {
    expect(resolveCodexEntry(codexCfg(''), { setup: READY, auth: IN, models: MODELS })).toEqual({
      kind: 'bind',
      model: MODELS[0],
    });
  });

  it('문 모델이 목록에서 사라졌으면 다시 매어 준다', () => {
    expect(resolveCodexEntry(codexCfg('gone-model'), { setup: READY, auth: IN, models: MODELS })).toEqual({
      kind: 'bind',
      model: MODELS[0],
    });
  });

  it('목록을 아직 못 읽었어도 문 모델이 있으면 막지 않는다', () => {
    // 캐시는 코덱스를 한 번 돌려야 생긴다. 목록이 비었다고 이미 쓰던 버블을 설치 창으로 보내면
    //   멀쩡한 대화가 끊긴다.
    expect(resolveCodexEntry(codexCfg('gpt-5.1-codex'), { setup: READY, auth: IN, models: [] })).toEqual({
      kind: 'ide',
    });
  });

  it('목록도 없고 문 모델도 없으면 준비 창으로 보낸다', () => {
    expect(resolveCodexEntry(codexCfg(''), { setup: READY, auth: IN, models: [] })).toEqual({ kind: 'setup' });
  });
});

describe('pickDefaultCodexModel — 발행처가 준 순서를 우리가 다시 세우지 않는다', () => {
  it('첫 항목을 고른다', () => {
    expect(pickDefaultCodexModel(MODELS)?.slug).toBe('gpt-5.1-codex');
  });

  it('빈 목록이면 null', () => {
    expect(pickDefaultCodexModel([])).toBeNull();
  });
});

describe('정체 표시 — 버블과 패널이 같은 답을 말한다', () => {
  it('코덱스 프로바이더만 골라낸다', () => {
    expect(codexProviderOf(codexCfg('m'))?.kind).toBe('codex-cli');
    expect(codexProviderOf({ provider: { kind: 'local-llama', modelId: 'm' } } as unknown as AgentConfig)).toBeNull();
    expect(codexProviderOf(undefined)).toBeNull();
    expect(codexProviderOf(null)).toBeNull();
  });

  it('라벨은 이름 → slug → 제품명 순으로 떨어진다', () => {
    expect(codexModelLabelOf({ kind: 'codex-cli', modelId: 'gpt-5.1', modelName: 'GPT-5.1' }, 'Codex')).toBe('GPT-5.1');
    expect(codexModelLabelOf({ kind: 'codex-cli', modelId: 'gpt-5.1' }, 'Codex')).toBe('gpt-5.1');
    expect(codexModelLabelOf({ kind: 'codex-cli', modelId: '' }, 'Codex')).toBe('Codex');
  });

  it('코덱스가 아니면 null — 부르는 쪽이 종전 표기를 그대로 쓴다', () => {
    expect(codexModelLabelOf(null, 'Codex')).toBeNull();
  });
});

describe('codexReasoningLevelsOf — 고를 수 없는 값을 보이지 않는다', () => {
  it('신고한 단계를 그대로 준다', () => {
    expect(codexReasoningLevelsOf('gpt-5.1-codex', MODELS)).toEqual(['low', 'medium', 'high']);
  });

  it('단계를 신고하지 않은 모델은 빈 배열이다', () => {
    expect(codexReasoningLevelsOf('gpt-5.1', MODELS)).toEqual([]);
  });

  it('모르는 모델·목록 없음·모델 없음도 빈 배열이다', () => {
    expect(codexReasoningLevelsOf('made-up', MODELS)).toEqual([]);
    expect(codexReasoningLevelsOf('gpt-5.1-codex', undefined)).toEqual([]);
    expect(codexReasoningLevelsOf(undefined, MODELS)).toEqual([]);
  });
});

describe('isDefaultCodexLabel — 사용자가 바꾼 이름은 건드리지 않는다', () => {
  it('기본 모양만 참이다', () => {
    expect(isDefaultCodexLabel('Codex 1')).toBe(true);
    expect(isDefaultCodexLabel('  Codex 12  ')).toBe(true);
  });

  it('사용자가 지은 이름은 거짓이다', () => {
    expect(isDefaultCodexLabel('리팩터링 담당')).toBe(false);
    expect(isDefaultCodexLabel('Codex')).toBe(false);
    expect(isDefaultCodexLabel('Codex 리뷰어')).toBe(false);
    expect(isDefaultCodexLabel(undefined)).toBe(false);
  });
});

describe('resolveCodexInherited — 비워 둔 칸에 실제로 적용되는 값', () => {
  const MODEL: CodexModelEntry = {
    slug: 'gpt-5.1-codex',
    displayName: 'GPT-5.1 Codex',
    reasoningLevels: ['low', 'medium', 'high'],
    defaultReasoningLevel: 'medium',
    supportsVerbosity: true,
    defaultVerbosity: 'low',
  };
  const config = (layers: CodexEffectiveConfig['layers']): CodexEffectiveConfig => ({ cwd: '/w', layers, checkedAt: 1 });
  const base = { model: MODEL, modelsLoaded: true, sandbox: 'workspace-write' };

  it('앞 겹이 이긴다 — 값이 없는 겹은 건너뛴다', () => {
    const cfg = config([
      { source: 'profile', path: '/h/config.toml', profile: 'deep', values: {} },
      { source: 'project', path: '/w/.codex/config.toml', values: { reasoningEffort: 'high' } },
      { source: 'user', path: '/h/config.toml', values: { reasoningEffort: 'xhigh', webSearch: 'live' } },
    ]);
    expect(resolveCodexInherited('reasoningEffort', { ...base, config: cfg })).toEqual({
      kind: 'layer',
      value: 'high',
      source: 'project',
      path: '/w/.codex/config.toml',
    });
    expect(resolveCodexInherited('webSearch', { ...base, config: cfg })).toMatchObject({ kind: 'layer', value: 'live', source: 'user' });
  });

  it('프로필 이름과 불리언 값을 그대로 넘긴다', () => {
    const cfg = config([{ source: 'profile', path: '/h/config.toml', profile: 'deep', values: { networkAccess: true } }]);
    expect(resolveCodexInherited('networkAccess', { ...base, config: cfg })).toEqual({
      kind: 'layer',
      value: 'true',
      source: 'profile',
      path: '/h/config.toml',
      profile: 'deep',
    });
  });

  it('파일에 없으면 모델이 신고한 값', () => {
    const cfg = config([]);
    expect(resolveCodexInherited('reasoningEffort', { ...base, config: cfg })).toEqual({ kind: 'model', value: 'medium' });
    expect(resolveCodexInherited('modelVerbosity', { ...base, config: cfg })).toEqual({ kind: 'model', value: 'low' });
  });

  it('말투를 받지 않는 모델은 파일 값이 있어도 적용되지 않는다', () => {
    const cfg = config([{ source: 'user', path: '/h/config.toml', values: { modelVerbosity: 'high' } }]);
    const model = { ...MODEL, supportsVerbosity: false };
    expect(resolveCodexInherited('modelVerbosity', { ...base, model, config: cfg })).toEqual({ kind: 'unsupported' });
  });

  it('내장 값은 문서에 적힌 것만 — 웹 검색은 샌드박스를 따른다', () => {
    const cfg = config([]);
    expect(resolveCodexInherited('webSearch', { ...base, config: cfg })).toEqual({ kind: 'builtin', value: 'cached' });
    expect(resolveCodexInherited('webSearch', { ...base, sandbox: 'danger-full-access', config: cfg })).toEqual({
      kind: 'builtin',
      value: 'live',
    });
    expect(resolveCodexInherited('networkAccess', { ...base, config: cfg })).toEqual({ kind: 'builtin', value: 'false' });
  });

  it('근거가 없으면 지어내지 않는다 — 읽는 중과 모름을 가른다', () => {
    const bare: CodexModelEntry = { slug: 'x', displayName: 'X', reasoningLevels: [] };
    expect(resolveCodexInherited('reasoningEffort', { ...base, config: null })).toEqual({ kind: 'loading' });
    expect(resolveCodexInherited('reasoningEffort', { ...base, model: undefined, modelsLoaded: false, config: config([]) })).toEqual({
      kind: 'loading',
    });
    expect(resolveCodexInherited('reasoningEffort', { ...base, model: bare, config: config([]) })).toEqual({ kind: 'unresolved' });
    expect(resolveCodexInherited('modelVerbosity', { ...base, model: bare, config: config([]) })).toEqual({ kind: 'unresolved' });
  });
});

describe('resolveCodexInherited — 도구 위임 연결', () => {
  it('위임 연결이 있으면 파일 값보다 앞서 웹 검색이 꺼진다', () => {
    const cfg: CodexEffectiveConfig = {
      cwd: '/w',
      layers: [{ source: 'user', path: '/h/config.toml', values: { webSearch: 'live' } }],
      checkedAt: 1,
    };
    const input = { config: cfg, model: undefined, modelsLoaded: true, sandbox: 'workspace-write', delegation: true };
    expect(resolveCodexInherited('webSearch', input)).toEqual({ kind: 'delegation', value: 'disabled' });
    expect(resolveCodexInherited('reasoningEffort', { ...input, config: { ...cfg, layers: [{ ...cfg.layers[0]!, values: { reasoningEffort: 'low' } }] } }))
      .toMatchObject({ kind: 'layer', value: 'low' });
  });
});
