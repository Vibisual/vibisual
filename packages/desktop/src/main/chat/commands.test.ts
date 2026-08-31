import { describe, expect, it } from 'vitest';
import { CHAT_LOG_DEFAULT_LINES, CHAT_LOG_MAX_LINES } from '@vibisual/shared';
import { clampLogLines, helpLines, parseChatCommand } from './commands';
import { chatStrings } from './strings';

// §4 메신저 브리지 — 폰에서 온 한 줄을 무엇으로 볼 것인가.
// 드라이버가 둘이라 해석이 두 벌이 되면 그때부터 어긋난다. 그 규칙을 여기서 고정한다.

const s = chatStrings('ko');

describe('parseChatCommand — 우리 것과 CLI 것의 경계', () => {
  it('모르는 슬래시 명령은 삼키지 않고 프롬프트로 흘려보낸다', () => {
    // `/compact`·`/스킬` 처럼 CLI 가 가진 명령을 폰에서 쓰는 길을 막지 않기 위한 규칙.
    expect(parseChatCommand('/compact')).toEqual({ type: 'prompt', text: '/compact' });
    expect(parseChatCommand('/vibisual-qa 훑어봐')).toEqual({ type: 'prompt', text: '/vibisual-qa 훑어봐' });
  });

  it('우리 명령은 가로챈다', () => {
    expect(parseChatCommand('/agents')).toEqual({ type: 'agents' });
    expect(parseChatCommand('/status')).toEqual({ type: 'status' });
    expect(parseChatCommand('/stop')).toEqual({ type: 'stop' });
    expect(parseChatCommand('/unpair')).toEqual({ type: 'unpair' });
    expect(parseChatCommand('/help')).toEqual({ type: 'help' });
  });

  it('그룹 대화의 `/status@MyBot` 은 봇 이름 꼬리를 떼고 본다', () => {
    expect(parseChatCommand('/status@VibisualBot')).toEqual({ type: 'status' });
    expect(parseChatCommand('/AGENTS@Bot')).toEqual({ type: 'agents' });
  });

  it('평문은 프롬프트다', () => {
    expect(parseChatCommand('테스트 좀 돌려 줘')).toEqual({ type: 'prompt', text: '테스트 좀 돌려 줘' });
  });

  it('빈 줄·공백뿐인 줄은 아무것도 아니다', () => {
    expect(parseChatCommand('')).toBeNull();
    expect(parseChatCommand('   \r\n  ')).toBeNull();
  });

  it('텔레그램 딥링크는 `/start <token>` 으로 도착한다', () => {
    expect(parseChatCommand('/start abc123')).toEqual({ type: 'pair', token: 'abc123' });
  });

  it('인자 없는 `/start` 는 안내다 — 봇을 처음 열면 자동으로 오는 그 줄', () => {
    expect(parseChatCommand('/start')).toEqual({ type: 'help' });
  });

  it('디스코드 페어링은 평문 한 줄이고 대소문자를 가리지 않는다', () => {
    expect(parseChatCommand('!vibisual pair tok')).toEqual({ type: 'pair', token: 'tok' });
    expect(parseChatCommand('!ViBiSuAl PaIr tok')).toEqual({ type: 'pair', token: 'tok' });
  });

  it('토큰 없는 페어링 명령은 안내로 떨어진다', () => {
    expect(parseChatCommand('!vibisual pair')).toEqual({ type: 'help' });
    expect(parseChatCommand('!vibisual pair   ')).toEqual({ type: 'help' });
  });

  it('앞뒤 공백과 CR 을 정리한다', () => {
    expect(parseChatCommand('  /stop \r\n')).toEqual({ type: 'stop' });
  });
});

describe('clampLogLines — 제3자로 나가는 양의 하드 캡', () => {
  it('숫자가 아니면 기본값', () => {
    expect(clampLogLines('')).toBe(CHAT_LOG_DEFAULT_LINES);
    expect(clampLogLines('abc')).toBe(CHAT_LOG_DEFAULT_LINES);
  });

  it('0 이하도 기본값', () => {
    expect(clampLogLines('0')).toBe(CHAT_LOG_DEFAULT_LINES);
    expect(clampLogLines('-5')).toBe(CHAT_LOG_DEFAULT_LINES);
  });

  it('상한을 넘으면 상한으로 접는다', () => {
    expect(clampLogLines('999999')).toBe(CHAT_LOG_MAX_LINES);
    expect(clampLogLines(String(CHAT_LOG_MAX_LINES + 1))).toBe(CHAT_LOG_MAX_LINES);
  });

  it('범위 안이면 그대로', () => {
    expect(clampLogLines('7')).toBe(7);
  });

  it('`/log 12` 가 그대로 이어진다', () => {
    expect(parseChatCommand('/log 12')).toEqual({ type: 'log', lines: 12 });
    expect(parseChatCommand('/log')).toEqual({ type: 'log', lines: CHAT_LOG_DEFAULT_LINES });
  });
});

describe('helpLines', () => {
  it('페어링 전에는 "어떻게 연결하는지"만 말한다(기능 목록을 흘리지 않는다)', () => {
    const lines = helpLines(false, s);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).not.toContain('/stop');
  });

  it('페어링 뒤에는 명령 목록을 준다', () => {
    const lines = helpLines(true, s);
    const joined = lines.join('\n');
    for (const cmd of ['/agents', '/status', '/log', '/stop', '/unpair']) {
      expect(joined).toContain(cmd);
    }
  });

  it('명령 이름은 번역하지 않는다 — 그 글자를 그대로 쳐야 동작한다', () => {
    for (const locale of ['en', 'ja', 'de', 'hi']) {
      expect(helpLines(true, chatStrings(locale)).join('\n')).toContain('/agents');
    }
  });

  it('`/log` 안내에 실제 기본값·상한이 채워진다', () => {
    const line = helpLines(true, s).find((l) => l.startsWith('/log'));
    expect(line).toContain(String(CHAT_LOG_DEFAULT_LINES));
    expect(line).toContain(String(CHAT_LOG_MAX_LINES));
    expect(line).not.toContain('{');
  });
});
