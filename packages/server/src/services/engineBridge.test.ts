/**
 * §4 엔진 다리 — Claude Code 모드가 우리 세션 안에서 올리는 사실을 서버가 받는 방식. 못 박는 것:
 *  1) 판올림 — 2.1.287 아래·모르는 값에는 싣지 않는다(개발판 꼬리 무시). 2) 전선 모양 — 신뢰할 수 없는 입력이라 어긋나면 버리고 글자·수는 범위로 접는다.
 *  3) 보증 — 신선한 다리가 "턴이 돈다 + 최근 진척"일 때만 생존 판정을 건너뛴다(끊긴·끝난 다리, 진척이 오래 없는 턴은 아님). 진척은 다리 턴 가장자리와 대화록 마지막 쓰기 중 늦은 쪽.
 *  4) 프로세스 교대 — 옛 프로세스의 늦은 신고가 새 상태를 덮지 않는다. 5) CMD 분할 — 한 탭의 여러 칸 중 하나라도 돌면 돈다. 6) 동봉 파일 — 평평한 패키지를 제 모양으로 세우고, 같은 판은 다시 쓰지 않고, 옛 판은 걷는다.
 *  7) 모드 본체 — 정적 ES 모듈 · 문자열 그대로의 env 이름 · 빌드 복사 목록. 막을 수 있는 자리(`tool.call` 등)엔 훅을 걸지 않는다(관찰 전용).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  ENGINE_BRIDGE_EVENTS_MAX,
  ENGINE_BRIDGE_ENDED_KEEP_MS,
  ENGINE_BRIDGE_PLUGIN_NAME,
  ENGINE_BRIDGE_STALE_MS,
  ENGINE_BRIDGE_VOUCH_PROGRESS_MS,
  describeEngineBridgeForProbe,
  engineBridgeKeyOf,
  engineBridgeVouchesRunning,
  isEngineBridgeCliSupported,
  parseEngineBridgeReport,
  rateLimitsFromEngine,
  type EngineBridgeReport,
  type EngineBridgeState,
  type UserDefaults,
} from '@vibisual/shared';

// 서비스가 기대는 바깥 셋을 막는다 — 실행본을 띄우거나(판올림 재기) 사용자 설정·홈을 건드리지 않게.
//   `vi.mock` 은 파일 맨 위로 끌어올려지므로 공유 상태도 `vi.hoisted` 로 함께 끌어올린다.
const { defaultsRef, probeCalls } = vi.hoisted(() => ({
  defaultsRef: { current: {} as UserDefaults },
  probeCalls: [] as string[],
}));
vi.mock('./claudeBin.js', () => ({
  getClaudeBin: () => ({ binPath: '/fake/bin/claude', source: 'path' }),
}));
vi.mock('./claudeVersionService.js', () => ({
  probeClaudeBinVersion: async (binPath: string) => {
    probeCalls.push(binPath);
    return { version: null, error: 'not probed in tests' };
  },
}));
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => defaultsRef.current },
}));

import { EngineBridgeService, materializeEngineBridgeMod } from './engineBridge.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MOD_SOURCE = path.join(REPO_ROOT, 'hooks', 'mods', ENGINE_BRIDGE_PLUGIN_NAME);

let tmpRoot: string;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-engine-bridge-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 임시 폴더 정리 실패는 결과와 무관 */
  }
});
beforeEach(() => {
  defaultsRef.current = { updatedAt: 0 };
  probeCalls.length = 0;
});

/** 시험용 신고 한 벌 — 필요한 칸만 덮어쓴다. */
function report(over: Omit<Partial<EngineBridgeReport>, 'identity'> & { identity?: Partial<EngineBridgeReport['identity']> } = {}): EngineBridgeReport {
  return {
    v: 1,
    instance: over.instance ?? 'inst-a',
    identity: {
      subAgentId: 'sub-1',
      agentId: 'agent-1',
      termId: '',
      sessionId: 'session-1',
      cliVersion: '2.1.291',
      interactive: false,
      surface: null,
      ...(over.identity ?? {}),
    },
    events: over.events ?? [],
    ...(over.snapshot ? { snapshot: over.snapshot } : {}),
    ...(over.usage ? { usage: over.usage } : {}),
  };
}

