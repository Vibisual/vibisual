import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { mobileTerminalEnv } from './mobileTerminalEnv';

describe('mobile terminal environment contract', () => {
  it('preserves strings exactly and accepts an absent environment', () => {
    const env = { VIBISUAL_CLAUDE_LOGIN_BIN: 'C:\\Tools\\R&D %DEMO%\\claude.exe', VIBISUAL_CLAUDE_LOGIN_EMAIL: "r&d+$DEMO%'test@example.invalid" };
    expect(mobileTerminalEnv(env)).toEqual(env);
    expect(mobileTerminalEnv(undefined)).toBeUndefined();
    expect(mobileTerminalEnv({})).toEqual({});
  });

  it.each([null, [], 'text', { KEY: 1 }, { KEY: null }, { '': 'empty-key' }, { 'A=B': 'bad-key' }, { KEY: 'nul\u0000byte' }])(
    'rejects malformed JSON environment without coercion: %j', (input) => {
      expect(() => mobileTerminalEnv(input)).toThrow('invalid-terminal-env');
    },
  );
});

// The Electron host module cannot be imported in a Node test. Execute its actual
// frame handler with inert dependencies, so forwarding/auth checks stay covered.
const source = fs.readFileSync(new URL('./mobileAccess.ts', import.meta.url), 'utf8');
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const tree = ts.createSourceFile('mobileAccess.ts', source, ts.ScriptTarget.ES2022, true);
const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'handleTerminalFrame');
if (!declaration) throw new Error('Missing mobile terminal frame handler');
const handler = ts.transpileModule(`return (${declaration.getText(tree)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

describe('mobile login frame reaches the desktop PTY environment', () => {
  function setup() {
    const createTerminal = vi.fn(() => ({ ok: true }));
    const sendTermFrame = vi.fn();
    const handle = new Function('createTerminal', 'sendTermFrame', 'wsTermSink', 'mobileTerminalEnv', handler)(
      createTerminal, sendTermFrame, () => ({}), mobileTerminalEnv,
    ) as (ws: object, allowed: boolean, type: string, payload: unknown) => void;
    return { handle, createTerminal, sendTermFrame };
  }

  it.each(['VIBISUAL_CLAUDE_LOGIN_BIN', 'VIBISUAL_CODEX_LOGIN_BIN'])('forwards %s and email through the actual frame handler', (key) => {
    const { handle, createTerminal, sendTermFrame } = setup();
    const env = { [key]: '/opt/R&D $DEMO/cli', VIBISUAL_CLAUDE_LOGIN_EMAIL: 'r&d@example.invalid' };
    handle({}, true, 'term_create', { termId: 'login-test', cwd: '', config: DEFAULT_AGENT_CONFIG, command: 'fixture', autoRun: true, env });
    expect(createTerminal).toHaveBeenCalledExactlyOnceWith({}, expect.objectContaining({ env, command: 'fixture', autoRun: true }));
    expect(sendTermFrame).toHaveBeenCalledWith({}, 'term_ack', { termId: 'login-test', ok: true, error: undefined });
  });

  it('returns an error for malformed env without creating a terminal', () => {
    const { handle, createTerminal, sendTermFrame } = setup();
    handle({}, true, 'term_create', { termId: 'login-test', env: { TOKEN: 42 } });
    expect(createTerminal).not.toHaveBeenCalled();
    expect(sendTermFrame).toHaveBeenCalledWith({}, 'term_ack', { termId: 'login-test', ok: false, error: 'invalid-terminal-env' });
  });

  it('keeps the external-network terminal block before environment handling', () => {
    const { handle, createTerminal, sendTermFrame } = setup();
    handle({}, false, 'term_create', { termId: 'login-test', env: { TOKEN: 42 } });
    expect(createTerminal).not.toHaveBeenCalled();
    expect(sendTermFrame).toHaveBeenCalledWith({}, 'term_unavailable', { termId: 'login-test', reason: 'external' });
  });
});
