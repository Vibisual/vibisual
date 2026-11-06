import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChapterThumbWant } from '@vibisual/video';

import type { AppCanvasFaceProps } from '../../apps/registry.js';
import { FACE_BAR_HEIGHT, FaceFrame, FaceStage } from '../../apps/canvasFaceKit.js';
import { useChapterThumbsFor } from './useChapterThumbs.js';
import { useNowTick, useSettled, useVideoGlance } from './useVideoGlance.js';
import { focusChapterId, outlineRects, scrubImageAt } from './glanceView.js';
import { POSTER_SETTLE_MS } from './glanceStills.js';
import { glanceShownTime, useGlanceHold, useGlancePoster, useGlanceScrub, useGlanceStillsTick } from './useGlanceStills.js';
import { glanceNote, glanceWhen } from './glanceNote.js';
import { GlanceStageView, type GlanceBand } from './GlanceStage.js';
import { GlancePlayingBar, GlanceStoppedBar } from './GlanceBar.js';
import { WorkingSatellite, useGlanceWorking } from './glanceWorking.js';
import { useGlanceLive } from './useGlanceLive.js';
import { CanvasPlayerSlot, loadCanvasPlayer } from './CanvasPlayerSlot.js';

/**
 * §5.4 #36 (J) — 문서에 묶인 영상 노드의 훑어보기 화면: "무엇이 바뀌었고 괜찮은가"를 그 자리에서 답한다.
 * ① 결과 칸 비율을 코어에 알린다 · ② 누르지 않고 좌우로 훑으면 그 시각의 장면 그림 · ③ 포스터는 마지막 바퀴가 바꾼 장면, 조작줄에 바뀐 것 한 줄,
 * 머리줄에 안 본 변경 · ④ [직전 판]을 누르고 있는 동안 바퀴 시작 판의 같은 시각, 바뀐 아이템엔 얇은 테 · ⑤ 구슬 줄에서 고른 장면으로 ·
 * ⑥ 머리줄 제목 = 문서 제목, "AI · 2분 전" · ⑦ [재생] = 렌더 없이 지금 문서를 그 자리에서(누를 때만 판 부품이 온다).
 * 가운데 큰 재생 단추는 두지 않는다(아직 정해지지 않은 자리 — 붙인다면 `startPlay` 하나를 부른다). 결과 칸 누름은 선택, 더블클릭은 편집기((G) 불변).
 */

const NO_WANTS: readonly ChapterThumbWant[] = [];
/** "2분 전" 글자를 다시 쓰는 간격(ms). */
const WHEN_TICK_MS = 30_000;

function prefetchPlayer(): void {
  void loadCanvasPlayer().catch(() => undefined);
}

