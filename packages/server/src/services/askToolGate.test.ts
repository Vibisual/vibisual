/**
 * §5.3 #12-1-A — **도구별 확인 목록**의 판정 회귀.
 *
 * 이 축의 값은 전부 **순서**에 있다. 모드 단축(`bypassPermissions`·`auto`·`acceptEdits` 의 편집
 * 통과)보다 앞서야 실제로 붙잡히고, 안전한 답을 이미 낸 자리(`plan`·`dontAsk`)보다는 뒤여야
 * 없는 팝업을 만들지 않는다. 그 순서가 훅 경로와 로컬 경로에서 **같아야** 한다 — 어긋나면
 * 헤드리스에서는 물어보고 로컬 모델에서는 안 묻는 상태가 되고, 사용자에게는 "켰는데 안
 * 먹는다"로만 보인다. 그래서 두 경로가 부르는 판정을 여기서 함께 고정한다.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { shouldAskForTool, canPromptForPermission, resolveLocalToolGate, applyIngressPermissionGuard } from '@vibisual/shared';
import type { AgentPermissionAxes } from '@vibisual/shared';

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

/**
 * §5.3 #12-1 — **권한 축은 사용자만 올린다.**
 *
 * `PUT /api/agent-config/:id` 는 §3.7 빌더 구축 경로라 loopback 토큰만 있으면 닿고, 그 토큰은
 * 우리가 스폰한 에이전트의 env·프롬프트에 실려 나간다. 그 에이전트가 읽는 것은 프로젝트
 * 파일·웹 문서라, 거기 심긴 한 줄이 그대로 이 창구의 입력이 된다 — 감시받는 쪽이 감시 장치를
 * 끌 수 있으면 그건 게이트가 아니다. 아래가 그 경계를 고정한다.
 */
describe('applyIngressPermissionGuard — 감시받는 쪽은 게이트를 못 연다', () => {
  const axes = (over: Partial<AgentPermissionAxes> = {}): AgentPermissionAxes => ({
    permissionMode: 'default',
    tools: ['Read'],
    disallowedTools: undefined,
    askTools: undefined,
    ...over,
  });

  it('사용자 창구(렌더러·모바일)는 종전 그대로 — bypass 도 그대로 저장된다', () => {
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'bypassPermissions', tools: ['Bash'], askTools: ['Bash'] }),
      axes(),
      false,
    );
    expect(got.permissionMode).toBe('bypassPermissions');
    expect(got.tools).toEqual(['Bash']);
    expect(got.askTools).toEqual(['Bash']);
    expect(got.frozen).toEqual([]);
    expect(got.downgraded).toBe(false);
  });

  it('loopback 첫 구성은 통과한다 — 빌더가 방금 만든 빈 버블을 설정하는 정상 흐름', () => {
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'acceptEdits', tools: ['Read', 'Write'] }),
      undefined,
      true,
    );
    expect(got.permissionMode).toBe('acceptEdits');
    expect(got.tools).toEqual(['Read', 'Write']);
    expect(got.frozen).toEqual([]);
  });

  it('loopback 은 첫 구성에서도 bypassPermissions 를 못 켠다 — acceptEdits 로 낮춰 저장', () => {
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'bypassPermissions' }),
      undefined,
      true,
    );
    expect(got.permissionMode).toBe('acceptEdits');
    expect(got.downgraded).toBe(true);
  });

  it('이미 정해진 권한 축은 loopback 이 못 바꾼다 — 자기 자신을 무장 해제하는 경로', () => {
    const prev = axes({ permissionMode: 'default', tools: ['Read'], askTools: ['Bash'] });
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'bypassPermissions', tools: ['Bash', 'Write'], askTools: [] }),
      prev,
      true,
    );
    expect(got.permissionMode).toBe('default');
    expect(got.tools).toEqual(['Read']);
    expect(got.askTools).toEqual(['Bash']);
    expect(got.frozen).toEqual(['permissionMode', 'tools', 'askTools']);
  });

  it('되돌린 칸만 frozen 에 남는다 — 안 바뀐 칸까지 신고하면 로그가 거짓말이 된다', () => {
    const prev = axes({ permissionMode: 'acceptEdits', tools: ['Read'] });
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'acceptEdits', tools: ['Read'], disallowedTools: ['Bash'] }),
      prev,
      true,
    );
    expect(got.frozen).toEqual(['disallowedTools']);
    expect(got.disallowedTools).toBeUndefined();
  });

  it('loopback 이 권한 축을 안 건드리면 아무것도 막지 않는다 — 나머지 칸 저장을 깨지 않는다', () => {
    const prev = axes({ permissionMode: 'acceptEdits', tools: ['Read', 'Write'], askTools: ['Bash'] });
    const got = applyIngressPermissionGuard(
      axes({ permissionMode: 'acceptEdits', tools: ['Read', 'Write'], askTools: ['Bash'] }),
      prev,
      true,
    );
    expect(got.frozen).toEqual([]);
    expect(got.downgraded).toBe(false);
  });

  it('모르는 모드는 저장하지 않는다 — 플래그가 통째로 빠지면 CLI 기본(auto)로 강도가 낮아진다', () => {
    // 유입과 무관하게 막는다: 사용자 창구로 들어온 오타도 이전 값을 지킨다.
    const prev = axes({ permissionMode: 'default' });
    expect(applyIngressPermissionGuard(axes({ permissionMode: 'BYPASS' }), prev, false).permissionMode).toBe('default');
    expect(applyIngressPermissionGuard(axes({ permissionMode: '' }), prev, false).permissionMode).toBe('default');
    // 설정이 아예 없던 자리는 'default' 로 떨어진다.
    expect(applyIngressPermissionGuard(axes({ permissionMode: 'nope' }), undefined, false).permissionMode).toBe('default');
  });

  it('되돌린 목록은 이전 값의 복사본이다 — 호출부가 만져도 저장분이 흔들리지 않는다', () => {
    const prev = axes({ tools: ['Read'], askTools: ['Bash'] });
    const got = applyIngressPermissionGuard(axes({ tools: ['Bash'] }), prev, true);
    got.tools.push('Write');
    got.askTools?.push('Write');
    expect(prev.tools).toEqual(['Read']);
    expect(prev.askTools).toEqual(['Bash']);
  });
});

/**
 * §5.3 #12-1-A — **저장 창구가 `askTools` 를 실어 보내는가.**
 *
 * `PUT /api/agent-config/:id` 는 body 로 `AgentConfig` 한 벌을 새로 짓고 `setAgentConfig` 는
 * 저장분을 병합 없이 통째로 갈아치운다. 그래서 재구축 객체에서 이 칸이 빠지면 설정창이 목록을
 * 제대로 보내도 매 저장마다 조용히 비워지고, 위의 판정들은 전부 초록인 채로 기능만 죽는다
 * (실제로 그렇게 죽어 있었다). 판정 테스트가 못 잡는 자리라 배선을 따로 고정한다.
 */
describe('agent-config 저장 배선 — askTools 가 재구축 객체에 실려 있다', () => {
  it('PUT 핸들러가 askTools 를 저장한다', () => {
    const src = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const start = src.indexOf("app.put('/api/agent-config/:agentId'");
    expect(start).toBeGreaterThan(-1);
    // 다음 라우트 선언까지가 이 핸들러의 몸통이다.
    const end = src.indexOf('app.post(', start);
    const handler = src.slice(start, end > start ? end : undefined);
    expect(handler).toMatch(/^\s*askTools:/m);
  });
});
