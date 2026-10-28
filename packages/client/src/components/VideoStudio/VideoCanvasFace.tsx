import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CANVAS_FACE } from '@vibisual/shared';

import type { AppCanvasFaceProps } from '../../apps/registry.js';
import { useMediaBlobUrl } from '../../apps/useMediaBlobUrl.js';
import { formatMediaDuration } from '../../apps/appThumbnails.js';
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
import { useGraphStore } from '../../stores/graphStore.js';
import { fetchStillImage, readDocVersion, type DocVersion } from './videoApi.js';
import { STUDIO_APP_ID } from './studioAppId.js';
import { onAppEvent } from '../../apps/appEvents.js';
import { runWhenIdle } from './studioIdle.js';
import { GLOW_ONCE_MS, ensureStudioMotion } from './studioMotion.js';

/** §5.13 (L) — 묶인 작업 문서가 있으면 문서 모드(한 장 + 길이·판본, 렌더본이 있으면 [▶]), 없으면 결과 파일을 바로 튼다. */
export function VideoCanvasFace(props: AppCanvasFaceProps): React.JSX.Element {
  const [showExport, setShowExport] = useState(false);
  const { t } = useTranslation();
  const hasExport = props.file !== '';
  if (props.workRef && !(showExport && hasExport)) {
    return <VideoDocFace {...props} workRef={props.workRef} onPlayExport={hasExport ? () => setShowExport(true) : undefined} />;
  }
  if (props.workRef && showExport) {
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

/** 판본만 묻는 간격(ms), 보이는 노드만. §5.13 (Y) 40-7 ② — 주 신호는 서버 앱 알림이고 이건 소켓이 끊겼을 때의 안전망. */
const DOC_POLL_MS = 15_000;
/** 판본이 바뀐 뒤 이만큼 잠잠하면 포스터를 새로 찍는다(ms) — 에이전트가 연달아 고치는 동안 매번 찍지 않게. */
const POSTER_SETTLE_MS = 1200;
/** 찍어 둔 포스터 기억 — 판본마다 한 장, 상한을 넘으면 오래된 것부터 버린다(화면 밖에서 돌아와도 바로 보인다). */
const POSTER_CACHE_MAX = 32;
const posterCache = new Map<string, string>();

function rememberPoster(key: string, image: string): void {
  posterCache.delete(key);
  posterCache.set(key, image);
  while (posterCache.size > POSTER_CACHE_MAX) {
    const oldest = posterCache.keys().next().value;
    if (oldest === undefined) break;
    posterCache.delete(oldest);
  }
}

/** 포스터 시각 — 영상의 첫 프레임은 검은 화면·등장 전인 일이 흔하다. 길이의 35% 지점(마지막 프레임 앞까지). */
function posterTime(duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(duration * 0.35, duration - 1 / 30));
}

/** 이 앱의 id — 이 문서를 가리키는 노드를 고를 때 쓴다(레지스트리 항목과 같은 값). */
const APP_ID = 'vibistudio';
/**
 * §5.13 (V) 37-1 — 열린 바퀴를 "일하는 중"으로 믿는 상한(ms). 에이전트가 끝 보고 없이 쉬면 바퀴는 열린 채 남으므로, 마지막
 * 소식이 이보다 오래면 위성을 걷는다(이어진 에이전트가 아직 도는 중이면 그것이 먼저 말한다).
 */
const ACTIVITY_FRESH_MS = 10 * 60_000;

/**
 * §5.13 (V) 37-1 — 이 문서를 가리키는 노드에 이어진 에이전트가 도는가. 이어진 에이전트가 하나도 없으면 `null`(모른다 —
 * 바퀴 소식만으로 판정한다).
 */
function useLinkedAgentActive(projectName: string, docId: string): boolean | null {
  return useGraphStore((s) => {
    const ids = new Set<string>();
    for (const b of s.appBubbles ?? []) {
      if (b.appId === APP_ID && b.ref === docId && (projectName === '' || b.projectName === projectName)) {
        for (const id of b.linkedAgentIds ?? []) ids.add(id);
      }
    }
    if (ids.size === 0) return null;
    return (s.agents ?? []).some((a) => ids.has(a.id) && a.status === 'active');
  });
}

/** §5.13 (V) 37-1 — AI 가 만지는 동안 노드 모서리에 위성이 돌고 끝나면 한 번 빛난다(장면 구슬과 같은 표시). 색은 레지스트리 앱 색(`glow`) 하나. */
function WorkingSatellite({ working, glow }: { readonly working: boolean; readonly glow: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [flash, setFlash] = useState(false);
  const was = useRef(working);
  useEffect(() => { ensureStudioMotion(); }, []);
  useEffect(() => {
    if (was.current && !working) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), GLOW_ONCE_MS);
      was.current = working;
      return () => clearTimeout(timer);
    }
    was.current = working;
    return undefined;
  }, [working]);
  const accent = { '--vs-accent': glow } as React.CSSProperties;
  if (working) {
    return (
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-5 w-5 animate-[vs-orbit_2.4s_linear_infinite]" style={accent}
        role="status" aria-label={t('panel.videoStudio.strip.working')}>
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ backgroundColor: glow, boxShadow: `0 0 6px ${glow}` }} />
      </span>
    );
  }
  if (flash) {
    return <span className="pointer-events-none absolute inset-0 animate-[vs-glow-once_900ms_ease-out] rounded-[inherit]" style={accent} aria-hidden="true" />;
  }
  return null;
}

