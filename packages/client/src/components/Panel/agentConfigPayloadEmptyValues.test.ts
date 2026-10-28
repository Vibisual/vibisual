/**
 * §4 (설정 3층) — 설정 팝업이 미설정을 `undefined` 가 아닌 명시 표기로 싣는가(`JSON.stringify` 가 키를 버리면 위층이 도로 얹힌다).
 * DOM 이 없어 소스를 `?raw` 로 읽어 `buildPayload` 블록만 본다 — glob 이 비면 실패한다(검사가 사라지지 않게).
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob('./AgentConfigPopup.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `buildPayload` 가 짓는 객체 리터럴만 잘라 온다. */
function payloadBlock(): string {
  const entries = Object.values(SOURCES);
  expect(entries.length).toBe(1);
  const source = entries[0]!;
  const start = source.indexOf('const buildPayload = useCallback((): AgentConfig => ({');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n  }), [', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** 위층이 값을 가질 수 있는 축만(`customMode`·`memory`·`subagentDepth` 는 위층이 없어 제외). `effort`·`contextWindow` 는 접힐 때 축이 무의미해 제외. */
const MUST_NOT_FOLD = [
  'agentCanCompact',
  'excludeDynamicSystemPromptSections',
  'safeMode',
  'fastMode',
  'thinking',
  'forwardSubagentText',
  'replayUserMessages',
  'promptSuggestions',
  'includeHookEvents',
  'settingSources',
  'fallbackModel',
  'autoCompact',
  'rules',
  'disallowedTools',
  'askTools',
  'betas',
  'pluginDirs',
  'agentDefinitions',
  'maxTurns',
  'maxBudgetUsd',
  'isolation',
  'permissionTimeoutPolicy',
  'modelVersion',
  'bashDefaultTimeoutMs',
  'bashMaxTimeoutMs',
];

describe('§4 설정 3층 — 설정 팝업은 미설정을 undefined 로 접지 않는다', () => {
  it('위층이 값을 가질 수 있는 축은 전부 payload 에 실린다', () => {
    const block = payloadBlock();
    const missing = MUST_NOT_FOLD.filter(
      (f) => !new RegExp(`^\\s*${f}[,:]`, 'm').test(block),
    );
    expect(missing).toEqual([]);
  });

  it('그 축들 중 어느 것도 undefined 로 떨어지지 않는다', () => {
    const block = payloadBlock();
    const folded = MUST_NOT_FOLD.filter((f) => {
      const line = new RegExp(`^\\s*${f}:.*$`, 'm').exec(block);
      // shorthand(`agentCanCompact,`)면 값이 그대로 실린 것이라 통과.
      return line !== null && line[0].includes('undefined');
    });
    expect(folded).toEqual([]);
  });
});
