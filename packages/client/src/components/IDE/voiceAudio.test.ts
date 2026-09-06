/**
 * §5.5 #17-38 ⑰⑱ — 마이크를 어떻게 받고, 받아 온 글을 어떻게 다듬는가.
 *
 * 두 축 다 **사용자가 실제로 겪은 고장**에서 나왔다(스피커 소리가 마이크로 들어온다 ·
 * 띄어쓰기가 전혀 안 된다). 그래서 테스트도 그 두 문장을 그대로 고정한다 — 규칙을 손보다
 * 옛 증상이 돌아오면 여기서 걸린다.
 */
import { describe, expect, it } from 'vitest';
import {
  polishVoiceChunk,
  readVoiceProcessing,
  respaceKorean,
  shouldWarnEcho,
  voiceAudioConstraints,
} from '@vibisual/shared';

describe('voiceAudioConstraints — ⑰ 마이크가 말만 담게', () => {
  it('에코 제거·잡음 억제·자동 이득을 **이름을 불러** 켠다', () => {
    const c = voiceAudioConstraints();
    expect(c.echoCancellation).toEqual({ ideal: true });
    expect(c.noiseSuppression).toEqual({ ideal: true });
    expect(c.autoGainControl).toEqual({ ideal: true });
  });

  it('모노로 받는다 — 인식기는 첫 채널만 읽는다', () => {
    expect(voiceAudioConstraints().channelCount).toEqual({ ideal: 1 });
  });

  it('**`exact` 를 쓰지 않는다** — 못 하는 장치에서 마이크가 아예 안 열리면 안 된다', () => {
    const c = voiceAudioConstraints('mic-1') as Record<string, unknown>;
    for (const v of Object.values(c)) {
      expect(JSON.stringify(v)).not.toContain('exact');
    }
  });

  it('표본율은 걸지 않는다 — 우리가 downsampleTo16k 로 맞춘다', () => {
    expect(voiceAudioConstraints().sampleRate).toBeUndefined();
  });

  it('고른 장치는 `ideal` 로 — 그 마이크를 뽑아도 기본 장치로 넘어가야 한다', () => {
    expect(voiceAudioConstraints('usb-mic').deviceId).toEqual({ ideal: 'usb-mic' });
  });

  it('빈 장치 id 는 아예 넣지 않는다(빈 문자열로 거는 것은 제약이 아니다)', () => {
    expect(voiceAudioConstraints('').deviceId).toBeUndefined();
    expect(voiceAudioConstraints(null).deviceId).toBeUndefined();
    expect(voiceAudioConstraints(undefined).deviceId).toBeUndefined();
    expect(voiceAudioConstraints('   ').deviceId).toBeUndefined();
  });
});

describe('readVoiceProcessing / shouldWarnEcho — 부탁과 실제를 가른다', () => {
  it('브라우저가 안 알려 준 값은 `null` 이다 — 꺼짐이 아니다', () => {
    const p = readVoiceProcessing({});
    expect(p.echoCancellation).toBeNull();
    expect(shouldWarnEcho(p)).toBe(false);
  });

  it('트랙이 없어 settings 를 못 읽어도 경고하지 않는다', () => {
    expect(shouldWarnEcho(readVoiceProcessing(null))).toBe(false);
    expect(shouldWarnEcho(readVoiceProcessing(undefined))).toBe(false);
  });

  it('**확실히 꺼진 채 열렸을 때만** 경고한다', () => {
    expect(shouldWarnEcho(readVoiceProcessing({ echoCancellation: false }))).toBe(true);
    expect(shouldWarnEcho(readVoiceProcessing({ echoCancellation: true }))).toBe(false);
  });

  it('참·거짓이 아닌 값(구현체마다 다른 보고)은 모르는 것으로 접는다', () => {
    const weird = { echoCancellation: 'on' } as unknown as MediaTrackSettings;
    expect(readVoiceProcessing(weird).echoCancellation).toBeNull();
    expect(shouldWarnEcho(readVoiceProcessing(weird))).toBe(false);
  });
});

