import i18n from '../i18n/index.js';
import { confirmDialog } from '../utils/appDialog.js';

/** Renderer-local readers, not persisted drafts. Hidden session tabs are included by the editor. */
export type IDEEditorDrafts = Readonly<Record<string, string>>;
type DraftReader = () => IDEEditorDrafts;
const readers = new Map<string, DraftReader>();
const pending = new Set<string>();

export function registerIDEEditorDrafts(paneKey: string, read: DraftReader): () => void {
  readers.set(paneKey, read);
  return () => { if (readers.get(paneKey) === read) readers.delete(paneKey); };
}

/** Clean panes still close synchronously; every user-facing close uses the same discard dialog. */
export function guardIDEEditorClose(
  paneKey: string,
  fallback: DraftReader,
  isCurrent: () => boolean,
  close: () => void,
): void {
  if (pending.has(paneKey)) return;
  const registered = readers.get(paneKey);
  const read = registered ?? fallback;
  const drafts = read();
  const count = Object.keys(drafts).length;
  if (count === 0) { close(); return; }
  pending.add(paneKey);
  void confirmDialog(i18n.t(count === 1 ? 'ide.editor.closeDirtyConfirm' : 'ide.editor.closeDirtyConfirmMany', { count }), {
    title: i18n.t('panel.options.discardTitle'),
    confirmLabel: i18n.t('panel.options.discardLeave'),
    cancelLabel: i18n.t('panel.options.discardKeep'),
    tone: 'danger',
  }).then((approved) => {
    // A confirmation belongs to this mounted editor and exactly the drafts the user was asked about.
    // Saving while the dialog is open is safe; new typing or a replaced pane is not covered by it.
    if (!approved || !isCurrent() || readers.get(paneKey) !== registered) return;
    if (Object.entries(read()).some(([path, text]) => drafts[path] !== text)) return;
    close();
  }).finally(() => { pending.delete(paneKey); });
}
