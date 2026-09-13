/**
 * §5.5 #17-17 ⑪(l) — **무대 블록**의 문법과 수확 규칙을 고정한다.
 *
 * 여기서 지키는 것은 셋이다.
 * ⓐ 문법이 **관대**할 것 — 모델이 순서를 바꿔 적거나 체크박스를 빠뜨려도 신고가 통째로 사라지면
 *   그건 종전의 `curl` 보다 더 딱딱한 물건이 된다.
 * ⓑ 블록이 **이벤트 경계를 넘어** 완성될 것 — 토큰 델타 세션에서는 여는 펜스와 닫는 펜스가 다른
 *   이벤트에 있다. 이걸 못 이으면 partial 세션에서는 기능이 통째로 죽는다(화면에는 아무 표시도 없다).
 * ⓒ 같은 블록이 **두 번 적용되지 않을** 것 — 완성 메시지 중복·스트림 재수화가 같은 줄을 다시 흘린다.
 */
import { describe, expect, it } from 'vitest';
import { parseStageBlockBody, extractStageBlocks, isStageBlockLang, applySceneTemplate, findSceneTemplate } from '@vibisual/shared';
import { StageBlockIngest, STAGE_INGEST_OPEN_MAX, STAGE_INGEST_SESSIONS_MAX } from './stageBlockIngest.js';

