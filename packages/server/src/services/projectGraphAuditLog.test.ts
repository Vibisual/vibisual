import { describe, expect, it } from 'vitest';
import type { HookEventPayload } from '@vibisual/shared';
import {
  AUDIT_ENTRIES_MAX_PER_PROJECT,
  AUDIT_SNAPSHOT_ENTRIES,
  classifyToolRisk,
  shouldEscalateRisk,
  summarizeToolCall,
} from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.22 — 권한·감사 경계의 회귀 테스트.
 *
 * 이 기능이 조용히 깨질 자리는 넷이다.
 *  ① **디스크 포맷 누락** — 결정 이력은 어디서도 재계산할 수 없어 `toProjectCheckpoint` 에서
 *     빠지면 껐다 켠 순간 영영 없다(§5.21·§5.20 이 이미 데인 자리).
 *  ② **한 호출이 두 줄로** — 승인 창구와 훅 이벤트가 같은 호출을 두 길로 알려 오므로, 합치지
 *     못하면 원장 길이가 두 배가 되고 같은 일이 두 번 일어난 것처럼 보인다.
 *  ③ **루프백 오탐** — 우리 자신에게 보내는 호출까지 "외부 전송"으로 잡으면 승인 카드가 도배된다.
 *  ④ **캡이 숫자를 갉아먹음** — 밀려난 줄의 몫이 합계에서 사라지면 감사가 과거를 축소한다.
 */

const PROJECT_CWD = '/tmp/audit-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

function hook(partial: Partial<HookEventPayload> & { tool_name: string }): HookEventPayload {
  return {
    session_id: 'sess-audit',
    hook_event_name: 'PreToolUse',
    cwd: PROJECT_CWD,
    tool_input: {},
    ...partial,
  } as HookEventPayload;
}

function entriesOf(graph: ProjectGraph, projectName: string) {
  return graph.getSnapshot().auditLogs?.find((l) => l.projectName === projectName)?.entries ?? [];
}

function logOf(graph: ProjectGraph, projectName: string) {
  return graph.getSnapshot().auditLogs?.find((l) => l.projectName === projectName);
}

describe('§5.22 위험 판정 — shared 순수 함수 한 곳', () => {
  it('지우는 명령은 delete, 바깥으로 나가는 호출은 network 로 잡는다', () => {
    expect(classifyToolRisk('Bash', { command: 'rm -rf build' })).toEqual(['delete']);
    expect(classifyToolRisk('Bash', { command: 'git reset --hard origin/main' })).toEqual(['delete']);
    expect(classifyToolRisk('Bash', { command: 'curl https://example.com/upload -d @secret' })).toEqual(['network']);
    expect(classifyToolRisk('WebFetch', { url: 'https://example.com' })).toEqual(['network']);
  });

  it('설정 파일을 향한 쓰기는 config — 같은 파일을 읽기만 하면 위험이 아니다', () => {
    expect(classifyToolRisk('Write', { file_path: '/repo/.claude/settings.json' })).toEqual(['config']);
    expect(classifyToolRisk('Read', { file_path: '/repo/.claude/settings.json' })).toEqual([]);
    expect(classifyToolRisk('Bash', { command: 'grep hooks .claude/settings.json' })).toEqual([]);
    expect(classifyToolRisk('Bash', { command: 'echo "{}" > .claude/settings.json' })).toEqual(['config']);
  });

  it('우리 자신(루프백)에게 보내는 호출은 바깥으로 나간 것이 아니다', () => {
    // 작업 신고 카드가 쓰는 바로 그 모양 — 여기서 걸리면 승인 카드가 도배된다.
    expect(classifyToolRisk('Bash', {
      command: 'curl -s -X POST "http://127.0.0.1:51360/api/agent-report" -d @-',
    })).toEqual([]);
    expect(classifyToolRisk('Bash', { command: 'curl http://localhost:4800/api/graph' })).toEqual([]);
    // 목적지를 알 수 없는 curl 은 보수적으로 network 다.
    expect(classifyToolRisk('Bash', { command: 'curl "$UPLOAD_URL"' })).toEqual(['network']);
  });

  it('여러 위험이 한 호출에 겹치면 정해진 순서로 함께 실린다', () => {
    const kinds = classifyToolRisk('Bash', { command: 'rm -rf dist && curl https://example.com/ping' });
    expect(kinds).toEqual(['delete', 'network']);
  });

  it('요약은 사람이 읽는 한 줄이고 대상이 함께 딸려 온다', () => {
    expect(summarizeToolCall('Write', { file_path: '/repo/src/a.ts' })).toEqual({
      summary: '/repo/src/a.ts',
      target: '/repo/src/a.ts',
    });
    const bash = summarizeToolCall('Bash', { command: 'curl https://example.com/x' });
    expect(bash.summary).toBe('curl https://example.com/x');
    expect(bash.target).toBe('https://example.com/x');
  });
});

