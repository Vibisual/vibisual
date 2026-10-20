import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import type { PromptTone } from './CollapsiblePrompt.js';
import { PromptActions } from './PromptActions.js';

/** Read-only prompt viewer confined to its IDE pane's non-scrolling text viewport. */
export function FullscreenPrompt({ host, tone, prompt, identity, preview, copied, onCopy, onClose }: {
  host: HTMLElement;
  tone: PromptTone;
  prompt: string;
  identity: ReactNode;
  preview: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const textZoom = useGraphStore((s) => s.ideTextZoom);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const doc = host.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    bodyRef.current?.focus({ preventScroll: true });

    // Escape belongs to this reader only while its contents have focus. Other IDE panes stay usable.
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      event.stopImmediatePropagation();
      if (isComposingKeyEvent(event)) return;
      event.preventDefault();
      if (!event.repeat) onClose();
    };
    view.addEventListener('keydown', handleKey, true);
    return () => {
      view.removeEventListener('keydown', handleKey, true);
      // Do not steal focus after the user has moved to another pane or the IDE input.
      if (previous?.isConnected && (dialog.contains(doc.activeElement) || doc.activeElement === doc.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [host, onClose]);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-labelledby={titleId}
      data-shortcut-scope="dialog"
      className="app-nodrag absolute inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-inherit p-3 max-md:p-2"
    >
      <div
        className="ide-stream min-h-0 min-w-0 w-full flex-1"
        data-ide-role="user"
        style={textZoom === 1 ? undefined : { zoom: textZoom }}
      >
        <div className="ide-user-msg ml-auto flex min-h-0 w-full max-w-[90%] flex-col max-md:max-w-[96%]">
          <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl rounded-tr-sm border shadow-sm ${tone.bubble}`}>
            <h2 id={titleId} className="sr-only">{t('ide.streamRenderer.promptReader.title')}</h2>
            <header className="flex shrink-0 items-center gap-2 py-2 pl-2.5 pr-[4.5rem]">
              {identity}
              <span className={`ide-prompt-text min-w-0 flex-1 truncate text-[13px] ${tone.body}`}>{preview}</span>
            </header>
            <PromptActions tone={tone} copied={copied} onCopy={onCopy} onView={onClose} expanded />
            <div
              ref={bodyRef}
              tabIndex={0}
              role="region"
              aria-labelledby={titleId}
              className={`scrollbar-thin min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain border-t focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current ${tone.pre}`}
            >
              <pre
                data-prompt-reader-body=""
                className="ide-prompt-text m-0 min-h-full w-full select-text whitespace-pre-wrap break-words px-3 py-2.5 text-[13px] [overflow-wrap:anywhere]"
              >
                {prompt}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