describe('⑪(l) 블록 문법 — 마크다운 체크박스 그대로', () => {
  it('목표·단계·메모를 읽는다', () => {
    const d = parseStageBlockBody(
      ['goal: 무대를 개편한다', '- [x] 스키마 정의 @locate', '- [~] 서버 배선 @change ?', '- [ ] 빌드 @build', 'note: 배선 절반'].join('\n'),
    );
    expect(d?.goal).toBe('무대를 개편한다');
    expect(d?.note).toBe('배선 절반');
    expect(d?.steps).toEqual([
      { text: '스키마 정의', status: 'done', kind: 'locate' },
      { text: '서버 배선', status: 'in_progress', kind: 'change', confidence: 'low' },
      { text: '빌드', status: 'pending', kind: 'build' },
    ]);
  });

  it('꼬리 표식의 순서를 외우게 하지 않는다', () => {
    const a = parseStageBlockBody('- [~] 서버 배선 @change ?')?.steps?.[0];
    const b = parseStageBlockBody('- [~] 서버 배선 ? @change')?.steps?.[0];
    expect(a).toEqual(b);
  });

  it('체크박스가 없는 홑 글머리도 아직 안 한 단계로 받는다', () => {
    expect(parseStageBlockBody('- 빌드 검증')?.steps).toEqual([{ text: '빌드 검증', status: 'pending' }]);
  });

  it('`!` 는 될 것 같다 — 확신은 이진이다(⑪(e))', () => {
    expect(parseStageBlockBody('- [ ] 배선 !')?.steps?.[0]?.confidence).toBe('high');
  });

  it('㉑ 상태 블록의 `[사용자 추가]` 표지는 본문에 섞이지 않는다 — 그 줄을 그대로 옮겨도 같은 단계다', () => {
    expect(parseStageBlockBody('- [ ] 빌드 @build [사용자 추가]')?.steps?.[0]).toEqual({ text: '빌드', status: 'pending', kind: 'build' });
    expect(parseStageBlockBody('- [~] ∥ 클라 [사용자 추가] @change')?.steps?.[0]).toEqual({ text: '클라', status: 'in_progress', kind: 'change', parallel: true });
  });

  it('종류 카드를 같은 블록 안에서 만든다', () => {
    const d = parseStageBlockBody(
      ['kind shader: Shader', '  from: wave', '  color: #F472B6', '  surface: source', '  blurb: 셰이더를 고칩니다', '- [~] 상수 정리 @shader'].join('\n'),
    );
    expect(d?.kinds).toEqual([
      { key: 'shader', label: 'Shader', from: 'wave', color: '#F472B6', surface: 'source', blurb: '셰이더를 고칩니다' },
    ]);
    expect(d?.steps?.[0]?.kind).toBe('shader');
  });

  it('`scene:` 은 줄마다 하나씩 쌓이고 `@이름` 은 밑그림 지목이다', () => {
    const one = parseStageBlockBody(['kind a: A', '  scene: M0 0h10', '  scene: M2 2h4'].join('\n'));
    expect(one?.kinds?.[0]?.scene).toEqual(['M0 0h10', 'M2 2h4']);
    const tpl = parseStageBlockBody(['kind b: B', '  scene: @grid'].join('\n'));
    expect(tpl?.kinds?.[0]?.from).toBe('grid');
  });

  it('옛 규약의 JSON 페이로드를 그대로 붙여도 통한다', () => {
    const d = parseStageBlockBody('{"goal":"목표","steps":[{"text":"a","status":"done"},{"text":"b"}],"note":"n"}');
    expect(d?.goal).toBe('목표');
    expect(d?.steps).toEqual([
      { text: 'a', status: 'done' },
      { text: 'b', status: 'pending' },
    ]);
  });

  it('⑰(b) 체크박스 뒤의 ∥ 는 "앞 단계와 같은 행"이다 — 문법은 한 글자만 는다', () => {
    const d = parseStageBlockBody(['- [~] 서버 배선 @change', '- [~] ∥ 클라 배선 @change ?', '- [ ] 빌드 @build'].join('\n'));
    expect(d?.steps).toEqual([
      { text: '서버 배선', status: 'in_progress', kind: 'change' },
      { text: '클라 배선', status: 'in_progress', kind: 'change', confidence: 'low', parallel: true },
      { text: '빌드', status: 'pending', kind: 'build' },
    ]);
  });

  it('⑰(b) ASCII 로 || 라고 적어도 같다 — 키보드에 ∥ 가 없다', () => {
    const d = parseStageBlockBody(['- [ ] 하나', '- [ ] || 둘'].join('\n'));
    expect(d?.steps?.map((s) => s.parallel)).toEqual([undefined, true]);
    expect(d?.steps?.[1]?.text).toBe('둘');
  });

  it('⑰(b) JSON 페이로드도 parallel:true 를 나른다 — 문자열 "true" 는 받지 않는다', () => {
    const d = parseStageBlockBody('{"steps":[{"text":"a"},{"text":"b","parallel":true},{"text":"c","parallel":"true"}]}');
    expect(d?.steps).toEqual([
      { text: 'a', status: 'pending' },
      { text: 'b', status: 'pending', parallel: true },
      { text: 'c', status: 'pending' },
    ]);
  });

  it('⑰(b) 표식이 없으면 필드 자체가 없다 — 옛 신고와 새 신고가 같은 모양이다', () => {
    expect(parseStageBlockBody('- [x] 그냥 단계')?.steps?.[0]).not.toHaveProperty('parallel');
  });

  it('모르는 줄은 버리고 나머지는 살린다 — 한 줄 때문에 신고가 통째로 사라지지 않는다', () => {
    const d = parseStageBlockBody(['이건 그냥 문장이다', '- [x] 진짜 단계', 'zzz: 모르는 키'].join('\n'));
    expect(d?.steps).toEqual([{ text: '진짜 단계', status: 'done' }]);
  });

  it('읽을 것이 하나도 없으면 null — 빈 지시를 적용하지 않는다', () => {
    expect(parseStageBlockBody('')).toBeNull();
    expect(parseStageBlockBody('아무 뜻도 없는 문장')).toBeNull();
  });
});

