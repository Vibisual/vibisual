import { describe, expect, it } from 'vitest';
import { frameArrayBuffer } from './frameBuffer.js';

describe('capture ArrayBuffer ownership', () => {
  it('reuses exact owned bitmap buffers without a second copy', () => {
    const bitmap = Buffer.alloc(16);
    expect(frameArrayBuffer(bitmap)).toBe(bitmap.buffer);
    expect(frameArrayBuffer(new Uint8Array(0)).byteLength).toBe(0);
  });

  it('copies subarray and pooled views without exposing surrounding bytes', () => {
    const backing = Buffer.alloc(64, 99);
    const view = backing.subarray(8, 24);
    view.fill(17);
    const data = frameArrayBuffer(view);
    expect(data).not.toBe(backing.buffer);
    expect(data.byteLength).toBe(16);
    expect(Array.from(new Uint8Array(data))).toEqual(Array(16).fill(17));
    view.fill(23);
    expect(new Uint8Array(data)[0]).toBe(17);
  });

  it('copies shared backing memory into the existing ArrayBuffer IPC contract', () => {
    const bytes = new Uint8Array(new SharedArrayBuffer(4));
    bytes.set([1, 2, 3, 4]);
    const data = frameArrayBuffer(bytes);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3, 4]);
  });

  it('retains bytes and shape across structured clone', () => {
    const bitmap = Buffer.alloc(8);
    bitmap.set([0, 0, 128, 128, 1, 2, 3, 255]);
    const frame = { kind: 'raw', width: 2, height: 1, order: 'bgra', premultiplied: true, data: frameArrayBuffer(bitmap) };
    const received = structuredClone(frame);
    expect(received).toEqual(frame);
    expect(received.data).not.toBe(bitmap.buffer);
  });
});
