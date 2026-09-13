/**
 * OWASP LLM Top 10(2025) 감사에서 나온 **경계 함수들**의 회귀 고정.
 *
 * 여기 모인 다섯은 서로 다른 축을 막지만 성질이 같다 — **모델·바깥이 준 문자열을 우리가 정한
 * 모양으로 접는 순수 함수**다. 그래서 한 파일에 둔다: 이 파일이 통째로 통과하면 "바깥 문자열이
 * 우리 쪽 결정을 바꾸는" 다섯 갈래가 전부 닫혀 있다는 뜻이 된다.
 *
 * - `redactSecrets` — LLM02(민감정보 노출): 회상 발췌·경고문이 토큰을 다른 세션으로 실어 나르지 않게.
 * - `resolveAutoGoalProjectRoot` — LLM08(저장고 경계): 아무 경로나 지목해 남의 절차 저장고를 열지 못하게.
 * - `detectLocalBashEscape` — LLM05(출력 무검증 처리): 로컬 모델이 낸 명령이 프로젝트 밖으로 나가지 못하게.
 * - `sanitizeCmdPrefill` — LLM06(과도한 권한): prefill 이 사람의 Enter 없이 스스로 실행되지 못하게.
 * - `parseAssetSha256` — LLM03(공급망): 발행처 지문이 아닌 값으로 검증했다고 착각하지 않게.
 */
import { describe, it, expect } from 'vitest';
import {
  CMD_SEND_MAX_CHARS,
  COMMAND_QUEUE_MAX_PER_SESSION,
  CUSTOM_AGENT_MAX_PER_PROJECT,
  detectLocalBashEscape,
  parseAssetSha256,
  redactSecrets,
  resolveAutoGoalProjectRoot,
  sanitizeCmdPrefill,
  SECRET_REDACTION_MASK,
} from '@vibisual/shared';

// ─── LLM02 · 비밀 가리기 ───

describe('redactSecrets — 발췌가 토큰을 실어 나르지 않는다', () => {
  it('훅 토큰 헤더는 이름을 남기고 값만 가린다', () => {
    const out = redactSecrets('curl -H "x-vibisual-hook-token: cde3fed7a2dd84f388cb9f5128fcea08" /api/x');
    expect(out).toContain('x-vibisual-hook-token: ' + SECRET_REDACTION_MASK);
    expect(out).not.toContain('cde3fed7a2dd84f388cb9f5128fcea08');
    // 무엇이 가려졌는지 읽는 쪽이 알아야 하므로 헤더 **이름**은 남아 있어야 한다.
    expect(out).toContain('x-vibisual-hook-token');
  });

  it('48자 이상 hex 덩어리(런치 토큰)를 가린다', () => {
    const token = 'a'.repeat(48);
    expect(redactSecrets(`token=${token} 끝`)).toBe(`token=${SECRET_REDACTION_MASK} 끝`);
  });

  it('sk- 로 시작하는 API 키를 가린다', () => {
    expect(redactSecrets('key sk-ant-0123456789abcdef 다음')).toBe(`key ${SECRET_REDACTION_MASK} 다음`); // privacy-ok — 가림 테스트용 가짜 키
  });

  it('짧은 hex·평범한 문장은 건드리지 않는다', () => {
    // 커밋 해시(7~40자)까지 가리면 회상 결과가 못 읽게 된다 — 48자 문턱을 지키는지 고정한다.
    expect(redactSecrets('commit b503ffe 를 보라')).toBe('commit b503ffe 를 보라');
    expect(redactSecrets('deadbeef'.repeat(5))).toBe('deadbeef'.repeat(5));
  });

  it('여러 개가 한 줄에 있어도 전부 가린다 — 전역 정규식 lastIndex 잔류 없음', () => {
    const line = `sk-aaaaaaaaaaaaaaaaaa 와 sk-bbbbbbbbbbbbbbbbbb`;
    expect(redactSecrets(line)).toBe(`${SECRET_REDACTION_MASK} 와 ${SECRET_REDACTION_MASK}`);
    // 같은 정규식 배열을 재사용하므로 **두 번 불러도** 같은 답이어야 한다.
    expect(redactSecrets(line)).toBe(`${SECRET_REDACTION_MASK} 와 ${SECRET_REDACTION_MASK}`);
  });
});

// ─── LLM08 · 절차 저장고의 프로젝트 경계 ───

