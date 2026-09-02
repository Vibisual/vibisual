/**
 * §9 — **전선 부피 예산의 집행.** 개별 최적화가 아니라 그 최적화가 무너지지 않게 하는 장치다.
 *
 * 왜 있나: 2026-09-02 라운드에서 키맵 941KB 의 참조 유지율이 **0%** 였던 것을 고쳐 전선을
 * 1,184KB → 408.9KB 로 줄였다. 그런데 그 최적화는 **다음에 슬라이스를 추가하는 사람이 규약을
 * 모르면 그 자리에서 원위치한다** — `GraphSnapshot` 에 `Record<string, Something[]>` 한 줄을
 * 더하는 데는 아무 관문이 없고, 그 슬라이스는 조용히 매 16~250ms 마다 통째로 전선을 탄다.
 * 지금까지 그것을 알아채는 유일한 방법이 "느려졌다"는 사용자 신고였다.
 *
 * 그래서 이 파일이 세 가지를 **빌드에서** 막는다:
 *  ① 새 키맵 슬라이스는 `DELTA_SLICE_KEYS` 에 들거나 아래 예외표에 **이유와 함께** 등재돼야 한다.
 *  ② 아무것도 안 바뀐 스냅샷은 키맵을 한 개도 전선에 올리지 않는다(증분이 실제로 걸리는지).
 *  ③ 참조를 못 지켜 증분을 못 붙이는 슬라이스(`unstable`)는 **개수가 늘지 않는다** — 빚이 쌓이지 않게.
 *
 * 이 집행 방식은 `typographyFloor.test.ts`(12px 하한)·`stores/snapshotSliceIdentity.test.ts`
 * (`apply*` 참조 안정성)와 같은 계열이다. 규약을 문서에만 적으면 반년 뒤 같은 대화를 다시 한다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentReport, GraphSnapshot, WSMessage } from '@vibisual/shared';
import { DELTA_SLICE_KEYS } from '@vibisual/shared';
import { ProjectGraph } from './services/projectGraph.js';
import { broadcast, setBroadcastSink, resetSnapshotDeltaBaseline } from './broadcastBus.js';

vi.mock('./services/appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

// ─────────────────────────────────────────────────────────────────────────────
// 예외표 — 증분을 타지 **않는** 키맵 슬라이스와 그 이유.
//
// 새 슬라이스를 `GraphSnapshot` 에 더하면 이 표에 한 줄을 넣어야 테스트가 통과한다.
// 그 한 줄을 쓰는 동안 "이게 전선에서 얼마나 무거운가"를 한 번 생각하게 되는 것이 목적이다.
//
// 사유 코드:
//  · `scoped`   — 프로젝트/폴더 스코프가 이미 범위를 좁힌다(§9 스코프드 스냅샷). 증분은 이중 방어.
//  · `small`    — 항목이 짧아(수십~수백 바이트) 증분의 `changed` 사본이 이득을 못 넘긴다.
//  · `volatile` — 사실상 매 틱 바뀌므로 증분이 늘 "과반 변경"으로 전량 회귀한다.
//  · `unstable` — **증분을 붙이고 싶지만 참조를 못 지킨다.** 고쳐야 할 빚이고 개수 상한이 걸려 있다.
// ─────────────────────────────────────────────────────────────────────────────
type ExemptReason = 'scoped' | 'small' | 'volatile' | 'unstable';

const WIRE_BUDGET_EXEMPT: Record<string, { reason: ExemptReason; note: string }> = {
  // ── scoped: 범위 축소가 이미 걸려 있다 ──────────────────────────────────────
  children: { reason: 'scoped', note: '폴더 스코프가 "그리는 폴더 + 한 칸 앞"으로 좁힌다(1.31MB→73KB)' },
  innerEdges: { reason: 'scoped', note: '폴더 스코프 대상 3종 중 하나 — children 과 같은 칸' },
  satellites: { reason: 'scoped', note: '폴더 위성만 좁힌다(에이전트 위성은 메인 캔버스라 항상 전량)' },
  projects: { reason: 'scoped', note: '프로젝트당 수백 바이트 · §9 ④ 로 범위 무관 항상 전량이 규약' },
  projectAgentCounts: { reason: 'scoped', note: '전역 집계 — §9 ④ 로 항상 전량. 프로젝트 수만큼의 작은 수' },
  stubProjects: { reason: 'scoped', note: 'ProjectMetaSnapshot — 탭 표시용 메타라 §9 ④ 항상 전량' },

  // ── small: 증분의 changed 사본이 이득을 못 넘긴다 ────────────────────────────
  pipelines: { reason: 'small', note: '파이프라인 수는 한 자릿수' },
  agentConfigs: { reason: 'small', note: '에이전트당 설정 한 벌 — 모델명·도구 목록 수준' },
  taskEdges: { reason: 'small', note: '엣지 하나에 좌표·라벨뿐' },
  sessionSources: { reason: 'small', note: '세션당 enum 한 글자' },
  sessionStatuses: { reason: 'small', note: '세션당 enum 한 글자' },
  compactCounts: { reason: 'small', note: '세션당 정수 두 개' },
  autoAgentSummaries: { reason: 'small', note: '오토 에이전트당 요약 한 줄 — 본문은 여기 담지 않는다' },
  sessionLoops: { reason: 'small', note: '반복 명령 상태 — 켠 탭만 있고 필드가 몇 개다' },
  brain: { reason: 'small', note: 'BrainSummary 는 요약 수치 — 카드 본문은 §5.10 대로 스냅샷에 안 태운다' },
  activeContiWork: { reason: 'small', note: '진행 중 콘티 작업 한 건씩' },
  debugBreakpoints: { reason: 'small', note: '사용자가 찍은 중단점 — 수십 개 규모' },
  runningServers: { reason: 'small', note: 'dev 서버 항목은 포트·URL 수준' },
  skillUsageCounts: { reason: 'small', note: '스킬명 → 호출 횟수 정수 하나. 키가 늘어도 줄이 짧다' },
  pluginFacts: { reason: 'small', note: '플러그인이 신고한 짧은 사실 — 큰 본문은 규약상 금지' },

  // ── volatile: 매 틱 바뀌어 증분이 전량으로 회귀한다 ──────────────────────────
  commandQueues: { reason: 'volatile', note: '큐는 넣고 빼는 것이 일이라 과반 변경이 상시다' },
  completedCommands: { reason: 'volatile', note: '완료 이력 — 도는 동안 계속 뒤가 붙는다' },
  runningSubagentTasks: { reason: 'volatile', note: '진행률이 초 단위로 바뀐다' },
  finishedSubagentTasks: { reason: 'volatile', note: 'running 에서 옮겨 오는 자리라 running 과 한 쌍' },
  recentToolDurations: { reason: 'volatile', note: '도구가 끝날 때마다 붙는 최근 N건' },
  contis: { reason: 'volatile', note: '콘티 편집 중에는 매 조작마다 바뀐다' },
  domainEntries: { reason: 'volatile', note: '웹 읽기마다 붙는다 — 다만 항목이 짧다' },
  autoAgentRuns: { reason: 'volatile', note: '오토 에이전트 실행 이력' },
  verificationRuns: { reason: 'volatile', note: '검증 실행 중 상태가 계속 바뀐다' },
  verificationDemos: { reason: 'volatile', note: 'verificationRuns 와 한 쌍' },
  pipelineChildren: { reason: 'volatile', note: '파이프라인이 도는 동안 자식 상태가 계속 바뀐다' },

  // ── unstable: 고쳐야 할 빚 (개수 상한 있음 — 아래 ③) ────────────────────────
  subAgents: {
    reason: 'unstable',
    note:
      '실측 115KB. `enrichAgents` 가 매 스냅샷마다 새 객체를 지어 참조 유지율 0% 라 ' +
      '증분을 붙여도 부피가 줄지 않는다. `stableCopy` 와 같은 수법이 필요하다.',
  },
};

/** `unstable` 이 늘어나지 않게 하는 상한. **줄이는 방향으로만 고친다.** */
const UNSTABLE_BUDGET = 1;

