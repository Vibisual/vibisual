import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_EXPORT_SETTINGS } from '../exportSettings.js';
import { specFromSettings, type RenderOutputSpec, type RenderSpec } from '../renderSpec.js';
import { applyPatch, createEmptyDoc } from '../ops.js';
import type { VideoDoc } from '../types.js';
import { placeRenderOutput, type PlaceInput } from './exportOutput.js';

/**
 * §5.13 (AA) 42-2 — 결과 놓기를 **실제 파일 시스템**에서 잰다(이 시험이 도는 OS 의 링크·복사·이름 규칙 — CI 매트릭스가 세 OS 를 돈다).
 */

let root: string;
let outDir: string;
let exportDir: string;
const at = new Date(2026, 9, 17, 9, 5, 7);

function docWithCaptions(): VideoDoc {
  const d = createEmptyDoc('vid-1', '내 영상', 1);
  const r = applyPatch(d, { baseVersion: d.version, ops: [
    { op: 'addItem', trackId: 'caption', item: { id: 'c', kind: 'caption', at: 0, duration: 4, cues: [{ start: 0.5, end: 1.5, text: '안녕' }] } },
  ] }, 2);
  if (!r.ok) throw new Error('setup');
  return r.doc;
}

function output(extra: Partial<RenderOutputSpec> = {}): RenderOutputSpec {
  return {
    dir: exportDir, fileName: '{title}', conflict: 'number', after: DEFAULT_EXPORT_SETTINGS.after, keepAwake: true,
    scene: null, index: null, notice: null, ...extra,
  };
}

function input(extra: Partial<PlaceInput> = {}): PlaceInput {
  return {
    outDir, docId: 'vid-1', title: null, spec: specFromSettings(DEFAULT_EXPORT_SETTINGS), output: output(),
    legacyExt: 'mp4', bytes: new Uint8Array([1, 2, 3, 4]), doc: docWithCaptions(), now: at, ...extra,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-export-'));
  outDir = path.join(root, '.vibisual', 'video', 'out');
  exportDir = path.join(root, 'exports');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('placeRenderOutput — 42-2', () => {
  it('설정 없는 종전 일감은 종전 자리·종전 이름 그대로', async () => {
    const placed = await placeRenderOutput(input({ spec: null, output: null }), 'win32');
    expect(path.dirname(placed.result)).toBe(outDir);
    expect(path.basename(placed.result)).toBe(`vid-1-${at.getTime()}.mp4`);
    expect(placed.exported).toBe(placed.result);
    expect(placed.exportNote).toBeUndefined();
  });

  it('종전 자리에 이름 규칙대로 쓰고, 고른 폴더에도 같은 이름으로 놓는다(내용이 같다)', async () => {
    const placed = await placeRenderOutput(input(), process.platform);
    expect(placed.result).toBe(path.join(outDir, '내 영상.mp4'));
    expect(placed.exported).toBe(path.join(exportDir, '내 영상.mp4'));
    expect(fs.readFileSync(placed.exported)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fs.readFileSync(placed.result)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('같은 이름이 있으면 번호를 붙인다(종전 자리도 고른 폴더도 덮지 않는다)', async () => {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, '내 영상.mp4'), 'old');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, '내 영상.mp4'), 'older');
    const placed = await placeRenderOutput(input(), process.platform);
    expect(path.basename(placed.result)).toBe('내 영상 (2).mp4');
    expect(path.basename(placed.exported)).toBe('내 영상 (2).mp4');
    expect(fs.readFileSync(path.join(exportDir, '내 영상.mp4'), 'utf8')).toBe('old');
  });

  it('덮어쓰기를 고르면 고른 폴더의 같은 이름을 바꾼다(종전 자리는 늘 번호 — 판 기록이 옛 파일을 가리킨다)', async () => {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, '내 영상.mp4'), 'old');
    const placed = await placeRenderOutput(input({ output: output({ conflict: 'overwrite' }) }), process.platform);
    expect(placed.exported).toBe(path.join(exportDir, '내 영상.mp4'));
    expect(fs.readFileSync(placed.exported)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(placed.exportNote).toBeUndefined();
  });

  it('자막 따로 내기면 같은 이름의 SRT 를 양쪽에 둔다', async () => {
    const spec: RenderSpec = { ...specFromSettings(DEFAULT_EXPORT_SETTINGS), captions: 'separate' };
    const placed = await placeRenderOutput(input({ spec }), process.platform);
    const srt = fs.readFileSync(path.join(exportDir, '내 영상.srt'), 'utf8');
    expect(srt).toContain('안녕');
    expect(fs.existsSync(path.join(outDir, '내 영상.srt'))).toBe(true);
    expect(placed.exported.endsWith('.mp4')).toBe(true);
  });

  it('소리만이면 .wav', async () => {
    const spec: RenderSpec = { ...specFromSettings(DEFAULT_EXPORT_SETTINGS), format: 'wav' };
    const placed = await placeRenderOutput(input({ spec }), process.platform);
    expect(placed.exported).toBe(path.join(exportDir, '내 영상.wav'));
  });

  it('상대 경로 폴더는 받지 않고 그 사실을 남긴다(종전 자리에는 남는다)', async () => {
    const placed = await placeRenderOutput(input({ output: output({ dir: 'relative/out' }) }), process.platform);
    expect(placed.exported).toBe(placed.result);
    expect(placed.exportNote?.code).toBe('export-failed');
    expect(fs.existsSync(placed.result)).toBe(true);
  });

  it('고른 폴더가 종전 자리와 같으면 두 벌을 만들지 않는다 — Windows 는 대소문자를 접어 같다고 본다', async () => {
    const placed = await placeRenderOutput(input({ output: output({ dir: outDir.toUpperCase() }) }), 'win32');
    expect(placed.exported).toBe(placed.result);
    expect(fs.readdirSync(outDir).filter((f) => f.endsWith('.mp4'))).toEqual(['내 영상.mp4']);
  });
});
