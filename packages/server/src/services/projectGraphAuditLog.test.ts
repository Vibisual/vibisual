import { describe, expect, it, vi } from 'vitest';
import type { HookEventPayload } from '@vibisual/shared';
import {
  AUDIT_ENTRIES_MAX_PER_PROJECT,
  AUDIT_SNAPSHOT_ENTRIES,
  DEFAULT_RETENTION_SETTINGS,
  classifyToolRisk,
  isAuditPathOutside,
  shouldEscalateRisk,
  summarizeToolCall,
} from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';
import { AuditLogService } from './auditLog.js';

/**
 * §3.2.3 — 보관 상한은 사용자 설정에서 온다. 그 값을 이 회귀가 **그 기계의 실제 `app-state.json`**
 * 에서 읽으면, 사용자가 설정에서 숫자를 바꾼 순간 테스트가 저절로 빨개진다.
 * 여기서는 shared 기본값으로 고정하고, 축 자체의 동작은 아래 전용 describe 가 주입으로 확인한다.
 */
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateGetRetention: () => ({ ...DEFAULT_RETENTION_SETTINGS }) };
});

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

describe('§5.22 `outside` — 고른 폴더 밖인가', () => {
  const ROOT = '/tmp/audit-project';
  const opts = (extra: Record<string, unknown> = {}) => ({ roots: [ROOT], platform: 'linux' as const, ...extra });

  it('경계를 모르면(roots 가 비면) 판정 자체를 열지 않는다 — 없는 근거로 위험을 지어내지 않는다', () => {
    expect(classifyToolRisk('Read', { file_path: '/etc/passwd' })).toEqual([]);
    expect(classifyToolRisk('Read', { file_path: '/etc/passwd' }, { roots: [], platform: 'linux' })).toEqual([]);
  });

  it('밖은 **읽기도** 본다 — `config` 가 쓰기만 보는 것과 다르다', () => {
    expect(classifyToolRisk('Read', { file_path: '/etc/passwd' }, opts())).toEqual(['outside']);
    expect(classifyToolRisk('Grep', { pattern: 'x', path: '/var/log' }, opts())).toEqual(['outside']);
    expect(classifyToolRisk('Write', { file_path: '/etc/hosts' }, opts())).toEqual(['config', 'outside']);
  });

  it('폴더 안은 절대경로든 상대경로든 밖이 아니다(워크트리 포함)', () => {
    expect(classifyToolRisk('Read', { file_path: `${ROOT}/src/a.ts` }, opts())).toEqual([]);
    expect(classifyToolRisk('Read', { file_path: 'src/a.ts' }, opts())).toEqual([]);
    expect(classifyToolRisk('Read', { file_path: `${ROOT}/.claude/worktrees/wt-1/src/a.ts` }, opts())).toEqual([]);
  });

  it('명령 안의 밖 경로도 잡는다 — `..` 로 빠져나가는 상대경로까지', () => {
    expect(classifyToolRisk('Bash', { command: 'cat /etc/shadow' }, opts())).toEqual(['outside']);
    expect(classifyToolRisk('Bash', { command: 'cd ../../other && pnpm build' }, opts())).toEqual(['outside']);
    expect(classifyToolRisk('Bash', { command: 'pnpm test' }, opts())).toEqual([]);
    expect(classifyToolRisk('Bash', { command: 'node scripts/runapp.mjs' }, opts())).toEqual([]);
  });

  it('URL 은 경로로 오독되지 않는다 — 안 그러면 모든 curl 이 "폴더 밖"이 된다', () => {
    // 작업 신고 카드가 쓰는 바로 그 모양(§5.22 루프백 예외와 같은 자리).
    expect(classifyToolRisk('Bash', {
      command: 'curl -s -X POST "http://127.0.0.1:51360/api/agent-report" -d @-',
    }, opts())).toEqual([]);
    expect(classifyToolRisk('WebFetch', { url: 'https://example.com/a/b' }, opts())).toEqual(['network']);
  });

  it('장치·의사 경로는 밖으로 세지 않는다 — `> /dev/null` 이 매번 걸리면 배지가 뜻을 잃는다', () => {
    expect(classifyToolRisk('Bash', { command: 'pnpm build > /dev/null 2>&1' }, opts())).toEqual([]);
  });

  it('여러 경계 중 **하나에라도** 들면 안이다(루트 밖에 선 워크트리·별도 cwd 세션이 통째로 빨개지지 않게)', () => {
    const roots = [ROOT, '/var/worktrees/wt-9'];
    expect(classifyToolRisk('Read', { file_path: '/var/worktrees/wt-9/src/a.ts' }, { roots, platform: 'linux' }))
      .toEqual([]);
    expect(classifyToolRisk('Read', { file_path: '/var/worktrees/other/a.ts' }, { roots, platform: 'linux' }))
      .toEqual(['outside']);
  });

  it('위험이 겹치면 `AUDIT_RISK_KINDS` 순서 그대로 실린다', () => {
    const kinds = classifyToolRisk('Bash', { command: 'rm -rf /var/tmp/x && curl https://example.com/ping' }, opts());
    expect(kinds).toEqual(['delete', 'network', 'outside']);
  });
});

