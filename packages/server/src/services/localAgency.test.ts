/**
 * §5.19 (D)(H) 로컬 세션이 **클로드 세션만큼 행동할 수 있는가.**
 *
 * 2026-08-21 대조에서 드러난 것: 로컬 갈림(`executeLocalProvider`)은 `execute()` 맨 앞에서
 * 곧장 return 해서, 클로드 경로가 매 턴 받는 `contextSummary`·`livePreamble` 이 **인자로 들어오지도**
 * 않았고 슬래시 명령을 가로채는 `composeTurnPrompt` 도 그 아래라 통과하지 못했다. 그래서 로컬
 * 버블은 프로젝트 규칙·카드 지시문·목표·기억을 한 글자도 못 받았고 `/clear` 조차 그냥 사용자
 * 말로 모델에게 갔다.
 *
 * 여기서 지키는 것: **주입 순서**(캐시가 걸린 문제) · **슬래시를 모델에게 흘리지 않기** ·
 * **계획 모드에서 나올 길** · **바깥에서 받아 온 글을 읽을 수 있는 형태로 접기.**
 */
import { describe, it, expect } from 'vitest';
import { resolveLocalToolGate, LOCAL_TOOL_NAMES, LOCAL_HOST_TOOLS, normalizeTodoStatus } from '@vibisual/shared';
import { buildLocalSystemPrompt, parseLocalSlash, unsupportedSlashMessage } from './localRunner.js';
import { htmlToText, parseSearchHits } from './localTools.js';

describe('buildLocalSystemPrompt — 안 변하는 것이 앞, 변하는 것이 뒤', () => {
  it('주입선이 있으면 contextSummary 다음에 livePreamble', () => {
    const out = buildLocalSystemPrompt('SUMMARY', 'PREAMBLE', 'RULES');
    // 순서가 곧 캐시다 — 앞부분이 턴마다 같아야 엔진이 지난 계산을 이어 쓴다.
    expect(out.indexOf('SUMMARY')).toBeLessThan(out.indexOf('PREAMBLE'));
  });

  it('contextSummary 가 rules 를 이미 품고 있으므로 rules 를 또 붙이지 않는다', () => {
    expect(buildLocalSystemPrompt('SUMMARY', 'PREAMBLE', 'RULES')).not.toContain('RULES');
  });

  it('주입선이 없으면 rules 라도 싣는다 — 규칙이 통째로 사라지면 안 된다', () => {
    expect(buildLocalSystemPrompt('', '', 'RULES')).toBe('RULES');
    expect(buildLocalSystemPrompt(undefined, undefined, 'RULES')).toBe('RULES');
  });

  it('아무것도 없으면 빈 문자열(빈 system 메시지를 보내지 않게)', () => {
    expect(buildLocalSystemPrompt()).toBe('');
    expect(buildLocalSystemPrompt('  ', '  ', '  ')).toBe('');
  });
});

describe('parseLocalSlash — 슬래시를 모델에게 흘리지 않는다', () => {
  it('슬래시가 아니면 건드리지 않는다', () => {
    expect(parseLocalSlash('이 버튼 고쳐 줘')).toBeNull();
    expect(parseLocalSlash('a/b 경로를 봐 줘')).toBeNull();
  });

  it('우리가 뜻을 아는 셋을 알아본다', () => {
    expect(parseLocalSlash('/clear')?.kind).toBe('clear');
    expect(parseLocalSlash('/compact')?.kind).toBe('compact');
    expect(parseLocalSlash('/context')?.kind).toBe('context');
  });

  it('대소문자·앞뒤 공백을 가리지 않는다', () => {
    expect(parseLocalSlash('  /CLEAR  ')?.kind).toBe('clear');
  });

  it('뒤에 붙은 말은 지시로 넘긴다 — "무엇을 남겨라"가 요약에 실린다', () => {
    expect(parseLocalSlash('/compact 결정만 남겨라')?.arg).toBe('결정만 남겨라');
  });

  it('모르는 슬래시는 모델에게 넘기지 않고 모른다고 말한다', () => {
    const cmd = parseLocalSlash('/mcp');
    expect(cmd?.kind).toBe('unsupported');
    // 막다른 답을 주지 않는다 — 되는 것을 함께 말한다.
    const said = unsupportedSlashMessage(cmd?.name ?? '');
    expect(said).toContain('/clear');
    expect(said).toContain('/compact');
    expect(said).toContain('/context');
  });
});

