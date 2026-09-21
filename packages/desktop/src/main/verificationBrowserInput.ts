import type { WebContents } from 'electron';
import type { VerificationAction } from '@vibisual/shared';
import { normalizedPoint, verificationKey } from './verificationAutomationPolicy';
import { verificationDomScript } from './verificationDom';

const WORLD_ID = 1001;
export async function verificationDom<T>(wc: WebContents, request: Parameters<typeof verificationDomScript>[0]): Promise<T> {
  // World 1001 shares the DOM, but not the target's replaced JS globals/prototypes.
  // Electron otherwise replaces page-thrown errors with an opaque "Script failed" message.
  const code = `(() => { try { return {ok:true,value:${verificationDomScript(request)}}; } catch(error) { return {ok:false,error:String(error.message || error)}; } })()`;
  const result = await wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]) as { ok: boolean; value: T; error?: string };
  if (!result.ok) throw new Error(result.error ?? 'The target DOM operation failed.');
  return result.value;
}

export async function pressBrowserKey(wc: WebContents, raw: string, platform: string): Promise<void> {
  const key = verificationKey(raw, platform);
  const props = { key: key.key, code: key.code, windowsVirtualKeyCode: key.virtualKey, nativeVirtualKeyCode: key.virtualKey, modifiers: key.modifiers };
  const text = key.key === 'Enter' ? '\r' : key.key.length === 1 && !(key.ctrl || key.alt || key.meta) ? key.key : undefined;
  try {
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...props, ...(text ? { text, unmodifiedText: text } : {}), ...(key.meta && key.code === 'KeyA' ? { commands: ['selectAll'] } : {}) });
  } finally {
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...props });
  }
}

export async function browserInput(wc: WebContents, action: VerificationAction, platform: string): Promise<void> {
  if (action.kind === 'click' || action.kind === 'double-click') {
    let point: { x: number; y: number };
    if (action.selector) point = await verificationDom(wc, { operation: 'locate', selector: action.selector });
    else {
      const fraction = normalizedPoint(action.x, action.y);
      const size = await verificationDom<{ width: number; height: number }>(wc, { operation: 'snapshot', limit: 0 });
      point = { x: Math.min(size.width - 1, fraction.x * size.width), y: Math.min(size.height - 1, fraction.y * size.height) };
    }
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    for (let count = 1; count <= (action.kind === 'double-click' ? 2 : 1); count++) {
      try { await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: count, ...point }); }
      finally { await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: count, ...point }); }
    }
  } else if (action.kind === 'fill') {
    await verificationDom(wc, { operation: 'editable', selector: action.selector });
    await pressBrowserKey(wc, 'Mod+A', platform);
    // Empty text must clear a field too; insertText('') does not delete the selection.
    await pressBrowserKey(wc, 'Backspace', platform);
    if (action.text) await wc.debugger.sendCommand('Input.insertText', { text: action.text });
  } else if (action.kind === 'press') await pressBrowserKey(wc, action.key, platform);
  else if (action.kind === 'scroll') {
    const size = await verificationDom<{ width: number; height: number }>(wc, { operation: 'snapshot', limit: 0 });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: size.width / 2, y: size.height / 2, deltaX: action.deltaX, deltaY: action.deltaY });
  } else throw new Error(`Unsupported browser input: ${action.kind}`);
}
