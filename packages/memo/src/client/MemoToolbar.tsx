import type { JSX } from 'react';
import type { MemoClientHost } from '../host.js';
import { IconBold, IconCheck, IconCopy, IconDuplicate, IconHeading, IconHistory, IconItalic, IconList, IconListChecks, IconListOrdered, IconPaperclip, IconPin, IconPlus, IconRestore, IconShieldOff, IconStrike, IconTable, IconTrash } from './icons.js';
import { INSERT_IDS, insertStamp, insertTable, runInsert } from './insertMenu.js';
import { MemoInsertMenu, MemoPopover, MemoTablePicker } from './MemoInsertMenu.js';
import { MemoTableBar } from './MemoTableBar.js';
import { titled } from './shortcutTitle.js';
import type { TableOp } from './tableEditing.js';
import { MemoIconButton, type MemoText } from './ui.js';
import type { BodyEdit } from './useBodyEdit.js';
import { useCopyText } from './useCopyText.js';

interface MemoToolbarProps {
  tr: MemoText; host: MemoClientHost; saved: boolean; trash: boolean; locked: boolean; busy: boolean;
  pinned: boolean; aiExcluded: boolean; body: string; edit: BodyEdit; locale: string | undefined;
  /** 커서가 표 안에 있다 — 표 줄을 편다. */
  inTable: boolean; tableOp: (op: TableOp) => void; openGrid: () => void;
  toggle: (patch: { pinned: boolean } | { aiExcluded: boolean }) => void;
  pickFiles: () => void; history: () => void; duplicate: () => void; trashAction: () => void;
}
const SEP = 'mx-1 h-4 w-px shrink-0 bg-gray-800';

export function MemoToolbar({ tr, host, saved, trash, locked, busy, pinned, aiExcluded, body, edit, locale, inTable, tableOp, openGrid, toggle, pickFiles, history, duplicate, trashAction }: MemoToolbarProps): JSX.Element {
  const clip = useCopyText();
  const formatting = !locked;
  return <div data-memo-keep className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900">
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
      {formatting && <>
        <MemoIconButton label={titled(tr, host, tr('format.bold'), 'Ctrl+B')} onClick={() => edit.wrap('**')}><IconBold /></MemoIconButton>
        <MemoIconButton label={titled(tr, host, tr('format.italic'), 'Ctrl+I')} onClick={() => edit.wrap('*')}><IconItalic /></MemoIconButton>
        <MemoIconButton label={titled(tr, host, tr('format.strike'), 'Ctrl+Shift+X')} onClick={() => edit.wrap('~~')}><IconStrike /></MemoIconButton>
        <MemoIconButton label={tr('format.heading')} onClick={() => edit.prefix('## ')}><IconHeading /></MemoIconButton>
        <span aria-hidden="true" className={SEP} />
        <MemoIconButton label={tr('format.bullet')} onClick={() => edit.prefix('- ')}><IconList /></MemoIconButton>
        <MemoIconButton label={tr('format.number')} onClick={() => edit.prefix('1. ')}><IconListOrdered /></MemoIconButton>
        <MemoIconButton label={tr('format.todo')} onClick={() => edit.prefix('- [ ] ')}><IconListChecks /></MemoIconButton>
        <span aria-hidden="true" className={SEP} />
        <MemoPopover label={tr('table.insert')} icon={<IconTable />}>
          {close => <MemoTablePicker tr={tr} pick={(rows, cols) => { close(); edit.run((value, start, end) => insertTable(value, start, end, rows, cols)); }} />}
        </MemoPopover>
        <MemoPopover label={tr('insert.open')} icon={<IconPlus />}>
          {close => <MemoInsertMenu tr={tr} items={INSERT_IDS} pick={id => { close(); edit.run((value, start, end) => runInsert(id, value, start, end, insertStamp(new Date(), locale))); }} />}
        </MemoPopover>
        <span aria-hidden="true" className={SEP} />
      </>}
      <span className="flex-1" />
      <MemoIconButton label={tr('pin')} pressed={pinned} disabled={locked} onClick={() => toggle({ pinned: !pinned })}><IconPin /></MemoIconButton>
      <MemoIconButton label={tr('excludeAI')} pressed={aiExcluded} disabled={locked} onClick={() => toggle({ aiExcluded: !aiExcluded })}><IconShieldOff /></MemoIconButton>
      <MemoIconButton label={tr('attach')} disabled={locked} onClick={pickFiles}><IconPaperclip /></MemoIconButton>
      {saved && <MemoIconButton label={tr('history')} onClick={history}><IconHistory /></MemoIconButton>}
      {clip.available && <MemoIconButton label={clip.copied ? tr('copied') : tr('copyText')} onClick={() => clip.copy(body)}>{clip.copied ? <IconCheck /> : <IconCopy />}</MemoIconButton>}
      {saved && <MemoIconButton label={tr('duplicate')} disabled={busy} onClick={duplicate}><IconDuplicate /></MemoIconButton>}
      {saved && (trash
        ? <MemoIconButton label={tr('restore')} disabled={busy} onClick={trashAction}><IconRestore /></MemoIconButton>
        : <MemoIconButton label={tr('delete')} tone="danger" disabled={busy} onClick={trashAction}><IconTrash /></MemoIconButton>)}
    </div>
    {formatting && inTable && <div className="absolute inset-x-0 top-full border-b border-gray-800 bg-gray-900">
      <MemoTableBar tr={tr} run={tableOp} openGrid={openGrid} />
    </div>}
  </div>;
}
