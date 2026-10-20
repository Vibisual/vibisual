import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExternalRef, LibItem, LibRequest } from '@vibisual/video';

import { StudioIcon } from './studioIcons.js';
import {
  deleteLib,
  importLibFile,
  importLibFromProject,
  importLibUrl,
  listLibs,
  rejectLibRequest,
  searchProjectLibFiles,
  vendorPack,
  type LibImportResult,
} from './studioApi.js';

/**
 * §5.13 (T-6)(T-10)(V) 37-11 — **[가져오기] 칸**(소재 서랍 아래): 라이브러리·글꼴·컴포지션 묶음을 사용자의 프로젝트에 들여놓는다.
 *
 * 쉬운 길 넷 — 끌어 놓기 · 파일 고르기 · https 주소 [받기](누를 때만 받는다) · 이 프로젝트의 의존성에서(`node_modules`). 에이전트의
 * 요청은 "에이전트가 이것을 가져오자고 합니다 — 이유" 와 [가져오기]·[거절]로 뜬다(들여놓는 손은 사람이다). HTML 한 장은 바깥에서
 * 부르는 것을 펼쳐 [모두 받기]·[골라 받기]·[받지 않기], 길이 선언이 없으면 길이를 묻고, 끝나면 그 묶음을 이 문서에 얹는다.
 * 라이선스는 찾은 것을 그대로 보여 주고 판단하지 않는다.
 */
export interface LibrariesPanelProps {
  readonly project: string;
  readonly disabled: boolean;
  readonly onError: (err: unknown) => void;
  /** 들여온 묶음(컴포지션 HTML — 프로젝트 기준 경로)을 이 문서에 얹는다. */
  readonly onAddPack: (relHtml: string, label: string) => void;
}

interface PendingPack {
  readonly item: LibItem;
  readonly refs: readonly ExternalRef[];
  readonly hasDuration: boolean;
}

const ACCEPT = '.js,.mjs,.css,.woff2,.woff,.ttf,.otf,.zip,.html,.htm';

