import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CANVAS_FACE, APP_THUMB } from '@vibisual/shared';

import type { AppCanvasFaceProps } from '../../apps/registry.js';
import {
  FACE_BAR_HEIGHT,
  FACE_CONTROL,
  FaceBar,
  FaceButton,
  FaceFrame,
  FaceNote,
  FaceStage,
  FaceStill,
  ResetViewGlyph,
  SpinGlyph,
  useFrameLoop,
} from '../../apps/canvasFaceKit.js';
import type { LiveModel, LiveView, OrbitAngles } from './modelCanvasLive.js';

/**
 * §5.4 #36 (G) — Vibi3D 노드 화면의 안쪽: **캔버스에서 바로 돌려 본다.**
 *
 * 평소에는 코어가 구운 정지 화면이다. 결과 위를 누르고 끌면 그때 장면이 살아난다(three·모델 로더는 이 순간 늦게 온다 —
 * `modelCanvasLive`). 할 수 있는 것은 셋 — 끌어 돌려 보기 · 자동 회전 · 처음 구도로. 고치기(변형·재질)는 더블클릭·
 * [에디터에서 열기]로 여는 편집 화면의 몫이다.
 *
 * **노드마다 살아 있는 WebGL 문맥을 오래 두지 않는다.** 손을 떼고(자동 회전도 꺼져 있고) `APP_CANVAS_FACE.liveIdleMs` 가
 * 지나면 그 각도의 한 장을 찍어 정지 화면으로 남기고 문맥을 돌려준다. 모델은 노드가 화면에 있는 동안 붙들어 다시 손이 닿으면
 * 곧바로 이어 돈다(각도도 이어진다). 다른 결과가 오거나 노드가 언마운트되면 전부 놓는다.
 *
 * 결과 위 전체가 돌려 보기 자리다(`nodrag nopan`) — 그래서 이 화면은 머리줄·테두리로 끈다.
 */
type Phase = 'still' | 'loading' | 'live' | 'tooLarge' | 'failed';

/** 살아 있는 장면을 결과 자리 안쪽으로 이만큼(px) 들인다 — 정지 미리보기(`object-contain p-1.5`)와 같은 여백이라 손을 대도 그림이 튀지 않는다. */
const LIVE_INSET = 6;

