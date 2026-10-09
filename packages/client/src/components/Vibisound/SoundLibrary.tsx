import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClipTime, type AudioDoc } from '@vibisual/audio';
import { SoundButton } from './SoundButton.js';
import { SOUND_ACCEPT } from './soundConfig.js';
import type { SoundSummary } from './soundApi.js';

interface Props {
  doc: AudioDoc | null; docs: readonly SoundSummary[]; disabled: boolean;
  open: (id: string) => Promise<void>; create: () => Promise<void>;
  importFiles: (files: readonly (File | string)[]) => Promise<void>;
}
export function SoundLibrary({ doc, docs, disabled, open, create, importFiles }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string): string => t(`panel.vibisound.workbench.${key}`);
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState('');
  return <section className="space-y-4 p-3">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{tr('library')}</h2>
    <div className="flex flex-wrap gap-2">
      <SoundButton disabled={disabled} onClick={() => void create()}>{tr('newProject')}</SoundButton>
      <SoundButton accent disabled={disabled} onClick={() => input.current?.click()}>{tr('import')}</SoundButton>
      <input ref={input} type="file" multiple accept={SOUND_ACCEPT} className="hidden" aria-label={tr('import')} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files);
      }} />
    </div>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (path.trim()) void importFiles([path.trim()]); }}>
      <label className="block text-xs text-slate-400">{tr('importPath')}
        <input value={path} onChange={event => setPath(event.target.value)} disabled={disabled} placeholder={tr('pathPlaceholder')} className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs text-slate-200" />
      </label>
      <SoundButton type="submit" disabled={disabled || !path.trim()}>{tr('import')}</SoundButton>
    </form>
    <label className="block text-xs text-slate-400">{tr('recent')}
      <select className="mt-1 w-full rounded border border-white/10 bg-slate-900 p-2 text-xs text-slate-200" value={doc?.id ?? ''} disabled={disabled} onChange={event => { if (event.target.value) void open(event.target.value); }}>
        <option value="" disabled>{tr('selectHint')}</option>
        {docs.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
      </select>
    </label>
    <div className="space-y-2">
      {Object.values(doc?.assets ?? {}).map(asset => <div key={asset.id} className="rounded border border-white/5 bg-white/[0.02] p-2">
        <p className="truncate text-xs text-slate-200" title={asset.name}>{asset.name}</p>
        <p className="mt-1 text-xs tabular-nums text-slate-500">{formatClipTime(asset.duration)} · {asset.sampleRate.toLocaleString()} Hz · {asset.channels === 1 ? '1 ch' : '2 ch'}</p>
      </div>)}
      {!Object.keys(doc?.assets ?? {}).length && <p className="text-xs leading-relaxed text-slate-500">{tr('noSources')}</p>}
    </div>
    <p className="text-xs leading-relaxed text-slate-500">{tr('drop')}</p>
  </section>;
}
