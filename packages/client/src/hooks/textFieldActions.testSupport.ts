import { vi } from 'vitest';
import type { TextFieldElement } from './textFieldActions.js';

const compositionState = vi.hoisted(() => ({
  active: new WeakSet<EventTarget>(), pending: [] as Array<() => void>,
}));
export const composition = compositionState;
vi.mock('../utils/inputComposition.js', () => ({
  isInputComposing: (target: EventTarget): boolean => compositionState.active.has(target),
  afterInputComposition: (_target: EventTarget, action: () => void): void => { compositionState.pending.push(action); },
}));

export class FieldDocument {
  activeElement: Field | null = null;
  frames: Array<FrameRequestCallback> = [];
  execCommand = vi.fn((_command: string, _showUI?: boolean, _value?: string): boolean => false);
  defaultView = {
    requestAnimationFrame: (callback: FrameRequestCallback): number => this.frames.push(callback),
  };
  frame(): void { for (const callback of this.frames.splice(0)) callback(0); }
}

export class Field extends EventTarget {
  protected text = '';
  isConnected = true;
  disabled = false;
  readOnly = false;
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  focusEffect?: () => void;
  focusCalls = 0;
  selectionCalls = 0;
  constructor(public ownerDocument: FieldDocument) { super(); }
  get value(): string { return this.text; }
  set value(value: string) { this.text = value; }
  focus(): void {
    this.focusCalls += 1;
    this.ownerDocument.activeElement = this;
    this.focusEffect?.();
  }
  setSelectionRange(start: number, end: number): void {
    this.selectionCalls += 1;
    if (this.selectionStart === null) throw new Error('InvalidStateError');
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  select(): void { this.setSelectionRange(0, this.value.length); }
  /** The fixture implements the DOM operations this module consumes; no browser app is launched. */
  get element(): TextFieldElement { return this as unknown as HTMLInputElement; }
}

export class Input extends Field {
  override get value(): string { return this.text; }
  override set value(value: string) { this.text = value; }
}
export class Textarea extends Field {
  override get value(): string { return this.text; }
  override set value(value: string) { this.text = value; }
}

export function setup(): { doc: FieldDocument; field: Input } {
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('HTMLTextAreaElement', Textarea);
  vi.stubGlobal('navigator', { clipboard: {} });
  composition.active = new WeakSet();
  composition.pending = [];
  const doc = new FieldDocument();
  const field = new Input(doc);
  field.value = 'abc';
  field.selectionStart = 1;
  field.selectionEnd = 2;
  doc.activeElement = field;
  return { doc, field };
}

export function finishComposition(field: Field): void {
  composition.active.delete(field);
  for (const action of composition.pending.splice(0)) action();
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: () => void } {
  const callbacks: { resolve?: (value: T) => void; reject?: (reason: Error) => void } = {};
  const promise = new Promise<T>((resolve, reject): void => { callbacks.resolve = resolve; callbacks.reject = reject; });
  return {
    promise,
    resolve: (value: T): void => { callbacks.resolve?.(value); },
    reject: (): void => { callbacks.reject?.(new Error('Clipboard denied')); },
  };
}

export async function settleClipboard(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
