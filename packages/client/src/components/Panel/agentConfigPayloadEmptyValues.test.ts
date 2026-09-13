/**
 * §4 (설정 3층) — 에이전트 설정 팝업이 **"이 버블은 안 쓴다"를 전선에 실어 보내는가.**
 *
 * 저장은 `sparsifyAgentConfig` 가 위층(설정 창 › Agent Defaults)과 대조해 갈라진 칸만 남기는
 * 방식이라, 창이 미설정을 `undefined` 로 담으면 `JSON.stringify` 가 그 키를 통째로 버려
 * **비교에 아예 오르지 못한다.** 저장분에 키가 없으니 읽는 순간 위층이 도로 얹히고, 사용자
 * 눈에는 "개별 설정을 바꿨는데 계속 프로젝트 설정을 따라간다"로 보인다. 설정 창이 `null` 로
 * 푼 것과 같은 문제이며(§4 "전역 옵션을 다시 끌 수 없던 것"), 아래층은 그 축의 **미설정 표기**
 * (false · '' · [] · 0)를 명시로 보내 푼다.
 *
 * ⚠ 클라 vitest 에는 DOM 이 없고 `buildPayload` 는 컴포넌트 안의 `useCallback` 이라 부를 수
 * 없다. 그래서 소스를 `?raw` 로 읽어 그 블록만 본다 — glob 이 비면 경로가 바뀐 것이므로
 * 조용히 통과시키지 않고 실패한다(검사가 사라지는 쪽이 가장 위험하다).
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

/**
 * 미설정을 `undefined` 로 접으면 안 되는 축 — **설정 창에 같은 칸이 있어 위층이 값을 가질 수
 * 있는 것들.** 위층이 없는 축(`customMode`·`memory`·`subagentDepth`)은 되돌릴 상위값 자체가
 * 없으므로 이 목록에 넣지 않는다. `effort`·`contextWindow` 는 Opus 가 아닐 때만 접히는데
 * 그때는 축 자체가 무의미해 제외한다.
 */
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
