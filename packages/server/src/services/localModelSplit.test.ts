/**
 * §5.19 (E) 쪼개진 GGUF 모델 묶기 테스트.
 *
 * 회귀 방지 대상 — 2026-08-20 실측 사고. 큰 모델은 `…-00001-of-00002.gguf` 처럼 조각으로
 * 배포되는데, 목록이 **조각 하나하나를 독립 모델처럼** 보여준 탓에 사용자가 둘째 조각만
 * 받아서 그것을 골랐다. 엔진은 첫 조각을 줘야 나머지를 따라가므로 그대로 죽었고
 * (`engine exited before ready (code=1)`), 화면에는 무엇이 없는지 아무 말도 없었다.
 *
 * 조건은 셋이다 — **조각은 한 항목으로 묶을 것**, **엔진에 줄 경로는 언제나 첫 조각일 것**,
 * **빠진 조각이 있으면 숨기지 말고 말할 것**(고르지 못하게 하는 근거가 된다).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyModelFit } from '@vibisual/shared';
import { listModels, findModel, modelsDir } from './localModelService.js';

let home: string;
let savedProfile: string | undefined;
let savedHome: string | undefined;

/** 진짜 홈을 건드리지 않는다 — 시험이 사용자의 모델 폴더를 보면 안 된다. */
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-split-'));
  savedProfile = process.env['USERPROFILE'];
  savedHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  fs.mkdirSync(path.join(home, '.vibisual', 'models'), { recursive: true });
});

afterEach(() => {
  if (savedProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = savedProfile;
  if (savedHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = savedHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
});

function put(name: string, size: number): void {
  fs.writeFileSync(path.join(home, '.vibisual', 'models', name), Buffer.alloc(size));
}

// ─────────────────────────────────────────────────────────────
describe('listModels — 쪼개진 모델은 한 벌로 묶는다', () => {
  it('격리된 홈을 본다(진짜 모델 폴더를 건드리지 않는다)', () => {
    expect(modelsDir().replace(/\\/g, '/')).toContain('vibi-split-');
    expect(listModels()).toEqual([]);
  });

  it('조각 두 개가 다 있으면 항목은 하나, 크기는 합, 경로는 첫 조각', () => {
    put('Qwen3.8-27B-BF16-00001-of-00002.gguf', 100);
    put('Qwen3.8-27B-BF16-00002-of-00002.gguf', 50);
    const models = listModels();
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m?.name).toBe('Qwen3.8-27B-BF16');
    expect(m?.sizeBytes).toBe(150);
    expect(m?.partCount).toBe(2);
    expect(m?.missingParts ?? []).toEqual([]);
    expect(path.basename(m?.path ?? '')).toBe('Qwen3.8-27B-BF16-00001-of-00002.gguf');
  });

  it('둘째 조각만 있으면 빠진 조각을 말한다 — 사고 당시의 디스크 그대로', () => {
    put('Qwen3.8-27B-BF16-00002-of-00002.gguf', 50);
    const models = listModels();
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m?.missingParts).toEqual(['Qwen3.8-27B-BF16-00001-of-00002.gguf']);
    expect(m?.partCount).toBe(2);
    // 조각이 빠졌어도 경로는 첫 조각을 가리킨다 — 둘째를 엔진에 주면 그대로 죽는다.
    expect(path.basename(m?.path ?? '')).toBe('Qwen3.8-27B-BF16-00001-of-00002.gguf');
  });

  it('가운데 조각이 빠져도 잡아낸다', () => {
    put('big-00001-of-00003.gguf', 10);
    put('big-00003-of-00003.gguf', 30);
    const m = listModels()[0];
    expect(m?.missingParts).toEqual(['big-00002-of-00003.gguf']);
    expect(m?.sizeBytes).toBe(40);
  });

  it('쪼개지지 않은 모델은 그대로 한 항목', () => {
    put('ornith-1.0-9b-Q4_K_M.gguf', 42);
    const m = listModels()[0];
    expect(m?.name).toBe('ornith-1.0-9b-Q4_K_M');
    expect(m?.quant).toBe('Q4_K_M');
    expect(m?.partCount).toBeUndefined();
    expect(m?.missingParts).toBeUndefined();
  });

  it('조각 이름이 아니라 **본체 이름**에서 양자화 라벨을 읽는다', () => {
    put('Model-Q5_K_M-00001-of-00002.gguf', 1);
    put('Model-Q5_K_M-00002-of-00002.gguf', 1);
    expect(listModels()[0]?.quant).toBe('Q5_K_M');
  });

  it('섞여 있어도 각자 제 모양으로 나온다', () => {
    put('solo.gguf', 5);
    put('split-00001-of-00002.gguf', 5);
    put('split-00002-of-00002.gguf', 5);
    const names = listModels().map((m) => m.name).sort();
    expect(names).toEqual(['solo', 'split']);
  });

  it('id 로 다시 찾을 수 있다 — 버블이 물고 있는 것이 이 id 다', () => {
    put('split-00001-of-00002.gguf', 5);
    put('split-00002-of-00002.gguf', 5);
    const id = listModels()[0]?.id ?? '';
    expect(id).toBe('split');
    expect(findModel(id)?.partCount).toBe(2);
    // 조각 파일명으로는 찾히지 않아야 한다(조각은 고를 수 있는 대상이 아니다).
    expect(findModel('split-00002-of-00002')).toBeNull();
  });

  it('`.part`(받는 중)는 목록에 넣지 않는다', () => {
    put('half.gguf.part', 9);
    expect(listModels()).toEqual([]);
  });
});

