import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeResizer, useStore, useStoreApi, type NodeProps } from '@xyflow/react';
import { CAPTURE_BUBBLE_DEFAULTS, CAPTURE_PLAYTEST, CAPTURE_SNAP, type CaptureSourceKind } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useCaptureSnapGuideStore } from '../../stores/captureSnapGuides.js';
import { useCanvasCovered } from '../../stores/canvasVisibility.js';
import { computeCaptureResizeSnap, type SnapRect } from './captureSnap.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCaptureStream, type CaptureQuality } from '../../hooks/useCaptureStream.js';
import { useCaptureRemoteControl } from '../../hooks/useCaptureRemoteControl.js';
import { useCaptureRecorder } from '../../hooks/useCaptureRecorder.js';
import { useCapturePrefs } from '../../stores/captureBubblePrefs.js';
import { useCaptureRuntime } from '../../stores/captureBubbleRuntime.js';
import { useIsPlaytestRecording } from '../../stores/capturePlaytest.js';
import { formatClipDuration } from './playtestClip.js';
import { useTranslation } from 'react-i18next';
import { CaptureControlOverlay } from './CaptureControlOverlay.js';
import { CaptureWindow } from './CaptureWindow.js';

export interface CaptureNodeData {
  captureBubbleId: string;
  sourceId: string;
  sourceName: string;
  sourceKind: CaptureSourceKind;
  width: number;
  height: number;
}

/** CaptureNode 가 "다시 선택"을 요청할 때 BubbleMap 이 듣는 커스텀 이벤트. */
export const CAPTURE_REPICK_EVENT = 'vibisual:capture:repick';

/**
 * DetailPanel(CaptureBubbleDetail)의 "스냅샷 저장" 버튼이 발행 → 해당 CaptureNode 가 듣고
 * 자기 <video> 프레임을 PNG 로 저장한다. 스냅샷은 노드의 videoRef 에 묶여 있어 패널에서 직접
 * 못 하므로 repick 과 동일한 window CustomEvent 위임 패턴을 쓴다(detail.id 로 대상 버블 매칭).
 */
export const CAPTURE_SNAPSHOT_EVENT = 'vibisual:capture:snapshot';

/**
 * DetailPanel 의 "실제 비율 맞추기" 버튼이 발행 → 해당 CaptureNode 가 자기 <video> 의
 * videoWidth/Height 로 버블 높이를 다시 잡아 **레터박스(검은 띠)를 없앤다**. 이어 붙이기(§5.9
 * 자석 스냅)로 버블을 맞대 붙여도 각 버블 안에 검은 띠가 남아 있으면 화면이 이어져 보이지 않으므로,
 * 비율 맞추기는 이어 붙이기와 한 짝이다. 비율은 실제 프레임에만 있으므로 스냅샷과 같은 위임 패턴.
 */
export const CAPTURE_FIT_EVENT = 'vibisual:capture:fit';

/**
 * §5.9 플레이테스트 — DetailPanel·크게 보기 창의 녹화 버튼이 발행 → 그 버블의 CaptureNode 가 듣고
 * **자기 스트림**을 녹화한다(녹화기는 스트림을 쥔 이 노드에만 있다 — 두 번째 getUserMedia ❌).
 * detail.action 이 없으면 토글. 스냅샷·비율 맞추기와 같은 위임 패턴.
 */
export const CAPTURE_RECORD_EVENT = 'vibisual:capture:record';

/** 데이터 절감 화질 프리셋(외부·모바일 접속). 낮출수록 해상도·FPS↓ → CPU/대역폭↓. */
interface CaptureQualityPreset extends CaptureQuality {
  /** i18n 키 suffix + 표시 라벨 fallback. */
  key: string;
  label: string;
}
const CAPTURE_QUALITY_PRESETS: readonly CaptureQualityPreset[] = [
  { key: 'full', label: '원본', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 },
  { key: 'saver', label: '절약', maxWidth: 1280, maxHeight: 720, maxFrameRate: 15 },
  { key: 'min', label: '최소', maxWidth: 854, maxHeight: 480, maxFrameRate: 8 },
];

/** 헤더 액션 버튼(호버 시 나타나는 아이콘 툴바)이 접히는 최소 버블 폭 — 좁으면 아이콘이 제목을 잡아먹는다. */
const TOOLBAR_MIN_WIDTH = 220;

