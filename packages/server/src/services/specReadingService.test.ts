/**
 * §5.11 정독 게이트 — **읽기 영수증 원장**의 회귀 테스트.
 *
 * 이 원장이 틀리는 방식은 하나같이 조용하다. 경로 축이 어긋나면 열람이 어느 절에도 안 붙어 **모든 절이
 * 영원히 미열람**이 되고(게이트가 성실한 쪽을 벌한다), 반대로 `Glob` 을 열람으로 세면 목록만 훑고
 * "다 읽었다"가 통과한다(이 기능이 막으려던 바로 그 동작). 둘 다 화면에는 그럴듯한 숫자로 나온다 —
 * 그래서 여기서 고정한다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import {
  SPEC_CITATION_SESSION_MAX,
  SPEC_FULL_READ_LINE_MAX,
  SPEC_GATE_EVENT_MAX,
  SPEC_GREP_CONTEXT_LINES,
  SPEC_LEDGER_FILE_MAX,
  SPEC_LEDGER_SESSION_MAX,
  SPEC_PROMPT_KEEP_CHARS,
  SPEC_TOUCHED_PATH_MAX,
} from '@vibisual/shared';
import type { SpecCitation } from '@vibisual/shared';
import { SpecReadingService } from './specReadingService.js';

/** 실제로 만들지 않는다 — 이 층은 경로 계산만 하고 디스크를 건드리지 않는다. */
const root = path.resolve(os.tmpdir(), 'vibi-spec-ledger');
const abs = (rel: string): string => path.join(root, rel);

let svc: SpecReadingService;
beforeEach(() => {
  svc = new SpecReadingService();
});

const spansOf = (id: string): Record<string, readonly { fromLine: number; toLine: number; tool: string; partial: boolean }[]> =>
  (svc.contextFieldsFor(id)?.readingSpans ?? {}) as never;

/** 훅 `PostToolUse` 가 주는 Read 응답의 **실제 모양** — 축척·돌려준 범위는 안쪽 `file` 에 있다. */
const readResponse = (rel: string, startLine: number, numLines: number, totalLines: number): Record<string, unknown> => ({
  type: 'text',
  file: { filePath: abs(rel), content: '', numLines, startLine, totalLines },
});

/** 훅이 주는 Grep 응답의 실제 모양 — 줄 번호는 `content` 안에만 있다. */
const grepResponse = (filenames: string[], content: string): Record<string, unknown> => ({
  mode: 'content',
  numFiles: filenames.length,
  filenames,
  content,
});

describe('경로 축 — 훅은 절대경로를, 색인은 상대경로를 쓴다', () => {
  it('절대경로를 프로젝트 상대로 옮기고 구분자를 `/` 로 통일한다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 10, limit: 20 }, {});

    expect(Object.keys(spansOf('s1'))).toEqual(['docs/plan.md']);
  });

  it('이미 상대경로면 그대로 쓴다 — 도구는 cwd 기준으로 답하기도 한다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: './docs/plan.md', offset: 1, limit: 5 }, {});

    expect(Object.keys(spansOf('s1'))).toEqual(['docs/plan.md']);
  });

  it('프로젝트 밖 파일은 아예 담지 않는다 — 이 게이트가 말하는 기획 문서가 아니다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: path.resolve(os.tmpdir(), 'elsewhere/x.md'), offset: 1, limit: 5 }, {});

    expect(svc.contextFieldsFor('s1')).toBeUndefined();
  });

  it('경로 케이스는 접지 않는다 — Linux 에서 `Feature-X` 와 `feature-x` 는 다른 파일이다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/Feature-X.md'), offset: 1, limit: 5 }, {});

    expect(Object.keys(spansOf('s1'))).toEqual(['docs/Feature-X.md']);
  });
});

