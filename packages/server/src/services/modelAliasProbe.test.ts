import { describe, it, expect } from 'vitest';
import { CLI_NATIVE_MODEL_ALIASES_FALLBACK, listNativeModelAliases, type ModelRegistry } from '@vibisual/shared';
import { parseNativeModelAliasesFromHelp } from './modelAliasProbe.js';

/**
 * §4 (상태바 모델 칸 ③⑤) — 네이티브 별칭은 설치본 도움말이 정한다. 도움말 문구는 판올림마다 줄바꿈 위치가 바뀌므로 여러 모양을 고정한다.
 * 2.1.300 실측: `--model` 설명이 `'fable', 'opus', or 'sonnet'` 을 예로 든다 — 종전 치환 셋(`opus/sonnet/haiku`)이 fable 을 치환해 Fable 5.2 를 쓸 기회가 없었다.
 */

const HELP_2_1_300 = [
  'Options:',
  '  --model <model>                       Model for the current session. Provide',
  '                                          an alias for the latest model (e.g.',
  "                                          'fable', 'opus', or 'sonnet') or a",
  "                                          model's full name.",
  '  -n, --name <name>                     Set a display name for this session',
  "                                          (shown in the prompt box, '/resume'",
  '                                          picker, and terminal title)',
  '  --effort <level>                      Effort level for the current session',
  '                                          (low, medium, high, xhigh, max)',
].join('\n');

const HELP_OLD = [
  'Options:',
  '  --model <model>                       Model for the current session. Provide',
  "                                          an alias for the latest model (e.g. 'sonnet'",
  "                                          or 'opus') or a model's full name (e.g.",
  "                                          'claude-sonnet-4-5-20250929').",
  '  --effort <level>                      Effort level (low, medium, high)',
].join('\n');

describe('parseNativeModelAliasesFromHelp — 도움말이 인용한 별칭만', () => {
  it('2.1.300: 줄바꿈된 설명에서 fable·opus·sonnet 을 등장 순으로 읽는다', () => {
    expect(parseNativeModelAliasesFromHelp(HELP_2_1_300)).toEqual(['fable', 'opus', 'sonnet']);
  });

  it('옛 문구: sonnet·opus 만 — 풀ID 예시는 모양으로 떨어진다', () => {
    expect(parseNativeModelAliasesFromHelp(HELP_OLD)).toEqual(['sonnet', 'opus']);
  });

  it('다음 옵션 줄에서 멈춘다 — `--name` 설명의 인용(`/resume`)은 섞이지 않는다', () => {
    expect(parseNativeModelAliasesFromHelp(HELP_2_1_300)).not.toContain('/resume');
    expect(parseNativeModelAliasesFromHelp(HELP_2_1_300)).toHaveLength(3);
  });

  it('빈 줄에서도 멈춘다 — 옵션 뒤 다른 절의 인용은 읽지 않는다', () => {
    const help = [
      "  --model <model>   Provide an alias (e.g. 'opus').",
      '',
      "Commands:",
      "  mcp               Configure 'haiku' something",
    ].join('\n');
    expect(parseNativeModelAliasesFromHelp(help)).toEqual(['opus']);
  });

  it('다른 옵션 설명 안의 `--model` 글자는 옵션이 아니다', () => {
    const help = [
      "  --fallback-model <model>   Used when the --model choice is overloaded (e.g. 'sonnet')",
      '  --effort <level>            Effort level (low, high)',
    ].join('\n');
    expect(parseNativeModelAliasesFromHelp(help)).toEqual([]);
  });

  it('한 줄짜리 옵션(끝에서 멈춤)도 읽는다', () => {
    expect(parseNativeModelAliasesFromHelp("  --model <model>   An alias (e.g. 'opus' or 'haiku').")).toEqual(['opus', 'haiku']);
  });

  it('`--model` 이 없거나 인용이 없거나 빈 출력이면 빈 배열', () => {
    expect(parseNativeModelAliasesFromHelp('  --effort <level>  Effort (low, high)')).toEqual([]);
    expect(parseNativeModelAliasesFromHelp('  --model <model>   Model for the current session.')).toEqual([]);
    expect(parseNativeModelAliasesFromHelp('')).toEqual([]);
    expect(parseNativeModelAliasesFromHelp(undefined as unknown as string)).toEqual([]);
  });

  it('중복 인용은 한 번', () => {
    expect(parseNativeModelAliasesFromHelp("  --model <model>   'opus' or 'opus' or 'sonnet'")).toEqual(['opus', 'sonnet']);
  });
});

describe('listNativeModelAliases — 폴백 셋 ∪ 도움말', () => {
  const reg = (nativeModelAliases?: string[]): ModelRegistry => ({ entries: [], updatedAt: 0, sourceMix: 'seed-only', nativeModelAliases });

  it('레지스트리가 없거나 못 읽었으면 폴백 셋만 — 밖의 별칭(fable)은 치환 대상', () => {
    expect(listNativeModelAliases(undefined)).toEqual(CLI_NATIVE_MODEL_ALIASES_FALLBACK);
    expect(listNativeModelAliases(reg(undefined))).toEqual(CLI_NATIVE_MODEL_ALIASES_FALLBACK);
    expect(listNativeModelAliases(reg([]))).toEqual(CLI_NATIVE_MODEL_ALIASES_FALLBACK);
    expect(listNativeModelAliases(reg(undefined))).not.toContain('fable');
  });

  it('도움말이 적은 별칭이 폴백 뒤에 붙는다 — 도움말에 없는 haiku 도 폴백으로 남는다', () => {
    expect(listNativeModelAliases(reg(['fable', 'opus', 'sonnet']))).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
  });
});
