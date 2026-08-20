import { describe, expect, it } from 'vitest';
import type { AgentConfig, LocalLlmState, LocalModelEntry } from '@vibisual/shared';

import { pickDefaultModel, resolveLocalEntry } from './localModelEntry.js';

/**
 * §5.19 (B) — 진입 순서가 뒤집힌 뒤로 "버블을 누르면 무엇이 열리는가"가 이 한 함수에 걸린다.
 * 잘못 갈리면 두 가지 사고가 난다: ① 준비 안 된 버블의 IDE 가 열려 첫 대화에서 죽거나,
 * ② 멀쩡히 쓰던 버블 앞에 설치 창이 다시 뜬다. 그래서 갈림 규칙을 여기서 못 박는다.
 */

function model(id: string, downloadedAt: number): LocalModelEntry {
  return { id, name: id, path: `/models/${id}.gguf`, sizeBytes: 1, downloadedAt };
}

function localState(installed: boolean, models: LocalModelEntry[]): LocalLlmState {
  return {
    engine: { installed, build: installed ? 'b1' : null, backends: [], serverBin: installed ? '/bin/llama-server' : null, dir: '/engine' },
    models,
    downloads: [],
    loaded: [],
  };
}

const localConfig = (modelId: string): AgentConfig =>
  ({ model: 'sonnet', tools: [], permissionMode: 'default', skills: [], provider: { kind: 'local-llama', modelId } }) as AgentConfig;

describe('§5.19 (B) All Model 진입 판정', () => {
  it('엔진이 없으면 설치 창', () => {
    expect(resolveLocalEntry(localConfig(''), localState(false, []))).toEqual({ kind: 'setup' });
    // 엔진이 없으면 모델이 남아 있어도 말을 걸 수 없다.
    expect(resolveLocalEntry(localConfig('a'), localState(false, [model('a', 1)]))).toEqual({ kind: 'setup' });
  });

  it('엔진은 있어도 받아 둔 모델이 없으면 설치 창', () => {
    expect(resolveLocalEntry(localConfig(''), localState(true, []))).toEqual({ kind: 'setup' });
  });

  it('문 모델이 실물로 있으면 곧장 IDE', () => {
    expect(resolveLocalEntry(localConfig('a'), localState(true, [model('a', 1)]))).toEqual({ kind: 'ide' });
  });

  it('아직 아무것도 안 문 버블은 가장 최근 모델을 매고 들어간다', () => {
    const decision = resolveLocalEntry(localConfig(''), localState(true, [model('old', 1), model('new', 9)]));
    expect(decision.kind).toBe('bind');
    expect(decision.kind === 'bind' && decision.model.id).toBe('new');
  });

  it('문 모델이 지워졌으면 남은 모델로 다시 맨다(설치 창으로 되돌리지 않는다)', () => {
    const decision = resolveLocalEntry(localConfig('gone'), localState(true, [model('left', 5)]));
    expect(decision.kind).toBe('bind');
    expect(decision.kind === 'bind' && decision.model.id).toBe('left');
  });

  it('provider 가 없는 버블(= 클로드)은 무조건 IDE — 설치 창이 끼어들지 않는다', () => {
    const claude = { model: 'sonnet', tools: [], permissionMode: 'default', skills: [] } as AgentConfig;
    expect(resolveLocalEntry(claude, localState(false, []))).toEqual({ kind: 'ide' });
    expect(resolveLocalEntry(undefined, null)).toEqual({ kind: 'ide' });
  });

  it('스냅샷이 아직 안 왔으면(null) 설치 창 — 없는 모델로 IDE 를 여는 것보다 안전하다', () => {
    expect(resolveLocalEntry(localConfig('a'), null)).toEqual({ kind: 'setup' });
  });

  it('pickDefaultModel 은 받은 시각이 가장 늦은 것을 고른다', () => {
    expect(pickDefaultModel([])).toBeNull();
    expect(pickDefaultModel([model('a', 3), model('b', 7), model('c', 5)])?.id).toBe('b');
  });
});
