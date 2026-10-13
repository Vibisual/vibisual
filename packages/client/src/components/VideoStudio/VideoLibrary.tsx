import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoAsset, VideoDoc } from '@vibisual/video';
import { ScrollFade } from '../ScrollFade.js';

export interface VideoLibraryProps {
  doc: VideoDoc; disabled: boolean;
  onAddScene: (scene: string) => void;
  onAddText: () => void; onAddShape: () => void;
  onAddAsset: (asset: VideoAsset) => void;
  onImport: (files: readonly File[]) => Promise<void>;
  /** §5.13 (T-5) — 코드 컴포지션 뼈대를 만들어 재생 머리 자리에 올린다(코드는 사람이나 에이전트가 채운다). */
  onAddComposition?: () => void;
}
const SCENES = ['title', 'lowerThird', 'bulletList', 'codeBlock', 'quote', 'solid'] as const;
const TONES = ['from-violet-600/70', 'from-cyan-600/70', 'from-emerald-600/70', 'from-slate-600/70', 'from-rose-600/70', 'from-blue-600/70'];
const BUTTON = 'rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-xs hover:border-violet-400/70 hover:bg-violet-500/10 disabled:opacity-40';

export function VideoLibrary({ doc, disabled, onAddScene, onAddText, onAddShape, onAddAsset, onImport, onAddComposition }: VideoLibraryProps): React.JSX.Element {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const assets = Object.values(doc.assets).filter(asset => asset.kind !== 'font');
  const assetLabel = (asset: VideoAsset): string => {
    const used = doc.tracks.flatMap(track => track.items).find(item => item.assetId === asset.id);
    const path = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
    return used?.label ?? path.split(/[\\/]/).pop() ?? asset.id;
  };
  return <aside className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-gray-900/50">
    <div className="border-b border-white/10 p-3">
      <h2 className="mb-3 text-xs font-semibold">{t('panel.videoStudio.editor.library', { defaultValue: 'Library' })}</h2>
      <button type="button" className={`${BUTTON} w-full bg-violet-500/15 text-violet-200`} disabled={disabled} onClick={() => input.current?.click()}>
        {t('panel.videoStudio.editor.importMedia', { defaultValue: 'Import media / SRT' })}
      </button>
      <input ref={input} type="file" multiple className="hidden" aria-label={t('panel.videoStudio.editor.importMedia', { defaultValue: 'Import media / SRT' })}
        accept=".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.flac,.aac,.png,.jpg,.jpeg,.webp,.gif,.avif,.srt,.vtt"
        onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void onImport(files); }} />
    </div>
    <ScrollFade fill>
      <div className="space-y-4 p-3">
        <section className="space-y-2">
          <h3 className="text-xs text-white/50">{t('panel.videoStudio.editor.scenes', { defaultValue: 'Motion scenes' })}</h3>
          <div className="grid grid-cols-2 gap-2">{SCENES.map((scene, index) => <button key={scene} type="button" disabled={disabled} onClick={() => onAddScene(scene)} className={`${BUTTON} flex min-h-16 items-end bg-gradient-to-br ${TONES[index]} to-transparent px-2`}>
            {t(`panel.videoStudio.editor.scene_${scene}`, { defaultValue: scene })}
          </button>)}</div>
          <div className="grid grid-cols-2 gap-2">
            <button className={BUTTON} type="button" disabled={disabled} onClick={onAddText}>{t('panel.videoStudio.editor.addText', { defaultValue: 'Text' })}</button>
            <button className={BUTTON} type="button" disabled={disabled} onClick={onAddShape}>{t('panel.videoStudio.editor.addShape', { defaultValue: 'Shape' })}</button>
          </div>
          {onAddComposition ? (
            <button className={`${BUTTON} flex w-full items-center gap-2 border-indigo-400/30 bg-indigo-500/10`} type="button" disabled={disabled} onClick={onAddComposition}
              title={t('panel.videoStudio.editor.addCompositionHint', { defaultValue: 'Motion graphics written as HTML/CSS/JS. Ask the AI to write it, or edit the file yourself.' })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-indigo-300" aria-hidden="true">
                <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
              </svg>
              <span>{t('panel.videoStudio.editor.addComposition', { defaultValue: 'Code composition' })}</span>
            </button>
          ) : null}
        </section>
        <section className="space-y-2">
          <h3 className="text-xs text-white/50">{t('panel.videoStudio.editor.assets', { defaultValue: 'Project media' })}</h3>
          <input className="w-full rounded border border-white/10 bg-gray-950 px-2 py-1.5 text-xs" value={query} onChange={e => setQuery(e.target.value)}
            aria-label={t('panel.videoStudio.editor.searchMedia', { defaultValue: 'Search media' })} placeholder={t('panel.videoStudio.editor.searchMedia', { defaultValue: 'Search media' })} />
          {assets.length === 0 && <p className="text-xs leading-relaxed text-white/40">{t('panel.videoStudio.editor.mediaHint', { defaultValue: 'Import video, images, audio, or SRT captions. Files are copied into this project.' })}</p>}
          {assets.filter(asset => assetLabel(asset).toLowerCase().includes(query.toLowerCase()) || (asset.source.kind === 'file' ? asset.source.path : asset.source.output).toLowerCase().includes(query.toLowerCase())).map(asset => {
            const path = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
            const label = assetLabel(asset);
            return <button key={asset.id} className={`${BUTTON} block w-full`} type="button" disabled={disabled} onClick={() => onAddAsset(asset)} title={path}>
              <span className="block truncate">{label}</span>
              <span className="mt-1 block text-white/40">{t(`panel.videoStudio.editor.media_${asset.kind}`, { defaultValue: asset.kind })}{asset.duration !== undefined ? ` · ${asset.duration.toFixed(1)}s` : ''}</span>
            </button>;
          })}
        </section>
      </div>
    </ScrollFade>
  </aside>;
}