describe('resolveLocalToolGate — 계획 모드에 갇히지 않는다', () => {
  it('계획을 적고 사용자에게 묻는 일은 어떤 모드에서도 통과한다', () => {
    for (const mode of ['default', 'plan', 'dontAsk', 'acceptEdits', 'bypassPermissions', undefined]) {
      expect(resolveLocalToolGate(mode, 'TodoWrite')).toBe('allow');
      expect(resolveLocalToolGate(mode, 'AskUserQuestion')).toBe('allow');
    }
  });

  it('ExitPlanMode 는 계획 모드에서 사람에게 묻는다 — deny 로 떨구면 나올 길이 없다', () => {
    expect(resolveLocalToolGate('plan', 'ExitPlanMode')).toBe('ask');
  });

  it('묻지 않기로 한 사용자에게는 안 묻는다', () => {
    expect(resolveLocalToolGate('bypassPermissions', 'ExitPlanMode')).toBe('allow');
  });

  it('계획 모드에서도 조사는 된다 — 다만 밖으로 나가는 일이라 사람이 한 번 본다', () => {
    expect(resolveLocalToolGate('plan', 'WebSearch')).toBe('ask');
    expect(resolveLocalToolGate('plan', 'WebFetch')).toBe('ask');
  });

  it('계획 모드는 여전히 파일을 못 바꾼다 — 그게 이 모드의 뜻이다', () => {
    expect(resolveLocalToolGate('plan', 'Write')).toBe('deny');
    expect(resolveLocalToolGate('plan', 'Edit')).toBe('deny');
    expect(resolveLocalToolGate('plan', 'Bash')).toBe('deny');
  });

  it('무인 실행은 바깥 호출을 거절한다 — 물어볼 사람이 없다', () => {
    expect(resolveLocalToolGate('dontAsk', 'WebFetch')).toBe('deny');
  });

  it('모든 도구가 어떤 모드에서도 판정을 받는다(빠진 이름이 없다)', () => {
    for (const tool of LOCAL_TOOL_NAMES) {
      for (const mode of ['default', 'plan', 'dontAsk', 'acceptEdits', 'bypassPermissions']) {
        expect(['allow', 'ask', 'deny']).toContain(resolveLocalToolGate(mode, tool));
      }
    }
  });

  it('호스트 도구는 전부 도구 목록에 실려 있다 — 정의 없이 이름만 있으면 모델이 못 부른다', () => {
    for (const name of LOCAL_HOST_TOOLS) expect(LOCAL_TOOL_NAMES).toContain(name);
  });
});

describe('htmlToText — 받아 온 페이지를 읽을 수 있게 접는다', () => {
  it('스크립트와 스타일의 속은 본문으로 새지 않는다', () => {
    const out = htmlToText('<style>.a{color:red}</style><script>var x=1;</script><p>본문</p>');
    expect(out).toBe('본문');
  });

  it('블록 태그는 줄이 된다 — 제목과 본문이 한 줄에 붙지 않게', () => {
    expect(htmlToText('<h1>제목</h1><p>본문</p>')).toBe('제목\n본문');
  });

  it('흔한 엔티티는 풀어 준다', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>');
  });

  it('주석은 버린다', () => {
    expect(htmlToText('<p>보임</p><!-- 안 보임 -->')).toBe('보임');
  });
});

