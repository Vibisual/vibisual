/**
 * snapshotWire.test.ts — 스냅샷 무복사 팬아웃의 회귀.
 *
 * 고정하는 것은 네 줄이다.
 *  1. 인코딩 → 디코딩 왕복이 원본과 같다(한글·이모지 등 멀티바이트 포함).
 *  2. 창이 N개여도 **인코딩은 1회**다.
 *  3. 창이 N개면 **각 창이 온전한 버퍼**를 받는다 — 앞선 창이 버퍼를 detach 해 가도.
 *  4. 어느 단계가 깨져도 **조용히 종전 경로로 되돌아간다**.
 *
 * 판정이 electron 에 붙어 있으면 영영 검증되지 않으므로 `snapshotWire.ts` 는 순수 모듈로 나와
 * 있다(`chat/policy.ts`·`rendererFlushPlan.ts` 와 같은 이유).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  encodeWire,
  decodeWire,
  sliceWireBuffers,
  fanoutWire,
  WS_BUFFER_CHANNEL,
  WS_BUFFER_READY_CHANNEL,
  WS_OBJECT_CHANNEL,
  type WireTarget,
  type EncodedWire,
} from './snapshotWire';

/** 실제 graph_snapshot 을 흉내 낸 깊은 페이로드 — 얕은 객체로는 깊은 클론 경로가 안 드러난다. */
function makeSnapshot(agentCount: number): unknown {
  const agents = Array.from({ length: agentCount }, (_, i) => ({
    id: `agent-${i}`,
    name: `에이전트 ${i} 🫧`,
    status: i % 2 === 0 ? 'running' : 'idle',
    position: { x: i * 10, y: i * 7 },
    metrics: { turns: i, costUsd: i / 3, tokens: { in: i * 11, out: i * 13 } },
    children: [`agent-${i}-a`, `agent-${i}-b`],
  }));
  return {
    type: 'graph_snapshot',
    timestamp: 1_700_000_000_000,
    payload: { agents, topFolders: ['C:/repo', '/srv/projects/repo'], note: 'すし · 김치 · 🍜' },
  };
}

/**
 * 받는 즉시 버퍼를 **detach 하는** 가짜 창.
 *
 * Transferable 의 소유권 이전을 그대로 재현한다(`structuredClone(buf, { transfer: [buf] })` 는
 * 원본을 byteLength 0 으로 만든다). 구현이 창들에 같은 버퍼를 돌려 쓰면 두 번째 창부터 빈
 * 데이터를 받게 되므로, 이 가짜 창이 그 함정을 잡는다.
 */
function makeDetachingTarget(id: number, canPost = true): WireTarget & {
  readonly received: { bytes: ArrayBuffer[]; objects: unknown[] };
} {
  const received = { bytes: [] as ArrayBuffer[], objects: [] as unknown[] };
  return {
    id,
    canPost,
    received,
    post(buffer: ArrayBuffer): void {
      // 받은 시점에 이미 비어 있으면 detach 함정에 빠진 것이다.
      expect(buffer.byteLength).toBeGreaterThan(0);
      received.bytes.push(structuredClone(buffer, { transfer: [buffer] }));
    },
    send(payload: unknown): void {
      received.objects.push(payload);
    },
  };
}

