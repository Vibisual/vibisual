import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { bodyServer, postBody } from './loopbackBody.testHelpers';

describe('raw hook ingress has a bounded lifetime before Express', () => {
  it('preserves arbitrary UTF-8 bytes split across chunk boundaries', async () => {
    const bytes = Buffer.from('한글 日本語 عربي e\u0301 😀 <>&');
    const fixture = await bodyServer({ requestBytes: bytes.length, totalBytes: bytes.length });
    try {
      const result = await postBody(fixture.port, [bytes.subarray(0, 4), bytes.subarray(4)]);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(bytes);
      expect(fixture.budget.usedBytes).toBe(0);
    } finally { await fixture.close(); }
  });

  it.each(['content length', 'chunked'])('rejects an oversized %s body before dispatch', async (kind) => {
    let dispatched = 0;
    const fixture = await bodyServer({ requestBytes: 8, totalBytes: 16 }, (_body, res, release) => {
      dispatched += 1; res.end('unexpected'); release();
    });
    try {
      const result = await postBody(fixture.port, [Buffer.from('1234'), Buffer.from('56789')],
        kind === 'content length' ? { 'content-length': '9' } : undefined);
      expect(result.status).toBe(413);
      expect(dispatched).toBe(0);
      expect(fixture.budget.usedBytes).toBe(0);
    } finally { await fixture.close(); }
  });

  it('bounds concurrently held requests and returns capacity after completion', async () => {
    let completeFirst: () => void = () => undefined;
    let firstArrived: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => { firstArrived = resolve; });
    let calls = 0;
    const fixture = await bodyServer({ requestBytes: 8, totalBytes: 8 }, (_body, res, release) => {
      calls += 1;
      if (calls === 1) {
        completeFirst = () => { release(); release(); res.end('first'); };
        firstArrived();
      } else { res.end('later'); release(); }
    });
    try {
      const first = postBody(fixture.port, [Buffer.from('123456')]);
      await arrived;
      expect(fixture.budget.usedBytes).toBe(6);
      expect((await postBody(fixture.port, [Buffer.from('abc')])).status).toBe(503);
      expect(fixture.budget.usedBytes).toBe(6);
      completeFirst(); await first;
      expect(fixture.budget.usedBytes).toBe(0);
      expect((await postBody(fixture.port, [Buffer.from('123456')])).status).toBe(200);
      expect(fixture.budget.usedBytes).toBe(0);
    } finally { await fixture.close(); }
  });

  it('releases partially read bytes when the sender disappears', async () => {
    let sawData: () => void = () => undefined;
    const received = new Promise<void>((resolve) => { sawData = resolve; });
    let serverClosed: Promise<unknown> = Promise.resolve();
    let dispatched = false;
    const fixture = await bodyServer({ requestBytes: 8, totalBytes: 8 }, (_body, res, release) => {
      dispatched = true; res.end(); release();
    }, (req) => {
      req.once('data', sawData);
      // Request destruction emits error before close; settle the fixture without an unhandled rejection.
      serverClosed = new Promise<void>((resolve) => req.once('close', resolve));
    });
    const client = request({ host: '127.0.0.1', port: fixture.port, method: 'POST' });
    client.on('error', () => { /* Intentional test peer disconnect. */ });
    try {
      client.write('abc'); await received;
      expect(fixture.budget.usedBytes).toBe(3);
      client.destroy(); await serverClosed;
      expect(dispatched).toBe(false);
      expect(fixture.budget.usedBytes).toBe(0);
    } finally { client.destroy(); await fixture.close(); }
  });

  it('retains completed-body capacity after disconnect until the inner dispatch finishes', async () => {
    let arrived: () => void = () => undefined;
    const received = new Promise<void>((resolve) => { arrived = resolve; });
    let closed: Promise<unknown> = Promise.resolve();
    let finishDispatch: () => void = () => undefined;
    const fixture = await bodyServer({ requestBytes: 8, totalBytes: 8 }, (_body, res, release) => {
      finishDispatch = release;
      closed = once(res, 'close'); arrived();
    });
    const client = request({ host: '127.0.0.1', port: fixture.port, method: 'POST' });
    client.on('error', () => { /* Intentional test peer disconnect. */ });
    try {
      client.end('abc'); await received;
      expect(fixture.budget.usedBytes).toBe(3);
      client.destroy(); await closed;
      expect(fixture.budget.usedBytes).toBe(3);
      expect((await postBody(fixture.port, [Buffer.from('123456')])).status).toBe(503);
      finishDispatch(); finishDispatch();
      expect(fixture.budget.usedBytes).toBe(0);
    } finally { finishDispatch(); client.destroy(); await fixture.close(); }
  });
});
