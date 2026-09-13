// SCENARIO.md §5.26 / §7.23 — 컨텍스트 보험 팝업이 쓰는 **순수 판정**.
//
// 화면이 값을 만들지 않는다(§3.1) — 서버가 접어 준 원장을 그대로 그린다. 여기 있는 것은
// "이 줄에 어떤 손잡이를 내줄까"처럼 **표시 규칙**뿐이고, 그래서 DOM 없이 시험으로 고정된다
// (클라 시험 환경에 jsdom 이 없다).

import type {
  CompactMarker,
  FilePreimage,
  ProjectInsuranceLedger,
  CompactWatchLevel,
  CompactWatchState,
  InsuranceSessionCounts,
  ResurrectableSession,
} from '@vibisual/shared';

/** §7.23 — 팝업의 네 갈피. */
export type InsuranceTab = 'compacts' | 'notCarried' | 'preimages' | 'resurrect';

export const INSURANCE_TABS: InsuranceTab[] = ['compacts', 'notCarried', 'preimages', 'resurrect'];

/** 갈피 제목의 i18n 키. */
export const INSURANCE_TAB_LABEL_KEY: Record<InsuranceTab, string> = {
  compacts: 'panel.insurance.tabs.compacts',
  notCarried: 'panel.insurance.tabs.notCarried',
  preimages: 'panel.insurance.tabs.preimages',
  resurrect: 'panel.insurance.tabs.resurrect',
};

/** 그 프로젝트의 원장 한 장. 없으면 `undefined` — 화면은 "아직 겪지 않았다"로 적는다. */
export function findInsuranceLedger(
  list: readonly ProjectInsuranceLedger[],
  projectName: string | null,
): ProjectInsuranceLedger | undefined {
  if (!projectName) return undefined;
  return list.find((l) => l.projectName === projectName);
}

/**
 * 마커 한 줄이 "사본이 실제로 있는가".
 *
 * **이 판정이 이 기능의 유일한 약속이다** — 없는 것을 있다고 적지 않는다. `mirrored` 는 서버가
 * 디스크와 맞대 본 값이라(복원 직후에도 다시 대조한다) 화면은 그대로 믿고 적으면 된다.
 */
export function markerCopyState(m: CompactMarker): 'mirrored' | 'indexOnly' {
  return m.mirrored ? 'mirrored' : 'indexOnly';
}

/**
 * 압축 한 건의 상태 — 기다리는 중 · 실패로 못 박힘 · **못 읽음** · 대조 끝.
 *
 * `unreadable` 을 `failed` 와 가르는 것이 §5.26 (D) 의 핵심이다. 완료 훅이 온 압축은 **끝난**
 * 것이고 요약을 우리가 못 읽었을 뿐이라, 같은 빨간 칸에 적으면 사용자가 멀쩡한 세션을
 * 되살리려 든다(되살리기와 계속하기는 손잡이가 다르다).
 */
export function markerOutcomeState(m: CompactMarker): 'pending' | 'failed' | 'unreadable' | 'done' {
  if (!m.outcome) return 'pending';
  if (m.outcome.failed) return 'failed';
  return m.outcome.summaryUnreadable ? 'unreadable' : 'done';
}

/**
 * 사본 한 줄에 **되돌리기 손잡이를 내줄까**.
 *
 * - `skipped` 가 있으면 내주지 않는다. 사본 자체가 없으므로 버튼을 그리면 그건 없는 손잡이다
 *   (§7.23: 너무 커서 못 뜬 줄에는 버튼을 **아예** 두지 않는다 — 눌러서 실패하게 두면 안 된다).
 * - 이미 되돌린 줄에도 내주지 않는다(같은 사본을 두 번 덮어쓸 이유가 없다).
 */
export function canRestorePreimage(p: FilePreimage): boolean {
  return !p.skipped && !p.restoredAt;
}