describe('encodeWire / decodeWire', () => {
  it('왕복이 원본과 같다', () => {
    const msg = makeSnapshot(40);
    const encoded = encodeWire(msg);
    expect(JSON.parse(decodeWire(encoded.bytes))).toEqual(msg);
  });

  it('ArrayBuffer 로 넘어와도 같은 문자열을 돌려준다', () => {
    const msg = makeSnapshot(3);
    const encoded = encodeWire(msg);
    const [buffer] = sliceWireBuffers(encoded.bytes, 1);
    expect(buffer).toBeDefined();
    expect(decodeWire(buffer as ArrayBuffer)).toBe(encoded.json);
  });

  it('한글·이모지·CJK 등 멀티바이트가 깨지지 않는다(UTF-8)', () => {
    const msg = {
      type: 'graph_snapshot',
      payload: {
        ko: '에이전트 상태가 바뀌었습니다',
        emoji: '🫧🔥👨‍👩‍👧‍👦🇰🇷',
        ja: 'すしを食べる',
        zh: '汉字测试',
        surrogate: '𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
        mixed: 'C:\\work\\proj — "따옴표" & <tag>\n\t줄바꿈',
      },
    };
    const encoded = encodeWire(msg);
    // 바이트 길이가 문자 수보다 커야 실제 UTF-8 확장이 일어난 것이다(latin1 로 접히지 않았다).
    expect(encoded.bytes.byteLength).toBeGreaterThan(encoded.json.length);
    expect(JSON.parse(decodeWire(encoded.bytes))).toEqual(msg);
  });

  it('문자열이 그대로 오면 그대로 돌려준다(폴백 payload 관용)', () => {
    expect(decodeWire('{"type":"pong"}')).toBe('{"type":"pong"}');
  });

  it('JSON 으로 표현 못 하는 값이면 던진다(호출자가 폴백으로 간다)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => encodeWire(cyclic)).toThrow();
    expect(() => encodeWire(undefined)).toThrow();
  });
});

describe('sliceWireBuffers', () => {
  it('창 수만큼 버퍼를 주고, 전부 같은 내용이다', () => {
    const encoded = encodeWire(makeSnapshot(5));
    const buffers = sliceWireBuffers(encoded.bytes, 3);
    expect(buffers).toHaveLength(3);
    for (const buffer of buffers) expect(decodeWire(buffer)).toBe(encoded.json);
  });

  it('첫 벌은 인코딩이 지은 버퍼 그대로다(복사 0회)', () => {
    const encoded = encodeWire(makeSnapshot(2));
    const [first] = sliceWireBuffers(encoded.bytes, 2);
    expect(first).toBe(encoded.bytes.buffer);
  });

  it('창이 0개면 버퍼도 짓지 않는다', () => {
    const encoded = encodeWire(makeSnapshot(2));
    expect(sliceWireBuffers(encoded.bytes, 0)).toEqual([]);
  });
});

describe('fanoutWire', () => {
  it('창이 N개여도 인코딩은 1회다', () => {
    const msg = makeSnapshot(30);
    const encode = vi.fn((m: unknown): EncodedWire => encodeWire(m));
    const targets = [1, 2, 3, 4, 5].map((id) => makeDetachingTarget(id));

    const outcome = fanoutWire(msg, targets, encode);

    expect(encode).toHaveBeenCalledTimes(1);
    expect(outcome.posted).toBe(5);
    expect(outcome.sent).toBe(0);
  });

  it('창이 N개면 각 창이 온전한(detach 안 된) 버퍼를 받는다', () => {
    const msg = makeSnapshot(25);
    const targets = [1, 2, 3, 4].map((id) => makeDetachingTarget(id));

    fanoutWire(msg, targets);

    for (const target of targets) {
      expect(target.received.bytes).toHaveLength(1);
      const [buffer] = target.received.bytes;
      expect(buffer).toBeDefined();
      expect(JSON.parse(decodeWire(buffer as ArrayBuffer))).toEqual(msg);
    }
  });

  it('창이 1개면 종전 경로를 아예 타지 않는다', () => {
    const target = makeDetachingTarget(1);
    const outcome = fanoutWire(makeSnapshot(4), [target]);
    expect(outcome.posted).toBe(1);
    expect(target.received.objects).toEqual([]);
    expect(outcome.json).toBe(encodeWire(makeSnapshot(4)).json);
  });

  it('모바일·메신저 팬아웃이 재사용할 JSON 문자열을 돌려준다(재직렬화 방지)', () => {
    const msg = makeSnapshot(6);
    const outcome = fanoutWire(msg, [makeDetachingTarget(1)]);
    expect(outcome.json).not.toBeNull();
    expect(JSON.parse(outcome.json as string)).toEqual(msg);
  });

  it('창이 0개면 인코딩조차 하지 않는다', () => {
    const encode = vi.fn((m: unknown): EncodedWire => encodeWire(m));
    const outcome = fanoutWire(makeSnapshot(3), [], encode);
    expect(encode).not.toHaveBeenCalled();
    expect(outcome).toEqual({ json: null, posted: 0, sent: 0, dropped: 0, encodeFailed: false });
  });
});

