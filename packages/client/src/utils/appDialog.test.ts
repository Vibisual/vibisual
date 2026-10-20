import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alertDialog, answerAppDialog, confirmDialog, getAppDialog, installAppDialogKeyboardGuard,
  promptDialog, setAppDialogKeyboardHandler, subscribeAppDialog,
} from './appDialog.js';

afterEach(() => {
  while (getAppDialog()) answerAppDialog(getAppDialog()!.id, null);
});

function key(view: EventTarget, value = 'Enter'): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value });
  view.dispatchEvent(event);
  return event;
}

describe('app dialog queue', () => {
  it('notifies subscribers when a question opens or closes and supports unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppDialog(listener);
    expect(getAppDialog()).toBeNull();
    const result = confirmDialog('Discard edits?', { title: 'Close', tone: 'danger' });
    expect(getAppDialog()).toMatchObject({ kind: 'confirm', message: 'Discard edits?', title: 'Close', tone: 'danger' });
    expect(listener).toHaveBeenCalledTimes(1);
    answerAppDialog(getAppDialog()!.id, false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getAppDialog()).toBeNull();
    await expect(result).resolves.toBe(false);
    unsubscribe();
    void alertDialog('Done');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('answers queued dialogs in order and ignores stale double clicks on a previous question', async () => {
    const first = confirmDialog('First');
    const firstId = getAppDialog()!.id;
    const second = promptDialog('Second', 'seed');
    expect(getAppDialog()!.id).toBe(firstId);
    answerAppDialog(firstId, true);
    const secondId = getAppDialog()!.id;
    expect(secondId).not.toBe(firstId);
    expect(getAppDialog()).toMatchObject({ kind: 'prompt', message: 'Second', defaultValue: 'seed' });
    answerAppDialog(firstId, 'stale answer');
    expect(getAppDialog()!.id).toBe(secondId);
    answerAppDialog(secondId, 'current answer');
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe('current answer');
  });

  it('preserves an accepted empty string separately from a cancelled prompt', async () => {
    const empty = promptDialog('Name', 'existing');
    answerAppDialog(getAppDialog()!.id, '');
    await expect(empty).resolves.toBe('');
    const cancelled = promptDialog('Name');
    answerAppDialog(getAppDialog()!.id, null);
    await expect(cancelled).resolves.toBeNull();
  });

  it('resolves alerts only after their turn is acknowledged', async () => {
    const first = confirmDialog('First');
    const acknowledged = vi.fn();
    const alert = alertDialog('Complete').then(acknowledged);
    await Promise.resolve();
    expect(acknowledged).not.toHaveBeenCalled();
    answerAppDialog(getAppDialog()!.id, false);
    await first;
    expect(getAppDialog()!.kind).toBe('alert');
    expect(acknowledged).not.toHaveBeenCalled();
    answerAppDialog(getAppDialog()!.id, true);
    await alert;
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});

describe('app dialog keyboard ownership', () => {
  it('blocks later capture listeners while a dialog is open and releases them after dismissal', async () => {
    const view = new EventTarget();
    installAppDialogKeyboardGuard(view as Window);
    const underlying = vi.fn();
    view.addEventListener('keydown', underlying, true);
    expect(key(view).defaultPrevented).toBe(false);
    expect(underlying).toHaveBeenCalledTimes(1);
    const result = confirmDialog('Close?');
    expect(key(view).defaultPrevented).toBe(true); // protects the interval before the host mounts
    expect(underlying).toHaveBeenCalledTimes(1);
    answerAppDialog(getAppDialog()!.id, false);
    await result;
    key(view);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it('installs once per window and stale cleanup cannot remove the current host handler', () => {
    const view = new EventTarget();
    const add = vi.spyOn(view, 'addEventListener');
    installAppDialogKeyboardGuard(view as Window);
    installAppDialogKeyboardGuard(view as Window);
    expect(add).toHaveBeenCalledTimes(1);
    const old = vi.fn();
    const current = vi.fn();
    const offOld = setAppDialogKeyboardHandler(old);
    const offCurrent = setAppDialogKeyboardHandler(current);
    offOld();
    void confirmDialog('Continue?');
    key(view);
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
    offCurrent();
    expect(key(view).defaultPrevented).toBe(true);
  });
});
