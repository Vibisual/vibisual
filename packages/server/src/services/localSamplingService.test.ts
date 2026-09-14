/**
 * §5.25 (G-2) — 로컬 온도를 비워 두었을 때 "실제로 쓰이는 값" 판정 고정 시험.
 *
 * 숫자를 코드에 적어 두지 않았으므로, 엔진이 알려 주는 모양을 못 읽으면 화면은 값을 비운다.
 * 이 시험은 그 읽기가 실제 출력 모양에서 살아남는지를 본다.
 */
import { describe, it, expect } from 'vitest';
import { parseLlamaHelpTemp, parsePropsTemperature, pickLocalContext, pickLocalSampling } from './localSamplingService.js';

/** 설치된 llama-server 의 `--help` 출력 일부(샘플링 칸) 그대로. */
const HELP_NOW = [
  '----- sampling params -----',
  '',
  '--samplers SAMPLERS                     samplers that will be used for generation in the order, separated by',
  "                                        ';'",
  '                                        (default:',
  '                                        penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature)',
  '-s,    --seed SEED                      RNG seed (default: -1, use random seed for -1)',
  '--ignore-eos                            ignore end of stream token and continue generating (implies',
  '                                        --logit-bias EOS-inf)',
  '--temp, --temperature N                 temperature (default: 0.80)',
  '--top-k N                               top-k sampling (default: 40, 0 = disabled)',
  '--dynatemp-range N                      dynamic temperature range (default: 0.00, 0.0 = disabled)',
].join('\r\n');

describe('parseLlamaHelpTemp — --help 에서 --temp 기본값', () => {
  it('지금 엔진의 출력 모양에서 읽는다(CRLF 포함)', () => {
    expect(parseLlamaHelpTemp(HELP_NOW)).toBe(0.8);
  });

  it('옛 들여쓰기 모양·설명이 다음 줄로 접힌 모양도 읽는다', () => {
    expect(parseLlamaHelpTemp('  -t N, --threads N   threads\n  --temp N              temperature (default: 0.8)\n')).toBe(0.8);
    expect(parseLlamaHelpTemp('--temp N      temperature\n              (default: 1.00)\n--top-k N     top-k (default: 40)\n')).toBe(1);
  });

  it('다음 옵션의 기본값을 끌어오지 않는다', () => {
    expect(parseLlamaHelpTemp('--temp N      temperature\n--top-k N     top-k sampling (default: 40)\n')).toBeNull();
  });

  it('--temp 가 없으면 null — 지어내지 않는다', () => {
    expect(parseLlamaHelpTemp('--dynatemp-range N   dynamic temperature range (default: 0.00)')).toBeNull();
    expect(parseLlamaHelpTemp('')).toBeNull();
  });
});

describe('parsePropsTemperature — 올라간 엔진의 /props', () => {
  it('요즘 모양(params.temperature)과 옛 모양(temperature) 둘 다', () => {
    expect(parsePropsTemperature({ default_generation_settings: { params: { temperature: 0.699999988079071 } } })).toBe(0.7);
    expect(parsePropsTemperature({ default_generation_settings: { temperature: 0.6 } })).toBe(0.6);
  });

  it('모양이 다르면 null', () => {
    expect(parsePropsTemperature(null)).toBeNull();
    expect(parsePropsTemperature({})).toBeNull();
    expect(parsePropsTemperature({ default_generation_settings: { params: { temperature: 'hot' } } })).toBeNull();
  });
});

describe('pickLocalSampling — 확실한 근거가 먼저', () => {
  it('올라간 엔진 → 모델 파일 → 엔진 --help 순서', () => {
    expect(pickLocalSampling({ loaded: 0.6, model: 0.7, engine: 0.8 })).toEqual({ temperature: 0.6, source: 'loaded' });
    expect(pickLocalSampling({ loaded: null, model: 0.7, engine: 0.8 })).toEqual({ temperature: 0.7, source: 'model' });
    expect(pickLocalSampling({ loaded: null, model: null, engine: 0.8 })).toEqual({ temperature: 0.8, source: 'engine' });
  });

  it('0 도 값이다 — 비어 있음과 섞지 않는다', () => {
    expect(pickLocalSampling({ loaded: null, model: 0, engine: 0.8 })).toEqual({ temperature: 0, source: 'model' });
  });

  it('셋 다 모르면 값도 출처도 없다', () => {
    expect(pickLocalSampling({ loaded: null, model: null, engine: null })).toEqual({ temperature: null, source: null });
  });
});

describe('pickLocalContext — 문맥 칸을 비워 두면 뜨는 크기', () => {
  it('올라간 엔진이 뜬 크기가 먼저다', () => {
    expect(pickLocalContext({ loaded: 32768, trained: 8192, builtin: 16384 })).toEqual({ tokens: 32768, source: 'loaded' });
  });

  it('학습 문맥이 더 짧으면 그 길이로 깎인다', () => {
    expect(pickLocalContext({ loaded: null, trained: 8192, builtin: 16384 })).toEqual({ tokens: 8192, source: 'model' });
  });

  it('학습 문맥이 같거나 길거나 모르면 우리 크기 그대로', () => {
    expect(pickLocalContext({ loaded: null, trained: 16384, builtin: 16384 })).toEqual({ tokens: 16384, source: 'builtin' });
    expect(pickLocalContext({ loaded: null, trained: 131072, builtin: 16384 })).toEqual({ tokens: 16384, source: 'builtin' });
    expect(pickLocalContext({ loaded: null, trained: null, builtin: 16384 })).toEqual({ tokens: 16384, source: 'builtin' });
  });
});