describe('⑪(l) 펜스 찾기', () => {
  it('무대 언어만 잡는다', () => {
    expect(isStageBlockLang('vibisual')).toBe(true);
    expect(isStageBlockLang('vibe')).toBe(true);
    expect(isStageBlockLang('bash')).toBe(false);
    expect(isStageBlockLang(null)).toBe(false);
  });

  it('닫히지 않은 블록도 돌려주되 닫힘 표식이 다르다', () => {
    const spans = extractStageBlocks('앞말\n```vibisual\n- [ ] a\n');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.closed).toBe(false);
  });

  it('줄 끝이 CRLF 여도 펜스가 열리고 닫힌다 — 윈도우에서만 신고가 통째로 사라지면 안 된다', () => {
    // `$` 는 `\r\n` 의 `\r` 앞에서 어긋난다. 여는 펜스부터 안 잡히므로 화면에는 **아무 표시도 없이**
    //   기능이 죽는다 — 리눅스/맥 개발기에서는 영영 안 보이는 부류라 여기서 고정한다.
    const md = ['```vibisual', 'goal: 줄바꿈', '- [x] 한 줄', '```'].join('\r\n');
    const spans = extractStageBlocks(md);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.closed).toBe(true);
    const d = parseStageBlockBody(spans[0]!.body);
    expect(d?.goal).toBe('줄바꿈');
    expect(d?.steps).toEqual([{ text: '한 줄', status: 'done' }]);
  });

  it('무대가 아닌 코드블록 안의 예시 펜스에 걸려 넘어지지 않는다', () => {
    const md = ['~~~markdown', '```vibisual', '- [ ] 예시일 뿐', '```', '~~~', '```vibisual', '- [x] 진짜', '```'].join('\n');
    const spans = extractStageBlocks(md).filter((s) => s.closed);
    expect(spans).toHaveLength(1);
    expect(parseStageBlockBody(spans[0]!.body)?.steps?.[0]?.text).toBe('진짜');
  });
});

describe('⑪(l) 수확 — 이벤트 경계와 중복', () => {
  it('블록이 여러 조각에 걸쳐 와도 완성되면 한 번 나온다', () => {
    const ingest = new StageBlockIngest();
    expect(ingest.push('sub-a', '작업을 시작합니다.\n\n```vibi')).toEqual([]);
    expect(ingest.push('sub-a', 'sual\ngoal: 이어 붙이기\n- [x] 조각 1\n')).toEqual([]);
    const out = ingest.push('sub-a', '```\n끝.');
    expect(out).toHaveLength(1);
    expect(out[0]?.goal).toBe('이어 붙이기');
  });

  it('같은 블록이 다시 흘러와도 한 번만 적용된다', () => {
    const ingest = new StageBlockIngest();
    const block = '```vibisual\n- [x] 한 번\n```\n';
    expect(ingest.push('sub-b', block)).toHaveLength(1);
    expect(ingest.push('sub-b', block)).toHaveLength(0);
  });

  it('세션이 다르면 서로의 꼬리를 보지 않는다', () => {
    const ingest = new StageBlockIngest();
    ingest.push('sub-c', '```vibisual\n- [ ] 반쪽\n');
    // 다른 세션이 닫는 펜스를 흘려도 남의 블록이 완성되면 안 된다.
    expect(ingest.push('sub-d', '```\n')).toEqual([]);
  });

  it('세션이 사라지면 들고 있던 것을 놓는다', () => {
    const ingest = new StageBlockIngest();
    ingest.push('sub-e', '```vibisual\n- [ ] a\n');
    expect(ingest.size).toBe(1);
    ingest.forget('sub-e');
    expect(ingest.size).toBe(0);
  });

  it('펜스가 없는 평범한 답변은 아무 일도 만들지 않는다', () => {
    const ingest = new StageBlockIngest();
    expect(ingest.push('sub-f', '그냥 설명하는 문장입니다.')).toEqual([]);
  });
});

/**
 * ⑪(l) ⓒ — **이벤트 경계에는 줄바꿈이 없다.**
 *
 * 텍스트 이벤트 하나는 `assistant` 메시지의 본문 블록 하나이고, 그 본문은 대개 개행으로 끝나지
 * 않는다. 도구를 쓴 뒤 새 메시지가 곧장 신고로 시작하면 이어 붙인 결과에서 **여는 펜스가 줄 머리를
 * 잃고**, 그 신고는 화면에 아무 표시도 없이 사라진다. 실측(2026-09-10 · 저장된 스트림 464개 전수
 * 재생)에서 신고 182건 중 27건이 이 경계에서 없어졌고, 없어진 것은 첫 신고가 아니라 **일을 끝낸 뒤의
 * 갱신**이었다 — 사용자가 본 "목표 창이 첫 단계에 멈춘 채 끝난다"가 이것이다.
 */
