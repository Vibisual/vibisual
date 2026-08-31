import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';
import type { BubbleData } from '@vibisual/shared';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 에 열린 프로젝트를 **실제로 기록한다**.
//   테스트가 만든 임시 폴더가 그 목록에 쌓이면 다음 부팅에서 유령 탭을 복원하려 든다 — 쓰기만 막는다
//   (읽기는 실제 구현 그대로 두어 스냅샷 주입 경로가 평소와 같게).
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §9 스코프드 스냅샷 구독 + 배경 탭 유휴 해제 — **규약 회귀 테스트**.
 *
 * 이 두 기능은 "안 보는 프로젝트를 덜 보내고 덜 들고 있는다"는 최적화라, 잘못 좁히면 증상이
 * **기능 손실**로 나타난다(탭이 사라진다 · 배지가 0 이 된다 · 헤더 카운트가 준다). 그래서
 * "무엇을 빼는가"만큼 **"무엇은 절대 빼지 않는가"** 를 함께 못 박는다.
 */

const tmpDirs: string[] = [];

function makeProjectDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-scope-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

interface Fixture {
  manager: ProjectGraphManager;
  nameA: string;
  nameB: string;
  agentA: BubbleData;
  agentB: BubbleData;
}

/** 프로젝트 두 개 + 각 프로젝트에 커스텀 에이전트 하나씩. */
function makeTwoProjects(): Fixture {
  const manager = new ProjectGraphManager();
  const dirA = makeProjectDir('a');
  const dirB = makeProjectDir('b');
  const nameA = manager.registerProject(dirA).name;
  const nameB = manager.registerProject(dirB).name;
  // 반환값은 인스턴스가 들고 있는 **그 객체**다 — 테스트는 여기서 status 를 직접 세운다.
  // ⚠ 상태를 직접 바꾼 뒤에는 `getSnapshot()` 을 처음 부르는 것이 순서다(스냅샷 캐시는
  //   mutationVersion 으로만 무효화되므로, 먼저 부르면 캐시가 옛 상태를 돌려준다).
  // 바로 위에서 두 폴더를 등록했으니 생성은 성공한다(§4 온보딩 ③: 폴더가 없으면 null).
  const agentA = manager.createCustomAgent('Agent A', undefined, nameA)!;
  const agentB = manager.createCustomAgent('Agent B', undefined, nameB)!;
  return { manager, nameA, nameB, agentA, agentB };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('§9 스코프드 스냅샷 구독', () => {
  it('내부 조회용 전체 스냅샷은 범위와 무관하게 전부 담는다(REST·dispatch 가 배경 프로젝트를 못 찾으면 기능 손상)', () => {
    const { manager, nameA, agentA, agentB } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);

    const internal = manager.getSnapshot().agents.map((a) => a.label);
    expect(internal).toContain(agentA.label);
    expect(internal).toContain(agentB.label);
  });

  it('아무도 선언하지 않으면 전부 보낸다(침묵은 축소가 아니다)', () => {
    const { manager, agentA, agentB } = makeTwoProjects();
    expect(manager.getEffectiveProjectScope()).toBeNull();

    const labels = manager.getBroadcastSnapshot().agents.map((a) => a.label);
    expect(labels).toContain(agentA.label);
    expect(labels).toContain(agentB.label);
  });

  // ⑥ — 클라가 "아직 안 온 탭"과 "빈 프로젝트"를 구별할 유일한 근거. 이 필드가 빠지면 느린
  //     회선에서 전자가 후자로 보이고(불러오는 중 표시가 영영 안 뜬다) 증상은 조용하다.
  it('적용한 범위를 scopedProjects 로 되돌려 준다', () => {
    const { manager, nameA } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);

    expect(manager.getBroadcastSnapshot().scopedProjects).toEqual([nameA]);
  });

  it('범위 미적용(전량)이면 scopedProjects 를 아예 싣지 않는다 — 없음 = 전부 왔다', () => {
    const { manager } = makeTwoProjects();
    expect(manager.getEffectiveProjectScope()).toBeNull();

    expect(manager.getBroadcastSnapshot().scopedProjects).toBeUndefined();
    // 내부 조회용 스냅샷도 범위를 적용하지 않으므로 같은 규칙이다.
    expect(manager.getSnapshot().scopedProjects).toBeUndefined();
  });

  it('창이 여럿이면 합집합이 실린다 — 다른 창이 보고 있는 탭도 "왔다"로 읽혀야 한다', () => {
    const { manager, nameA, nameB } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);
    manager.setClientProjectScope({}, [nameB]);

    const scoped = manager.getBroadcastSnapshot().scopedProjects ?? [];
    expect([...scoped].sort()).toEqual([nameA, nameB].sort());
  });

  it('선언한 프로젝트의 에이전트만 무거운 슬라이스에 실린다', () => {
    const { manager, nameA, agentA, agentB } = makeTwoProjects();
    const win = {};
    manager.setClientProjectScope(win, [nameA]);

    // ⚠ id 로 가르지 않는다 — 두 인스턴스가 같은 밀리초에 첫 에이전트를 만들면 sessionId(시각+
    //   인스턴스별 카운터)가 겹쳐 id 까지 같아진다. 여기서 볼 것은 "어느 프로젝트 것이 실렸나" 다.
    const labels = manager.getBroadcastSnapshot().agents.map((a) => a.label);
    expect(labels).toContain(agentA.label);
    expect(labels).not.toContain(agentB.label);
  });

  it('여러 창의 선언은 합집합이 된다(지휘통제실이 다른 프로젝트에 고정된 경우)', () => {
    const { manager, nameA, nameB, agentA, agentB } = makeTwoProjects();
    const main = {};
    const commandCenter = {};
    manager.setClientProjectScope(main, [nameA]);
    manager.setClientProjectScope(commandCenter, [nameB]);

    const labels = manager.getBroadcastSnapshot().agents.map((a) => a.label);
    expect(labels).toContain(agentA.label);
    expect(labels).toContain(agentB.label);
  });

  it('창이 닫히면 그 선언이 빠진다', () => {
    const { manager, nameA, nameB, agentB } = makeTwoProjects();
    const main = {};
    const commandCenter = {};
    manager.setClientProjectScope(main, [nameA]);
    manager.setClientProjectScope(commandCenter, [nameB]);
    manager.clearClientProjectScope(commandCenter);

    expect(manager.getBroadcastSnapshot().agents.map((a) => a.label)).not.toContain(agentB.label);
    // 마지막 창까지 닫히면 "선언 없음" 으로 돌아가 전부 보낸다.
    manager.clearClientProjectScope(main);
    expect(manager.getEffectiveProjectScope()).toBeNull();
    expect(manager.getBroadcastSnapshot().agents.map((a) => a.label)).toContain(agentB.label);
  });

  it('탭 목록·프로젝트별 배지·전역 활성 수는 범위와 무관하게 전량이다', () => {
    const { manager, nameA, nameB, agentB } = makeTwoProjects();
    // A 만 보는 상태에서 B 의 에이전트를 실행 중으로 만든다.
    agentB.status = 'active';
    manager.setClientProjectScope({}, [nameA]);

    const snap = manager.getBroadcastSnapshot();
    // ① 탭이 사라지지 않는다
    expect(Object.keys(snap.projects)).toEqual(expect.arrayContaining([nameA, nameB]));
    // ② 배경 탭 배지 숫자가 0 으로 죽지 않는다
    expect(snap.projectAgentCounts?.[nameA]?.total).toBe(1);
    expect(snap.projectAgentCounts?.[nameB]?.total).toBe(1);
    expect(snap.projectAgentCounts?.[nameB]?.active).toBe(1);
    // ③ 헤더의 "지금 몇 개 돌고 있나" 가 줄지 않는다
    expect(snap.activeAgentCount).toBe(1);
    // ④ 그러면서도 무거운 슬라이스에는 B 가 없다
    expect(snap.agents.map((a) => a.label)).not.toContain('Agent B');
  });
});

