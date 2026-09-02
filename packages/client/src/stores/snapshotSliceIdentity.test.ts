import { describe, it, expect } from 'vitest';
import { useGraphStore } from './graphStore.js';
import { batchStoreNotify } from './batchedNotify.js';

/**
 * §9 — **같은 내용의 스냅샷은 스토어의 참조를 하나도 바꾸지 않는다.**
 *
 * 서버는 `graph_snapshot` 으로 **전체 그래프**를 매번 실어 보낸다(부분 patch ❌). 스냅샷 반영은
 * `loadSnapshot` 1회 + `apply*` 35회로 이루어지는데, 그중 다수가 받은 값을 **그대로 갈아끼웠다** —
 * 내용이 한 글자도 안 바뀐 스냅샷에도 슬라이스가 새 참조가 되고, 그 슬라이스를 보는 화면 전부가
 * 스냅샷 주기(16ms)마다 리렌더됐다. 실측(구독 4,000개 근사): **스냅샷 1건당 리렌더 유발 612건**.
 *
 * 더 고약한 축이 하나 더 있었다 — `set({ x: value ?? {} })` 는 서버가 그 필드를 **한 번도 안 보내는
 * 동안에도** 매번 새 빈 객체를 만든다. 즉 그 기능을 아예 안 쓰는 사람이 가장 확실하게 손해를 봤다.
 *
 * 이 테스트는 액션 하나하나가 아니라 **계약**을 건다: 같은 값을 두 번 넣으면 참조가 유지되어야 하고,
 * 값이 실제로 바뀌면 반드시 새 참조여야 한다. 새 `apply*` 를 추가할 때 여기 한 줄만 늘리면 된다.
 */

