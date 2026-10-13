import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrchestraPreparation } from '@vibisual/shared';
import { START_LENGTH_CHOICES, VIDEO_FORMAT_IDS, formatRatioLabel, type VideoEngineKind, type VideoFormatId, type VideoRecipe } from '@vibisual/video';

import { IME_ENTER_OWNER } from '../../utils/inputComposition.js';
import { useEnterSubmit } from '../../hooks/useEnterSubmit.js';
import { EngineIcon } from '../Engine/engineIcons.js';
import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { StudioSteps } from './StudioSteps.js';
import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-2 — **한 줄로 시작**. 빈 트랙 대신 "무엇을 만들까요?" 입력창, 그 아래 레시피 위성 한 줄, 판형·길이·엔진 칩, 소재를
 * 끌어 놓는 자리, 최근 영상. 보내면 셸이 문서를 만들고(없으면) 영상용 에이전트를 잇고 기획 바퀴를 보낸다.
 */
export interface StartMaterial {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface StudioStartProps {
  readonly recipes: readonly VideoRecipe[];
  readonly recipeId: string | null;
  readonly onRecipe: (id: string | null) => void;
  readonly prompt: string;
  readonly onPrompt: (text: string) => void;
  readonly format: VideoFormatId;
  readonly onFormat: (format: VideoFormatId) => void;
  readonly length: number;
  readonly onLength: (seconds: number) => void;
  readonly engine: VideoEngineKind;
  readonly onEngine: (engine: VideoEngineKind) => void;
  readonly preparation: Readonly<Record<VideoEngineKind, OrchestraPreparation | null>>;
  readonly onPrepare: (engine: VideoEngineKind) => void;
  /** 이 창에 설치·로그인 창이 없다(분리된 앱 창) — 준비는 메인 창에서. */
  readonly prepareElsewhere: boolean;
  readonly materials: readonly StartMaterial[];
  readonly onAddMaterials: (files: readonly File[]) => void;
  readonly onRemoveMaterial: (id: string) => void;
  readonly recent: readonly DocSummary[];
  readonly onOpenDoc: (id: string) => void;
  readonly onSubmit: (liveText?: string) => void;
  readonly busy: boolean;
}

const RECIPE_ICONS: Readonly<Record<string, StudioIconName>> = {
  'app-intro': 'appIntro', changelog: 'changelog', 'data-story': 'dataStory', 'caption-shorts': 'captions',
  'kinetic-text': 'kinetic', 'photo-slideshow': 'slideshow', 'logo-reveal': 'logo', blank: 'blank',
};
const ENGINES: readonly VideoEngineKind[] = ['claude', 'codex'];
const CHIP = 'flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors duration-150 ease-out disabled:opacity-40';

function chip(active: boolean): string {
  return `${CHIP} ${active ? 'border-transparent bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'border-white/15 text-slate-300 hover:bg-white/10'}`;
}

export function StudioStart(p: StudioStartProps): React.JSX.Element {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const onEnter = useEnterSubmit((live) => p.onSubmit(live));
  const recipe = p.recipes.find((r) => r.id === p.recipeId) ?? null;
  const prep = p.preparation[p.engine];
  const canSend = !p.busy && (recipe?.direct === true || p.prompt.trim() !== '' || recipe !== null) && (recipe?.direct === true || prep === null);
  return (
    <ScrollFade fill className="flex-1">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center gap-6 px-6 py-10"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files); if (files.length > 0) p.onAddMaterials(files); }}>
        <StudioSteps step={0} />
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-50">{t('panel.videoStudio.start.ask')}</h1>
        <div className="w-full rounded-2xl border border-white/10 bg-vb-card p-3 shadow-lg shadow-black/20 focus-within:ring-1 focus-within:ring-[var(--vs-accent)]">
          <textarea
            {...IME_ENTER_OWNER}
            autoFocus
            rows={3}
            value={p.prompt}
            onChange={(e) => p.onPrompt(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); onEnter(e); }}
            placeholder={recipe ? t(`panel.videoStudio.recipes.${recipe.id}.placeholder`) : t('panel.videoStudio.start.placeholder')}
            aria-label={t('panel.videoStudio.start.ask')}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-500"
          />
          {p.materials.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.materials.map((m) => (
                <span key={m.id} className="flex max-w-56 items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] py-0.5 pl-2.5 pr-1 text-[12px] text-slate-200">
                  <span className="truncate">{m.name}</span>
                  <button type="button" onClick={() => p.onRemoveMaterial(m.id)} aria-label={t('panel.videoStudio.removeNamed', { name: m.name })}
                    className="rounded-full p-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"><StudioIcon name="close" className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100">
              <StudioIcon name="attach" />{t('panel.videoStudio.start.materials')}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" aria-label={t('panel.videoStudio.start.materials')}
              accept=".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.flac,.aac,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.srt,.vtt,.csv,.tsv,.json"
              onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length > 0) p.onAddMaterials(files); }} />
            <span className="flex-1 truncate text-[12px] text-slate-500">{recipe ? t(`panel.videoStudio.recipes.${recipe.id}.wants`) : t('panel.videoStudio.start.dropHint')}</span>
            <button type="button" disabled={!canSend} onClick={() => p.onSubmit()}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-4 text-[13px] font-semibold text-slate-50 hover:bg-white/15 disabled:opacity-40">
              {recipe?.direct ? t('panel.videoStudio.start.openBlank') : t('panel.videoStudio.start.make')}
              <StudioIcon name="send" />
            </button>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-start justify-center gap-4" role="radiogroup" aria-label={t('panel.videoStudio.start.recipes')}>
          {p.recipes.map((r) => {
            const active = r.id === p.recipeId;
            return (
              <button key={r.id} type="button" role="radio" aria-checked={active} onClick={() => p.onRecipe(active ? null : r.id)}
                title={t(`panel.videoStudio.recipes.${r.id}.desc`)} className="group flex w-20 flex-col items-center gap-1.5">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full border transition-[box-shadow,background-color] duration-150 ease-out ${active ? 'border-transparent bg-white/10 text-slate-50 ring-2 ring-[var(--vs-accent)]' : 'border-white/15 text-slate-300 group-hover:bg-white/10'}`}>
                  <StudioIcon name={RECIPE_ICONS[r.id] ?? 'sparkle'} className="h-5 w-5" />
                </span>
                <span className={`text-center text-[12px] leading-tight ${active ? 'font-semibold text-slate-100' : 'text-slate-400'}`}>{t(`panel.videoStudio.recipes.${r.id}.name`)}</span>
              </button>
            );
          })}
        </div>
        {recipe ? <p className="-mt-2 max-w-xl text-center text-[13px] text-slate-400">{t(`panel.videoStudio.recipes.${recipe.id}.desc`)}</p> : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {VIDEO_FORMAT_IDS.map((id) => (
            <button key={id} type="button" className={chip(id === p.format)} aria-pressed={id === p.format} onClick={() => p.onFormat(id)}>
              <span className="tabular-nums">{formatRatioLabel(id)}</span>
            </button>
          ))}
          <span className="mx-1 h-4 border-l border-white/15" aria-hidden="true" />
          {START_LENGTH_CHOICES.map((s) => (
            <button key={s} type="button" className={chip(s === p.length)} aria-pressed={s === p.length} onClick={() => p.onLength(s)}>
              <span className="tabular-nums">{t('panel.videoStudio.start.seconds', { count: s })}</span>
            </button>
          ))}
          <span className="mx-1 h-4 border-l border-white/15" aria-hidden="true" />
          {ENGINES.map((e) => (
            <button key={e} type="button" className={chip(e === p.engine)} aria-pressed={e === p.engine} onClick={() => p.onEngine(e)}
              title={p.preparation[e] ? t(`panel.videoStudio.engines.need_${p.preparation[e]?.action ?? 'refresh'}`, { engine: t(`panel.videoStudio.engines.${e}`) }) : undefined}>
              <EngineIcon kind={e} className="h-3.5 w-3.5" />
              <span className={p.preparation[e] ? 'opacity-60' : ''}>{t(`panel.videoStudio.engines.${e}`)}</span>
            </button>
          ))}
        </div>
        {prep && recipe?.direct !== true ? (
          <p className="flex items-center gap-2 text-[13px] text-slate-400">
            <StudioIcon name="info" />
            {p.prepareElsewhere ? t('panel.videoStudio.engines.prepareInMain', { engine: t(`panel.videoStudio.engines.${p.engine}`) })
              : t(`panel.videoStudio.engines.need_${prep.action}`, { engine: t(`panel.videoStudio.engines.${p.engine}`) })}
            {!p.prepareElsewhere ? (
              <button type="button" onClick={() => p.onPrepare(p.engine)} className="rounded-md border border-white/15 px-2 py-0.5 text-[12px] text-slate-200 hover:bg-white/10">
                {t('panel.videoStudio.engines.prepare')}
              </button>
            ) : null}
          </p>
        ) : null}

        {p.recent.length > 0 ? (
          <section className="w-full max-w-xl">
            <h2 className="mb-2 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.header.recent')}</h2>
            <div className="flex flex-col gap-1">
              {p.recent.slice(0, 6).map((d) => (
                <button key={d.id} type="button" onClick={() => p.onOpenDoc(d.id)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-slate-300 hover:bg-white/[0.06]">
                  <StudioIcon name="film" className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate">{d.title || d.id}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-500">{new Date(d.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </ScrollFade>
  );
}
