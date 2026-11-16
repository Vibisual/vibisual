import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DIFF_LINE_LIMIT, type DiffLine, type PassReport, type SceneChange, type SceneChangeSet, type SceneDecision } from '@vibisual/video';

import { StudioIcon } from './studioIcons.js';
import { diffLineText } from './diffText.js';
import type { SceneConfirm, SceneReview } from './useSceneReview.js';

/**
 * §5.13 (V) 37-3 — "이번에 바뀐 것" 카드: 맡기기 직전 판 ↔ 지금(`diffDoc`) + 바퀴 보고 + [이 바퀴 되돌리기]. 줄을 누르면 그 장면·아이템으로.
 * 37-23 — 장면 층이 있으면 장면마다 묶고 [그대로 두기]·[이 장면만 되돌리기]·[이 장면 대화]를 단다. 장면이 없으면 종전 줄 목록이다.
 */
export interface StudioChangeCardProps {
  readonly lines: readonly DiffLine[];
  readonly report: PassReport | null;
  /** 바퀴가 아직 도는가(보고 전). */
  readonly open: boolean;
  readonly onJump: (target: NonNullable<DiffLine['target']>) => void;
  readonly onUndoPass: (() => void) | null;
  readonly scenes?: SceneChangeSet;
  readonly decided?: Readonly<Record<string, SceneDecision>>;
  /** 장면 손잡이 — 바퀴 기록이 없으면 null(줄만 보인다). */
  readonly review?: SceneReview | null;
  /** 장면별 대화로 거른 동안 그 장면 묶음만 보인다. */
  readonly sceneFilter?: string | null;
  readonly onSceneChat?: (chapterId: string) => void;
}

const BTN = 'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2';

function LineList({ lines, onJump, t }: { readonly lines: readonly DiffLine[]; readonly onJump: StudioChangeCardProps['onJump']; readonly t: TFunction }): React.JSX.Element | null {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, DIFF_LINE_LIMIT);
  const more = lines.length - shown.length;
  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((line, i) => (
        <li key={`${line.kind}-${i}`}>
          {line.target ? (
            <button type="button" onClick={() => line.target && onJump(line.target)}
              className="w-full truncate rounded-md px-1.5 py-1 text-left text-[13px] text-slate-300 hover:bg-white/[0.06] hover:text-slate-50 pointer-coarse:py-2">
              {diffLineText(t, line)}
            </button>
          ) : (
            <span className="block truncate px-1.5 py-1 text-[13px] text-slate-400">{diffLineText(t, line)}</span>
          )}
        </li>
      ))}
      {more > 0 ? <li className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.ai.moreChanges', { count: more })}</li> : null}
    </ul>
  );
}

/** 확인 띠의 파일 문장 — 숨기지 않고 한계까지 말한다(37-23 (H)). */
function planSentences(t: TFunction, c: SceneConfirm): string[] {
  const out: string[] = [];
  const plan = c.plan;
  if (!plan) return out;
  if (plan.noSnapshot) out.push(t('panel.videoStudio.sceneReview.filesNoSnapshot'));
  if (plan.changed > 0) out.push(t('panel.videoStudio.sceneReview.filesChanged', { count: plan.changed }));
  if (plan.sharedChanged > 0 || plan.shared.length > 0) out.push(t('panel.videoStudio.sceneReview.filesShared', { count: plan.sharedChanged }));
  if (plan.extra > 0) out.push(t('panel.videoStudio.sceneReview.filesExtra', { count: plan.extra }));
  if (plan.missing > 0) out.push(t('panel.videoStudio.sceneReview.filesMissing', { count: plan.missing }));
  if (plan.partial) out.push(t('panel.videoStudio.sceneReview.filesPartial'));
  return out;
}