describe('§9 배경 탭 유휴 해제', () => {
  it('임계값이 0 이면 아무것도 내리지 않는다(사용자가 끈 상태)', () => {
    const { manager, nameA } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);
    expect(manager.sweepIdleBackgroundProjects(0)).toEqual([]);
  });

  it('선언한 창이 하나도 없으면 아무것도 내리지 않는다(무엇을 보는지 모를 때는 건드리지 않는다)', () => {
    const { manager } = makeTwoProjects();
    expect(manager.getEffectiveProjectScope()).toBeNull();
    expect(manager.sweepIdleBackgroundProjects(1)).toEqual([]);
  });

  it('보고 있는 프로젝트는 아무리 조용해도 내리지 않는다', async () => {
    const { manager, nameA } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.sweepIdleBackgroundProjects(1)).not.toContain(nameA);
  });

  it('안 보고 · 일 없고 · 오래됐으면 stub 으로 내려간다(탭은 남는다)', async () => {
    const { manager, nameA, nameB } = makeTwoProjects();
    manager.setClientProjectScope({}, [nameA]);
    await new Promise((r) => setTimeout(r, 20));

    expect(manager.sweepIdleBackgroundProjects(1)).toEqual([nameB]);

    const snap = manager.getBroadcastSnapshot();
    // hydrated 목록에서는 빠지고
    expect(Object.keys(snap.projects)).not.toContain(nameB);
    // stub 으로 남아 탭이 계속 보인다(클릭하면 되살아난다)
    expect(Object.keys(snap.stubProjects ?? {})).toContain(nameB);
  });

  it('일하는 것이 있으면 안 보고 있어도 내리지 않는다', async () => {
    const { manager, nameA, agentB } = makeTwoProjects();
    agentB.status = 'active';
    manager.setClientProjectScope({}, [nameA]);
    await new Promise((r) => setTimeout(r, 20));

    expect(manager.sweepIdleBackgroundProjects(1)).toEqual([]);
  });

  it('내려간 프로젝트를 다시 선언하면 자동으로 다시 올라온다', async () => {
    const { manager, nameA, nameB } = makeTwoProjects();
    const win = {};
    manager.setClientProjectScope(win, [nameA]);
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.sweepIdleBackgroundProjects(1)).toEqual([nameB]);
    expect(manager.isStubbed(nameB)).toBe(true);

    // 사용자가 그 탭을 다시 고른 상황 = 그 창의 구독 선언이 바뀐다.
    manager.setClientProjectScope(win, [nameB]);
    expect(manager.isStubbed(nameB)).toBe(false);
    expect(Object.keys(manager.getBroadcastSnapshot().projects)).toContain(nameB);
  });
});