describe('⑪(l) 수확 — 이벤트 경계에 줄바꿈이 없을 때', () => {
  it('앞 문장이 개행으로 끝나지 않아도 다음 조각의 여는 펜스를 알아본다', () => {
    const ingest = new StageBlockIngest();
    // 실측 `sub-mtv3trmi-ahebeb`: 앞 메시지가 마침표로 끝나고, 다음 메시지가 곧장 신고로 시작했다.
    expect(ingest.push('sub-seam', '먼저 보고가 근거로 든 자리들을 실제로 확인하겠습니다.')).toEqual([]);
    const out = ingest.push('sub-seam', '```vibisual\n- [x] 확인\n- [x] 설명\n```\n');
    expect(out).toHaveLength(1);
    expect(out[0]?.steps?.map((s) => s.status)).toEqual(['done', 'done']);
  });

  it('첫 신고가 도착한 뒤의 갱신도 도착한다 — 목표가 첫 단계에 얼지 않는다', () => {
    const ingest = new StageBlockIngest();
    const first = ingest.push('sub-adv', '알겠습니다.\n\n```vibisual\n- [~] 확인 @locate\n- [ ] 설명 @locate\n```\n\n먼저 확인하겠습니다.');
    expect(first).toHaveLength(1);
    expect(first[0]?.steps?.map((s) => s.status)).toEqual(['in_progress', 'pending']);
    // 도구를 쓴 뒤 새 메시지가 신고로 시작한다 — 앞 조각은 개행 없이 끝났다.
    const second = ingest.push('sub-adv', '```vibisual\n- [x] 확인 @locate\n- [x] 설명 @locate\n```\n\n설명드리겠습니다.');
    expect(second).toHaveLength(1);
    expect(second[0]?.steps?.map((s) => s.status)).toEqual(['done', 'done']);
  });

  it('본문에 인라인으로 적힌 무대 펜스는 줄을 가르지 않는다 — 없는 블록을 열지 않는다', () => {
    const ingest = new StageBlockIngest();
    // 조각 머리가 펜스처럼 보여도 **같은 줄에 글이 이어지면** 신고가 아니다(문서에서 문법을 설명하는 줄).
    expect(ingest.push('sub-inline', '진행 신고가 ')).toEqual([]);
    expect(ingest.push('sub-inline', '```vibisual``` 블록으로 바뀌었습니다.\n')).toEqual([]);
    // 그 뒤에 오는 진짜 신고는 그대로 도착해야 한다.
    const out = ingest.push('sub-inline', '```vibisual\n- [x] 진짜\n```\n');
    expect(out).toHaveLength(1);
    expect(out[0]?.steps?.[0]?.text).toBe('진짜');
  });

  it('여는 펜스를 잃은 블록의 닫는 펜스가 다음 신고를 삼키지 않는다', () => {
    const ingest = new StageBlockIngest();
    // 실측 `sub-mtu0am3u-tvvu1x`: 신고 3건 중 1건만 도착해 8단계가 1/8 에서 얼었다.
    ingest.push('sub-cascade', '조사는 끝났습니다. 지금부터 본문을 씁니다.');
    ingest.push('sub-cascade', "You've hit your session limit · resets 10pm (Asia/Seoul)");
    const mid = ingest.push('sub-cascade', '```vibisual\n- [~] 서버 배선 @change\n```\n\n이어서 진행합니다.');
    expect(mid).toHaveLength(1);
    const last = ingest.push('sub-cascade', '지금은 마무리입니다.\n\n```vibisual\n- [x] 서버 배선 @change\n```\n');
    expect(last).toHaveLength(1);
    expect(last[0]?.steps?.[0]?.status).toBe('done');
  });

  it('닫는 펜스를 잃은 블록이 세션의 남은 신고를 전부 삼키지 않는다', () => {
    const ingest = new StageBlockIngest();
    // 예시 블록(무대가 아닌 펜스)이 닫히지 않은 채 흘러도, 상한을 넘으면 놓고 다시 읽는다.
    ingest.push('sub-runaway', '~~~markdown\n');
    ingest.push('sub-runaway', `${'x'.repeat(STAGE_INGEST_OPEN_MAX)}\n`);
    const out = ingest.push('sub-runaway', '```vibisual\n- [x] 살아났다\n```\n');
    expect(out).toHaveLength(1);
    expect(out[0]?.steps?.[0]?.text).toBe('살아났다');
  });

  it('턴이 바뀌면 앞 턴이 남긴 반쪽 줄과 열린 펜스를 놓는다', () => {
    const ingest = new StageBlockIngest();
    ingest.push('sub-turn', '```vibisual\n- [ ] 반쪽', 'cmd-1');
    // 앞 턴이 열어 둔 블록이 이 턴의 문장을 자기 본문으로 먹으면 안 된다.
    expect(ingest.push('sub-turn', '이 턴의 첫 문장입니다.\n', 'cmd-2')).toEqual([]);
    const out = ingest.push('sub-turn', '```vibisual\n- [x] 새 턴\n```\n', 'cmd-2');
    expect(out).toHaveLength(1);
    expect(out[0]?.steps).toEqual([{ text: '새 턴', status: 'done' }]);
  });

  it('줄 끝이 CRLF 여도 경계가 이어진다 — 윈도우에서만 신고가 사라지면 안 된다', () => {
    const ingest = new StageBlockIngest();
    expect(ingest.push('sub-crlf', '먼저 확인하겠습니다.')).toEqual([]);
    // 여는 쪽 경계 + 닫는 펜스가 `\r` 만 달고 이벤트가 끝나는 경우를 함께 태운다.
    expect(ingest.push('sub-crlf', '```vibisual\r\n- [x] 확인\r\n```\r')).toHaveLength(1);
  });

  it('세션을 끝없이 들고 있지 않는다 — 키 개수에 상한이 있다', () => {
    const ingest = new StageBlockIngest();
    for (let i = 0; i < STAGE_INGEST_SESSIONS_MAX + 20; i++) ingest.push(`sub-many-${String(i)}`, '문장입니다.');
    expect(ingest.size).toBe(STAGE_INGEST_SESSIONS_MAX);
  });
});