// ─────────────────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
afterEach(() => {
  setBroadcastSink(null);
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeGraph(): ProjectGraph {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-budget-')));
  tmpDirs.push(dir);
  const g = new ProjectGraph();
  g.registerProject(dir);
  return g;
}

const report = (agentId: string, id: string): AgentReport =>
  ({ id, agentId, did: 'did ' + id, userActions: [], createdAt: Date.now() } as unknown as AgentReport);

/**
 * `GraphSnapshot` 선언에서 **키맵 슬라이스**(`Record<string, 무거울 수 있는 값>`)를 뽑는다.
 *
 * 값이 `string`/`number`/`boolean` 인 것은 키 수만큼 늘어도 한 줄이 짧아 자동 면제다
 * (그래도 `nodeProjects` 처럼 키가 수천 개면 목록에 넣을 수 있다 — 면제는 하한이지 금지가 아니다).
 */
function keyedSliceFieldsOfSnapshot(): string[] {
  const typesPath = fileURLToPath(new URL('../../shared/src/types.ts', import.meta.url));
  const src = fs.readFileSync(typesPath, 'utf8');
  const block = /export interface GraphSnapshot \{([\s\S]*?)\n\}/.exec(src);
  expect(block, 'GraphSnapshot 선언을 못 찾았다 — 이 스캔의 전제가 깨졌다').toBeTruthy();

  const found: string[] = [];
  const re = /^ {2}(\w+)\??:\s*Record<string,\s*([^;]+)>;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block![1] as string)) !== null) {
    const [, field, valueType] = m;
    if (/^(string|number|boolean)$/.test((valueType as string).trim())) continue; // 스칼라 값 = 자동 면제
    found.push(field as string);
  }
  return found;
}

