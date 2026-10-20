import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS } from '../exportSettings.js';
import { specFromSettings, type RenderSpec } from '../renderSpec.js';
import { applyPatch, createEmptyDoc } from '../ops.js';
import { placeRenderOutput, type PlaceInput, type PlaceResult } from './exportOutput.js';
import { linkOrCopy, placeNumberedPair, subtitlePath, writeNewFile } from './exportOutputFiles.js';

let root: string;
let outDir: string;
let exportDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-output-pair-'));
  outDir = path.join(root, 'canonical');
  exportDir = path.join(root, 'exports');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function input(text: string, format: RenderSpec['format'] = 'mp4', extra: Partial<PlaceInput> = {}): PlaceInput {
  const doc = createEmptyDoc('demo', 'Demo', 1);
  const edited = applyPatch(doc, { baseVersion: doc.version, ops: [{ op: 'addItem', trackId: 'caption',
    item: { id: 'c', kind: 'caption', at: 0, duration: 3, cues: [{ start: 0, end: 2, text }] },
  }] }, 2);
  if (!edited.ok) throw new Error('Invalid test document');
  return {
    outDir, docId: doc.id, title: doc.title, doc: edited.doc,
    spec: { ...specFromSettings(DEFAULT_EXPORT_SETTINGS), format, captions: 'separate' },
    output: { dir: exportDir, fileName: '{title}', conflict: 'number', after: DEFAULT_EXPORT_SETTINGS.after,
      keepAwake: false, scene: null, index: null, notice: null },
    legacyExt: 'mp4', bytes: Buffer.from(text), now: new Date(2026, 9, 18), ...extra,
  };
}

function expectPair(result: PlaceResult, text: string): void {
  for (const file of new Set([result.result, result.exported])) {
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    expect(fs.readFileSync(subtitlePath(file), 'utf8')).toContain(text);
  }
  expect(result.exportNote).toBeUndefined();
}

describe('video and subtitle output names preserve earlier exports', () => {
  it('WebM 뒤 MP4를 내도 이전 자막과 하드링크된 외부 자막을 덮지 않는다', async () => {
    const first = await placeRenderOutput(input('FIRST CAPTION', 'webm'), process.platform);
    const second = await placeRenderOutput(input('SECOND CAPTION'), process.platform);
    expect(path.basename(first.result)).toBe('Demo.webm');
    expect(path.basename(second.result)).toBe('Demo (2).mp4');
    expect(path.basename(second.exported)).toBe('Demo (2).mp4');
    expectPair(first, 'FIRST CAPTION');
    expectPair(second, 'SECOND CAPTION');
  });

  it.each(['canonical', 'external'])('%s 폴더에 자막만 있어도 영상과 자막을 함께 다음 번호로 쓴다', async (where) => {
    const dir = where === 'canonical' ? outDir : exportDir;
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'Demo.srt');
    fs.writeFileSync(old, 'PREEXISTING SUBTITLE');
    const result = await placeRenderOutput(input('NEW CAPTION'), process.platform);
    expect(path.basename(where === 'canonical' ? result.result : result.exported)).toBe('Demo (2).mp4');
    expect(fs.readFileSync(old, 'utf8')).toBe('PREEXISTING SUBTITLE');
    expectPair(result, 'NEW CAPTION');
  });

  it('고른 폴더가 종전 자리여도 한 쌍씩 번호를 붙인다', async () => {
    exportDir = outDir;
    const first = await placeRenderOutput(input('FIRST', 'webm'), process.platform);
    const second = await placeRenderOutput(input('SECOND'), process.platform);
    expect(second.exported).toBe(second.result);
    expectPair(first, 'FIRST');
    expectPair(second, 'SECOND');
  });

  it.each(['mp4', 'mixed'])('동시 %s 출력은 같은 이름을 골라도 각 영상의 자막을 보존한다', async (formats) => {
    const texts = ['FIRST', 'SECOND', 'THIRD', 'FOURTH'];
    const results = await Promise.all(texts.map((text, index) => placeRenderOutput(
      input(text, formats === 'mixed' && index % 2 === 0 ? 'webm' : 'mp4'), process.platform,
    )));
    expect(new Set(results.map((result) => subtitlePath(result.result))).size).toBe(texts.length);
    expect(new Set(results.map((result) => subtitlePath(result.exported))).size).toBe(texts.length);
    results.forEach((result, index) => expectPair(result, texts[index] ?? ''));
  });

  it('번호 고른 뒤 다른 출력이 자막을 먼저 만들면 이번 영상만 걷고 다음 쌍으로 간다', async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const occupied = path.join(outDir, 'Demo.srt');
    const result = await placeNumberedPair(outDir, 'Demo', 'mp4', true, async (file, subtitle) => {
      await writeNewFile(file, subtitle ? 'NEW CAPTION' : 'NEW VIDEO');
      if (file === path.join(outDir, 'Demo.mp4')) fs.writeFileSync(occupied, 'OTHER EXPORT');
    });
    expect(path.basename(result)).toBe('Demo (2).mp4');
    expect(fs.existsSync(path.join(outDir, 'Demo.mp4'))).toBe(false);
    expect(fs.readFileSync(occupied, 'utf8')).toBe('OTHER EXPORT');
    expect(fs.readFileSync(subtitlePath(result), 'utf8')).toBe('NEW CAPTION');
  });

  it('하드링크를 못 쓰는 디스크도 배타적 복사로 각 쌍을 보존한다', async () => {
    vi.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    const results = await Promise.all(['FIRST', 'SECOND'].map((text) => placeRenderOutput(input(text), process.platform)));
    expectPair(results[0]!, 'FIRST');
    expectPair(results[1]!, 'SECOND');
    const existing = path.join(exportDir, 'existing.srt');
    fs.writeFileSync(existing, 'KEEP');
    await expect(linkOrCopy(subtitlePath(results[0]!.result), existing)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.readFileSync(existing, 'utf8')).toBe('KEEP');
  });

  it('명시적 덮어쓰기는 외부 쌍만 교체하고 종전 자막을 하드링크 너머로 바꾸지 않는다', async () => {
    const first = await placeRenderOutput(input('FIRST'), process.platform);
    const next = input('SECOND');
    if (!next.output) throw new Error('Missing output settings');
    const second = await placeRenderOutput({ ...next, output: { ...next.output, conflict: 'overwrite' } }, process.platform);
    expect(second.exported).toBe(first.exported);
    expect(fs.readFileSync(first.result, 'utf8')).toBe('FIRST');
    expect(fs.readFileSync(subtitlePath(first.result), 'utf8')).toContain('FIRST');
    expectPair(second, 'SECOND');
  });
});