describe('§5.22 훅 경로 기록', () => {
  it('도구 호출 하나가 원장 한 줄로 남는다 — 묻지 않은 호출은 결정이 비어 있다', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Bash', tool_input: { command: 'pnpm test' }, tool_use_id: 'tu-1' }));

    const entries = entriesOf(graph, projectName);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolName).toBe('Bash');
    expect(entries[0]?.summary).toBe('pnpm test');
    expect(entries[0]?.riskKinds).toEqual([]);
    // 묻지 않은 것과 허용한 것은 다른 상태 — 여기를 'allow' 로 채우면 거짓말이 된다.
    expect(entries[0]?.decision).toBeUndefined();
  });

  it('같은 호출의 Pre/Post 는 한 줄로 합쳐진다', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'tu-2' }));
    graph.processHookEvent(hook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build' },
      tool_use_id: 'tu-2',
    }));

    const entries = entriesOf(graph, projectName);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.riskKinds).toEqual(['delete']);
  });

  it('승인 창구가 먼저 적은 줄을 뒤따라온 훅 이벤트가 찾아간다(두 줄로 갈라지지 않는다)', () => {
    const { graph, projectName } = makeGraph();
    // 승인 창구에는 tool_use_id 가 오지 않는다 — 그래서 표식으로 잇는다.
    const id = graph.recordAuditCall({
      projectName,
      sessionId: 'sess-audit',
      agentId: 'agent-1',
      toolName: 'Bash',
      toolInput: { command: 'curl https://example.com/x' },
      awaitHookEvent: true,
    });
    expect(id).toBeTruthy();

    graph.processHookEvent(hook({
      tool_name: 'Bash',
      tool_input: { command: 'curl https://example.com/x' },
      tool_use_id: 'tu-3',
    }));

    const entries = entriesOf(graph, projectName);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(id);
    expect(entries[0]?.toolUseId).toBe('tu-3');
  });
});

describe('§5.22 결정과 경계 스위치', () => {
  it('결정은 그 줄에 적힌다(요청 원장·결정 원장을 따로 두지 않는다)', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' }, tool_use_id: 'tu-4' }));
    const id = entriesOf(graph, projectName)[0]!.id;

    graph.markAuditEscalated(projectName, id);
    expect(graph.recordAuditDecision(projectName, id, 'deny', 'user', '경로가 틀렸습니다')).toBe(true);

    const entry = entriesOf(graph, projectName)[0]!;
    expect(entry.escalated).toBe(true);
    expect(entry.decision).toBe('deny');
    expect(entry.decisionSource).toBe('user');
    expect(entry.decisionReason).toBe('경로가 틀렸습니다');
    expect(logOf(graph, projectName)?.counts.denied).toBe(1);
  });

  it('없는 줄에는 결정을 적지 않는다(떠도는 결정 원장 방지)', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.recordAuditDecision(projectName, 'audit-nope', 'allow', 'user')).toBe(false);
  });

  it('경계 기본은 꺼짐이고(사용자가 고른 모드를 우리가 무르지 않는다) 종류별 기본은 켬이다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.getAuditBoundary(projectName)).toEqual({
      escalateRisky: false,
      kinds: { delete: true, network: true, config: true },
    });
    // 기본이 꺼짐이면 위험이 잡혀도 실행 전에 붙잡지 않는다(기록은 별개로 계속된다).
    expect(shouldEscalateRisk(graph.getAuditBoundary(projectName), ['delete'])).toBe(false);

    // 부분 페이로드를 보내도 나머지 종류가 날아가지 않는다.
    const next = graph.setAuditBoundary(projectName, { kinds: { network: false } });
    expect(next.kinds).toEqual({ delete: true, network: false, config: true });
    expect(next.escalateRisky).toBe(false);

    const on = graph.setAuditBoundary(projectName, { escalateRisky: true });
    expect(on.escalateRisky).toBe(true);
    expect(on.kinds.delete).toBe(true);
    expect(shouldEscalateRisk(on, ['delete'])).toBe(true);
    expect(shouldEscalateRisk(on, ['network'])).toBe(false);
  });
});

