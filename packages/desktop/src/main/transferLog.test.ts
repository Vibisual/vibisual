/**
 * §5.13 (Y) 40-7 ① · 40-12 — 전송 기록과 IPC 운반. 느리거나 큰 IPC·vibproxy 응답은 경로·크기와 함께 남는다.
 * 운반은 바이너리를 문자열로 바꾸지 않는다(164MB UTF-8 변환만 메인 1.5초) — 그 배선을 원문으로 지킨다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./crashLog', () => ({ appendLogText: vi.fn() }));

import { formatPerfLine, formatTransferLine, logPerfLine, logTransfer, shouldLogTransfer, TRANSFER_LOG_BYTES, TRANSFER_LOG_MS } from './mainStallLog';

describe('§5.13 (Y) 40-12 — 전송 한 줄', () => {
  it('logs only slow or large transfers, with path and size, at the start time', () => {
    expect(shouldLogTransfer(TRANSFER_LOG_MS - 1, TRANSFER_LOG_BYTES - 1)).toBe(false);
    expect(shouldLogTransfer(TRANSFER_LOG_MS, 0)).toBe(true);
    expect(shouldLogTransfer(0, TRANSFER_LOG_BYTES)).toBe(true);
    const line = formatTransferLine({ at: Date.UTC(2026, 9, 16, 0, 0, 1), channel: 'ipc-fetch', path: '/api/x?y=1', ms: 1000, bytes: 3 * 1048576 });
    expect(line).toBe('[2026-10-16T00:00:00.000Z] transfer ipc-fetch 1000ms 3.0MB /api/x?y=1\n');
    const written: string[] = [];
    logTransfer({ at: 0, channel: 'vibproxy', path: '/a', ms: 5, bytes: 10 }, (l) => written.push(l));
    expect(written).toEqual([]);
    logTransfer({ at: 1_000, channel: 'vibproxy', path: '/a', ms: 500, bytes: 10 }, (l) => written.push(l));
    expect(written).toHaveLength(1);
  });

  it('cuts very long paths and flattens perf lines', () => {
    const long = `/api/${'a'.repeat(400)}`;
    expect(formatTransferLine({ at: 0, channel: 'c', path: long, ms: 100, bytes: 0 })).toContain('…');
    expect(formatPerfLine(0, '[perf-studio]  open\n  first-frame=10ms')).toBe('[1970-01-01T00:00:00.000Z] perf [perf-studio] open first-frame=10ms\n');
    const written: string[] = [];
    logPerfLine('x', (l) => written.push(l));
    expect(written[0]).toMatch(/ perf x\n$/);
  });
});

describe('§5.13 (Y) 40-7 ① — IPC 운반 배선(원문)', () => {
  const ipc = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fetchAt = ipc.indexOf("'vibisual:fetch'");
  const fetchBody = ipc.slice(fetchAt, ipc.indexOf("ipcMain.handle('vibisual:send'", fetchAt));

  it('collects the response as a stream and never stringifies binary bodies', () => {
    expect(fetchAt).toBeGreaterThan(-1);
    expect(fetchBody).toContain('payloadAsStream: true');
    expect(fetchBody).toContain('wire.bodyBytes');
    // 바이너리는 문자열로 바꾸지 않는다 — 텍스트만 utf8.
    expect(fetchBody).toMatch(/body: textual \? raw\.toString\('utf8'\) : ''/);
    expect(fetchBody).not.toMatch(/toString\('base64'\)/);
    expect(fetchBody).not.toContain('res.payload');
    expect(fetchBody).not.toContain('res.rawPayload');
    expect(fetchBody).toContain("channel: 'ipc-fetch'");
  });

  it('registers the perf channels the preload uses', () => {
    expect(ipc).toContain("ipcMain.handle('vibisual:perf:metrics'");
    expect(ipc).toContain("ipcMain.on('vibisual:perf:line'");
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('vibisual:perf:metrics')");
    expect(preload).toContain("ipcRenderer.send('vibisual:perf:line'");
  });
});
