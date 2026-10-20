import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocStyle, StyleCandidates, VideoDoc } from '@vibisual/video';

import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon } from './studioIcons.js';
import { ValueControl } from './StudioValueControls.js';
import { confirmStyle, readStyle, scanStyle } from './studioApi.js';
import { useProjectFileUrl } from './useProjectFileUrl.js';

/**
 * §5.13 (V) 37-10 — **스타일 서랍**: 이 프로젝트를 아는 영상. [프로젝트에서 찾기]가 색(CSS 변수·tailwind)·글꼴·로고 후보를 훑어
 * 카드로 제안하고, 사람이 칸마다 고른 뒤 **[확정]**(프로젝트의 스타일 카드 — 새 문서가 이것으로 태어난다). [이 영상에 적용]이
 * 지금 문서에 그 한 벌을 적는다(되돌릴 수 있는 평소 편집). 모든 컴포지션은 `--vibi-*` 변수로, 기본 씬·글자는 기본값으로 따른다.
 */
export interface StyleDrawerProps {
  readonly project: string;
  readonly doc: VideoDoc;
  readonly disabled: boolean;
  readonly onApply: (style: DocStyle) => void;
  readonly onError: (err: unknown) => void;
  readonly onConfirmed: () => void;
}

type Slot = 'accent' | 'bg' | 'fg' | 'muted';
const SLOTS: readonly Slot[] = ['accent', 'bg', 'fg', 'muted'];

function sameStyle(a: DocStyle | null | undefined, b: DocStyle | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function Swatches({ style }: { readonly style: DocStyle }): React.JSX.Element {
  return (
    <span className="flex -space-x-1">
      {SLOTS.map((s) => <span key={s} className="h-5 w-5 rounded-full border border-white/20" style={{ background: style[s] }} title={style[s]} />)}
    </span>
  );
}

function LogoPreview({ project, path }: { readonly project: string; readonly path: string | undefined }): React.JSX.Element | null {
  const url = useProjectFileUrl(project, path ?? null);
  if (!path) return null;
  return (
    <span className="flex h-10 w-16 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/40">
      {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} /> : <StudioIcon name="logo" className="h-4 w-4 text-slate-500" />}
    </span>
  );
}

export function StyleDrawer(p: StyleDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<DocStyle | null>(null);
  const [candidates, setCandidates] = useState<StyleCandidates | null>(null);
  const [draft, setDraft] = useState<DocStyle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    readStyle(p.project).then((s) => { if (alive) setCurrent(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [p.project]);

  const scan = (): void => {
    setScanning(true);
    scanStyle(p.project)
      .then((r) => { setCandidates(r.candidates); setDraft(r.current ?? r.suggestion); })
      .catch(p.onError)
      .finally(() => setScanning(false));
  };

  const confirm = (): void => {
    if (!draft) return;
    setSaving(true);
    confirmStyle(p.project, draft)
      .then((s) => { setCurrent(s); setDraft(s); p.onConfirmed(); })
      .catch(p.onError)
      .finally(() => setSaving(false));
  };

  const applied = sameStyle(p.doc.style, current);
  return (
    <ScrollFade fill className="flex-1">
      <div className="flex flex-col gap-4 p-3">
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.style.current')}</h3>
          {current ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-white/10 p-2">
              <Swatches style={current} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300" style={current.fontFamily ? { fontFamily: current.fontFamily } : undefined}>
                {current.fontFamily ?? t('panel.videoStudio.style.noFont')}
              </span>
              <LogoPreview project={p.project} path={current.logo} />
            </div>
          ) : <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.style.none')}</p>}
          {current ? (
            <button type="button" disabled={p.disabled || applied} onClick={() => p.onApply(current)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-white/15 px-2 py-1.5 text-[12px] text-slate-100 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2.5">
              <StudioIcon name="check" className="h-3.5 w-3.5" />{applied ? t('panel.videoStudio.style.applied') : t('panel.videoStudio.style.apply')}
            </button>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.style.fromProject')}</h3>
            <button type="button" disabled={scanning} onClick={scan}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2">
              <StudioIcon name="folder" className="h-3.5 w-3.5" />{scanning ? t('panel.videoStudio.style.scanning') : t('panel.videoStudio.style.scan')}
            </button>
          </div>
          {candidates && draft ? (
            <>
              {candidates.partial ? <p className="text-[12px] text-slate-500">{t('panel.videoStudio.style.partial', { count: candidates.scannedFiles })}</p> : null}
              {SLOTS.map((slot) => (
                <div key={slot} className="flex flex-col gap-1">
                  <span className="text-[12px] text-slate-400">{t(`panel.videoStudio.style.slot_${slot}`)}</span>
                  <ValueControl disabled={false} field={{ key: slot, type: 'color', label: t(`panel.videoStudio.style.slot_${slot}`), value: draft[slot] }}
                    onChange={(v) => setDraft((d) => (d ? { ...d, [slot]: String(v) } : d))} />
                  {candidates.colors.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {candidates.colors.slice(0, 12).map((c) => (
                        <button key={c.value} type="button" onClick={() => setDraft((d) => (d ? { ...d, [slot]: c.value } : d))}
                          title={`${c.name ?? c.value} · ${c.source}`} aria-label={c.name ?? c.value}
                          className={`h-5 w-5 rounded-full border pointer-coarse:h-8 pointer-coarse:w-8 ${draft[slot] === c.value ? 'border-transparent ring-2 ring-[var(--vs-accent)]' : 'border-white/20'}`} style={{ background: c.value }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-slate-400">{t('panel.videoStudio.style.font')}</span>
                <select value={draft.fontFamily ?? ''} onChange={(e) => {
                  const font = candidates.fonts.find((f) => f.family === e.target.value);
                  setDraft((d) => {
                    if (!d) return d;
                    const { fontFamily: _f, fontFile: _ff, ...rest } = d;
                    return font ? { ...rest, fontFamily: font.family, ...(font.file ? { fontFile: font.file } : {}) } : rest;
                  });
                }} onKeyDown={(e) => e.stopPropagation()}
                  className="h-7 min-w-0 rounded-md border border-white/10 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9">
                  <option value="">{t('panel.videoStudio.style.noFont')}</option>
                  {candidates.fonts.map((f) => <option key={f.family} value={f.family}>{f.family}{f.file ? ` · ${t('panel.videoStudio.style.fontFile')}` : ''}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-slate-400">{t('panel.videoStudio.style.logo')}</span>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setDraft((d) => { if (!d) return d; const { logo: _l, ...rest } = d; return rest; })}
                    className={`flex h-10 w-16 items-center justify-center rounded-md border text-[12px] text-slate-500 ${!draft.logo ? 'border-transparent ring-2 ring-[var(--vs-accent)]' : 'border-white/10'}`}>
                    {t('panel.videoStudio.style.noLogo')}
                  </button>
                  {candidates.logos.map((l) => (
                    <button key={l.path} type="button" title={l.path} onClick={() => setDraft((d) => (d ? { ...d, logo: l.path } : d))}
                      className={`rounded-md ${draft.logo === l.path ? 'ring-2 ring-[var(--vs-accent)]' : ''}`}>
                      <LogoPreview project={p.project} path={l.path} />
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" disabled={saving} onClick={confirm}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-slate-50 ring-1 ring-[var(--vs-accent)] hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2.5">
                <StudioIcon name="check" className="h-3.5 w-3.5" />{t('panel.videoStudio.style.confirm')}
              </button>
            </>
          ) : <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.style.scanHint')}</p>}
        </section>
      </div>
    </ScrollFade>
  );
}
