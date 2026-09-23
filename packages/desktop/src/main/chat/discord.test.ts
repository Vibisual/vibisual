import { describe, expect, it } from 'vitest';
import { CHAT_DISCORD_MESSAGE_MAX } from '@vibisual/shared';
import type { ChatCard } from '@vibisual/shared';
import { buildDiscordAckData, buildDiscordMessage, splitAckToken } from './discord';
import { escapeDiscordMarkdown } from './cards';

// §4 메신저 브리지 — 디스코드로 나가는 한 벌의 **모양**.
//
// 여기 있는 것은 전부 **빠뜨려도 전송이 200 으로 성공하는** 종류다. 멘션이 발동하고, 링크
// 미리보기가 펼쳐지고, 경로가 기울어져도 API 는 아무 말도 하지 않는다 — 틀렸다는 것은 폰
// 화면에서만 드러난다. 그래서 드라이버에서 순수 함수로 떼어 여기서 고정한다.

const card = (over: Partial<ChatCard> = {}): ChatCard => ({
  kind: 'text', title: '제목', lines: ['본문'], ...over,
});

describe('escapeDiscordMarkdown — 디스코드에는 평문 스위치가 없다', () => {
  it('밑줄 두 개짜리 파일 이름이 기울지 않는다', () => {
    // `__init__.py` 를 그대로 보내면 디스코드는 밑줄 친 `init` 으로 그린다 — 복사할 수 없게 된다.
    expect(escapeDiscordMarkdown('__init__.py')).toBe('\\_\\_init\\_\\_.py');
  });

  it('모델이 쓴 굵게·코드 서식이 글자로 남는다', () => {
    expect(escapeDiscordMarkdown('**중요** `npm run build`'))
      .toBe('\\*\\*중요\\*\\* \\`npm run build\\`');
  });

  it('윈도 경로의 역슬래시가 뒤 글자를 먹지 않는다', () => {
    // 접지 않으면 `\*` 가 이스케이프로 먹혀 역슬래시가 사라진다 — 경로가 손상된다.
    expect(escapeDiscordMarkdown('C:\\src\\*.ts')).toBe('C:\\\\src\\\\\\*.ts');
  });

  it('URL 은 통째로 비켜 간다 — 안에 역슬래시가 들어가면 링크가 끊긴다', () => {
    const line = '참고: https://example.com/a_b_c?x=1|2 끝';
    expect(escapeDiscordMarkdown(line)).toBe('참고: https://example.com/a_b_c?x=1|2 끝');
  });

  it('URL 바깥은 같은 줄에서도 접는다', () => {
    expect(escapeDiscordMarkdown('a_b https://e.com/x_y c_d'))
      .toBe('a\\_b https://e.com/x_y c\\_d');
  });

  it('줄머리 #·>·- 는 제목·인용·목록이 되므로 그 자리에서만 접는다', () => {
    expect(escapeDiscordMarkdown('# 요약\n> 인용\n- 목록\n가운데 - 줄표'))
      .toBe('\\# 요약\n\\> 인용\n\\- 목록\n가운데 - 줄표');
  });

  it('줄머리를 접느라 방금 붙인 역슬래시를 다시 접지 않는다', () => {
    // 인라인을 먼저 접는 순서가 깨지면 `\\*강조` 가 되어 화면에 역슬래시가 남는다.
    expect(escapeDiscordMarkdown('*강조*')).toBe('\\*강조\\*');
  });

  it('건드릴 것이 없는 줄은 그대로 둔다', () => {
    expect(escapeDiscordMarkdown('[!] 권한 요청 — 에이전트')).toBe('[!] 권한 요청 — 에이전트');
  });
});

