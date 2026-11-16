import { useState, type JSX } from 'react';
import { MEMO } from '../config.js';
import { mediaKind } from '../media.js';
import type { MemoAttachment } from '../types.js';
import type { MemoAPI } from './api.js';
import { IconDownload, IconFile, IconFilm, IconMusic, IconPlay, IconX } from './icons.js';
import { formatBytes, formatDuration } from './listView.js';
import { MemoIconButton, type MemoText } from './ui.js';

interface MemoAttachmentTileProps {
  tr: MemoText; api: MemoAPI; noteId: string; asset: MemoAttachment; locale: string | undefined; locked: boolean;
  open: () => void; download: () => void; detach: () => void;
}
const FACE = 'relative flex h-28 w-full items-center justify-center overflow-hidden bg-gray-950/60';
export function MemoAttachmentTile({ tr, api, noteId, asset, locale, locked, open, download, detach }: MemoAttachmentTileProps): JSX.Element {
  const kind = mediaKind(asset.name, asset.mime);
  const [broken, setBroken] = useState(false);
  // 목록은 작은 미리보기만 그린다. 미리보기 없는 큰 원본을 여기서 통째로 디코드하지 않는다.
  const picture = broken || kind === 'file' || kind === 'audio' ? null
    : asset.thumb ? api.media(noteId, asset.id, 'thumb')
      : kind === 'image' && asset.size <= MEMO.previewMax ? api.media(noteId, asset.id) : null;
  const Fallback = kind === 'video' ? IconFilm : kind === 'audio' ? IconMusic : IconFile;
  const face = <>
    {picture
      ? <img src={picture} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      : <Fallback className="h-6 w-6 shrink-0 text-gray-600" />}
    {kind === 'video' && <span className="absolute inset-0 flex items-center justify-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-gray-50"><IconPlay className="h-4 w-4 shrink-0" /></span>
    </span>}
    {kind !== 'image' && asset.duration !== undefined && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] text-gray-100">{formatDuration(asset.duration)}</span>}
  </>;
  const label = tr('openMedia', { name: asset.name });
  return <div className="min-w-0 overflow-hidden rounded-xl border border-gray-800 bg-gray-950/40">
    {kind === 'file'
      ? <div className={FACE}>{face}</div>
      : <button type="button" onClick={open} title={label} aria-label={label}
        className={`${FACE} transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400`}>{face}</button>}
    <div className="flex items-center gap-1 px-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-gray-200" title={asset.name}>{asset.name}</p>
        <p className="text-xs text-gray-500">{formatBytes(asset.size, locale)}</p>
      </div>
      <MemoIconButton label={tr('download', { name: asset.name })} onClick={download}><IconDownload /></MemoIconButton>
      <MemoIconButton label={tr('detach', { name: asset.name })} tone="danger" disabled={locked} onClick={detach}><IconX /></MemoIconButton>
    </div>
  </div>;
}
