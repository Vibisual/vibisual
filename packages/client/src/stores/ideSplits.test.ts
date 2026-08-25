import { beforeEach, describe, expect, it } from 'vitest';

import type { SubAgent } from '@vibisual/shared';
import { useGraphStore, DEFAULT_IDE_OVERLAY } from './graphStore.js';
import { listCells } from '../components/IDE/splitLayout.js';

/**
 * §5.5 #17-34 — 창 **안** 화면 분할의 스토어 규약.
 *
 * 사용자 지시: "이 ide창 내부에서 해당 서브 세션을 드래그 하면 … 화면 분할로 여기저기 멀티뷰처럼
 * 이어붙이고 싶어". 여기서 못 박는 것은 화면이 아니라 **약속**이다 —
 * ① 분할은 두 칸 이상일 때만 존재하고 ② 한 칸만 남으면 창이 그 세션을 이어받으며
 * ③ 칸을 옮기는 것은 칸 수를 늘리지 않고 ④ 창이 다른 버블로 바뀌면 남의 분할은 무시된다.
 * 이 넷 중 하나라도 어긋나면 "분할을 껐는데 안 꺼진다 / 탭과 화면이 서로 다른 말을 한다"가 된다.
 */

const PROJ = 'proj';
const AGENT = 'agent-1';

/** 그 에이전트에 매달린 세션 하나 — 소속 검증이 실물을 보므로 시험도 실물을 세운다. */
function sub(id: string, parentAgentId: string): SubAgent {
  return {
    id,
    sessionId: `cc-${id}`,
    label: id,
    parentAgentId,
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
  };
}

function seed(activeSessionId: string | null = 'sub-a'): void {
  useGraphStore.setState({
    activeProject: PROJ,
    ideOverlays: {
      [PROJ]: {
        ...DEFAULT_IDE_OVERLAY,
        agentId: AGENT,
        paneKey: PROJ,
        projectId: PROJ,
        activeSessionId,
      },
    },
    // 이 창의 에이전트가 실제로 가진 세션들 — 여기 없는 세션은 떨궈도 앉지 않는다(남의 창 방어).
    subAgents: {
      [AGENT]: ['sub-a', 'sub-b', 'sub-c'].map((id) => sub(id, AGENT)),
      'agent-2': ['sub-y', 'sub-z'].map((id) => sub(id, 'agent-2')),
    },
    ideSplits: {},
    selectedSubByAgent: {},
    acknowledgedSubAgents: {},
  });
}

const store = (): ReturnType<typeof useGraphStore.getState> => useGraphStore.getState();
const split = () => store().ideSplits[PROJ];
const sessions = (): Array<string | null> => {
  const s = split();
  return s ? listCells(s.layout).map((c) => c.sessionId) : [];
};
const windowSession = (): string | null => store().ideOverlays[PROJ]?.activeSessionId ?? null;

beforeEach(() => { seed(); });

describe('첫 분할', () => {
  it('안 나눈 창에 떨구면 보던 세션 옆에 새 칸이 선다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    expect(sessions()).toEqual(['sub-a', 'sub-b']);
    // 초점은 방금 떨군 칸이 받는다.
    expect(split()?.focusedCellId).toBe(listCells(split()!.layout)[1]?.id);
  });

  it('아래로 떨구면 위아래로 포갠다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'bottom', 'sub-b');
    const layout = split()?.layout;
    expect(layout?.kind).toBe('branch');
    if (layout?.kind === 'branch') expect(layout.axis).toBe('col');
    expect(sessions()).toEqual(['sub-a', 'sub-b']);
  });

  it('창이 없으면 아무 일도 없다(유령 분할 ❌)', () => {
    useGraphStore.setState({ ideOverlays: {} });
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    expect(split()).toBeUndefined();
  });
});

describe('두 칸 이상일 때만 존재한다', () => {
  it('한 칸만 남게 닫으면 분할이 풀리고 창이 그 세션을 이어받는다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const [first, second] = listCells(split()!.layout);
    store().closeIDESplitCell(PROJ, first?.id ?? '');
    expect(split()).toBeUndefined();
    // 남은 칸이 보던 세션이 곧 창의 세션 — 분할을 풀었다고 화면이 딴 세션으로 튀지 않는다.
    expect(windowSession()).toBe('sub-b');
    expect(second?.sessionId).toBe('sub-b');
  });

  it('[분할 해제]는 초점 칸이 보던 세션 한 화면으로 되돌린다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    store().dropSessionOnIDECell(PROJ, null, 'bottom', 'sub-c');
    expect(sessions()).toHaveLength(3);
    store().resetIDESplit(PROJ);
    expect(split()).toBeUndefined();
    expect(windowSession()).toBe('sub-c'); // 마지막에 떨군 칸이 초점이었다
  });
});

describe('칸 옮기기', () => {
  it('출처 칸을 함께 주면 칸 수가 늘지 않는다(복제 ❌)', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const cells = listCells(split()!.layout);
    const [left, right] = cells;
    // 오른쪽 칸을 왼쪽 칸의 **위**로 옮긴다.
    store().dropSessionOnIDECell(PROJ, left?.id ?? '', 'top', 'sub-b', right?.id ?? '');
    expect(sessions()).toHaveLength(2);
    expect(sessions()).toEqual(['sub-b', 'sub-a']);
  });

  it('제자리에 놓으면 아무 일도 없다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const before = split();
    const target = listCells(before!.layout)[1];
    store().dropSessionOnIDECell(PROJ, target?.id ?? '', 'right', 'sub-b', target?.id ?? '');
    expect(split()).toBe(before); // 참조까지 그대로 = 리렌더도 없다
  });
});

