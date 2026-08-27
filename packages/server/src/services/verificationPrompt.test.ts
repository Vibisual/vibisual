/**
 * §5.5 #17-35 ④⑤ — 검증 프롬프트 조립 + 판정 해석 테스트.
 *
 * 이 모듈이 지키는 것은 둘이다: **레시피를 실어 보낸다**(다시 알아내게 두지 않는다)와
 * **해석 실패가 통과로 흐르지 않는다**(fail-closed). 아래 케이스는 그 둘만 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  VERIFY_SLASH_COMMAND,
  VERIFY_RECORDED_SKILL_PATH,
  VERIFICATION_ATTEMPTS_MAX,
} from '@vibisual/shared';
import {
  buildVerifyPrompt,
  buildVerifyReworkPrompt,
  parseVerificationVerdict,
  recordedSkillRecipe,
  summarizePlayRecipe,
  NO_RECIPE,
} from './verificationPrompt.js';

describe('summarizePlayRecipe', () => {
  it('명령 실행 레시피는 명령·작업 폴더·주소를 사실로 옮긴다', () => {
    const r = summarizePlayRecipe({
      kind: 'command',
      command: 'pnpm dev',
      cwd: 'C:/repo/app',
      url: 'http://127.0.0.1:5173/',
    });
    expect(r.source).toBe('play-recipe');
    expect(r.lines.join('\n')).toContain('pnpm dev');
    expect(r.lines.join('\n')).toContain('C:/repo/app');
    expect(r.lines.join('\n')).toContain('http://127.0.0.1:5173/');
    expect(r.label).toContain('pnpm dev');
  });

  it('정적 서빙은 실행 명령이 필요 없다는 사실을 적는다', () => {
    const r = summarizePlayRecipe({ kind: 'static', root: 'C:/repo/site', url: 'http://127.0.0.1:8080/' });
    expect(r.source).toBe('play-recipe');
    expect(r.lines.join('\n')).toContain('정적');
    expect(r.label).toContain('정적 서빙');
  });

  it('건질 사실이 하나도 없으면 레시피가 있다고 말하지 않는다', () => {
    const r = summarizePlayRecipe({ kind: 'command' });
    expect(r.source).toBe('none');
    expect(r.lines).toHaveLength(0);
  });
});

describe('buildVerifyPrompt', () => {
  it('첫 줄은 항상 /verify 이고 판정 형식이 끝에 붙는다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE });
    expect(text.split('\n')[0]).toBe(VERIFY_SLASH_COMMAND);
    expect(text).toContain('Verdict format');
    expect(text).toContain('"verdict"');
  });

  it('우리 레시피가 있으면 그 사실을 싣고 "다시 알아내지 말라"고 못박는다', () => {
    const recipe = summarizePlayRecipe({ kind: 'command', command: 'pnpm dev', cwd: 'C:/repo' });
    const text = buildVerifyPrompt({ recipe, focus: '로그인 버튼이 실제로 눌리는지' });
    expect(text).toContain('pnpm dev');
    expect(text).toContain('다시 알아내지 말고');
    expect(text).toContain('로그인 버튼이 실제로 눌리는지');
  });

  it('기록된 스킬이 있으면 경로를 알리고 그대로 따르라고 한다', () => {
    const text = buildVerifyPrompt({ recipe: recordedSkillRecipe() });
    expect(text).toContain(VERIFY_RECORDED_SKILL_PATH);
    expect(text).toContain('그대로 따라라');
  });

  it('레시피가 없으면 실행법 블록 자체를 넣지 않는다(빈 블록 ❌)', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE });
    expect(text).not.toContain('이 앱을 띄우는 법');
    expect(text).not.toContain('이미 기록된 검증 레시피');
  });

  it('테스트 통과로 대신하지 말라는 규칙은 항상 실린다', () => {
    expect(buildVerifyPrompt({ recipe: NO_RECIPE })).toContain('테스트 통과');
  });
});

describe('parseVerificationVerdict — fail-closed', () => {
  it('증거 있는 approve 만 pass 가 된다', () => {
    const r = parseVerificationVerdict(
      '```json\n{"verdict":"approve","reason":"버튼이 눌린다","attempts":[{"kind":"run","command":"pnpm dev","exitCode":0}]}\n```',
    );
    expect(r.verdict).toBe('pass');
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]!.exitCode).toBe(0);
  });

  it('증거 없는 approve 는 held 다', () => {
    const r = parseVerificationVerdict('```json\n{"verdict":"approve","reason":"looks good"}\n```');
    expect(r.verdict).toBe('held');
  });

  it('reject 는 증거가 없어도 fail 이다', () => {
    const r = parseVerificationVerdict('```json\n{"verdict":"reject","reason":"흰 화면"}\n```');
    expect(r.verdict).toBe('fail');
    expect(r.reason).toBe('흰 화면');
  });

  it('구조화 블록이 없고 통과처럼 보이기만 하면 held 다', () => {
    expect(parseVerificationVerdict('다 됐습니다. 잘 동작합니다.').verdict).toBe('held');
    expect(parseVerificationVerdict('LGTM, it works').verdict).toBe('held');
  });

  it('구조화 블록 없이 실패만 말하면 fail 로 인정한다', () => {
    expect(parseVerificationVerdict('The app FAILED to start.').verdict).toBe('fail');
  });

  it('빈 응답·비문자열은 held 다', () => {
    expect(parseVerificationVerdict('').verdict).toBe('held');
    expect(parseVerificationVerdict(undefined as unknown as string).verdict).toBe('held');
  });

  it('시도 목록은 상한에서 잘리고 모양이 아닌 항목은 버린다', () => {
    const many = Array.from({ length: VERIFICATION_ATTEMPTS_MAX + 5 }, (_, i) => ({
      kind: 'test', command: `cmd ${i}`, exitCode: 0,
    }));
    const raw = JSON.stringify({ verdict: 'approve', attempts: [...many, { kind: 'test' }, null, 3] });
    const r = parseVerificationVerdict(raw);
    expect(r.verdict).toBe('pass');
    expect(r.attempts).toHaveLength(VERIFICATION_ATTEMPTS_MAX);
  });

  it('산문에 섞인 마지막 JSON 블록을 읽는다', () => {
    const r = parseVerificationVerdict(
      '먼저 { 이건 아니고 } 이런저런 설명…\n{"verdict":"reject","reason":"포트가 안 열림"}\n끝.',
    );
    expect(r.verdict).toBe('fail');
    expect(r.reason).toBe('포트가 안 열림');
  });
});

describe('buildVerifyReworkPrompt', () => {
  it('실패는 근거(시도·종료코드)를 그대로 다음 프롬프트에 싣는다', () => {
    const text = buildVerifyReworkPrompt({
      verdict: 'fail',
      focus: '로그인',
      reason: '흰 화면',
      attempts: [{ kind: 'run', command: 'pnpm dev', exitCode: 1, detail: 'Cannot find module' }],
    });
    expect(text).toContain('실패');
    expect(text).toContain('흰 화면');
    expect(text).toContain('pnpm dev');
    expect(text).toContain('exit 1');
    expect(text).toContain('Cannot find module');
  });

  it('보류는 "실제로 돌려서 확인" 을 요구한다', () => {
    const text = buildVerifyReworkPrompt({ verdict: 'held', attempts: [] });
    expect(text).toContain('보류');
    expect(text).toContain('실제로 돌린 기록이 남지 않았습니다');
  });
});
