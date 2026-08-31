import { describe, it, expect } from 'vitest';
import { CAPTURE_PLAYTEST } from '@vibisual/shared';
import {
  applyClipCap,
  clampRange,
  clipFileName,
  formatClipDuration,
  formatClipTime,
  frameFileName,
  frameTargetSize,
  demoFrameTimes,
  frameTimesFor,
  pickRecorderMime,
} from './playtestClip.js';

// §5.9 플레이테스트 — 구간·프레임 계산 단위 테스트.
// 화면에서 잡은 구간과 실제로 뽑히는 프레임이 어긋나면 "붙였는데 엉뚱한 장면"이 되므로 여기서 굳힌다.

describe('pickRecorderMime', () => {
  it('후보 중 지원되는 첫 번째를 고른다', () => {
    const mime = pickRecorderMime((m) => m === 'video/webm;codecs=vp8');
    expect(mime).toBe('video/webm;codecs=vp8');
  });

  it('아무것도 지원하지 않으면 null(브라우저 기본값으로 녹화 — 막지 않는다)', () => {
    expect(pickRecorderMime(() => false)).toBeNull();
  });

  it('판정 함수가 던져도 다음 후보로 넘어간다', () => {
    const mime = pickRecorderMime((m) => {
      if (m.includes('vp9')) throw new Error('boom');
      return m === 'video/webm';
    });
    expect(mime).toBe('video/webm');
  });
});

describe('clampRange', () => {
  it('클립 밖으로 나간 구간을 안으로 접는다', () => {
    expect(clampRange({ startMs: -500, endMs: 99_000 }, 10_000)).toEqual({ startMs: 0, endMs: 10_000 });
  });

  it('뒤집힌 구간은 바로 세운다', () => {
    expect(clampRange({ startMs: 8_000, endMs: 2_000 }, 10_000)).toEqual({ startMs: 2_000, endMs: 8_000 });
  });

  it('최소 길이보다 좁으면 뒤로 넓힌다', () => {
    const out = clampRange({ startMs: 1_000, endMs: 1_050 }, 10_000, 200);
    expect(out).toEqual({ startMs: 1_000, endMs: 1_200 });
  });

  it('뒤로 넓힐 자리가 없으면 앞으로 당긴다(끝에 붙은 구간)', () => {
    const out = clampRange({ startMs: 9_990, endMs: 10_000 }, 10_000, 200);
    expect(out).toEqual({ startMs: 9_800, endMs: 10_000 });
  });

  it('클립 자체가 최소 길이보다 짧으면 클립 전체가 구간이다', () => {
    expect(clampRange({ startMs: 10, endMs: 20 }, 120, 200)).toEqual({ startMs: 0, endMs: 120 });
  });
});

describe('frameTimesFor', () => {
  it('한 장이면 구간 한가운데', () => {
    expect(frameTimesFor({ startMs: 1_000, endMs: 3_000 }, 1)).toEqual([2_000]);
  });

  it('여러 장이면 등분한 칸의 한가운데를 찍는다(양 끝을 정확히 찍지 않는다)', () => {
    const times = frameTimesFor({ startMs: 0, endMs: 4_000 }, 4);
    expect(times).toEqual([500, 1_500, 2_500, 3_500]);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(4_000);
  });

  it('장수는 최대치를 넘지 않고 최소 한 장은 나온다', () => {
    expect(frameTimesFor({ startMs: 0, endMs: 1_000 }, 99)).toHaveLength(CAPTURE_PLAYTEST.MAX_FRAME_COUNT);
    expect(frameTimesFor({ startMs: 0, endMs: 1_000 }, 0)).toHaveLength(1);
  });

  it('구간이 뒤집혀 들어와도 앞에서부터 오름차순으로 나온다', () => {
    expect(frameTimesFor({ startMs: 3_000, endMs: 1_000 }, 2)).toEqual([1_500, 2_500]);
  });
});

describe('demoFrameTimes — 시연 저장(⑨-4)', () => {
  it('단계가 없으면 종전 등간격과 한 값도 다르지 않다', () => {
    const range = { startMs: 0, endMs: 4_000 };
    expect(demoFrameTimes(range, 4)).toEqual(frameTimesFor(range, 4));
  });

  it('단계가 있으면 **그 순간**을 찍는다 — 프롬프트가 단계와 그림을 시각으로 짝짓기 때문', () => {
    // 단계 시각은 구간 시작을 0 으로 본 상대값이다.
    expect(demoFrameTimes({ startMs: 10_000, endMs: 40_000 }, 3, [1_000, 5_000, 20_000]))
      .toEqual([11_000, 15_000, 30_000]);
  });

  it('장수가 단계보다 많으면 남는 자리만 등간격으로 채운다(가까운 중복은 버린다)', () => {
    const times = demoFrameTimes({ startMs: 0, endMs: 40_000 }, 4, [5_000, 30_000]);
    expect(times).toHaveLength(4);
    expect(times).toContain(5_000);
    expect(times).toContain(30_000);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('단계가 장수보다 많으면 앞에서부터 장수만큼만 쓴다', () => {
    expect(demoFrameTimes({ startMs: 0, endMs: 40_000 }, 2, [30_000, 1_000, 20_000]))
      .toEqual([1_000, 20_000]);
  });

  it('구간 밖 단계는 구간 안으로 접는다(밖으로 seek 하면 빈 장이 된다)', () => {
    expect(demoFrameTimes({ startMs: 5_000, endMs: 10_000 }, 1, [99_000])).toEqual([10_000]);
  });

  it('0장이면 빈 배열이다(등간격과 달리 억지로 한 장을 만들지 않는다)', () => {
    expect(demoFrameTimes({ startMs: 0, endMs: 4_000 }, 0, [1_000])).toEqual([]);
  });
});

describe('applyClipCap', () => {
  it('새 클립이 맨 앞에 오고 상한을 넘긴 오래된 것이 밀려난다', () => {
    const { kept, evicted } = applyClipCap(['c', 'b', 'a'], 'd', 3);
    expect(kept).toEqual(['d', 'c', 'b']);
    expect(evicted).toEqual(['a']);
  });

  it('상한 안이면 아무도 밀려나지 않는다', () => {
    const { kept, evicted } = applyClipCap(['a'], 'b', 6);
    expect(kept).toEqual(['b', 'a']);
    expect(evicted).toEqual([]);
  });
});

describe('frameTargetSize', () => {
  it('가로 상한을 넘으면 비율을 지켜 줄인다', () => {
    expect(frameTargetSize(3840, 2160, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('이미 작으면 그대로 둔다(억지로 키우지 않는다)', () => {
    expect(frameTargetSize(640, 360, 1280)).toEqual({ width: 640, height: 360 });
  });
});

describe('파일명 · 시간 표기', () => {
  it('소스명의 공백·경로문자는 파일명에서 접힌다', () => {
    expect(clipFileName('Game / Build v2', 1700)).toBe('playtest-Game_Build_v2-1700.webm');
  });

  it('프레임 파일명에 장 번호와 클립 안 시각이 남는다', () => {
    expect(frameFileName('screen', 0, 1234.6, 99)).toBe('playtest-screen-99-01-1235ms.png');
  });

  it('구간 라벨은 분:초.십분의일초', () => {
    expect(formatClipTime(0)).toBe('0:00.0');
    expect(formatClipTime(67_350)).toBe('1:07.3');
  });

  it('길이 배지는 분:초', () => {
    expect(formatClipDuration(7_400)).toBe('0:07');
    expect(formatClipDuration(125_000)).toBe('2:05');
  });
});
