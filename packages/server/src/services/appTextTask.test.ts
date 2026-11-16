import { beforeEach, describe, expect, it, vi } from 'vitest';
const cli = vi.hoisted(() => ({ run: vi.fn(), auth: vi.fn() }));
vi.mock('./claudeCliRun.js', () => ({ runClaudeCli: cli.run }));
vi.mock('./claudeAuthService.js', () => ({ claudeAuthService: { refresh: cli.auth } }));
import { runTextTask } from './appTextTask.js';
import { codexTextArgs, parseCodexTextTask } from './appCodexTextTask.js';

beforeEach(() => { cli.run.mockReset(); cli.auth.mockResolvedValue({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }); });
describe('app subscription-only text execution', () => {
  it('classifies the real weekly-limit response and preserves host usage identity', async () => {
    cli.run.mockResolvedValue({ code: 1, out: JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, api_error: 'usage_limit_reached',
      result: "You've hit your weekly limit", session_id: 'host-session', usage: { input_tokens: 0 }, credential_expires_at: 'private-metadata' }) });
    const result = await runTextTask('{}');
    expect(result).toEqual({ state: 'limited', text: '', hostTaskId: 'host-session', usage: { input_tokens: 0 } });
  });
  it('rejects API-key and console auth without starting a paid API fallback', async () => {
    cli.auth.mockResolvedValue({ loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' });
    expect((await runTextTask('{}')).state).toBe('connection'); expect(cli.run).not.toHaveBeenCalled();
  });
  it('treats timeout as an uncertain outcome, with no automatic second call', async () => {
    cli.run.mockResolvedValue({ code: null, out: '', failure: 'timeout' });
    expect((await runTextTask('{}')).state).toBe('checking'); expect(cli.run).toHaveBeenCalledTimes(1);
  });
  it('removes tools and project configuration from the Claude invocation', async () => {
    cli.run.mockResolvedValue({ code: 0, out: JSON.stringify({ result: '{"claims":[]}', session_id: 'host', usage: { input_tokens: 5 } }) });
    expect((await runTextTask('{}')).state).toBe('completed');
    const args = cli.run.mock.calls[0]?.[0] as string[];
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args).toContain('--strict-mcp-config'); expect(args).toContain('--no-session-persistence');
  });
  it('pins Codex to ChatGPT auth and disables command, file, connector and browsing tools', () => {
    const args = codexTextArgs('{}');
    expect(args).toContain('forced_login_method="chatgpt"'); expect(args).toContain('--ignore-user-config');
    for (const feature of ['shell_tool', 'apps', 'plugins', 'multi_agent', 'view_image', 'computer_use']) expect(args.slice(args.indexOf(feature) - 1, args.indexOf(feature) + 1)).toEqual(['--disable', feature]);
    expect(args).toContain('web_search="disabled"'); expect(args).toContain('mcp_servers={}');
  });
  it('reads Codex host IDs and actual token usage and rejects tool-bearing output', () => {
    const events = [{ type: 'thread.started', thread_id: 'thread-id' }, { type: 'item.completed', item: { type: 'agent_message', text: 'verified output' } },
      { type: 'turn.completed', usage: { input_tokens: 15, output_tokens: 7 } }];
    expect(parseCodexTextTask(events.map(event => JSON.stringify(event)).join('\n'), 0)).toEqual({ state: 'completed', text: 'verified output', hostTaskId: 'thread-id', usage: { input_tokens: 15, output_tokens: 7 } });
    expect(parseCodexTextTask([...events, { type: 'item.completed', item: { type: 'command_execution' } }].map(event => JSON.stringify(event)).join('\n'), 0).state).toBe('failed');
  });
});
