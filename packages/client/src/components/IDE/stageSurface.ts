/**
 * §5.5 #17-17 ⑪(i)(j)·⑭(a)·㉒ — 무대가 무엇을 비출지 고르는 계산만 모은다(화면·통신 ❌): 비출 단계(`focusStep`), 카드가 가리키는 화면(`surfaceOf`),
 * 실황 구간 — 한 칸 어긋나도 화면엔 실패가 안 남아 눈으로 못 잡는다.
 */
import {
  STAGE_SURFACE_APPS,
  STAGE_WINDOW_FALLBACK_MS,
  VISUAL_KIND_SURFACES,
  resolveWorkspaceOpen,
  type BashEntry,
  type FileEdit,
  type SessionGoalStep,
  type VisualKindCard,
  type VisualKindSurface,
  type WebEntry,
  type WorkspaceOpenAppClaim,
} from '@vibisual/shared';

/** ⑪(j) — 지금 도는 단계. 여럿이면 **맨 앞**(목록 순서가 곧 진행 순서다). 없으면 `null`. */
export function runningStep(steps: readonly SessionGoalStep[]): SessionGoalStep | null {
  return steps.find((s) => s.status === 'in_progress') ?? null;
}

/**
 * ⑪(j) — 무대가 기본으로 비출 단계.
 *
 * 도는 단계가 있으면 그것이고, 없으면 **마지막으로 끝낸 단계**다(다 끝난 목록에서 빈 무대를 띄우지
 * 않는다 — 방금 무엇을 했는지가 그 화면의 답이다). 둘 다 없으면 `null`.
 */
export function focusStep(steps: readonly SessionGoalStep[]): SessionGoalStep | null {
  const running = runningStep(steps);
  if (running) return running;
  let lastDone: SessionGoalStep | null = null;
  for (const s of steps) {
    if (s.status === 'done') lastDone = s;
  }
  return lastDone;
}

/** ⑪(i) — 이 단계가 가리키는 화면 골격(카드가 없거나 안 골랐으면 `none`). 카드가 `blurb` 를 안 내면 이 값으로 기본 문장(`ide.stage.surfaceBlurb.*`)을 고른다. */
export function surfaceOf(
  step: SessionGoalStep | null | undefined,
  kinds: Record<string, VisualKindCard>,
): VisualKindSurface {
  if (!step?.kind) return 'none';
  return kinds[step.kind]?.surface ?? 'none';
}

// ─── ㉒ 실황 — 그 단계가 **지금 만들고 있는 것** 을 고르는 계산 ─────────────────────────

/**
 * ㉒(c) — 한 단계가 차지하는 **시각 구간**. 실황은 이 구간에 일어난 일만 비춘다.
 *
 * 열린 구간의 끝(`to`)이 `Infinity` 인 것은 "지금도 일어나는 중"이라는 뜻이다 —
 * `Date.now()` 를 여기서 읽지 않는다(같은 인자에 같은 답이 나와야 테스트로 고정할 수 있다).
 */
export interface StageWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * ㉒(c) — 그 단계의 구간. 아직인 단계는 `null`(일어나지 않은 일에 실황 ❌). 도는 단계 = [시작, ∞], 끝난 단계 = [앞 단계 중 이보다 이른 마지막 시각, 끝난 시각],
 * 앞 단계가 없으면 `STAGE_WINDOW_FALLBACK_MS` 만큼 뒤로 연다. `updatedAt` 은 마지막 상태 변경 시각이라 도는 단계엔 시작, 끝난 단계엔 끝 — 갈래를 나눠 읽는다.
 */
export function stepWindow(
  steps: readonly SessionGoalStep[],
  stepId: string | null | undefined,
): StageWindow | null {
  if (!stepId) return null;
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  const step = steps[idx]!;
  if (step.status === 'pending') return null;
  if (step.status === 'in_progress') {
    return { from: step.updatedAt, to: Number.POSITIVE_INFINITY };
  }
  const to = step.updatedAt;
  // 앞 단계 중 **이 단계보다 이른** 마지막 시각이 곧 이 단계가 시작한 때다. 순서를 손으로 바꿀 수
  //   있으므로(⑳) 목록 순서만 믿지 않고 값으로 견준다 — 뒤 단계의 시각이 앞에 섞여 있어도 안전하다.
  let from = -Infinity;
  for (let i = 0; i < idx; i += 1) {
    const at = steps[i]!.updatedAt;
    if (at < to && at > from) from = at;
  }
  return { from: Number.isFinite(from) ? from : to - STAGE_WINDOW_FALLBACK_MS, to };
}

/** 이 시각이 구간 안인가. 경계는 포함이다(같은 ms 에 찍힌 기록을 버리지 않는다). */
export function inWindow(at: number, win: StageWindow | null | undefined): boolean {
  if (!win) return false;
  return at >= win.from && at <= win.to;
}