/**
 * §5.9 화면/프로그램 캡처 버블 — 네모난 라이브 영상 노드(CommentBox 패턴).
 *
 * 헤더 strip 에서만 드래그/선택(캔버스 팬 보존). 본체는 getUserMedia(desktop) 라이브 MediaStream 을
 * <video> 로 그린다(useCaptureStream). 소스를 못 찾으면(창 닫힘/재시작으로 핸들 변경) "다시 선택"
 * 안내를 띄우고, 클릭 시 커스텀 이벤트로 BubbleMap 의 소스 picker 를 연다.
 *
 * v3.56 외형 개편 — ① 크롬(테두리·헤더)을 rose 색면에서 **그래파이트 글라스**로 바꿔 영상이 주인공이
 * 되게 하고, 색은 라이브 도트(붉음)·선택 링(스카이)·조작 중 링(에메랄드)에만 남긴다. ② 헤더 오른쪽에
 * **호버 시 떠오르는 아이콘 툴바**(일시정지·스냅샷·크게 보기·소스 변경·설정)를 둬서, 우측 패널을
 * 모르는 사람도 버블 위에서 바로 조작할 수 있게 한다(종전엔 모든 조작이 패널에만 있어 발견 불가).
 * ③ 상태(라이브·일시정지·조작 중·보기 전용·핀)를 글리프 칩으로 한눈에 보여준다.
 */