function stateOf(over: Partial<EngineBridgeState> = {}): EngineBridgeState {
  return {
    key: 'sub:sub-1',
    instance: 'inst-a',
    subAgentId: 'sub-1',
    agentId: 'agent-1',
    termId: '',
    sessionId: 'session-1',
    cliVersion: '2.1.291',
    interactive: false,
    attachedAt: 0,
    lastSeenAt: 0,
    turnState: 'unknown',
    toolsInFlight: 0,
    ...over,
  };
}

describe('판올림 — 모드를 실을 수 있는가', () => {
  it('2.1.287 부터 싣는다', () => {
    expect(isEngineBridgeCliSupported('2.1.286')).toBe(false);
    expect(isEngineBridgeCliSupported('2.1.287')).toBe(true);
    expect(isEngineBridgeCliSupported('2.1.291')).toBe(true);
    expect(isEngineBridgeCliSupported('2.2.0')).toBe(true);
    expect(isEngineBridgeCliSupported('3.0.0')).toBe(true);
    expect(isEngineBridgeCliSupported('1.9.999')).toBe(false);
  });

  it('개발판 꼬리는 무시하고 숫자 마디만 본다', () => {
    expect(isEngineBridgeCliSupported('2.1.287-dev.20261001.t101500.sha1a2b3c4')).toBe(true);
    expect(isEngineBridgeCliSupported('v2.1.290')).toBe(true);
  });

  it('모르는 값·못 읽는 값은 싣지 않는다', () => {
    expect(isEngineBridgeCliSupported(null)).toBe(false);
    expect(isEngineBridgeCliSupported(undefined)).toBe(false);
    expect(isEngineBridgeCliSupported('')).toBe(false);
    expect(isEngineBridgeCliSupported('unknown')).toBe(false);
  });
});

describe('전선 모양 — parseEngineBridgeReport', () => {
  const ok = {
    v: 1,
    instance: 'abc-123',
    identity: { subAgentId: 'sub-1', agentId: 'agent-1', termId: '', sessionId: 's', cliVersion: '2.1.291', interactive: true, surface: 'terminal' },
    events: [{ kind: 'attach', ageMs: 5 }, { kind: 'turn-start', ageMs: 3, turnId: 't1' }],
    snapshot: { turnState: 'running', turnAgeMs: 3, progressAgeMs: 1, toolsInFlight: 1, toolInFlight: { name: 'Bash', ageMs: 1 } },
  };

  it('바른 신고는 그대로 접힌다', () => {
    const r = parseEngineBridgeReport(ok);
    expect(r).not.toBeNull();
    expect(r?.identity.subAgentId).toBe('sub-1');
    expect(r?.identity.interactive).toBe(true);
    expect(r?.events.map((e) => e.kind)).toEqual(['attach', 'turn-start']);
    expect(r?.snapshot?.toolInFlight?.name).toBe('Bash');
  });

  it('모양이 어긋나면 버린다', () => {
    expect(parseEngineBridgeReport(null)).toBeNull();
    expect(parseEngineBridgeReport('x')).toBeNull();
    expect(parseEngineBridgeReport({ ...ok, v: 2 })).toBeNull();
    expect(parseEngineBridgeReport({ ...ok, instance: 'has space' })).toBeNull();
    expect(parseEngineBridgeReport({ ...ok, identity: undefined })).toBeNull();
    expect(parseEngineBridgeReport({ ...ok, identity: { ...ok.identity, subAgentId: '' } })).toBeNull();
  });

  it('모르는 사건은 버리고, 음수·이상한 수는 접는다', () => {
    const r = parseEngineBridgeReport({
      ...ok,
      events: [{ kind: 'explode', ageMs: 1 }, { kind: 'turn-end', ageMs: -5, reason: 'answer', durationMs: 'x' }],
      snapshot: { turnState: 'dancing', toolsInFlight: -1 },
    });
    expect(r?.events).toEqual([{ kind: 'turn-end', ageMs: 0, reason: 'answer' }]);
    expect(r?.snapshot?.turnState).toBe('unknown');
    expect(r?.snapshot?.toolsInFlight).toBe(0);
  });

  it('사건 수는 상한까지 — 가장 최근 것을 남긴다', () => {
    const many = Array.from({ length: ENGINE_BRIDGE_EVENTS_MAX + 5 }, (_, i) => ({ kind: 'turn-start', ageMs: i, turnId: `t${i}` }));
    const r = parseEngineBridgeReport({ ...ok, events: many });
    expect(r?.events).toHaveLength(ENGINE_BRIDGE_EVENTS_MAX);
    expect(r?.events.at(-1)?.turnId).toBe(`t${ENGINE_BRIDGE_EVENTS_MAX + 4}`);
  });

  it('사용량 — 칸 없는 한도는 버리고 문맥 %는 0~100 으로 접는다', () => {
    const r = parseEngineBridgeReport({
      ...ok,
      usage: { contextPercent: 140, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }, { percentUsed: 3 }, { kind: 'seven_day' }] },
    });
    expect(r?.usage?.contextPercent).toBe(100);
    expect(r?.usage?.rateLimits).toEqual([{ kind: 'five_hour', percentUsed: 42 }]);
  });

  it('열쇠 — CMD 는 터미널 칸, 헤드리스는 세션 탭', () => {
    expect(engineBridgeKeyOf({ termId: 'term:a:sub-1#1', subAgentId: 'sub-1' })).toBe('term:term:a:sub-1#1');
    expect(engineBridgeKeyOf({ termId: '', subAgentId: 'sub-1' })).toBe('sub:sub-1');
  });
});

