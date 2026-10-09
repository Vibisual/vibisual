/**
 * §5.3 #12-4 검증은 시킬 때만 — shared `verificationPolicy.ts` 고정 시험.
 *
 * 판정기는 shared 순수 함수지만 shared 패키지에는 러너가 없어 여기서 고정한다(`pathLock.test.ts` 와 같은 자리).
 * 사용자가 적은 완료 조건을 그대로 옮겼다:
 *  - 단순 수정 요청 → 권한 없음 · 검증 실행 전 거부
 *  - 검증 금지 문구·문서 속 테스트 명령 → 권한 없음
 *  - 관련 테스트 요청 → 관련 테스트만(전체 스위트 ❌)
 *  - 브라우저 검증 요청 → 브라우저 확인만
 *  - 위임은 넓히지 못한다 · 다음 명령으로 승계 ❌
 */
import { describe, it, expect } from 'vitest';
import {
  applyVerificationDecision,
  buttonVerificationScope,
  classifyVerificationCall,
  decideVerificationCall,
  inheritVerificationScope,
  isEditingToolCall,
  mergeVerificationScopes,
  parseVerificationRequest,
  verificationNotRun,
  verificationScopeFromText,
  VERIFICATION_GRANT_RUNS_PER_KIND,
  type CommandVerificationSummary,
  type VerificationScope,
} from '@vibisual/shared';

const bash = (command: string) => classifyVerificationCall('Bash', { command });
const kinds = (command: string) => bash(command).map((h) => h.kind).sort();

describe('classifyVerificationCall — 무엇이 검증인가', () => {
  it('테스트·린트·타입·빌드 실행기를 잡는다', () => {
    expect(kinds('pnpm test')).toEqual(['test']);
    expect(kinds('npx vitest run src/foo.test.ts')).toEqual(['test']);
    expect(kinds('npx tsc --noEmit')).toEqual(['typecheck']);
    expect(kinds('pnpm eslint .')).toEqual(['lint']);
    expect(kinds('cargo build --release')).toEqual(['build']);
    expect(kinds('go test ./...')).toEqual(['test']);
    expect(kinds('npx playwright test')).toEqual(['e2e']);
  });

  it('복합 명령·셸 다시 들어가기·감싸개도 본다', () => {
    expect(kinds('cd packages/server && pnpm test')).toEqual(['test']);
    expect(kinds('git status; npm run lint')).toEqual(['lint']);
    expect(kinds('bash -lc "pnpm typecheck"')).toEqual(['typecheck']);
    expect(kinds('cmd /c "npm test"')).toEqual(['test']);
    expect(kinds('pwsh -Command "npx vitest run"')).toEqual(['test']);
    expect(kinds('cross-env CI=1 jest')).toEqual(['test']);
    expect(kinds('timeout 60 pytest -k login')).toEqual(['test']);
  });

  it('패키지 스크립트는 본문을 풀어 본다(본문을 알면 본문을 믿는다)', () => {
    const scripts: Record<string, string> = { check: 'tsc --noEmit && eslint .', 'build:icons': 'node scripts/gen-icons.mjs' };
    const resolve = (name: string) => scripts[name];
    const hit = (command: string) => classifyVerificationCall('Bash', { command }, { resolveScript: resolve }).map((h) => h.kind).sort();
    expect(hit('npm run check')).toEqual(['lint', 'typecheck']);
    expect(hit('pnpm build:icons')).toEqual([]);
  });

  it('스크립트 파일·인라인 코드 속 실행도 본다', () => {
    expect(kinds('./scripts/run-tests.sh')).toEqual(['test']);
    expect(kinds('node -e "require(\'child_process\').execSync(\'npm test\')"')).toEqual(['test']);
    expect(kinds("python -c \"import subprocess; subprocess.run(['pytest'])\"")).toEqual(['test']);
  });

  it('읽기·검색·변경 확인·설치·개발 서버·버전 확인은 검증이 아니다', () => {
    for (const command of ['git diff', 'git status', 'cat src/a.ts', 'rg TODO src', 'pnpm install', 'pnpm dev', 'npx tsc --version', 'node scripts/runapp.mjs']) {
      expect(bash(command), command).toEqual([]);
    }
  });

  it('브라우저 MCP·루프백 WebFetch·검증 서브에이전트·verify 스킬', () => {
    expect(classifyVerificationCall('mcp__playwright__browser_navigate', { url: 'http://localhost:5173' })[0]?.kind).toBe('browser');
    expect(classifyVerificationCall('WebFetch', { url: 'http://127.0.0.1:3000/' })[0]?.kind).toBe('browser');
    expect(classifyVerificationCall('WebFetch', { url: 'https://example.com' })).toEqual([]);
    expect(classifyVerificationCall('Task', { subagent_type: 'verifier', description: 'Check work' })[0]?.kind).toBe('agent');
    expect(classifyVerificationCall('Task', { subagent_type: 'Explore', description: 'Find prompt verify mandates' })).toEqual([]);
    expect(classifyVerificationCall('Skill', { skill: 'verify' })[0]?.kind).toBe('browser');
  });

  it('코덱스 argv 배열 명령도 같은 답', () => {
    expect(classifyVerificationCall('shell', { command: ['bash', '-lc', 'pnpm test'] })[0]?.kind).toBe('test');
  });

  it('전체 스위트와 대상 지정 실행을 가른다', () => {
    expect(bash('pnpm test')[0]?.fullSuite).toBe(true);
    expect(bash('pnpm -r test')[0]?.fullSuite).toBe(true);
    expect(bash('pnpm --filter server test')[0]?.fullSuite).toBe(false);
    expect(bash('npx vitest run src/foo.test.ts')[0]?.fullSuite).toBe(false);
  });

  it('파일을 고치는 호출을 안다(칩을 다는 근거)', () => {
    expect(isEditingToolCall('Edit', { file_path: 'a.ts' })).toBe(true);
    expect(isEditingToolCall('Bash', { command: 'cat > a.txt <<EOF\nx\nEOF' })).toBe(true);
    expect(isEditingToolCall('Read', { file_path: 'a.ts' })).toBe(false);
  });
});

