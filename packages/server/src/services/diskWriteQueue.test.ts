import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeFileAtomicSyncRaw,
  queueAtomicWrite,
  flushPendingDiskWritesSync,
  enableAsyncDiskWrites,
  shutdownDiskWriteQueue,
  isAsyncDiskWriteEnabled,
  getDiskWriteQueueStats,
} from './diskWriteQueue.js';
import { ProjectGraph } from './projectGraph.js';
import { writeCheckpoint, discoverProjectMetas, loadCheckpointByMeta } from './statePersistence.js';

/**
 * §9 "디스크 쓰기는 워커 스레드로" — **워커 경로와 동기 경로가 같은 결과를 낸다**는 것을 못 박는다.
 *
 * 이 큐가 건드리는 것은 체크포인트의 마지막 커밋 지점이라, 조용히 어긋나면 증상이 "가끔 옛날
 * 내용으로 되돌아간다"로 나타난다 — 사람 눈으로 재현하기 가장 어려운 부류다. 그래서 규약을
 * 테스트로 고정한다:
 *  1. 워커가 꺼져 있으면 큐는 **받지 않는다**(호출자가 동기로 쓴다) — 정확성 경로가 아니다.
 *  2. 워커가 켜져 있으면 넘긴 내용이 그대로 디스크에 앉는다.
 *  3. 아직 안 앉은 것은 `flushPendingDiskWritesSync()` 가 **동기로** 마무리한다(종료 경로).
 */

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-diskq-'));
  tmpDirs.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

afterEach(() => {
  shutdownDiskWriteQueue();
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('diskWriteQueue — 동기 쓰기(기본 경로)', () => {
  it('원자적 쓰기는 임시 파일을 남기지 않고 내용을 앉힌다', () => {
    const dir = makeTmpDir();
    const target = path.join(dir, 'checkpoint.json');
    writeFileAtomicSyncRaw(target, '{"a":1}');

    expect(fs.readFileSync(target, 'utf8')).toBe('{"a":1}');
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it('워커를 켜지 않았으면 큐는 작업을 받지 않는다(호출자가 동기로 써야 한다)', () => {
    const dir = makeTmpDir();
    expect(isAsyncDiskWriteEnabled()).toBe(false);
    expect(queueAtomicWrite(path.join(dir, 'x.json'), '{}')).toBe(false);
  });
});

describe('diskWriteQueue — 워커 경로', () => {
  it('워커에 넘긴 쓰기가 동기 경로와 같은 내용으로 앉는다', async () => {
    const dir = makeTmpDir();
    const viaWorker = path.join(dir, 'worker.json');
    const viaSync = path.join(dir, 'sync.json');
    const payload = JSON.stringify({ project: 'demo', nodes: [1, 2, 3], text: '한글 · emoji 없이' });

    enableAsyncDiskWrites();
    expect(isAsyncDiskWriteEnabled()).toBe(true);
    expect(queueAtomicWrite(viaWorker, payload)).toBe(true);
    writeFileAtomicSyncRaw(viaSync, payload);

    const landed = await waitFor(() => fs.existsSync(viaWorker));
    expect(landed).toBe(true);
    expect(fs.readFileSync(viaWorker, 'utf8')).toBe(fs.readFileSync(viaSync, 'utf8'));
    // 임시 파일이 남으면 다음 저장이 그 찌꺼기를 밟는다.
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('같은 파일에 여러 번 쓰면 마지막 내용이 남는다(FIFO 순서 보존)', async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, 'seq.json');

    enableAsyncDiskWrites();
    for (let i = 1; i <= 5; i += 1) {
      expect(queueAtomicWrite(target, `{"seq":${i}}`)).toBe(true);
    }
    const drained = await waitFor(() => getDiskWriteQueueStats().pending === 0);
    expect(drained).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"seq":5}');
  });

  it('아직 안 앉은 쓰기는 flush 가 동기로 마무리한다(종료 경로)', () => {
    const dir = makeTmpDir();
    const target = path.join(dir, 'pending.json');

    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"pending":true}')).toBe(true);
    // 워커에 기회를 주지 않고 곧바로 종료 flush — 이 시점의 pending 을 메인이 직접 쓴다.
    flushPendingDiskWritesSync();

    expect(fs.readFileSync(target, 'utf8')).toBe('{"pending":true}');
    expect(getDiskWriteQueueStats().pending).toBe(0);
  });

  it('체크포인트를 워커로 저장한 직후 읽어도 방금 내용이 보인다(읽기 전 flush)', () => {
    const dir = makeTmpDir();
    const graph = new ProjectGraph();
    const info = graph.registerProject(dir);
    graph.createCustomAgent('Worker Roundtrip', undefined, info.name);

    enableAsyncDiskWrites();
    writeCheckpoint(graph.toProjectCheckpoint(info.name));

    // 워커가 아직 못 앉혔을 수 있는 시점에 곧바로 읽는다 — 읽기 경로가 flush 를 걸어 두지 않으면
    // 여기서 "방금 저장한 에이전트가 없는" 옛 파일(또는 파일 없음)을 보게 된다.
    const metas = discoverProjectMetas([dir]);
    expect(metas.length).toBe(1);
    const restored = loadCheckpointByMeta(metas[0]!);
    expect(restored).not.toBeNull();
    const labels = Object.values(restored!.graph.agents).map((a) => a.label);
    expect(labels).toContain('Worker Roundtrip');
  });

  it('디렉토리가 없으면 큐가 받지 않는다(가드는 메인에 있고 워커는 폴더를 만들지 않는다)', () => {
    const dir = makeTmpDir();
    enableAsyncDiskWrites();
    const missing = path.join(dir, 'no-such-dir', 'a.json');
    expect(queueAtomicWrite(missing, '{}')).toBe(false);
  });
});
