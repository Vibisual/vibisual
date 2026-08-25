import { describe, it, expect } from 'vitest';
import { COMMAND_ERROR_CODES, COMMAND_ERROR_CODES_WITH_EXIT } from '@vibisual/shared';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
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

  it('로컬 모델 실패는 자기 문장을 갖는다 — CLI 문장으로 새지 않는다', () => {
    // §5.19 — shared 에 `local` 이 생겼는데 여기 목록에 없어서 "알 수 없는 이유" 로 떨어지고,
    //   스트림 쪽은 `exit` 로 폴백해 **로컬 모델 실패를 "Claude CLI 가 종료됐다"** 로 말했다.
    const d = describeCommandError({ code: 'local', detail: 'model is incomplete' });
    expect(d).toEqual({ labelKey: 'ide.cmdError.local', detail: 'model is incomplete' });
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
    expect(parseStreamErrorContent('[local] model is incomplete')).toEqual({
      code: 'local', detail: 'model is incomplete',
    });
  });

  it('음수 종료 코드도 코드로 읽는다', () => {
    expect(parseStreamErrorContent('[crash:-1] died')).toEqual({ code: 'crash', exitCode: -1, detail: 'died' });
  });

  it('모르는 접두어·형식 파탄은 원문을 통째로 남기되 **누구의 실패인지 단정하지 않는다**', () => {
    // 예전엔 이 자리가 `exit` 였다 → 화면에서 "Claude CLI 가 예기치 않게 종료됐습니다" 로 굳어,
    //   CLI 를 쓰지도 않는 로컬 모델의 실패까지 Claude 탓으로 말했다(2026-08-20 사용자 보고).
    expect(parseStreamErrorContent('[nope] hi')).toEqual({ code: 'unknown', detail: 'hi' });
    expect(parseStreamErrorContent('그냥 오류 문장')).toEqual({ code: 'unknown', detail: '그냥 오류 문장' });
    expect(parseStreamErrorContent('   ')).toEqual({ code: 'unknown' });
    // 그 코드를 문장으로 옮기면 "알 수 없는 이유" — 원문은 그대로 남는다.
    expect(describeCommandError(parseStreamErrorContent('model is incomplete'))).toEqual({
      labelKey: 'ide.cmdError.unknown', detail: 'model is incomplete',
    });
  });
});

describe('joinCommandErrorLine', () => {
  it('한 줄 자리에서는 줄바꿈을 눕힌다', () => {
    expect(joinCommandErrorLine('오류', 'a\n\nb')).toBe('오류 — a b');
    expect(joinCommandErrorLine('오류', null)).toBe('오류');
  });
});

/**
 * §5.5 #17-12 ③ / §5.19 — **사유 코드가 늘면 문장도 함께 늘어야 한다.**
 *
 * 코드만 늘고 문장이 없으면 화면에 키(`ide.cmdError.local`)가 그대로 뜨거나, 목록에서 빠진 코드가
 * 다른 코드로 폴백해 **엉뚱한 엔진을 범인으로 지목한다**(로컬 모델 실패가 "Claude CLI 가 종료됐다"로
 * 뜬 사고). 코드 목록은 shared 한 벌이므로, 여기서 그 목록 전량에 문장이 있는지 확인한다.
 */
describe('사유 코드 ↔ 문장 대응', () => {
  const bundles: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['en', en as unknown as Record<string, unknown>],
    ['ko', ko as unknown as Record<string, unknown>],
  ];

  function sentence(bundle: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);
  }

  it('shared 의 모든 사유 코드가 en·ko 문장을 갖는다', () => {
    const missing: string[] = [];
    for (const [locale, bundle] of bundles) {
      for (const code of COMMAND_ERROR_CODES) {
        const keys = (COMMAND_ERROR_CODES_WITH_EXIT as readonly string[]).includes(code)
          ? [`ide.cmdError.${code}`, `ide.cmdError.${code}Unknown`]
          : [`ide.cmdError.${code}`];
        for (const key of keys) {
          if (typeof sentence(bundle, key) !== 'string') missing.push(`${locale}: ${key}`);
        }
      }
      if (typeof sentence(bundle, 'ide.cmdError.unknown') !== 'string') missing.push(`${locale}: ide.cmdError.unknown`);
    }
    expect(missing).toEqual([]);
  });

  it('모든 사유 코드가 자기 문장으로 간다 — 어느 것도 unknown 으로 새지 않는다', () => {
    const leaked = COMMAND_ERROR_CODES.filter(
      (code) => describeCommandError({ code, exitCode: 1 }).labelKey === 'ide.cmdError.unknown',
    );
    expect(leaked).toEqual([]);
  });

  it('CLI 를 이름으로 부르는 문장은 CLI 경로의 코드에만 붙는다', () => {
    // 로컬 모델처럼 `claude` 를 띄우지 않는 경로의 문장이 CLI 이름을 달면 사용자는 범인을 오해한다.
    const claudeNamed = COMMAND_ERROR_CODES.filter((code) => {
      const s = String(sentence(en as unknown as Record<string, unknown>, `ide.cmdError.${code}`) ?? '');
      return /claude/i.test(s);
    });
    expect(claudeNamed).not.toContain('local');
  });
});