/** 슬라이스 이름 → (그 슬라이스를 채우는 액션 호출, 바뀐 값) */
const CASES: Array<{
  slice: keyof ReturnType<typeof useGraphStore.getState>;
  apply: (v: unknown) => void;
  same: unknown;
  changed: unknown;
}> = [
  { slice: 'agentReports', apply: (v) => useGraphStore.getState().applyAgentReports(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'agentQuestions', apply: (v) => useGraphStore.getState().applyAgentQuestions(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'agentReviews', apply: (v) => useGraphStore.getState().applyAgentReviews(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'agentLists', apply: (v) => useGraphStore.getState().applyAgentLists(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'agentFeedbacks', apply: (v) => useGraphStore.getState().applyAgentFeedbacks(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'agentMemos', apply: (v) => useGraphStore.getState().applyAgentMemos(v as never), same: { 'a-1': [] }, changed: { 'a-2': [] } },
  { slice: 'sessionGoals', apply: (v) => useGraphStore.getState().applySessionGoals(v as never), same: {}, changed: { 'a-1': { text: 'x' } } },
  { slice: 'sessionLoops', apply: (v) => useGraphStore.getState().applySessionLoops(v as never), same: {}, changed: { 'a-1': { mode: 'x' } } },
  { slice: 'verificationRuns', apply: (v) => useGraphStore.getState().applyVerificationRuns(v as never), same: {}, changed: { 'a-1': [] } },
  { slice: 'verificationDemos', apply: (v) => useGraphStore.getState().applyVerificationDemos(v as never), same: {}, changed: { 'a-1': [] } },
  { slice: 'skillUsageCounts', apply: (v) => useGraphStore.getState().applySkillUsageCounts(v as never), same: {}, changed: { p: { s: 1 } } },
  { slice: 'autoAgentSummaries', apply: (v) => useGraphStore.getState().applyAutoAgentSummaries(v as never), same: {}, changed: { 'a-1': { text: 'x' } } },
  { slice: 'autoAgentRuns', apply: (v) => useGraphStore.getState().applyAutoAgentRuns(v as never), same: {}, changed: { 'a-1': [] } },
  { slice: 'runningSubagentTasks', apply: (v) => useGraphStore.getState().applyRunningSubagentTasks(v as never), same: {}, changed: { 'a-1': [] } },
  { slice: 'finishedSubagentTasks', apply: (v) => useGraphStore.getState().applyFinishedSubagentTasks(v as never), same: {}, changed: { 'a-1': [] } },
  { slice: 'reviewRequests', apply: (v) => useGraphStore.getState().applyReviewRequests(v as never), same: [], changed: [{ id: 'r1' }] },
  { slice: 'diagnosticLog', apply: (v) => useGraphStore.getState().applyDiagnosticLog(v as never), same: [], changed: [{ at: 1, msg: 'x' }] },
  { slice: 'layoutBoundsByProject', apply: (v) => useGraphStore.getState().applyLayoutBoundsByProject(v as never), same: {}, changed: { p: { hw: 1, hh: 2 } } },
  { slice: 'localLlm', apply: (v) => useGraphStore.getState().applyLocalLlm(v as never), same: null, changed: { engine: {} } },
  { slice: 'modelRegistry', apply: (v) => useGraphStore.getState().applyModelRegistry(v as never), same: null, changed: { models: [] } },
  { slice: 'appState', apply: (v) => useGraphStore.getState().applyAppState(v as never), same: null, changed: { openTabs: [] } },
];

describe('스냅샷 슬라이스 참조 안정성', () => {
  for (const { slice, apply, same, changed } of CASES) {
    it(`${String(slice)} — 같은 값이 다시 와도 참조가 유지된다`, () => {
      // 서버가 매번 **새로 만든** 값을 보내는 상황을 그대로 흉내낸다(JSON 왕복 = 참조 전부 새것).
      apply(structuredClone(same));
      const first = useGraphStore.getState()[slice];
      apply(structuredClone(same));
      expect(useGraphStore.getState()[slice]).toBe(first);
      // 서버가 그 필드를 아예 안 싣는 경우(undefined)도 같은 계약이다 — 빈 값이 매번 새 객체면
      // 그 기능을 안 쓰는 사람이 영원히 리렌더된다.
      if (same !== null && (Array.isArray(same) ? same.length === 0 : Object.keys(same as object).length === 0)) {
        apply(undefined);
        expect(useGraphStore.getState()[slice]).toBe(first);
      }
    });

    it(`${String(slice)} — 값이 실제로 바뀌면 새 참조다(공유가 변경을 삼키지 않는다)`, () => {
      apply(structuredClone(same));
      const before = useGraphStore.getState()[slice];
      apply(structuredClone(changed));
      expect(useGraphStore.getState()[slice]).not.toBe(before);
      expect(useGraphStore.getState()[slice]).toEqual(changed);
    });
  }

  it('한 스냅샷 분량을 통째로 다시 넣어도 구독자는 한 번도 깨지 않는다', () => {
    const snapshot = (): void => {
      batchStoreNotify(() => {
        for (const { apply, same } of CASES) apply(structuredClone(same));
      });
    };

    snapshot(); // 첫 반영 — 여기서 값이 자리를 잡는다

    // 이후 같은 스냅샷이 아무리 흘러도 어떤 슬라이스도 참조가 달라지면 안 된다.
    const before = CASES.map(({ slice }) => useGraphStore.getState()[slice]);
    let notified = 0;
    const off = useGraphStore.subscribe(() => { notified += 1; });
    for (let i = 0; i < 5; i++) snapshot();
    off();

    const after = CASES.map(({ slice }) => useGraphStore.getState()[slice]);
    for (let i = 0; i < CASES.length; i++) {
      expect(after[i], `${String(CASES[i]!.slice)} 의 참조가 바뀌었다`).toBe(before[i]);
    }
    // 통지 자체는 zustand 가 최상위 state 객체를 새로 만들기 때문에 올 수 있다. 중요한 것은
    // **묶음마다 1회 이하**라는 것 — 액션 수(21)만큼 오면 batchStoreNotify 가 풀린 것이다.
    expect(notified).toBeLessThanOrEqual(5);
  });
});
