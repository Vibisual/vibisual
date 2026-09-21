/** Browser candidate keys must not submit, clear, rename or indent app text fields. */
const IME_COMMAND_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const IME_PROCESS_KEY_CODE = 229;

interface Guard {
  view: Window;
  active: boolean;
  frames: Set<number>;
  dispose: () => void;
}
interface FieldState {
  guard: Guard;
  composing: boolean;
  settling: boolean;
  scheduled: boolean;
  version: number;
  queue: Array<() => void>;
}
const fields = new WeakMap<EventTarget, FieldState>();
const installed = new WeakMap<Window, Guard>();

interface CompositionKey {
  isComposing?: boolean;
  keyCode?: number;
  target?: EventTarget | null;
}

export function isInputComposing(target: EventTarget | null | undefined): boolean {
  const state = target ? fields.get(target) : undefined;
  return !!state?.guard.active && (state.composing || state.settling);
}

export function isComposingKeyEvent(event: CompositionKey): boolean {
  return event.isComposing === true || event.keyCode === IME_PROCESS_KEY_CODE || isInputComposing(event.target);
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!target || !('tagName' in target)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    || ('isContentEditable' in target && target.isContentEditable === true);
}

function fieldState(target: EventTarget, guard: Guard): FieldState {
  let state = fields.get(target);
  if (!state || state.guard !== guard) {
    state = { guard, composing: false, settling: false, scheduled: false, version: 0, queue: [] };
    fields.set(target, state);
  }
  return state;
}

function nextFrame(guard: Guard, action: () => void): void {
  const id = guard.view.requestAnimationFrame(() => { guard.frames.delete(id); if (guard.active) action(); });
  guard.frames.add(id);
}

function drain(target: EventTarget, state: FieldState): void {
  if (fields.get(target) !== state || !state.guard.active) return;
  state.scheduled = false;
  if ('isConnected' in target && !target.isConnected) { fields.delete(target); return; }
  if (state.composing || state.settling) return;
  const action = state.queue.shift();
  if (!action) return;
  // Keep the drain reserved until another frame, including edits arriving during/after this action.
  // React must commit its controlled value before a subsequent voice result reads the DOM again.
  state.scheduled = true;
  try { action(); } finally { nextFrame(state.guard, () => drain(target, state)); }
}

/** Callers validate their session/value snapshot when this runs. Blur cancels pending work. */
export function afterInputComposition(target: EventTarget, action: () => void): void {
  const current = fields.get(target);
  const view = isEditableTarget(target) ? target.ownerDocument?.defaultView : undefined;
  const guard = current?.guard.active ? current.guard : view ? installed.get(view) : undefined;
  if (!guard?.active) { action(); return; }
  const state = fieldState(target, guard);
  state.queue.push(action);
  if (state.composing || state.settling || state.scheduled) return;
  state.scheduled = true;
  nextFrame(guard, () => drain(target, state));
}

/** Unmount/session changes invalidate already scheduled callbacks as well as composition state. */
export function cancelPendingInputEdits(target: EventTarget): void {
  fields.delete(target);
}

export function installInputCompositionGuard(view: Window): () => void {
  const existing = installed.get(view);
  if (existing) return existing.dispose;
  const guard: Guard = { view, active: true, frames: new Set(), dispose: () => undefined };
  const start = (event: CompositionEvent): void => {
    if (!isEditableTarget(event.target)) return;
    const state = fieldState(event.target, guard);
    state.version += 1;
    state.settling = false;
    state.composing = true;
  };
  const end = (event: CompositionEvent): void => {
    const target = event.target;
    if (!isEditableTarget(target)) return;
    const state = fieldState(target, guard);
    const version = ++state.version;
    state.composing = false;
    state.settling = true;
    nextFrame(guard, () => {
      if (fields.get(target) !== state || state.version !== version) return;
      state.settling = false;
      if (!state.scheduled) drain(target, state);
    });
  };
  const blur = (event: FocusEvent): void => {
    if (event.target) cancelPendingInputEdits(event.target);
  };
  const key = (event: KeyboardEvent): void => {
    if (!isEditableTarget(event.target) || !IME_COMMAND_KEYS.has(event.key)) return;
    // xterm's CompositionHelper needs keydown to finalize/send composition before shell commands.
    // Its own input implementation owns these keys; app shortcuts use isComposingKeyEvent instead.
    if (event.target.classList?.contains('xterm-helper-textarea')) return;
    if (isComposingKeyEvent(event)) event.stopImmediatePropagation();
    // Never preventDefault: native candidate acceptance/navigation/cancellation remains intact.
  };
  view.addEventListener('compositionstart', start, true);
  view.addEventListener('compositionend', end, true);
  view.addEventListener('focusout', blur, true);
  view.addEventListener('keydown', key, true);
  guard.dispose = (): void => {
    guard.active = false;
    view.removeEventListener('compositionstart', start, true);
    view.removeEventListener('compositionend', end, true);
    view.removeEventListener('focusout', blur, true);
    view.removeEventListener('keydown', key, true);
    for (const id of guard.frames) view.cancelAnimationFrame(id);
    guard.frames.clear();
    installed.delete(view);
  };
  installed.set(view, guard);
  return guard.dispose;
}
