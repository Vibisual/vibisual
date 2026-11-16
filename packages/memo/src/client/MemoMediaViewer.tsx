import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';
import { mediaKind } from '../media.js';
import type { MemoAttachment } from '../types.js';
import type { MemoAPI } from './api.js';
import { IconChevronLeft, IconChevronRight, IconDownload } from './icons.js';
import { formatBytes } from './listView.js';
import { MemoDialog } from './MemoDialog.js';
import { MemoIconButton, type MemoText } from './ui.js';

interface MemoMediaViewerProps {
  tr: MemoText; api: MemoAPI; noteId: string; items: readonly MemoAttachment[]; start: string; locale: string | undefined;
  download: (asset: MemoAttachment) => void; close: () => void;
}
/** 원본을 크게 본다. 요소가 스트리밍 주소를 직접 읽어, 닫으면 받던 구간도 거기서 멈춘다. */
export function MemoMediaViewer({ tr, api, noteId, items, start, locale, download, close }: MemoMediaViewerProps): JSX.Element | null {
  const [id, setId] = useState(start); const [broken, setBroken] = useState(false);
  const index = items.findIndex(item => item.id === id); const asset = items[index];
  useEffect(() => { setBroken(false); }, [id]);
  // 보던 첨부가 떼어지면 닫는다.
  useEffect(() => { if (!asset) close(); }, [asset, close]);
  if (!asset) return null;
  const kind = mediaKind(asset.name, asset.mime); const url = api.media(noteId, asset.id);
  const step = (delta: number): void => { const next = items[(index + delta + items.length) % items.length]; if (next) setId(next.id); };
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 영상·소리에 초점이 있으면 화살표는 그 재생 위치의 것이다.
    if (items.length < 2 || event.target instanceof HTMLMediaElement) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  };
  const size = asset.width && asset.height ? `${formatBytes(asset.size, locale)} · ${asset.width}×${asset.height}` : formatBytes(asset.size, locale);
  return <MemoDialog wide title={asset.name} closeLabel={tr('close')} close={close}>
    <div onKeyDown={keys} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-[30vh] items-center justify-center overflow-hidden rounded-xl bg-black/40">
        {broken ? <p role="alert" className="p-6 text-center text-sm text-gray-400">{tr('mediaUnplayable')}</p>
          : kind === 'video' ? <video key={asset.id} src={url} controls autoPlay playsInline preload="metadata" onError={() => setBroken(true)}
              {...(asset.thumb ? { poster: api.media(noteId, asset.id, 'thumb') } : {})} className="max-h-[70vh] w-full bg-black" />
              : <audio key={asset.id} src={url} controls autoPlay preload="metadata" onError={() => setBroken(true)} className="m-6 w-full" />}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-400">
        {items.length > 1 && <>
          <MemoIconButton label={tr('previousMedia')} onClick={() => step(-1)}><IconChevronLeft /></MemoIconButton>
          <span>{tr('mediaPosition', { index: index + 1, count: items.length })}</span>
          <MemoIconButton label={tr('nextMedia')} onClick={() => step(1)}><IconChevronRight /></MemoIconButton>
        </>}
        <span className="min-w-0 flex-1 truncate text-right">{size}</span>
        <MemoIconButton label={tr('download', { name: asset.name })} onClick={() => download(asset)}><IconDownload /></MemoIconButton>
      </div>
    </div>
  </MemoDialog>;
}
