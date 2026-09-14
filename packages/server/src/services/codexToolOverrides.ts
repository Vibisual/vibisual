import { hasCodexToolRestrictions, type CodexToolPolicy } from '@vibisual/shared';

/** Hosted tools bypass PreToolUse, so block them at their feature entry point.
 * Code execution and native children could bypass named-tool gates. Disable
 * those wrappers whenever a user selects any restriction. Shell remains its
 * own explicit permission, just as in Claude's tool list. */
export function codexToolOverrides(policy: CodexToolPolicy | undefined): string[] {
  if (!hasCodexToolRestrictions(policy)) return [];
  const out: string[] = [];
  const disable = (name: string) => out.push('-c', `features.${name}=false`);
  for (const name of ['code_mode', 'code_mode_only', 'multi_agent']) disable(name);
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
