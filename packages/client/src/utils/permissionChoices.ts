import type { PermissionChoice, PermissionRequest } from '@vibisual/shared';

/**
 * §5.3 #12-1-B — 권한 카드 발 줄의 버튼 한 개.
 * 글자·제목은 키와 영어 기본값을 함께 싣는다 — 카드가 `t(key, { defaultValue })` 로 그린다.
 */
export interface PermissionFooterButton {
  choice: PermissionChoice;
  labelKey: string;
  defaultLabel: string;
  /** "항상" 버튼에만 — 어디에 적히는지 한 문장. */
  titleKey?: string;
  defaultTitle?: string;
  tone: 'allow' | 'deny';
  always: boolean;
}

/**
 * §5.3 #12-1-B — 서버가 카드에 실은 "항상" 범위로 발 줄을 짓는다.
 *
 * 순서는 [이번만 거절][항상 거절] · [항상 허용][이번만 허용]. 제공되지 않은 "항상"은 없고,
 * 짝 "항상"이 없는 쪽의 한 번짜리 버튼은 종전 글자(허용 · 거절)다 — 계획 승인에 "이번만"이 붙으면
 * 다음 번이 있는 것처럼 읽힌다.
 */
export function permissionFooterButtons(
  request: Pick<PermissionRequest, 'alwaysAllow' | 'alwaysReject'>,
): PermissionFooterButton[] {
  const buttons: PermissionFooterButton[] = [];
  const { alwaysAllow, alwaysReject } = request;

  buttons.push(alwaysReject
    ? { choice: 'reject_once', labelKey: 'panel.permissionPrompt.rejectOnce', defaultLabel: 'Deny once', tone: 'deny', always: false }
    : { choice: 'reject_once', labelKey: 'panel.permissionPrompt.deny', defaultLabel: 'Deny', tone: 'deny', always: false });

  if (alwaysReject === 'disallowed-tools') {
    buttons.push({
      choice: 'reject_always',
      labelKey: 'panel.permissionPrompt.rejectAlways',
      defaultLabel: 'Always deny',
      titleKey: 'panel.permissionPrompt.rejectAlwaysDisallowedTitle',
      defaultTitle: 'Adds {{tool}} to this agent’s disallowed tools — it will be blocked without asking.',
      tone: 'deny',
      always: true,
    });
  } else if (alwaysReject === 'codex-tools') {
    buttons.push({
      choice: 'reject_always',
      labelKey: 'panel.permissionPrompt.rejectAlways',
      defaultLabel: 'Always deny',
      titleKey: 'panel.permissionPrompt.rejectAlwaysCodexTitle',
      defaultTitle: 'Sets the {{group}} tool group to Deny in this agent’s Codex tool settings.',
      tone: 'deny',
      always: true,
    });
  }

  if (alwaysAllow === 'session') {
    buttons.push({
      choice: 'allow_always',
      labelKey: 'panel.permissionPrompt.allowSession',
      defaultLabel: 'Allow for this session',
      titleKey: 'panel.permissionPrompt.allowSessionTitle',
      defaultTitle: 'Won’t ask about {{tool}} again in this session. Forgotten when the app restarts — change the permission mode to allow it for good.',
      tone: 'allow',
      always: true,
    });
  } else if (alwaysAllow === 'ask-tools') {
    buttons.push({
      choice: 'allow_always',
      labelKey: 'panel.permissionPrompt.allowAlways',
      defaultLabel: 'Always allow',
      titleKey: 'panel.permissionPrompt.allowAlwaysAskToolsTitle',
      defaultTitle: 'Removes {{tool}} from this agent’s “ask before use” list.',
      tone: 'allow',
      always: true,
    });
  } else if (alwaysAllow === 'codex-tools') {
    buttons.push({
      choice: 'allow_always',
      labelKey: 'panel.permissionPrompt.allowAlways',
      defaultLabel: 'Always allow',
      titleKey: 'panel.permissionPrompt.allowAlwaysCodexTitle',
      defaultTitle: 'Sets the {{group}} tool group to Allow in this agent’s Codex tool settings.',
      tone: 'allow',
      always: true,
    });
  }

  buttons.push(alwaysAllow
    ? { choice: 'allow_once', labelKey: 'panel.permissionPrompt.allowOnce', defaultLabel: 'Allow once', tone: 'allow', always: false }
    : { choice: 'allow_once', labelKey: 'panel.permissionPrompt.allow', defaultLabel: 'Allow', tone: 'allow', always: false });

  return buttons;
}
