/** One queue per renderer: all windows use AppDialogHost instead of browser-owned dialogs. */
export interface AppDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface AppDialogRequest extends AppDialogOptions {
  readonly id: number;
  readonly kind: 'confirm' | 'prompt' | 'alert';
  readonly message: string;
  readonly defaultValue: string;
}

type Answer = boolean | string | null;
type Pending = { request: AppDialogRequest; resolve: (answer: Answer) => void };
const queue: Pending[] = [];
const listeners = new Set<() => void>();
let sequence = 0;
let keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
const installed = new WeakSet<Window>();

export const getAppDialog = (): AppDialogRequest | null => queue[0]?.request ?? null;
export function subscribeAppDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function emit(): void { for (const listener of listeners) listener(); }

function ask(kind: AppDialogRequest['kind'], message: string, defaultValue: string, options: AppDialogOptions): Promise<Answer> {
  return new Promise((resolve) => {
    queue.push({ request: { ...options, id: ++sequence, kind, message, defaultValue }, resolve });
    emit();
  });
}

export async function confirmDialog(message: string, options: AppDialogOptions = {}): Promise<boolean> {
  return await ask('confirm', message, '', options) === true;
}
export async function promptDialog(message: string, defaultValue = '', options: AppDialogOptions = {}): Promise<string | null> {
  const answer = await ask('prompt', message, defaultValue, options);
  return typeof answer === 'string' ? answer : null;
}
export async function alertDialog(message: string, options: AppDialogOptions = {}): Promise<void> {
  await ask('alert', message, '', options);
}

/** Ignore stale/double clicks after the next queued question has appeared. */
export function answerAppDialog(id: number, answer: Answer): void {
  if (queue[0]?.request.id !== id) return;
  const pending = queue.shift()!;
  emit();
  pending.resolve(answer);
}

export function setAppDialogKeyboardHandler(handler: (event: KeyboardEvent) => void): () => void {
  keyboardHandler = handler;
  return () => { if (keyboardHandler === handler) keyboardHandler = null; };
}

/** Install before rendering: the floating-window Escape listener and global commands run in capture too. */
export function installAppDialogKeyboardGuard(view: Window): void {
  if (installed.has(view)) return;
  installed.add(view);
  view.addEventListener('keydown', (event) => {
    if (!getAppDialog()) return;
    event.stopImmediatePropagation();
    if (keyboardHandler) keyboardHandler(event);
    else event.preventDefault();
  }, true);
}
