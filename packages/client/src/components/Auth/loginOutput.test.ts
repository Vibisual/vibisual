import { describe, it, expect } from 'vitest';
import { stripAnsi, scanLoginOutput } from './loginOutput.js';

// §4 v4.82 — 로그인 팝업이 PTY 출력에서 뽑아내는 것들. 화면 없이 문구 규칙만 고정한다.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('stripAnsi', () => {
  it('CSI 색/커서 시퀀스를 지운다', () => {
    expect(stripAnsi(`${ESC}[1;32mReady${ESC}[0m`)).toBe('Ready');
    expect(stripAnsi(`${ESC}[2J${ESC}[HHello`)).toBe('Hello');
  });

  it('OSC 창 제목은 버리고 OSC 8 하이퍼링크의 URL 은 남긴다', () => {
    expect(stripAnsi(`${ESC}]0;claude${BEL}done`)).toBe('done');
    expect(stripAnsi(`${ESC}]8;;https://claude.ai/oauth/authorize?x=1${BEL}link${ESC}]8;;${BEL}`))
      .toBe('https://claude.ai/oauth/authorize?x=1link');
  });

  it('일반 텍스트는 그대로 둔다', () => {
    expect(stripAnsi('paste code here:')).toBe('paste code here:');
  });
});

describe('scanLoginOutput', () => {
  it('OAuth 승인 URL 을 뽑는다', () => {
    const out = `Opening browser…\r\nIf it did not open, visit:\r\n  https://claude.ai/oauth/authorize?code=1&state=abc\r\n`;
    expect(scanLoginOutput(out).url).toBe('https://claude.ai/oauth/authorize?code=1&state=abc');
  });

  it('색이 섞여 있어도 URL 을 찾는다', () => {
    const out = `${ESC}[36mhttps://console.anthropic.com/oauth/authorize?x=1${ESC}[0m`;
    expect(scanLoginOutput(out).url).toBe('https://console.anthropic.com/oauth/authorize?x=1');
  });

  it('안내 링크보다 OAuth 링크를 고른다', () => {
    const out = 'Docs: https://docs.anthropic.com/claude-code\nVisit https://claude.ai/oauth/authorize?x=9';
    expect(scanLoginOutput(out).url).toBe('https://claude.ai/oauth/authorize?x=9');
  });

  it('문장 끝 구두점은 URL 에서 뗀다', () => {
    expect(scanLoginOutput('go to https://claude.ai/oauth/authorize?x=1.').url)
      .toBe('https://claude.ai/oauth/authorize?x=1');
  });

  it('코드 요구 프롬프트를 알아본다', () => {
    expect(scanLoginOutput('Paste code here if prompted:').wantsCode).toBe(true);
    expect(scanLoginOutput('Enter the authorization code: ').wantsCode).toBe(true);
    expect(scanLoginOutput('Opening browser…').wantsCode).toBeUndefined();
  });

  it('성공·실패 문구를 알아본다', () => {
    expect(scanLoginOutput('Login successful. Press Enter to continue').succeeded).toBe(true);
    expect(scanLoginOutput('Login failed: invalid code').failed).toBe(true);
    expect(scanLoginOutput('Waiting…').succeeded).toBeUndefined();
  });

  it('실패 뒤에 성공하면 실패 표시를 지운다(재시도)', () => {
    const out = 'Login failed: invalid code\nRetrying…\nLogin successful';
    const scan = scanLoginOutput(out);
    expect(scan.succeeded).toBe(true);
    expect(scan.failed).toBeUndefined();
  });

  it('URL 이 없으면 url 은 비어 있다', () => {
    expect(scanLoginOutput('Starting…').url).toBeUndefined();
  });

  it('줄바꿈으로 잘린 URL 을 이어 붙인다', () => {
    const out = 'https://claude.ai/oauth/authorize?code=abc\ndef&state=1';
    expect(scanLoginOutput(out).url).toBe('https://claude.ai/oauth/authorize?code=abcdef&state=1');
  });
});