/*
 * 폐기된 브레인이 `resolveBrainQueryProject` 로 막던 자리를 자동 목표가 이어받았다(§5.10).
 * 막는 것은 같다 — **지목한 경로가 지금 열려 있는 프로젝트가 아니면 아무것도 돌려주지 않는다.**
 * 저장고가 `.vibisual/brain` 의 카드 더미에서 `.vibisual/skills` 의 절차 파일로 바뀌었을 뿐,
 * "경로 문자열 하나로 남의 폴더를 읽어 간다"는 사고 모양은 그대로이기 때문이다.
 */
describe('resolveAutoGoalProjectRoot — 열려 있는 프로젝트만 연다', () => {
  const LOADED = ['/repos/app', '/repos/other'];

  it('열려 있는 경로는 그대로 통과한다', () => {
    expect(resolveAutoGoalProjectRoot('/repos/app', LOADED, 'linux')).toBe('/repos/app');
  });

  it('열려 있지 않은 경로는 null — 거절이 곧 404 다', () => {
    expect(resolveAutoGoalProjectRoot('/repos/secret', LOADED, 'linux')).toBeNull();
    expect(resolveAutoGoalProjectRoot('/etc', LOADED, 'linux')).toBeNull();
  });

  it('빈 문자열·공백은 null — 없는 경로가 첫 칸을 집어 들면 안 된다', () => {
    expect(resolveAutoGoalProjectRoot('', LOADED, 'linux')).toBeNull();
    expect(resolveAutoGoalProjectRoot('   ', LOADED, 'linux')).toBeNull();
  });

  it('열린 것이 하나도 없으면 무엇을 물어도 null', () => {
    expect(resolveAutoGoalProjectRoot('/repos/app', [], 'linux')).toBeNull();
  });

  it('모양만 다른 같은 경로는 같은 프로젝트다 — 역슬래시·끝 슬래시', () => {
    expect(resolveAutoGoalProjectRoot('/repos/app/', LOADED, 'linux')).toBe('/repos/app');
    // 역슬래시는 `String.raw` 로 적는다 — 보통 문자열이면 `\w`·`\a` 가 조용히 사라져 검사가 헛돈다.
    const winPath = String.raw`C:\work\app`;
    expect(resolveAutoGoalProjectRoot('C:/work/app', [winPath], 'win32')).toBe(winPath);
  });

  it('돌려주는 것은 **열려 있는 쪽**의 표기다 — 디스크 접근이 한 가지 표기로 모인다', () => {
    // win/mac 은 케이스를 안 가리므로 사용자가 다르게 적어 보내도 앱이 아는 표기로 접힌다.
    expect(resolveAutoGoalProjectRoot('/REPOS/App', ['/repos/app'], 'darwin')).toBe('/repos/app');
  });

  it('linux 는 케이스만 다른 폴더를 같은 것으로 보지 않는다 — 남의 저장고가 열리는 자리다', () => {
    expect(resolveAutoGoalProjectRoot('/repos/App', ['/repos/app'], 'linux')).toBeNull();
    expect(resolveAutoGoalProjectRoot('/repos/app', ['/repos/App'], 'linux')).toBeNull();
  });

  it('정확 일치가 케이스 접기보다 먼저다 — 두 폴더가 함께 열려 있어도 자기 것을 본다', () => {
    const both = ['/repos/App', '/repos/app'];
    expect(resolveAutoGoalProjectRoot('/repos/app', both, 'darwin')).toBe('/repos/app');
    expect(resolveAutoGoalProjectRoot('/repos/App', both, 'darwin')).toBe('/repos/App');
  });
});

// ─── LLM05 · 로컬 모델이 낸 명령의 경계 ───

