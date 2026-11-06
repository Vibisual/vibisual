import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CANVAS_FACE } from '@vibisual/shared';

import type { AppCanvasFaceProps } from '../../apps/registry.js';
import { useMediaBlobUrl } from '../../apps/useMediaBlobUrl.js';
import {
  FACE_BAR_HEIGHT,
  FACE_CONTROL,
  FaceBar,
  FaceButton,
  FaceFrame,
  FaceNote,
  FaceSeek,
  FaceStage,
  FaceStill,
  FaceTime,
  MutedGlyph,
  PauseGlyph,
  PlayGlyph,
  VolumeGlyph,
  playFraction,
  quantizePlayTime,
  useFrameLoop,
} from '../../apps/canvasFaceKit.js';
import { VideoGlanceFace } from './VideoGlanceFace.js';
import { claimCanvasPlayback } from './canvasPlayback.js';

/**
 * §5.13 (L) · §5.4 #36 (J) — 묶인 작업 문서가 있으면 훑어보기 화면(`VideoGlanceFace` — 렌더본이 있으면 [렌더본]으로 종전 결과 재생),
 * 없으면 결과 파일을 바로 튼다. 문서가 바뀌면 화면을 통째로 새로 세운다(훑기·직전 판·재생 상태는 휘발).
 */
export function VideoCanvasFace(props: AppCanvasFaceProps): React.JSX.Element {
  const [showExport, setShowExport] = useState(false);
  const { t } = useTranslation();
  const hasExport = props.file !== '';
  const { workRef, onHeader } = props;
  // 결과 파일만 담긴 노드는 머리줄에 문서 제목을 싣지 않는다(코어가 사용자 제목 → 파일 이름 → 앱 이름으로).
  useEffect(() => { if (!workRef) onHeader?.(null); }, [workRef, onHeader]);
  if (workRef && !(showExport && hasExport)) {
    return <VideoGlanceFace key={workRef} {...props} workRef={workRef} onShowRender={hasExport ? () => setShowExport(true) : undefined} />;
  }
  if (workRef && showExport) {
    return (
      <>
        <VideoFileFace {...props} />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowExport(false); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={t('panel.apps.canvas.backToDoc', { defaultValue: 'Back to the document' })}
          aria-label={t('panel.apps.canvas.backToDoc', { defaultValue: 'Back to the document' })}
          className={`${FACE_CONTROL} absolute right-1 top-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-[12px] text-white/80 hover:bg-black/80 hover:text-white`}
        >
          {t('panel.apps.canvas.docShort', { defaultValue: 'Doc' })}
        </button>
      </>
    );
  }
  return <VideoFileFace {...props} />;
}

/**
 * §5.4 #36 (G) — Vibistudio 노드 화면: 대표 프레임 → 처음 [재생]에 결과 파일을 받아 `<video>`(`useMediaBlobUrl` — 패키지 앱에서 `<video src="/api/…">` 는 빈다).
 * 영상 위는 `pointer-events: none`(끌기·더블클릭 자리). `APP_CANVAS_FACE.playMaxBytes` 초과·못 읽음이면 "에디터에서 여세요". URL 은 훅이 되돌린다.
 */
