import { describe, expect, it } from 'vitest';
import { permissionFooterButtons } from './permissionChoices.js';
import en from '../i18n/locales/en.json';

// §5.3 #12-1-B — 권한 카드 발 줄. 서버가 실은 "항상" 범위만 버튼이 되고, 순서는
// [이번만 거절][항상 거절] · [항상 허용 / 이 세션에선 허용][이번만 허용].

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (
    node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  ), en);
}

describe('permissionFooterButtons', () => {
  it('"항상"이 하나도 없으면 종전 두 버튼(거부 · 허용) 그대로다 — 계획 승인에 "이번만"을 붙이지 않는다', () => {
    const buttons = permissionFooterButtons({});
    expect(buttons.map((b) => b.choice)).toEqual(['reject_once', 'allow_once']);
    expect(buttons.map((b) => b.labelKey)).toEqual(['panel.permissionPrompt.deny', 'panel.permissionPrompt.allow']);
    expect(buttons.every((b) => !b.always && b.titleKey === undefined)).toBe(true);
  });

  it('둘 다 있으면 넷, 거절 둘이 왼쪽 · 허용 둘이 오른쪽', () => {
    const buttons = permissionFooterButtons({ alwaysAllow: 'session', alwaysReject: 'disallowed-tools' });
    expect(buttons.map((b) => b.choice)).toEqual(['reject_once', 'reject_always', 'allow_always', 'allow_once']);
    expect(buttons.map((b) => b.tone)).toEqual(['deny', 'deny', 'allow', 'allow']);
    expect(buttons.map((b) => b.always)).toEqual([false, true, true, false]);
    expect(buttons[0]?.labelKey).toBe('panel.permissionPrompt.rejectOnce');
    expect(buttons[3]?.labelKey).toBe('panel.permissionPrompt.allowOnce');
  });

  it('한쪽 "항상"만 있으면 짝 없는 쪽 한 번짜리 버튼은 종전 글자다', () => {
    const buttons = permissionFooterButtons({ alwaysReject: 'disallowed-tools' });
    expect(buttons.map((b) => b.choice)).toEqual(['reject_once', 'reject_always', 'allow_once']);
    expect(buttons[0]?.labelKey).toBe('panel.permissionPrompt.rejectOnce');
    expect(buttons[2]?.labelKey).toBe('panel.permissionPrompt.allow');
  });

  it('세션 기억은 "이 세션에선 허용", 확인 목록·코덱스는 "항상 허용" — 제목이 적히는 곳을 말한다', () => {
    const session = permissionFooterButtons({ alwaysAllow: 'session' }).find((b) => b.choice === 'allow_always');
    const askTools = permissionFooterButtons({ alwaysAllow: 'ask-tools' }).find((b) => b.choice === 'allow_always');
    const codex = permissionFooterButtons({ alwaysAllow: 'codex-tools', alwaysReject: 'codex-tools' });
    expect(session?.labelKey).toBe('panel.permissionPrompt.allowSession');
    expect(session?.titleKey).toBe('panel.permissionPrompt.allowSessionTitle');
    expect(askTools?.labelKey).toBe('panel.permissionPrompt.allowAlways');
    expect(askTools?.titleKey).toBe('panel.permissionPrompt.allowAlwaysAskToolsTitle');
    expect(codex.find((b) => b.choice === 'allow_always')?.titleKey).toBe('panel.permissionPrompt.allowAlwaysCodexTitle');
    expect(codex.find((b) => b.choice === 'reject_always')?.titleKey).toBe('panel.permissionPrompt.rejectAlwaysCodexTitle');
  });

  it('모든 글자·제목 키가 en 에 있고 영어 기본값과 같다(기본값과 로케일이 따로 놀지 않게)', () => {
    const combos = [
      permissionFooterButtons({}),
      permissionFooterButtons({ alwaysAllow: 'session', alwaysReject: 'disallowed-tools' }),
      permissionFooterButtons({ alwaysAllow: 'ask-tools', alwaysReject: 'disallowed-tools' }),
      permissionFooterButtons({ alwaysAllow: 'codex-tools', alwaysReject: 'codex-tools' }),
    ].flat();
    for (const b of combos) {
      expect(lookup(b.labelKey)).toBe(b.defaultLabel);
      if (b.titleKey) expect(lookup(b.titleKey)).toBe(b.defaultTitle);
    }
  });
});
