import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_EXPORT_EXTRAS, DEFAULT_EXPORT_SETTINGS, type ExportExtras } from '../exportSettings.js';
import { thumbnailTime } from '../exportExtras.js';
import { createEmptyDoc } from '../ops.js';
import { normalizeRenderOutput, specFromSettings, type RenderOutputSpec } from '../renderSpec.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc } from '../types.js';
import { placeRenderOutput, type PlaceInput } from './exportOutput.js';
import { fromQueueRecord, toQueueRecord } from './queueRecord.js';
import { mountVideoRoutes, videoService } from './routes.js';

/**
 * §5.13 (AA) 42-13 — 함께 내기를 **실제 파일 시스템**과 실제 경로(가짜 일꾼)로 잰다: 어떤 이름으로 어디에 나오는가 · 묶음째 번호 ·
 * 고른 폴더 · 덮어쓰기 · 나오지 않은 까닭 · 대기열에 건 일감의 선택.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const ALL: ExportExtras = { thumbnail: true, chapters: true, subtitles: true };

let root: string;
let outDir: string;
let exportDir: string;
const at = new Date(2026, 10, 12, 9, 5, 7);

/** 장면 둘 · 자막 큐 하나 · 글자 아이템 하나. `bare` 면 장면·자막이 없다. */
function docOf(id: string, title: string, bare = false): VideoDoc {
  const seed = createEmptyDoc(id, title, 1);
  if (bare) return { ...seed, tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 'a', kind: 'text', at: 0, duration: 10, props: { text: 'hi' } }] }] };
  return {
    ...seed,
    chapters: [
      { id: 'ch-1', title: 'Intro', duration: 4, status: 'done' },
      { id: 'ch-2', title: '', duration: 6, status: 'done' },
    ],
    tracks: [
      { id: 'visual', kind: 'visual', items: [{ id: 'a', kind: 'text', at: 0, duration: 10, props: { text: 'hi' } }] },
      { id: 'caption', kind: 'caption', items: [{ id: 'c', kind: 'caption', at: 0, duration: 10, cues: [{ start: 0.5, end: 1.5, text: 'Hello' }] }] },
    ],
  };
}

function output(extra: Partial<RenderOutputSpec> = {}): RenderOutputSpec {
  return { ...normalizeRenderOutput({ fileName: '{title}', chapterLabel: 'Scene {n}' }), extras: ALL, ...extra };
}

function input(extra: Partial<PlaceInput> = {}): PlaceInput {
  return {
    outDir, docId: 'vid-1', title: null, spec: specFromSettings(DEFAULT_EXPORT_SETTINGS), output: output(),
    legacyExt: 'mp4', bytes: new Uint8Array([1, 2, 3, 4]), doc: docOf('vid-1', 'Launch'), now: at, thumbnail: PNG, ...extra,
  } as PlaceInput;
}

