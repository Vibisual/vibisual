import { describe, expect, it } from 'vitest';
import { CHAT_LOG_DEFAULT_LINES, CHAT_LOG_MAX_LINES } from '@vibisual/shared';
import { clampLogLines, commandForm, helpLines, parseChatCommand } from './commands';
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

describe('3단계 선택 명령 (/projects · /sessions)', () => {
  const s = chatStrings('ko');

  it('`/projects` 와 `/sessions` 를 우리 것으로 가로챈다', () => {
    expect(parseChatCommand('/projects')).toEqual({ type: 'projects' });
    expect(parseChatCommand('/sessions')).toEqual({ type: 'sessions' });
  });

  it('그룹 대화의 봇 이름 꼬리를 떼고 본다', () => {
    expect(parseChatCommand('/projects@MyVibiBot')).toEqual({ type: 'projects' });
    expect(parseChatCommand('/sessions@MyVibiBot')).toEqual({ type: 'sessions' });
  });

  it('대소문자를 가리지 않는다', () => {
    expect(parseChatCommand('/Projects')).toEqual({ type: 'projects' });
    expect(parseChatCommand('/SESSIONS')).toEqual({ type: 'sessions' });
  });

  it('비슷하지만 우리 것이 아닌 이름은 프롬프트로 흘려보낸다', () => {
    // `OWNED` 에 없는 슬래시 명령은 CLI 의 것일 수 있으므로 삼키지 않는다.
    expect(parseChatCommand('/project')).toEqual({ type: 'prompt', text: '/project' });
    expect(parseChatCommand('/session')).toEqual({ type: 'prompt', text: '/session' });
  });

  it('도움말이 세 칸을 모두 안내한다', () => {
    const joined = helpLines(true, s).join('\n');
    for (const cmd of ['/projects', '/agents', '/sessions']) {
      expect(joined).toContain(cmd);
    }
  });

  it('새 명령 이름도 번역하지 않는다 — 그 글자를 그대로 쳐야 동작한다', () => {
    for (const locale of ['en', 'ja', 'de', 'hi', 'es-419']) {
      const joined = helpLines(true, chatStrings(locale)).join('\n');
      expect(joined).toContain('/projects');
      expect(joined).toContain('/sessions');
    }
  });
});

describe('`!vibisual <명령>` — 디스코드에서 `/` 를 칠 수 없어 낸 같은 입구 (§4 ⑨-(f))', () => {
  it('접두어 형태와 슬래시 형태의 해석이 완전히 같다', () => {
    // 채널마다 해석이 갈리면 그때부터 두 벌이 된다 — 표기만 다르고 규칙은 하나여야 한다.
    for (const tail of ['projects', 'agents', 'sessions', 'status', 'stop', 'unpair', 'help', 'log 12']) {
      expect(parseChatCommand(`!vibisual ${tail}`)).toEqual(parseChatCommand(`/${tail}`));
    }
  });

  it('접두어만 보내면 안내다 — 폰에서 무엇을 칠 수 있는지 모를 때의 첫 한 줄', () => {
    expect(parseChatCommand('!vibisual')).toEqual({ type: 'help' });
    expect(parseChatCommand('  !vibisual   ')).toEqual({ type: 'help' });
  });

  it('공백 없이 이어지는 단어는 명령이 아니다 — 평문을 삼키면 안 된다', () => {
    expect(parseChatCommand('!vibisualize 해 줘')).toEqual({ type: 'prompt', text: '!vibisualize 해 줘' });
    expect(parseChatCommand('!vibisual-qa')).toEqual({ type: 'prompt', text: '!vibisual-qa' });
  });

  it('접두어 뒤의 `/` 는 슬래시 규칙 그대로 — CLI 명령으로 가는 탈출구', () => {
    // 디스코드 입력창이 `/` 를 가로채므로 `/compact` 를 보낼 길이 이것뿐이다.
    expect(parseChatCommand('!vibisual /compact')).toEqual({ type: 'prompt', text: '/compact' });
    expect(parseChatCommand('!vibisual /status')).toEqual({ type: 'status' });
  });

  it('우리 것이 아닌 이름을 접두어와 함께 보내면 안내로 받는다', () => {
    // 프롬프트로 흘리면 `!vibisual` 이라는 글자까지 에이전트에게 간다 — 그 자리는 안내가 맞다.
    expect(parseChatCommand('!vibisual 모르는것')).toEqual({ type: 'help' });
    expect(parseChatCommand('!vibisual project')).toEqual({ type: 'help' });
  });

  it('`/pair <token>` 과 `!vibisual pair <token>` 이 같은 페어링이다', () => {
    expect(parseChatCommand('/pair tok')).toEqual({ type: 'pair', token: 'tok' });
    expect(parseChatCommand('!vibisual pair tok')).toEqual({ type: 'pair', token: 'tok' });
  });

  it('로그 줄 수의 하드 캡은 접두어 형태에도 그대로 걸린다', () => {
    expect(parseChatCommand('!vibisual log 999999')).toEqual({ type: 'log', lines: CHAT_LOG_MAX_LINES });
    expect(parseChatCommand('!vibisual log')).toEqual({ type: 'log', lines: CHAT_LOG_DEFAULT_LINES });
  });
});