/**
 * 되돌리기 버튼의 **낱말**이 달라지는 자리.
 *
 * `sha256` 이 없으면 그때 그 자리에 파일이 **없었다**는 뜻이라, 되돌리기는 곧 **삭제**다.
 * 같은 버튼에 같은 말을 쓰면 사용자가 "복구"인 줄 알고 눌러 파일을 지운다.
 */
export function restoreLabelKey(p: FilePreimage): string {
  return p.sha256 ? 'panel.insurance.restore' : 'panel.insurance.restoreAsDelete';
}

/** 미리보기를 내줄 수 있는가 — 내용 바이트가 있어야 한다. */
export function canPreviewPreimage(p: FilePreimage): boolean {
  return !!p.sha256 && !p.skipped;
}

/** 못 뜬 이유의 i18n 키. 모르는 값이 와도 화면이 비지 않게 기본을 준다. */
export function skipReasonKey(p: FilePreimage): string | null {
  if (!p.skipped) return null;
  return `panel.insurance.skip.${p.skipped}`;
}

/** 경로에서 화면에 굵게 적을 파일명. 구분자는 두 계열 다 받는다(윈도우 경로가 그대로 온다). */
export function preimageFileName(p: FilePreimage): string {
  const parts = p.path.split(/[\\/]/);
  return parts[parts.length - 1] || p.path;
}

/** 감시 등급 중 **가장 무거운 것** — 상태바 칸 하나가 그것만 말한다. */
export function worstWatchLevel(list: readonly CompactWatchState[] | undefined): CompactWatchLevel | null {
  if (!list || list.length === 0) return null;
  let worst: CompactWatchLevel = 'ok';
  for (const w of list) {
    if (w.level === 'stalled') return 'stalled';
    // §5.26 (F)(b) — `rejected`(이미 안 된 것)가 `overdue`(곧 벽이다)를 이긴다.
    if (w.level === 'rejected') worst = 'rejected';
    else if (w.level === 'overdue' && worst !== 'rejected') worst = 'overdue';
  }
  return worst === 'ok' ? null : worst;
}

/**
 * §5.26 (I) — **지금 상태바가 보고 있는 세션**의 좌표.
 *
 * 원장은 프로젝트 한 장이고 팝업(§7.23)은 그대로 프로젝트를 그리지만, 상태바는 §5.5 규율대로
 * **세션 하나를 주어로** 삼는다. 그 둘을 잇는 유일한 물건이 이 좌표다.
 */
export interface InsuranceSessionScope {
  /** 그 버블 id. 세션 탭이 없을 때(고르기 전·훅 버블) 이것만으로 좁힌다. */
  agentId: string;
  /** 고른 세션 탭 id(`SubAgent.id`). */
  subAgentId?: string | null;
  /** 그 탭의 CLI 세션 UUID(`SubAgent.sessionId`). */
  sessionId?: string | null;
}

/** 원장의 세션 줄들이 공통으로 갖는 좌표(감시 한 줄 · 세션별 집계 한 줄). */
type InsuranceSessionRow = Pick<CompactWatchState, 'sessionId' | 'subAgentId' | 'agentId'>;

/**
 * 원장 한 줄이 **이 세션의 것인가**.
 *
 * ⚠ `subAgentId`(우리 세션 탭 id)와 `sessionId`(CLI 세션 UUID)는 **다른 namespace** 다 —
 * 서로 맞대 보면 영원히 안 맞는다(§2.4 세션 생존 판정이 큐 개수에서 겪은 함정과 같은 부류).
 * 그래서 같은 종류끼리만 견준다.
 *
 * 세션 탭을 고르고 있으면 **그 탭의 두 키로만** 판정한다 — 여기서 `agentId` 까지 받아 주면
 * 형제 탭의 줄이 전부 딸려 들어와 종전(프로젝트 전체 합계)과 다를 바 없어진다.
 */