function names(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-extras-'));
  outDir = path.join(root, '.vibisual', 'video', 'out');
  exportDir = path.join(root, 'exports');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('placeRenderOutput — 42-13 함께 내기', () => {
  it('켠 항목마다 영상과 같은 줄기·같은 자리에 선다', async () => {
    const placed = await placeRenderOutput(input(), process.platform);
    expect(names(outDir)).toEqual(['Launch.chapters.txt', 'Launch.mp4', 'Launch.png', 'Launch.srt']);
    expect(placed.companions).toEqual({
      subtitles: path.join(outDir, 'Launch.srt'),
      thumbnail: path.join(outDir, 'Launch.png'),
      chapters: path.join(outDir, 'Launch.chapters.txt'),
    });
    expect(placed.companionNotes).toBeUndefined();
    expect(fs.readFileSync(path.join(outDir, 'Launch.png')).equals(PNG)).toBe(true);
    expect(fs.readFileSync(path.join(outDir, 'Launch.chapters.txt'), 'utf8')).toBe('00:00 Intro\n00:04 Scene 2\n');
    expect(fs.readFileSync(path.join(outDir, 'Launch.srt'), 'utf8')).toContain('00:00:00,500 --> 00:00:01,500\nHello');
  });

  it('모두 끄면 영상 하나만 나온다(종전 그대로)', async () => {
    const placed = await placeRenderOutput(input({ output: output({ extras: DEFAULT_EXPORT_EXTRAS }) }), process.platform);
    expect(names(outDir)).toEqual(['Launch.mp4']);
    expect(placed.companions).toBeUndefined();
    expect(placed.companionNotes).toBeUndefined();
  });

  it.each([
    ['thumbnail', 'Launch.png'],
    ['chapters', 'Launch.chapters.txt'],
    ['subtitles', 'Launch.srt'],
  ] as const)('%s 만 켜면 그 파일 하나만 더 나온다', async (kind, file) => {
    const placed = await placeRenderOutput(input({ output: output({ extras: { ...DEFAULT_EXPORT_EXTRAS, [kind]: true } }) }), process.platform);
    expect(names(outDir)).toEqual(['Launch.mp4', file].sort());
    expect(placed.companions).toEqual({ [kind]: path.join(outDir, file) });
  });

  it('고른 폴더에는 묶음 전체가 같은 이름으로 함께 놓인다(사용자가 보는 자리는 그 폴더)', async () => {
    const placed = await placeRenderOutput(input({ output: output({ dir: exportDir }) }), process.platform);
    expect(names(exportDir)).toEqual(['Launch.chapters.txt', 'Launch.mp4', 'Launch.png', 'Launch.srt']);
    expect(names(outDir)).toEqual(names(exportDir));
    expect(placed.exported).toBe(path.join(exportDir, 'Launch.mp4'));
    expect(placed.companions?.thumbnail).toBe(path.join(exportDir, 'Launch.png'));
    expect(placed.companions?.chapters).toBe(path.join(exportDir, 'Launch.chapters.txt'));
    expect(fs.readFileSync(path.join(exportDir, 'Launch.png')).equals(PNG)).toBe(true);
  });

  it('딸림 파일 이름 하나만 먼저 있어도 묶음 전체가 같은 다음 번호로 간다', async () => {
    fs.mkdirSync(exportDir, { recursive: true });
    const old = path.join(exportDir, 'Launch.png');
    fs.writeFileSync(old, 'OLD THUMBNAIL');
    const placed = await placeRenderOutput(input({ output: output({ dir: exportDir }) }), process.platform);
    expect(path.basename(placed.exported)).toBe('Launch (2).mp4');
    expect(names(exportDir)).toEqual(['Launch (2).chapters.txt', 'Launch (2).mp4', 'Launch (2).png', 'Launch (2).srt', 'Launch.png']);
    expect(fs.readFileSync(old, 'utf8')).toBe('OLD THUMBNAIL');
  });

  it('두 번 내면 앞 묶음을 건드리지 않고 다음 번호의 묶음이 선다', async () => {
    await placeRenderOutput(input({ thumbnail: Buffer.concat([PNG, Buffer.from('first')]) }), process.platform);
    const second = await placeRenderOutput(input(), process.platform);
    expect(path.basename(second.result)).toBe('Launch (2).mp4');
    expect(names(outDir)).toHaveLength(8);
    expect(fs.readFileSync(path.join(outDir, 'Launch.png')).toString()).toContain('first');
    expect(fs.readFileSync(path.join(outDir, 'Launch (2).png')).equals(PNG)).toBe(true);
  });

  it('덮어쓰기는 고른 폴더의 묶음 전체를 바꾸고 종전 자리의 앞 묶음은 그대로 둔다', async () => {
    const first = await placeRenderOutput(input({ output: output({ dir: exportDir }), thumbnail: Buffer.concat([PNG, Buffer.from('first')]) }), process.platform);
    const second = await placeRenderOutput(input({ output: output({ dir: exportDir, conflict: 'overwrite' }) }), process.platform);
    expect(second.exported).toBe(first.exported);
    expect(names(exportDir)).toEqual(['Launch.chapters.txt', 'Launch.mp4', 'Launch.png', 'Launch.srt']);
    expect(fs.readFileSync(path.join(exportDir, 'Launch.png')).equals(PNG)).toBe(true);
    expect(fs.readFileSync(path.join(outDir, 'Launch.png')).toString()).toContain('first');
    expect(second.exportNote).toBeUndefined();
  });

  it('낼 것이 없으면 빈 파일을 만들지 않고 까닭을 남긴다 — 렌더는 그대로 성공', async () => {
    const placed = await placeRenderOutput(input({ doc: docOf('vid-1', 'Launch', true), thumbnail: null }), process.platform);
    expect(names(outDir)).toEqual(['Launch.mp4']);
    expect(placed.companions).toBeUndefined();
    expect(placed.companionNotes).toEqual(['subtitles-empty', 'thumbnail-failed', 'chapters-empty']);
    expect(placed.exportNote).toBeUndefined();
  });

  it('구간 렌더의 챕터 목록·자막은 그 구간의 시각으로 적힌다', async () => {
    const spec = { ...specFromSettings(DEFAULT_EXPORT_SETTINGS), range: { start: 1, end: 8 } };
    await placeRenderOutput(input({ spec }), process.platform);
    expect(fs.readFileSync(path.join(outDir, 'Launch.chapters.txt'), 'utf8')).toBe('00:00 Intro\n00:03 Scene 2\n');
    expect(fs.readFileSync(path.join(outDir, 'Launch.srt'), 'utf8')).toContain('00:00:00,000 --> 00:00:00,500');
  });

  it('자막 따로 내기는 체크가 꺼져 있어도 SRT 를 내고, 켜져 있어도 한 번만 쓴다', async () => {
    const spec = { ...specFromSettings(DEFAULT_EXPORT_SETTINGS), captions: 'separate' as const };
    await placeRenderOutput(input({ spec, output: output({ extras: DEFAULT_EXPORT_EXTRAS }) }), process.platform);
    expect(names(outDir)).toEqual(['Launch.mp4', 'Launch.srt']);
    const both = await placeRenderOutput(input({ spec, output: output({ extras: { ...DEFAULT_EXPORT_EXTRAS, subtitles: true } }) }), process.platform);
    expect(Object.keys(both.companions ?? {})).toEqual(['subtitles']);
    expect(names(outDir)).toEqual(['Launch (2).mp4', 'Launch (2).srt', 'Launch.mp4', 'Launch.srt']);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s — 이름에 못 쓰는 글자가 든 제목도 묶음 전체가 같은 다듬은 줄기를 쓴다', async (platform) => {
    const placed = await placeRenderOutput(input({ doc: docOf('vid-1', 'A/B: "C"?') }), platform);
    expect(path.basename(placed.result)).toBe('A_B_ _C__.mp4');
    expect(names(outDir)).toEqual(['A_B_ _C__.chapters.txt', 'A_B_ _C__.mp4', 'A_B_ _C__.png', 'A_B_ _C__.srt']);
  });
});

describe('대기열 기록 — 42-13 선택과 결과가 껐다 켠 뒤에도 남는다', () => {
  it('걸어 둔 일감의 선택·썸네일 시각·이름틀과, 끝난 줄의 딸림 파일 자리·까닭', () => {
    const base = { id: 'job-1', kind: 'render', projectPath: root, docId: 'vid-1', progress: 0, createdAt: 1, updatedAt: 1, order: 1 };
    const waiting = fromQueueRecord(toQueueRecord({ ...base, status: 'queued', held: true, heldReason: 'user', output: output({ thumbnailAt: 3.5 }) }), root, 10);
    expect(waiting?.output).toMatchObject({ extras: ALL, thumbnailAt: 3.5, chapterLabel: 'Scene {n}' });
    const done = fromQueueRecord(toQueueRecord({
      ...base, status: 'done', progress: 1, output: output(),
      companions: { thumbnail: path.join(outDir, 'Launch.png') }, companionNotes: ['chapters-empty'],
    }), root, 10);
    expect(done?.companions).toEqual({ thumbnail: path.join(outDir, 'Launch.png') });
    expect(done?.companionNotes).toEqual(['chapters-empty']);
  });

  it('모르는 종류·까닭은 버린다', () => {
    const job = fromQueueRecord({
      id: 'job-2', docId: 'vid-1', status: 'done', companions: { gif: 'x.gif', thumbnail: 7 }, companionNotes: ['boom', 'thumbnail-failed'],
    }, root, 10);
    expect(job?.companions).toBeUndefined();
    expect(job?.companionNotes).toEqual(['thumbnail-failed']);
  });
});

describe('렌더 경로 — 42-13 썸네일은 종전 스틸 길로(가짜 일꾼)', () => {
  let server: Server;
  let base: string;
  const AGENT = { 'x-vibisual-ingress': 'loopback' };

  beforeEach(async () => {
    const app = express(); app.use(express.json());
    mountVideoRoutes(app, {
      resolveProjectPath: (name) => (name === 'test' ? root : null),
      atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
      info: () => undefined, warn: () => undefined,
    });
    server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  interface JobView {
    id: string; status: string; held?: boolean; result?: string; exported?: string;
    output?: RenderOutputSpec; companions?: Record<string, string>; companionNotes?: string[];
  }

  async function render(docId: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<JobView> {
    const res = await fetch(`${base}/doc/${docId}/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ project: 'test', ...body }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { job: JobView }).job;
  }

  /** 렌더 줄의 일꾼 — 집어서 결과 바이트를 올린다(응답은 놓기가 끝나야 온다). */
  function upload(jobId: string): Promise<Response> {
    expect(videoService.claimNext(root, 'render')?.id).toBe(jobId);
    return fetch(`${base}/job/${jobId}/output`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('VIDEO') });
  }

  /** 스틸 줄의 일꾼 — 썸네일 스틸이 걸리기를 기다려 집는다. */
  async function claimStill(): Promise<NonNullable<ReturnType<typeof videoService.claimNext>>> {
    for (let i = 0; i < 300; i += 1) {
      const job = videoService.claimNext(root, 'still');
      if (job) return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('No thumbnail still was requested');
  }

  const spec = { format: 'mp4' };
  const outputBody = { fileName: '{title}', extras: ALL, thumbnailAt: 2.5, chapterLabel: 'Scene {n}' };

  it('켠 셋이 영상 옆에 같은 이름으로 나오고, 썸네일은 고른 시각의 원본 크기 스틸이다', async () => {
    videoService.writeDoc(root, docOf('launch', 'Launch'));
    const job = await render('launch', { spec, output: outputBody });
    const pending = upload(job.id);
    const still = await claimStill();
    expect(still).toMatchObject({ kind: 'still', docId: 'launch', t: 2.5, maxEdge: 0 });
    videoService.updateJob(still.id, { status: 'done', progress: 1, result: PNG_URL });
    const done = ((await (await pending).json()) as { job: JobView }).job;
    expect(done.status).toBe('done');
    expect(names(outDir)).toEqual(['Launch.chapters.txt', 'Launch.mp4', 'Launch.png', 'Launch.srt']);
    expect(done.companions).toEqual({
      subtitles: path.join(outDir, 'Launch.srt'),
      thumbnail: path.join(outDir, 'Launch.png'),
      chapters: path.join(outDir, 'Launch.chapters.txt'),
    });
    expect(fs.readFileSync(path.join(outDir, 'Launch.png')).equals(PNG)).toBe(true);
    expect(fs.readFileSync(path.join(outDir, 'Launch.mp4'), 'utf8')).toBe('VIDEO');
  });

  it('대기열에 멈춘 채 건 일감에도 같은 선택이 실리고, 시작하면 그 선택대로 나온다', async () => {
    videoService.writeDoc(root, docOf('queued', 'Queued'));
    const held = await render('queued', { spec, output: { ...outputBody, thumbnailAt: null }, schedule: { hold: true } });
    expect(held.held).toBe(true);
    expect(held.output).toMatchObject({ extras: ALL, thumbnailAt: null, chapterLabel: 'Scene {n}' });
    const saved = JSON.parse(fs.readFileSync(path.join(root, '.vibisual', 'video', 'render-queue.json'), 'utf8')) as unknown;
    expect(JSON.stringify(saved)).toContain('"extras":{"thumbnail":true,"chapters":true,"subtitles":true}');
    expect(videoService.claimNext(root, 'render')).toBeNull();
    expect(videoService.controlJob(held.id, 'start-now').status).toBe(200);
    const pending = upload(held.id);
    const still = await claimStill();
    // 고른 시각이 없으면 문서 갤러리 포스터와 같은 자리.
    expect(still.t).toBeCloseTo(thumbnailTime(null, resolveTimeline(docOf('queued', 'Queued')).duration));
    videoService.updateJob(still.id, { status: 'done', progress: 1, result: PNG_URL });
    expect(((await (await pending).json()) as { job: JobView }).job.status).toBe('done');
    expect(names(outDir)).toEqual(['Queued.chapters.txt', 'Queued.mp4', 'Queued.png', 'Queued.srt']);
  });

  it('스틸이 실패해도 렌더는 성공이고 까닭이 일감에 남는다(나머지 딸림 파일은 나온다)', async () => {
    videoService.writeDoc(root, docOf('nostill', 'NoStill'));
    const job = await render('nostill', { spec, output: outputBody });
    const pending = upload(job.id);
    const still = await claimStill();
    videoService.updateJob(still.id, { status: 'error', error: 'stage failed' });
    const done = ((await (await pending).json()) as { job: JobView }).job;
    expect(done.status).toBe('done');
    expect(done.companionNotes).toEqual(['thumbnail-failed']);
    expect(names(outDir)).toEqual(['NoStill.chapters.txt', 'NoStill.mp4', 'NoStill.srt']);
  });

  it('PNG 가 아닌 스틸 결과는 썸네일로 쓰지 않는다', async () => {
    videoService.writeDoc(root, docOf('webp', 'Webp'));
    const job = await render('webp', { spec, output: { ...outputBody, extras: { thumbnail: true } } });
    const pending = upload(job.id);
    const still = await claimStill();
    videoService.updateJob(still.id, { status: 'done', progress: 1, result: `data:image/webp;base64,${Buffer.from('x').toString('base64')}` });
    const done = ((await (await pending).json()) as { job: JobView }).job;
    expect(done.companionNotes).toEqual(['thumbnail-failed']);
    expect(names(outDir)).toEqual(['Webp.mp4']);
  });

  it('스틸을 기다리는 동안 취소하면 아무 파일도 놓지 않는다', async () => {
    videoService.writeDoc(root, docOf('cancel', 'Cancel'));
    const job = await render('cancel', { spec, output: outputBody });
    const pending = upload(job.id);
    const still = await claimStill();
    expect(videoService.controlJob(job.id, 'cancel').status).toBe(200);
    videoService.updateJob(still.id, { status: 'done', progress: 1, result: PNG_URL });
    expect((await pending).status).toBe(409);
    expect(names(outDir).filter((name) => !name.startsWith('.'))).toEqual([]);
  });

  it('썸네일을 끄면 스틸 일감을 걸지 않는다', async () => {
    videoService.writeDoc(root, docOf('nothumb', 'NoThumb'));
    const job = await render('nothumb', { spec, output: { ...outputBody, extras: { chapters: true } } });
    const done = ((await (await upload(job.id)).json()) as { job: JobView }).job;
    expect(done.status).toBe('done');
    expect(videoService.listJobs(root, 'still')).toHaveLength(0);
    expect(names(outDir)).toEqual(['NoThumb.chapters.txt', 'NoThumb.mp4']);
  });

  it('에이전트가 건 렌더도 기본 자리에 함께 낼 수 있다(저장 위치·덮어쓰기는 여전히 못 정한다)', async () => {
    videoService.writeDoc(root, docOf('agent', 'Agent'));
    const job = await render('agent', { spec, output: { ...outputBody, extras: { chapters: true } } }, AGENT);
    expect(job.output).toMatchObject({ dir: null, conflict: 'number', extras: { thumbnail: false, chapters: true, subtitles: false } });
    const refused = await fetch(`${base}/doc/agent/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...AGENT },
      body: JSON.stringify({ project: 'test', spec, output: { ...outputBody, dir: exportDir } }),
    });
    expect(refused.status).toBe(403);
  });
});