describe('⑪(m) 밑그림 템플릿', () => {
  it('이름으로 찾고, 앞의 @ 와 대소문자는 무시한다', () => {
    expect(findSceneTemplate('wave')?.name).toBe('wave');
    expect(findSceneTemplate('@Wave')?.name).toBe('wave');
    expect(findSceneTemplate('없는이름')).toBeUndefined();
  });

  it('카드가 낸 값이 언제나 이긴다 — 템플릿은 밑칠이다', () => {
    const merged = applySceneTemplate({ color: '#123456', surface: 'diff' }, 'wave');
    expect(merged.color).toBe('#123456');
    expect(merged.surface).toBe('diff');
    // 안 낸 칸은 템플릿이 채운다.
    expect(merged.glyph).toBe(findSceneTemplate('wave')?.glyph);
  });

  it('자기 path 는 템플릿 **위에** 얹힌다 — 밑그림을 쓰는 순간 자기 그림을 잃으면 안 된다', () => {
    const tpl = findSceneTemplate('grid')!;
    const merged = applySceneTemplate({ scene: ['M1 1h2'] }, 'grid');
    expect(merged.scene).toEqual([...tpl.scene, 'M1 1h2']);
  });

  it('없는 밑그림은 아무것도 바꾸지 않는다', () => {
    const input = { glyph: undefined, color: undefined, scene: undefined, surface: undefined };
    expect(applySceneTemplate(input, 'nope')).toBe(input);
  });

  it('템플릿 path 는 전부 SVG 문법을 지킨다(⑪(b))', () => {
    for (const name of ['wave', 'grid', 'branch', 'terminal', 'doc', 'globe']) {
      const tpl = findSceneTemplate(name)!;
      for (const d of [tpl.glyph, ...tpl.scene]) {
        expect(d, `${name}: ${d}`).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/u);
      }
    }
  });
});