describe('§5.22 `outside` — 세 OS 를 개발기 한 대에서 확인한다', () => {
  // 아래 경로는 전부 가상의 예시다(실재하는 사용자 홈이 아니다). 줄 끝 `privacy-ok` 는
  // privacy-scan 오탐 표시 — 이 시험은 홈 밑 경로 모양 자체를 판정 대상으로 삼는다.
  const WIN_ROOT = 'C:/Users/dev/proj';  // privacy-ok
  const NIX_ROOT = '/home/dev/proj';  // privacy-ok

  it('linux 는 케이스를 접지 않는다 — `Feature-X` 와 `feature-x` 는 실재하는 다른 폴더다', () => {
    expect(isAuditPathOutside('/home/dev/PROJ/a.ts', [NIX_ROOT], 'linux')).toBe(true);  // privacy-ok
    expect(isAuditPathOutside('/home/dev/proj/a.ts', [NIX_ROOT], 'linux')).toBe(false);  // privacy-ok
  });

  it('win32·darwin 은 접는다 — 케이스만 다른 같은 폴더를 밖으로 보면 배지가 거짓말을 한다', () => {
    expect(isAuditPathOutside('c:/users/dev/proj/a.ts', [WIN_ROOT], 'win32')).toBe(false);
    expect(isAuditPathOutside('/Home/Dev/Proj/a.ts', [NIX_ROOT], 'darwin')).toBe(false);
  });

  it('win32 는 backslash·msys 경로(`/c/Users/…`)를 같은 경로로 읽는다 — Git Bash 로 도는 Bash 도구가 그 모양을 쓴다', () => {
    expect(isAuditPathOutside('C:\\Users\\dev\\proj\\src\\a.ts', [WIN_ROOT], 'win32')).toBe(false);  // privacy-ok
    expect(isAuditPathOutside('/c/Users/dev/proj/src/a.ts', [WIN_ROOT], 'win32')).toBe(false);  // privacy-ok
    expect(isAuditPathOutside('/c/Users/dev/other/a.ts', [WIN_ROOT], 'win32')).toBe(true);  // privacy-ok
    // linux 에서 `/c/…` 는 진짜 루트 밑 폴더라 드라이브로 되돌리지 않는다.
    expect(isAuditPathOutside('/c/Users/dev/proj/src/a.ts', [WIN_ROOT], 'linux')).toBe(true);  // privacy-ok
  });

  it('`~` 는 홈으로 펴고, 홈을 모르면 밖으로 둔다(모르는 값을 지어내지 않는다)', () => {
    expect(isAuditPathOutside('~/.claude/settings.json', [NIX_ROOT], 'linux', '/home/dev')).toBe(true);
    expect(isAuditPathOutside('~/proj/src/a.ts', [NIX_ROOT], 'linux', '/home/dev')).toBe(false);
    expect(isAuditPathOutside('~/proj/src/a.ts', [NIX_ROOT], 'linux')).toBe(true);
  });

  it('루트 위로는 올라가지 않는다 — `../../..` 이 루트를 넘어도 판정이 무너지지 않는다', () => {
    expect(isAuditPathOutside('../../../../etc/passwd', [NIX_ROOT], 'linux')).toBe(true);
    expect(isAuditPathOutside('./src/../src/a.ts', [NIX_ROOT], 'linux')).toBe(false);
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

describe('§3.2.3 보관 상한 — 원장 줄 수를 사용자가 정한다', () => {
  const PROJECT = 'retention-project';

  /**
   * ⚠ `toolUseId` 는 **회차마다 달라야 한다.** 같은 id 로 다시 부르면 새 줄이 아니라 그 줄의
   * 갱신이라(Pre/Post 합치기) 길이가 늘지 않고, 그러면 상한을 재는 시험이 아무것도 재지 않는다.
   */
  function fill(svc: AuditLogService, n: number, tag = 'a'): void {
    for (let i = 0; i < n; i += 1) {
      svc.record({
        projectName: PROJECT,
        sessionId: 'sess-retention',
        toolName: 'Bash',
        toolInput: { command: `echo ${tag}-${i}` },
        toolUseId: `tu-r-${tag}-${i}`,
      });
    }
  }

  /**
   * ⚠ `getSnapshot()` 은 **전선 몫**(`AUDIT_SNAPSHOT_ENTRIES`)까지만 싣는다 — 보관 상한을 재는
   * 자리에서 그걸 쓰면 120 줄에서 멈춰 "상한이 걸렸다"로 오독한다. 디스크 포맷이 전량이다.
   */
  function logOfSvc(svc: AuditLogService) {
    const log = svc.toCheckpoint(PROJECT);
    if (!log) throw new Error('원장 없음');
    return log;
  }

  it('주입한 상한을 넘긴 줄은 잘리고 그 몫은 retired 로 접힌다 — 집계 숫자는 줄지 않는다', () => {
    const svc = new AuditLogService(() => 3);
    fill(svc, 10);
    const log = logOfSvc(svc);
    expect(log.entries).toHaveLength(3);
    // 잘린 7건도 합계에는 그대로 남는다(감사의 값은 막은 것이 아니라 다 남은 것이다).
    expect(log.counts.total).toBe(10);
  });

  it('`0` 이면 이 축은 정리하지 않는다 — §3.2.3 무제한 규약', () => {
    const svc = new AuditLogService(() => 0);
    fill(svc, 40);
    expect(logOfSvc(svc).entries).toHaveLength(40);
  });

  it('해석기는 매번 다시 읽힌다 — 설정을 내리면 다음 기록부터 곧바로 그 값이 선다', () => {
    let max = 20;
    const svc = new AuditLogService(() => max);
    fill(svc, 20);
    expect(logOfSvc(svc).entries).toHaveLength(20);
    max = 5;
    fill(svc, 1, 'b');
    expect(logOfSvc(svc).entries).toHaveLength(5);
  });

  it('`applyRetention()` 은 다음 호출을 기다리지 않는다 — 조용한 프로젝트도 그 자리에서 줄어든다', () => {
    let max = 30;
    const svc = new AuditLogService(() => max);
    fill(svc, 30);
    max = 8;
    expect(svc.applyRetention()).toBe(true);
    const log = logOfSvc(svc);
    expect(log.entries).toHaveLength(8);
    expect(log.counts.total).toBe(30);
    // 더 자를 것이 없으면 false — 호출부가 헛브로드캐스트·헛저장을 하지 않게.
    expect(svc.applyRetention()).toBe(false);
  });

  it('기본 해석기는 상수를 돌려준다 — 주입 없이도 종전대로 동작한다', () => {
    const svc = new AuditLogService();
    fill(svc, AUDIT_ENTRIES_MAX_PER_PROJECT + 5);
    expect(logOfSvc(svc).entries).toHaveLength(AUDIT_ENTRIES_MAX_PER_PROJECT);
  });

  it('상한 기본값은 전선 몫보다 커야 화면에 no-op 이다(§3.2.3 판단 기준)', () => {
    expect(AUDIT_ENTRIES_MAX_PER_PROJECT).toBeGreaterThan(AUDIT_SNAPSHOT_ENTRIES);
    expect(DEFAULT_RETENTION_SETTINGS.auditEntryMaxPerProject).toBe(AUDIT_ENTRIES_MAX_PER_PROJECT);
  });
});

describe('§5.22 `outside` 서버 배선 — 경계를 실어 보내는 자리', () => {
  it('훅 경로가 프로젝트 루트를 실어 보내 폴더 밖 읽기가 원장에서 outside 로 남는다', () => {
    const { graph, projectName } = makeGraph();
    graph.processHookEvent(hook({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' }, tool_use_id: 'tu-out' }));
    graph.processHookEvent(hook({ tool_name: 'Read', tool_input: { file_path: `${PROJECT_CWD}/src/a.ts` }, tool_use_id: 'tu-in' }));

    const entries = entriesOf(graph, projectName);
    expect(entries.find((e) => e.toolUseId === 'tu-out')?.riskKinds).toEqual(['outside']);
    expect(entries.find((e) => e.toolUseId === 'tu-in')?.riskKinds).toEqual([]);
  });

  it('경계는 프로젝트 루트와 세션 cwd 둘 다 — 승인 창구와 훅 경로가 같은 이 함수를 쓴다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.getAuditRoots(projectName)).toEqual([PROJECT_CWD]);
    expect(graph.getAuditRoots(projectName, '/var/worktrees/wt-9')).toEqual([PROJECT_CWD, '/var/worktrees/wt-9']);
    // 같은 경로를 두 번 싣지 않는다(플랫폼 규칙으로 비교).
    expect(graph.getAuditRoots(projectName, PROJECT_CWD)).toEqual([PROJECT_CWD]);
    // 프로젝트를 못 찾으면 빈 배열 — 그때는 outside 판정 자체가 열리지 않는다.
    expect(graph.getAuditRoots('no-such-project')).toEqual([]);
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
      kinds: { delete: true, network: true, config: true, outside: true },
    });
    // 기본이 꺼짐이면 위험이 잡혀도 실행 전에 붙잡지 않는다(기록은 별개로 계속된다).
    expect(shouldEscalateRisk(graph.getAuditBoundary(projectName), ['delete'])).toBe(false);

    // 부분 페이로드를 보내도 나머지 종류가 날아가지 않는다.
    const next = graph.setAuditBoundary(projectName, { kinds: { network: false } });
    expect(next.kinds).toEqual({ delete: true, network: false, config: true, outside: true });
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
