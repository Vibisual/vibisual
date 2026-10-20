import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import {
  answerAppDialog, getAppDialog, setAppDialogKeyboardHandler, subscribeAppDialog,
  type AppDialogRequest,
} from '../../utils/appDialog.js';

function AppDialog({ request }: { request: AppDialogRequest }): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState(request.defaultValue);
  const input = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value); valueRef.current = value;
  const dismiss = (): void => answerAppDialog(request.id, request.kind === 'prompt' ? null : false);
  const accept = (): void => answerAppDialog(request.id, request.kind === 'prompt' ? valueRef.current : true);
  const backdrop = useBackdropDismiss(dismiss);
  const titleId = `app-dialog-title-${request.id}`;
  const messageId = `app-dialog-message-${request.id}`;

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = input.current ?? cancelButton.current ?? confirmButton.current;
    initial?.focus();
    input.current?.select();
    const off = setAppDialogKeyboardHandler((event) => {
      if (isComposingKeyEvent(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!event.repeat) dismiss();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const controls = [input.current, cancelButton.current, confirmButton.current].filter((node): node is HTMLInputElement | HTMLButtonElement => !!node);
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (event.repeat) return;
        if (document.activeElement === cancelButton.current) dismiss(); else accept();
      }
    });
    // Programmatic focus from an editor/background update must not escape the modal.
    const keepFocus = (event: FocusEvent): void => {
      if (!panel.current?.contains(event.target as Node)) initial?.focus();
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      off(); document.removeEventListener('focusin', keepFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [request.id]);

  return <div className="app-nodrag fixed inset-0 flex items-center justify-center bg-black/60 p-4"
    style={{ zIndex: 2_000_000_000 }} data-shortcut-scope="dialog" {...backdrop}>
    <div ref={panel} role={request.kind === 'prompt' ? 'dialog' : 'alertdialog'} aria-modal="true"
      aria-labelledby={titleId} aria-describedby={messageId}
      className="max-h-full w-full max-w-md overflow-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-3">
        <svg aria-hidden="true" className={`h-4 w-4 shrink-0 ${request.tone === 'danger' ? 'text-amber-400' : 'text-violet-400'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" />
        </svg>
        <h2 id={titleId} className="min-w-0 break-words text-sm font-semibold text-gray-100">{request.title ?? t('common.confirm')}</h2>
      </div>
      <div className="px-5 py-4">
        <p id={messageId} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{request.message}</p>
        {request.kind === 'prompt' && <input ref={input} type="text" value={value} aria-labelledby={messageId}
          onChange={(event) => setValue(event.target.value)}
          className="mt-3 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" />}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {request.kind !== 'alert' && <button ref={cancelButton} type="button" onClick={dismiss}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
            {request.cancelLabel ?? t('common.cancel')}
          </button>}
          <button ref={confirmButton} type="button" onClick={accept}
            className={`rounded border px-3 py-1.5 text-sm text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 ${request.tone === 'danger' ? 'border-red-700 bg-red-800 hover:bg-red-700' : 'border-violet-600 bg-violet-700 hover:bg-violet-600'}`}>
            {request.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  </div>;
}

/** Mount once in main.tsx so detached app/IDE/command windows use the same dialogs. */
export function AppDialogHost(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeAppDialog, getAppDialog, () => null);
  return request ? createPortal(<AppDialog key={request.id} request={request} />, document.body) : null;
}