describe('한도 — rateLimitsFromEngine', () => {
  it('5시간·7일 창을 퍼센트 그대로, 리셋은 epoch ms 로', () => {
    const out = rateLimitsFromEngine([
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-10T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 7 },
    ]);
    expect(out).toEqual({ used5h: 23.5, resetAt5h: Date.parse('2026-10-10T12:00:00Z'), used7d: 7 });
  });

  it('칸이 없는 창(지출 한도)은 옮기지 않고, 옮길 것이 없으면 null', () => {
    expect(rateLimitsFromEngine([{ kind: 'spend_limit', percentUsed: 120 }])).toBeNull();
    expect(rateLimitsFromEngine([])).toBeNull();
    expect(rateLimitsFromEngine(undefined)).toBeNull();
  });

  it('100 을 넘는 값은 100 으로 접는다', () => {
    expect(rateLimitsFromEngine([{ kind: 'five_hour', percentUsed: 130 }])).toEqual({ used5h: 100 });
  });
});

describe('보증 — 생존 판정을 건너뛰어도 되는가', () => {
  const now = 10 * 60 * 60_000;

  it('신선한 다리가 "턴이 돈다 + 최근 진척"을 말하면 보증한다', () => {
    const st = stateOf({ lastSeenAt: now - 1000, turnState: 'running', turnStartedAt: now - 60_000, lastProgressAt: now - 30_000 });
    expect(engineBridgeVouchesRunning(st, now)).toBe(true);
  });

  it('소식이 끊긴 다리는 보증하지 않는다', () => {
    const st = stateOf({ lastSeenAt: now - ENGINE_BRIDGE_STALE_MS - 1, turnState: 'running', lastProgressAt: now - 1000 });
    expect(engineBridgeVouchesRunning(st, now)).toBe(false);
  });

  it('끝난 다리·쉬는 턴은 보증하지 않는다', () => {
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'running', ended: { reason: 'other', at: now } }), now)).toBe(false);
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'idle' }), now)).toBe(false);
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'unknown' }), now)).toBe(false);
  });

  it('진척이 오래 없는 턴은 보증하지 않는다 — 멈춘 턴은 판정이 찾는다', () => {
    const st = stateOf({ lastSeenAt: now, turnState: 'running', lastProgressAt: now - ENGINE_BRIDGE_VOUCH_PROGRESS_MS - 1 });
    expect(engineBridgeVouchesRunning(st, now)).toBe(false);
  });

  // 다리는 턴 가장자리만 진척으로 센다 — 30분 넘은 턴이 3분 조용한 도구 하나에 판정을 부르지 않도록, 도는 턴 안의 진척은 대화록 마지막 쓰기로 본다.
  it('다리의 진척이 오래됐어도 대화록이 최근에 쓰였으면 보증한다', () => {
    const st = stateOf({ lastSeenAt: now, turnState: 'running', turnStartedAt: now - 2 * 60 * 60_000, lastProgressAt: now - 2 * 60 * 60_000 });
    expect(engineBridgeVouchesRunning(st, now)).toBe(false);
    expect(engineBridgeVouchesRunning(st, now, now - 5 * 60_000)).toBe(true);
    expect(engineBridgeVouchesRunning(st, now, now - ENGINE_BRIDGE_VOUCH_PROGRESS_MS - 1)).toBe(false);
    // 더 오래된 관측은 다리의 진척을 끌어내리지 않는다.
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'running', lastProgressAt: now - 60_000 }), now, now - 3 * 60 * 60_000)).toBe(true);
  });

  it('대화록이 쓰여도 턴이 도는지는 다리만 말한다', () => {
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'idle' }), now, now)).toBe(false);
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now, turnState: 'unknown' }), now, now)).toBe(false);
    expect(engineBridgeVouchesRunning(stateOf({ lastSeenAt: now - ENGINE_BRIDGE_STALE_MS - 1, turnState: 'running' }), now, now)).toBe(false);
  });

  it('판정 증거 한 줄은 엔진이 말한 그대로를 싣는다', () => {
    const running = describeEngineBridgeForProbe(
      stateOf({ lastSeenAt: now, turnState: 'running', turnStartedAt: now - 20 * 60_000, lastProgressAt: now - 18 * 60_000, toolInFlight: { name: 'Bash', since: now - 18 * 60_000 } }),
      now,
    );
    expect(running).toContain('a turn IS running');
    expect(running).toContain('"Bash"');
    expect(running).toContain('18 min');
    const idle = describeEngineBridgeForProbe(stateOf({ lastSeenAt: now, turnState: 'idle', lastTurnEnd: { reason: 'aborted', at: now - 120_000 } }), now);
    expect(idle).toContain('NO turn is running');
    expect(idle).toContain('aborted');
    expect(describeEngineBridgeForProbe(stateOf({ lastSeenAt: now - ENGINE_BRIDGE_STALE_MS - 60_000 }), now)).toContain('stopped reporting');
    expect(describeEngineBridgeForProbe(stateOf({ lastSeenAt: now, ended: { reason: 'prompt_input_exit', at: now - 60_000 } }), now)).toContain('ended');
  });
});