describe('① 새 키맵 슬라이스는 반드시 등재된다 (이 파일의 존재 이유)', () => {
  it('모든 키맵 슬라이스가 증분 목록이나 예외표 중 한 곳에 있다', () => {
    const delta = new Set<string>(DELTA_SLICE_KEYS);
    const unregistered = keyedSliceFieldsOfSnapshot()
      .filter((f) => !delta.has(f) && !(f in WIRE_BUDGET_EXEMPT));

    expect(
      unregistered,
      '\n' +
      'GraphSnapshot 에 등재되지 않은 키맵 슬라이스가 있다: ' + unregistered.join(', ') + '\n\n' +
      '이 슬라이스는 지금 **매 브로드캐스트(16~250ms)마다 통째로** 전선을 탄다.\n' +
      '둘 중 하나를 하라:\n' +
      '  (A) 증분을 붙인다 — `DELTA_SLICE_KEYS`(shared/keyedSliceDelta.ts)에 한 줄.\n' +
      '      ⚠ 넣기 전에 그 슬라이스가 **참조를 유지하는지** 확인하라. 매번 새로 만드는\n' +
      '      슬라이스를 넣으면 부피가 줄기는커녕 `changed` 사본만 한 벌 더 든다.\n' +
      '      참조를 지키는 자리는 `ProjectGraph.stableCopy` / `sessionGoalViewCache`.\n' +
      '  (B) 안 붙일 이유를 이 파일의 `WIRE_BUDGET_EXEMPT` 에 사유 코드와 함께 적는다.\n',
    ).toEqual([]);
  });

  it('예외표에 죽은 항목이 없다 — 슬라이스가 사라지면 줄도 지운다', () => {
    const live = new Set(keyedSliceFieldsOfSnapshot());
    const stale = Object.keys(WIRE_BUDGET_EXEMPT).filter((f) => !live.has(f));
    expect(stale, '`GraphSnapshot` 에 없는 슬라이스가 예외표에 남아 있다: ' + stale.join(', ')).toEqual([]);
  });

  it('증분 목록과 예외표는 겹치지 않는다 — 한 슬라이스는 한 칸에만', () => {
    const both = DELTA_SLICE_KEYS.filter((k) => k in WIRE_BUDGET_EXEMPT);
    expect(both, '증분을 타면서 예외표에도 있는 슬라이스: ' + both.join(', ')).toEqual([]);
  });
});

