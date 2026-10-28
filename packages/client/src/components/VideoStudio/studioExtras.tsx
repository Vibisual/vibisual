import { Suspense, type Dispatch, type ReactNode, type SetStateAction, type MutableRefObject } from 'react';
import type { TFunction } from 'i18next';
import {
  TRANSITION_DEFAULT_SECONDS,
  buildMergeChapterOps,
  buildRemoveChapterOps,
  buildSplitChapterOps,
  strongBeatsInDoc,
  type DocStyle,
  type ResolvedTimeline,
  type TransitionKind,
  type VideoDoc,
  type VideoDocOp,
  type VideoEngineKind,
} from '@vibisual/video';

import type { StudioExtras, StudioUiState } from './studioViewProps.js';
import type { StudioComposerState } from './useStudioComposer.js';
import type { StudioParts } from './useStudioParts.js';
import type { MotionReview } from './useMotionReview.js';
import type { StudioToasts } from './useStudioToasts.js';
import { ChapterMenu, SeamMenu } from './ChapterMenus.js';
import { ReviewMenu } from './ReviewMenu.js';
// 39-2 — 스타일 서랍·라이브러리·원본·요청 검토는 처음엔 닫혀 있는 판이라 늦게 받는다(한가할 때 미리 받아 둔다).
import { LazyLibrariesPanel, LazyStyleDrawer, LazyVideoRequestReview, LazyVideoSourcesDrawer } from './studioPanels.js';

/**
 * §5.13 (V) — 셸이 화면 조립에 넘기는 덧붙임(`StudioExtras`)을 짓는다: 장면 구슬 메뉴·이음매(37-8) · 검수 표시와 그 메뉴(37-9) ·
 * 스타일 서랍(37-10) · 부품 서랍·가져오기 칸(37-11) · 비트 점(37-12) · 그 밖 손잡이. 셸은 묶기만 한다.
 */
export interface StudioExtrasInputs {
  readonly t: TFunction;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly pendingWork: MutableRefObject<number>;
  readonly doc: VideoDoc | null;
  readonly timeline: ResolvedTimeline | null;
  readonly playhead: number;
  /** §5.13 (Y) 40-5 ① — 누른 순간의 시각(재생 중에도 정확하게 — 시계). 없으면 `playhead`. */
  readonly readPlayhead?: () => number;
  /** The item selected in the preview/timeline (request checks "only this changes" / "keep this"). */
  readonly selectedItemId?: string | null;
  readonly engine: VideoEngineKind;
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly ui: StudioUiState;
  readonly setUi: Dispatch<SetStateAction<StudioUiState>>;
  readonly applyOps: (ops: readonly VideoDocOp[]) => void | Promise<boolean>;
  readonly composer: StudioComposerState;
  readonly parts: StudioParts;
  readonly review: MotionReview;
  readonly toasts: StudioToasts;
  readonly addPack: (relHtml: string, label: string) => void;
  /** §5.13 (V) 37-14 — [두 엔진 나란히](4라운드가 채운다). */
  readonly onVariants: (chapterId: string) => void;
  /** 4라운드가 더하는 것(대본 서랍·AI 패널 손잡이·내보내기 메뉴·덧그림). */
  readonly more?: Partial<StudioExtras>;
}

