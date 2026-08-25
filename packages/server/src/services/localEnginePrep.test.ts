/**
 * §5.19 (D) 엔진을 띄우기 전에 정해지는 것들 — **인자 · 학습 문맥 · 답 예산.**
 *
 * 셋 다 "틀려도 오류가 안 나서" 오래 안 보이는 부류다.
 * - 인자: 새 플래그를 더하면 그걸 모르는 옛 설치가 **통째로 안 뜬다**(무시가 아니라 즉시 종료).
 * - 학습 문맥: 창을 크게 잡아도 엔진이 조용히 깎아 **화면 숫자와 실제가 어긋난다**.
 * - 답 예산: 창의 고정 비율로 잡으면 이력이 길어진 뒤 생성이 창 끝에 닿아 **답이 잘린다**.
 */
import { describe, it, expect } from 'vitest';
import { LOCAL_ANSWER_BUDGET_MIN, LOCAL_ANSWER_BUDGET_RESERVE, localAnswerBudget } from '@vibisual/shared';
import { buildEngineArgs, ENGINE_EXTRA_FLAGS } from './localRunner.js';
import { parseGgufMeta } from './localArchService.js';

describe('buildEngineArgs — 인자를 만드는 곳은 한 곳뿐', () => {
  it('모델·포트·창·오프로드가 빠짐없이 들어간다', () => {
    const args = buildEngineArgs('C:/m.gguf', 51500, 8192, 999, []);
    expect(args).toEqual([
      '-m', 'C:/m.gguf',
      '--host', '127.0.0.1',
      '--port', '51500',
      '-c', '8192',
      '-ngl', '999',
    ]);
  });

  it('선택 플래그는 값과 함께 뒤에 붙는다', () => {
    const args = buildEngineArgs('C:/m.gguf', 51500, 8192, 0, ENGINE_EXTRA_FLAGS);
    expect(args).toContain('--cache-reuse');
    expect(args).toContain('--reasoning-budget');
    // 값이 따라붙어야 한다 — 플래그만 붙이면 엔진이 다음 인자를 값으로 먹는다.
    expect(args[args.indexOf('--cache-reuse') + 1]).toMatch(/^\d+$/);
    expect(args[args.indexOf('--reasoning-budget') + 1]).toMatch(/^\d+$/);
  });

  it('버리는 순서는 빠르기 → 옳음 — 사고 상한이 마지막까지 남는다', () => {
    // 앞에 있는 것이 먼저 버려진다. 캐시 재사용은 느려질 뿐이지만, 사고 상한이 빠지면
    //   생각만 하다 끝나는 모델이 **빈 답**을 낸다(§5.19 (D) 실측).
    expect(ENGINE_EXTRA_FLAGS[0]?.id).toBe('cache-reuse');
    expect(ENGINE_EXTRA_FLAGS.at(-1)?.id).toBe('thinking-cap');
  });
});

/** GGUF 머리를 손으로 짓는다 — 실물 모델(수 GB)을 시험에 끌어들이지 않는다. */
function gguf(kv: Array<[string, number, number | string]>): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(24);
  head.write('GGUF', 0, 'latin1');
  head.writeUInt32LE(3, 4);
  head.writeBigUInt64LE(0n, 8); // tensor count
  head.writeBigUInt64LE(BigInt(kv.length), 16);
  parts.push(head);
  for (const [key, type, value] of kv) {
    const k = Buffer.from(key, 'utf8');
    const len = Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(k.length));
    const t = Buffer.alloc(4);
    t.writeUInt32LE(type);
    parts.push(len, k, t);
    if (type === 8) {
      const v = Buffer.from(String(value), 'utf8');
      const vl = Buffer.alloc(8);
      vl.writeBigUInt64LE(BigInt(v.length));
      parts.push(vl, v);
    } else if (type === 4) {
      const v = Buffer.alloc(4);
      v.writeUInt32LE(Number(value));
      parts.push(v);
    } else if (type === 10) {
      const v = Buffer.alloc(8);
      v.writeBigUInt64LE(BigInt(Number(value)));
      parts.push(v);
    }
  }
  return Buffer.concat(parts);
}

describe('parseGgufMeta — 구조와 학습 문맥을 한 번에', () => {
  it('구조와 문맥 길이를 둘 다 읽는다', () => {
    const buf = gguf([
      ['general.architecture', 8, 'qwen3'],
      ['qwen3.context_length', 4, 32768],
    ]);
    expect(parseGgufMeta(buf)).toEqual({ architecture: 'qwen3', contextLength: 32768 });
  });

  it('64비트로 적힌 문맥 길이도 읽는다', () => {
    const buf = gguf([
      ['general.architecture', 8, 'llama'],
      ['llama.context_length', 10, 131072],
    ]);
    expect(parseGgufMeta(buf).contextLength).toBe(131072);
  });

  it('구조 이름을 몰라도 꼬리로 알아본다 — 새 아키텍처마다 표를 늘리지 않는다', () => {
    const buf = gguf([['brandnewarch.context_length', 4, 8192]]);
    expect(parseGgufMeta(buf).contextLength).toBe(8192);
  });

  it('없으면 null — 모르면 단정하지 않는다(막지도 않는다)', () => {
    const buf = gguf([['general.architecture', 8, 'qwen3']]);
    expect(parseGgufMeta(buf).contextLength).toBeNull();
  });

  it('GGUF 가 아니면 둘 다 null', () => {
    expect(parseGgufMeta(Buffer.from('not a gguf file at all, really'))).toEqual({
      architecture: null,
      contextLength: null,
    });
  });
});

describe('localAnswerBudget — 남은 자리를 알면 그 안에서 잡는다', () => {
  it('프롬프트를 모르면 종전대로 창의 비율', () => {
    expect(localAnswerBudget(16384)).toBe(Math.floor(16384 * 0.75));
  });

  it('프롬프트가 커지면 답의 몫이 줄어든다 — 이게 잘린 답을 막는다', () => {
    const small = localAnswerBudget(16384, 1_000);
    const big = localAnswerBudget(16384, 12_000);
    expect(big).toBeLessThan(small);
    expect(big).toBe(16384 - 12_000 - LOCAL_ANSWER_BUDGET_RESERVE);
  });

  it('남은 자리가 많아도 창의 비율을 넘지는 않는다 — 생각이 예산을 다 먹는 것을 막는 몫', () => {
    expect(localAnswerBudget(16384, 10)).toBe(Math.floor(16384 * 0.75));
  });

  it('자리가 거의 없어도 하한은 준다 — 답이 통째로 사라지면 안 된다', () => {
    expect(localAnswerBudget(16384, 16_300)).toBe(LOCAL_ANSWER_BUDGET_MIN);
  });
});