describe('② 아무것도 안 바뀌면 키맵은 전선에 오르지 않는다', () => {
  it('같은 상태를 두 번 브로드캐스트하면 두 번째엔 증분 대상이 한 개도 안 실린다', () => {
    const sent: WSMessage[] = [];
    resetSnapshotDeltaBaseline();
    setBroadcastSink((m) => { sent.push(m); });

    const g = makeGraph();
    for (const id of ['a1', 'a2', 'a3', 'a4']) g.addAgentReport(report(id, id + '-r1'));
    g.setSessionGoal({ agentId: 'a1', subAgentId: 's1', text: '목표', steps: [] });

    const push = (): Record<string, unknown> => {
      broadcast({ type: 'graph_snapshot', payload: g.getSnapshot(), timestamp: Date.now() } as WSMessage);
      return (sent[sent.length - 1] as unknown as { payload: Record<string, unknown> }).payload;
    };

    push();                 // 첫 전송 = 기준점 세우기(전량)
    const second = push();  // 아무것도 안 바꾸고 한 번 더

    const deltas = (second['deltas'] ?? {}) as Record<string, { changed: Record<string, unknown>; removed: string[] }>;
    for (const key of DELTA_SLICE_KEYS) {
      // 전량으로 실렸으면 증분이 아예 안 걸린 것 — 참조 안정성이 무너졌다는 뜻이다.
      expect(second[key], key + ' 가 정지 상태인데 전량으로 실렸다(참조 안정성 붕괴)').toBeUndefined();
      const d = deltas[key];
      if (!d) continue; // 그 슬라이스가 이 스냅샷에 아예 없다 — 정상
      expect(Object.keys(d.changed), key + ' 가 안 바뀌었는데 changed 가 비지 않았다').toEqual([]);
      expect(d.removed, key + ' 가 안 바뀌었는데 removed 가 비지 않았다').toEqual([]);
    }
  });

  it('정지 상태의 증분은 실제로 바이트를 아낀다 — 전량 대비 1% 미만', () => {
    const sent: WSMessage[] = [];
    resetSnapshotDeltaBaseline();
    setBroadcastSink((m) => { sent.push(m); });

    const g = makeGraph();
    // 증분의 이득이 드러날 만큼은 쌓는다(한 에이전트에 한 건이면 "과반 변경"이라 전량으로 회귀한다).
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 8; k++) g.addAgentReport(report('agent-' + i, `r${i}-${k}`));
    }

    const push = (): Record<string, unknown> => {
      broadcast({ type: 'graph_snapshot', payload: g.getSnapshot(), timestamp: Date.now() } as WSMessage);
      return (sent[sent.length - 1] as unknown as { payload: Record<string, unknown> }).payload;
    };

    const first = push();
    const second = push();

    const bytesOf = (o: unknown): number => JSON.stringify(o ?? null).length;
    const fullReports = bytesOf(first['agentReports']);
    const deltaReports = bytesOf(
      (second['deltas'] as Record<string, unknown> | undefined)?.['agentReports'],
    );

    expect(fullReports).toBeGreaterThan(1000); // 픽스처가 실제로 무거운지 먼저 확인
    expect(
      deltaReports / fullReports,
      `정지 상태 증분이 전량의 ${((deltaReports / fullReports) * 100).toFixed(1)}% 다 — 증분이 안 걸렸다`,
    ).toBeLessThan(0.01);
  });
});

describe('③ 증분을 못 붙이는 슬라이스는 늘어나지 않는다', () => {
  it('`unstable` 항목 수가 예산 안이다 — 빚은 줄이는 방향으로만', () => {
    const unstable = Object.entries(WIRE_BUDGET_EXEMPT)
      .filter(([, v]) => v.reason === 'unstable')
      .map(([k]) => k);

    expect(
      unstable.length,
      '\n' +
      '참조를 못 지켜 증분을 못 붙이는 슬라이스: ' + unstable.join(', ') + '\n' +
      `예산은 ${UNSTABLE_BUDGET} 개다. 새로 늘리지 말고, 고쳤으면 예산을 함께 내려라.\n`,
    ).toBeLessThanOrEqual(UNSTABLE_BUDGET);
  });

  it('모든 예외 항목에 이유가 적혀 있다 — 빈 note 는 등재가 아니다', () => {
    const empty = Object.entries(WIRE_BUDGET_EXEMPT)
      .filter(([, v]) => v.note.trim().length < 10)
      .map(([k]) => k);
    expect(empty, '이유가 비었거나 너무 짧은 항목: ' + empty.join(', ')).toEqual([]);
  });
});