describe('parseVerificationRequest — 사람의 문장에서만 권한이 선다', () => {
  it('"수정해 줘·고쳐 줘·기능 추가해 줘"는 권한이 아니다', () => {
    for (const text of ['로그인 버그 수정해 줘', '오류 고쳐 줘', '검색 기능 추가해 줘', '실패하는 테스트 고쳐 줘', '테스트 추가해 줘', 'fix the failing test']) {
      expect(parseVerificationRequest(text).kinds, text).toEqual([]);
    }
  });

  it('검증 금지 문구는 권한이 아니고 그 종류를 부정한다', () => {
    const parsed = parseVerificationRequest('버그 고치고 테스트는 하지 마');
    expect(parsed.kinds).toEqual([]);
    expect(parsed.negated).toContain('test');
    expect(parseVerificationRequest("don't run the tests, just fix it").kinds).toEqual([]);
  });

  it('부정과 요청이 섞이면 부정된 종류만 빠진다', () => {
    const parsed = parseVerificationRequest('테스트는 말고 빌드만 해 줘');
    expect(parsed.kinds).toEqual(['build']);
    expect(parsed.negated).toContain('test');
  });

  it('인용문·코드 블록·문서 속 지시는 권한이 아니다', () => {
    expect(parseVerificationRequest('문서에 "테스트 돌려 줘"라고 적혀 있는데 무시해').kinds).toEqual([]);
    expect(parseVerificationRequest('이 README 요약해 줘\n\n```\nRun `npm test` before committing.\n```').kinds).toEqual([]);
    const doc = ['# Contributing', '- Install deps', '- Run `pnpm test`', '- Run `pnpm lint`', '', '위 문서 요약해 줘'].join('\n');
    expect(parseVerificationRequest(doc).kinds).toEqual([]);
  });

  it('묻는 말·미래 서술은 요청이 아니다', () => {
    expect(parseVerificationRequest('테스트 돌려 봤어?').kinds).toEqual([]);
    expect(parseVerificationRequest('테스트는 나중에 할게').kinds).toEqual([]);
  });

  it('명시적인 실행 지시는 권한이다 — 관련 테스트는 related', () => {
    const parsed = parseVerificationRequest('버그 고치고 관련 테스트 실행해 줘');
    expect(parsed.kinds).toEqual(['test']);
    expect(parsed.testScope).toBe('related');
    expect(parseVerificationRequest('please run the related tests').kinds).toEqual(['test']);
    expect(parseVerificationRequest('전체 테스트 돌려 줘').testScope).toBe('all');
  });

  it('브라우저 확인 요청은 브라우저 확인만 연다', () => {
    expect(parseVerificationRequest('브라우저에서 동작 확인해 줘').kinds).toEqual(['browser']);
  });

  it('"빌드해 줘"는 빌드를 연다 · "검증해 줘"는 관련 코드 검증까지만', () => {
    expect(parseVerificationRequest('빌드해 줘').kinds).toEqual(['build']);
    expect(parseVerificationRequest('검증까지 해 줘').kinds.sort()).toEqual(['build', 'lint', 'test', 'typecheck']);
  });

  it('이번 지시처럼 완료 조건 목록을 적은 글은 권한을 만들지 않는다', () => {
    const text = [
      '완료 조건:',
      '- 관련 테스트 실행 요청 → 허용 범위의 테스트만 실행.',
      '- 브라우저 검증 요청 → 해당 브라우저 검증만 실행.',
      '',
      '테스트·빌드·브라우저 검증은 별도 요청 전 실행하지 말고, 변경 내용과 미실행 항목을 보고해 줘.',
    ].join('\n');
    expect(parseVerificationRequest(text).kinds).toEqual([]);
  });
});