export function buildStudioExtras(x: StudioExtrasInputs): StudioExtras {
  const { t, doc, timeline, ui, setUi } = x;
  const chapters = timeline?.chapters ?? [];
  const now = (): number => x.readPlayhead?.() ?? x.playhead;
  const chapterAt = (at: number): (typeof chapters)[number] | null => chapters.find((c) => at >= c.start && at < c.end) ?? null;
  // 판에 보이는 자리(이음매 전환이 걸릴 장면)는 멈춘 재생 머리 기준 — 재생 중에는 시작 자리에 머문다.
  const atPlayhead = chapterAt(x.playhead);
  const beats = doc && timeline ? strongBeatsInDoc(doc, timeline) : [];
  const overlays: ReactNode[] = [];

  // §5.13 (V) 37-8 — 구슬 메뉴.
  const menuChapter = ui.chapterMenu ? chapters.find((c) => c.id === ui.chapterMenu?.chapterId) : undefined;
  if (ui.chapterMenu && menuChapter && doc && timeline) {
    const range = { id: menuChapter.id, title: menuChapter.chapter.title, start: menuChapter.start, end: menuChapter.end };
    const other: VideoEngineKind = x.engine === 'claude' ? 'codex' : 'claude';
    overlays.push(
      <ChapterMenu
        key="chapter-menu"
        anchor={ui.chapterMenu.anchor}
        chapter={menuChapter}
        hasNext={menuChapter.index < chapters.length - 1}
        canSplit={x.playhead > menuChapter.start + 0.05 && x.playhead < menuChapter.end - 0.05}
        otherEngine={t(`panel.videoStudio.engines.${other}`)}
        busy={x.sending}
        onRedo={() => { void x.composer.sendPass(t('panel.videoStudio.chapterMenu.redoRequest', { n: menuChapter.index + 1, title: menuChapter.chapter.title }), 'chapter', { chapter: range }); }}
        onOtherEngine={() => { void x.composer.sendPass(t('panel.videoStudio.chapterMenu.redoRequest', { n: menuChapter.index + 1, title: menuChapter.chapter.title }), 'chapter', { chapter: range }, other); }}
        onVariants={() => x.onVariants(menuChapter.id)}
        onSavePart={() => { void x.parts.save(menuChapter.id, menuChapter.chapter.title).then(() => x.toasts.success('panel.videoStudio.toast.partSaved')); }}
        onSplit={() => {
          const at = now();
          if (at > menuChapter.start + 0.05 && at < menuChapter.end - 0.05) void x.applyOps(buildSplitChapterOps(doc, timeline, menuChapter.id, at, t('panel.videoStudio.plan.newChapter')));
        }}
        onMerge={() => x.applyOps(buildMergeChapterOps(doc, timeline, menuChapter.id))}
        onRemove={() => x.applyOps(buildRemoveChapterOps(doc, menuChapter.id, (itemId) => timeline.items.find((it) => it.id === itemId)?.start))}
        onClose={() => setUi((u) => ({ ...u, chapterMenu: null }))}
      />,
    );
  }

  /** 이음매를 가장 가까운 강한 비트로 — 앞 장면 길이를 그만큼 바꾼다(상대 앵커라 뒤가 따라온다 — 숫자는 코드가 계산한다). */
  const snapSeam = (chapterId: string): void => {
    const c = chapters.find((ch) => ch.id === chapterId);
    const prev = c ? chapters[c.index - 1] : undefined;
    if (!c || !prev || beats.length === 0) return;
    const mark = c.start + c.overlapIn / 2;
    const beat = beats.reduce((best, b) => (Math.abs(b - mark) < Math.abs(best - mark) ? b : best), beats[0] ?? mark);
    const delta = beat - mark;
    if (Math.abs(delta) < 1e-3) return;
    x.applyOps([{ op: 'updateChapter', chapterId: prev.id, patch: { duration: Math.max(0.1, Math.round((prev.duration + delta) * 1000) / 1000) } }]);
  };

  // §5.13 (V) 37-8 — 이음매(전환 고르기).
  const seamChapter = ui.seamMenu ? chapters.find((c) => c.id === ui.seamMenu?.chapterId) : undefined;
  if (ui.seamMenu && seamChapter && doc) {
    overlays.push(
      <SeamMenu
        key="seam-menu"
        anchor={ui.seamMenu.anchor}
        chapter={seamChapter}
        fps={doc.fps}
        canSnap={beats.length > 0}
        onSet={(kind: TransitionKind, duration: number) => x.applyOps([{ op: 'updateChapter', chapterId: seamChapter.id, patch: { transition: { kind, duration: kind === 'cut' ? 0 : duration } } }])}
        onSnap={() => snapSeam(seamChapter.id)}
        onClose={() => setUi((u) => ({ ...u, seamMenu: null }))}
      />,
    );
  }

  // §5.13 (V) 37-9 — 검수 표시 메뉴.
  const finding = ui.markerMenu ? x.review.findings.find((f) => f.id === ui.markerMenu?.id) : undefined;
  if (ui.markerMenu && finding) {
    overlays.push(
      <ReviewMenu
        key="review-menu"
        anchor={ui.markerMenu.anchor}
        finding={finding}
        busy={x.sending}
        framesBusy={x.review.busy}
        withFrames={x.review.withFrames}
        onFix={() => {
          void x.composer.sendPass(t('panel.videoStudio.review.fixRequest', { what: t(`panel.videoStudio.review.${finding.code}`, { ...(finding.values ?? {}) }) }), 'review', {
            finding: { code: finding.code, t: finding.t, message: finding.message, ...(finding.itemId ? { itemId: finding.itemId } : {}) },
          });
        }}
        onApplyFix={finding.fix && finding.fix.length > 0 ? () => x.applyOps(finding.fix ?? []) : null}
        onSkip={() => x.review.skip(finding.id)}
        onRunFrames={x.review.runFrames}
        onClose={() => setUi((u) => ({ ...u, markerMenu: null }))}
      />,
    );
  }

  // 전환을 입힐 이음매 — 재생 머리가 선 장면의 들어오는 이음매(첫 장면은 이음매가 없다).
  const seamChapterForParts = atPlayhead && atPlayhead.index > 0 ? atPlayhead : null;

  return {
    overlays: <>{overlays}{x.more?.overlays ?? null}</>,
    markers: x.review.findings.map((f) => ({ id: f.id, t: f.t, level: f.level, label: t(`panel.videoStudio.review.${f.code}`, { ...(f.values ?? {}) }) })),
    beats,
    styleDrawer: doc ? (
      <Suspense fallback={null}>
        <LazyStyleDrawer project={x.projectName} doc={doc} disabled={x.disabled}
          onApply={(style: DocStyle) => x.applyOps([{ op: 'setDoc', patch: { style } }])}
          onError={x.toasts.error}
          onConfirmed={() => x.toasts.success('panel.videoStudio.toast.styleConfirmed')} />
      </Suspense>
    ) : null,
    libraries: <Suspense fallback={null}>
      {doc && <>
        <LazyVideoSourcesDrawer pendingWork={x.pendingWork} project={x.projectName} doc={doc} playhead={x.playhead} readPlayhead={now} disabled={x.disabled} onApply={x.applyOps} onError={x.toasts.error} />
        <LazyVideoRequestReview projectRoot={x.projectRoot} doc={doc} disabled={x.disabled} selectedItemId={x.selectedItemId ?? null} onApply={x.applyOps} />
      </>}
      <LazyLibrariesPanel project={x.projectName} disabled={x.disabled} onError={x.toasts.error} onAddPack={x.addPack} />
    </Suspense>,
    parts: {
      parts: x.parts.parts,
      onUsePart: (partId) => {
        const at = now();
        const chapter = chapterAt(at);
        void x.parts.use(partId, { t: at, chapterId: chapter?.id ?? null, chapterStart: chapter?.start ?? 0 });
      },
      transitions: (['dissolve', 'push', 'zoom', 'flash', 'wipe'] as const).map((kind) => ({ kind })),
      onTransition: (kind) => {
        if (!seamChapterForParts) return;
        const duration = seamChapterForParts.chapter.transition?.duration && seamChapterForParts.chapter.transition.duration > 0 ? seamChapterForParts.chapter.transition.duration : TRANSITION_DEFAULT_SECONDS;
        x.applyOps([{ op: 'updateChapter', chapterId: seamChapterForParts.id, patch: { transition: { kind: kind as TransitionKind, duration } } }]);
      },
      seamReady: seamChapterForParts !== null,
    },
    ...(x.more?.transcriptDrawer !== undefined ? { transcriptDrawer: x.more.transcriptDrawer } : {}),
    ...(x.more?.aiActions !== undefined ? { aiActions: x.more.aiActions } : {}),
    ...(x.more?.exportMenu !== undefined ? { exportMenu: x.more.exportMenu } : {}),
    ...(x.more?.cues !== undefined ? { cues: x.more.cues } : {}),
  };
}
