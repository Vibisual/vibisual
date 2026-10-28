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
  FaceWave,
  PauseGlyph,
  PlayGlyph,
  playFraction,
  quantizePlayTime,
  useFrameLoop,
} from '../../apps/canvasFaceKit.js';

/**
 * §5.4 #36 (G) — Vibisound 노드 화면(구운 파형). 처음 [재생]·파형 누름에 결과 파일을 받는다(`useMediaBlobUrl` — 패키지 앱에서 엘리먼트 `/api` 는 빈다).
 * 소리 엘리먼트는 DOM 밖. 파형 전체가 재생 위치 자리(`nodrag nopan`)라 노드는 머리줄·테두리로 끈다. 파형이 없으면 조작줄 막대가 대신.
 */
export function SoundCanvasFace({
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
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** 받았는데 브라우저가 못 푸는 형식 — 조용히 무음으로 남지 않고 조작줄이 "에디터에서 여세요"로 말한다(멀티플랫폼 6축). */
  const [decodeFailed, setDecodeFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 받는 중에 들어온 손 — 서면 그 자리로 가서(있으면) 튼다. */
  const pendingRef = useRef<{ play: boolean; seek: number | null }>({ play: false, seek: null });
  const waveDragRef = useRef(false);
  const waveRef = useRef<HTMLDivElement>(null);

  // 다른 결과가 오면(파일·버전) 처음으로 — 받은 URL 은 훅이 되돌린다.
  useEffect(() => {
    setArmed(false);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setDecodeFailed(false);
    pendingRef.current = { play: false, seek: null };
  }, [projectId, file, version]);

  const media = useMediaBlobUrl({ projectId, file, version, enabled: armed, maxBytes: APP_CANVAS_FACE.playMaxBytes });
  const readyUrl = media.status === 'ready' && !decodeFailed ? media.url : null;
  const blocked = media.status === 'tooLarge' || media.status === 'failed' || decodeFailed;
  const loading = media.status === 'loading';

  // 소리 엘리먼트 — URL 하나에 하나. URL 이 바뀌거나 언마운트되면 멈추고 놓는다.
  useEffect(() => {
    if (readyUrl === null) return undefined;
    const a = new Audio(readyUrl);
    a.preload = 'auto';
    audioRef.current = a;
    const onMeta = (): void => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
      const pending = pendingRef.current;
      if (pending.seek !== null && Number.isFinite(a.duration) && a.duration > 0) {
        a.currentTime = pending.seek * a.duration;
        setTime(quantizePlayTime(a.currentTime));
      }
      pending.seek = null;
      if (pending.play) {
        pending.play = false;
        void a.play().catch(() => setPlaying(false));
      }
    };
    const onPlay = (): void => setPlaying(true);
    const onStop = (): void => {
      setPlaying(false);
      setTime(quantizePlayTime(a.currentTime));
    };
    const onError = (): void => {
      setPlaying(false);
      setDecodeFailed(true);
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onStop);
    a.addEventListener('ended', onStop);
    a.addEventListener('error', onError);
    return () => {
      a.pause();
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onStop);
      a.removeEventListener('ended', onStop);
      a.removeEventListener('error', onError);
      a.removeAttribute('src');
      a.load();
      if (audioRef.current === a) audioRef.current = null;
      setPlaying(false);
    };
  }, [readyUrl]);

  useFrameLoop(playing, () => {
    const a = audioRef.current;
    if (a) setTime(quantizePlayTime(a.currentTime));
  });

  const toggle = useCallback((): void => {
    if (blocked) return;
    const a = audioRef.current;
    if (!a) {
      pendingRef.current.play = true;
      setArmed(true);
      return;
    }
    if (a.paused || a.ended) void a.play().catch(() => setPlaying(false));
    else a.pause();
  }, [blocked]);

  /** 그 비율 자리로. 아직 안 받았으면 받고 나서 그 자리부터 튼다(파형을 누른 손은 "여기부터 듣겠다"는 뜻이다). */
  const seek = useCallback(
    (fraction: number): void => {
      if (blocked) return;
      const a = audioRef.current;
      if (!a || !Number.isFinite(a.duration) || a.duration <= 0) {
        pendingRef.current = { play: true, seek: fraction };
        setArmed(true);
        return;
      }
      a.currentTime = fraction * a.duration;
      setTime(quantizePlayTime(a.currentTime));
    },
    [blocked],
  );

  const waveFraction = (clientX: number): number => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const total = duration > 0 ? duration : (thumb?.durationSec ?? 0);
  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  const wave = thumb?.kind === 'wave' ? thumb.peaks : null;
  const fraction = playFraction(time, total);
  const started = readyUrl !== null && (playing || time > 0);
  const seekLabel = t('panel.videoStudio.seek', { defaultValue: '재생 위치' });
  const playLabel = playing ? t('common.pause', { defaultValue: '일시정지' }) : t('common.play', { defaultValue: '재생' });

  return (
    <FaceFrame>
      <FaceStage className="bg-[#07090D]">
        {wave ? (
          <div
            ref={waveRef}
            role="slider"
            aria-label={seekLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
            title={seekLabel}
            className={`${FACE_CONTROL} absolute inset-0 ${blocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            onPointerDown={(e) => {
              if (blocked || e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              waveDragRef.current = true;
              seek(waveFraction(e.clientX));
            }}
            onPointerMove={(e) => {
              if (!waveDragRef.current || audioRef.current === null) return;
              seek(waveFraction(e.clientX));
            }}
            onPointerUp={(e) => {
              waveDragRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              waveDragRef.current = false;
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* 길이는 아래 조작줄의 시간이 말한다 — 모서리 숫자를 겹쳐 두지 않는다(같은 사실 두 곳 ❌). */}
            <FaceWave peaks={wave} width={width} height={stageHeight} glow={glow} played={started ? fraction : null} />
          </div>
        ) : (
          <FaceStill
            thumb={thumb}
            loading={thumbLoading || loading}
            glow={glow}
            icon={icon}
            width={width}
            height={stageHeight}
            showDuration={width < 220}
          />
        )}
      </FaceStage>
      <FaceBar>
        <FaceButton label={playLabel} onClick={toggle} disabled={blocked}>
          {playing ? (
            <PauseGlyph />
          ) : loading ? (
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
        ) : wave ? (
          <>
            <FaceTime current={time} duration={total} />
            <span className="min-w-0 flex-1" />
          </>
        ) : (
          <>
            <FaceSeek value={fraction} disabled={readyUrl === null} label={seekLabel} accent={glow} onSeek={seek} />
            {width >= 220 ? <FaceTime current={time} duration={total} /> : null}
          </>
        )}
      </FaceBar>
    </FaceFrame>
  );
}
