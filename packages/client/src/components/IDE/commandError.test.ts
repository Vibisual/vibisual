import { describe, it, expect } from 'vitest';
import { describeCommandError, parseStreamErrorContent, joinCommandErrorLine } from './commandError.js';

/**
 * §5.5 #17-12 ③ — "오류" 한 단어만 뜨던 자리에 사유가 서게 하는 순수 규칙.
 *
 * 여기서 못박는 것은 두 가지다: ① 사유를 **잃지 않는다**(모르는 코드·형식이 깨진 본문도 원문으로 남는다),
 * ② 종료 코드가 없을 때 `{{code}}` 문장을 고르지 않는다("code undefined" 가 화면에 뜨던 부류의 사고).
 */
describe('describeCommandError', () => {
  it('종료 코드가 있으면 코드 문장, 없으면 코드 없는 문장을 고른다', () => {
    expect(describeCommandError({ code: 'exit', exitCode: 1 })).toEqual({
      labelKey: 'ide.cmdError.exit', labelParams: { code: 1 }, detail: null,
    });
    expect(describeCommandError({ code: 'exit' })).toEqual({
      labelKey: 'ide.cmdError.exitUnknown', detail: null,
    });
    expect(describeCommandError({ code: 'crash' }).labelKey).toBe('ide.cmdError.crashUnknown');
  });

  it('코드 없는 사유는 그대로 키가 되고 원문은 다듬어 붙는다', () => {
    expect(describeCommandError({ code: 'maxTurns', detail: ' 3/3 ' })).toEqual({
      labelKey: 'ide.cmdError.maxTurns', detail: '3/3',
    });
    expect(describeCommandError({ code: 'orphaned' }).labelKey).toBe('ide.cmdError.orphaned');
  });

  it('모르는 코드도 버리지 않고 unknown 문장 + 원문으로 남긴다', () => {
    // 옛 체크포인트나 미래 서버가 보낸 코드 — 화면에서 사라지면 다시 "무슨 오류인지 모른다"가 된다.
    const d = describeCommandError({ code: 'wat' as never, detail: 'boom' });
    expect(d).toEqual({ labelKey: 'ide.cmdError.unknown', detail: 'boom' });
  });

  it('빈 원문은 null 로 눕혀 빈 줄이 생기지 않게 한다', () => {
    expect(describeCommandError({ code: 'cli', detail: '   ' }).detail).toBeNull();
  });
});

describe('parseStreamErrorContent', () => {
  it('[code:exit] 원문 형식을 되돌린다', () => {
    expect(parseStreamErrorContent('[exit:1] Error: boom')).toEqual({
      code: 'exit', exitCode: 1, detail: 'Error: boom',
    });
    expect(parseStreamErrorContent('[orphaned]')).toEqual({ code: 'orphaned' });
    expect(parseStreamErrorContent('[maxTurns] 3/3')).toEqual({ code: 'maxTurns', detail: '3/3' });
  });

  it('음수 종료 코드도 코드로 읽는다', () => {
    expect(parseStreamErrorContent('[crash:-1] died')).toEqual({ code: 'crash', exitCode: -1, detail: 'died' });
  });

  it('모르는 접두어·형식 파탄은 원문을 통째로 detail 로 남긴다', () => {
    expect(parseStreamErrorContent('[nope] hi')).toEqual({ code: 'exit', detail: 'hi' });
    expect(parseStreamErrorContent('그냥 오류 문장')).toEqual({ code: 'exit', detail: '그냥 오류 문장' });
    expect(parseStreamErrorContent('   ')).toEqual({ code: 'exit' });
  });
});

describe('joinCommandErrorLine', () => {
  it('한 줄 자리에서는 줄바꿈을 눕힌다', () => {
    expect(joinCommandErrorLine('오류', 'a\n\nb')).toBe('오류 — a b');
    expect(joinCommandErrorLine('오류', null)).toBe('오류');
  });
});