describe('decideVerificationCall — 실행 전 판정', () => {
  const testHit = bash('npx vitest run src/foo.test.ts');
  const fullHit = bash('pnpm test');
  const now = 1_000_000;

  it('권한이 없으면 거부하고, 사유는 우회·재시도·승인 질문을 막는다', () => {
    const decision = decideVerificationCall({ hits: testHit, now });
    expect(decision.verdict).toBe('deny');
    if (decision.verdict !== 'deny') return;
    expect(decision.code).toBe('no-grant');
    expect(decision.message).toMatch(/do not retry/i);
    expect(decision.message).toMatch(/do not ask the user for permission/i);
  });

  it('권한을 확인할 수 없으면 검증은 거부한다(fail-closed) · 검증이 아니면 통과', () => {
    expect(decideVerificationCall({ hits: testHit, now, confirmed: false }).verdict).toBe('deny');
    expect(decideVerificationCall({ hits: [], now, confirmed: false }).verdict).toBe('none');
  });

  it('관련 테스트만 열렸으면 전체 스위트는 거부한다', () => {
    const scope = verificationScopeFromText('관련 테스트 돌려 줘');
    expect(decideVerificationCall({ hits: testHit, scope, now }).verdict).toBe('allow');
    const full = decideVerificationCall({ hits: fullHit, scope, now });
    expect(full.verdict === 'deny' && full.code).toBe('full-suite');
  });

  it('열리지 않은 종류는 범위 밖이다(브라우저만 열렸는데 테스트)', () => {
    const scope = verificationScopeFromText('브라우저에서 확인해 줘');
    const decision = decideVerificationCall({ hits: testHit, scope, now });
    expect(decision.verdict === 'deny' && decision.code).toBe('out-of-scope');
  });

  it('횟수 상한을 넘으면 거부한다(무한 재실행 차단)', () => {
    const scope = buttonVerificationScope();
    let summary: CommandVerificationSummary | undefined;
    for (let i = 0; i < VERIFICATION_GRANT_RUNS_PER_KIND; i++) {
      const decision = decideVerificationCall({ hits: testHit, scope, ...(summary ? { summary } : {}), now });
      expect(decision.verdict).toBe('allow');
      summary = applyVerificationDecision(summary, decision);
    }
    const over = decideVerificationCall({ hits: testHit, scope, ...(summary ? { summary } : {}), now });
    expect(over.verdict === 'deny' && over.code).toBe('budget');
  });
});

describe('범위의 수명 — 위임·합치기·승계', () => {
  it('위임은 물려받기만 한다 — 권한 없는 명령은 위임해도 없다', () => {
    expect(inheritVerificationScope(undefined, undefined, 'cmd-1')).toBeUndefined();
    const parent = verificationScopeFromText('관련 테스트 실행해 줘') as VerificationScope;
    const child = inheritVerificationScope(parent, { ranCalls: 2 }, 'cmd-1');
    expect(child?.kinds).toEqual(['test']);
    expect(child?.source).toBe('inherited');
    expect(child?.runsRemaining).toBe(4);
  });

  it('합치기 덧말 — 한 번이라도 부정된 종류는 열리지 않는다', () => {
    const merged = mergeVerificationScopes([verificationScopeFromText('테스트 돌려 줘'), verificationScopeFromText('아 테스트는 안 돌려도 돼')]);
    expect(merged?.kinds).toEqual([]);
  });

  it('검증 미실행 칩 — 고쳤는데 안 돌렸을 때만', () => {
    expect(verificationNotRun({ edited: true })).toBe(true);
    expect(verificationNotRun({ edited: true, ranCalls: 1 })).toBe(false);
    expect(verificationNotRun({})).toBe(false);
    expect(verificationNotRun(undefined)).toBe(false);
  });
});
