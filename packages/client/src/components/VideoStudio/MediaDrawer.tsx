import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoAsset, VideoDoc } from '@vibisual/video';

import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { mediaKindKey } from './kindLabels.js';

/**
 * §5.13 (V) 37-1 — **소재 서랍**(종전 라이브러리의 '가져오기'·'프로젝트 미디어' 를 옮겼다). 미디어·SRT 가져오기(프로젝트에
 * 복사 — (U)), 문서의 소재 목록(찾기) — 누르면 재생 머리 자리에 얹는다. (T-6) 라이브러리·글꼴 가져오기는 아래 `libraries` 칸.
 */
export interface MediaDrawerProps {
  readonly doc: VideoDoc;
  readonly disabled: boolean;
  readonly importing: boolean;
  readonly onImport: (files: readonly File[]) => void;
  readonly onAddAsset: (asset: VideoAsset) => void;
  /** (T-6)(T-10) 가져오기 칸 — 3라운드가 채운다. */
  readonly libraries?: ReactNode;
}

const KIND_ICON: Readonly<Record<string, StudioIconName>> = { video: 'film', model: 'media', audio: 'music', image: 'image', composition: 'code', font: 'text' };

function assetPath(asset: VideoAsset): string {
  return asset.source.kind === 'file' ? asset.source.path : asset.source.output;
}

export function MediaDrawer(p: MediaDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const items = p.doc.tracks.flatMap((track) => track.items);
  const label = (asset: VideoAsset): string => items.find((item) => item.assetId === asset.id)?.label ?? assetPath(asset).split(/[\\/]/).pop() ?? asset.id;
  const q = query.trim().toLowerCase();
  const assets = Object.values(p.doc.assets)
    .filter((a) => a.kind !== 'font')
    .filter((a) => q === '' || label(a).toLowerCase().includes(q) || assetPath(a).toLowerCase().includes(q));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-white/10 p-3"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (!p.disabled) p.onImport(Array.from(e.dataTransfer.files)); }}>
        <button type="button" disabled={p.disabled} onClick={() => input.current?.click()}
          className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 text-[12px] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40">
          <StudioIcon name="upload" />
          {p.importing ? t('panel.videoStudio.media.importing') : t('panel.videoStudio.media.import')}
        </button>
        <input ref={input} type="file" multiple className="hidden" aria-label={t('panel.videoStudio.media.import')}
          accept=".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.flac,.aac,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.srt,.vtt,.glb,.gltf,.bin,.vibi3d,.vibimage"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; p.onImport(files); }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
          aria-label={t('panel.videoStudio.media.search')} placeholder={t('panel.videoStudio.media.search')}
          className="h-8 rounded-md border border-white/10 bg-vb-sunken px-2 text-[12px] text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-[var(--vs-accent)]" />
      </div>
      <ScrollFade fill className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {assets.length === 0 ? <p className="px-2 py-3 text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.media.empty')}</p> : null}
          {assets.map((asset) => (
            <button key={asset.id} type="button" disabled={p.disabled} onClick={() => p.onAddAsset(asset)} title={assetPath(asset)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.06] disabled:opacity-40">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-slate-400">
                <StudioIcon name={KIND_ICON[asset.kind] ?? 'media'} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-slate-200">{label(asset)}</span>
                <span className="block text-[12px] tabular-nums text-slate-500">
                  {t(mediaKindKey(asset.kind))}{asset.duration !== undefined ? ` · ${asset.duration.toFixed(1)}s` : ''}
                </span>
              </span>
              <StudioIcon name="plus" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
          ))}
        </div>
        {p.libraries ?? null}
      </ScrollFade>
    </div>
  );
}