export function matchesInsuranceSession(row: InsuranceSessionRow, scope: InsuranceSessionScope): boolean {
  if (scope.subAgentId || scope.sessionId) {
    if (scope.subAgentId && row.subAgentId === scope.subAgentId) return true;
    if (scope.sessionId && row.sessionId === scope.sessionId) return true;
    return false;
  }
  return !!row.agentId && row.agentId === scope.agentId;
}

/**
 * §5.26 (F)(I) — **이 세션**의 감시 등급. 없으면 `null`(칸은 평소 색으로 선다).
 *
 * 종전에는 프로젝트 안 **모든 세션 중 최악**을 그려, 옆 세션 하나가 벽에 닿으면 멀쩡한 세션의
 * 상태바까지 빨갛게 물들었다. 한 세션에 줄이 둘일 일은 없지만 최악 고르기는 그대로 둔다 —
 * 판정 규칙을 두 벌로 만들지 않는다.
 */
export function sessionWatchLevel(
  led: ProjectInsuranceLedger | undefined,
  scope: InsuranceSessionScope,
): CompactWatchLevel | null {
  const rows = (led?.watch ?? []).filter((w) => matchesInsuranceSession(w, scope));
  return worstWatchLevel(rows);
}

/**
 * §5.26 (I) — **이 세션**에서 압축이 실패로 끝난 횟수.
 *
 * 종전에는 `counts.failedCompacts`(프로젝트 전체 합)를 읽어, 세션 여덟 개짜리 버블에서 실패 한 건이
 * 여덟 탭 모두에 `1` 로 떴다(사용자 보고). 세는 것은 서버이고(§3.1 · 전선 목록은 잘려 있다)
 * 여기서는 **내 줄만 골라 더한다**.
 */
export function sessionFailedCompacts(
  led: ProjectInsuranceLedger | undefined,
  scope: InsuranceSessionScope,
): number {
  let total = 0;
  for (const row of (led?.sessionCounts ?? []) as readonly InsuranceSessionCounts[]) {
    if (matchesInsuranceSession(row, scope)) total += row.failedCompacts;
  }
  return total;
}