export function ModelCanvasFace({
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
  const [phase, setPhase] = useState<Phase>('still');
  const [spinning, setSpinning] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<LiveModel | null>(null);
  const viewRef = useRef<LiveView | null>(null);
  const anglesRef = useRef<OrbitAngles | null>(null);
  const loadRef = useRef<Promise<LiveView | null> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const spinningRef = useRef(false);
  const snapshotRef = useRef<string | null>(null);
  /** 결과 세대 — 다른 결과로 넘어가거나 언마운트되면 올라가, 늦게 끝난 읽기를 버리게 한다. */
  const genRef = useRef(0);

  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  const liveSize = { width: Math.max(1, width - LIVE_INSET * 2), height: Math.max(1, stageHeight - LIVE_INSET * 2) };
  const liveSizeRef = useRef(liveSize);
  liveSizeRef.current = liveSize;
  const blocked = phase === 'tooLarge' || phase === 'failed';

  // 둘 다 ref·setState 만 만진다 — 한 번 만들어 계속 쓴다.
  const clearIdle = useCallback((): void => {
    if (idleRef.current !== null) clearTimeout(idleRef.current);
    idleRef.current = null;
  }, []);

  const replaceSnapshot = useCallback((url: string | null): void => {
    if (snapshotRef.current !== null) URL.revokeObjectURL(snapshotRef.current);
    snapshotRef.current = url;
    setSnapshot(url);
  }, []);

  // 다른 결과가 오면(파일·버전) 처음으로, 언마운트되면 전부 놓는다 — 보기(문맥)·모델·찍어 둔 한 장.
  useEffect(() => {
    genRef.current += 1;
    setPhase('still');
    setSpinning(false);
    spinningRef.current = false;
    anglesRef.current = null;
    replaceSnapshot(null);
    return () => {
      genRef.current += 1;
      clearIdle();
      const view = viewRef.current;
      viewRef.current = null;
      if (view) {
        view.canvas.remove();
        view.dispose();
      }
      modelRef.current?.dispose();
      modelRef.current = null;
      loadRef.current = null;
      dragRef.current = null;
      if (snapshotRef.current !== null) URL.revokeObjectURL(snapshotRef.current);
      snapshotRef.current = null;
    };
  }, [projectId, file, version, clearIdle, replaceSnapshot]);

  /** 장면을 살린다(이미 살아 있으면 그것). 모델은 한 번만 읽는다. 못 살리면 `null`. */
  const ensureLive = useCallback(async (): Promise<LiveView | null> => {
    if (viewRef.current) return viewRef.current;
    if (loadRef.current) return loadRef.current;
    const gen = genRef.current;
    const job = (async (): Promise<LiveView | null> => {
      try {
        const lib = await import('./modelCanvasLive.js');
        if (gen !== genRef.current) return null;
        let model = modelRef.current;
        if (!model) {
          setPhase('loading');
          const loaded = await lib.loadLiveModel(projectId, file);
          if (gen !== genRef.current) {
            if (loaded.ok) loaded.model.dispose();
            return null;
          }
          if (!loaded.ok) {
            setPhase(loaded.reason);
            return null;
          }
          model = loaded.model;
          modelRef.current = model;
        }
        const host = hostRef.current;
        if (!host) return null;
        const angles = anglesRef.current ?? lib.homeAngles();
        anglesRef.current = angles;
        const ratio = Math.min(APP_THUMB.pixelRatioMax, Math.max(1, window.devicePixelRatio || 1));
        const size = liveSizeRef.current;
        const view = lib.createLiveView(model, size.width, size.height, ratio, angles);
        host.appendChild(view.canvas);
        view.render();
        viewRef.current = view;
        setPhase('live');
        return view;
      } catch {
        if (gen === genRef.current) setPhase('failed');
        return null;
      }
    })();
    loadRef.current = job;
    try {
      return await job;
    } finally {
      if (loadRef.current === job) loadRef.current = null;
    }
  }, [projectId, file]);

  /** 손을 떼고 잠시 지나면 — 그 각도의 한 장을 남기고 문맥을 돌려준다(모델은 남긴다). */
  const retire = useCallback(async (): Promise<void> => {
    idleRef.current = null;
    const view = viewRef.current;
    if (!view || spinningRef.current || dragRef.current) return;
    const gen = genRef.current;
    const url = await view.snapshot();
    if (gen !== genRef.current || viewRef.current !== view || spinningRef.current || dragRef.current) {
      if (url !== null) URL.revokeObjectURL(url);
      return;
    }
    viewRef.current = null;
    view.canvas.remove();
    view.dispose();
    replaceSnapshot(url);
    setPhase('still');
  }, [replaceSnapshot]);

  const scheduleIdle = useCallback((): void => {
    clearIdle();
    idleRef.current = setTimeout(() => {
      void retire();
    }, APP_CANVAS_FACE.liveIdleMs);
  }, [clearIdle, retire]);

  // 자리가 바뀌면(노드 크기 조절) 살아 있는 장면도 따라간다.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setSize(liveSize.width, liveSize.height);
    view.render();
  }, [liveSize.width, liveSize.height]);

  // 자동 회전 — 살아 있는 동안 프레임마다 조금씩.
  useFrameLoop(spinning && phase === 'live', (dt) => {
    const view = viewRef.current;
    if (!view) return;
    view.orbit(APP_CANVAS_FACE.spinDegPerSec * dt, 0);
    view.render();
  });

  const toggleSpin = (): void => {
    if (blocked) return;
    const next = !spinning;
    setSpinning(next);
    spinningRef.current = next;
    if (next) {
      clearIdle();
      void ensureLive();
    } else {
      scheduleIdle();
    }
  };

  /** 처음 구도로. 살아 있지 않으면 장면을 깨우지 않는다 — 정지 미리보기가 곧 처음 구도다. */
  const resetView = (): void => {
    if (blocked) return;
    const view = viewRef.current;
    if (view) {
      view.home();
      view.render();
      if (!spinningRef.current) scheduleIdle();
      return;
    }
    anglesRef.current = null;
    replaceSnapshot(null);
  };

  const dragLabel = t('panel.apps.canvas.dragRotate', { defaultValue: '끌어서 돌려 보기' });
  const note = phase === 'tooLarge'
    ? t('panel.apps.canvas.tooLarge', { defaultValue: '여기서 열기엔 큽니다 — 에디터에서 여세요' })
    : phase === 'failed'
      ? t('panel.apps.canvas.unavailable', { defaultValue: '여기서는 열 수 없습니다 — 에디터에서 여세요' })
      : phase === 'loading'
        ? t('ide.explorer.loading', { defaultValue: '불러오는 중…' })
        : dragLabel;

  return (
    <FaceFrame>
      <FaceStage className="bg-[#07090D]">
        {phase !== 'live' ? (
          snapshot !== null ? (
            <img
              src={snapshot}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain p-1.5"
            />
          ) : (
            <FaceStill thumb={thumb} loading={thumbLoading || phase === 'loading'} glow={glow} icon={icon} width={width} height={stageHeight} />
          )
        ) : null}
        {/* three 의 캔버스가 붙는 자리 — 정지 화면과 같은 여백(LIVE_INSET). */}
        <div ref={hostRef} className="pointer-events-none absolute inset-1.5" />
        {/* 돌려 보기 자리 — 결과 위 전체. 누르는 순간 장면이 깨고, 끄는 만큼 돈다. */}
        <div
          title={dragLabel}
          className={`${FACE_CONTROL} absolute inset-0 ${blocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={(e) => {
            if (blocked || e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, y: e.clientY };
            clearIdle();
            void ensureLive();
          }}
          onPointerMove={(e) => {
            const from = dragRef.current;
            if (!from) return;
            dragRef.current = { x: e.clientX, y: e.clientY };
            const view = viewRef.current;
            if (!view) return;
            const k = APP_CANVAS_FACE.orbitDegPerPx;
            view.orbit(-(e.clientX - from.x) * k, (e.clientY - from.y) * k);
            view.render();
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            if (!spinningRef.current) scheduleIdle();
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            if (!spinningRef.current) scheduleIdle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </FaceStage>
      <FaceBar>
        <FaceButton
          label={t('panel.vibi3d.spin', { defaultValue: '자동 회전' })}
          active={spinning}
          accent={glow}
          onClick={toggleSpin}
          disabled={blocked}
        >
          <SpinGlyph />
        </FaceButton>
        <FaceButton label={t('panel.vibi3d.frame', { defaultValue: '화면에 맞추기' })} onClick={resetView} disabled={blocked}>
          <ResetViewGlyph />
        </FaceButton>
        <FaceNote title={note}>{note}</FaceNote>
      </FaceBar>
    </FaceFrame>
  );
}
