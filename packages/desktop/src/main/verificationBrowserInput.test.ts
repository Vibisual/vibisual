import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { browserInput, pressBrowserKey, verificationDom } from './verificationBrowserInput';

function contents(value: unknown = { x: 10, y: 20 }): { wc: WebContents; send: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({})), evaluate = vi.fn(async () => ({ ok: true, value }));
  return { wc: { debugger: { sendCommand: send }, executeJavaScriptInIsolatedWorld: evaluate } as unknown as WebContents, send, evaluate };
}

describe('browser trusted input', () => {
  it('uses keyDown/keyUp and never types a control chord as visible text', async () => {
    const { wc, send } = contents(); await pressBrowserKey(wc, 'Ctrl+A', 'win32');
    expect(send.mock.calls[0]).toEqual(['Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', code: 'KeyA', modifiers: 2 })]);
    expect(send.mock.calls[0]![1]).not.toHaveProperty('text');
    expect(send.mock.calls[1]).toEqual(['Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp' })]);
  });
  it('sends Enter as a real keyboard input', async () => {
    const { wc, send } = contents(); await pressBrowserKey(wc, 'Enter', 'linux');
    expect(send.mock.calls[0]).toEqual(['Input.dispatchKeyEvent', expect.objectContaining({ text: '\r', windowsVirtualKeyCode: 13 })]);
  });
  it('clears a selected field even when the new text is empty', async () => {
    const { wc, send } = contents(); await browserInput(wc, { kind: 'fill', selector: '#name', text: '' }, 'win32');
    expect(send.mock.calls).toContainEqual(['Input.dispatchKeyEvent', expect.objectContaining({ key: 'Backspace', type: 'keyDown' })]);
    expect(send.mock.calls.map(call => call[0])).not.toContain('Input.insertText');
  });
  it('uses Unicode insertion after select-all and deletion', async () => {
    const { wc, send } = contents(); await browserInput(wc, { kind: 'fill', text: '한글' }, 'darwin');
    expect(send.mock.calls.at(-1)).toEqual(['Input.insertText', { text: '한글' }]);
    expect(send.mock.calls[0]![1]).toMatchObject({ modifiers: 4, commands: ['selectAll'] });
  });
  it('keeps coordinate clicks inside the actual viewport', async () => {
    const { wc, send } = contents({ width: 1280, height: 720 });
    await browserInput(wc, { kind: 'click', x: 1, y: 1 }, 'win32');
    expect(send.mock.calls).toContainEqual(['Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 1279, y: 719 })]);
  });
  it('releases a mouse button even if CDP rejects pressing it', async () => {
    const { wc, send } = contents(); send.mockImplementation(async (_command: string, payload: { type: string }) => { if (payload.type === 'mousePressed') throw new Error('Input rejected'); return {}; });
    await expect(browserInput(wc, { kind: 'click', selector: '#button' }, 'win32')).rejects.toThrow('Input rejected');
    expect(send.mock.calls.at(-1)).toEqual(['Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased' })]);
  });
  it('returns the precise app-owned DOM failure to the caller', async () => {
    const { wc, evaluate } = contents(); evaluate.mockResolvedValue({ ok: false, error: 'Target is covered' });
    await expect(verificationDom(wc, { operation: 'locate', selector: '#button' })).rejects.toThrow('Target is covered');
  });
});