/** GGUF 머리 24바이트만 만든다 — `ggufTensorCount` 가 보는 곳이 딱 여기다. */
function putGguf(name: string, tensorCount: number): void {
  const head = Buffer.alloc(4096);
  head.write('GGUF', 0, 'latin1');
  head.writeUInt32LE(3, 4);
  head.writeBigUInt64LE(BigInt(tensorCount), 8);
  head.writeBigUInt64LE(0n, 16);
  fs.writeFileSync(path.join(home, '.vibisual', 'models', name), head);
}

// ─────────────────────────────────────────────────────────────
describe('listModels — 부속 파일은 모델이 아니다', () => {
  it('이름으로 잡는다 — mtp / mmproj / imatrix', () => {
    putGguf('mtp-Qwen3.8-27B-Q4_0.gguf', 900);
    putGguf('mmproj-model-f16.gguf', 900);
    putGguf('imatrix_unsloth.gguf', 900);
    const models = listModels();
    expect(models).toHaveLength(3);
    for (const m of models) expect(m.companion).toBe(true);
  });

  it('이름이 멀쩡해도 텐서가 터무니없이 적으면 본체가 아니다 — 실측 MTP 헤드는 18개', () => {
    putGguf('innocent-name-Q4_0.gguf', 18);
    expect(listModels()[0]?.companion).toBe(true);
  });

  it('텐서가 충분한 진짜 모델은 건드리지 않는다', () => {
    putGguf('real-model-Q4_K_M.gguf', 400);
    const m = listModels()[0];
    expect(m?.companion).toBeUndefined();
    expect(m?.quant).toBe('Q4_K_M');
  });

  it('GGUF 가 아니면 텐서 수로 단정하지 않는다(이름 규칙만 남는다)', () => {
    fs.writeFileSync(path.join(home, '.vibisual', 'models', 'weird.gguf'), Buffer.alloc(8));
    expect(listModels()[0]?.companion).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('classifyModelFit — 이 PC 에서 어떻게 돌지', () => {
  const gpu = { vramFreeBytes: 24 * 1e9, totalRamBytes: 64 * 1e9, measuredAt: 1 };
  const noGpu = { vramFreeBytes: 0, totalRamBytes: 32 * 1e9, measuredAt: 1 };

  it('GPU 여유 안에 들어오면 gpu', () => {
    expect(classifyModelFit(16 * 1e9, gpu)).toBe('gpu');
  });

  it('GPU 는 넘치지만 램으로는 되면 ram', () => {
    expect(classifyModelFit(30 * 1e9, gpu)).toBe('ram');
  });

  it('램으로도 안 되면 too-big', () => {
    expect(classifyModelFit(200 * 1e9, gpu)).toBe('too-big');
  });

  it('가속 장치가 없으면 절대 gpu 라고 하지 않는다', () => {
    expect(classifyModelFit(1 * 1e9, noGpu)).toBe('ram');
  });

  it('아직 못 쟀으면 unknown — 넘겨짚지 않는다', () => {
    expect(classifyModelFit(1 * 1e9, null)).toBe('unknown');
    expect(classifyModelFit(1 * 1e9, { vramFreeBytes: 24 * 1e9, totalRamBytes: 64 * 1e9, measuredAt: 0 })).toBe('unknown');
  });

  it('크기를 모르면 unknown', () => {
    expect(classifyModelFit(0, gpu)).toBe('unknown');
  });

  it('가중치 말고도 자리가 든다 — 딱 맞는 크기는 gpu 라고 하지 않는다', () => {
    // 여유가 정확히 파일 크기와 같으면, 문맥 캐시가 들어갈 자리가 없다.
    expect(classifyModelFit(24 * 1e9, gpu)).not.toBe('gpu');
  });
});