export function VideoGlanceFace({
  projectId,
  projectName,
  workRef,
  width,
  height,
  glow,
  icon,
  onStageAspect,
  onHeader,
  stageFocus,
  onShowRender,
}: AppCanvasFaceProps & { workRef: string; onShowRender?: (() => void) | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  const project = projectName && projectName !== '' ? projectName : projectId;
  const { glance, failed } = useVideoGlance(project, workRef);
  const versionKey = glance ? `${glance.doc.version}:${glance.doc.updatedAt}` : '';
  const wants = glance?.wants ?? NO_WANTS;
  // 디스크 기억은 바로, 굽기는 판본이 잠잠해진 뒤에만(§5.13 39-4 — 에이전트가 연달아 고치는 동안 판마다 굽지 않게).
  const settled = useSettled(versionKey, POSTER_SETTLE_MS);
  const thumbs = useChapterThumbsFor(project, workRef, wants, { active: settled, follow: true });
  useGlanceStillsTick();
  const now = useNowTick(WHEN_TICK_MS);
  const live = useGlanceLive();
  const poster = useGlancePoster(project, workRef, glance, thumbs, wants);
  const scrub = useGlanceScrub(project, workRef, glance);

  const stageW = Math.max(1, width);
  const stageH = Math.max(1, height - FACE_BAR_HEIGHT);
  const duration = glance?.timeline.duration ?? 0;
  const chapters = useMemo(() => glance?.timeline.chapters ?? [], [glance]);

  // ① · ⑥ — 코어에 알린다(같은 값이면 코어가 건너뛴다). 안 본 변경은 AI 가 낸 판본이 바뀔 때만(사람이 고친 판은 본 것이다).
  const docW = glance?.doc.size.width ?? 0;
  const docH = glance?.doc.size.height ?? 0;
  useEffect(() => { if (docW > 0 && docH > 0) onStageAspect?.(docW / docH); }, [docW, docH, versionKey, onStageAspect]);
  const title = glance?.info.title;
  const changeKey = glance ? String(glance.lastAiVersion ?? '') : '';
  useEffect(() => { if (title !== undefined) onHeader?.({ title, changeKey }); }, [title, changeKey, onHeader]);

  // ⑤ 구슬 줄에서 고른 장면 — 멈춰 있으면 그 장면 그림을 세우고(다음 재생은 그 장면부터), 재생 중이면 그 장면 시작으로.
  const [focusChapter, setFocusChapter] = useState<string | null>(null);
  const latest = useRef({ live, chapters });
  latest.current = { live, chapters };
  useEffect(() => {
    const id = stageFocus ? focusChapterId(stageFocus.itemId) : null;
    const c = id ? latest.current.chapters.find((x) => x.id === id) : undefined;
    if (!c) return;
    const control = latest.current.live.control;
    if (latest.current.live.mounted && control) {
      control.seek(c.start);
      control.resume();
      return;
    }
    setFocusChapter(c.id);
    // 같은 장면을 다시 눌러도 새 요청이다(`seq` 만 본다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFocus?.seq]);
  const focused = focusChapter ? chapters.find((c) => c.id === focusChapter) ?? null : null;

  const startRev = glance?.pass?.startRev;
  const shownT = glanceShownTime(scrub.t, focused, poster.pick);
  const hold = useGlanceHold(project, workRef, startRev, shownT);
  const scrubImage = scrub.t !== null && glance ? scrubImageAt(glance.timeline, thumbs, scrub.stills, scrub.t) : null;
  const focusImage = focused ? thumbs[focused.id] ?? null : null;
  const shown = scrubImage ?? focusImage ?? poster.image;
  const image = hold.holding ? hold.image ?? shown : shown;
  const outlineT = live.mounted ? null : hold.holding ? shownT : scrub.t;
  const outlines = useMemo(
    () => (glance && outlineT !== null ? outlineRects(glance.doc, glance.timeline, outlineT, glance.targets.items, { width: stageW, height: stageH }) : []),
    [glance, outlineT, stageW, stageH],
  );
  const band: GlanceBand | null = scrub.t !== null && duration > 0 && !live.mounted
    ? { segments: chapters.map((c) => ({ from: c.start / duration, to: c.end / duration })), at: scrub.t / duration }
    : null;

  // ⑦ 재생 — 판은 누를 때 세운다. 끝나면 처음으로 돌아가 멈춘다(판을 내리고 포스터로).
  const empty = glance !== null && !(duration > 0);
  const startPlay = useCallback((): void => {
    const at = focused ? focused.start : 0;
    setFocusChapter(null);
    scrub.onScrub(null);
    live.start(at);
  }, [focused, scrub, live]);
  const onPlayPress = useCallback((): void => {
    if (!glance || empty) return;
    if (!live.mounted) { startPlay(); return; }
    if (!live.state.ready || !live.control) { live.stop(); return; }
    if (live.state.playing) live.control.pause();
    else live.control.play();
  }, [glance, empty, live, startPlay]);
  const [liveFailed, setLiveFailed] = useState(false);
  const failLive = useCallback((error: unknown): void => {
    console.warn('[VideoGlanceFace] canvas playback stopped', error);
    setLiveFailed(true);
    latest.current.live.stop();
  }, []);
  const onLiveError = useCallback((message: string): void => {
    // 첫 그림 전의 실패는 여기서 틀 수 없다는 뜻 — 판을 내리고 조작줄이 말한다. 그 뒤의 경고(소재 하나가 비는 등)는 재생을 멈추지 않는다.
    if (latest.current.live.state.ready) return;
    failLive(message);
  }, [failLive]);
  useEffect(() => { if (live.mounted) setLiveFailed(false); }, [live.mounted]);

  const working = useGlanceWorking(projectName ?? '', workRef, glance?.info.activity ?? null);
  const stills = scrub.stills;
  const frameAt = useCallback((at: number): string | null => (glance ? scrubImageAt(glance.timeline, thumbs, stills, at) : null), [glance, thumbs, stills]);
  const marks = useMemo(() => (duration > 0 ? chapters.slice(1).map((c) => c.start / duration) : []), [chapters, duration]);
  const note = useMemo(() => glanceNote(t, glance, { failed, liveFailed }), [t, glance, failed, liveFailed]);
  const control = live.mounted && live.state.ready ? live.control : null;

  return (
    <FaceFrame>
      <FaceStage className="bg-black">
        <GlanceStageView
          image={image}
          loading={!failed && !image}
          empty={empty}
          glow={glow}
          icon={icon}
          outlines={outlines}
          band={band}
          holdBadge={hold.holding && startRev ? (hold.image ? 'shown' : 'loading') : null}
          onScrub={live.mounted || empty ? null : scrub.onScrub}
        />
        {live.mounted && glance ? (
          <CanvasPlayerSlot
            project={project}
            doc={glance.doc}
            startAt={live.startAt}
            muted={live.muted}
            width={stageW}
            height={stageH}
            onControl={live.onControl}
            onState={live.onState}
            onEnded={live.stop}
            onError={onLiveError}
            onFail={failLive}
          />
        ) : null}
        <WorkingSatellite working={working} glow={glow} />
      </FaceStage>
      {control ? (
        <GlancePlayingBar
          width={width}
          glow={glow}
          playing={live.state.playing}
          onToggle={onPlayPress}
          clock={control.clock}
          duration={control.duration}
          marks={marks}
          onSeek={control.seek}
          onSeekEnd={control.resume}
          frameAt={frameAt}
          aspect={docW > 0 && docH > 0 ? docW / docH : 16 / 9}
          muted={live.muted}
          onToggleMute={live.toggleMute}
        />
      ) : (
        <GlanceStoppedBar
          width={width}
          glow={glow}
          playLoading={live.mounted}
          playDisabled={!glance || empty}
          onPlay={onPlayPress}
          onPrefetch={prefetchPlayer}
          note={note.text}
          noteTitle={note.title}
          hold={startRev && !live.mounted ? { holding: hold.holding, onHold: hold.setHolding } : null}
          onShowRender={live.mounted ? undefined : onShowRender}
          when={glanceWhen(t, glance, now)}
          whenTitle={glance ? t('panel.apps.canvas.docVersion', { defaultValue: 'v{{version}}', version: glance.doc.version }) : undefined}
        />
      )}
    </FaceFrame>
  );
}
