/**
 * §5.13 (R-8) — 변환 명령과 진행률 판독 테스트.
 *
 * 여기가 틀리면 사용자는 "변환했는데 안 열린다"나 "진행률이 안 움직인다"만 본다. ffmpeg 을 실제로
 * 돌리지 않고 고정할 수 있는 부분(인자 조립·출력 파싱·캐시 이름)을 여기서 못 박는다.
 */
import { describe, expect, it } from 'vitest';
import { mediaCacheRelPath } from '@vibisual/shared';

import {
  buildAudioArgs,
  buildEncodeArgs,
  buildRemuxArgs,
  parseDurationSeconds,
  parseProgressSeconds,
  progressPercent,
} from './mediaConvert.js';

describe('변환 인자', () => {
  it('영상은 먼저 포장만 바꾼다 — 다시 인코딩하지 않는다', () => {
    const args = buildRemuxArgs('C:/in/take.avi', 'C:/out/take.mp4');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    // 인코더가 끼어들면 화질이 깎이고 시간이 오래 걸린다 — 이 경로에는 없어야 한다.
    expect(args).not.toContain('libx264');
    // 재생 머리를 앞으로 — 구간 요청으로 읽는 우리 창구에서 첫 프레임이 빨리 뜬다.
    expect(args).toContain('+faststart');
    expect(args[args.length - 1]).toBe('C:/out/take.mp4');
  });

  it('리먹스가 안 되는 코덱일 때만 인코딩으로 내려간다', () => {
    const args = buildEncodeArgs('C:/in/take.wmv', 'C:/out/take.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    // 옛 플레이어·편집기까지 받는 픽셀 포맷.
    expect(args).toContain('yuv420p');
  });

  it('소리는 WAV(PCM)로 — 음악 편집기가 그대로 받는다', () => {
    const args = buildAudioArgs('C:/in/voice.wma', 'C:/out/voice.wav');
    expect(args).toContain('pcm_s16le');
    // 영상 스트림이 섞여 오면 편집기가 못 읽으므로 떼어 낸다.
    expect(args).toContain('-vn');
  });

  it('모든 인자에 진행률 창구와 무인 실행 옵션이 있다', () => {
    for (const args of [
      buildRemuxArgs('a', 'b'),
      buildEncodeArgs('a', 'b'),
      buildAudioArgs('a', 'b'),
    ]) {
      expect(args).toContain('-progress');
      // 물어보는 순간 멈춘 채로 매달린다 — 화면 없는 자식에게 질문을 허용하지 않는다.
      expect(args).toContain('-nostdin');
      expect(args).toContain('-y');
    }
  });
});

describe('진행률 판독', () => {
  it('out_time_ms 를 초로 읽는다', () => {
    expect(parseProgressSeconds('out_time_ms=4000000')).toBeCloseTo(4);
    expect(parseProgressSeconds('out_time=00:00:07.50')).toBeCloseTo(7.5);
  });

  it('모르는 줄은 null — 엉뚱한 값으로 진행률을 흔들지 않는다', () => {
    expect(parseProgressSeconds('frame=120')).toBeNull();
    expect(parseProgressSeconds('')).toBeNull();
  });

  it('전체 길이는 Duration 줄에서', () => {
    expect(parseDurationSeconds('  Duration: 00:01:23.45, start: 0.000000, bitrate: 380 kb/s')).toBeCloseTo(83.45);
    expect(parseDurationSeconds('아무 말')).toBeNull();
  });

  it('퍼센트는 99 에서 멈춘다 — 100 은 실제로 끝났을 때만', () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(100, 100)).toBe(99);
    expect(progressPercent(5, null)).toBe(0);
    expect(progressPercent(-3, 100)).toBe(0);
  });
});

describe('캐시 이름', () => {
  it('원본이 바뀌면 다른 이름이 나온다 — 옛 변환본을 계속 열지 않게', () => {
    const a = mediaCacheRelPath('raw/take.avi', 1000, 111, 'video');
    const b = mediaCacheRelPath('raw/take.avi', 1000, 222, 'video');
    const c = mediaCacheRelPath('raw/take.avi', 2000, 111, 'video');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('같은 원본은 언제 눌러도 같은 이름 — 두 번째부터 변환 없이 열린다', () => {
    expect(mediaCacheRelPath('raw/take.avi', 1000, 111, 'video')).toBe(mediaCacheRelPath('raw/take.avi', 1000, 111, 'video'));
  });

  it('영상은 mp4, 소리는 wav 로 나가고 프로젝트 안 캐시 폴더에 선다', () => {
    expect(mediaCacheRelPath('raw/take.avi', 1, 2, 'video')).toMatch(/^\.vibisual\/media-cache\/take-[0-9a-f]{8}\.mp4$/);
    expect(mediaCacheRelPath('bgm/노래.wma', 1, 2, 'audio')).toMatch(/^\.vibisual\/media-cache\/노래-[0-9a-f]{8}\.wav$/);
  });

  it('파일 이름에 쓸 수 없는 글자는 걷어낸다', () => {
    expect(mediaCacheRelPath('a/b/we:ird*name.avi', 1, 2, 'video')).toContain('we_ird_name-');
  });
});