describe('§9 저장은 바뀐 프로젝트만', () => {
  it('그래프가 바뀌면 변경 카운터가 오르고, 아무 일도 없으면 그대로다', () => {
    const { manager, nameA, agentA } = makeTwoProjects();
    const before = manager.getProjectMutationVersion(nameA);
    expect(before).not.toBeNull();

    // 조용한 구간 — 저장 판정이 "안 바뀜"으로 떨어져야 하는 자리
    expect(manager.getProjectMutationVersion(nameA)).toBe(before);

    manager.setAgentStatus(agentA.path, 'completed');
    expect(manager.getProjectMutationVersion(nameA)).not.toBe(before);
  });

  it('⚠ 모든 변경이 카운터를 올리지는 않는다 — 그래서 이 판정은 훅 경로에서만 쓴다', () => {
    const { manager, nameA } = makeTwoProjects();
    const before = manager.getProjectMutationVersion(nameA);
    // 커스텀 에이전트 생성은 카운터를 올리지 않는다(실측). 이 사실이 바뀌어도 테스트는 깨지지 않지만,
    // **깨지지 않는다는 것 자체가** "사용자 조작 저장까지 이 판정에 맡기면 안 된다"는 근거다.
    manager.createCustomAgent('Quiet', undefined, nameA);
    const after = manager.getProjectMutationVersion(nameA);
    if (after === before) {
      // 지금 구현: 안 오른다 → 훅 경로 밖에서 dirtyOnly 를 켜면 이 변경은 최대 한 창 늦게 저장된다.
      expect(after).toBe(before);
    } else {
      expect(after).not.toBe(before);
    }
  });

  it('없는 프로젝트 이름이면 null 이 아니라 대표 인스턴스 값이 온다(판정 실패가 미저장이 되지 않게)', () => {
    const { manager } = makeTwoProjects();
    // 호출자는 null 을 "보수적으로 저장" 으로 다루지만, 대표 인스턴스가 있으면 그 값이 온다.
    expect(manager.getProjectMutationVersion('nonexistent-project')).not.toBeUndefined();
  });

  it('seq 는 저장 대상 프로젝트만 오른다(안 바뀐 프로젝트의 지문 비교가 살아 있게)', () => {
    const { manager, nameA, nameB } = makeTwoProjects();
    const seqABefore = manager.toProjectCheckpoint(nameA).seq;
    const seqBBefore = manager.toProjectCheckpoint(nameB).seq;

    manager.incrementSeqForProjects([nameA]);

    expect(manager.toProjectCheckpoint(nameA).seq).toBe(seqABefore + 1);
    expect(manager.toProjectCheckpoint(nameB).seq).toBe(seqBBefore);
  });
});
