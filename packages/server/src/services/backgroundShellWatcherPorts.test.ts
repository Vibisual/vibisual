/** §7.11 / §3.5 — "이미 쓰이고 있다" 줄(Vite `Port 8080 is in use, trying another one...`)에만 나온 포트는 뺀다 — 남의 서버 포트라 probe 를 통과해 남의 프리뷰가 선다. */
import { describe, it, expect } from 'vitest';
import { extractAllPortsFromLog } from './backgroundShellWatcher.js';

describe('extractAllPortsFromLog — "이미 쓰이고 있다" 줄의 포트', () => {
  it('Vite: 차 있던 포트는 빼고 옮겨 간 포트만', () => {
    const log = [
      'Port 5173 is in use, trying another one...',
      '',
      '  VITE v5.4.0  ready in 312 ms',
      '',
      '  ➜  Local:   http://localhost:5174/',
    ].join('\n');
    expect(extractAllPortsFromLog(log)).toEqual([5174]);
  });

  it('Next.js: "trying 3001 instead" 도 같은 규칙', () => {
    const log = [
      ' ⚠ Port 3000 is in use, trying 3001 instead.',
      '   ▲ Next.js 14.2.3',
      '   - Local:        http://localhost:3001',
    ].join('\n');
    expect(extractAllPortsFromLog(log)).toEqual([3001]);
  });

  it('Node EADDRINUSE: 그 포트 하나뿐이면 아무것도 뽑지 않는다', () => {
    expect(extractAllPortsFromLog('Error: listen EADDRINUSE: address already in use 127.0.0.1:8080')).toEqual([]);
  });

  it('"already running on" 도 남의 서버라는 진술이다', () => {
    expect(extractAllPortsFromLog('Server already running on http://localhost:8080')).toEqual([]);
  });

  it('같은 포트가 다른 줄(우리 서버의 Local 줄)에도 나오면 남긴다 — 남이 놓은 뒤 우리가 잡은 경우', () => {
    const log = [
      'Port 8080 is in use, trying another one...',
      'Local: http://localhost:8080/',
    ].join('\n');
    expect(extractAllPortsFromLog(log)).toEqual([8080]);
  });

  it('"쓰이고 있다" 줄이 없으면 종전과 같다', () => {
    expect(extractAllPortsFromLog('Server listening on port 3000')).toEqual([3000]);
    expect(extractAllPortsFromLog('dummy server on :3999')).toEqual([3999]);
  });

  it('ANSI 색·CRLF 가 섞여도 줄을 가른다', () => {
    const log = '\x1b[33mPort 5173 is in use, trying another one...\x1b[39m\r\n'
      + '  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5174\x1b[22m/\x1b[39m\r\n';
    expect(extractAllPortsFromLog(log)).toEqual([5174]);
  });
});