function bytesLabel(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function LibrariesPanel(p: LibrariesPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [items, setItems] = useState<readonly LibItem[]>([]);
  const [requests, setRequests] = useState<readonly LibRequest[]>([]);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly { path: string; bytes: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPack | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [duration, setDuration] = useState('10');
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback((): void => {
    listLibs(p.project).then((l) => { setItems(l.items); setRequests(l.requests); }).catch(() => undefined);
  }, [p.project]);
  useEffect(() => { refresh(); }, [refresh]);

  // 의존성 찾기 — 두 글자부터, 잠깐 멈춘 뒤에.
  useEffect(() => {
    if (query.trim().length < 2) { setFound([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      searchProjectLibFiles(p.project, query.trim()).then((files) => { if (alive) setFound(files); }).catch(() => undefined);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, p.project]);

  const afterImport = (r: LibImportResult): void => {
    refresh();
    if (r.item.kind === 'pack') {
      if ((r.refs?.length ?? 0) > 0 || r.hasDuration === false) {
        setPending({ item: r.item, refs: r.refs ?? [], hasDuration: r.hasDuration ?? true });
        setPicked(new Set((r.refs ?? []).filter((x) => !x.inert).map((x) => x.url)));
      } else {
        p.onAddPack(`${r.item.folder}/${r.item.entry ?? 'index.html'}`, r.item.name);
      }
    }
  };

  const run = (job: () => Promise<LibImportResult>): void => {
    setBusy(true);
    job().then(afterImport).catch(p.onError).finally(() => setBusy(false));
  };

  const importFiles = (files: readonly File[]): void => {
    if (files.length === 0) return;
    setBusy(true);
    void (async () => {
      try {
        for (const file of files) afterImport(await importLibFile(p.project, file));
      } catch (err) { p.onError(err); } finally { setBusy(false); }
    })();
  };

  const finishPack = (urls: readonly string[]): void => {
    if (!pending) return;
    const seconds = Number(duration);
    const needDuration = !pending.hasDuration && Number.isFinite(seconds) && seconds > 0;
    if (urls.length === 0 && !needDuration) {
      p.onAddPack(`${pending.item.folder}/${pending.item.entry ?? 'index.html'}`, pending.item.name);
      setPending(null);
      return;
    }
    setBusy(true);
    vendorPack(p.project, pending.item.id, urls, needDuration ? seconds : undefined)
      .then((r) => {
        if (r.failed.length > 0) p.onError(new Error(r.failed.map((f) => `${f.url}: ${f.error}`).join('\n')));
        p.onAddPack(r.path, pending.item.name);
        setPending(null);
        refresh();
      })
      .catch(p.onError)
      .finally(() => setBusy(false));
  };

  const openRequests = requests.filter((r) => r.status === 'pending');
  return (
    <section className="flex flex-col gap-2.5 border-t border-white/10 p-3" aria-label={t('panel.videoStudio.libs.title')}>
      <h3 className="text-[12px] font-semibold text-slate-400">{t('panel.videoStudio.libs.title')}</h3>
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-white/20 px-2 py-3 text-center text-[12px] text-slate-400"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (!p.disabled && !busy) importFiles(Array.from(e.dataTransfer.files)); }}>
        <StudioIcon name="upload" />
        <span>{t('panel.videoStudio.libs.drop')}</span>
        <button type="button" disabled={p.disabled || busy} onClick={() => input.current?.click()}
          className="rounded-md border border-white/15 px-2 py-0.5 text-[12px] text-slate-200 hover:bg-white/10 disabled:opacity-40 pointer-coarse:px-3 pointer-coarse:py-2">{t('panel.videoStudio.libs.pick')}</button>
        <input ref={input} type="file" multiple className="hidden" accept={ACCEPT} aria-label={t('panel.videoStudio.libs.pick')}
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; importFiles(files); }} />
      </div>
      <div className="flex gap-1.5">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="https://…" aria-label={t('panel.videoStudio.libs.url')}
          className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
        <button type="button" disabled={p.disabled || busy || !/^https:\/\//i.test(url.trim())} onClick={() => { const u = url.trim(); setUrl(''); run(() => importLibUrl(p.project, u)); }}
          className="shrink-0 rounded-md border border-white/15 px-2 text-[12px] text-slate-200 hover:bg-white/10 disabled:opacity-40">{t('panel.videoStudio.libs.download')}</button>
      </div>
      <div className="flex flex-col gap-1">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t('panel.videoStudio.libs.fromProject')} aria-label={t('panel.videoStudio.libs.fromProject')}
          className="h-7 rounded-md border border-white/10 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
        {found.slice(0, 12).map((f) => (
          <button key={f.path} type="button" disabled={p.disabled || busy} onClick={() => run(() => importLibFromProject(p.project, f.path))} title={f.path}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40 pointer-coarse:py-2">
            <StudioIcon name="plus" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="min-w-0 flex-1 truncate">{f.path.replace(/^node_modules\//, '')}</span>
            <span className="shrink-0 tabular-nums text-slate-500">{bytesLabel(f.bytes)}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.libs.licenseNote')}</p>

      {pending ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/15 p-2">
          <p className="text-[12px] font-semibold text-slate-200">{t('panel.videoStudio.libs.refsTitle', { name: pending.item.name, count: pending.refs.length })}</p>
          {pending.refs.map((ref) => (
            <label key={ref.url} className="flex items-start gap-1.5 text-[12px] text-slate-300">
              <input type="checkbox" className="mt-0.5 shrink-0 pointer-coarse:h-5 pointer-coarse:w-5" disabled={ref.inert === true} checked={picked.has(ref.url)}
                onChange={(e) => setPicked((s) => { const next = new Set(s); if (e.target.checked) next.add(ref.url); else next.delete(ref.url); return next; })} />
              <span className="min-w-0 flex-1 break-all">
                <span className="text-slate-500">{t(`panel.videoStudio.libs.kind_${ref.kind}`)} · </span>{ref.url}
                {ref.inert ? <span className="block text-slate-500">{t('panel.videoStudio.libs.inert')}</span> : null}
              </span>
            </label>
          ))}
          {!pending.hasDuration ? (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-300">
              <span>{t('panel.videoStudio.libs.duration')}</span>
              <input value={duration} onChange={(e) => setDuration(e.target.value)} onKeyDown={(e) => e.stopPropagation()} inputMode="decimal" aria-label={t('panel.videoStudio.libs.duration')}
                className="h-6 w-16 rounded border border-white/10 bg-vb-sunken px-1.5 text-right tabular-nums text-slate-100 outline-none pointer-coarse:h-9" />
              <span className="text-slate-500">s</span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={busy} onClick={() => finishPack(pending.refs.filter((x) => !x.inert).map((x) => x.url))}
              className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[12px] font-semibold text-slate-50 hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.libs.vendorAll')}</button>
            <button type="button" disabled={busy || picked.size === 0} onClick={() => finishPack([...picked])}
              className="rounded-md border border-white/15 px-2 py-1 text-[12px] text-slate-200 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.libs.vendorPicked')}</button>
            <button type="button" disabled={busy} onClick={() => finishPack([])}
              className="rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.libs.vendorNone')}</button>
          </div>
        </div>
      ) : null}

      {openRequests.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {openRequests.map((r) => (
            <div key={r.id} className="rounded-lg border border-white/15 p-2 text-[12px]">
              <p className="text-slate-200">{t('panel.videoStudio.libs.request')}</p>
              <p className="break-all text-slate-400">{r.url}</p>
              {r.reason ? <p className="mt-0.5 text-slate-500">{r.reason}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button type="button" disabled={p.disabled || busy} onClick={() => run(() => importLibUrl(p.project, r.url, r.id))}
                  className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-slate-50 hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.libs.accept')}</button>
                <button type="button" disabled={busy} onClick={() => { void rejectLibRequest(p.project, r.id).then(refresh).catch(p.onError); }}
                  className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.libs.reject')}</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.04]">
              <StudioIcon name={item.kind === 'font' ? 'text' : item.kind === 'pack' ? 'film' : 'code'} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-slate-200">{item.name}{item.version ? ` ${item.version}` : ''}</span>
                <span className="block text-[12px] text-slate-500">
                  {t(`panel.videoStudio.libs.kind_${item.kind}`)} · {bytesLabel(item.bytes)} · {item.license ?? t('panel.videoStudio.libs.noLicense')}
                </span>
              </span>
              {item.kind === 'pack' ? (
                <button type="button" disabled={p.disabled} onClick={() => p.onAddPack(`${item.folder}/${item.entry ?? 'index.html'}`, item.name)} title={t('panel.videoStudio.libs.addPack')} aria-label={t('panel.videoStudio.libs.addPack')}
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:p-2"><StudioIcon name="plus" className="h-3.5 w-3.5" /></button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => { void deleteLib(p.project, item.id).then(refresh).catch(p.onError); }} title={t('panel.videoStudio.libs.remove')} aria-label={t('panel.videoStudio.libs.remove')}
                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:p-2"><StudioIcon name="trash" className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