describe('서버 상태 — EngineBridgeService.ingest', () => {
  const t0 = 1_000_000;

  it('붙음 → 턴 시작 → 턴 끝: 가장자리와 수준이 함께 맞는다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    const a = svc.ingest(report({ events: [{ kind: 'attach', ageMs: 0 }] }), t0);
    expect(a.accepted).toBe(true);
    expect(svc.isTurnRunning('sub-1', t0)).toBe(false);

    const b = svc.ingest(report({ events: [{ kind: 'turn-start', ageMs: 10, turnId: 't1' }], snapshot: { turnState: 'running', toolsInFlight: 0, turnAgeMs: 10, progressAgeMs: 10 } }), t0 + 1000);
    expect(b.edges).toEqual(['turn-start']);
    expect(svc.isTurnRunning('sub-1', t0 + 1000)).toBe(true);
    expect(svc.vouchesRunning('sub-1', t0 + 1000)).toBe(true);

    const c = svc.ingest(report({ events: [{ kind: 'turn-end', ageMs: 0, reason: 'aborted', durationMs: 900 }], snapshot: { turnState: 'idle', toolsInFlight: 0 } }), t0 + 2000);
    expect(c.edges).toEqual(['turn-end']);
    expect(svc.isTurnRunning('sub-1', t0 + 2000)).toBe(false);
    expect(svc.list(t0 + 2000)[0]?.lastTurnEnd?.reason).toBe('aborted');
  });

  it('같은 칸의 옛 프로세스가 보낸 늦은 신고는 버린다 — 새 프로세스는 붙음으로 이어받는다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    svc.ingest(report({ instance: 'old', events: [{ kind: 'attach', ageMs: 0 }], snapshot: { turnState: 'running', toolsInFlight: 0 } }), t0);
    svc.ingest(report({ instance: 'new', events: [{ kind: 'attach', ageMs: 0 }], snapshot: { turnState: 'idle', toolsInFlight: 0 } }), t0 + 10);
    const late = svc.ingest(report({ instance: 'old', snapshot: { turnState: 'running', toolsInFlight: 0 } }), t0 + 20);
    expect(late.accepted).toBe(false);
    expect(svc.isTurnRunning('sub-1', t0 + 20)).toBe(false);
    expect(svc.list(t0 + 20)).toHaveLength(1);
    expect(svc.list(t0 + 20)[0]?.instance).toBe('new');
  });

  it('CMD 분할 — 한 칸이라도 돌면 돈다, 다리가 붙은 탭의 status 는 엔진이 정한다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    const pane0 = { termId: 'term:agent-1:sub-1', interactive: true };
    const pane1 = { termId: 'term:agent-1:sub-1#1', interactive: true };
    svc.ingest(report({ instance: 'p0', identity: pane0, events: [{ kind: 'attach', ageMs: 0 }, { kind: 'turn-start', ageMs: 0 }] }), t0);
    svc.ingest(report({ instance: 'p1', identity: pane1, events: [{ kind: 'attach', ageMs: 0 }] }), t0);
    expect(svc.ownsCmdStatus('sub-1', t0)).toBe(true);
    expect(svc.isTurnRunning('sub-1', t0)).toBe(true);
    svc.ingest(report({ instance: 'p0', identity: pane0, events: [{ kind: 'turn-end', ageMs: 0, reason: 'answer' }] }), t0 + 5);
    expect(svc.isTurnRunning('sub-1', t0 + 5)).toBe(false);
  });

  it('소식이 끊기면 말하지 않는다 — 끊긴 다리는 탭 status 도 놓는다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    svc.ingest(report({ identity: { termId: 'term:agent-1:sub-1' }, events: [{ kind: 'attach', ageMs: 0 }, { kind: 'turn-start', ageMs: 0 }] }), t0);
    const later = t0 + ENGINE_BRIDGE_STALE_MS + 1;
    expect(svc.isTurnRunning('sub-1', later)).toBe(false);
    expect(svc.ownsCmdStatus('sub-1', later)).toBe(false);
  });

  it('끝난 다리는 스냅숏이 되살리지 못하고, 보관 시간이 지나면 걷힌다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    svc.ingest(report({ events: [{ kind: 'attach', ageMs: 0 }, { kind: 'end', ageMs: 0, reason: 'other' }], snapshot: { turnState: 'running', toolsInFlight: 0 } }), t0);
    expect(svc.isTurnRunning('sub-1', t0)).toBe(false);
    expect(svc.list(t0)).toHaveLength(1);
    expect(svc.list(t0 + ENGINE_BRIDGE_ENDED_KEEP_MS + 1)).toHaveLength(0);
  });

  it('/clear 는 끝이 아니다 — 같은 프로세스가 계속 신고한다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'unused'));
    svc.ingest(report({ events: [{ kind: 'attach', ageMs: 0 }, { kind: 'turn-start', ageMs: 0 }] }), t0);
    const r = svc.ingest(report({ identity: { sessionId: 'session-2' }, events: [{ kind: 'clear', ageMs: 0, reason: 'clear' }] }), t0 + 5);
    expect(r.edges).toEqual(['clear']);
    const st = svc.list(t0 + 5)[0];
    expect(st?.ended).toBeUndefined();
    expect(st?.sessionId).toBe('session-2');
    expect(svc.isTurnRunning('sub-1', t0 + 5)).toBe(false);
  });
});

