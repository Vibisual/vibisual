/**
 * §5.4 #14-3 — 도는 에이전트가 있는 프로젝트 탭 닫기 판정(순수 함수 — DOM 없이 고정). 닫으면 인스턴스가 내려가(§9 `unload-project`)
 * 세션은 화면에서만 사라지고 자식 프로세스는 남으므로 도는 것이 있으면 묻는다. 없으면 즉시 닫는다(§5.5 #17-8 과 같은 규율).
 */

/** 닫으려는 탭 하나. TabBar 의 `TabItem` 을 이 모양으로 접어서 넘긴다. */
export interface TabCloseTarget {
  /** 탭 키(`p:<name>` / `i:<id>`). */
  key: string;
  kind: 'project' | 'iframe';
  /** 팝업 목록에 그릴 이름. 사용자 콘텐츠라 i18n 대상이 아니다. */
  label: string;
  /** 그 탭에서 지금 도는 **세션 수**(탭 배지의 분자와 같은 값). iframe 탭은 항상 0. */
  runningCount: number;
  /** 프로젝트 탭이면 닫기·중지에 쓰는 projectId(경로). iframe 탭은 없다. */
  projectId?: string;
}

/** 이 닫기를 어떻게 처리할지. */
export interface TabCloseIntent {
  /** 확인 팝업을 띄워야 하는가 = 대상 중 **하나라도** 돌고 있는가. */
  needsConfirm: boolean;
  /** 그중 실제로 도는 탭들 — 많이 도는 순, 동률이면 원래 순서. 팝업의 목록이 된다. */
  running: TabCloseTarget[];
  /** 도는 세션 총합 — 팝업 문구의 숫자. */
  runningSessions: number;
}

/** 확인이 필요한지 가른다. `runningCount` 는 탭 배지 분자(서버 SSOT, §3.1) 그대로 — 음수·NaN 은 0 으로 접는다. */
export function resolveTabCloseIntent(targets: readonly TabCloseTarget[]): TabCloseIntent {
  const running = targets
    .map((t, index) => ({ t, index, running: normalizeRunning(t.runningCount) }))
    .filter((r) => r.running > 0)
    .sort((a, b) => (b.running - a.running) || (a.index - b.index))
    .map((r) => r.t);
  const runningSessions = running.reduce((sum, t) => sum + normalizeRunning(t.runningCount), 0);
  return { needsConfirm: running.length > 0, running, runningSessions };
}

/** [닫기] 가 중지 요청을 보낼 프로젝트 id(중복 제거, 순서 유지, iframe 제외). 전체 강제 종료도 라우트가 `:name` 을 받아 첫 항목을 통로로 쓴다 — 범위는 body `scope`. */
export function stopTargetProjectIds(targets: readonly TabCloseTarget[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (t.kind !== 'project') continue;
    const id = t.projectId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeRunning(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