describe('buildDiscordMessage — 보호막 셋', () => {
  it('멘션을 발동시키지 않는다', () => {
    const body = buildDiscordMessage(card({ lines: ['@everyone <@1234567890> 확인'] }));
    expect(body['allowed_mentions']).toEqual({ parse: [] });
  });

  it('링크 미리보기를 억제한다 — 텔레그램 disable_web_page_preview 와 같은 자리', () => {
    expect(buildDiscordMessage(card())['flags']).toBe(4);
  });

  it('본문은 이스케이프를 지나서 실린다', () => {
    const body = buildDiscordMessage(card({ lines: ['C:/src/__init__.py'] }));
    expect(String(body['content'])).toContain('\\_\\_init\\_\\_.py');
  });

  it('버튼이 없으면 components 를 붙이지 않는다', () => {
    expect(buildDiscordMessage(card())).not.toHaveProperty('components');
  });

  it('버튼은 한 줄에 5개씩, 최대 5줄까지만 싣는다', () => {
    const actions = Array.from({ length: 40 }, (_, i) => ({ actionId: `pj:${String(i)}`, label: `p${String(i)}` }));
    const rows = buildDiscordMessage(card({ actions }))['components'] as { components: unknown[] }[];
    expect(rows).toHaveLength(5);
    expect(rows.flatMap((r) => r.components)).toHaveLength(25);
  });

  it('세션 칸 한 장(20 + 새 세션)은 잘리지 않고 전부 들어간다', () => {
    const actions = [
      ...Array.from({ length: 20 }, (_, i) => ({ actionId: `sn:${String(i)}`, label: `s${String(i)}` })),
      { actionId: 'sn:*', label: '새 세션', style: 'primary' as const },
    ];
    const rows = buildDiscordMessage(card({ actions }))['components'] as { components: unknown[] }[];
    expect(rows.flatMap((r) => r.components)).toHaveLength(21);
  });

  it('버튼 style 을 디스코드 번호로 옮긴다', () => {
    const actions = [
      { actionId: 'p:1:a', label: '허용', style: 'primary' as const },
      { actionId: 'p:1:d', label: '거부', style: 'danger' as const },
      { actionId: 'x', label: '그냥' },
    ];
    const rows = buildDiscordMessage(card({ actions }))['components'] as { components: { style: number }[] }[];
    expect(rows[0]?.components.map((c) => c.style)).toEqual([1, 4, 2]);
  });

  it('이스케이프로 길어져도 메시지 상한을 넘기지 않는다', () => {
    // 이스케이프는 글자를 **늘린다** — 접기를 렌더 뒤에 한 번 더 하지 않으면 2000자를 넘겨
    // 디스코드가 카드를 통째로 거부한다(폰에 아무것도 안 뜬다).
    const body = buildDiscordMessage(card({ lines: ['_'.repeat(3000)] }));
    const content = String(body['content']);
    expect(content.length).toBeLessThanOrEqual(CHAT_DISCORD_MESSAGE_MAX);
    expect(content.endsWith('…')).toBe(true);
  });

  it('잘린 끝에 역슬래시를 홀수로 남기지 않는다', () => {
    const content = String(buildDiscordMessage(card({ lines: ['*'.repeat(3000)] }))['content']);
    const tail = /\\*$/.exec(content.slice(0, -1))?.[0].length ?? 0;
    expect(tail % 2).toBe(0);
  });
});

describe('buildDiscordAckData — 버튼 회신도 채널에 보이는 한 줄이다', () => {
  it('할 말이 없으면 null — 빈 content 는 400 이라 type 6 으로 가야 한다', () => {
    expect(buildDiscordAckData('')).toBeNull();
    expect(buildDiscordAckData('   ')).toBeNull();
  });

  it('회신에도 같은 보호막을 쓴다', () => {
    const data = buildDiscordAckData('보냈습니다 — C:/a/__x__.ts');
    expect(data?.['allowed_mentions']).toEqual({ parse: [] });
    expect(data?.['flags']).toBe(4);
    expect(String(data?.['content'])).toContain('\\_\\_x\\_\\_.ts');
  });
});

describe('splitAckToken — 회신 주소는 첫 콜론에서만 갈린다', () => {
  it('보통의 한 쌍을 가른다', () => {
    expect(splitAckToken('1420:aXRz')).toEqual({ id: '1420', token: 'aXRz' });
  });

  it('토큰 안의 콜론을 잘라내지 않는다 — 여기서 잘리면 회신이 404 로 사라진다', () => {
    // `split(':')` 로 갈라 두 번째 조각만 쓰면 주소가 조용히 손상되고, 폰에는 버튼을
    // 누른 자리에 "이 상호작용에 실패했습니다" 만 뜬다. 서버 쪽엔 아무 흔적도 남지 않는다.
    expect(splitAckToken('1420:tok:with:colons')).toEqual({ id: '1420', token: 'tok:with:colons' });
  });

  it('콜론이 없으면 주소가 아니다', () => {
    expect(splitAckToken('1420')).toBeNull();
    expect(splitAckToken('')).toBeNull();
  });

  it('한쪽이 비면 주소가 아니다 — 빈 id·빈 토큰으로 PATCH 를 쏘지 않는다', () => {
    expect(splitAckToken(':tok')).toBeNull();
    expect(splitAckToken('1420:')).toBeNull();
    expect(splitAckToken(':')).toBeNull();
  });
});
