/**
 * §5.4 #36 (H) ①-2 — [이전 연결 다시 보기] 기록 한 벌(`agentLinkRecord.ts`)의 계약.
 *
 *  1. 다시 세울 순서는 마지막으로 만진 시각 오름차순이다 — 선 방향이 마지막 도구로 맞는다.
 *  2. 파일이 사슬째 세우는 내부 폴더는 따로 흘리지 않고, 그 아래 파일이 없는 내부 폴더만 폴더로 흘린다.
 *  3. 외부 폴더는 흘리지 않는다(그 파일이 세운다). Grep/Glob 으로 붙었던 파일은 그 폴더별 묶음으로 흘린다.
 *  4. 한도·정화 — 오래된 것부터 버리고, 모르는 칸·종류·손상 값은 들이지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_LINK_RECORD, type AgentLinkEntry, type WebEntry } from '@vibisual/shared';
import { capAgentLinkEntries, planLinkReplay, sanitizeAgentLinkRecords } from './agentLinkRecord.js';

function entry(extra: Partial<AgentLinkEntry> & Pick<AgentLinkEntry, 'key' | 'bubbleType'>): AgentLinkEntry {
  return { ...extra };
}

describe('planLinkReplay — 다시 세울 순서', () => {
  it('마지막으로 만진 시각 오름차순으로 흘린다', () => {
    const ops = planLinkReplay([
      entry({ key: 'b.ts', bubbleType: 'file', target: '/p/b.ts', lastTool: 'Read', lastActivity: 30 }),
      entry({ key: 'a.ts', bubbleType: 'file', target: '/p/a.ts', lastTool: 'Edit', lastActivity: 10 }),
    ]);
    expect(ops.map((op) => (op.kind === 'file' ? `${op.target}:${op.tool}` : op.kind))).toEqual(['/p/a.ts:Edit', '/p/b.ts:Read']);
  });

  it('파일이 사슬째 세우는 내부 폴더는 흘리지 않고, 아래 파일이 없는 내부 폴더만 폴더로 흘린다', () => {
    const ops = planLinkReplay([
      entry({ key: 'src', bubbleType: 'internal_folder', target: '/p/src', lastTool: 'Edit', lastActivity: 1 }),
      entry({ key: 'src/a.ts', bubbleType: 'file', target: '/p/src/a.ts', lastTool: 'Edit', lastActivity: 1 }),
      entry({ key: 'docs', bubbleType: 'internal_folder', target: '/p/docs', lastTool: 'Glob', lastActivity: 2 }),
      // 이름만 앞부분이 같은 이웃(`src-old`)은 `src` 의 자손이 아니다.
      entry({ key: 'src-old', bubbleType: 'internal_folder', target: '/p/src-old', lastTool: 'Grep', lastActivity: 3 }),
    ]);
    expect(ops).toEqual([
      { kind: 'file', at: 1, target: '/p/src/a.ts', tool: 'Edit' },
      { kind: 'dir', at: 2, target: '/p/docs', tool: 'Glob' },
      { kind: 'dir', at: 3, target: '/p/src-old', tool: 'Grep' },
    ]);
  });

  it('외부 폴더는 흘리지 않고, 훑은 폴더에 붙었던 파일은 그 폴더별 묶음으로 흘린다', () => {
    const ops = planLinkReplay([
      entry({ key: '__ext__/x', bubbleType: 'external_folder', target: '/x', lastActivity: 5 }),
      entry({ key: '__ext__/x/sub/a.ts', bubbleType: 'file', target: '/x/sub/a.ts', folders: ['/x'], folderOnly: true, lastTool: 'Grep', lastActivity: 5 }),
      entry({ key: '__ext__/x/sub/b.ts', bubbleType: 'file', target: '/x/sub/b.ts', folders: ['/x'], lastTool: 'Read', lastActivity: 7 }),
    ]);
    // b.ts 는 직속 부모 밑에도 있었다(folderOnly 아님) → 낱개로도 흐른다.
    expect(ops).toEqual([
      { kind: 'file', at: 7, target: '/x/sub/b.ts', tool: 'Read' },
      { kind: 'dir', at: 7, target: '/x', tool: 'Grep', files: ['/x/sub/a.ts', '/x/sub/b.ts'] },
    ]);
  });

  it('도메인은 호스트와 웹 이력을, 명령 앱은 앱과 탭 프로젝트를 싣는다 — 모르는 것은 흘리지 않는다', () => {
    const web: WebEntry = { id: 'w1', kind: 'fetch', url: 'https://example.com/a', at: 1 };
    const ops = planLinkReplay([
      entry({ key: '__web__example.com', bubbleType: 'domain', target: 'example.com', webEntries: [web], lastActivity: 1 }),
      entry({
        key: 'app-key',
        bubbleType: 'bash',
        commandApp: { id: 'git', name: 'Git', detection: 'command' },
        project: 'proj',
        lastActivity: 2,
      }),
      // 탭 프로젝트를 모르는 명령 앱 · 경로 없는 파일은 세울 수 없다.
      entry({ key: 'lost-app', bubbleType: 'bash', commandApp: { id: 'x', name: 'X', detection: 'command' }, lastActivity: 3 }),
      entry({ key: 'lost.ts', bubbleType: 'file', lastActivity: 4 }),
    ]);
    expect(ops).toEqual([
      { kind: 'domain', at: 1, key: '__web__example.com', host: 'example.com', tool: 'Read', webEntries: [web] },
      { kind: 'app', at: 2, key: 'app-key', target: { id: 'git', name: 'Git', detection: 'command' }, project: 'proj', tool: 'Bash' },
    ]);
  });
});

describe('capAgentLinkEntries — 한도', () => {
  it('넘치면 오래 안 만진 버블부터 버리고 오래된 것부터 늘어놓는다', () => {
    const many = Array.from({ length: AGENT_LINK_RECORD.maxEntries + 5 }, (_, i) =>
      entry({ key: `f${i}.ts`, bubbleType: 'file', target: `/p/f${i}.ts`, lastActivity: AGENT_LINK_RECORD.maxEntries + 5 - i }));
    const kept = capAgentLinkEntries(many);
    expect(kept).toHaveLength(AGENT_LINK_RECORD.maxEntries);
    expect(kept[0]!.lastActivity).toBe(6);
    expect(kept.at(-1)!.lastActivity).toBe(AGENT_LINK_RECORD.maxEntries + 5);
  });

  it('도메인 웹 이력은 버블 기본 상한까지(최신이 앞)', () => {
    const web = Array.from({ length: AGENT_LINK_RECORD.maxWebEntries + 3 }, (_, i): WebEntry => ({ id: `w${i}`, kind: 'fetch', at: i }));
    const [kept] = capAgentLinkEntries([entry({ key: '__web__a', bubbleType: 'domain', target: 'a', webEntries: web })]);
    expect(kept!.webEntries).toHaveLength(AGENT_LINK_RECORD.maxWebEntries);
    expect(kept!.webEntries![0]!.id).toBe('w0');
  });
});

describe('sanitizeAgentLinkRecords — 디스크에서 온 값', () => {
  it('아는 칸만 들이고, 손상된 줄·모르는 종류는 버리며, 줄이 없는 에이전트는 뺀다', () => {
    const out = sanitizeAgentLinkRecords({
      'agent-a': {
        at: 5,
        entries: [
          { key: 'a.ts', bubbleType: 'file', target: '/p/a.ts', lastActivity: 2, readCount: 3, position: { x: 1, y: Number.NaN }, evil: 'x' },
          { key: 'r', bubbleType: 'root' },
          { bubbleType: 'file' },
          'garbage',
          { key: 'f', bubbleType: 'file', target: '/p/f', folders: ['/x', 3], folderOnly: true, activity: Number.POSITIVE_INFINITY },
        ],
      },
      'agent-empty': { at: 1, entries: [{ key: 'r', bubbleType: 'root' }] },
      'agent-broken': { entries: 'nope' },
    });
    expect([...out.keys()]).toEqual(['agent-a']);
    expect(out.get('agent-a')).toEqual({
      at: 5,
      entries: [
        { key: 'f', bubbleType: 'file', target: '/p/f', folders: ['/x'], folderOnly: true },
        { key: 'a.ts', bubbleType: 'file', target: '/p/a.ts', lastActivity: 2, readCount: 3 },
      ],
    });
  });

  it('객체가 아니면 빈 맵이다(구버전 체크포인트 — 칸이 없다)', () => {
    expect(sanitizeAgentLinkRecords(undefined).size).toBe(0);
    expect(sanitizeAgentLinkRecords([1, 2]).size).toBe(0);
  });
});
