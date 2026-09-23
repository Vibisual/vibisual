import { describe, it, expect } from 'vitest';
import {
  AGENT_ENGINE_CLI_LABEL,
  COMMAND_ERROR_CODES,
  COMMAND_ERROR_CODES_WITH_EXIT,
  SUPPORTED_UI_LOCALES,
  UNKNOWN_ENGINE_CLI_LABEL,
  USAGE_LIMIT_PROMOTABLE_ERROR_CODES,
} from '@vibisual/shared';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import ja from '../../i18n/locales/ja.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import es from '../../i18n/locales/es.json';
import es419 from '../../i18n/locales/es-419.json';
import fr from '../../i18n/locales/fr.json';
import de from '../../i18n/locales/de.json';
import hi from '../../i18n/locales/hi.json';
import id from '../../i18n/locales/id.json';
import itIT from '../../i18n/locales/it.json';
import ptBR from '../../i18n/locales/pt-BR.json';
import { describeCommandError, engineLabelOf, parseStreamErrorContent, joinCommandErrorLine } from './commandError.js';

/**
 * §5.5 #17-12 ③ — "오류" 한 단어만 뜨던 자리에 사유가 서게 하는 순수 규칙.
 *
 * 여기서 못박는 것은 세 가지다: ① 사유를 **잃지 않는다**(모르는 코드·형식이 깨진 본문도 원문으로 남는다),
 * ② 종료 코드가 없을 때 `{{code}}` 문장을 고르지 않는다("code undefined" 가 화면에 뜨던 부류의 사고),
 * ③ 문장이 **제 엔진의 이름**을 부른다(③-7 — 코덱스 턴이 "Claude CLI" 로 불리던 사고).
 */
describe('describeCommandError', () => {
  it('종료 코드가 있으면 코드 문장, 없으면 코드 없는 문장을 고른다', () => {
    expect(describeCommandError({ code: 'exit', exitCode: 1 })).toEqual({
      labelKey: 'ide.cmdError.exit', labelParams: { code: 1, engine: 'CLI' }, detail: null,
    });
    expect(describeCommandError({ code: 'exit' })).toEqual({
      labelKey: 'ide.cmdError.exitUnknown', labelParams: { engine: 'CLI' }, detail: null,
    });
    expect(describeCommandError({ code: 'crash' }).labelKey).toBe('ide.cmdError.crashUnknown');
  });

  it('코드 없는 사유는 그대로 키가 되고 원문은 다듬어 붙는다', () => {
    expect(describeCommandError({ code: 'maxTurns', detail: ' 3/3 ' })).toEqual({
      labelKey: 'ide.cmdError.maxTurns', labelParams: { engine: 'CLI' }, detail: '3/3',
    });
    expect(describeCommandError({ code: 'orphaned' }).labelKey).toBe('ide.cmdError.orphaned');
  });

  it('모르는 코드도 버리지 않고 unknown 문장 + 원문으로 남긴다', () => {
    // 옛 체크포인트나 미래 서버가 보낸 코드 — 화면에서 사라지면 다시 "무슨 오류인지 모른다"가 된다.
    const d = describeCommandError({ code: 'wat' as never, detail: 'boom' });
    expect(d).toEqual({ labelKey: 'ide.cmdError.unknown', labelParams: { engine: 'CLI' }, detail: 'boom' });
  });

  it('로컬 모델 실패는 자기 문장을 갖는다 — CLI 문장으로 새지 않는다', () => {
    // §5.19 — shared 에 `local` 이 생겼는데 여기 목록에 없어서 "알 수 없는 이유" 로 떨어지고,
    //   스트림 쪽은 `exit` 로 폴백해 **로컬 모델 실패를 "Claude CLI 가 종료됐다"** 로 말했다.
    const d = describeCommandError({ code: 'local', detail: 'model is incomplete' });
    expect(d.labelKey).toBe('ide.cmdError.local');
    expect(d.detail).toBe('model is incomplete');
  });

  it('빈 원문은 null 로 눕혀 빈 줄이 생기지 않게 한다', () => {
    expect(describeCommandError({ code: 'cli', detail: '   ' }).detail).toBeNull();
  });
});

/**
 * §5.5 #17-12 ③-7 — **실패 문장은 제 엔진의 이름을 부른다.**
 *
 * 사유 코드는 엔진 중립이다(`cli`·`spawn`·`exit` 은 클로드도 코덱스도 낸다). 그런데 문장만
 * `Claude CLI` 를 글자로 박고 있어서, GPT 버블이 한도로 멈춘 자리에 **"Claude CLI 가 실패를
 * 알렸습니다"** 가 떴다(2026-09-22 사용자 보고 — GPT 버블 아래에 `opus` 가 뜬 §5.25 (J) 와 같은 부류).
 */
