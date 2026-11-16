import type { JSX } from 'react';
import { IconRetry, IconX } from './icons.js';
import { formatBytes } from './listView.js';
import { MemoIconButton, type MemoText } from './ui.js';
import type { MemoUpload } from './uploads.js';

interface MemoUploadTileProps { tr: MemoText; upload: MemoUpload; locale: string | undefined; max: string; retry: () => void; cancel: () => void }
const BAR = 'h-1.5 w-full appearance-none overflow-hidden rounded-full bg-gray-800 [&::-moz-progress-bar]:bg-blue-500 [&::-webkit-progress-bar]:bg-gray-800 [&::-webkit-progress-value]:bg-blue-500';
export function MemoUploadTile({ tr, upload, locale, max, retry, cancel }: MemoUploadTileProps): JSX.Element {
  const failed = upload.state === 'failed';
  const label = tr('uploading', { name: upload.name });
  return <div role="group" aria-label={label} className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-dashed border-gray-700 bg-gray-950/40 p-2">
    <p className="truncate text-xs text-gray-200" title={upload.name}>{upload.name}</p>
    <progress aria-label={label} value={upload.sent} max={upload.size || 1} className={BAR} />
    {failed
      ? <p role="alert" className="text-xs text-rose-300">{tr(`errors.${upload.error}`, { max })}</p>
      : <p className="text-xs text-gray-500">{upload.state === 'waiting' ? tr('uploadWaiting')
        : tr('uploadProgress', { sent: formatBytes(upload.sent, locale), total: formatBytes(upload.size, locale) })}</p>}
    <div className="flex justify-end gap-1">
      {failed && <MemoIconButton label={tr('uploadRetry')} onClick={retry}><IconRetry /></MemoIconButton>}
      <MemoIconButton label={tr('uploadCancel')} onClick={cancel}><IconX /></MemoIconButton>
    </div>
  </div>;
}