describe('detectLocalBashEscape — 프로젝트 밖으로 나가는 명령을 집어낸다', () => {
  it.each([
    ['cat ~/.claude/.credentials.json'],
    ['cd ~'],
    ['cat /etc/passwd'],
    ['ls /home/other/.ssh'], // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    ['type C:\\Users\\dev\\.claude\\.credentials.json'], // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    ['dir C:/Windows/System32'],
    ['cat ../../secrets.txt'],
    ['echo $HOME'],
    ['echo ${HOME}'],
    ['echo %USERPROFILE%'],
    ['echo $env:USERPROFILE'],
  ])('이탈로 본다: %s', (cmd) => {
    expect(detectLocalBashEscape(cmd)).not.toBeNull();
  });

  it.each([
    ['ls -la src'],
    ['cat packages/shared/src/constants.ts'],
    ['git status'],
    ['node scripts/build.mjs'],
    ['cat ./docs/README.md'],
    // 한 칸 위는 워크스페이스 안에서도 흔하다 — 두 칸 이상만 이탈로 본다.
    ['cat ../shared/package.json'],
  ])('평범한 프로젝트 안 명령은 통과: %s', (cmd) => {
    expect(detectLocalBashEscape(cmd)).toBeNull();
  });

  it('무엇에 걸렸는지 돌려준다 — 거절 사유를 모델에게 되돌려 줄 수 있어야 한다', () => {
    expect(detectLocalBashEscape('cat ~/.ssh/id_rsa')).toContain('~');
  });
});

// ─── LLM06 · CMD prefill ───

describe('sanitizeCmdPrefill — 사람이 Enter 를 누르기 전에는 실행되지 않는다', () => {
  it.each([
    ['개행', 'echo hi\nrm -rf /'],
    ['캐리지리턴', 'echo hi\rrm -rf /'],
    ['EOT(\\x04)', 'echo hi\u0004rm -rf /'],
    ['SIGINT(\\x03)', 'echo hi\u0003rm -rf /'],
    ['Windows EOF(\\x1a)', 'echo hi\u001arm -rf /'],
    ['ESC(\\x1b)', 'echo hi\u001b[Arm -rf /'],
    ['NUL(\\x00)', 'echo hi\u0000rm -rf /'],
    ['DEL(\\x7F)', 'echo hi\u007frm -rf /'],
  ])('%s 는 공백으로 접힌다', (_label, input) => {
    const out = sanitizeCmdPrefill(input);
    expect(out).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(out.startsWith('echo hi ')).toBe(true);
  });

  it('연속된 제어문자는 공백 하나로 접힌다', () => {
    expect(sanitizeCmdPrefill('a\r\n\r\nb')).toBe('a b');
  });

  it('평범한 글자·한글·기호는 그대로 둔다', () => {
    expect(sanitizeCmdPrefill('git commit -m "한글 메시지 · ok"')).toBe('git commit -m "한글 메시지 · ok"');
  });

  it('상한을 넘기면 자른다', () => {
    expect(sanitizeCmdPrefill('x'.repeat(CMD_SEND_MAX_CHARS + 100))).toHaveLength(CMD_SEND_MAX_CHARS);
    expect(sanitizeCmdPrefill('abcdef', 3)).toBe('abc');
  });

  it('제어문자만 있던 입력은 공백만 남는다 — 부르는 쪽이 trim 으로 거절할 수 있어야 한다', () => {
    expect(sanitizeCmdPrefill('\u0003\u0004\n').trim()).toBe('');
  });
});

// ─── LLM03 · 공급망 지문 ───

describe('parseAssetSha256 — 발행처 지문만 지문으로 인정한다', () => {
  const hex = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6';

  it('sha256: 접두 + 64 hex 를 소문자로 돌려준다', () => {
    expect(parseAssetSha256(`sha256:${hex}`)).toBe(hex);
    expect(parseAssetSha256(`SHA256:${hex.toUpperCase()}`)).toBe(hex);
    expect(parseAssetSha256(`  sha256:${hex}  `)).toBe(hex);
  });

  it.each([
    ['없음', undefined],
    ['null', null],
    ['문자열 아님', 12345],
    ['접두 없는 hex', hex],
    ['다른 알고리즘', `md5:${hex}`],
    ['길이 부족', 'sha256:abc123'],
    ['hex 아닌 글자 섞임', `sha256:${hex.slice(0, 63)}z`],
    ['빈 문자열', ''],
  ])('%s 이면 null — "검증했다"고 착각하지 않는다', (_label, value) => {
    expect(parseAssetSha256(value)).toBeNull();
  });
});

// ─── LLM10 · 무한 증식 상한 ───

describe('자가증식 상한 — 숫자가 실수로 0/무한으로 풀리지 않게', () => {
  it('상한은 유한한 양수다', () => {
    for (const cap of [CUSTOM_AGENT_MAX_PER_PROJECT, COMMAND_QUEUE_MAX_PER_SESSION]) {
      expect(Number.isInteger(cap)).toBe(true);
      expect(cap).toBeGreaterThan(0);
      expect(Number.isFinite(cap)).toBe(true);
    }
  });
});