describe('QA — 실제로 겪는 잘못된 떨구기', () => {
  it('남의 창(다른 에이전트) 세션은 앉지 않는다 — 떨궜다가 사라지는 대신 처음부터 거절', () => {
    // 창이 여럿이면 옆 창 탭이 이 창 본문으로 끌려 들어온다. 앉혀 두면 다음 정리에서 곧바로
    //   걷혀 사용자 눈에는 "떨궜는데 사라졌다"로만 보인다.
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-y'); // agent-2 의 세션
    expect(split()).toBeUndefined();
    expect(windowSession()).toBe('sub-a');
  });

  it('이미 다른 칸에 떠 있는 세션을 떨구면 복제가 아니라 옮기기다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-c');
    expect(sessions()).toEqual(['sub-a', 'sub-b', 'sub-c']);
    const cells = listCells(split()!.layout);
    const first = cells[0];
    // 맨 오른쪽 칸의 세션(sub-c)을 맨 왼쪽 칸 위로 — 칸 수는 그대로여야 한다.
    store().dropSessionOnIDECell(PROJ, first?.id ?? '', 'top', 'sub-c');
    expect(sessions()).toHaveLength(3);
    expect(sessions()).toEqual(['sub-c', 'sub-a', 'sub-b']);
  });

  it('이미 그 칸에 떠 있는 세션을 같은 칸에 떨구면 아무 일도 없다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const target = listCells(split()!.layout)[1];
    const before = split();
    store().dropSessionOnIDECell(PROJ, target?.id ?? '', 'right', 'sub-b');
    expect(split()).toBe(before);
  });

  it('안 나눈 창에 지금 보고 있는 세션을 그대로 떨구면 아무 일도 없다(같은 것 두 칸 ❌)', () => {
    // 사용자가 가장 먼저 해 보는 손동작 중 하나. 같은 세션 두 벌은 얻는 게 없고 CMD 면 해롭다 —
    //   화면은 이 사실을 드래그 중에 미리 말한다(호박색 "이미 이 칸에 있습니다").
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-a'); // 지금 보고 있는 세션
    expect(split()).toBeUndefined();
  });

  it('메인 탭(null)은 소속 검증 대상이 아니다 — 그 창의 것이므로 언제나 앉는다', () => {
    seed('sub-a');
    store().dropSessionOnIDECell(PROJ, null, 'right', null);
    expect(sessions()).toEqual(['sub-a', null]);
  });
});

describe('자가 치유', () => {
  it('창이 다른 버블로 갈아 끼워지면 남은 분할은 남의 것이라 새로 시작한다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    expect(sessions()).toHaveLength(2);
    // 같은 자리에 다른 에이전트가 열린 상황.
    useGraphStore.setState({
      ideOverlays: {
        [PROJ]: { ...DEFAULT_IDE_OVERLAY, agentId: 'agent-2', paneKey: PROJ, projectId: PROJ, activeSessionId: 'sub-z' },
      },
    });
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-y');
    expect(split()?.agentId).toBe('agent-2');
    expect(sessions()).toEqual(['sub-z', 'sub-y']);
  });

  it('사라진 세션을 문 칸은 걷히고, 바뀐 게 없으면 상태를 그대로 둔다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    store().dropSessionOnIDECell(PROJ, null, 'bottom', 'sub-c');
    const before = split();
    // 셋 다 살아 있으면 아무 일도 없어야 한다 — 참조가 바뀌면 effect 가 서로를 깨워 무한히 돈다.
    store().syncIDESplitCells(PROJ, ['sub-a', 'sub-b', 'sub-c']);
    expect(split()).toBe(before);
    // 하나가 사라지면 그 칸만 물러난다.
    store().syncIDESplitCells(PROJ, ['sub-a', 'sub-c']);
    expect(sessions()).toEqual(['sub-a', 'sub-c']);
    // 하나만 남으면 분할 자체가 풀린다.
    store().syncIDESplitCells(PROJ, ['sub-c']);
    expect(split()).toBeUndefined();
    expect(windowSession()).toBe('sub-c');
  });
});

describe('초점', () => {
  it('초점 칸을 옮기면 그 칸이 기준이 된다(다음 떨구기의 대상)', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const [left] = listCells(split()!.layout);
    store().focusIDESplitCell(PROJ, left?.id ?? '');
    expect(split()?.focusedCellId).toBe(left?.id);
    // 대상 칸을 안 주면 초점 칸이 대상이다 — 왼쪽 칸이 갈라진다.
    store().dropSessionOnIDECell(PROJ, null, 'bottom', 'sub-c');
    expect(sessions()).toEqual(['sub-a', 'sub-c', 'sub-b']);
  });

  it('없는 칸으로는 초점이 옮겨가지 않는다', () => {
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const before = split();
    store().focusIDESplitCell(PROJ, 'ghost');
    expect(split()).toBe(before);
  });
});