export const CaptureNode = memo(function CaptureNode({
  data,
  selected,
  dragging,
  width: nodeWidth,
  height: nodeHeight,
}: NodeProps): React.JSX.Element {
  const d = data as unknown as CaptureNodeData;
  const { t } = useTranslation();
  const updateCaptureBubble = useGraphStore((s) => s.updateCaptureBubble);
  const patchCaptureBubbleLocal = useGraphStore((s) => s.patchCaptureBubbleLocal);
  const setCaptureBubbleDragLock = useGraphStore((s) => s.setCaptureBubbleDragLock);
  const selectCaptureBubble = useGraphStore((s) => s.selectCaptureBubble);
  const selectedCaptureBubbleId = useGraphStore((s) => s.selectedCaptureBubbleId);
  // 선택 링은 `selectIntentId`(캔버스가 나눠 쓰는 "지금 고른 것 한 칸")도 함께 본다 —
  // 더블클릭 지연(`bubbleSelectGesture`) 동안 눈에 보이는 반응을 내는 것이 그 칸이다.
  const selectIntentId = useGraphStore((s) => s.selectIntentId);

  const liveWidth = nodeWidth ?? d.width;
  const liveHeight = nodeHeight ?? d.height;
  const isSelected = selected
    || selectedCaptureBubbleId === d.captureBubbleId
    || selectIntentId === d.captureBubbleId;

  // §5.9 뷰/조작 환경설정(localStorage 영속) — 화질모드·핀·불투명도·정지절전·읽기전용·타임아웃·배지.
  // 설정 편집 UI 는 DetailPanel(CaptureBubbleDetail)이 본진이고, 자주 쓰는 몇 개만 헤더 툴바에 둔다.
  const [prefs, setPrefs] = useCapturePrefs(d.captureBubbleId);

  // 일시정지(freeze)·원격 조작(controlMode)·크게 보기(expanded)는 DetailPanel 과 공유해야 하므로
  // 지역 useState 대신 버블 id 별 런타임 스토어에서 읽는다(비영속).
  // 캔버스 줌 — 복제 커서를 진짜 커서와 같은 크기로 그리려면 1/zoom 으로 되돌려야 한다(v3.65).
  const canvasZoom = useStore((s) => s.transform[2]);
  const [runtime, setRuntime] = useCaptureRuntime(d.captureBubbleId);
  const { frozen, controlMode, expanded } = runtime;

  // 데이터 절감 — 화질 프리셋 + 수동 일시정지(freeze) + 오프스크린 자동 절전.
  const [onScreen, setOnScreen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // ABR(적응형) — 'auto' 모드일 때 fps 측정으로 자동 조절되는 프리셋 인덱스.
  const [autoIndex, setAutoIndex] = useState(0);
  const [fps, setFps] = useState(0);
  const fpsRef = useRef(0);
  // 정지화면 감지 — 움직임이 없으면 idle(저fps 절전).
  const [idle, setIdle] = useState(false);

  const fixedIndex = prefs.qualityMode === 'saver' ? 1 : prefs.qualityMode === 'min' ? 2 : 0;
  const effectiveIndex = prefs.qualityMode === 'auto' ? autoIndex : fixedIndex;
  const basePreset = CAPTURE_QUALITY_PRESETS[effectiveIndex] ?? CAPTURE_QUALITY_PRESETS[0]!;
  // 정지화면 절전 중이면 프레임레이트를 확 낮춘다(해상도는 유지 — 움직임 재개 시 즉시 선명).
  const quality: CaptureQuality = idle && prefs.stillSaver
    ? { maxWidth: basePreset.maxWidth, maxHeight: basePreset.maxHeight, maxFrameRate: Math.min(2, basePreset.maxFrameRate) }
    : basePreset;
  // §4 v3.71 가시성 LOD — IntersectionObserver(onScreen)는 "뷰포트 밖"만 보고 "다른 UI 에 덮임"은
  //   못 본다. IDE 를 최대화한 채 라이브 화면을 계속 디코딩하던 낭비를 끊는다. 단 크게보기 창은
  //   캔버스 밖(body portal)에 떠 있어 덮임과 무관하게 보이고, 원격 조작 중이면 끊으면 안 된다.
  const canvasCovered = useCanvasCovered();
  // §5.9 플레이테스트 — 녹화 중에는 절전(일시정지·오프스크린·덮임 LOD)이 스트림을 내리지 않는다.
  //   중간에 끊기면 그 구간이 통째로 비고, 사용자는 무엇이 빠졌는지 알 방법이 없다.
  const playtestRecording = useIsPlaytestRecording(d.captureBubbleId);
  const streamEnabled = playtestRecording
    || (!frozen && onScreen && (!canvasCovered || expanded || controlMode !== 'off'));

  const { stream, error, loading } = useCaptureStream(d.sourceId, streamEnabled, quality);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // §5.9 v3.34 — 헤더 더블클릭 시 라이브 영상을 "앱 내부 IDE식 창"(CaptureWindow)으로 크게 본다.
  // 캔버스 노드는 그대로 두고 같은 MediaStream 을 창의 <video> 로 그린다. 창은 가운데 뜬 뒤 이동·확대·
  // 리사이즈되고, 여러 버블의 창을 동시에 열면 멀티 윈도우가 된다(종전 풀스크린 확대를 대체).
  // expanded 는 위 런타임 스토어에서 온다 — 헤더 더블클릭·DetailPanel "크게 보기" 양쪽에서 연다.

  // §5.9 Phase B(v3.43) — 원격 조작은 `off/touch/mouse` 3상태 한 축이고 기본은 off. 조작 로직은
  // 크게 보기 창(CaptureWindow)과 공유하는 useCaptureRemoteControl 훅이 전부 들고 있다.
  const control = useCaptureRemoteControl({
    mode: controlMode,
    sourceId: d.sourceId,
    sourceKind: d.sourceKind,
    sourceName: d.sourceName,
    videoRef,
    surfaceRef: bodyRef,
    stream,
    timeoutSec: prefs.controlTimeoutSec,
    readOnly: prefs.readOnly,
    backgroundClick: prefs.backgroundClick,
    onDisengage: useCallback(() => setRuntime({ controlMode: 'off' }), [setRuntime]),
  });

  // §5.9 플레이테스트 — 지금 붙어 있는 그 스트림을 그대로 클립으로 담는다(새 캡처 레이어 ❌).
  const recorder = useCaptureRecorder({
    captureBubbleId: d.captureBubbleId,
    sourceName: d.sourceName,
    stream,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => { /* autoplay 차단은 muted 라 발생하지 않음 */ });
  }, [stream]);

  // 버블이 뷰포트 밖으로 나가면 스트림을 내려 절전(외부 접속 데이터·CPU 절감). 다시 보이면 자동 재개.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => { const e = entries[0]; if (e) setOnScreen(e.isIntersecting); },
      { root: null, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // fps 측정 — requestVideoFrameCallback 로 초당 프레임을 센다(배지 + ABR 입력). 미지원이면 0.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) { setFps(0); fpsRef.current = 0; return; }
    const rvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    if (typeof rvfc.requestVideoFrameCallback !== 'function') return;
    let frames = 0;
    let handle = 0;
    const onFrame = (): void => { frames++; handle = rvfc.requestVideoFrameCallback!(onFrame); };
    handle = rvfc.requestVideoFrameCallback(onFrame);
    const iv = setInterval(() => { fpsRef.current = frames; setFps(frames); frames = 0; }, 1000);
    return () => { clearInterval(iv); rvfc.cancelVideoFrameCallback?.(handle); };
  }, [stream]);

  // ABR — 'auto' 모드에서 fps 가 목표 대비 낮으면 화질↓, 여유로우면 화질↑(2.5초 주기).
  useEffect(() => {
    if (prefs.qualityMode !== 'auto' || !stream) return;
    const iv = setInterval(() => {
      setAutoIndex((cur) => {
        const target = (CAPTURE_QUALITY_PRESETS[cur] ?? CAPTURE_QUALITY_PRESETS[0]!).maxFrameRate;
        const f = fpsRef.current;
        if (f > 0 && f < target * 0.55 && cur < CAPTURE_QUALITY_PRESETS.length - 1) return cur + 1;
        if (f >= target * 0.9 && cur > 0) return cur - 1;
        return cur;
      });
    }, 2500);
    return () => clearInterval(iv);
  }, [prefs.qualityMode, stream]);

  // 정지화면 감지 — 32×18 다운스케일 샘플의 프레임간 차이가 작으면 idle(움직임 재개 시 해제).
  useEffect(() => {
    if (!prefs.stillSaver || !stream) { setIdle(false); return; }
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let prev: Uint8ClampedArray | null = null;
    let stillCount = 0;
    const iv = setInterval(() => {
      if (!video.videoWidth) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const cur = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      if (prev) {
        let diff = 0;
        for (let i = 0; i < cur.length; i += 4) diff += Math.abs((cur[i] ?? 0) - (prev[i] ?? 0));
        const avg = diff / (cur.length / 4);
        if (avg < 2.5) { stillCount++; if (stillCount >= 3) setIdle(true); }
        else { stillCount = 0; setIdle(false); }
      }
      prev = cur;
    }, 700);
    return () => clearInterval(iv);
  }, [prefs.stillSaver, stream]);

  // 현재 프레임을 PNG 로 저장(스냅샷).
  const saveSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capture-${d.sourceName || 'screen'}-${Date.now()}.png`.replace(/[^\w.-]+/g, '_');
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }, [d.sourceName]);

  // DetailPanel "스냅샷 저장" 버튼 위임 — 이 버블 id 로 온 이벤트면 현재 프레임을 PNG 로 저장.
  useEffect(() => {
    const onSnapshot = (e: Event): void => {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id === d.captureBubbleId) saveSnapshot();
    };
    window.addEventListener(CAPTURE_SNAPSHOT_EVENT, onSnapshot);
    return () => window.removeEventListener(CAPTURE_SNAPSHOT_EVENT, onSnapshot);
  }, [d.captureBubbleId, saveSnapshot]);

  // DetailPanel·크게 보기 창의 녹화 버튼 위임 — 이 버블 id 로 온 이벤트면 녹화를 켜고 끈다.
  useEffect(() => {
    const onRecord = (e: Event): void => {
      const detail = (e as CustomEvent<{ id?: string; action?: 'start' | 'stop' | 'toggle' }>).detail;
      if (detail?.id !== d.captureBubbleId) return;
      if (detail.action === 'start') recorder.start();
      else if (detail.action === 'stop') recorder.stop();
      else recorder.toggle();
    };
    window.addEventListener(CAPTURE_RECORD_EVENT, onRecord);
    return () => window.removeEventListener(CAPTURE_RECORD_EVENT, onRecord);
  }, [d.captureBubbleId, recorder]);

  /**
   * 헤더의 선택·더블클릭 — 에이전트(IDE) 버블과 **같은 상태기계 한 벌**(`bubbleSelectGesture`).
   *
   * 종전에는 헤더 `onClick` 이 곧바로 선택해서, 창을 열려고 더블클릭하면 1타에서 우측 설정
   * 패널이 함께 열렸다. 이제 실제 선택은 240ms 뒤이고, 그 안에 두 번째 누름이 오면 접힌다.
   * 헤더의 아이콘 툴바(일시정지·스냅샷·크게 보기…)에서 시작한 누름은 `ignore` 로 걸러 낸다.
   */
  const gesture = useBubbleSelectGesture({
    doubleClickable: true,
    select: () => selectCaptureBubble(d.captureBubbleId),
    setIntent: (active) => {
      useGraphStore.getState().setSelectIntent(active ? d.captureBubbleId : null);
    },
    ignore: (e) => isInteractiveTarget(e.target),
  });

  // 헤더 더블클릭 → 앱 내부 IDE식 창 열기(CaptureWindow). React Flow 의 더블클릭 줌과 충돌 방지.
  // 창은 닫기(X)/Escape 로 닫으므로 여기선 열기만(이미 열려 있으면 no-op — 버블당 창 하나).
  const handleHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    gesture.cancelPendingSelect();
    setRuntime({ expanded: true });
  }, [gesture, setRuntime]);

  const requestRepick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(CAPTURE_REPICK_EVENT, { detail: { id: d.captureBubbleId } }));
  }, [d.captureBubbleId]);

  // §5.9 이어 붙이기(자석 스냅) — 리사이즈 쪽. 드래그 쪽은 BubbleMap 이 같은 유틸로 처리한다.
  // 줌은 useStoreApi 로 그때그때 읽는다(useStore 구독으로 받으면 줌 조작마다 모든 캡처 노드가
  // 리렌더된다 — 라이브 영상 노드엔 불필요한 비용).
  const rfStore = useStoreApi();
  const resizeSnapRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const setSnapGuides = useCaptureSnapGuideStore((s) => s.setGuides);

  const snapResizeGeometry = useCallback((
    params: { x: number; y: number; width: number; height: number },
    altKey: boolean,
  ): { x: number; y: number; width: number; height: number } => {
    const store = useGraphStore.getState();
    const self = store.captureBubbles.find((b) => b.id === d.captureBubbleId);
    const neighbors: SnapRect[] = altKey ? [] : store.captureBubbles
      .filter((b) => b.id !== d.captureBubbleId && (!self || b.projectName === self.projectName))
      .map((b) => ({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height }));
    const zoom = rfStore.getState().transform[2];
    const out = computeCaptureResizeSnap(
      { id: d.captureBubbleId, ...params },
      neighbors,
      CAPTURE_SNAP.THRESHOLD_PX / Math.max(zoom, 0.05),
    );
    setSnapGuides(out.guides);
    return { x: out.x, y: out.y, width: out.width, height: out.height };
  }, [d.captureBubbleId, rfStore, setSnapGuides]);

  // DetailPanel "실제 비율 맞추기" — 소스 프레임 비율로 높이를 다시 잡아 레터박스를 없앤다.
  // 이음새 숨기기(seamless)면 영상이 버블 전체를 채우므로 헤더 높이를 더하지 않는다.
  useEffect(() => {
    const onFit = (e: Event): void => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id !== d.captureBubbleId) return;
      const video = videoRef.current;
      if (!video?.videoWidth || !video.videoHeight) return;
      const chrome = prefs.seamless ? 0 : CAPTURE_BUBBLE_DEFAULTS.HEADER_HEIGHT;
      const width = Math.round(liveWidth);
      const height = Math.round((width * video.videoHeight) / video.videoWidth) + chrome;
      patchCaptureBubbleLocal(d.captureBubbleId, { width, height });
      void updateCaptureBubble(d.captureBubbleId, { width, height });
    };
    window.addEventListener(CAPTURE_FIT_EVENT, onFit);
    return () => window.removeEventListener(CAPTURE_FIT_EVENT, onFit);
  }, [d.captureBubbleId, liveWidth, prefs.seamless, patchCaptureBubbleLocal, updateCaptureBubble]);

  const handleResizeStart: React.ComponentProps<typeof NodeResizer>['onResizeStart'] = () => {
    setCaptureBubbleDragLock(d.captureBubbleId, true);
    resizeSnapRef.current = null;
    setSnapGuides([]);
  };
  const handleResize: React.ComponentProps<typeof NodeResizer>['onResize'] = (evt, params) => {
    // §5.9 이어 붙이기 — 크기를 바꿀 때도 네 변이 이웃 버블 변에 붙는다(틈·겹침 없이 딱 맞게).
    // Alt 를 누르고 있으면 자석 해제(미세 조정). NodeResizer 의 이벤트는 d3-drag 래퍼라
    // 실제 키 상태는 sourceEvent 에 있다.
    const altKey = !!(evt as unknown as { sourceEvent?: { altKey?: boolean } }).sourceEvent?.altKey;
    const snapped = snapResizeGeometry(params, altKey);
    resizeSnapRef.current = snapped;
    patchCaptureBubbleLocal(d.captureBubbleId, snapped);
  };
  const handleResizeEnd: React.ComponentProps<typeof NodeResizer>['onResizeEnd'] = (_evt, params) => {
    // 보정된 기하를 저장한다 — 생 params 를 저장하면 손 뗀 순간 이음선이 다시 벌어진다.
    const geometry = resizeSnapRef.current ?? { x: params.x, y: params.y, width: params.width, height: params.height };
    resizeSnapRef.current = null;
    setSnapGuides([]);
    void (async () => {
      await updateCaptureBubble(d.captureBubbleId, geometry);
      setTimeout(() => setCaptureBubbleDragLock(d.captureBubbleId, false), 300);
    })();
  };

  const accent = CAPTURE_BUBBLE_DEFAULTS.ACCENT_COLOR;
  const live = CAPTURE_BUBBLE_DEFAULTS.LIVE_COLOR;
  const controlColor = CAPTURE_BUBBLE_DEFAULTS.CONTROL_COLOR;
  const showToolbar = liveWidth >= TOOLBAR_MIN_WIDTH;

  /**
   * §5.9 이음새 숨기기 — 버블을 이어 붙여 하나의 큰 화면처럼 볼 때, 모서리 라운드·테두리·그림자·
   * 헤더 띠가 이음선마다 겹쳐 "붙인 티"가 난다. 켜면 크롬을 평상시엔 감추고(테두리는 두께를 유지한
   * 채 투명 — 켜고 끌 때 기하가 밀리지 않게), 영상이 버블 전체를 채우며 헤더는 **호버할 때만** 뜬다
   * (헤더가 드래그 핸들이므로 없애지는 않는다). 선택 중·조작 중엔 어느 버블인지 알아야 하므로 유지.
   */
  const seam = prefs.seamless && !isSelected && !control.active;

  // 프레임 링 — 조작 중(에메랄드) > 선택(스카이) > 평상시(헤어라인) 순으로 한 겹만 입힌다.
  const ring = control.active
    ? `0 0 0 1px ${controlColor}, 0 0 22px -4px ${controlColor}99, 0 18px 40px -16px rgba(0,0,0,0.85)`
    : isSelected
      ? `0 0 0 1px ${accent}, 0 0 18px -6px ${accent}80, 0 18px 40px -16px rgba(0,0,0,0.8)`
      : '0 10px 30px -14px rgba(0,0,0,0.8)';

  return (
    <div
      ref={rootRef}
      className="group/capture relative"
      style={{
        width: liveWidth,
        height: liveHeight,
        borderRadius: seam ? 0 : 14,
        border: `1px solid ${
          seam
            ? 'transparent'
            : control.active ? `${controlColor}66` : CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER
        }`,
        background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG,
        overflow: 'hidden',
        boxShadow: seam ? 'none' : ring,
        opacity: prefs.opacity,
      }}
      data-capture-bubble-id={d.captureBubbleId}
    >
      <NodeResizer
        isVisible
        minWidth={CAPTURE_BUBBLE_DEFAULTS.MIN_WIDTH}
        minHeight={CAPTURE_BUBBLE_DEFAULTS.MIN_HEIGHT}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ borderColor: 'transparent', borderWidth: 6, pointerEvents: 'auto' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, pointerEvents: 'auto' }}
      />

      {/* 헤더 — 유리면 드래그 핸들. 왼쪽=라이브 도트+소스명+상태 칩, 오른쪽=호버 시 뜨는 아이콘 툴바.
          클릭=선택(우측 설정 패널), 더블클릭=창으로 크게 보기. */}
      <div
        className={`capture-bubble-header absolute inset-x-0 top-0 z-[2] flex select-none items-center gap-1.5 px-2 transition-opacity duration-150 ${
          seam ? 'opacity-0 group-hover/capture:opacity-100' : ''
        }`}
        {...gesture.handlers}
        // 헤더에서 시작한 클릭이 캔버스까지 흘러가지 않게 한다(선택 자체는 위 제스처가 맡는다).
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleHeaderDoubleClick}
        title={t('bubbleMap.capture.expandHint', { defaultValue: '더블클릭하면 창으로 엽니다' })}
        style={{
          height: CAPTURE_BUBBLE_DEFAULTS.HEADER_HEIGHT,
          background: CAPTURE_BUBBLE_DEFAULTS.CHROME_BG,
          borderBottom: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
          backdropFilter: 'blur(10px)',
          cursor: dragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
        }}
      >
        {/* 라이브 도트 — 스트리밍 중일 때만 붉게 숨쉰다(정지·소스없음은 회색). */}
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${stream && !frozen ? 'animate-pulse' : ''}`}
          style={{
            background: stream && !frozen ? live : 'rgba(148,163,184,0.45)',
            boxShadow: stream && !frozen ? `0 0 8px ${live}` : 'none',
          }}
          title={stream && !frozen
            ? t('bubbleMap.capture.live', { defaultValue: 'LIVE' })
            : t('bubbleMap.capture.pausedTapResume', { defaultValue: '일시정지됨 · 눌러서 재생' })}
        />
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-tight text-slate-200"
          title={d.sourceName}
        >
          {d.sourceName}
        </span>

        {/* 상태 칩 — 녹화 중 / 조작 중 / 보기 전용 / 일시정지 / 핀. 글리프만으로 한눈에. */}
        <span className="flex shrink-0 items-center gap-1">
          {recorder.recording && (
            <span
              className="flex items-center gap-1 rounded px-1 py-px text-[12px] font-semibold tabular-nums"
              style={{ background: `${CAPTURE_PLAYTEST.RECORD_COLOR}26`, color: CAPTURE_PLAYTEST.RECORD_COLOR }}
              title={t('bubbleMap.capture.playtest.recording', { defaultValue: '플레이 녹화 중' })}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ background: CAPTURE_PLAYTEST.RECORD_COLOR }}
              />
              {formatClipDuration(recorder.elapsedMs)}
            </span>
          )}
          {control.active && (
            <span
              className="rounded px-1 py-px text-[12px] font-semibold uppercase tracking-wide"
              style={{ background: `${controlColor}26`, color: controlColor }}
              title={t('bubbleMap.capture.controlOn', { defaultValue: '조작 중' })}
            >
              {controlMode === 'touch'
                ? t('bubbleMap.capture.pointerModeTouch', { defaultValue: '터치' })
                : t('bubbleMap.capture.pointerModeMouse', { defaultValue: '마우스' })}
            </span>
          )}
          {prefs.readOnly && (
            <svg
              className="h-3 w-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              aria-label={t('bubbleMap.capture.readOnlyShort', { defaultValue: '보기 전용' })}
            >
              <rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
          {frozen && (
            <svg className="h-3 w-3 text-slate-400" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
          {prefs.pinned && (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ color: '#FBBF24' }}>
              <path d="M16 4v6l3 3v2h-6v5l-1 1-1-1v-5H5v-2l3-3V4z" />
            </svg>
          )}
        </span>

        {/* 호버 툴바 — 자주 쓰는 조작을 버블 위에서 바로. 좁은 버블에선 접는다(제목 우선). */}
        {showToolbar && (
          <span className="flex shrink-0 items-center gap-px opacity-0 transition-opacity duration-150 group-hover/capture:opacity-100">
            <HeaderButton
              label={frozen
                ? t('bubbleMap.capture.resume', { defaultValue: '다시 재생' })
                : t('bubbleMap.capture.pause', { defaultValue: '일시정지' })}
              onClick={() => setRuntime({ frozen: !frozen })}
            >
              {frozen ? (
                <path d="M8 5v14l11-7z" />
              ) : (
                <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>
              )}
            </HeaderButton>
            <HeaderButton
              label={recorder.recording
                ? t('bubbleMap.capture.playtest.stopRecording', { defaultValue: '녹화 멈추고 구간 자르기' })
                : t('bubbleMap.capture.playtest.startRecording', { defaultValue: '플레이 녹화 시작' })}
              onClick={recorder.toggle}
              disabled={!recorder.available}
              active={recorder.recording}
              activeColor={CAPTURE_PLAYTEST.RECORD_COLOR}
            >
              {recorder.recording
                ? <rect x="7" y="7" width="10" height="10" rx="2" />
                : <circle cx="12" cy="12" r="7" />}
            </HeaderButton>
            <HeaderButton
              label={t('bubbleMap.capture.snapshot', { defaultValue: '현재 프레임 저장 (PNG)' })}
              onClick={saveSnapshot}
              disabled={!stream}
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </HeaderButton>
            <HeaderButton
              label={t('bubbleMap.capture.expand', { defaultValue: '크게 보기' })}
              onClick={() => setRuntime({ expanded: true })}
            >
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </HeaderButton>
            <HeaderButton
              label={t('bubbleMap.capture.pin', { defaultValue: '항상 위(핀 고정)' })}
              onClick={() => setPrefs({ pinned: !prefs.pinned })}
              active={prefs.pinned}
            >
              <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </HeaderButton>
            <HeaderButton
              label={t('bubbleMap.capture.settings', { defaultValue: '캡처 버블 설정' })}
              onClick={() => selectCaptureBubble(d.captureBubbleId)}
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </HeaderButton>
          </span>
        )}
      </div>

      {/* 본체 — 라이브 영상. 조작 모드가 'off'(기본)면 본체 클릭은 캔버스로 그대로 흘러간다
          (pointerEvents none → 팬 보존, 캡처 대상엔 아무것도 주입 안 됨). 사용자가 터치/마우스 모드를
          고를 때만 auto 로 바뀌어 조작 표면이 된다. */}
      <div
        ref={bodyRef}
        {...control.surfaceProps}
        style={{
          position: 'absolute',
          // 이음새 숨기기면 영상이 버블 전체를 채운다(헤더는 그 위에 호버로 떠오름) — 위쪽 26px
          // 검은 띠가 이음선마다 남으면 이어 붙인 화면이 끊겨 보인다.
          top: seam ? 0 : CAPTURE_BUBBLE_DEFAULTS.HEADER_HEIGHT,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: control.active ? 'auto' : 'none',
          // v3.58 — 조작 중에도 **사용자의 로컬 커서를 숨기지 않는다**(종전 `cursor:none` 철회).
          // 자기 마우스가 사라지면 어디를 조작하는지 오히려 헷갈린다는 사용자 지적. 대상에 찍히는
          // 지점은 오버레이 가상 커서가 따로 보여 준다.
          cursor: control.surfaceCursor,
          // 모바일 — 조작 중엔 손가락 끌기를 브라우저 스크롤/팬에 뺏기지 않게(터치 모드가 폰에서
          // 데스크톱과 똑같이 동작하려면 필수).
          touchAction: control.active ? 'none' : undefined,
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 녹화 실패 사유 — 조용히 아무 일도 안 일어나면 기능 오류인지 미지원인지 구분할 수 없다. */}
        {recorder.error && (
          <button
            type="button"
            className="absolute left-2 top-2 z-[4] rounded-full px-2 py-0.5 text-[12px] font-semibold"
            style={{ background: 'rgba(190,18,60,0.85)', color: '#FFE4E6', pointerEvents: 'auto' }}
            onClick={(e) => { e.stopPropagation(); recorder.clearError(); }}
          >
            {t('bubbleMap.capture.playtest.recordFailed', {
              defaultValue: '녹화 실패: {{reason}}',
              reason: recorder.error,
            })}
          </button>
        )}
        {/* fps·해상도 배지(지연 지표) — 유리 알약. AUTO 화질·정지절전 상태도 함께. */}
        {prefs.showBadge && stream && (
          <div
            className="pointer-events-none absolute right-2 top-2 z-[4] rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums"
            style={{
              background: 'rgba(8,10,14,0.72)',
              border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
              color: idle && prefs.stillSaver ? '#FBBF24' : '#A7F3D0',
              backdropFilter: 'blur(6px)',
            }}
          >
            {idle && prefs.stillSaver
              ? t('bubbleMap.capture.badgeIdle', { defaultValue: '정지 · 절전' })
              : `${fps} fps · ${quality.maxHeight}p${prefs.qualityMode === 'auto' ? ' · AUTO' : ''}`}
          </div>
        )}
        {stream ? (
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            onLoadedMetadata={() => { if (control.active) control.syncCursorPx(); }}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG, pointerEvents: 'none' }}
          />
        ) : frozen ? (
          <StageMessage
            onClick={(e) => { e.stopPropagation(); setRuntime({ frozen: false }); }}
            label={t('bubbleMap.capture.pausedTapResume', { defaultValue: '일시정지됨 · 눌러서 재생' })}
            accent={accent}
          >
            <path d="m10 8 6 4-6 4V8z" /><circle cx="12" cy="12" r="9" />
          </StageMessage>
        ) : (
          <StageMessage
            onClick={requestRepick}
            label={loading
              ? t('bubbleMap.capture.connecting', { defaultValue: '연결 중…' })
              : error
                ? t('bubbleMap.capture.sourceLost', { defaultValue: '소스를 찾을 수 없습니다 · 다시 선택' })
                : t('bubbleMap.capture.pickPrompt', { defaultValue: '클릭해서 소스 선택' })}
            accent={loading ? 'rgba(148,163,184,0.6)' : accent}
            spinning={loading}
          >
            <rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
          </StageMessage>
        )}

        {/* 조작 중일 때만 얹히는 공유 오버레이 — 마우스 모드 가상 커서 + 특수키/클립보드 바.
            (크게 보기 창도 같은 컴포넌트를 쓴다 — 한쪽만 고쳐 갈라지지 않게.) */}
        {control.active && stream && (
          <CaptureControlOverlay
            cursorPx={control.cursorPx}
            cursorScale={canvasZoom > 0 ? 1 / canvasZoom : 1}
            targetMissing={control.targetMissing}
            injectError={control.injectError}
            backgroundFallback={control.backgroundFallback}
            onSpecialKey={control.sendSpecialKey}
            onPaste={() => { void control.pasteClipboard(); }}
          />
        )}
      </div>

      {/* 리사이즈 그립 — 호버 시에만 우하단에 살짝. 실제 리사이즈는 NodeResizer 가 잡는다. */}
      <span className="pointer-events-none absolute bottom-1 right-1 z-[3] text-slate-500 opacity-0 transition-opacity group-hover/capture:opacity-70">
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 15 15 21" /><path d="M21 9 9 21" />
        </svg>
      </span>

      {/* 확대 — 헤더 더블클릭 시 앱 내부 IDE식 창(CaptureWindow)으로 라이브 영상을 크게 본다.
          가운데 뜬 뒤 이동·확대·리사이즈되고, 여러 버블의 창을 동시에 열면 멀티 윈도우가 된다.
          창 자체가 portal 로 캔버스 밖(document.body)에 그려진다. */}
      {expanded && (
        <CaptureWindow
          captureBubbleId={d.captureBubbleId}
          title={d.sourceName}
          accent={accent}
          sourceId={d.sourceId}
          sourceKind={d.sourceKind}
          sourceName={d.sourceName}
          stream={stream}
          loading={loading}
          hasError={!!error}
          onClose={() => setRuntime({ expanded: false })}
        />
      )}
    </div>
  );
});

