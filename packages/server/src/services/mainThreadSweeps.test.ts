/**
 * §9 「일하는 동안의 메인 스레드」 — 에이전트가 일하는 동안 메인 스레드를 잡던 세 탐색. 서버가 창의 메인 스레드에서 돌아(§3.7)
 * 그 멈춤이 곧 제목줄 끌기의 끊김·순간이동이었다. 빠르게 만들면서 잃으면 안 되는 것(새 기록은 제때 잡힌다 · ghost 판정은 같다)을 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILE_EXISTENCE_MISS_THRESHOLD, type HookEventPayload } from '@vibisual/shared';
import { readCodexContext } from './codexContext.js';
import { __resetSessionCachesForTest, readContextInfo, sessionPathRetryDelayMs } from './sessionDiscovery.js';
import { ProjectGraph } from './projectGraph.js';

const tokenEvent = (used: number) => JSON.stringify({
  type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { input_tokens: used, cached_input_tokens: 0, output_tokens: 1, total_tokens: used },
    total_token_usage: { input_tokens: used, cached_input_tokens: 0, output_tokens: 1 },
    model_context_window: 258400,
  } },
});

describe('Codex 롤아웃 색인 — 없는 스레드가 트리를 다시 훑지 않는다', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-rollout-index-'));
    vi.stubEnv('CODEX_HOME', home);
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeRollout = (day: string[], threadId: string, used: number): void => {
    const dir = path.join(home, 'sessions', ...day);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-2026-10-29T00-00-00-${threadId}.jsonl`), `${tokenEvent(used)}\n`);
  };

  it('가장 최근 날짜 폴더에 새로 생긴 롤아웃은 2초 뒤 다시 물으면 잡힌다', () => {
    writeRollout(['2026', '10', '28'], 'old-thread', 10);
    expect(readCodexContext('old-thread')?.contextUsed).toBe(10);
    expect(readCodexContext('fresh-thread')).toBeNull();

    writeRollout(['2026', '10', '29'], 'fresh-thread', 20);
    vi.mocked(Date.now).mockReturnValue(102_500);
    expect(readCodexContext('fresh-thread')?.contextUsed).toBe(20);
  });

  it('없는 스레드는 트리 전체를 다시 훑지 않는다 — 옛 날짜 폴더에 뒤늦게 생긴 것은 1분 주기 전체 탐색이 잡는다', () => {
    writeRollout(['2026', '10', '28'], 'seed-thread', 10);
    writeRollout(['2026', '10', '29'], 'newest-thread', 11);
    expect(readCodexContext('late-thread')).toBeNull();

    // 최근 날짜 폴더 밖 — 최근 길만 다시 읽는 동안은 보이지 않는다(= 트리 전체를 다시 훑지 않았다).
    writeRollout(['2026', '10', '28'], 'late-thread', 30);
    vi.mocked(Date.now).mockReturnValue(103_000);
    expect(readCodexContext('late-thread')).toBeNull();

    vi.mocked(Date.now).mockReturnValue(161_000);
    expect(readCodexContext('late-thread')?.contextUsed).toBe(30);
  });
});

describe('Claude 기록 탐색 — 거듭 없는 세션은 드물게, 새로 생긴 기록은 바로', () => {
  it('다시 찾는 간격은 두 배씩 늘고 1분 언저리에서 멈춘다 · 세션마다 조금씩 어긋난다', () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    const delays = [1, 2, 3, 4, 5, 6, 7, 12].map((n) => sessionPathRetryDelayMs(id, n));
    expect(delays[0]).toBeGreaterThanOrEqual(3000);
    expect(delays[0]).toBeLessThanOrEqual(3750);
    for (let i = 1; i < 6; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]!);
    expect(delays[6]).toBe(delays[7]);
    expect(delays[7]).toBeGreaterThanOrEqual(60_000);
    expect(delays[7]).toBeLessThanOrEqual(75_000);
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => sessionPathRetryDelayMs(`${s}-session`, 4)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('놓친 세션이라도 기본 폴더에 기록이 생기면 다음 물음에 바로 잡힌다', () => {
    // Exercise slug punctuation on every OS, including macOS temporary-directory names.
    const cwd = path.join(os.tmpdir(), 'vibisual-main_thread-sweep.test');
    const sid = 'mainsweep-0000-0000-0000-000000000001';
    const file = path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[/\\:._]/g, '-'), `${sid}.jsonl`);
    __resetSessionCachesForTest();
    try {
      expect(readContextInfo(cwd, sid)).toBeNull();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-5', content: [], usage: { input_tokens: 42, output_tokens: 1 } },
      })}\n`);
      expect(readContextInfo(cwd, sid)?.contextUsed).toBe(42);
    } finally {
      __resetSessionCachesForTest();
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

describe('파일 존재 스윕 — 메인 스레드 밖에서 돌아도 ghost 판정은 같다', () => {
  let root: string;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-exist-sweep-'))); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const hook = (file: string): HookEventPayload => (
    { session_id: 'cli-sweep', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file }, cwd: root } as HookEventPayload
  );
  const nodeType = (graph: ProjectGraph, projectName: string, label: string): string | undefined =>
    Object.values(graph.toProjectCheckpoint(projectName).graph.nodes)
      .find((n) => n.label.toLowerCase() === label.toLowerCase())?.bubbleType;

  it('연속으로 없을 때만 ghost 가 되고, 있는 파일은 그대로다', async () => {
    const graph = new ProjectGraph();
    const projectName = graph.registerProject(root).name;
    const gone = path.join(root, 'gone.ts');
    const kept = path.join(root, 'kept.ts');
    fs.writeFileSync(gone, 'x');
    fs.writeFileSync(kept, 'x');
    graph.processHookEvent(hook(gone));
    graph.processHookEvent(hook(kept));
    fs.rmSync(gone);

    for (let i = 1; i < FILE_EXISTENCE_MISS_THRESHOLD; i++) {
      expect(await graph.checkFileExistence()).toBe(0);
      expect(nodeType(graph, projectName, 'gone.ts')).not.toBe('ghost');
    }
    expect(await graph.checkFileExistence()).toBe(1);
    expect(nodeType(graph, projectName, 'gone.ts')).toBe('ghost');
    expect(nodeType(graph, projectName, 'kept.ts')).toBe('file');
  });
});