function ConfirmStrip({ c, review, t }: { readonly c: SceneConfirm; readonly review: SceneReview; readonly t: TFunction }): React.JSX.Element {
  const notes = c.phase === 'ready' ? planSentences(t, c) : [];
  return (
    <div role="alertdialog" aria-label={t('panel.videoStudio.sceneReview.confirmTitle')}
      className="mt-1.5 flex flex-col gap-1 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1.5 text-[12px] text-slate-300">
      {c.phase === 'checking' ? <span className="text-slate-400">{t('panel.videoStudio.sceneReview.checking')}</span> : null}
      {c.phase === 'applying' ? <span className="text-slate-400">{t('panel.videoStudio.sceneReview.applying')}</span> : null}
      {c.phase === 'ready' && c.nothing ? <span>{t('panel.videoStudio.sceneReview.nothing')}</span> : null}
      {c.phase === 'ready' && c.blocked ? (
        <span className="flex items-start gap-1.5 break-words text-red-300"><StudioIcon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{t('panel.videoStudio.sceneReview.blocked', { reason: c.blocked })}</span></span>
      ) : null}
      {c.phase === 'ready' && !c.blocked && c.warnings > 0 ? <span className="text-amber-300">{t('panel.videoStudio.sceneReview.warnings', { count: c.warnings })}</span> : null}
      {notes.map((line) => <span key={line} className="break-words text-slate-400">{line}</span>)}
      <div className="flex flex-wrap items-center justify-end gap-1">
        <button type="button" onClick={review.cancel} disabled={c.phase === 'applying'} className={BTN}>{t('panel.videoStudio.sceneReview.cancel')}</button>
        {!c.nothing ? (
          <button type="button" onClick={review.confirmRestore} disabled={c.phase !== 'ready' || c.blocked !== null}
            className={`${BTN} text-amber-200 hover:text-amber-50`}>
            <StudioIcon name="undo" className="h-3.5 w-3.5" />{t('panel.videoStudio.sceneReview.confirmRestore')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SceneGroup(p: {
  readonly scene: SceneChange;
  readonly decision: SceneDecision | undefined;
  readonly review: SceneReview | null;
  readonly onJump: StudioChangeCardProps['onJump'];
  readonly onSceneChat: ((chapterId: string) => void) | undefined;
  readonly t: TFunction;
}): React.JSX.Element {
  const { scene, decision, review, t } = p;
  const busy = review?.busy === scene.chapterId;
  const confirm = review?.confirm?.chapterId === scene.chapterId ? review.confirm : null;
  const head = (
    <div className="flex min-w-0 items-center gap-1.5">
      <button type="button" onClick={() => p.onJump({ chapterId: scene.chapterId })}
        className="min-w-0 truncate rounded px-1 text-left text-[12px] font-semibold text-slate-200 hover:bg-white/[0.06]">
        {t('panel.videoStudio.sceneReview.sceneTitle', { n: scene.n, title: scene.title })}
      </button>
      <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 text-[12px] text-slate-400">{t(`panel.videoStudio.sceneReview.state.${scene.state}`)}</span>
    </div>
  );
  if (decision) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-1 rounded-lg px-1 py-1">
        {head}
        <span className="flex items-center gap-1">
          <span className={`flex items-center gap-1 rounded-full px-1.5 text-[12px] ${decision.how === 'kept' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-400/10 text-slate-300'}`}>
            <StudioIcon name={decision.how === 'kept' ? 'check' : 'undo'} className="h-3 w-3" />{t(`panel.videoStudio.sceneReview.decided.${decision.how}`)}
          </span>
          {review ? <button type="button" onClick={() => review.reopen(scene.chapterId)} disabled={busy} className={BTN}>{t('panel.videoStudio.sceneReview.reopen')}</button> : null}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-0.5 rounded-lg border border-white/[0.06] px-1 py-1">
      {head}
      <LineList lines={scene.lines} onJump={p.onJump} t={t} />
      {review || p.onSceneChat ? (
        <div className="flex flex-wrap items-center gap-1">
          {review ? (
            <>
              <button type="button" onClick={() => review.keep(scene.chapterId)} disabled={busy || confirm !== null} className={BTN}>
                <StudioIcon name="check" className="h-3.5 w-3.5" />{t('panel.videoStudio.sceneReview.keep')}
              </button>
              <button type="button" onClick={() => review.askRestore(scene.chapterId)} disabled={busy || confirm !== null} className={BTN}>
                <StudioIcon name="undo" className="h-3.5 w-3.5" />{t('panel.videoStudio.sceneReview.restore')}
              </button>
            </>
          ) : null}
          {p.onSceneChat ? (
            <button type="button" onClick={() => p.onSceneChat?.(scene.chapterId)} className={BTN}>
              <StudioIcon name="chat" className="h-3.5 w-3.5" />{t('panel.videoStudio.sceneReview.chat')}
            </button>
          ) : null}
        </div>
      ) : null}
      {confirm && review ? <ConfirmStrip c={confirm} review={review} t={t} /> : null}
    </li>
  );
}

export function StudioChangeCard(p: StudioChangeCardProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (p.lines.length === 0 && !p.report) return null;
  const allScenes = p.scenes?.scenes ?? [];
  const byScene = allScenes.length > 0;
  const scenes = p.sceneFilter ? allScenes.filter((s) => s.chapterId === p.sceneFilter) : allScenes;
  const rest = p.sceneFilter ? [] : p.scenes?.rest ?? [];
  return (
    <section className="animate-[vs-in-right_160ms_ease-out] rounded-xl border border-white/10 bg-vb-card p-3" aria-label={t('panel.videoStudio.ai.changed')}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-slate-200">{t('panel.videoStudio.ai.changed')}</span>
        {p.open ? <span className="h-1.5 w-1.5 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-[var(--vs-accent)]" aria-label={t('panel.videoStudio.ai.working')} /> : null}
        <span className="flex-1" />
        {p.onUndoPass ? (
          <button type="button" onClick={p.onUndoPass} className={BTN}>
            <StudioIcon name="undoPass" className="h-3.5 w-3.5" />{t('panel.videoStudio.ai.undoPass')}
          </button>
        ) : null}
      </header>
      {byScene ? (
        <>
          {scenes.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {scenes.map((scene) => (
                <SceneGroup key={scene.chapterId} scene={scene} decision={p.decided?.[scene.chapterId]} review={p.review ?? null}
                  onJump={p.onJump} onSceneChat={p.onSceneChat} t={t} />
              ))}
            </ul>
          ) : p.sceneFilter ? <p className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.sceneReview.noneInScene')}</p> : null}
          {rest.length > 0 ? (
            <div className="mt-1.5">
              <div className="px-1.5 pb-0.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.sceneReview.rest')}</div>
              <LineList lines={rest} onJump={p.onJump} t={t} />
            </div>
          ) : null}
        </>
      ) : <LineList lines={p.lines} onJump={p.onJump} t={t} />}
      {p.report ? (
        <div className="mt-2 border-t border-white/10 pt-2">
          {p.report.summary ? <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-300">{p.report.summary}</p> : null}
          {p.report.warnings.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {p.report.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 break-words text-[12px] text-amber-300"><StudioIcon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0">{w}</span></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
