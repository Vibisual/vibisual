/**
 * §5.3 #10-2 — **바깥 호출자가 끊기면 안쪽 주입 응답도 끊긴다(결과를 기다리는 dispatch 경로만).**
 *
 * loopback 리스너는 요청을 light-my-request 로 다시 주입한다. 끊김을 넘기지 않으면 서버는 떠난 호출자를 계속 붙들고,
 * 작업이 끝나면 아무도 받지 않은 결과를 "건넸다"고 적는다 — 그 결과를 기다리던 턴은 받지 못한 채 완료로 끝날 수 있었다.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { inject, type DispatchFunc } from 'light-my-request';
import { describe, expect, it } from 'vitest';
import { followOuterDisconnect, isHoldPath, type InjectDispatch } from './injectDisconnect';

/** 바깥 응답 흉내 — helper 가 만지는 `close` 와 `writableFinished` 만. */
function outerResponse(): EventEmitter & { writableFinished: boolean } {
  return Object.assign(new EventEmitter(), { writableFinished: false });
}

/** 안쪽 응답 흉내 — 실제 주입 없이 분기만 볼 때. */
function innerResponse(): EventEmitter & { writableEnded: boolean; destroyed: boolean; destroy: () => void; destroyCalls: number } {
  const inner = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, destroyCalls: 0, destroy: () => { inner.destroyCalls += 1; } });
  return inner;
}

describe('isHoldPath', () => {
  it('matches only the dispatch routes that can hold a result', () => {
    expect(isHoldPath('/api/task-edges/dispatch')).toBe(true);
    expect(isHoldPath('/api/task-edges/dispatch/cmd-1')).toBe(true);
    expect(isHoldPath('/api/task-edges/dispatch/cmd-1/cancel')).toBe(true);
    expect(isHoldPath('/api/task-edges/dispatcher')).toBe(false);
    expect(isHoldPath('/api/task-edges')).toBe(false);
    expect(isHoldPath('/api/commands')).toBe(false);
    expect(isHoldPath('/hook')).toBe(false);
  });

  it('holds the two permission-card routes too, so a hook that dies with its CLI cancels the card instead of waiting out 60s (§5.3 #12-1-B)', () => {
    expect(isHoldPath('/api/permission-check')).toBe(true);
    expect(isHoldPath('/api/codex-tool-check')).toBe(true);
    expect(isHoldPath('/api/permission-decide')).toBe(false);
    expect(isHoldPath('/api/permission-pending')).toBe(false);
  });
});

describe('followOuterDisconnect', () => {
  it('cuts a held inner response when the outer caller leaves first, so the server sees close and the result is not handed over', async () => {
    const outer = outerResponse();
    let inner: ServerResponse | undefined;
    let closedBeforeEnd: boolean | undefined;
    let entered!: () => void;
    const inDispatch = new Promise<void>((resolve) => { entered = resolve; });
    // 서버의 대기 흉내 — 결과가 날 때까지 응답하지 않고 `close` 로 대기만 걷는다.
    const hold: InjectDispatch = (_req, res) => {
      inner = res;
      res.on('close', () => { closedBeforeEnd = !res.writableEnded; });
      entered();
    };

    const outcome = inject(followOuterDisconnect(outer, hold) as unknown as DispatchFunc, { method: 'GET', url: '/api/task-edges/dispatch/cmd-1?waitMs=60000' })
      .then(() => 'answered', () => 'aborted');
    await inDispatch;
    expect(outer.listenerCount('close')).toBe(1);

    outer.emit('close');
    expect(await outcome).toBe('aborted');
    expect(inner?.destroyed).toBe(true);
    expect(closedBeforeEnd).toBe(true);
    expect(outer.listenerCount('close')).toBe(0);
  });

  it('leaves a response that finishes by itself alone and lets go of the outer response', async () => {
    const outer = outerResponse();
    const reply: InjectDispatch = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true,"status":"completed"}');
    };

    const response = await inject(followOuterDisconnect(outer, reply) as unknown as DispatchFunc, { method: 'POST', url: '/api/task-edges/dispatch?edgeId=edge-a', payload: 'work' });
    expect(response.json()).toEqual({ ok: true, status: 'completed' });
    expect(outer.listenerCount('close')).toBe(0);
    outer.writableFinished = true;
    expect(() => outer.emit('close')).not.toThrow();
  });

  it('does not cut the inner response once the outer reply has gone out, or once the inner one already ended', () => {
    const sent = outerResponse();
    const afterReply = innerResponse();
    followOuterDisconnect(sent, () => {})({} as IncomingMessage, afterReply as unknown as ServerResponse);
    sent.writableFinished = true;
    sent.emit('close');
    expect(afterReply.destroyCalls).toBe(0);

    const outer = outerResponse();
    const ended = innerResponse();
    followOuterDisconnect(outer, () => {})({} as IncomingMessage, ended as unknown as ServerResponse);
    ended.writableEnded = true;
    outer.emit('close');
    expect(ended.destroyCalls).toBe(0);
  });

  it('stops following the outer response when the inner one closes on its own', () => {
    const outer = outerResponse();
    const inner = innerResponse();
    followOuterDisconnect(outer, () => {})({} as IncomingMessage, inner as unknown as ServerResponse);
    expect(outer.listenerCount('close')).toBe(1);
    inner.emit('close');
    expect(outer.listenerCount('close')).toBe(0);
  });

  it('is wired into the loopback listener for hold paths only, and the listener does not write to a caller that already left', () => {
    const main = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    expect(main).toContain('const dispatchFn = (isHoldPath(path) ? followOuterDisconnect(res, target) : target) as unknown as DispatchFunc;');
    expect(main).toContain('void inject(dispatchFn, {');
    expect(main).toContain('if (res.writableEnded || res.destroyed) return;');
  });
});