function VideoFileFace({
  projectId,
  file,
  version,
  width,
  height,
  glow,
  icon,
  thumb,
  thumbLoading,
}: AppCanvasFaceProps): React.JSX.Element {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /**
   * 받았는데 브라우저가 못 푸는 형식(멀티플랫폼 6축 — 예: HEVC 는 OS 하드웨어 디코더에 기대 linux 기본에서 못 튼다).
   * 검은 화면으로 조용히 남지 않고 조작줄이 "에디터에서 여세요"로 말한다.
   */
  const [decodeFailed, setDecodeFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** 받는 중에 누른 [재생] — 영상이 서면 이어서 튼다. */
  const wantPlayRef = useRef(false);
  /** §5.4 #36 (J) ⑦ — 캔버스에서 동시에 도는 영상은 하나: 틀 때 자리를 잡고, 다른 노드가 잡으면 멈춘다. */
  const releasePlayback = useRef<(() => void) | null>(null);
  const holdPlayback = useCallback((): void => {
    releasePlayback.current?.();
    releasePlayback.current = claimCanvasPlayback(() => {
      releasePlayback.current = null;
      videoRef.current?.pause();
    });
  }, []);
  const dropPlayback = useCallback((): void => {
    releasePlayback.current?.();
    releasePlayback.current = null;
  }, []);
  useEffect(() => dropPlayback, [dropPlayback]);

  // 다른 결과가 오면(파일·버전) 처음으로 — 받은 URL 은 훅이 되돌린다.
  useEffect(() => {
    setArmed(false);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setDecodeFailed(false);
    wantPlayRef.current = false;
  }, [projectId, file, version]);

  const media = useMediaBlobUrl({ projectId, file, version, enabled: armed, maxBytes: APP_CANVAS_FACE.playMaxBytes });
  const readyUrl = media.status === 'ready' && !decodeFailed ? media.url : null;
  const ready = readyUrl !== null;
  const blocked = media.status === 'tooLarge' || media.status === 'failed' || decodeFailed;
  /** `play()` 의 거절 — 형식을 못 푼 것이면 막고, 그 밖(멈춤 경합 등)은 멈춘 것으로만 친다. setState 만 쓴다. */
  const onPlayRejected = useCallback((err: unknown): void => {
    setPlaying(false);
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : '';
    if (name === 'NotSupportedError') setDecodeFailed(true);
  }, []);

  // 음소거는 속성이 아니라 엘리먼트 값으로 건다(React 는 `muted` 를 첫 렌더 뒤에 다시 맞추지 않는다).
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted, ready]);

  // 재생 중에는 프레임마다 시계를 읽는다(초당 30칸으로 묶어서) — 재생 위치 막대가 계단처럼 튀지 않게.
  useFrameLoop(playing, () => {
    const v = videoRef.current;
    if (v) setTime(quantizePlayTime(v.currentTime));
  });

  const toggle = useCallback((): void => {
    if (blocked) return;
    const v = videoRef.current;
    if (!ready || !v) {
      wantPlayRef.current = true;
      setArmed(true);
      return;
    }
    if (v.paused || v.ended) void v.play().catch(onPlayRejected);
    else v.pause();
  }, [blocked, ready, onPlayRejected]);

  const seek = useCallback((fraction: number): void => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = fraction * v.duration;
    setTime(quantizePlayTime(v.currentTime));
  }, []);

  const total = duration > 0 ? duration : (thumb?.durationSec ?? 0);
  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  // 좁으면 덜 중요한 것부터 접는다 — 시간 글자 → 음소거. 재생 단추와 재생 위치는 끝까지 남는다.
  const showTime = width >= 220;
  const showMute = width >= 184;
  const playLabel = playing ? t('common.pause', { defaultValue: '일시정지' }) : t('common.play', { defaultValue: '재생' });
  const loading = media.status === 'loading';

  return (
    <FaceFrame>
      <FaceStage className="bg-black">
        {readyUrl !== null ? (
          <video
            ref={videoRef}
            src={readyUrl}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.muted = muted;
              if (Number.isFinite(v.duration)) setDuration(v.duration);
              if (wantPlayRef.current) {
                wantPlayRef.current = false;
                void v.play().catch(onPlayRejected);
              }
            }}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setDuration(d);
            }}
            onPlay={() => { setPlaying(true); holdPlayback(); }}
            onPause={() => { setPlaying(false); dropPlayback(); }}
            onEnded={(e) => {
              setPlaying(false);
              dropPlayback();
              setTime(quantizePlayTime(e.currentTarget.currentTime));
            }}
            onSeeked={(e) => setTime(quantizePlayTime(e.currentTarget.currentTime))}
            onError={() => {
              setPlaying(false);
              setDecodeFailed(true);
            }}
          />
        ) : (
          // 길이는 조작줄의 시간이 말한다 — 시간이 접힐 만큼 좁을 때만 모서리 숫자로(같은 사실 두 곳 ❌).
          <FaceStill
            thumb={thumb}
            loading={thumbLoading || loading}
            glow={glow}
            icon={icon}
            width={width}
            height={stageHeight}
            showDuration={!showTime}
          />
        )}
      </FaceStage>
      <FaceBar>
        <FaceButton label={playLabel} onClick={toggle} disabled={blocked}>
          {playing ? (
            <PauseGlyph />
          ) : loading ? (
            // 받는 중 — 누른 손이 먹혔다는 것을 단추가 숨 쉬며 말한다(서면 이어서 튼다).
            <span className="flex animate-pulse [&>svg]:h-3.5 [&>svg]:w-3.5">
              <PlayGlyph />
            </span>
          ) : (
            <PlayGlyph />
          )}
        </FaceButton>
        {blocked ? (
          <FaceNote>
            {media.status === 'tooLarge' && !decodeFailed
              ? t('panel.apps.canvas.tooLarge', { defaultValue: '여기서 열기엔 큽니다 — 에디터에서 여세요' })
              : t('panel.apps.canvas.unavailable', { defaultValue: '여기서는 열 수 없습니다 — 에디터에서 여세요' })}
          </FaceNote>
        ) : (
          <>
            <FaceSeek
              value={playFraction(time, total)}
              disabled={!ready}
              label={t('panel.videoStudio.seek', { defaultValue: '재생 위치' })}
              accent={glow}
              onSeek={seek}
            />
            {showTime ? <FaceTime current={time} duration={total} /> : null}
            {showMute ? (
              <FaceButton
                label={t('panel.vibisound.workbench.mute', { defaultValue: '음소거' })}
                active={muted}
                accent={glow}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <MutedGlyph /> : <VolumeGlyph />}
              </FaceButton>
            ) : null}
          </>
        )}
      </FaceBar>
    </FaceFrame>
  );
}