describe('§5.22 보관 상한', () => {
  it('캡을 넘긴 줄은 잘리되 합계는 줄지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const over = 5;
    for (let i = 0; i < AUDIT_ENTRIES_MAX_PER_PROJECT + over; i += 1) {
      graph.recordAuditCall({
        projectName,
        sessionId: 'sess-audit',
        toolName: 'Bash',
        toolInput: { command: `rm -rf tmp-${i}` },
        toolUseId: `tu-cap-${i}`,
      });
    }

    // 원장(디스크 포맷)은 캡까지 들고 있고,
    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.auditLog?.entries).toHaveLength(AUDIT_ENTRIES_MAX_PER_PROJECT);

    // 전선에는 최근 몫만 실린다(§9) — 그래도 숫자는 자르기 전 전체에서 접는다.
    const log = logOf(graph, projectName)!;
    expect(log.entries).toHaveLength(AUDIT_SNAPSHOT_ENTRIES);
    // 사라지는 것은 "어느 호출이었나"라는 내역뿐 — 숫자는 그대로다.
    expect(log.counts.total).toBe(AUDIT_ENTRIES_MAX_PER_PROJECT + over);
    expect(log.counts.risky).toBe(AUDIT_ENTRIES_MAX_PER_PROJECT + over);
    expect(log.retired?.entries).toBe(over);
  });
});

describe('§5.22 영속 왕복', () => {
  it('결정 이력이 디스크 포맷을 왕복해도 남는다', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' }, tool_use_id: 'tu-5' }));
    const id = entriesOf(graph, projectName)[0]!.id;
    graph.recordAuditDecision(projectName, id, 'deny', 'user', '지우면 안 됩니다');
    graph.setAuditBoundary(projectName, { kinds: { config: false } });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.auditLog?.entries).toHaveLength(1);

    const fresh = new ProjectGraph();
    fresh.registerProject(PROJECT_CWD);
    fresh.restoreFromCheckpoint(cp);

    const restored = entriesOf(fresh, projectName)[0]!;
    expect(restored.decision).toBe('deny');
    expect(restored.decisionReason).toBe('지우면 안 됩니다');
    expect(restored.riskKinds).toEqual(['delete']);
    // 경계 스위치도 사람이 정한 상태라 함께 살아난다.
    expect(fresh.getAuditBoundary(projectName).kinds.config).toBe(false);
  });

  it('아무 일도 없던 프로젝트는 빈 원장을 체크포인트에 싣지 않는다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.toProjectCheckpoint(projectName).auditLog).toBeUndefined();
  });

  it('기록이 없어도 사람이 켠 경계는 체크포인트에 실린다(기본이 뒤집혀도)', () => {
    const { graph, projectName } = makeGraph();
    graph.setAuditBoundary(projectName, { escalateRisky: true });
    // 종전 기본(켬)을 "저장할 것 없음" 판정에 직접 적어 두면 이 줄이 사라진다 — 그러면
    // 사용자가 켜 둔 경계가 앱을 껐다 켜는 순간 꺼진 채로 돌아온다.
    expect(graph.toProjectCheckpoint(projectName).auditLog?.boundary.escalateRisky).toBe(true);
  });

  it('병합은 id 기준 합집합이고 지금 원장을 덮지 않는다', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Bash', tool_input: { command: 'pnpm build' }, tool_use_id: 'tu-6' }));
    const mine = entriesOf(graph, projectName)[0]!;

    graph.mergeFromCheckpoint({
      ...graph.toProjectCheckpoint(projectName),
      auditLog: {
        projectName,
        entries: [
          { ...mine, summary: '덮어쓰면 안 되는 값' },
          {
            id: 'audit-from-disk',
            at: mine.at - 1000,
            projectName,
            sessionId: 'sess-old',
            toolName: 'Write',
            summary: '/repo/.claude/settings.json',
            riskKinds: ['config'],
          },
        ],
        boundary: { escalateRisky: true, kinds: {} },
        counts: { total: 2, risky: 1, denied: 0, escalated: 0, todayRisky: 0 },
        updatedAt: mine.at,
      },
    });

    const entries = entriesOf(graph, projectName);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.id === mine.id)?.summary).toBe('pnpm build');
    expect(entries.find((e) => e.id === 'audit-from-disk')).toBeTruthy();
  });

  it('스냅샷 병합에서 빠지면 프로젝트를 둘 이상 연 사람에게만 사라진다', () => {
    const a = new ProjectGraph();
    const aName = a.registerProject('/tmp/audit-a').name;
    a.processHookEvent(hook({ session_id: 'sess-a', cwd: '/tmp/audit-a', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'tu-a' }));

    const b = new ProjectGraph();
    const bName = b.registerProject('/tmp/audit-b').name;
    b.processHookEvent(hook({ session_id: 'sess-b', cwd: '/tmp/audit-b', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'tu-b' }));

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(merged.auditLogs?.map((l) => l.projectName).sort()).toEqual([aName, bName].sort());
  });
});