describe('parseSearchHits — 못 읽으면 빈 배열(거짓 결과보다 낫다)', () => {
  it('검색 응답에서 제목·주소·요약을 건진다', () => {
    const body = {
      data: {
        web: [
          { url: 'https://example.com', title: 'Example & Co', description: '짧은 요약' },
        ],
      },
    };
    expect(parseSearchHits(body)).toEqual([
      { title: 'Example & Co', url: 'https://example.com', snippet: '짧은 요약' },
    ]);
  });

  it('여러 줄로 온 요약은 한 줄로 접는다 — 목록이 무너지지 않게', () => {
    const body = {
      data: { web: [{ url: 'https://a.dev', title: '  제목\n  둘째줄  ', description: '앞\n\n  뒤' }] },
    };
    expect(parseSearchHits(body)).toEqual([
      { title: '제목 둘째줄', url: 'https://a.dev', snippet: '앞 뒤' },
    ]);
  });

  it('요약에 섞여 오는 마크다운 장식을 걷는다 — 240자를 링크 문법에 쓰지 않게', () => {
    const body = {
      data: {
        web: [{
          url: 'https://react.dev',
          title: 'useEffect',
          description: '# useEffect [Link for this heading](https://react.dev/x#undefined) **호출** 뒤 `정리`',
        }],
      },
    };
    expect(parseSearchHits(body)[0]?.snippet).toBe('useEffect Link for this heading 호출 뒤 정리');
  });

  it('긴 요약은 240자에서 자른다', () => {
    const body = { data: { web: [{ url: 'https://a.dev', title: 't', description: 'x'.repeat(500) }] } };
    expect(parseSearchHits(body)[0]?.snippet).toHaveLength(240);
  });

  it('주소나 제목이 없는 항목은 버린다 — 모델에게 못 여는 줄을 주지 않는다', () => {
    const body = {
      data: {
        web: [
          { title: '주소 없음' },
          { url: 'https://b.dev' },
          { url: 'https://c.dev', title: '온전함' },
        ],
      },
    };
    expect(parseSearchHits(body).map((h) => h.url)).toEqual(['https://c.dev']);
  });

  it('요약이 없어도 제목·주소만으로 싣는다', () => {
    const body = { data: { web: [{ url: 'https://d.dev', title: '요약 없음' }] } };
    expect(parseSearchHits(body)).toEqual([{ title: '요약 없음', url: 'https://d.dev', snippet: '' }]);
  });

  it('모양이 바뀌면 빈 배열 — 지어내지 않는다', () => {
    expect(parseSearchHits({ results: ['완전히 다른 모양'] })).toEqual([]);
    expect(parseSearchHits({ data: { web: 'not an array' } })).toEqual([]);
    expect(parseSearchHits(null)).toEqual([]);
    expect(parseSearchHits(undefined)).toEqual([]);
    expect(parseSearchHits('<div>옛 HTML 화면</div>')).toEqual([]);
  });
});

describe('normalizeTodoStatus — 도구의 낱말과 목표창의 낱말을 잇는다', () => {
  it('클로드 어휘 completed 가 목표창의 done 이 된다 — 이게 없으면 퍼센트가 0에 머문다', () => {
    expect(normalizeTodoStatus('completed')).toBe('done');
  });

  it('우리 어휘도 그대로 받는다', () => {
    expect(normalizeTodoStatus('done')).toBe('done');
    expect(normalizeTodoStatus('in_progress')).toBe('in_progress');
    expect(normalizeTodoStatus('pending')).toBe('pending');
  });

  it('모르는 낱말은 undefined — 넘겨짚어 완료로 만들지 않는다', () => {
    expect(normalizeTodoStatus('finished')).toBeUndefined();
    expect(normalizeTodoStatus(undefined)).toBeUndefined();
    expect(normalizeTodoStatus(3)).toBeUndefined();
  });
});
