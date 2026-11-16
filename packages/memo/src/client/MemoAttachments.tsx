import { useEffect, useRef, useState, type JSX } from 'react';
import { MEMO } from '../config.js';
import type { MemoClientHost } from '../host.js';
import { mediaKind } from '../media.js';
import type { MemoAttachment } from '../types.js';
import type { MemoAPI } from './api.js';
import { formatBytes } from './listView.js';
import { MemoAttachmentTile } from './MemoAttachmentTile.js';
import { MemoMediaViewer } from './MemoMediaViewer.js';
import { MemoUploadTile } from './MemoUploadTile.js';
import type { MemoText } from './ui.js';
import type { MemoUpload } from './uploads.js';

export interface MemoMediaActions {
  uploads: readonly MemoUpload[]; retry: (id: string) => void; cancel: (id: string) => void;
  download: (asset: MemoAttachment) => void; detach: (id: string) => void;
}
interface MemoAttachmentsProps {
  tr: MemoText; api: MemoAPI; host: MemoClientHost; noteId: string; attachments: MemoAttachment[]; locale: string | undefined; locked: boolean; media: MemoMediaActions;
}
export function MemoAttachments({ tr, api, host, noteId, attachments, locale, locked, media }: MemoAttachmentsProps): JSX.Element {
  const [viewing, setViewing] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null); const shown = useRef(0);
  const uploads = media.uploads.filter(upload => upload.noteId === noteId);
  // 붙인 직후의 진행 상황이 화면 밖에 남지 않게 한다.
  useEffect(() => {
    if (uploads.length > shown.current) section.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    shown.current = uploads.length;
  }, [uploads.length]);
  const playable = attachments.filter(asset => ['video', 'audio'].includes(mediaKind(asset.name, asset.mime)));
  const image = attachments.find(asset => asset.id === viewing && mediaKind(asset.name, asset.mime) === 'image');
  const ImageEditor = host.ImageEditor;
  useEffect(() => { if (viewing && !attachments.some(asset => asset.id === viewing)) setViewing(null); }, [viewing, attachments]);
  const open = (asset: MemoAttachment): void => {
    if (mediaKind(asset.name, asset.mime) === 'image' && !ImageEditor) { media.download(asset); return; }
    setViewing(asset.id);
  };
  const max = formatBytes(MEMO.attachmentMax, locale);
  return <section ref={section} className="space-y-2" aria-label={tr('attachments')}>
    <h2 className="text-xs font-semibold text-gray-400">{tr('attachments')}</h2>
    {attachments.length + uploads.length > 0 && <div className="grid grid-cols-3 gap-2 box-compact:grid-cols-2 box-narrow:grid-cols-1">
      {attachments.map(asset => <MemoAttachmentTile key={asset.id} tr={tr} api={api} noteId={noteId} asset={asset} locale={locale} locked={locked}
        open={() => open(asset)} download={() => media.download(asset)} detach={() => media.detach(asset.id)} />)}
      {uploads.map(upload => <MemoUploadTile key={upload.id} tr={tr} upload={upload} locale={locale} max={max}
        retry={() => media.retry(upload.id)} cancel={() => media.cancel(upload.id)} />)}
    </div>}
    <p className="text-xs text-gray-500">{tr('attachmentHint', { max })}</p>
    {image && ImageEditor && <ImageEditor key={image.id} src={api.media(noteId, image.id)} close={() => setViewing(null)} />}
    {viewing && !image && <MemoMediaViewer tr={tr} api={api} noteId={noteId} items={playable} start={viewing} locale={locale}
      download={media.download} close={() => setViewing(null)} />}
  </section>;
}
