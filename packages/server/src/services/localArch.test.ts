/**
 * §5.19 (E) 받기 전에 구조를 안다 — GGUF 머리 읽기 + 구조 판정 장부 테스트.
 *
 * 회귀 방지 대상 — 2026-08-21. 목록이 허깅페이스의 GGUF 를 전부 내놓는 바람에 **이 엔진이
 * 못 돌리는 모델**까지 받혔고, 사용자는 수 GB 를 받고 프롬프트를 친 뒤에야 그 사실을 알았다.
 *
 * 조건은 셋 — **파일 앞부분만으로 구조를 읽을 것**(수 GB 를 받아 보고 알 일이 아니다),
 * **못 읽으면 단정하지 말 것**(모르면 막지 않는다), **판정은 실측 장부에서 나올 것**
 * (하드코딩한 화이트리스트가 아니라, 새 빌드가 지원하면 스스로 뒤집히는 기록).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArchitecture, getArchVerdict, recordArchVerdict, readLocalArchitecture, MEASURED_BROKEN } from './localArchService.js';

// ─── GGUF 머리 만들기 ───

function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function gstr(s: string): Buffer {
  const body = Buffer.from(s, 'utf8');
  return Buffer.concat([u64(body.length), body]);
}
/** 문자열 KV 한 쌍. */
function kvString(key: string, value: string): Buffer {
  return Buffer.concat([gstr(key), u32(8), gstr(value)]);
}
/** u32 KV 한 쌍 — 구조 이름 앞에 다른 값이 놓인 경우를 흉내 낸다. */
function kvU32(key: string, value: number): Buffer {
  return Buffer.concat([gstr(key), u32(4), u32(value)]);
}
/** 문자열 배열 KV — 토크나이저 어휘처럼 길게 늘어지는 값. */
function kvStringArray(key: string, values: string[]): Buffer {
  return Buffer.concat([gstr(key), u32(9), u32(8), u64(values.length), ...values.map(gstr)]);
}
function gguf(kvs: Buffer[], tensorCount = 400): Buffer {
  return Buffer.concat([Buffer.from('GGUF', 'latin1'), u32(3), u64(tensorCount), u64(kvs.length), ...kvs]);
}

// ─────────────────────────────────────────────────────────────
describe('parseArchitecture — 앞부분만으로 구조를 읽는다', () => {
  it('맨 앞에 있으면 읽는다', () => {
    expect(parseArchitecture(gguf([kvString('general.architecture', 'qwen2')]))).toBe('qwen2');
  });

  it('다른 값들 뒤에 있어도 읽는다', () => {
    const buf = gguf([
      kvU32('general.file_type', 15),
      kvStringArray('tokenizer.ggml.tokens', ['!', '"', '#']),
      kvString('general.name', 'Some Model'),
      kvString('general.architecture', 'gemma3'),
    ]);
    expect(parseArchitecture(buf)).toBe('gemma3');
  });

  it('GGUF 가 아니면 null — 단정하지 않는다', () => {
    expect(parseArchitecture(Buffer.from('NOTGGUF__________________', 'latin1'))).toBeNull();
    expect(parseArchitecture(Buffer.alloc(4))).toBeNull();
  });

  it('앞부분이 잘려 값에 못 닿으면 null — 틀렸다고 말하지 않는다', () => {
    const full = gguf([kvStringArray('tokenizer.ggml.tokens', ['a', 'b', 'c']), kvString('general.architecture', 'qwen2')]);
    expect(parseArchitecture(full.subarray(0, 40))).toBeNull();
  });

  it('구조 항목이 아예 없으면 null', () => {
    expect(parseArchitecture(gguf([kvString('general.name', 'x')]))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('구조 판정 장부', () => {
  let home: string;
  let savedProfile: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-arch-'));
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

  it('모르는 구조는 unknown — 모르면 막지 않는다', () => {
    expect(getArchVerdict('b10509', 'llama')).toBe('unknown');
    expect(getArchVerdict('b10509', null)).toBe('unknown');
  });

  it('씨앗에 오른 구조는 broken — 목록이 무엇이든 그 규칙은 같다', () => {
    // 특정 구조 이름을 박지 않는다. 씨앗이 바뀌어도 이 시험은 그대로 맞아야 한다.
    for (const arch of Object.keys(MEASURED_BROKEN)) {
      expect(getArchVerdict('b10509', arch)).toBe('broken');
    }
  });

  it('qwen35 는 막지 않는다 — 파일 하나의 실패를 구조 탓으로 돌렸던 자리(2026-08-21 정정)', () => {
    // 근거였던 `Qwen3.5-9B-IQ4_XS.gguf` 는 깨졌지만, 같은 구조의 `Qwen3.8-27B-UD-Q4_K_M` 은
    //   같은 빌드(b10509)에서 40.6 tok/s 로 멀쩡히 답한다. 씨앗으로 막는 순간 Qwen3.8 ·
    //   Ornith-1.5 · Qwen-AgentWorld 가 통째로 목록에서 사라진다.
    expect(getArchVerdict('b10509', 'qwen35')).toBe('unknown');
    expect(MEASURED_BROKEN).not.toHaveProperty('qwen35');
  });

  it('돌려 본 결과를 남기면 그것이 판정이 된다', () => {
    recordArchVerdict('b10509', 'gemma3', 'ok');
    expect(getArchVerdict('b10509', 'gemma3')).toBe('ok');
  });

  it('판정은 빌드마다 따로 산다 — 남의 이야기를 끌어오지 않는다', () => {
    recordArchVerdict('b99999', 'qwen35', 'broken');
    expect(getArchVerdict('b99999', 'qwen35')).toBe('broken');
    // 같은 구조라도 다른 빌드의 판정은 그대로 모른다(= 막지 않는다).
    expect(getArchVerdict('b10509', 'qwen35')).toBe('unknown');
    // 그리고 새 실측이 옛 판정을 덮는다 — 새 빌드가 지원하기 시작하면 스스로 뒤집힌다.
    recordArchVerdict('b99999', 'qwen35', 'ok');
    expect(getArchVerdict('b99999', 'qwen35')).toBe('ok');
  });

  it('받아 둔 파일에서도 구조를 읽는다', () => {
    const file = path.join(home, '.vibisual', 'models', 'x.gguf');
    fs.writeFileSync(file, gguf([kvString('general.architecture', 'qwen2')]));
    expect(readLocalArchitecture(file)).toBe('qwen2');
  });

  it('없는 파일은 null', () => {
    expect(readLocalArchitecture(path.join(home, 'nope.gguf'))).toBeNull();
  });
});