describe('respaceKorean — ⑱ 붙어 나온 말을 띄운다', () => {
  it('사용자가 실제로 겪은 그 문장을 끊는다', () => {
    const got = respaceKorean('이게컴퓨터의소리까지전부다마이크에들어가니까');
    // 정확한 어절 경계를 못 박지 않는다(규칙이 나아지면 갈린다) — **끊겼다는 것**을 고정한다.
    expect(got).toContain(' ');
    expect(got.split(' ').length).toBeGreaterThanOrEqual(3);
    // 글자는 하나도 잃지 않는다 — 띄우기지 고쳐 쓰기가 아니다.
    expect(got.replace(/ /g, '')).toBe('이게컴퓨터의소리까지전부다마이크에들어가니까');
  });

  it('조사 뒤에서 끊는다 — `…에서` 다음', () => {
    const got = respaceKorean('서버에서데이터를가져옵니다');
    expect(got.replace(/ /g, '')).toBe('서버에서데이터를가져옵니다');
    expect(got).toContain(' ');
  });

  /**
   * ⚠ **여기부터가 첫 판이 무너졌던 자리다**(2026-09-04 실측). 규칙을 손볼 때 이 셋이 다시
   * 깨지면 그 손질은 틀린 것이다 — **틀리게 끊는 것은 안 끊는 것보다 나쁘다.**
   */
  it('낱말 한가운데를 자르지 않는다 — 오른쪽 조각이 조사로 시작하면 그 자리는 틀렸다', () => {
    // `가져와서` 를 `가져와`+`서화면` 으로 가르던 자리.
    expect(respaceKorean('서버에서데이터를가져와서화면에보여주세요')).not.toContain(' 서화면');
    // `작업에서는` 을 `작업에서`+`는서버` 로 가르던 자리.
    expect(respaceKorean('이번작업에서는서버쪽을먼저고치고화면은나중에봅니다')).not.toContain(' 는서버');
  });

  it('어미를 앞말에서 떼어내지 않는다 — `없을까` 는 `없을 까` 가 아니다', () => {
    expect(respaceKorean('컴퓨터의노이즈소리막을수없을까')).not.toContain(' 까');
  });

  it('덩어리 **맨 앞**의 머리말도 끊는다 — 앞에서 끊는 규칙만으로는 못 잡는 자리', () => {
    expect(respaceKorean('그리고띄어쓰기가전혀안돼이런거해결방법없나')).toMatch(/^그리고 /);
    expect(respaceKorean('이게컴퓨터의소리까지전부다마이크에들어가니까')).toMatch(/^이게 /);
  });

  it('**낱글자 조각을 만들지 않는다** — 붙어 있는 것보다 나쁘다', () => {
    for (const piece of respaceKorean('이것을저것으로바꿔주세요').split(' ')) {
      expect(piece.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('한글이 없으면 그대로 둔다 — 영어는 엔진이 이미 띄운다', () => {
    const en = 'please run the build and check the output';
    expect(respaceKorean(en)).toBe(en);
  });

  it('이미 띄어져 있으면 손대지 않는다 — 엔진이 판올림돼 공백을 내기 시작해도 안전하다', () => {
    const spaced = '서버에서 데이터를 가져옵니다';
    expect(respaceKorean(spaced)).toBe(spaced);
  });

  it('짧은 토막은 그대로 둔다 — 끊을 것이 없다', () => {
    expect(respaceKorean('네')).toBe('네');
    expect(respaceKorean('알겠습니다')).toBe('알겠습니다');
  });

  it('빈 문자열에 죽지 않는다', () => {
    expect(respaceKorean('')).toBe('');
  });

  it('영문·숫자는 건드리지 않고 한글 덩어리만 끊는다', () => {
    const got = respaceKorean('API를호출해서결과를확인해주세요');
    expect(got).toContain('API');
    // 영문 토막이 쪼개지지 않았다.
    expect(got).not.toMatch(/A\s+P|P\s+I/);
  });

  it('같은 입력은 항상 같은 결과다(역추적 없는 한 번 훑기)', () => {
    const input = '이번작업에서는서버쪽을먼저고치고화면은나중에봅니다';
    expect(respaceKorean(input)).toBe(respaceKorean(input));
  });

  it('두 번 돌려도 더 끊기지 않는다 — 결과가 안정된다', () => {
    const once = respaceKorean('이게컴퓨터의소리까지전부다마이크에들어가니까');
    expect(respaceKorean(once)).toBe(once);
  });

  it('아주 긴 덩어리에도 선형으로 끝난다(지수 폭발 없음)', () => {
    const long = '그리고서버에서데이터를가져와서화면에보여주는것까지'.repeat(40);
    const started = Date.now();
    const got = respaceKorean(long);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(got.replace(/ /g, '')).toBe(long);
  });
});

describe('polishVoiceChunk — 스위치를 끄면 아무것도 하지 않는다', () => {
  it('켜면 다듬는다', () => {
    expect(polishVoiceChunk('이게컴퓨터의소리까지들어가니까', true)).toContain(' ');
  });

  it('끄면 **원문 그대로** — 되돌릴 길이 있어야 규칙을 믿고 쓸 수 있다', () => {
    const raw = '이게컴퓨터의소리까지들어가니까';
    expect(polishVoiceChunk(raw, false)).toBe(raw);
  });
});