describe('엔진 이름', () => {
  it('엔진마다 제 이름을 부르고, 모르면 중립 이름으로 떨어진다', () => {
    expect(engineLabelOf('claude')).toBe('Claude CLI');
    expect(engineLabelOf('codex')).toBe('Codex CLI');
    // **모르는 엔진을 클로드로 단정하지 않는다** — 옛 명령·세션이 사라진 봉합분이 여기로 온다.
    expect(engineLabelOf(undefined)).toBe(UNKNOWN_ENGINE_CLI_LABEL);
    expect(engineLabelOf('gemini' as never)).toBe(UNKNOWN_ENGINE_CLI_LABEL);
  });

  it('shared 의 모든 엔진이 이름표를 갖는다 — 엔진이 늘어도 빈 이름이 뜨지 않는다', () => {
    for (const [engine, label] of Object.entries(AGENT_ENGINE_CLI_LABEL)) {
      expect(label.trim().length, `${engine} 이름표가 비었다`).toBeGreaterThan(0);
    }
  });

  it('사유가 엔진을 싣고 오면 그 엔진 이름이 문장에 들어간다', () => {
    expect(describeCommandError({ code: 'cli', engine: 'codex' }).labelParams).toEqual({ engine: 'Codex CLI' });
    expect(describeCommandError({ code: 'cli', engine: 'claude' }).labelParams).toEqual({ engine: 'Claude CLI' });
    expect(describeCommandError({ code: 'exit', exitCode: 1, engine: 'codex' }).labelParams)
      .toEqual({ code: 1, engine: 'Codex CLI' });
    expect(describeCommandError({ code: 'exit', engine: 'codex' })).toEqual({
      labelKey: 'ide.cmdError.exitUnknown', labelParams: { engine: 'Codex CLI' }, detail: null,
    });
  });

  it('엔진을 모르는 사유도 이름 자리를 비우지 않는다 — 화면에 {{engine}} 이 그대로 뜨면 안 된다', () => {
    for (const code of COMMAND_ERROR_CODES) {
      const withExit = describeCommandError({ code, exitCode: 1 });
      const withoutExit = describeCommandError({ code });
      for (const d of [withExit, withoutExit]) {
        expect(d.labelParams?.engine, `${code} 에 engine 파라미터가 없다`).toBe(UNKNOWN_ENGINE_CLI_LABEL);
      }
    }
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

  it('`@engine` 꼬리를 엔진으로 읽는다', () => {
    expect(parseStreamErrorContent('[cli@codex] stream error')).toEqual({
      code: 'cli', engine: 'codex', detail: 'stream error',
    });
    expect(parseStreamErrorContent('[exit:1@claude] boom')).toEqual({
      code: 'exit', exitCode: 1, engine: 'claude', detail: 'boom',
    });
    expect(parseStreamErrorContent('[orphaned@codex]')).toEqual({ code: 'orphaned', engine: 'codex' });
  });

  it('`@engine` 은 선택 꼬리다 — 그것이 없는 옛 줄도 종전대로 읽힌다', () => {
    // 체크포인트에 남아 있는 옛 스트림 줄이 통째로 `unknown` 으로 떨어지면 사유를 다시 잃는다.
    const old = parseStreamErrorContent('[cli] Claude Code process exited with code 1');
    expect(old.code).toBe('cli');
    expect(old.engine).toBeUndefined();
    expect(describeCommandError(old).labelParams).toEqual({ engine: UNKNOWN_ENGINE_CLI_LABEL });
  });

  it('모르는 엔진 낱말은 버리되 사유는 살린다', () => {
    // 미래 엔진이 붙은 줄을 옛 앱이 읽는 경우 — 이름은 몰라도 "무슨 오류인지"는 그대로 보여준다.
    expect(parseStreamErrorContent('[cli@gemini] boom')).toEqual({ code: 'cli', detail: 'boom' });
  });

  it('한도 정지 사유가 봉투를 왕복해도 그대로다', () => {
    const roundTrip = parseStreamErrorContent("[usageLimit@codex] You've hit your usage limit.");
    expect(roundTrip).toEqual({ code: 'usageLimit', engine: 'codex', detail: "You've hit your usage limit." });
    expect(describeCommandError(roundTrip).labelKey).toBe('ide.cmdError.usageLimit');
  });

  it('모르는 접두어·형식 파탄은 원문을 통째로 남기되 **누구의 실패인지 단정하지 않는다**', () => {
    // 예전엔 이 자리가 `exit` 였다 → 화면에서 "Claude CLI 가 예기치 않게 종료됐습니다" 로 굳어,
    //   CLI 를 쓰지도 않는 로컬 모델의 실패까지 Claude 탓으로 말했다(2026-08-20 사용자 보고).
    expect(parseStreamErrorContent('[nope] hi')).toEqual({ code: 'unknown', detail: 'hi' });
    expect(parseStreamErrorContent('그냥 오류 문장')).toEqual({ code: 'unknown', detail: '그냥 오류 문장' });
    expect(parseStreamErrorContent('   ')).toEqual({ code: 'unknown' });
    // 그 코드를 문장으로 옮기면 "알 수 없는 이유" — 원문은 그대로 남는다.
    expect(describeCommandError(parseStreamErrorContent('model is incomplete'))).toEqual({
      labelKey: 'ide.cmdError.unknown', labelParams: { engine: UNKNOWN_ENGINE_CLI_LABEL }, detail: 'model is incomplete',
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
  const BUNDLES: Record<string, Record<string, unknown>> = {
    en, ko, ja, 'zh-CN': zhCN, es, 'es-419': es419, fr, de, hi, id, it: itIT, 'pt-BR': ptBR,
  } as unknown as Record<string, Record<string, unknown>>;

  function sentence(bundle: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);
  }

  /** 한 사유가 쓰는 문장 키 전부(종료 코드로 갈리는 사유는 두 벌). */
  function keysOf(code: string): string[] {
    return (COMMAND_ERROR_CODES_WITH_EXIT as readonly string[]).includes(code)
      ? [`ide.cmdError.${code}`, `ide.cmdError.${code}Unknown`]
      : [`ide.cmdError.${code}`];
  }

  it('12개 로케일에 빠짐없이 들어 있다 — 한 로케일만 빠져도 그 언어에서 키가 그대로 뜬다', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual([...SUPPORTED_UI_LOCALES].sort());
    const missing: string[] = [];
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const code of COMMAND_ERROR_CODES) {
        for (const key of keysOf(code)) {
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

  /**
   * ③-7 의 **본 회귀**: 사유 문장에 엔진 이름을 글자로 박으면, 같은 사유 코드를 쓰는 다른 엔진의
   * 실패가 남의 이름으로 불린다. 이름은 `{{engine}}` 으로만 들어간다.
   */
  it('어느 로케일의 어느 사유 문장에도 엔진 이름이 글자로 박혀 있지 않다', () => {
    const named: string[] = [];
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const code of COMMAND_ERROR_CODES) {
        for (const key of keysOf(code)) {
          const s = String(sentence(bundle, key) ?? '');
          if (/claude|codex|gpt|openai|anthropic/i.test(s)) named.push(`${locale}/${key}: ${s}`);
        }
      }
    }
    expect(named).toEqual([]);
  });

  it('`{{engine}}` 을 쓰는 사유는 12개 로케일이 똑같다 — 한 로케일만 빠지면 그 언어에서 이름이 사라진다', () => {
    const slotsOf = (bundle: Record<string, unknown>): string[] =>
      COMMAND_ERROR_CODES.flatMap(keysOf)
        .filter((key) => String(sentence(bundle, key) ?? '').includes('{{engine}}'))
        .sort();
    const expected = slotsOf(en as unknown as Record<string, unknown>);
    // en 이 이름을 부르는 사유가 하나도 없으면 이 검사가 조용히 무의미해진다.
    expect(expected).toContain('ide.cmdError.cli');
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      expect(slotsOf(bundle), `${locale} 의 {{engine}} 자리가 en 과 다르다`).toEqual(expected);
    }
  });

  it('코덱스 한도 정지가 클로드 이름으로 불리지 않는다 — 이 변경이 막는 그 화면', () => {
    // 사용자가 본 줄: `[cli] You've hit your usage limit...` → "Claude CLI 가 실패를 알렸습니다".
    const seen = parseStreamErrorContent("[usageLimit@codex] You've hit your usage limit. Visit https://example.test");
    const desc = describeCommandError(seen);
    expect(desc.labelParams?.engine).toBe('Codex CLI');
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const s = String(sentence(bundle, desc.labelKey) ?? '');
      expect(s.length, `${locale} 에 ${desc.labelKey} 가 없다`).toBeGreaterThan(0);
      expect(/claude/i.test(s), `${locale} 의 한도 문장이 클로드를 부른다`).toBe(false);
    }
  });

  /**
   * §2.4 — 한도 정지로 **고쳐 적어도 되는** 사유 목록. 서버가 이 목록으로 사유를 고르므로,
   * 목록이 넓어지면 원인이 분명한 실패(스폰 실패·프로세스 사망)까지 "한도" 로 불린다.
   */
  it('한도로 고쳐 적는 사유는 「엔진이 실패를 신고했다」 부류뿐이다', () => {
    const promotable = [...USAGE_LIMIT_PROMOTABLE_ERROR_CODES].sort();
    expect(promotable).toEqual(['agentView', 'cli', 'exit']);
    for (const code of promotable) {
      expect(COMMAND_ERROR_CODES as readonly string[], `${code} 가 사유 목록에 없다`).toContain(code);
    }
    for (const code of ['spawn', 'stdin', 'crash', 'maxTurns', 'dispatchResult', 'local', 'orphaned'] as const) {
      expect(USAGE_LIMIT_PROMOTABLE_ERROR_CODES.has(code), `${code} 는 원인이 이미 분명하다`).toBe(false);
    }
  });
});
