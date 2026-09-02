/**
 * §9 슬라이스 스코프 × 전선 증분 — **두 최적화가 겹치는 자리의 회귀 테스트.**
 *
 * 왜 따로 있나: 슬라이스 스코프는 스냅샷에서 필드를 **통째로 지운다**. 그 자리는 v3.89 증분
 * (`broadcastBus.lastSentSlices`)이 기준점을 들고 있는 자리와 정확히 겹친다. 잘못 맞물리면
 * 증상이 **조용한 값 유실**이다 — 범위에 다시 들어온 슬라이스가 "안 바뀜"으로 잡혀 영영
 * 도착하지 않거나, 옛 기준점 위에 새 증분이 얹혀 틀린 맵이 복원된다.
 *
 * 그래서 여기서 못 박는 것은 둘이다:
 *  ① 뺐다가 다시 넣으면 **전량으로 한 번 가고** 그 뒤부터 증분이 붙는다(유실 없음).
 *  ② 그 왕복을 클라와 **같은 규칙**으로 풀면 서버가 아는 값과 한 글자도 다르지 않다.
 *
 * ⚠ 이 테스트가 성립하는 전제는 "모든 창에 **같은 페이로드 한 벌**이 나간다"이다 —
 *   그래서 세 스코프 축이 전부 창별이 아니라 합집합이다(`sliceScope.ts` 함정 ①).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentReport, GraphSnapshot, WSMessage } from '@vibisual/shared';
import {
  DELTA_SLICE_KEYS,
  SCOPABLE_SLICE_KEYS,
  applyKeyedSliceDelta,
  carryForwardScopedSlices,
} from '@vibisual/shared';
import { ProjectGraphManager } from './services/projectGraphManager.js';
import { broadcast, setBroadcastSink, resetSnapshotDeltaBaseline } from './broadcastBus.js';

vi.mock('./services/appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

const tmpDirs: string[] = [];

afterEach(() => {
  setBroadcastSink(null);
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeManager(): { manager: ProjectGraphManager; name: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-swire-')));
  tmpDirs.push(dir);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(dir).name;
  return { manager, name };
}

const report = (agentId: string, id: string): AgentReport =>
  ({ id, agentId, did: 'did ' + id, userActions: [], createdAt: Date.now() } as unknown as AgentReport);

/**
 * 클라이언트 한 벌을 흉내낸다 — `useWebSocket.materializeSnapshot` 과 **같은 순서·같은 규칙**이다.
 * (증분 풀기 → 범위로 빠진 슬라이스 이어받기). 순서가 뒤집히면 실제 클라도 같이 틀린다.
 */
class FakeClient {
  private shadow: Record<string, Record<string, unknown>> = {};
  private lastWire: Record<string, unknown> | null = null;

  receive(wire: Record<string, unknown>): Record<string, unknown> {
    const deltas = wire['deltas'] as Record<string, never> | undefined;
    let full: Record<string, unknown> = { ...wire };
    for (const key of DELTA_SLICE_KEYS) {
      const d = deltas?.[key];
      if (d) {
        const merged = applyKeyedSliceDelta(this.shadow[key] ?? {}, d);
        this.shadow[key] = merged;
        full[key] = merged;
      } else {
        this.shadow[key] = (wire[key] ?? {}) as Record<string, unknown>;
      }
    }
    delete full['deltas'];
    full = carryForwardScopedSlices(this.lastWire, full, wire['scopedSlices'] as string[] | undefined);
    this.lastWire = full;
    return full;
  }
}