describe('commandForm — 안내문은 그 채널에서 실제로 칠 수 있는 모양이어야 한다', () => {
  it('디스코드 안내는 `!vibisual …` 로 적힌다', () => {
    const lines = helpLines(true, s, 'discord');
    const joined = lines.join('\n');
    expect(joined).toContain('!vibisual projects');
    expect(joined).toContain('!vibisual agents');
    expect(joined).toContain('!vibisual sessions');
    expect(lines.filter((l) => l.startsWith('!vibisual '))).toHaveLength(7);
    expect(lines.some((l) => l.startsWith('/'))).toBe(false);
  });

  it('텔레그램 안내는 슬래시 그대로다 — 거기서는 그것이 네이티브다', () => {
    const lines = helpLines(true, s, 'telegram');
    expect(lines.join('\n')).toContain('/projects');
    expect(lines.some((l) => l.startsWith('!vibisual'))).toBe(false);
  });

  it('채널을 주지 않으면 텔레그램 모양 — 기존 호출부가 그대로 산다', () => {
    expect(helpLines(true, s)).toEqual(helpLines(true, s, 'telegram'));
  });

  it('슬래시로 시작하지 않는 줄은 건드리지 않는다', () => {
    expect(commandForm(s.helpPlain, 'discord')).toBe(s.helpPlain);
    expect(commandForm(s.helpPlain, 'telegram')).toBe(s.helpPlain);
  });

  it('바꾸는 것은 앞머리뿐 — 뒤의 설명은 그대로 둔다', () => {
    expect(commandForm('/projects — 설명', 'discord')).toBe('!vibisual projects — 설명');
    expect(commandForm('/projects — 설명', 'telegram')).toBe('/projects — 설명');
  });

  it('페어링 전 안내는 채널과 무관하게 같다 — 연결하는 법에는 명령이 없다', () => {
    expect(helpLines(false, s, 'discord')).toEqual(helpLines(false, s, 'telegram'));
  });

  it('디스코드 안내에 적힌 그 글자를 그대로 치면 실제로 동작한다', () => {
    // 안내문 ↔ 파서가 어긋나면 "안 되는 것"을 알려 주는 안내가 된다. 모든 로케일에서 본다.
    for (const locale of ['en', 'ko', 'ja', 'zh-CN', 'es', 'es-419', 'fr', 'de', 'it', 'pt-BR', 'hi', 'id']) {
      for (const line of helpLines(true, chatStrings(locale), 'discord')) {
        if (!line.startsWith('!vibisual ')) continue;
        const typed = line.split('—')[0]?.trim() ?? '';
        expect(parseChatCommand(typed)).not.toMatchObject({ type: 'prompt' });
      }
    }
  });
});