describe('fanoutWire — 폴백(정확성 경로)', () => {
  it('바이트 채널을 모르는 창(구버전 preload)엔 문자열을 종전 경로로 보낸다', () => {
    const msg = makeSnapshot(8);
    const legacy = makeDetachingTarget(1, false);
    const modern = makeDetachingTarget(2, true);

    const outcome = fanoutWire(msg, [legacy, modern]);

    expect(outcome.posted).toBe(1);
    expect(outcome.sent).toBe(1);
    expect(legacy.received.bytes).toEqual([]);
    expect(legacy.received.objects).toHaveLength(1);
    // 재직렬화 없이 이미 만든 문자열을 재사용한다.
    expect(legacy.received.objects[0]).toBe(outcome.json);
    expect(modern.received.bytes).toHaveLength(1);
  });

  it('구버전 창만 있으면 인코딩은 여전히 1회, 그 문자열을 모두가 나눠 쓴다', () => {
    const encode = vi.fn((m: unknown): EncodedWire => encodeWire(m));
    const targets = [1, 2, 3].map((id) => makeDetachingTarget(id, false));

    const outcome = fanoutWire(makeSnapshot(4), targets, encode);

    expect(encode).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(3);
    for (const target of targets) expect(target.received.objects[0]).toBe(outcome.json);
  });

  it('post 가 던지면 그 창만 조용히 종전 경로로 되돌아간다', () => {
    const msg = makeSnapshot(5);
    const broken: WireTarget & { objects: unknown[] } = {
      id: 1,
      canPost: true,
      objects: [],
      post: () => {
        throw new Error('postMessage failed');
      },
      send(payload: unknown): void {
        this.objects.push(payload);
      },
    };
    const healthy = makeDetachingTarget(2);

    const outcome = fanoutWire(msg, [broken, healthy]);

    expect(outcome.posted).toBe(1);
    expect(outcome.sent).toBe(1);
    expect(outcome.dropped).toBe(0);
    expect(JSON.parse(broken.objects[0] as string)).toEqual(msg);
    expect(healthy.received.bytes).toHaveLength(1);
  });

  it('인코딩이 실패하면 전량이 원본 객체로 종전 경로를 탄다', () => {
    const cyclic: Record<string, unknown> = { type: 'debug_event' };
    cyclic['self'] = cyclic;
    const targets = [1, 2].map((id) => makeDetachingTarget(id));

    const outcome = fanoutWire(cyclic, targets);

    expect(outcome.encodeFailed).toBe(true);
    expect(outcome.json).toBeNull();
    expect(outcome.posted).toBe(0);
    expect(outcome.sent).toBe(2);
    for (const target of targets) expect(target.received.objects[0]).toBe(cyclic);
  });

  it('두 경로가 모두 던지면 그 창만 포기하고 나머지는 간다(창이 방금 닫힌 경우)', () => {
    const dead: WireTarget = {
      id: 1,
      canPost: true,
      post: () => {
        throw new Error('destroyed');
      },
      send: () => {
        throw new Error('destroyed');
      },
    };
    const healthy = makeDetachingTarget(2);

    const outcome = fanoutWire(makeSnapshot(3), [dead, healthy]);

    expect(outcome.dropped).toBe(1);
    expect(outcome.posted).toBe(1);
    expect(healthy.received.bytes).toHaveLength(1);
  });
});

describe('채널 상수', () => {
  it('main 과 preload 가 같은 이름을 쓰고, 종전 채널이 그대로 남아 있다', () => {
    // 종전 채널이 사라지면 ipc.ts 의 초기 ack·스냅샷 푸시가 통째로 끊긴다.
    expect(WS_OBJECT_CHANNEL).toBe('vibisual:ws');
    expect(WS_BUFFER_CHANNEL).toBe('vibisual:ws:buf');
    expect(WS_BUFFER_READY_CHANNEL).toBe('vibisual:ws:buf-ready');
  });
});
