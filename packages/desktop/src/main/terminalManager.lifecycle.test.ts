import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { createTerminal, killAllTerminals, killTerminal, terminalController, writeTerminal, type TermSink } from './terminalManager';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), killTree: vi.fn(), diagnostic: vi.fn() }));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ existsSync: () => true, statSync: () => ({ mode: 0o755 }), chmodSync: vi.fn() }));
vi.mock('@vibisual/server', () => ({
  getClaudeBin: () => ({ binPath: 'test-claude' }), buildInteractiveCliPrefill: () => ({ managed: false, prefill: '' }),
  buildBashTimeoutEnv: () => ({}), buildAgentTokenSaverEnv: () => ({}), prepareInteractiveRulesDir: () => null,
  buildInteractivePluginBlockForAgent: () => '', getCmdResumeSession: () => null, parseCmdTermId: () => null,
  recordDiagnostic: mocks.diagnostic, killTree: mocks.killTree,
}));

class Terminal extends EventEmitter {
  readonly _agent = { inSocket: new EventEmitter() };
  readonly pid = 1234;
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  onData(callback: (data: string) => void) { this.on('data', callback); return { dispose: () => this.off('data', callback) }; }
  onExit(callback: (event: { exitCode: number }) => void) { this.on('exit', callback); return { dispose: () => this.off('exit', callback) }; }
}
function create(termId: string) {
  const terminal = new Terminal(); mocks.spawn.mockReturnValueOnce(terminal);
  const sink: TermSink = { id: 'test', isAlive: () => true, sendData: vi.fn(), sendExit: vi.fn() };
  expect(createTerminal(sink, { termId, cwd: process.cwd(), config: DEFAULT_AGENT_CONFIG, command: 'echo test', autoRun: false })).toEqual({ ok: true });
  return { terminal, sink };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { killAllTerminals(); vi.useRealTimers(); });

describe('PTY failures and delayed events only affect their original session', () => {
  it('preserves the actual successful exit after node-pty reports normal output EIO', () => {
    const h = create('normal-eio');
    h.terminal.emit('error', Object.assign(new Error('read EIO'), { code: 'EIO' }));
    expect(terminalController.exists('normal-eio')).toBe(true);
    expect(h.sink.sendExit).not.toHaveBeenCalled();
    expect(h.terminal.kill).not.toHaveBeenCalled();
    h.terminal.emit('exit', { exitCode: 0 });
    expect(h.sink.sendExit).toHaveBeenCalledExactlyOnceWith('normal-eio', 0);
    expect(terminalController.exists('normal-eio')).toBe(false);
  });

  it.each(['input', 'output'])('reports %s failure once and retains late error listeners', (side) => {
    const h = create('failed');
    const source = side === 'input' ? h.terminal._agent.inSocket : h.terminal;
    expect(() => source.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(terminalController.exists('failed')).toBe(false);
    expect(h.sink.sendExit).toHaveBeenCalledExactlyOnceWith('failed', 1);
    expect(h.terminal.kill).toHaveBeenCalledTimes(1);
    h.terminal.emit('exit', { exitCode: 9 }); source.emit('error', new Error('late'));
    expect(h.sink.sendExit).toHaveBeenCalledTimes(1);
    vi.runAllTimers(); expect(h.terminal.write).not.toHaveBeenCalled();
  });

  it('guards synchronous renderer input failure at the same operation boundary', () => {
    const h = create('write-failed'); h.terminal.write.mockImplementation(() => { throw new Error('closed'); });
    expect(() => writeTerminal('write-failed', 'text')).not.toThrow();
    expect(h.sink.sendExit).toHaveBeenCalledExactlyOnceWith('write-failed', 1);
    expect(terminalController.write('write-failed', 'later')).toBe(false);
  });

  it('an old exit, output or input error cannot remove or notify a replacement id', () => {
    const old = create('same'); killTerminal('same'); const current = create('same');
    old.terminal.emit('exit', { exitCode: 9 }); old.terminal.emit('data', 'late');
    old.terminal._agent.inSocket.emit('error', new Error('late EOF'));
    expect(terminalController.exists('same')).toBe(true);
    expect(old.sink.sendExit).not.toHaveBeenCalled(); expect(old.sink.sendData).not.toHaveBeenCalled();
    expect(current.sink.sendExit).not.toHaveBeenCalled();
    writeTerminal('same', 'new'); expect(current.terminal.write).toHaveBeenCalledWith('new');
    current.terminal.emit('exit', { exitCode: 0 });
    expect(current.sink.sendExit).toHaveBeenCalledExactlyOnceWith('same', 0);
    expect(terminalController.exists('same')).toBe(false);
  });

  it('clears only the failed PTY while other terminals keep accepting input', () => {
    const failed = create('first'); const healthy = create('second');
    failed.terminal.emit('error', new Error('EIO'));
    expect(terminalController.write('second', 'continue')).toBe(true);
    expect(healthy.terminal.write).toHaveBeenCalledWith('continue');
    expect(healthy.terminal.kill).not.toHaveBeenCalled();
  });
});
