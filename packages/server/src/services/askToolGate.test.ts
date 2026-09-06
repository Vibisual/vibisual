/**
 * §5.3 #12-1-A — **도구별 확인 목록**의 판정 회귀.
 *
 * 이 축의 값은 전부 **순서**에 있다. 모드 단축(`bypassPermissions`·`auto`·`acceptEdits` 의 편집
 * 통과)보다 앞서야 실제로 붙잡히고, 안전한 답을 이미 낸 자리(`plan`·`dontAsk`)보다는 뒤여야
 * 없는 팝업을 만들지 않는다. 그 순서가 훅 경로와 로컬 경로에서 **같아야** 한다 — 어긋나면
 * 헤드리스에서는 물어보고 로컬 모델에서는 안 묻는 상태가 되고, 사용자에게는 "켰는데 안
 * 먹는다"로만 보인다. 그래서 두 경로가 부르는 판정을 여기서 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { shouldAskForTool, canPromptForPermission, resolveLocalToolGate } from '@vibisual/shared';

describe('shouldAskForTool — 사용자가 지목한 도구만 잡는다', () => {
  it('목록이 없거나 비면 종전과 완전히 동일(아무것도 안 잡는다)', () => {
    expect(shouldAskForTool(undefined, 'Bash')).toBe(false);
    expect(shouldAskForTool([], 'Bash')).toBe(false);
  });

  it('목록에 든 이름만 잡는다', () => {
    expect(shouldAskForTool(['Bash', 'Write'], 'Bash')).toBe(true);
    expect(shouldAskForTool(['Bash', 'Write'], 'Write')).toBe(true);
    expect(shouldAskForTool(['Bash', 'Write'], 'Read')).toBe(false);
  });

  it('대소문자를 접지 않는다 — 도구 이름은 CLI 가 정한 식별자다', () => {
    expect(shouldAskForTool(['Bash'], 'bash')).toBe(false);
    expect(shouldAskForTool(['Bash'], 'BASH')).toBe(false);
  });

  it('빈 도구 이름은 잡지 않는다(호출 본문이 망가져 도착한 경우)', () => {
    expect(shouldAskForTool(['Bash'], '')).toBe(false);
  });

  it('읽기 전용 도구도 사용자가 고르면 잡는다 — 안 고르면 종전대로 통과', () => {
    expect(shouldAskForTool(['Read'], 'Read')).toBe(true);
    expect(shouldAskForTool(['Bash'], 'Read')).toBe(false);
  });
});

describe('로컬 경로 — 모드가 통과시킨 것만 되돌려 묻는다', () => {
  /** `subAgentManager.requestTool` 이 세우는 것과 같은 식(판정이 갈라지지 않게 여기 고정). */
  const askedByTool = (mode: string, tool: string, askTools: string[]): boolean =>
    resolveLocalToolGate(mode, tool) === 'allow' && shouldAskForTool(askTools, tool);

  it('bypassPermissions 에서 지목한 도구는 붙잡힌다 — 이 항목의 존재 이유', () => {
    expect(resolveLocalToolGate('bypassPermissions', 'Write')).toBe('allow');
    expect(askedByTool('bypassPermissions', 'Write', ['Write'])).toBe(true);
  });

  it('acceptEdits 의 편집 자동 승인도 되돌린다', () => {
    expect(resolveLocalToolGate('acceptEdits', 'Write')).toBe('allow');
    expect(askedByTool('acceptEdits', 'Write', ['Write'])).toBe(true);
  });

  it('읽기 전용 통과도 되돌린다(사용자가 굳이 골랐다면 보고 싶다는 뜻)', () => {
    expect(resolveLocalToolGate('default', 'Read')).toBe('allow');
    expect(askedByTool('default', 'Read', ['Read'])).toBe(true);
  });

  it('deny 는 되돌리지 않는다 — 이미 사람 없이 안전한 답을 낸 자리', () => {
    expect(resolveLocalToolGate('plan', 'Write')).toBe('deny');
    expect(askedByTool('plan', 'Write', ['Write'])).toBe(false);
    expect(resolveLocalToolGate('dontAsk', 'Write')).toBe('deny');
    expect(askedByTool('dontAsk', 'Write', ['Write'])).toBe(false);
  });

  it('원래 묻던 호출에는 표식이 안 붙는다 — 종전 그대로다', () => {
    expect(resolveLocalToolGate('default', 'Bash')).toBe('ask');
    expect(askedByTool('default', 'Bash', ['Bash'])).toBe(false);
  });

  it('목록을 안 만든 에이전트는 어떤 모드에서도 종전과 같다', () => {
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'plan', 'dontAsk']) {
      for (const tool of ['Read', 'Write', 'Edit', 'Bash', 'WebFetch']) {
        expect(askedByTool(mode, tool, [])).toBe(false);
      }
    }
  });
});

describe('canPromptForPermission — 60초 정책 토글을 볼 수 있는가', () => {
  it('목록이 비면 종전 규칙 그대로', () => {
    expect(canPromptForPermission('default', undefined)).toBe(true);
    expect(canPromptForPermission('acceptEdits', [])).toBe(true);
    expect(canPromptForPermission('bypassPermissions', [])).toBe(false);
    expect(canPromptForPermission('auto', [])).toBe(false);
    expect(canPromptForPermission('plan', [])).toBe(false);
    expect(canPromptForPermission('dontAsk', [])).toBe(false);
  });

  it('목록이 있으면 bypass·auto 에서도 토글을 보여야 한다 — 카드가 뜨는데 정책을 못 고치면 안 된다', () => {
    expect(canPromptForPermission('bypassPermissions', ['Bash'])).toBe(true);
    expect(canPromptForPermission('auto', ['Bash'])).toBe(true);
  });

  it('plan·dontAsk 는 목록과 무관하게 그대로 숨긴다 — 서버 판정과 같은 규칙', () => {
    expect(canPromptForPermission('plan', ['Bash'])).toBe(false);
    expect(canPromptForPermission('dontAsk', ['Bash'])).toBe(false);
  });

  it('모드가 비어 도착해도 default 로 읽는다', () => {
    expect(canPromptForPermission(undefined, undefined)).toBe(true);
    expect(canPromptForPermission('', ['Bash'])).toBe(true);
  });
});
