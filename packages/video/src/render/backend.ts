/**
 * 렌더 백엔드 인터페이스와 선택 규칙 (SCENARIO.md §5.13 (F)).
 *
 * 이 파일은 **순수**하다 — 브라우저 API 를 부르지 않고 "어떤 백엔드를 쓸 것인가"만
 * 정한다. 그래야 선택 규칙을 화면 없이 시험할 수 있고, 서버도 이 타입을 읽을 수 있다.
 *
 * 백엔드를 셋으로 나눈 이유는 하나에 전부 걸 수 없기 때문이다. 가장 좋은 경로
 * (HTML-in-Canvas)가 아직 오리진 트라이얼이라, 그 API 가 흔들리는 날 앱이 통째로
 * 멈추지 않으려면 물러설 자리가 미리 있어야 한다. **그리고 물러섰다는 사실이
 * 사용자에게 보여야 한다** — 조용히 느려지는 것이 가장 나쁜 실패다.
 */

import { RENDER_BACKEND_ORDER, type RenderBackendId } from '../constants.js';

export interface RenderBackendCapabilities {
  /** CSS 를 얼마나 그대로 그리는가. */
  readonly css: 'full' | 'partial' | 'none';
  /** GPU 가속을 쓰는가. */
  readonly gpu: boolean;
  /** 표준화가 끝나지 않은 API 에 기대는가. */
  readonly experimental: boolean;
}

/** 백엔드별 성질. 사용자에게 "무엇을 얻고 무엇을 잃는지" 보여줄 때 쓴다. */
export const RENDER_BACKEND_CAPABILITIES: Readonly<Record<RenderBackendId, RenderBackendCapabilities>> = {
  // 살아 있는 DOM 을 그대로 캔버스에 그린다 — CSS 를 잃지 않으면서 GPU 인코딩까지 간다.
  'html-in-canvas': { css: 'full', gpu: true, experimental: true },
  // 오프스크린 창을 찍는다. 느리지만 CSS 가 온전하고 지금 확실히 동작한다.
  'offscreen-capture': { css: 'full', gpu: true, experimental: false },
  // 캔버스에 직접 그린다. 가장 빠르지만 CSS 가 없다(등록된 그리기 함수만).
  canvas2d: { css: 'none', gpu: false, experimental: false },
};

/** 그릴 표면. */
export interface RenderSurface {
  readonly width: number;
  readonly height: number;
}

/**
 * 렌더 백엔드.
 *
 * 계약은 단순하다 — "시각 t 의 화면을 네 캔버스에 그려 놓아라". 그 캔버스를 인코더가
 * 가져간다. 프레임을 어디서 얻든 출구(Mediabunny)는 하나다.
 */
export interface RenderBackend {
  readonly id: RenderBackendId;
  readonly capabilities: RenderBackendCapabilities;
  /** 이 환경에서 실제로 쓸 수 있는가. 여기서 거짓이면 다음 순위로 내려간다. */
  probe(): Promise<BackendProbe>;
  init(surface: RenderSurface): Promise<void>;
  /** 시각 t(초)의 화면을 `canvas` 에 그린다. */
  drawFrame(t: number): Promise<void>;
  /** 인코더가 읽어 갈 표면. `init` 전에는 null. */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas | null;
  dispose(): void;
}

export interface BackendProbe {
  readonly id: RenderBackendId;
  readonly available: boolean;
  /** 못 쓰는 이유. 사용자에게 그대로 보여 준다. */
  readonly reason?: string;
}

export interface SkippedBackend {
  readonly id: RenderBackendId;
  readonly reason: string;
}

export interface BackendSelection {
  readonly chosen: RenderBackendId;
  /** 사용자가 고른 것. 없으면 자동 선택이다. */
  readonly requested?: RenderBackendId;
  /** 원하던 것을 못 써서 내려왔는가. 참이면 화면에 알린다. */
  readonly downgraded: boolean;
  readonly skipped: readonly SkippedBackend[];
}

const NO_REASON = '사용할 수 없습니다.';

/**
 * 쓸 백엔드를 고른다.
 *
 * 사용자가 지정한 것이 있으면 그것을 먼저 보고, 못 쓰면 우선순위대로 내려간다.
 * 하나도 못 쓰면 `null` — 그때는 렌더를 시작하지 않고 이유를 보여 준다(반쯤 된
 * 영상을 내놓는 것보다 낫다).
 */
export function selectRenderBackend(
  probes: readonly BackendProbe[],
  requested?: RenderBackendId,
): BackendSelection | null {
  const byId = new Map<RenderBackendId, BackendProbe>();
  for (const p of probes) byId.set(p.id, p);

  const skipped: SkippedBackend[] = [];

  if (requested !== undefined) {
    const wanted = byId.get(requested);
    if (wanted?.available === true) {
      return { chosen: requested, requested, downgraded: false, skipped: [] };
    }
    skipped.push({ id: requested, reason: wanted?.reason ?? NO_REASON });
  }

  for (const id of RENDER_BACKEND_ORDER) {
    if (id === requested) continue; // 이미 위에서 보고 실패했다.
    const probe = byId.get(id);
    if (probe?.available === true) {
      return { chosen: id, ...(requested === undefined ? {} : { requested }), downgraded: skipped.length > 0, skipped };
    }
    skipped.push({ id, reason: probe?.reason ?? NO_REASON });
  }

  return null;
}

/** 선택 결과를 사람이 읽는 한 줄로. 화면 배너와 로그가 같은 문장을 쓰게 한다. */
export function describeSelection(selection: BackendSelection): string {
  if (!selection.downgraded) return `렌더 방식: ${selection.chosen}`;
  const why = selection.skipped.map((s) => `${s.id}(${s.reason})`).join(', ');
  return `렌더 방식을 ${selection.chosen} 로 내렸습니다 — 못 쓴 것: ${why}`;
}