describe('무엇을 열람으로 세는가', () => {
  it('`Glob` 은 열람이 아니다 — 세면 "목록만 훑고 다 읽었다"가 통과한다', () => {
    svc.noteToolUse('s1', root, 'Glob', { pattern: 'docs/**/*.md' }, { output: 'docs/a.md\ndocs/b.md' });

    expect(svc.contextFieldsFor('s1')).toBeUndefined();
  });

  it('`offset`/`limit` 을 준 Read 는 그 구간을 정확히 연 것이다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 10, limit: 20 }, {});

    expect(spansOf('s1')['docs/plan.md']).toEqual([
      expect.objectContaining({ fromLine: 10, toLine: 29, tool: 'Read', partial: false }),
    ]);
  });

  it('긴 파일을 통째로 Read 하면 **부분 열람으로 강등**된다 — 도구가 앞부분만 돌려주기 때문', () => {
    // 훅 `tool_response` 의 실제 모양 — `{type:'text', file:{filePath, content, numLines, startLine, totalLines}}`.
    //   도구는 상한(`SPEC_FULL_READ_LINE_MAX`)까지만 돌려주므로 열람 구간도 거기까지다 — 입력(offset/limit)만 믿고
    //   파일 끝까지 읽은 것으로 세면 안 읽은 뒷부분이 "읽음"이 된다.
    const total = SPEC_FULL_READ_LINE_MAX + 1;
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/big.md') }, readResponse('docs/big.md', 1, SPEC_FULL_READ_LINE_MAX, total));

    expect(spansOf('s1')['docs/big.md']?.[0]).toMatchObject({ partial: true, fromLine: 1, toLine: SPEC_FULL_READ_LINE_MAX });
  });

  it('짧은 파일을 통째로 Read 한 것은 정독이다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/small.md') }, readResponse('docs/small.md', 1, 120, 120));

    expect(spansOf('s1')['docs/small.md']?.[0]).toMatchObject({ partial: false, fromLine: 1, toLine: 120 });
  });

  it('옛 꼴(최상위 `totalLines`)도 그대로 받는다 — 다른 도구 모양·옛 픽스처가 한꺼번에 깨지면 안 된다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/small.md') }, { totalLines: 120 });

    expect(spansOf('s1')['docs/small.md']?.[0]).toMatchObject({ partial: false, fromLine: 1, toLine: 120 });
    expect(svc.viewFieldsFor('s1')?.fileLines).toEqual({ 'docs/small.md': 120 });
  });

  it('`offset`/`limit` 을 줘도 도구가 **실제로 돌려준 범위**가 이긴다 — 파일 끝을 넘긴 limit 은 끝에서 멈춘다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 100, limit: 500 }, readResponse('docs/plan.md', 100, 21, 120));

    expect(spansOf('s1')['docs/plan.md']?.[0]).toMatchObject({ partial: false, fromLine: 100, toLine: 120 });
  });

  it('Read 응답의 `file.totalLines` 가 히트맵 축척이 된다(실제 모양) — 종전에는 최상위만 봐서 축척이 영영 비었다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 1, limit: 10 }, readResponse('docs/plan.md', 1, 10, 350));

    expect(svc.viewFieldsFor('s1')?.fileLines).toEqual({ 'docs/plan.md': 350 });
  });

  it('Read 응답의 마지막 줄 번호가 히트맵 축척이 된다 (`cat -n` 꼴이라 공짜로 안다)', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md') }, { output: '   1\t첫 줄\n   2\t둘\n   3\t셋' });

    expect(svc.viewFieldsFor('s1')?.fileLines).toEqual({ 'docs/plan.md': 3 });
  });

  it('Grep 은 줄 번호가 있을 때만 구간이 된다 — 모르는 것을 "봤다"로 세면 숫자가 거짓이 된다', () => {
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'REQ-1' }, grepResponse(['docs/plan.md'], 'docs/plan.md:120:REQ-1 어쩌고'));
    svc.noteToolUse('s2', root, 'Grep', { pattern: 'REQ-1' }, { mode: 'files_with_matches', numFiles: 1, filenames: ['docs/plan.md'] }); // 파일명만 = 줄 번호 없음

    expect(spansOf('s1')['docs/plan.md']).toEqual([
      expect.objectContaining({
        fromLine: 120 - SPEC_GREP_CONTEXT_LINES,
        toLine: 120 + SPEC_GREP_CONTEXT_LINES,
        tool: 'Grep',
        partial: true,
      }),
    ]);
    expect(svc.contextFieldsFor('s2')).toBeUndefined();
  });

  it('Grep 문맥 인자를 주면 그만큼 덮은 것으로 센다', () => {
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'REQ-1', '-C': 10 }, grepResponse(['docs/plan.md'], 'docs/plan.md:50:hit'));

    expect(spansOf('s1')['docs/plan.md']?.[0]).toMatchObject({ fromLine: 40, toLine: 60 });
  });

  it('Grep — Windows 드라이브 절대경로(`C:\\…\\a.md:120:`)도 파일로 읽는다 — 종전 정규식은 `C` 에서 끊겨 한 건도 못 읽었다', () => {
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'REQ-1' }, grepResponse([abs('docs/plan.md')], `${abs('docs/plan.md')}:120:REQ-1 어쩌고`));

    expect(Object.keys(spansOf('s1'))).toEqual(['docs/plan.md']);
    expect(spansOf('s1')['docs/plan.md']?.[0]).toMatchObject({ fromLine: 120 - SPEC_GREP_CONTEXT_LINES, tool: 'Grep' });
  });

  it('Grep — 파일 하나를 지정하면 ripgrep 이 경로를 빼고 `120:본문` 만 준다 — 그때의 파일은 입력의 `path` 다', () => {
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'REQ-1', path: abs('docs/plan.md') }, grepResponse([abs('docs/plan.md')], '120:REQ-1 어쩌고\n125-앞뒤 문맥'));

    expect(Object.keys(spansOf('s1'))).toEqual(['docs/plan.md']);
    expect(spansOf('s1')['docs/plan.md']?.[0]).toMatchObject({ fromLine: 120 - SPEC_GREP_CONTEXT_LINES, tool: 'Grep' });
  });

  it('Grep — 본문 속 `120:45` 같은 숫자 콜론은 파일이 아니다 — 경로로 보이려면 구분자나 확장자 점이 있어야 한다', () => {
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'minutes' }, grepResponse(['docs/plan.md'], '120:45 minutes'));

    expect(svc.contextFieldsFor('s1')).toBeUndefined();
  });
});