describe('싣기 — 스위치·판올림·동봉 파일', () => {
  function flatSource(dir: string, registerBody = 'export const register = () => {};\n'): string {
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: ENGINE_BRIDGE_PLUGIN_NAME, version: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.js'] }));
    fs.writeFileSync(path.join(dir, 'hooks', 'register.js'), registerBody);
    return dir;
  }

  it('동봉 자리를 모르면 아무것도 싣지 않고 실행본도 띄우지 않는다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'mods-none'));
    expect(svc.pluginDirForSpawn()).toBeNull();
    expect(probeCalls).toHaveLength(0);
  });

  it('판올림을 모르면 그 스폰에는 싣지 않고 뒤에서 잰다 — 낮으면 싣지 않고, 맞으면 싣는다', () => {
    const modsRoot = path.join(tmpRoot, 'mods-gate');
    const svc = new EngineBridgeService(() => modsRoot);
    svc.setSourceDir(flatSource(path.join(tmpRoot, 'src-gate')));
    probeCalls.length = 0;
    svc.noteCliVersion('/fake/bin/claude', null);
    // 못 읽은 판올림은 싣지 않는다.
    expect(svc.pluginDirForSpawn()).toBeNull();
    svc.noteCliVersion('/fake/bin/claude', '2.1.286');
    expect(svc.pluginDirForSpawn()).toBeNull();
    svc.noteCliVersion('/fake/bin/claude', '2.1.291');
    const dir = svc.pluginDirForSpawn();
    expect(dir).not.toBeNull();
    expect(fs.existsSync(path.join(dir!, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(svc.status().active).toBe(true);
  });

  it('스위치를 끄면 싣지 않는다', () => {
    const svc = new EngineBridgeService(() => path.join(tmpRoot, 'mods-off'));
    svc.setSourceDir(flatSource(path.join(tmpRoot, 'src-off')));
    svc.noteCliVersion('/fake/bin/claude', '2.1.291');
    defaultsRef.current = { advanced: { engineBridge: false }, updatedAt: 0 };
    expect(svc.pluginDirForSpawn()).toBeNull();
    expect(svc.status().active).toBe(false);
  });

  it('평평한 패키지 모양을 제 모양으로 세우고, 같은 판이면 다시 쓰지 않는다', () => {
    const src = flatSource(path.join(tmpRoot, 'src-flat'));
    const modsRoot = path.join(tmpRoot, 'mods-flat');
    const dir = materializeEngineBridgeMod(src, modsRoot);
    expect(dir).not.toBeNull();
    expect(path.basename(dir!)).toBe(ENGINE_BRIDGE_PLUGIN_NAME);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir!, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe(ENGINE_BRIDGE_PLUGIN_NAME);
    expect(fs.readFileSync(path.join(dir!, 'hooks', 'register.js'), 'utf8')).toContain('export const register');
    // 엔진이 그 폴더에 타입 파일을 써 넣어도 같은 판이면 같은 폴더를 다시 준다.
    fs.mkdirSync(path.join(dir!, '.claude-plugin', 'types'), { recursive: true });
    fs.writeFileSync(path.join(dir!, '.claude-plugin', 'types', 'x.d.ts'), 'export {};');
    expect(materializeEngineBridgeMod(src, modsRoot)).toBe(dir);
  });

  it('내용이 바뀌면 새 폴더에 세우고 옛 판은 걷는다', () => {
    const src = flatSource(path.join(tmpRoot, 'src-next'));
    const modsRoot = path.join(tmpRoot, 'mods-next');
    const first = materializeEngineBridgeMod(src, modsRoot);
    fs.writeFileSync(path.join(src, 'hooks', 'register.js'), 'export const register = () => { /* v2 */ };\n');
    const second = materializeEngineBridgeMod(src, modsRoot);
    expect(second).not.toBe(first);
    expect(fs.existsSync(first!)).toBe(false);
    expect(fs.existsSync(second!)).toBe(true);
  });

  it('제 모양(.claude-plugin/plugin.json) 원본도 받고, 파일이 하나라도 없으면 null', () => {
    const canonical = path.join(tmpRoot, 'src-canonical');
    fs.mkdirSync(path.join(canonical, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(canonical, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(canonical, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: ENGINE_BRIDGE_PLUGIN_NAME }));
    fs.writeFileSync(path.join(canonical, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.js'] }));
    fs.writeFileSync(path.join(canonical, 'hooks', 'register.js'), 'export const register = () => {};\n');
    expect(materializeEngineBridgeMod(canonical, path.join(tmpRoot, 'mods-canonical'))).not.toBeNull();

    const broken = path.join(tmpRoot, 'src-broken');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, 'plugin.json'), '{}');
    expect(materializeEngineBridgeMod(broken, path.join(tmpRoot, 'mods-broken'))).toBeNull();
  });
});

describe('모드 본체 — 엔진이 읽을 수 있는 모양', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(MOD_SOURCE, rel), 'utf8');
  function runtimeModuleLoads(src: string): string[] {
    const tree = ts.createSourceFile('register.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const loads: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        loads.push(node.getText(tree));
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('node:')) {
        loads.push(node.getText(tree));
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return loads;
  }

  it('매니페스트 이름과 모듈 경로', () => {
    expect((JSON.parse(read(path.join('.claude-plugin', 'plugin.json'))) as { name: string }).name).toBe(ENGINE_BRIDGE_PLUGIN_NAME);
    expect((JSON.parse(read(path.join('hooks', 'hooks.json'))) as { modules: string[] }).modules).toEqual(['./register.js']);
  });

  it('정적 ES 모듈이다 — require·import()·Node 모듈을 쓰지 않는다', () => {
    const src = read(path.join('hooks', 'register.js'));
    expect(src).toMatch(/export const register\s*=/);
    expect(runtimeModuleLoads(src)).toEqual([]);
  });

  it('실행 모듈 로드는 잡고 주석·JSDoc의 타입 참조는 허용한다', () => {
    expect(runtimeModuleLoads("// require('x'), import('x')\n/** @type {import('claude-code').Register} */\nexport const register = () => {};")).toEqual([]);
    for (const src of ["require('x');", "import('x');", "import fs from 'node:fs';", "export * from 'node:fs';"]) {
      expect(runtimeModuleLoads(src)).toHaveLength(1);
    }
  });

  it('환경변수 이름은 문자열 그대로다(validate 가 읽는 이름을 나열한다)', () => {
    const src = read(path.join('hooks', 'register.js'));
    const args = [...src.matchAll(/\$\.env\.get\(([^)]*)\)/g)].map((m) => m[1]?.trim());
    expect(args.length).toBeGreaterThan(0);
    for (const a of args) expect(a).toMatch(/^'VIBISUAL_[A-Z_]+'$/);
  });

  it('신고 창구와 인증 헤더가 서버·데스크톱과 맞는다', () => {
    const src = read(path.join('hooks', 'register.js'));
    expect(src).toContain('/api/engine-bridge');
    expect(src).toContain('x-vibisual-hook-token');
    const desktop = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'desktop', 'src', 'main', 'index.ts'), 'utf8');
    expect(desktop).toContain("path === '/api/engine-bridge'");
  });

  it('빌드가 세 파일을 평평하게 복사한다', () => {
    const vite = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'desktop', 'electron.vite.config.ts'), 'utf8');
    expect(vite).toContain('hooks/mods/vibisual-bridge/.claude-plugin/plugin.json');
    expect(vite).toContain('out/mods/vibisual-bridge/plugin.json');
    expect(vite).toContain('hooks/mods/vibisual-bridge/hooks/hooks.json');
    expect(vite).toContain('hooks/mods/vibisual-bridge/hooks/register.js');
  });
});

