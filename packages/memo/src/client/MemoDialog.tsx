import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { IconX } from './icons.js';
import { MemoIconButton } from './ui.js';

interface MemoDialogProps { title: string; closeLabel: string; close: () => void; children: ReactNode; wide?: boolean }
export function MemoDialog({ title, closeLabel, close, children, wide }: MemoDialogProps): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); closeRef.current(); }}
    className={`m-auto ${wide ? 'max-h-[94vh] w-[min(72rem,94vw)]' : 'max-h-[85vh] w-[min(46rem,92vw)]'} rounded-2xl border border-gray-800 bg-gray-900 p-4 text-gray-100 shadow-xl backdrop:bg-black/60`}>
    <header className="mb-4 flex items-center gap-3"><h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2><MemoIconButton label={closeLabel} onClick={close}><IconX /></MemoIconButton></header>
    {children}
  </dialog>;
}