function VideoDocFace({
  projectId,
  projectName,
  workRef,
  width,
  height,
  glow,
  icon,
  onPlayExport,
}: AppCanvasFaceProps & { workRef: string; onPlayExport?: (() => void) | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  const project = projectName && projectName !== '' ? projectName : projectId;
  const [info, setInfo] = useState<DocVersion | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async (): Promise<void> => {
      try {
        const next = await readDocVersion(project, workRef);
        if (!active) return;
        setFailed(false);
        // 지금 하는 일(바퀴)이 바뀌어도 다시 그린다 — 위성이 그것을 보인다(§5.13 (V) 37-1).
        setInfo((prev) => (prev && prev.version === next.version && prev.updatedAt === next.updatedAt && prev.title === next.title
          && JSON.stringify(prev.activity ?? null) === JSON.stringify(next.activity ?? null) ? prev : next));
      } catch {
        if (active) setFailed(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), DOC_POLL_MS);
    const offEvent = onAppEvent(STUDIO_APP_ID, (event) => { if (event.key === workRef) void tick(); });
    return () => { active = false; clearInterval(timer); offEvent(); };
  }, [project, workRef]);

  useEffect(() => {
    if (!info) return;
    if (!(info.duration > 0)) { setPoster(null); return; }
    const key = JSON.stringify([project, workRef, info.version]);
    const cached = posterCache.get(key);
    if (cached) { setPoster(cached); return; }
    let active = true;
    const abort = new AbortController();
    // §5.13 (Y) 40-7 ④ · 40-10 ④ — 잠잠해지기를 기다린 뒤(디바운스 유지), 같은 창의 스튜디오가 재생·끌기·입력 중이면 쉬었다가 찍는다.
    void runWhenIdle(async () => {
      try {
        // 최종 렌더와 같은 경로(숨은 일꾼 창)로 한 장 — 코드 컴포지션도 그대로 보인다.
        const image = await fetchStillImage(project, workRef, posterTime(info.duration));
        rememberPoster(key, image);
        if (active) setPoster(image);
      } catch {
        // 못 찍었으면 아이콘으로 남는다 — 다음 판본이 다시 찍는다.
      }
    }, { delayMs: POSTER_SETTLE_MS, signal: abort.signal }).catch(() => undefined);
    return () => { active = false; abort.abort(); };
  }, [info, project, workRef]);

  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  const empty = info !== null && !(info.duration > 0);
  const agentActive = useLinkedAgentActive(projectName ?? '', workRef);
  const activity = info?.activity ?? null;
  const passOpen = activity?.status === 'open' && Date.now() - activity.at < ACTIVITY_FRESH_MS;
  const working = agentActive === null ? passOpen : agentActive && activity?.status === 'open';
  return (
    <FaceFrame>
      <FaceStage className="bg-black">
        <WorkingSatellite working={working} glow={glow} />
        {poster ? (
          <img src={poster} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />
        ) : empty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
            <span className="opacity-70 [&>svg]:h-5 [&>svg]:w-5" style={{ color: glow }}>{icon}</span>
            <span className="text-[12px] leading-tight text-white/55">{t('panel.apps.canvas.docEmpty', { defaultValue: 'Empty video — ask the linked AI or open the editor' })}</span>
          </div>
        ) : (
          <FaceStill thumb={null} loading={!failed} glow={glow} icon={icon} width={width} height={stageHeight} />
        )}
      </FaceStage>
      <FaceBar>
        {onPlayExport ? (
          <FaceButton label={t('panel.apps.canvas.playExport', { defaultValue: 'Play the last render' })} onClick={onPlayExport}>
            <PlayGlyph />
          </FaceButton>
        ) : null}
        <FaceNote title={info?.title}>
          {failed && !info
            ? t('panel.apps.canvas.docUnreadable', { defaultValue: 'Could not read the document — open the editor' })
            : info
              ? `${info.title}${info.duration > 0 ? ` · ${formatMediaDuration(info.duration)}` : ''}`
              : ''}
        </FaceNote>
        {info ? (
          <span className="shrink-0 whitespace-nowrap px-1 text-[12px] leading-none tabular-nums text-white/45">
            {t('panel.apps.canvas.docVersion', { defaultValue: 'v{{version}}', version: info.version })}
          </span>
        ) : null}
      </FaceBar>
    </FaceFrame>
  );
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
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={(e) => {
              setPlaying(false);
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
