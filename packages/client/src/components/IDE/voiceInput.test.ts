import { describe, expect, it } from 'vitest';
import {
  VOICE_INPUT,
  emptyVoiceLevels,
  isFatalVoiceError,
  isVoiceToggleKey,
  levelFromTimeDomain,
  mapMediaError,
  mapVoiceError,
  mergeVoiceText,
  pushVoiceLevel,
  voiceRecognitionLang,
  type VoiceKeyLike,
} from '@vibisual/shared';

/**
 * §5.5 #17-38 음성 받아쓰기 — **판정만 따로 고정한다.**
 *
 * 이 기능의 나머지(마이크 열기·인식·파형 그리기)는 브라우저와 화면이 하지만, 틀리면 사용자가
 * 바로 아는 자리는 전부 여기 순수 함수들이다: 단축키가 안 먹거나(세 OS), 말한 것이 엉뚱한
 * 자리에 붙거나, 실패했는데 왜 실패했는지 화면이 말하지 못하는 것.
 *
 * 특히 **단축키는 실기 없이 세 OS 를 확인할 수 있는 유일한 길**이다 — mac 은 `metaKey`,
 * win/linux 는 `ctrlKey` 로 같은 손짓이 오는데, 우리에게 mac 실기가 없다.
 */

function key(over: Partial<VoiceKeyLike> = {}): VoiceKeyLike {
  return { code: 'KeyM', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

describe('isVoiceToggleKey — 세 OS 가 같은 손짓을 같은 뜻으로', () => {
  it('win/linux 는 Ctrl+Shift+M', () => {
    expect(isVoiceToggleKey(key({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('mac 은 ⇧⌘M — metaKey 로 온다', () => {
    expect(isVoiceToggleKey(key({ metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('Shift 가 빠지면 우리 것이 아니다 — Ctrl+M 은 다른 곳에 남겨 둔다', () => {
    expect(isVoiceToggleKey(key({ ctrlKey: true }))).toBe(false);
  });

  it('수식키 없이 M 만 누른 것은 그냥 글자다', () => {
    expect(isVoiceToggleKey(key({ shiftKey: true }))).toBe(false);
    expect(isVoiceToggleKey(key())).toBe(false);
  });

  it('Alt 가 끼면 통째로 비켜선다 — 유럽 자판의 AltGr(=Ctrl+Alt)이 글자 입력을 잃지 않게', () => {
    expect(isVoiceToggleKey(key({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });

  it('다른 물리 키는 아니다', () => {
    expect(isVoiceToggleKey(key({ code: 'KeyN', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('판정은 `code` 라 자판 배열이 달라도 같다 — 같은 자리를 누르면 같은 뜻', () => {
    // Dvorak·AZERTY 에서 이 자리의 `key` 는 다른 글자지만 `code` 는 여전히 KeyM 이다.
    expect(isVoiceToggleKey(key({ code: 'KeyM', metaKey: true, shiftKey: true }))).toBe(true);
  });
});

describe('mergeVoiceText — 말한 것은 커서 자리에 들어간다', () => {
  it('빈 입력창이면 그대로 들어간다(앞 공백 ❌)', () => {
    expect(mergeVoiceText('', 0, 0, '테스트를 돌려줘')).toEqual({ text: '테스트를 돌려줘', caret: 8 });
  });

  it('끝에 이어 말하면 한 칸 띄고 붙는다', () => {
    const r = mergeVoiceText('테스트를', 4, 4, '돌려줘');
    expect(r.text).toBe('테스트를 돌려줘');
    expect(r.caret).toBe(r.text.length);
  });

  it('앞이 이미 공백이면 두 칸 띄지 않는다', () => {
    expect(mergeVoiceText('run ', 4, 4, 'the tests').text).toBe('run the tests');
  });

  it('문장 가운데에 끼우면 그 자리에 들어가고 뒤도 붙지 않는다', () => {
    const r = mergeVoiceText('run tests', 4, 4, 'the');
    expect(r.text).toBe('run the tests');
    // 커서는 끼운 말의 끝 — 뒤 공백까지 지나서 서면 다음 말이 두 칸 띄어 들어간다.
    expect(r.text.slice(0, r.caret)).toBe('run the');
  });

  it('선택 범위가 있으면 그것을 갈아 끼운다', () => {
    expect(mergeVoiceText('run tests', 4, 9, 'build').text).toBe('run build');
  });

  it('문장부호로 시작하면 앞말에 붙인다', () => {
    expect(mergeVoiceText('끝났다', 3, 3, '.').text).toBe('끝났다.');
  });

  it('여는 괄호 뒤에는 붙여 쓴다', () => {
    expect(mergeVoiceText('foo(', 4, 4, 'bar').text).toBe('foo(bar');
  });

  it('뒤 글자가 문장부호면 공백을 넣지 않는다', () => {
    expect(mergeVoiceText('아직.', 2, 2, '멀었다').text).toBe('아직 멀었다.');
  });

  it('빈 토막·공백뿐인 토막은 입력창을 건드리지 않는다', () => {
    expect(mergeVoiceText('그대로', 1, 1, '   ')).toEqual({ text: '그대로', caret: 1 });
  });

  it('커서가 범위를 벗어나 들어와도 안전하다 — 길이로 접고, 접힌 범위를 선택으로 본다', () => {
    // 99 와 -3 은 각각 2·0 으로 접히므로 "전체 선택"이 되고, 그 규칙대로 통째로 갈아 끼운다.
    expect(mergeVoiceText('ab', 99, -3, 'X')).toEqual({ text: 'X', caret: 1 });
  });

  it('줄바꿈 뒤에는 공백을 더하지 않는다', () => {
    expect(mergeVoiceText('첫 줄\n', 4, 4, '둘째 줄').text).toBe('첫 줄\n둘째 줄');
  });
});

describe('pushVoiceLevel — 파형은 실제로 잰 세기의 기록이다', () => {
  it('막대 수는 항상 고정이다', () => {
    let levels = emptyVoiceLevels();
    expect(levels).toHaveLength(VOICE_INPUT.BAR_COUNT);
    for (let i = 0; i < VOICE_INPUT.BAR_COUNT * 2; i += 1) levels = pushVoiceLevel(levels, 0.5);
    expect(levels).toHaveLength(VOICE_INPUT.BAR_COUNT);
  });

  it('새 값은 오른쪽 끝에 들어가고 가장 오래된 것이 밀려난다', () => {
    const levels = pushVoiceLevel(emptyVoiceLevels(), 0.7);
    expect(levels[levels.length - 1]).toBe(0.7);
    expect(levels[0]).toBe(0);
  });

  it('범위를 벗어난 값은 접는다(NaN 포함)', () => {
    expect(pushVoiceLevel([], 5).slice(-1)[0]).toBe(1);
    expect(pushVoiceLevel([], -2).slice(-1)[0]).toBe(0);
    expect(pushVoiceLevel([], Number.NaN).slice(-1)[0]).toBe(0);
  });

  it('짧은 기록에서 시작해도 앞을 0 으로 채워 길이를 맞춘다', () => {
    expect(pushVoiceLevel([0.4], 0.6)).toHaveLength(VOICE_INPUT.BAR_COUNT);
  });
});

describe('levelFromTimeDomain — 조용하면 0, 말하면 오른다', () => {
  it('무음(전부 128)은 0', () => {
    expect(levelFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('표본이 없으면 0 — 나누기 전에 막는다', () => {
    expect(levelFromTimeDomain(new Uint8Array(0))).toBe(0);
  });

  it('큰 진폭은 1 에서 멈춘다(천장을 넘지 않는다)', () => {
    const loud = new Uint8Array(64);
    for (let i = 0; i < loud.length; i += 1) loud[i] = i % 2 === 0 ? 0 : 255;
    expect(levelFromTimeDomain(loud)).toBe(1);
  });

  it('작은 소리는 0 과 1 사이로 온다', () => {
    const quiet = new Uint8Array(64);
    for (let i = 0; i < quiet.length; i += 1) quiet[i] = i % 2 === 0 ? 126 : 130;
    const level = levelFromTimeDomain(quiet);
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(1);
  });
});

describe('실패 사유 — 화면이 원인을 말할 수 있게', () => {
  it('인식기 실패를 우리 코드로 접는다', () => {
    expect(mapVoiceError('not-allowed')).toBe('permission');
    expect(mapVoiceError('service-not-allowed')).toBe('permission');
    expect(mapVoiceError('audio-capture')).toBe('device');
    expect(mapVoiceError('network')).toBe('network');
    expect(mapVoiceError('language-not-supported')).toBe('language');
    expect(mapVoiceError('no-speech')).toBe('no-speech');
    expect(mapVoiceError('aborted')).toBe('aborted');
  });

  it('모르는 값은 지어내지 않고 unknown 으로 떨어진다', () => {
    expect(mapVoiceError('made-up')).toBe('unknown');
    expect(mapVoiceError(undefined)).toBe('unknown');
    expect(mapVoiceError(null)).toBe('unknown');
  });

  it('마이크 열기 실패는 다른 표로 접는다 — 어느 단계가 막혔는지 갈려야 한다', () => {
    expect(mapMediaError('NotAllowedError')).toBe('permission');
    expect(mapMediaError('NotFoundError')).toBe('device');
    expect(mapMediaError('NotReadableError')).toBe('device');
    expect(mapMediaError('AbortError')).toBe('aborted');
    expect(mapMediaError('WhoKnowsError')).toBe('unknown');
  });

  it('멈춰야 하는 실패와 그냥 계속 들어도 되는 것을 가른다', () => {
    expect(isFatalVoiceError('permission')).toBe(true);
    expect(isFatalVoiceError('device')).toBe(true);
    expect(isFatalVoiceError('network')).toBe(true);
    expect(isFatalVoiceError('unsupported')).toBe(true);
    // 아무 말도 안 했다고 마이크를 끄면, 잠깐 생각하는 사이에 꺼진다.
    expect(isFatalVoiceError('no-speech')).toBe(false);
    expect(isFatalVoiceError('aborted')).toBe(false);
  });
});

describe('voiceRecognitionLang — 화면 언어를 그대로 듣는다', () => {
  it('12개 로케일이 전부 지역까지 붙은 코드로 간다', () => {
    const table: Record<string, string> = {
      ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-CN': 'zh-CN',
      de: 'de-DE', es: 'es-ES', 'es-419': 'es-MX', fr: 'fr-FR',
      hi: 'hi-IN', id: 'id-ID', it: 'it-IT', 'pt-BR': 'pt-BR',
    };
    for (const [locale, expected] of Object.entries(table)) {
      expect(voiceRecognitionLang(locale)).toBe(expected);
    }
  });

  it('지역이 붙어 들어와도 앞 조각으로 찾는다', () => {
    expect(voiceRecognitionLang('ko-KR')).toBe('ko-KR');
    expect(voiceRecognitionLang('en-GB')).toBe('en-US');
  });

  it('비어 있으면 영어로 떨어진다', () => {
    expect(voiceRecognitionLang('')).toBe('en-US');
    expect(voiceRecognitionLang(undefined)).toBe('en-US');
  });

  it('표에 없는 것은 그대로 넘긴다 — 인식기가 알면 쓰고, 모르면 사유를 돌려준다', () => {
    expect(voiceRecognitionLang('sv')).toBe('sv');
  });
});