describe('§9 슬라이스 스코프 — 전선 증분과의 맞물림', () => {
  let sent: WSMessage[] = [];

  beforeEach(() => {
    sent = [];
    resetSnapshotDeltaBaseline();
    setBroadcastSink((m) => { sent.push(m); });
  });

  const push = (snap: GraphSnapshot): Record<string, unknown> => {
    broadcast({ type: 'graph_snapshot', payload: snap, timestamp: Date.now() } as WSMessage);
    return (sent[sent.length - 1] as unknown as { payload: Record<string, unknown> }).payload;
  };

  const deltasOf = (wire: Record<string, unknown>): Record<string, { changed: Record<string, unknown> }> | undefined =>
    wire['deltas'] as Record<string, { changed: Record<string, unknown> }> | undefined;

  it('뺐다가 다시 넣으면 전량으로 한 번 가고, 그 뒤부터 증분이 붙는다', () => {
    const { manager, name } = makeManager();
    // 키가 하나뿐이면 그 하나가 바뀐 순간 "절반 초과" 라 `diffKeyedSlice` 가 일부러 전량으로
    // 되돌린다(증분이 이득이 없는 구간). 실사용 규모(에이전트 여럿)로 세운다.
    for (const id of ['a1', 'a2', 'a3', 'a4']) manager.addAgentReport(report(id, id + '-r1'));

    const win = {};
    manager.setClientProjectScope(win, [name], undefined, ['ideLane']);

    // ① 범위 안 — 첫 전송은 전량, 두 번째부터 증분.
    const w1 = push(manager.getBroadcastSnapshot());
    expect(w1['agentReports']).toBeDefined();
    expect(deltasOf(w1)?.['agentReports']).toBeUndefined();

    manager.addAgentReport(report('a1', 'a1-r2'));
    const w2 = push(manager.getBroadcastSnapshot());
    expect(w2['agentReports']).toBeUndefined();
    expect(Object.keys(deltasOf(w2)?.['agentReports']?.changed ?? {})).toEqual(['a1']);

    // ② IDE 를 닫았다 — 필드째 빠지고, 증분도 만들지 않는다(빈 객체를 지어 보내지 않는다).
    manager.setClientProjectScope(win, [name], undefined, []);
    manager.addAgentReport(report('a2', 'a2-r2'));   // 범위 밖에서도 서버는 계속 쌓는다
    const w3 = push(manager.getBroadcastSnapshot());
    expect(w3['agentReports']).toBeUndefined();
    expect(deltasOf(w3)?.['agentReports']).toBeUndefined();
    expect(w3['scopedSlices']).toEqual([]);

    // ③ 다시 열었다 — **전량**으로 한 번 간다(범위 밖에서 쌓인 a2-r2 를 포함해서).
    manager.setClientProjectScope(win, [name], undefined, ['ideLane']);
    const w4 = push(manager.getBroadcastSnapshot());
    const full = w4['agentReports'] as Record<string, unknown[]>;
    expect(full, '다시 실릴 때 전량이 아니면 범위 밖에서 쌓인 변경이 영영 유실된다').toBeDefined();
    expect(deltasOf(w4)?.['agentReports']).toBeUndefined();
    expect(full['a2']).toHaveLength(2);

    // ④ 그 뒤부터 다시 증분이 붙는다.
    manager.addAgentReport(report('a3', 'a3-r2'));
    const w5 = push(manager.getBroadcastSnapshot());
    expect(w5['agentReports']).toBeUndefined();
    expect(Object.keys(deltasOf(w5)?.['agentReports']?.changed ?? {})).toEqual(['a3']);
  });

  it('클라는 범위 밖 슬라이스의 직전 값을 유지한다 — 화면에서 데이터가 사라지지 않는다', () => {
    const { manager, name } = makeManager();
    for (const id of ['a1', 'a2', 'a3', 'a4']) manager.addAgentReport(report(id, id + '-r1'));

    const win = {};
    const client = new FakeClient();

    manager.setClientProjectScope(win, [name], undefined, ['ideLane']);
    const seen1 = client.receive(push(manager.getBroadcastSnapshot()));
    const reportsWhileOpen = seen1['agentReports'];
    expect(reportsWhileOpen).toBeDefined();

    // IDE 를 닫는다 — 서버는 안 보내지만 클라가 들고 있던 값은 그대로여야 한다.
    manager.setClientProjectScope(win, [name], undefined, []);
    const seen2 = client.receive(push(manager.getBroadcastSnapshot()));
    expect(
      seen2['agentReports'],
      '범위 밖은 "비어 있는 것"이 아니라 "아직 안 온 것"이다 — `?? {}` 로 덮으면 화면에서 사라진다',
    ).toBe(reportsWhileOpen);

    // 여러 스냅샷이 더 흘러도 계속 이어진다(한 번만 되는 게 아니다).
    const seen3 = client.receive(push(manager.getBroadcastSnapshot()));
    expect(seen3['agentReports']).toBe(reportsWhileOpen);
  });

  it('왕복 등가 — 범위 안 슬라이스는 서버가 아는 값과 한 글자도 다르지 않다', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));
    manager.setClientProjectScope({}, [name], undefined, ['ideLane']);

    const client = new FakeClient();
    client.receive(push(manager.getBroadcastSnapshot()));

    manager.addAgentReport(report('a2', 'r9'));
    const authoritative = manager.getSnapshot() as unknown as Record<string, unknown>;
    const restored = client.receive(push(manager.getBroadcastSnapshot()));

    const shipped = new Set<string>((restored['scopedSlices'] as string[] | undefined) ?? []);
    for (const key of SCOPABLE_SLICE_KEYS) {
      if (!shipped.has(key)) continue;
      if (authoritative[key] === undefined) continue;
      expect(restored[key], key + ' 가 어긋났다').toEqual(authoritative[key]);
    }
    // 델타를 타는 슬라이스도 함께(두 최적화가 서로를 망가뜨리지 않는지).
    for (const key of DELTA_SLICE_KEYS) {
      if (authoritative[key] === undefined) continue;
      if (!shipped.has(key) && (SCOPABLE_SLICE_KEYS as readonly string[]).includes(key)) continue;
      expect(restored[key], key + ' 가 어긋났다').toEqual(authoritative[key]);
    }
  });

  it('범위 미적용(구버전 클라)에는 `scopedSlices` 가 아예 없다 — 종전과 같은 스냅샷', () => {
    const { manager } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));

    const wire = push(manager.getBroadcastSnapshot());
    expect(wire['scopedSlices']).toBeUndefined();
    expect(wire['agentReports']).toBeDefined();
  });
});