describe('구간 병합 — 같은 자리를 두 번 열어도 한 줄이다', () => {
  it('겹치거나 맞닿은 같은 종류의 구간은 합친다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 1, limit: 50 }, {});
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 40, limit: 50 }, {});
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 90, limit: 10 }, {}); // 맞닿음

    expect(spansOf('s1')['docs/plan.md']).toEqual([
      expect.objectContaining({ fromLine: 1, toLine: 99 }),
    ]);
  });

  it('떨어진 구간은 합치지 않는다 — 안 읽은 사이를 읽은 것으로 만들면 안 된다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 1, limit: 10 }, {});
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 500, limit: 10 }, {});

    expect(spansOf('s1')['docs/plan.md']).toHaveLength(2);
  });

  it('정독 구간과 부분 열람 구간은 겹쳐도 따로 둔다 — 합치면 부분이 정독으로 승격된다', () => {
    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 100, limit: 20 }, {});
    svc.noteToolUse('s1', root, 'Grep', { pattern: 'x' }, grepResponse(['docs/plan.md'], 'docs/plan.md:105:hit'));

    const list = spansOf('s1')['docs/plan.md'] ?? [];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.partial)).toHaveLength(1);
  });
});

describe('개수 상한 — 키 개수엔 캡이 없다(§3.2.4 F′)', () => {
  it('파일 수가 상한을 넘으면 가장 오래 안 건드린 파일부터 버린다', () => {
    for (let i = 0; i <= SPEC_LEDGER_FILE_MAX; i++) {
      svc.noteToolUse('s1', root, 'Read', { file_path: abs(`docs/f${i}.md`), offset: 1, limit: 5 }, {});
    }

    const files = Object.keys(spansOf('s1'));
    expect(files).toHaveLength(SPEC_LEDGER_FILE_MAX);
    expect(files).not.toContain('docs/f0.md');
    expect(files).toContain(`docs/f${SPEC_LEDGER_FILE_MAX}.md`);
  });

  it('세션 수가 상한을 넘으면 가장 오래 안 만진 세션부터 버린다', () => {
    for (let i = 0; i <= SPEC_LEDGER_SESSION_MAX; i++) {
      svc.notePrompt(`s${i}`, root, '무엇을 하자', 1000 + i);
    }

    expect(svc.sessionIds()).toHaveLength(SPEC_LEDGER_SESSION_MAX);
    expect(svc.projectOf('s0')).toBeNull();
    expect(svc.projectOf(`s${SPEC_LEDGER_SESSION_MAX}`)).toBe(root);
  });

  it('프롬프트는 앞부분만 든다 — 붙여넣은 로그가 세션 200개만큼 곱해지면 안 된다', () => {
    svc.notePrompt('s1', root, 'x'.repeat(SPEC_PROMPT_KEEP_CHARS * 2));

    expect(svc.contextFieldsFor('s1')?.promptText).toHaveLength(SPEC_PROMPT_KEEP_CHARS);
  });

  it('게이트 이력은 상한을 넘으면 오래된 줄부터 버린다', () => {
    for (let i = 0; i <= SPEC_GATE_EVENT_MAX; i++) {
      svc.noteGate('s1', root, { at: 1000 + i, kind: 'stop-block', unitIds: [`u${i}`] });
    }

    const gate = svc.viewFieldsFor('s1')?.gate ?? [];
    expect(gate).toHaveLength(SPEC_GATE_EVENT_MAX);
    expect(gate[0]?.unitIds).toEqual(['u1']);
  });

  it('인용은 상한을 넘으면 오래 대조한 것부터 버린다', () => {
    const many: SpecCitation[] = [];
    for (let i = 0; i <= SPEC_CITATION_SESSION_MAX; i++) {
      many.push({ unitId: `u${i}`, file: 'docs/plan.md', fromLine: i, toLine: i, quote: `q${i}`, verified: true, checkedAt: 1000 + i });
    }
    svc.setCitations('s1', root, many);

    const kept = svc.contextFieldsFor('s1')?.readingCitations ?? [];
    expect(kept).toHaveLength(SPEC_CITATION_SESSION_MAX);
    expect(kept[0]?.unitId).toBe('u1');
  });
});

