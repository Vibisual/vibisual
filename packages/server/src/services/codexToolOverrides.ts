import { hasCodexToolRestrictions, type CodexToolPolicy } from '@vibisual/shared';

/** Hosted tools bypass PreToolUse, so block them at their feature entry point.
 * Code execution and native children could bypass named-tool gates. Disable
 * those wrappers whenever a user selects any restriction. Shell remains its
 * own explicit permission, just as in Claude's tool list. */
export function codexToolOverrides(policy: CodexToolPolicy | undefined): string[] {
  if (!hasCodexToolRestrictions(policy)) return [];
  const out: string[] = [];
  const disable = (name: string) => out.push('-c', `features.${name}=false`);
  // `multi_agent_v2` 는 별개 스위치다 — 사용자가 켜 두면 `multi_agent=false` 를 줘도 `collaboration`
  //   (spawn_agent·wait_agent·send_message…)이 그대로 제공된다(0.159.2 가짜 공급자 재현). 둘 다 끈다.
  for (const name of ['code_mode', 'code_mode_only', 'multi_agent', 'multi_agent_v2']) disable(name);
  if (policy?.shell === 'deny') for (const name of ['shell_tool', 'unified_exec']) disable(name);
  if (policy?.web === 'deny' || policy?.web === 'ask') out.push('-c', 'web_search="disabled"');
  if (policy?.image === 'deny' || policy?.image === 'ask') disable('image_generation');
  if (policy?.computer === 'deny' || policy?.computer === 'ask') {
    for (const name of ['browser_use', 'computer_use']) disable(name);
  }
  // Hosted app tools can execute outside the hook boundary.
  if (policy?.mcp === 'deny' || policy?.mcp === 'ask') disable('apps');
  return out;
}
