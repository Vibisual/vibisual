import { beforeEach, describe, expect, it } from 'vitest';

import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

/**
 * §4 v3.16 모바일 웹 — 폰 화면을 껐다 켜 **다시 붙은 뒤** 스토어가 버퍼를 어떻게 합치는지 못 박는다.
 *
 * 끊긴 사이의 스트림 줄은 WS 로 다시 오지 않아 버퍼 가운데가 빈다(글이 중간에서 끊겨 멈춘 것처럼 읽힌다).
 * 재연결 쪽이 서버 창을 다시 받아 오면 여기서 ① 가운데를 제자리에 메우고 ② 요청이 오가는 사이 WS 로 온
 * 줄을 잃지 않고 ③ 같은 줄이 두 번 그려지지 않게 하며 ④ 창들이 깊은 창을 다시 받도록 표식을 내린다.
 */

const AGENT = 'agent-1';
const SUB = 'sub-a';

function evt(n: number): SubAgentStreamEvent {
  return {
    id: `${SUB}-${n}`,
    subAgentId: SUB,
    parentAgentId: AGENT,
    timestamp: 1_700_000_000_000 + n,
    eventType: 'text',
    content: `line ${n}`,
  };
}

function range(from: number, to: number): SubAgentStreamEvent[] {
  const out: SubAgentStreamEvent[] = [];
  for (let n = from; n <= to; n++) out.push(evt(n));
  return out;
}

const bufferIds = (): string[] => (useGraphStore.getState().subAgentStreams[SUB] ?? []).map((e) => e.id);
const rangeIds = (from: number, to: number): string[] => range(from, to).map((e) => e.id);

function openIDE(): void {
  useGraphStore.setState({
    activeProject: 'proj',
    subAgents: { [AGENT]: [{ id: SUB }] as unknown as SubAgent[] },
  });
  useGraphStore.getState().openIDEOverlay(AGENT);
  useGraphStore.getState().setIDEActiveSession(SUB);
}

describe('재연결 뒤 스트림 합치기 (§4 v3.16)', () => {
  beforeEach(() => {
    useGraphStore.setState({
      subAgentStreams: {},
      streamLastActivity: {},
      deepRestoredSessions: {},
      streamHistoryExtra: {},
      streamHistoryDone: {},
      ideOverlays: {},
      subAgents: {},
      activeProject: null,
    });
  });

  it('표식 내리기는 깊은 복원 표식을 모두 지운다 — 창이 깊은 창을 다시 받는다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 99) }, 'deep');
    expect(useGraphStore.getState().deepRestoredSessions[SUB]).toBe(true);

    useGraphStore.getState().markStreamsStale();

    expect(useGraphStore.getState().deepRestoredSessions).toEqual({});
    // 버퍼는 그대로 — 다시 받는 동안 화면이 비지 않는다.
    expect(bufferIds()).toEqual(rangeIds(0, 99));
  });

  it('지울 표식이 없으면 상태를 바꾸지 않는다', () => {
    const before = useGraphStore.getState();
    useGraphStore.getState().markStreamsStale();
    expect(useGraphStore.getState()).toBe(before);
  });

  it('얕은 적재가 끊겨 있던 사이를 버퍼 가운데 제자리에 메운다', () => {
    openIDE();
    // 끊기기 전 0~49 · 다시 붙은 뒤 WS 로 온 80~89 · 가운데 50~79 가 빠졌다.
    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 49) }, 'deep');
    useGraphStore.getState().appendStreamEvents(range(80, 89));
    expect(bufferIds()).toHaveLength(60);

    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(40, 89) }, 'shallow');

    expect(bufferIds()).toEqual(rangeIds(0, 89));
  });

  it('얕은 창으로 교체할 때 요청이 오가는 사이 WS 로 온 줄을 잃지 않는다', () => {
    openIDE();
    // 버퍼가 서버 창보다 짧아 교체 길로 가는 경우 — 가운데가 빈 채 끝에 방금 온 줄 둘이 있다.
    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 4) }, 'shallow');
    useGraphStore.getState().appendStreamEvents(range(40, 41));

    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 39) }, 'shallow');

    expect(bufferIds()).toEqual(rangeIds(0, 41));
  });

  it('서버 창에 이미 실려 온 줄이 WS 로 또 오면 두 번 그리지 않는다 — 단건', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 9) }, 'shallow');

    useGraphStore.getState().appendStreamEvent(evt(9));
    useGraphStore.getState().appendStreamEvent(evt(10));

    expect(bufferIds()).toEqual(rangeIds(0, 10));
  });

  it('서버 창에 이미 실려 온 줄이 WS 로 또 오면 두 번 그리지 않는다 — 배치', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB]: range(0, 9) }, 'shallow');

    useGraphStore.getState().appendStreamEvents(range(7, 12));

    expect(bufferIds()).toEqual(rangeIds(0, 12));
  });

  it('한 배치 안에서 같은 줄이 겹쳐 와도 한 번만 붙는다', () => {
    openIDE();
    useGraphStore.getState().appendStreamEvents([evt(0), evt(1), evt(1), evt(2)]);

    expect(bufferIds()).toEqual(rangeIds(0, 2));
  });
});