/** ㉒(c) — 그 구간에 고친 파일들(파일당 가장 최근 한 줄, 최신순 — 안 접으면 한 파일이 목록을 덮는다). */
export function editsInWindow(
  fileEdits: Record<string, FileEdit[]>,
  win: StageWindow | null,
  limit: number,
): FileEdit[] {
  if (!win || limit <= 0) return [];
  const newest = new Map<string, FileEdit>();
  for (const list of Object.values(fileEdits)) {
    for (const edit of list) {
      if (!inWindow(edit.timestamp, win)) continue;
      const cur = newest.get(edit.filePath);
      if (!cur || cur.timestamp < edit.timestamp) newest.set(edit.filePath, edit);
    }
  }
  return [...newest.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/** ㉒(c) — 그 구간에 돈 명령들(최신순). `log`·`terminal` 골격이 같은 목록을 다른 그림으로 쓴다. */
export function bashInWindow(
  bashHistory: Record<string, BashEntry[]>,
  win: StageWindow | null,
  limit: number,
): BashEntry[] {
  if (!win || limit <= 0) return [];
  const out: BashEntry[] = [];
  for (const list of Object.values(bashHistory)) {
    for (const entry of list) {
      if (inWindow(entry.timestamp, win)) out.push(entry);
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/** ㉒(c)(d) — 그 구간에 읽은 웹 항목들(최신순 · §5.23 `domainEntries`). 시각 칸은 `at` 이다. */
export function webInWindow(
  domainEntries: Record<string, WebEntry[]>,
  win: StageWindow | null,
  limit: number,
): WebEntry[] {
  if (!win || limit <= 0) return [];
  const out: WebEntry[] = [];
  for (const list of Object.values(domainEntries)) {
    for (const entry of list) {
      if (inWindow(entry.at, win)) out.push(entry);
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * ㉒(d) — `none` 은 "골격을 안 골랐다"이지 "보여줄 것이 없다"가 아니다: 구간에 고친 파일이 있으면 `source` 로 읽는다
 * (종류 없는 단계가 흔해서, 접으면 [추종] 을 켜고도 아무것도 못 본다).
 */
export function effectiveSurface(surface: VisualKindSurface, hasEdits: boolean): VisualKindSurface {
  if (surface !== 'none') return surface;
  return hasEdits ? 'source' : 'none';
}

/** ㉒(a) — 이 골격이 **에이전트가 만든 산출물**을 여는 것인가(내부 앱 또는 그림 칸). */
export function isArtifactSurface(surface: VisualKindSurface): boolean {
  return surface === 'image' || STAGE_SURFACE_APPS[surface] !== undefined;
}

/** ㉒(a) — 이 골격을 펴는 내부 앱 id(§5.13). `image` 는 앱이 아니라 편집창의 그림 칸이라 `null`. */
export function surfaceAppId(surface: VisualKindSurface): string | null {
  return STAGE_SURFACE_APPS[surface] ?? null;
}

/**
 * ㉒(c) — 이 골격이 열 산출물 하나(구간에 만진 파일 중 가장 최근 것, 없으면 `null` → 칸이 안 선다).
 * ⚠ 확장자 표를 무대가 들지 마라 — 워크스페이스 클릭과 같은 shared `resolveWorkspaceOpen` 에 넘긴다(두 벌이면 무대엔 보이는데 눌러도 안 열린다).
 */
export function stageArtifact(
  surface: VisualKindSurface,
  edits: readonly FileEdit[],
  claims: readonly WorkspaceOpenAppClaim[],
): string | null {
  const wantApp = surfaceAppId(surface);
  if (surface !== 'image' && !wantApp) return null;
  for (const edit of edits) {
    const plan = resolveWorkspaceOpen({ relPath: edit.filePath, kind: 'file', apps: claims });
    const hit = surface === 'image' ? plan.action === 'image' : plan.action === 'app' && plan.appId === wantApp;
    if (hit) return edit.filePath;
  }
  return null;
}

/** ㉒(d)·⑪(n) — 골격의 강조색·글리프(카드 색 "무슨 일"과 다른 축 "무엇을 보고 있나"). 표가 골격 목록과 어긋나면 무채색으로 서므로 `stageSurface.test.ts` 가 유니온 전부를 센다. */
export interface StageSurfaceChrome {
  readonly accent: string;
  /** 24 좌표계 stroke path — 우리가 직접 그린 것만(웹 이미지 ❌ · CLAUDE.md 아이콘 규약). */
  readonly glyph: string;
}

export const STAGE_SURFACE_CHROME: Readonly<Record<VisualKindSurface, StageSurfaceChrome>> = {
  // 꺾쇠 — 소스.
  source: { accent: '#60A5FA', glyph: 'M8 6 2 12l6 6M16 6l6 6-6 6' },
  // 줄이 길이가 다른 목록 — 출력.
  log: { accent: '#FB7185', glyph: 'M4 5h16M4 10h10M4 15h13M4 20h7' },
  // 더하기와 빼기 — 변경분.
  diff: { accent: '#4ADE80', glyph: 'M4 8h7M7.5 4.5v7M13 16h7' },
  // 자오선이 있는 구 — 웹.
  web: {
    accent: '#38BDF8',
    glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18',
  },
  // 프롬프트 기호가 있는 창 — 터미널.
  terminal: { accent: '#A3E635', glyph: 'M4 4h16v16H4zM7 9l3 3-3 3M13 15h4' },
  // 접힌 모서리 — 문서.
  docs: { accent: '#22D3EE', glyph: 'M6 3h8l4 4v14H6zM14 3v4h4' },
  // 액자 안의 해와 산 — 그림.
  image: {
    accent: '#FDBA74',
    glyph: 'M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M3 17l5-4 4 3 3-3 6 5',
  },
  // 정육면체 — 3D(종류 카드 `model`·템플릿 `cube` 와 같은 그림).
  model3d: { accent: '#B9A8E0', glyph: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12 3 7' },
  // 퍼포레이션이 있는 프레임 — 영상.
  video: { accent: '#A8B4CC', glyph: 'M3 5h18v14H3zM7 5v14M17 5v14M3 12h4M17 12h4' },
  // 파형 — 소리.
  audio: { accent: '#8FD3C7', glyph: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4' },
  // 골격 없음 — 중립 원. 이 값일 때 실황 칸은 **서지 않는다**(색은 머리 조각만 쓴다).
  none: { accent: '#94A3B8', glyph: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16' },
};

/** 표에 빠진 골격이 있으면 여기서 드러난다(테스트가 이 목록으로 센다). */
export const STAGE_SURFACE_KEYS: readonly VisualKindSurface[] = VISUAL_KIND_SURFACES;