interface HeaderButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** 켜짐 상태(핀 등) — 액센트로 눌린 티를 낸다. */
  active?: boolean;
  /** 켜짐 색 — 기본은 캡처 액센트(sky). 녹화처럼 뜻이 다른 켜짐은 자기 색을 쓴다. */
  activeColor?: string;
  children: React.ReactNode;
}

/** 헤더 호버 툴바의 고스트 아이콘 버튼 — 캔버스로 이벤트가 새지 않게 전파를 끊는다. */
function HeaderButton({ label, onClick, disabled, active, activeColor, children }: HeaderButtonProps): React.JSX.Element {
  const onColor = activeColor ?? CAPTURE_BUBBLE_DEFAULTS.ACCENT_COLOR;
  return (
    <button
      type="button"
      className={`nodrag flex h-[18px] w-[18px] items-center justify-center rounded-[5px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? '' : 'text-slate-400 hover:bg-white/[0.12] hover:text-slate-100'
      }`}
      style={active ? { color: onColor, background: `${onColor}1f` } : undefined}
      disabled={disabled}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

interface StageMessageProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  accent: string;
  spinning?: boolean;
  children: React.ReactNode;
}

/** 스트림이 없을 때(연결 중·소스 없음·일시정지) 영상 자리에 놓이는 안내 카드. */
function StageMessage({ label, onClick, accent, spinning, children }: StageMessageProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nodrag flex flex-col items-center gap-2 rounded-xl px-4 py-3 text-center transition-colors hover:bg-white/[0.04]"
      style={{ pointerEvents: 'auto' }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(255,255,255,0.08)', color: accent }}
      >
        <svg
          className={`h-4 w-4 ${spinning ? 'animate-pulse' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        >
          {children}
        </svg>
      </span>
      <span className="text-[12px] leading-tight text-slate-400">{label}</span>
    </button>
  );
}
