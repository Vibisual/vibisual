import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';
import { subAgentManager } from './subAgentManager.js';
import * as streamBufferStore from './streamBufferStore.js';

/**
 * §5.5 — **소속을 잃어도 대화는 되찾는다.**
 *
 * 사용자 보고(2026-09-08): 한 세션에서 대화하다 밀도를 오가고, 다른 세션·프로젝트를 열었다 닫았다
 * 한 뒤 그 세션으로 돌아오니 **대화 내역이 통째로 사라지고** 말풍선과 질문 카드만 남았다.
 *
 * 원인은 지워진 데이터가 아니라 **가는 길**이었다. 서버가 그 세션의 스트림 파일을 찾는 유일한
 * 길이 `projectResolver` 였는데, 그것은 `sessionCwds`·`agents` 맵을 훑어 소속을 찾는다 — 프로젝트
 * 탭을 닫았다 오가면 그 에이전트가 두 맵에서 빠져 `null` 이 되고, `sub-streams/<agentId>/<subId>.jsonl`
 * 이 디스크에 온전히 있는데도 **빈 배열이 나갔다.** 클라는 그 빈 응답을 몇 번 되묻다 포기했고,
 * 화면은 그 상태로 굳었다.
 *
 * 여기서 잠그는 것은 셋이다 — 소속을 잃어도 ① 아는 프로젝트를 훑어 찾는다 ② 찾은 자리를 기억해
 * 후보 목록이 빈 뒤에도 계속 읽는다 ③ 아무 데도 없으면 없는 대화를 지어내지 않는다.
 *
 * 매니저는 싱글턴이라 케이스끼리 메모리 버퍼·기억한 자리가 샌다 — **케이스마다 다른 세션 id** 를
 * 써서 서로를 건드리지 않게 한다(그게 실제 앱의 모양이기도 하다).
 */

let tmpRoot: string;
let project: ProjectInfo;

/** 그 세션이 실제로 나눈 대화 — 디스크에만 있고 서버 메모리에는 없는 상태를 만든다. */
function writeConversationToDisk(parentAgentId: string, subId: string, count: number, from = 0): void {
  const dir = streamBufferStore.subStreamsDir(project, parentAgentId);
  for (let n = from; n < from + count; n++) {
    const event: SubAgentStreamEvent = {
      id: `${subId}-${n}`,
      subAgentId: subId,
      parentAgentId,
      timestamp: 1_700_000_000_000 + n,
      eventType: 'text',
      content: `대화 ${n}`,
    };
    streamBufferStore.appendEvent(dir, event);
  }
  // append 는 배칭되므로 디스크로 내려 보낸다(이 시험은 파일이 실재함을 전제한다).
  streamBufferStore.flushAll();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-streamdir-'));
  project = { name: 'recovery-proj', path: path.join(tmpRoot, 'recovery-proj') } as ProjectInfo;
  // 이 시험의 전제 — 소속 해석은 **실패한다**(프로젝트 탭을 닫았다 오간 뒤의 상태).
  subAgentManager.setProjectResolver(() => null);
  subAgentManager.setAllProjectsProvider(() => []);
});

afterEach(() => {
  subAgentManager.setProjectResolver(() => null);
  subAgentManager.setAllProjectsProvider(() => []);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('§5.5 — 소속을 잃은 세션의 대화 되찾기', () => {
  it('아는 프로젝트를 훑어 스트림 파일이 있는 자리를 찾아 대화를 전부 돌려준다', () => {
    const PARENT = 'agent-recover-sweep';
    const SUB = 'sub-recover-sweep';
    writeConversationToDisk(PARENT, SUB, 1200);
    // 소속은 못 풀지만 그 프로젝트는 서버가 알고 있다 — 이것이 마지막 그물이다.
    subAgentManager.setAllProjectsProvider(() => [project]);

    const events = subAgentManager.getStreamBuffer(SUB, PARENT);

    expect(events).toHaveLength(1200);
    expect(events[0]?.content).toBe('대화 0');
    expect(events[events.length - 1]?.content).toBe('대화 1199');
  });

  it('소속을 잃은 세션이 다시 말해도 과거를 이어붙인다 — 새 줄만 남지 않는다', () => {
    const PARENT = 'agent-recover-resume';
    const SUB = 'sub-recover-resume';
    writeConversationToDisk(PARENT, SUB, 300);
    // 메모리 캐시는 비어 있고(서버 재기동·idle 회수 뒤) 소속도 못 푸는 상태에서 그 세션이 다시 말한다.
    subAgentManager.setAllProjectsProvider(() => [project]);

    // 정규 emit 경로(`emitStreamEvent`)를 그대로 타는 공개 진입점.
    subAgentManager.emitSystemMessage(PARENT, SUB, '대화 300');

    // 과거를 못 이어붙이면 여기는 1이 된다 — 그 세션의 화면이 "방금 한 말 한 줄"만 남는 자리다.
    const events = subAgentManager.getStreamBuffer(SUB, PARENT);
    expect(events).toHaveLength(301);
    expect(events[0]?.content).toBe('대화 0');
    expect(events[299]?.content).toBe('대화 299');
    expect(events[300]?.content).toBe('대화 300');
  });

  it('어느 후보에도 그 파일이 없으면 빈 배열 — 없는 대화를 지어내지 않는다', () => {
    const PARENT = 'agent-recover-missing';
    const SUB = 'sub-recover-missing';
    const other: ProjectInfo = { name: 'other', path: path.join(tmpRoot, 'other') } as ProjectInfo;
    subAgentManager.setAllProjectsProvider(() => [other]);

    expect(subAgentManager.getStreamBuffer(SUB, PARENT)).toEqual([]);
  });
});
