import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';
import { subAgentManager } from './subAgentManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 실제로 건드린다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * 탭·헤더 배지의 프로젝트별 집계 — **화면에 없는 것을 세지 않고, 도는 것을 빠뜨리지 않는다.**
 *
 * 실제 사고: 살아 있는 에이전트 3개(그중 하나가 세션 5개를 동시에 돌리는 중) + 휴지통 17개인
 * 프로젝트가 `1/20` 으로 보였다. 분모는 캔버스에 없는 휴지통까지 세고, 분자는 버블 축이라
 * 다섯 세션이 1 로 접혔다.
 */

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

function makeProject(tag: string): { manager: ProjectGraphManager; name: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-counts-${tag}-`));
  tmpDirs.push(dir);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(dir).name;
  return { manager, name };
}

describe('프로젝트별 에이전트/세션 집계', () => {
  it('휴지통에 넣은 에이전트는 전체 수에서 빠진다 — 캔버스가 안 그리는 것을 숫자만 세면 안 된다', () => {
    const { manager, name } = makeProject('trash');
    manager.createCustomAgent('Keep', undefined, name);
    const trashed = manager.createCustomAgent('Trash', undefined, name);
    expect(manager.getBroadcastSnapshot().projectAgentCounts?.[name]?.total).toBe(2);

    expect(manager.tryTrashCustomAgentByBubbleId(trashed.id)).toBe(true);

    const counts = manager.getBroadcastSnapshot().projectAgentCounts?.[name];
    expect(counts?.total).toBe(1);
  });

  it('한 버블 안에서 도는 세션이 여럿이면 그 수만큼 센다 — 버블 축이면 영원히 1 이었다', () => {
    const { manager, name } = makeProject('sessions');
    const agent = manager.createCustomAgent('Runner', undefined, name);

    const subs = [0, 1, 2, 3, 4].map(() => subAgentManager.create(agent.id));
    for (const sub of subs) sub.status = 'active';
    // 끝난 세션도 함께 있어야 분모가 "세션 총 수"임을 확인할 수 있다.
    const done = subAgentManager.create(agent.id);
    done.status = 'idle';

    const counts = manager.getBroadcastSnapshot().projectAgentCounts?.[name];
    expect(counts?.sessions).toBe(6);
    expect(counts?.running).toBe(5);
    // 버블 축(active)은 여전히 1 이다 — 두 축이 다른 것을 세고 있음을 못 박는다.
    expect(counts?.total).toBe(1);
  });

  it('세션이 하나도 없는 버블은 자기 자신이 한 단위다', () => {
    const { manager, name } = makeProject('nosub');
    const fresh = manager.createCustomAgent('Fresh', undefined, name);
    fresh.status = 'active';

    const counts = manager.getBroadcastSnapshot().projectAgentCounts?.[name];
    expect(counts?.sessions).toBe(1);
    expect(counts?.running).toBe(1); // 세션이 없어도 버블이 도는 중이면 1
  });
});