describe('턴 경계 — 지난 턴의 사실이 이번 턴을 오염시키지 않는다', () => {
  it('프롬프트는 턴마다 갈아 끼운다 — 화제를 바꾸면 옛 절이 따라오면 안 된다', () => {
    svc.notePrompt('s1', root, '결제 화면을 만들자');
    svc.notePrompt('s1', root, '로그인 버그를 고치자');

    expect(svc.contextFieldsFor('s1')?.promptText).toBe('로그인 버그를 고치자');
  });

  it('건드린 경로는 중복 없이 최근 것이 앞에 온다', () => {
    svc.noteTouched('s1', root, 'src/a.ts');
    svc.noteTouched('s1', root, 'src/b.ts');
    svc.noteTouched('s1', root, 'src/a.ts');

    expect(svc.contextFieldsFor('s1')?.touchedPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('건드린 경로 목록에도 상한이 있다', () => {
    for (let i = 0; i <= SPEC_TOUCHED_PATH_MAX; i++) svc.noteTouched('s1', root, `src/f${i}.ts`);

    expect(svc.contextFieldsFor('s1')?.touchedPaths).toHaveLength(SPEC_TOUCHED_PATH_MAX);
  });

  it('되돌림 횟수는 새 턴에 초기화된다 — 안 그러면 한 세션에서 한 번만 막을 수 있다', () => {
    expect(svc.bumpStopRetry('s1', root)).toBe(1);
    expect(svc.bumpStopRetry('s1', root)).toBe(2);
    svc.resetStopRetries('s1');

    expect(svc.viewFieldsFor('s1')?.stopRetries).toBe(0);
  });
});

describe('인용 대조 결과 — 나중 판정이 이긴다', () => {
  it('같은 인용이 다시 대조되면 나중 결과로 덮는다(문서가 고쳐지면 통과가 실패로 바뀐다)', () => {
    const base = { unitId: 'REQ-1', file: 'docs/plan.md', fromLine: 10, toLine: 12, quote: '결제는 두 번 묻는다' };
    svc.setCitations('s1', root, [{ ...base, verified: true, checkedAt: 1000 }]);
    svc.setCitations('s1', root, [{ ...base, verified: false, checkedAt: 2000, failure: 'not-found' }]);

    const kept = svc.contextFieldsFor('s1')?.readingCitations ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ verified: false, failure: 'not-found' });
  });
});

describe('판 번호 — 전선 증분이 이것에 걸려 있다', () => {
  it('원장이 바뀌면 오르고, 안 바뀌면 그대로다', () => {
    svc.notePrompt('s1', root, '첫 턴', 1000);
    expect(svc.versionOf('s1')).toBe(1000);

    svc.noteToolUse('s1', root, 'Read', { file_path: abs('docs/plan.md'), offset: 1, limit: 5 }, {}, 2000);
    expect(svc.versionOf('s1')).toBe(2000);

    svc.noteToolUse('s1', root, 'Glob', { pattern: '*.md' }, {}, 3000); // 열람이 아니라 아무것도 안 바뀐다
    expect(svc.versionOf('s1')).toBe(2000);
  });

  it('원장이 없는 세션의 판 번호는 0 이다', () => {
    expect(svc.versionOf('없는세션')).toBe(0);
  });
});

describe('정리 — 죽은 세션의 숫자가 화면에 남지 않는다', () => {
  it('`forget` 하면 그 세션은 아무것도 남기지 않는다', () => {
    svc.notePrompt('s1', root, '무엇');
    svc.forget('s1');

    expect(svc.sessionIds()).toEqual([]);
    expect(svc.contextFieldsFor('s1')).toBeUndefined();
    expect(svc.viewFieldsFor('s1')).toBeUndefined();
    expect(svc.projectOf('s1')).toBeNull();
  });

  it('워크트리를 갈아타면 원장이 그 프로젝트를 따라간다', () => {
    const other = path.resolve(os.tmpdir(), 'vibi-spec-ledger-2');
    svc.notePrompt('s1', root, '무엇');
    svc.notePrompt('s1', other, '무엇');

    expect(svc.projectOf('s1')).toBe(other);
  });
});

describe('훅 프롬프트 — 조립본은 본문을 덮지 않는다(자기 참조 차단)', () => {
  it('조립 시점에 적힌 본문이 훅의 조립본 안에 그대로 있으면 그 훅은 무시한다 — 앞말의 정독 블록이 라우팅 재료가 되면 안 된다', () => {
    svc.notePrompt('s1', root, '결제 화면을 만들자', 1000, 'assembly');
    svc.notePromptFromHook('s1', root, '# 앞말\n> 기획 정독 — 로그인 절 · 결제 절\n\n---\n\n결제 화면을 만들자', 2000);

    expect(svc.contextFieldsFor('s1')?.promptText).toBe('결제 화면을 만들자');
    expect(svc.versionOf('s1')).toBe(1000);
  });

  it('첫 스폰 꼴(`브리핑 --- Task: 본문`)은 본문만 벗겨 적는다', () => {
    svc.notePromptFromHook('s1', root, 'You are a sub-agent working in project at: C:/x\n\nExecute the following task.\n\n---\n\nTask: 로그인 버그를 고치자', 1000);

    expect(svc.contextFieldsFor('s1')?.promptText).toBe('로그인 버그를 고치자');
  });

  it('우리 꼴이 아닌 프롬프트(외부 세션·CMD)는 그대로 적는다', () => {
    svc.notePromptFromHook('s1', root, '그냥 물어본다', 1000);

    expect(svc.contextFieldsFor('s1')?.promptText).toBe('그냥 물어본다');
  });

  it('조립본이 아닌 새 본문이 훅으로 오면 덮는다 — 밖에서 친 턴은 원장이 모르는 턴이다', () => {
    svc.notePrompt('s1', root, '결제 화면을 만들자', 1000, 'assembly');
    svc.notePromptFromHook('s1', root, '로그인 버그를 고치자', 2000);

    expect(svc.contextFieldsFor('s1')?.promptText).toBe('로그인 버그를 고치자');
    expect(svc.versionOf('s1')).toBe(2000);
  });
});
