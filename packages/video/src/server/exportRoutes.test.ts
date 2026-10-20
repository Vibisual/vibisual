import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountVideoRoutes, videoService } from './routes.js';

/** §5.13 (AA) 42 — 렌더 대기열·내보내기 설정 경로(실제 Express · 임시 프로젝트). 에이전트(루프백 유입)는 사람의 결정을 대신하지 못한다. */

let root: string;
let server: Server;
let base: string;
const AGENT = { 'x-vibisual-ingress': 'loopback' };

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-export-'));
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: (name) => (name === 'test' ? root : null),
    // 실제 호스트의 원자적 쓰기처럼 폴더를 만들어 준다(문서를 새로 만드는 시험이라).
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
    info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function newDoc(): Promise<string> {
  const res = await post('/docs', { project: 'test', title: 'Clip' });
  return ((await res.json()) as { doc: { id: string } }).doc.id;
}

async function render(docId: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return post(`/doc/${docId}/render`, { project: 'test', ...body }, headers);
}

describe('render queue routes — 42-5·42-9', () => {
  it('에이전트는 저장 위치·덮어쓰기를 정할 수 없고, 화면에 띄우는 일(알림·폴더 열기·절전·노드 담기)은 꺼진다', async () => {
    const docId = await newDoc();
    expect((await render(docId, { output: { dir: root, fileName: '{title}' } }, AGENT)).status).toBe(403);
    expect((await render(docId, { output: { fileName: '{title}', conflict: 'overwrite' } }, AGENT)).status).toBe(403);
    const ok = await render(docId, { output: { fileName: '{title}', after: { reveal: true, notify: true, deliver: true }, keepAwake: true, notice: { done: 'a', failed: 'b' } } }, AGENT);
    expect(ok.status).toBe(200);
    const job = ((await ok.json()) as { job: { output: { after: unknown; keepAwake: boolean; notice: unknown } } }).job;
    expect(job.output).toMatchObject({ after: { reveal: false, notify: false, deliver: false }, keepAwake: false, notice: null });
  });

  it('상대 경로 저장 위치는 400', async () => {
    const docId = await newDoc();
    expect((await render(docId, { output: { dir: 'relative/out', fileName: '{title}' } })).status).toBe(400);
  });

  it('대기열 조작은 사람만 — 에이전트 403', async () => {
    const docId = await newDoc();
    const job = ((await (await render(docId, {})).json()) as { job: { id: string } }).job;
    expect((await post(`/job/${job.id}/control`, { action: 'cancel' }, AGENT)).status).toBe(403);
    expect((await post('/jobs/control', { project: 'test', action: 'cancel-all' }, AGENT)).status).toBe(403);
    expect((await fetch(`${base}/export-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...AGENT }, body: JSON.stringify({ project: 'test', settings: {} }) })).status).toBe(403);
  });

  it('멈춘 채 걸면 집히지 않고, 지금 시작하면 집힌다 · 예약은 그 시각 전까지 집히지 않는다', async () => {
    const docId = await newDoc();
    const held = ((await (await render(docId, { schedule: { hold: true }, spec: { format: 'mp4' } })).json()) as { job: { id: string; held: boolean } }).job;
    expect(held.held).toBe(true);
    const later = ((await (await render(docId, { schedule: { at: Date.now() + 3_600_000 } })).json()) as { job: { id: string; notBefore: number } }).job;
    expect(later.notBefore).toBeGreaterThan(Date.now());
    expect(videoService.claimNext(root, 'render')).toBeNull();
    expect((await post(`/job/${held.id}/control`, { action: 'start-now' })).status).toBe(200);
    expect(videoService.claimNext(root, 'render')?.id).toBe(held.id);
    expect(videoService.claimNext(root, 'render')).toBeNull();
  });

  it('도는 렌더의 일시정지·재개·취소 — 끝난 뒤 늦은 오류 보고는 "취소됨" 을 덮지 않는다', async () => {
    const docId = await newDoc();
    const job = ((await (await render(docId, {})).json()) as { job: { id: string } }).job;
    expect(videoService.claimNext(root, 'render')?.id).toBe(job.id);
    expect(((await (await post(`/job/${job.id}/control`, { action: 'pause' })).json()) as { job: { paused: boolean } }).job.paused).toBe(true);
    expect(((await (await post(`/job/${job.id}/control`, { action: 'resume' })).json()) as { job: { paused: boolean } }).job.paused).toBe(false);
    expect((await post(`/job/${job.id}/control`, { action: 'cancel' })).status).toBe(200);
    videoService.updateJob(job.id, { status: 'error', error: 'aborted' });
    expect(videoService.getJob(job.id)?.status).toBe('canceled');
    const output = await fetch(`${base}/job/${job.id}/output`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([1]) });
    expect(output.status).toBe(409);
  });

  it('줄 순서 — 위로 옮긴 일감이 먼저 집힌다', async () => {
    const docId = await newDoc();
    const first = ((await (await render(docId, { schedule: { hold: true } })).json()) as { job: { id: string } }).job;
    const second = ((await (await render(docId, { schedule: { hold: true } })).json()) as { job: { id: string } }).job;
    expect((await post(`/job/${second.id}/control`, { action: 'move-up' })).status).toBe(200);
    expect((await post('/jobs/control', { project: 'test', action: 'start-all' })).status).toBe(200);
    expect(videoService.claimNext(root, 'render')?.id).toBe(second.id);
    expect(videoService.getJob(first.id)?.status).toBe('queued');
  });

  it('대기열은 프로젝트 안 파일에 적힌다(진행률은 적지 않는다) · 목록은 렌더만', async () => {
    const docId = await newDoc();
    const job = ((await (await render(docId, { label: '쇼츠' })).json()) as { job: { id: string } }).job;
    const file = path.join(root, '.vibisual', 'video', 'render-queue.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { jobs: Array<{ id: string; label: string; progress: number }> };
    expect(saved.jobs.find((j) => j.id === job.id)).toMatchObject({ label: '쇼츠', progress: 0 });
    const listed = (await (await fetch(`${base}/jobs?project=test&kind=render`)).json()) as { jobs: Array<{ kind: string }> };
    expect(listed.jobs.every((j) => j.kind === 'render')).toBe(true);
  });
});

describe('export settings routes — 42-1', () => {
  it('없으면 기본값 · 저장한 것은 다시 읽힌다 · 상대 경로 폴더는 기본 자리로', async () => {
    const first = (await (await fetch(`${base}/export-settings?project=test`)).json()) as { last: { format: string; outputDir: string | null } };
    expect(first.last).toMatchObject({ format: 'mp4', outputDir: null });
    const put = await fetch(`${base}/export-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'test', settings: { format: 'webm', fps: 24, outputDir: 'relative' } }) });
    expect(put.status).toBe(200);
    const again = (await (await fetch(`${base}/export-settings?project=test`)).json()) as { last: { format: string; fps: number; outputDir: string | null } };
    expect(again.last).toMatchObject({ format: 'webm', fps: 24, outputDir: null });
  });

  it('내 프리셋 — 같은 이름이면 덮고, 지울 수 있다', async () => {
    const saved = (await (await post('/export-presets', { project: 'test', name: '쇼츠 빠르게', settings: { quality: 'low' } })).json()) as { presets: Array<{ id: string; name: string }> };
    expect(saved.presets.map((p) => p.name)).toEqual(['쇼츠 빠르게']);
    const again = (await (await post('/export-presets', { project: 'test', name: '쇼츠 빠르게', settings: { quality: 'medium' } })).json()) as { presets: Array<{ id: string; settings: { quality: string } }> };
    expect(again.presets).toHaveLength(1);
    expect(again.presets[0]?.settings.quality).toBe('medium');
    const removed = await fetch(`${base}/export-presets/${again.presets[0]!.id}?project=test`, { method: 'DELETE' });
    expect(((await removed.json()) as { presets: unknown[] }).presets).toEqual([]);
  });
});
