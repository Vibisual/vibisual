/**
 * §5.5 #17-17 ⑪(i)(j)·⑭(a) — **무대가 무엇을 비출지 고르는 계산**만 모아 둔다(화면 ❌ · 통신 ❌).
 *
 * 무대는 단계 하나를 골라 그 단계의 **종류 카드**가 정한 그림·색·미리 표현한 한 줄을 세운다.
 * 어느 단계를 고르는가(`focusStep`)와 그 카드가 무슨 화면을 가리키는가(`surfaceOf`)는 눈으로
 * 확인하기 어려운 판정이라 여기 순수 함수로 두고 단위 테스트로 고정한다.
 *
 * ⑭(a) 로 **아래 화면 골격 칸이 회수**되면서 그 칸만 쓰던 계산(시각 구간 자르기 · 로그 줄 고르기 ·
 * 문서 확장자 판정 · 짧은 경로)은 함께 걷었다 — 부르는 곳이 없어진 계산을 남겨 두면 다음 사람이
 * 그 화면이 아직 있다고 믿는다.
 *
 * ㉒ 로 그 칸이 **실황**으로 돌아왔다. 걷었던 계산도 여기 다시 서지만 이번에는 **순수 함수 + 단위
 * 테스트**로 고정한다 — 구간이 한 칸 어긋나도 화면에는 아무 실패가 남지 않고(남의 기록이 이 단계의
 * 것으로 보일 뿐이다), 그 어긋남은 눈으로 잡을 수 없기 때문이다.
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

/**
 * ⑪(i) — 이 단계가 가리키는 화면 골격. 카드가 없거나 안 골랐으면 `none`.
 *
 * ⑭(a) 이후 이 값이 여는 것은 아래 칸이 아니라 **미리 표현하는 한 줄**이다 — 카드가 `blurb` 를
 * 안 냈을 때 무대 머리가 이 값으로 기본 문장을 고른다(`ide.stage.surfaceBlurb.*`).
 */
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
 * ㉒(c) — 그 단계의 구간. **아직인 단계는 `null`** — 일어나지 않은 일에 실황을 붙이면 거짓이다.
 *
 * - 도는 단계: `[그 단계가 시작한 시각, 지금(∞)]`
 * - 끝난 단계: `[앞 단계들 중 이 단계보다 이른 마지막 시각, 이 단계가 끝난 시각]`
 * - 앞 단계가 없으면 `STAGE_WINDOW_FALLBACK_MS` 만큼 뒤로 연다 — 첫 단계가 늘 빈 화면이 되지 않게.
 *
 * `updatedAt` 은 **마지막 상태 변경 시각**이라 도는 단계에서는 "시작한 때", 끝난 단계에서는
 * "끝낸 때"다(§ `SessionGoalStep.updatedAt`). 두 뜻이 같은 칸에 있으므로 갈래를 나눠 읽는다.
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

/**
 * ㉒(c) — 그 구간에 고친 파일들. **파일 하나당 가장 최근 것 한 줄**로 접고 최신순으로 돌려준다.
 *
 * 접지 않으면 한 파일을 스무 번 고친 단계에서 목록이 그 파일 스무 줄이 되어, 정작 그 단계가
 * 무엇을 만졌는지가 보이지 않는다.
 */
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
 * ㉒(d) — **`none` 은 "골격을 안 골랐다"는 뜻이지 "보여줄 것이 없다"는 뜻이 아니다.**
 *
 * 종류를 붙이지 않은 단계(에이전트가 `@키` 를 안 쓴 흔한 경우)도 파일은 고친다. 그때 칸을 접으면
 * 사용자는 [추종] 을 켜 놓고도 아무것도 못 본다 — 이 기능이 답하려던 바로 그 질문에 답을 못 한다.
 * 그래서 그 구간에 **고친 파일이 있으면** `source` 로 읽는다(없으면 종전대로 `none` → 칸이 서지
 * 않는다). ⑭(a) 가 걷어낸 이유는 지켜진다 — 걷어낸 것은 "빈 안내 한 줄"이고, 여기서 서는 것은
 * 실제로 고친 파일 목록이다.
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
 * ㉒(c) — 이 골격이 열 **산출물 하나**. 그 구간에 만진 파일 중 이 골격이 여는 것을 처음 만나는
 * 것(= 가장 최근 것)이고, 없으면 `null` **→ 칸이 서지 않는다**(빈 뷰어 ❌).
 *
 * ⚠ **확장자 표를 무대가 들지 않는다.** 판정은 워크스페이스 클릭이 쓰는 그 함수
 * (`resolveWorkspaceOpen` — 앱이 선언한 `opens` 를 받고, 그림·PDF·변환 갈래까지 아는 shared 순수
 * 함수)에 그대로 넘긴다. 그래서 ① 네 번째 앱이 와도 이 함수는 그대로고, ② **무대가 여는 것과
 * 눌렀을 때 열리는 것이 어긋날 수 없다**(표가 두 벌이면 "무대에는 보이는데 눌러도 안 열리는
 * 파일"이 생긴다 — `.svg` 를 그림이 아니라 편집창으로 보내는 그쪽 예외까지 함께 따른다).
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

/**
 * ㉒(d)·⑪(n) — 골격의 **강조색과 글리프**. "무대가 넘어갔는데 화면이 안 바뀌면 넘어간 줄 모른다".
 *
 * 카드 색과는 **다른 축**이다 — 카드 색은 "무슨 일인가", 이 색은 "무엇을 보고 있나".
 * 표가 골격 목록과 어긋나면 그 골격만 무채색으로 서는데 **원래 증상과 구별되지 않으므로**
 * `stageSurface.test.ts` 가 유니온 전부를 센다.
 */
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
