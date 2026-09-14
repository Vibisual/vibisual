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

/**
 * §5.5 #17-12 — **소속 해석이 끊긴 동안 들어온 줄도 디스크에 남고, 몇 줄짜리 버퍼가 긴 대화를 덮지 않는다.**
 *
 * 쓰기 경로는 종전에 소속 해석 하나에만 기대, 백그라운드 프로젝트가 stub 으로 내려간 동안 들어온 줄을
 * 메모리에만 두었다(재시작·idle 회수 뒤 그 구간이 통째로 비었다). 폴더를 못 짚은 채 시작된 버퍼는
 * 그 몇 줄이 "그 세션의 전부"로 나가 클라가 들고 있던 긴 대화를 갈아엎었다.
 */
describe('§5.5 #17-12 — 소속을 잃은 동안의 쓰기·부분 버퍼', () => {
  function linesOnDisk(parentAgentId: string, subId: string): string[] {
    const fp = path.join(streamBufferStore.subStreamsDir(project, parentAgentId), `${subId}.jsonl`);
    if (!fs.existsSync(fp)) return [];
    return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as SubAgentStreamEvent).content);
  }

  it('소속 해석이 끊겨도 그 부모가 쓰던 폴더로 이어 쓴다 — 새로 생긴 세션의 첫 줄부터', () => {
    const PARENT = 'agent-write-fallback';
    // 평소 — 소속이 풀려 그 부모의 폴더가 정해진다.
    subAgentManager.setProjectResolver((id) => (id === PARENT ? project : null));
    subAgentManager.emitSystemMessage(PARENT, 'sub-write-a', '해석될 때의 줄');
    // 프로젝트가 stub 으로 내려가 소속 해석이 끊겼다. 훑을 후보도 없다.
    subAgentManager.setProjectResolver(() => null);
    subAgentManager.setAllProjectsProvider(() => []);
    subAgentManager.emitSystemMessage(PARENT, 'sub-write-a', '끊긴 뒤의 줄');
    subAgentManager.emitSystemMessage(PARENT, 'sub-write-b', '끊긴 뒤 새 세션의 줄');
    streamBufferStore.flushAll();

    expect(linesOnDisk(PARENT, 'sub-write-a')).toEqual(['해석될 때의 줄', '끊긴 뒤의 줄']);
    expect(linesOnDisk(PARENT, 'sub-write-b')).toEqual(['끊긴 뒤 새 세션의 줄']);
  });

  it('폴더를 못 짚은 채 시작된 버퍼는 권위본으로 내보내지 않고, 폴더를 되찾으면 디스크 과거로 메운다', () => {
    const PARENT = 'agent-partial';
    const SUB = 'sub-partial';
    writeConversationToDisk(PARENT, SUB, 50);
    // 서버 재기동 뒤 소속도 후보도 없는 상태에서 그 세션이 다시 말한다 — 메모리에는 이 한 줄뿐이다.
    subAgentManager.emitSystemMessage(PARENT, SUB, '폴더 없이 들어온 줄');

    // 종전엔 여기서 [그 한 줄]이 나가 클라의 긴 대화를 덮었다. 빈 응답이면 클라는 교체하지 않고 다시 묻는다.
    expect(subAgentManager.getStreamBuffer(SUB, PARENT)).toEqual([]);

    subAgentManager.setAllProjectsProvider(() => [project]);
    const healed = subAgentManager.getStreamBuffer(SUB, PARENT);
    expect(healed).toHaveLength(51);
    expect(healed[0]?.content).toBe('대화 0');
    expect(healed[49]?.content).toBe('대화 49');
    expect(healed[50]?.content).toBe('폴더 없이 들어온 줄');
    // 메모리에만 있던 줄도 이 자리에서 디스크에 적힌다 — 다음 회수·재시작 뒤에도 남는다.
    streamBufferStore.flushAll();
    expect(linesOnDisk(PARENT, SUB)).toHaveLength(51);
    expect(linesOnDisk(PARENT, SUB)[50]).toBe('폴더 없이 들어온 줄');
  });

  it('과거 구간 조회 — 복원 창(2,000건) 위쪽을 소속을 잃은 채로도 되찾아 온다', () => {
    const PARENT = 'agent-older';
    const SUB = 'sub-older';
    writeConversationToDisk(PARENT, SUB, 2_600);
    subAgentManager.setAllProjectsProvider(() => [project]);

    const window = subAgentManager.getStreamBuffer(SUB, PARENT);
    expect(window).toHaveLength(2_000);
    expect(window[0]?.content).toBe('대화 600');

    const page = subAgentManager.getOlderStreamEvents(SUB, PARENT, { beforeId: window[0]!.id, beforeTs: window[0]!.timestamp }, 1_000);
    expect(page.events).toHaveLength(600);
    expect(page.events[0]?.content).toBe('대화 0');
    expect(page.events[599]?.content).toBe('대화 599');
    expect(page.hasMore).toBe(false);
    expect(page.unresolved).toBeUndefined();
  });

  it('과거 구간 조회에서 폴더를 못 찾으면 "더 없다"가 아니라 "못 찾았다"를 말한다', () => {
    const page = subAgentManager.getOlderStreamEvents('sub-older-missing', 'agent-older-missing', { beforeId: 'x' }, 10);
    expect(page).toEqual({ events: [], hasMore: false, unresolved: true });
  });
});