type ModHook = ($: unknown, e: Record<string, unknown>, next: (e: unknown) => Promise<unknown>) => unknown;
type ModRegisterFn = (on: (name: string, fn: ModHook) => void) => void;

/** 모드 본체는 import 없는 정적 ES 모듈이다(위 시험) — `export` 만 떼어 함수로 읽는다. */
function loadModRegister(): ModRegisterFn {
  const src = fs.readFileSync(path.join(MOD_SOURCE, 'hooks', 'register.js'), 'utf8');
  return new Function(`${src.replace(/export const register\s*=/, 'const register =')}\nreturn register;`)() as ModRegisterFn;
}

// 2.1.299 부터 막을 수 있는 동작(도구 호출 등)에 걸린 플러그인 훅이 사건을 넘겨받지 못하거나 답을 돌려주지 못하면
// 엔진이 그 동작을 거부한다(공식 변경 기록). 감지기의 고장이 사용자의 도구 호출을 막는 자리가 되지 않도록 모드는
// 선언 파일이 "Observe" 로 적는 사건에만 훅을 건다. 새 훅을 더하려면 그 사건이 막을 수 없는지 확인하고 이 목록을 고친다.
describe('모드 본체 — 막을 수 있는 자리에는 훅을 걸지 않는다', () => {
  const OBSERVE_ONLY = ['session.start', 'turn.start', 'turn.complete', 'session.measure', 'session.end'];

  it('관찰 전용 사건에만 훅을 건다 — tool.call 은 없다', () => {
    const names: string[] = [];
    loadModRegister()((name) => { names.push(name); });
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(OBSERVE_ONLY).toContain(name);
    expect(names).not.toContain('tool.call');
  });
});

