/**
 * §5.4 #14-3 — **동작 중인 에이전트가 있는 프로젝트 탭을 닫을 때의 판정.**
 *
 * 탭 × 는 종전에 아무것도 묻지 않고 바로 닫았다. 그런데 프로젝트 탭을 닫으면 그 인스턴스가
 * 통째로 내려가므로(§9 `unload-project`), 그 안에서 돌던 세션은 **화면에서 사라지기만 하고
 * 자식 프로세스는 남는다** — 사용자는 멈춘 줄 알고, 메모리는 계속 물려 있다. 그래서 도는 것이
 * 있으면 한 번 묻는다. **도는 것이 없으면 종전 그대로 즉시 닫힌다**(신호 도배 방지 — §5.5 #17-8
 * IDE 세션 탭 확인 팝업과 같은 규율).
 *
 * 판정을 순수 함수로 떼어 둔 이유는 `resolveTabReorder`·`overlayCloseIntent` 선례와 같다 —
 * DOM 없이 단위 테스트로 고정할 수 있어야 "닫히지 않는다/묻지 않는다"가 회귀로 잡힌다.
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

/**
 * 닫기 대상 목록에서 확인이 필요한지 가른다.
 *
 * `runningCount` 는 **서버 집계가 SSOT**(§3.1)인 탭 배지의 분자를 그대로 받는다 — 여기서 다시
 * 세지 않는다. 음수·NaN 같은 이상값은 0 으로 접는다(옛 스냅샷이 섞여 들어와도 "돌고 있다"고
 * 거짓말하지 않게).
 */
export function resolveTabCloseIntent(targets: readonly TabCloseTarget[]): TabCloseIntent {
  const running = targets
    .map((t, index) => ({ t, index, running: normalizeRunning(t.runningCount) }))
    .filter((r) => r.running > 0)
    .sort((a, b) => (b.running - a.running) || (a.index - b.index))
    .map((r) => r.t);
  const runningSessions = running.reduce((sum, t) => sum + normalizeRunning(t.runningCount), 0);
  return { needsConfirm: running.length > 0, running, runningSessions };
}

/**
 * [닫기] 가 중지 요청을 보낼 **프로젝트 id 목록**(중복 제거, 원래 순서).
 *
 * iframe 탭은 에이전트를 갖지 않으므로 빠진다. "모든 에이전트 강제 종료" 를 켠 경우에도 요청
 * 자체는 프로젝트 하나를 타고 나가므로(라우트가 `:name` 을 받는다) 이 목록의 **첫 항목**이
 * 그 통로가 된다 — 스코프는 body 의 `scope` 가 정한다.
 */
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