/** 바이트를 사람이 읽는 크기로. 저장고 사용량·기록 크기가 같은 규칙을 쓴다. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 시각 표기 — 감사 타임라인과 같은 모양(두 화면이 다르게 적으면 같은 사건이 달라 보인다). */
export function formatInsuranceTime(at: number): string {
  if (!at) return '—';
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "요약이 안 실은 것" 갈피에 세울 줄들.
 *
 * 결과가 붙은 마커만 본다 — 아직 대조 전인 것은 "안 실렸다"고 말할 근거가 없다(§5.26 (D)).
 * 실을 것이 하나도 없는 마커도 뺀다(빈 줄로 목록만 늘리지 않는다).
 */
export function notCarriedRows(led: ProjectInsuranceLedger | undefined): CompactMarker[] {
  if (!led) return [];
  return led.markers.filter((m) => {
    const nc = m.outcome?.notCarried;
    if (!nc) return false;
    return nc.openFiles.length > 0 || nc.recentEdits.length > 0 || nc.runningTasks.length > 0
      || nc.goalSteps.length > 0 || nc.teammates.length > 0 || !!nc.goal;
  });
}

// ─── §7.23 범위 축 — 이 세션 / 이 에이전트 / 이 프로젝트 ───
//
// 원장은 프로젝트 한 장이지만 **읽는 사람의 주어는 셋**이다. "내가 방금 뭘 잃었나"(세션),
// "이 버블이 여태 뭘 겪었나"(에이전트), "이 저장고에 뭐가 쌓였나"(프로젝트) — 셋은 같은
// 원장을 보면서도 서로 다른 질문이라, 한 눈금만 내주면 나머지 둘은 영영 답이 없다.
//
// 종전에는 팝업이 프로젝트 전량만 그려서, 세션 여덟 개짜리 버블에서 "내 압축"을 골라낼
// 길이 없었다(사용자 보고). 상태바가 §5.26 (I) 로 이미 겪고 고친 사고와 같은 부류다 —
// 그래서 판정도 그때 만든 `matchesInsuranceSession` 을 **그대로 재사용**한다(두 벌 ❌).

/** §7.23 — 목록을 좁히는 눈금 셋. 좁은 것부터 넓은 것 순(화면 순서와 같다). */
export type InsuranceScopeLevel = 'session' | 'agent' | 'project';

export const INSURANCE_SCOPE_LEVELS: InsuranceScopeLevel[] = ['session', 'agent', 'project'];

/** 눈금 이름의 i18n 키. */
export const INSURANCE_SCOPE_LABEL_KEY: Record<InsuranceScopeLevel, string> = {
  session: 'panel.insurance.scope.session',
  agent: 'panel.insurance.scope.agent',
  project: 'panel.insurance.scope.project',
};

/**
 * 세션 눈금을 **고를 수 있는가**.
 *
 * 세션 탭이 없는 버블(고르기 전·훅 버블)에서는 세션을 주어로 삼을 좌표가 없다. 그때 눈금을
 * 그려 두면 누르는 순간 목록이 통째로 비어 "고장난 창"이 된다 — 아예 내주지 않는다.
 */
export function canScopeToSession(scope: InsuranceSessionScope): boolean {
  return !!(scope.subAgentId || scope.sessionId);
}

/** 지금 쓸 수 있는 눈금들. 세션 좌표가 없으면 둘만 선다. */
export function availableScopeLevels(scope: InsuranceSessionScope): InsuranceScopeLevel[] {
  return canScopeToSession(scope)
    ? INSURANCE_SCOPE_LEVELS
    : INSURANCE_SCOPE_LEVELS.filter((l) => l !== 'session');
}

/**
 * 고른 눈금이 지금 쓸 수 없으면 **한 칸 넓혀 준다**.
 *
 * 세션 탭을 닫거나 훅 버블로 옮기면 `session` 눈금이 사라지는데, 고른 값을 그대로 두면
 * 빈 목록이 남는다. 좁히는 쪽이 아니라 **넓히는 쪽**으로 물러서는 것이 규칙이다 —
 * 보험 화면에서 안 보이는 줄은 없는 줄로 읽힌다.
 */
export function resolveScopeLevel(
  wanted: InsuranceScopeLevel,
  scope: InsuranceSessionScope,
): InsuranceScopeLevel {
  if (wanted === 'session' && !canScopeToSession(scope)) return 'agent';
  return wanted;
}

/**
 * 원장 줄 하나가 **고른 눈금 안에 드는가**.
 *
 * - `project` — 전부 든다(원장이 이미 프로젝트 한 장이다).
 * - `agent` — 그 버블에 귀속된 줄만. `agentId` 가 없는 줄(귀속 기록이 없는 옛 줄·디스크에서만
 *   찾은 줄)은 **들지 않는다.** 남의 버블 것일 수 있는 줄을 내 것으로 적지 않는다 —
 *   보험 화면의 유일한 약속이 "없는 것을 있다고 적지 않는다"다(§5.26 (A)).
 * - `session` — 세션 판정은 상태바와 **같은 함수**를 쓴다. `subAgentId` 와 `sessionId` 는
 *   다른 namespace 라 같은 종류끼리만 견준다는 규율까지 그대로 물려받는다.
 */
export function rowInScope(
  row: InsuranceSessionRow,
  level: InsuranceScopeLevel,
  scope: InsuranceSessionScope,
): boolean {
  if (level === 'project') return true;
  if (level === 'agent') return !!row.agentId && row.agentId === scope.agentId;
  return matchesInsuranceSession(row, scope);
}

/** 마커·사본·부활 줄을 눈금으로 거른다. 세 목록이 같은 규칙을 쓴다. */
export function filterByScope<T extends InsuranceSessionRow>(
  rows: readonly T[] | undefined,
  level: InsuranceScopeLevel,
  scope: InsuranceSessionScope,
): T[] {
  if (!rows) return [];
  if (level === 'project') return [...rows];
  return rows.filter((r) => rowInScope(r, level, scope));
}

/**
 * 눈금 안의 "요약이 안 실은 것" 줄들.
 *
 * `notCarriedRows` 와 같은 규칙(결과가 붙고 실을 것이 있는 마커만)에 눈금을 한 겹 더 씌운다.
 * 두 곳에서 조건을 따로 적으면 갈피 ①과 ②가 서로 다른 목록을 말하게 된다.
 */
export function scopedNotCarriedRows(
  led: ProjectInsuranceLedger | undefined,
  level: InsuranceScopeLevel,
  scope: InsuranceSessionScope,
): CompactMarker[] {
  return filterByScope(notCarriedRows(led), level, scope);
}

/**
 * 눈금 하나에 걸린 줄 수 — 눈금 이름 옆에 서는 숫자.
 *
 * 누르기 전에 "저쪽에 뭐가 있나"를 알 수 있어야 눈금이 쓸모가 있다. 안 그러면 사용자가
 * 빈 목록을 보고 세 눈금을 다 눌러 봐야 한다.
 *
 * ⚠ **전선 목록은 잘려 있다**(`INSURANCE_SNAPSHOT_MARKERS`). 그래서 이 숫자는 "저장고에
 * 있는 전부"가 아니라 **"지금 이 창이 그릴 수 있는 것"** 이다. 팝업은 열 때 전문 원장을
 * 받아 오므로(`GET /api/insurance`) 평소에는 둘이 같지만, 못 받은 경우에도 화면에 있는
 * 줄 수와 눈금 숫자가 어긋나지는 않는다 — 세는 대상이 그리는 대상과 같기 때문이다.
 */
export function scopeRowCount(
  led: ProjectInsuranceLedger | undefined,
  tab: InsuranceTab,
  level: InsuranceScopeLevel,
  scope: InsuranceSessionScope,
): number {
  if (!led) return 0;
  // 갈피마다 줄 타입이 달라 한 변수로 묶으면 union 이 된다 — 세 줄로 나눠 각자 세게 둔다
  //   (`filterByScope` 는 generic 이라 union 을 넘기면 인스턴스가 하나로 접혀 버린다).
  if (tab === 'notCarried') return scopedNotCarriedRows(led, level, scope).length;
  if (tab === 'compacts') return filterByScope(led.markers, level, scope).length;
  if (tab === 'preimages') return filterByScope(led.preimages, level, scope).length;
  return filterByScope(led.resurrectable, level, scope).length;
}

/**
 * 금고 크기를 **이 눈금에서 말해도 되는가**.
 *
 * `counts.vaultBytes` 는 디스크에서 잰 **프로젝트 저장고 전체**다(blobs + transcripts).
 * 세션 몫으로 쪼갤 근거가 없다 — 사본 하나가 여러 세션에 걸릴 수 있고, 트랜스크립트는
 * 세션 것이어도 blob 은 내용 해시로 공유된다. 그래서 좁힌 눈금에서는 **그 숫자를 적지
 * 않는다.** 프로젝트 합계를 세션 칸에 적으면 그건 틀린 숫자이고, 그럴싸하게 쪼갠 숫자는
 * 더 나쁘다(§5.26 (A) — 모르는 것을 지어내지 않는다).
 */
export function showsVaultSize(level: InsuranceScopeLevel): boolean {
  return level === 'project';
}

// ─── §7.23 "이 줄이 무슨 내용인가" ───
//
// 사용자 보고: "안에 들어있던 내용들 보면 내가 하나도 알아볼 수 없다". 목록이 식별자·시각·크기만
// 적고 있어서, 되살릴지 되돌릴지를 고르는 화면에서 **고를 근거가 없었다.** 아래 함수들은 원장이
// 이미 들고 있는 사실로 그 줄에 **뜻**을 붙인다 — 새로 세거나 지어내지 않는다(§3.1 · §5.26 (A)).

/**
 * 세션 한 줄의 제목. 서버가 붙여 준 것을 그대로 쓰고, 없으면 **`null`**.
 *
 * ⚠ 화면이 여기서 `sessionId.slice(0, 8)` 로 물러서지 **않는다** — 그 문자열이 바로 사용자가
 * 못 읽겠다고 한 것이다. 제목이 없으면 없다고 적는 편이 낫고(그 줄은 시각·크기로 고른다),
 * id 는 따로 작은 글씨로 곁들인다.
 */
export function resurrectTitle(s: Pick<ResurrectableSession, 'label'>): string | null {
  const t = s.label?.trim();
  return t ? t : null;
}

/** 세션 id 를 곁들일 때 쓰는 짧은 꼴. 제목의 자리를 뺏지 않는 보조 표기다. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * 압축 한 줄이 **무엇을 하던 중이었나**. 마커의 작업 묶음에서 사람이 읽을 한 줄을 만든다.
 *
 * 종전에는 시각·트리거·바이트만 적어, 압축 이력 다섯 줄이 서로 구별되지 않았다. 목표 한 줄이
 * 있으면 그것이 가장 좋은 설명이고, 없으면 만지던 파일 이름으로 대신한다. 둘 다 없으면
 * `null` — 그 세션이 무엇을 하던 중이었는지 우리가 **모른다**는 뜻이고, 그대로 비워 둔다.
 */
export function markerSubject(m: CompactMarker): string | null {
  const goal = m.workingSet.goal?.trim();
  // 슬래시 명령 자체(`/compact`)는 "무엇을 하던 중"이 아니라 "무엇을 눌렀나"라 설명이 못 된다.
  if (goal && !/^\/\w+$/.test(goal)) return goal;
  const files = [...m.workingSet.recentEdits, ...m.workingSet.openFiles];
  if (files.length > 0) {
    const first = baseName(files[0] ?? '');
    return files.length > 1 ? `${first} 외 ${files.length - 1}` : first;
  }
  const task = m.workingSet.runningTasks[0]?.trim();
  if (task) return task;
  return goal ? goal : null;
}

/** 경로에서 파일명만. `preimageFileName` 과 같은 규칙(윈도우 경로가 그대로 온다). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * 같은 파일의 사본이 여러 줄일 때 **몇 번째 판인가**.
 *
 * 한 파일을 네 번 고치면 목록에 `projectgraph.ts` 가 네 줄 서는데, 종전에는 시각 말고 구별할
 * 것이 없었다(사용자가 "알아볼 수 없다"고 한 자리 중 하나다). 목록은 최신 순이므로 **뒤로 갈수록
 * 옛 판**이다 — `1` 이 가장 최근, 큰 수가 더 옛것.
 *
 * 한 벌뿐인 파일에는 붙이지 않는다(`null`) — 모든 줄에 `1/1` 이 붙으면 그건 잡음이다.
 */
export function preimageRevisions(list: readonly FilePreimage[]): Map<string, { index: number; total: number }> {
  const byFile = new Map<string, FilePreimage[]>();
  for (const p of list) {
    const key = p.pathKey || p.path;
    const arr = byFile.get(key);
    if (arr) arr.push(p); else byFile.set(key, [p]);
  }
  const out = new Map<string, { index: number; total: number }>();
  for (const group of byFile.values()) {
    if (group.length < 2) continue;
    group.forEach((p, i) => out.set(p.id, { index: i + 1, total: group.length }));
  }
  return out;
}

/** 사본을 뜨게 만든 도구가 **무엇을 했나** — 낱말의 i18n 키. */
export function preimageActionKey(p: FilePreimage): string {
  if (!p.sha256) return 'panel.insurance.action.created';
  return p.toolName === 'Bash' ? 'panel.insurance.action.shell' : 'panel.insurance.action.edited';
}