// 2.1.299 부터 `turn.start` 가 서브에이전트·팀원 턴도 알린다(`e.agentId` — 메인 루프는 없다). 모드를 가짜 엔진에
// 올려, 메인 턴이 끝난 뒤 배경 턴이 시작돼도 **신고 본문의 수준 상태가 쉬는 중으로 남는지** 본다. 거르지 않던
// 판에서는 배경 턴 하나가 `running` 을 올리고 그 끝(agentId 있음)은 내리지 않아 다음 메인 턴까지 굳었다.
describe('모드 본체 — 서브에이전트 턴은 이 세션의 턴이 아니다', () => {
  type Hook = ModHook;

  function bootMod() {
    const hooks = new Map<string, Hook>();
    loadModRegister()((name, fn) => { hooks.set(name, fn); });
    const ticks: Array<() => void> = [];
    const sent: Array<{ snapshot?: { turnState?: string } }> = [];
    const env: Record<string, string> = {
      VIBISUAL_BASE: 'http://127.0.0.1:51360',
      VIBISUAL_TOKEN: 'tok',
      VIBISUAL_SUBAGENT_ID: 'sub-1',
      VIBISUAL_OWNER_AGENT_ID: 'agent-1',
    };
    const $ = {
      env: { get: async (name: string) => env[name] ?? '' },
      session: { id: async () => 'sess-1', version: async () => ({ version: '2.1.300' }) },
      clock: {
        every: (_ms: number, fn: () => void) => { ticks.push(fn); return { cancel: () => {} }; },
        after: () => ({ cancel: () => {} }),
        sleep: async () => {},
      },
      http: {
        fetch: async (_url: string, init: { body: string }) => {
          sent.push(JSON.parse(init.body) as { snapshot?: { turnState?: string } });
          return { ok: true, status: 200, text: '{}' };
        },
      },
      ui: { log: () => {} },
    };
    const fire = async (name: string, e: Record<string, unknown>): Promise<void> => {
      const fn = hooks.get(name);
      if (!fn) throw new Error(`hook ${name} not registered`);
      await fn($, e, async (x) => x);
    };
    /** 보내기 한 번을 일으켜 그때 실린 수준 상태를 돌려준다(사용량이 바뀌면 사건이 없어도 보낸다). */
    const stateNow = async (): Promise<string | undefined> => {
      await fire('session.measure', { context: { percent: Math.random() }, rateLimits: [], changed: ['context'] });
      for (const t of ticks) t();
      await new Promise((r) => setTimeout(r, 0));
      return sent.at(-1)?.snapshot?.turnState;
    };
    return { fire, stateNow };
  }

  it('메인 턴이 끝난 뒤 배경 턴이 시작돼도 쉬는 중으로 남는다', async () => {
    const { fire, stateNow } = bootMod();
    await fire('session.start', { isInteractive: false });
    await fire('turn.start', { turnId: 't1' });
    expect(await stateNow()).toBe('running');
    await fire('turn.complete', { turnId: 't1', reason: 'answer' });
    expect(await stateNow()).toBe('idle');

    await fire('turn.start', { turnId: 'b1', agentId: 'bg-agent' });
    expect(await stateNow()).toBe('idle');
    await fire('turn.complete', { turnId: 'b1', agentId: 'bg-agent', reason: 'answer' });
    expect(await stateNow()).toBe('idle');
  });

  it('메인 턴 도중의 서브에이전트 턴은 메인 턴을 끝내지도 다시 시작하지도 않는다', async () => {
    const { fire, stateNow } = bootMod();
    await fire('session.start', { isInteractive: false });
    await fire('turn.start', { turnId: 't1' });
    await fire('turn.start', { turnId: 's1', agentId: 'sub-agent' });
    await fire('turn.complete', { turnId: 's1', agentId: 'sub-agent', reason: 'answer' });
    expect(await stateNow()).toBe('running');
    await fire('turn.complete', { turnId: 't1', reason: 'answer' });
    expect(await stateNow()).toBe('idle');
  });
});
