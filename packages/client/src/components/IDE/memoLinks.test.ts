import { describe, it, expect } from 'vitest';
import { SESSION_MEMO, sanitizeMemoLinks, type SessionMemoLink, type SessionMemoLinkTarget, type WorkspaceEntry } from '@vibisual/shared';
import {
  canAddMemoLink,
  diffTextEdit,
  linkAtRange,
  linkForMenu,
  linkHoldingRange,
  memoLinkInk,
  memoLinkSegments,
  memoLinkTargetText,
  mergeLinkFileEntries,
  newMemoLinkId,
  parseMemoLinkUrlInput,
  promptLinkLabel,
  rangeOverlapsLinks,
  removeMemoLink,
  retargetMemoLink,
  shiftLinkRange,
  shiftMemoLinks,
  shiftTextRange,
  streamHeadText,
  streamLinkTarget,
  trimLinkRange,
  urlLikeSelection,
  urlLinkTarget,
  withMemoLink,
} from './memoLinks.js';

/** §5.5 #17-36 ⑫ 메모 링크 순수 계산 회귀: 편집을 따라 움직임(경계 입력은 링크 아님)·안 겹침·서버와 같은 정화·거울 층 토막이 본문을 빠짐없이 덮음. */

const STREAM: SessionMemoLinkTarget = { kind: 'stream', sessionId: 'sub-1', anchorId: 'cmd-1', text: '빌드 오류' };
const URL_T: SessionMemoLinkTarget = { kind: 'url', url: 'https://example.com' };

function link(id: string, start: number, end: number, target: SessionMemoLinkTarget = STREAM): SessionMemoLink {
  return { id, start, end, target };
}

describe('trimLinkRange — 고른 범위의 앞뒤 공백을 뗀다', () => {
  it('더블클릭이 딸려 온 공백은 링크에 들지 않는다', () => {
    expect(trimLinkRange('  hello world ', 0, 8)).toEqual({ start: 2, end: 7 });
  });
  it('뒤집힌 범위도 바로잡고, 본문 밖은 접는다', () => {
    expect(trimLinkRange('abc', 3, 0)).toEqual({ start: 0, end: 3 });
    expect(trimLinkRange('abc', 1, 99)).toEqual({ start: 1, end: 3 });
  });
  it('공백뿐이거나 빈 범위면 null — 걸 글자가 없다', () => {
    expect(trimLinkRange('a   b', 1, 4)).toBeNull();
    expect(trimLinkRange('abc', 2, 2)).toBeNull();
  });
});

describe('diffTextEdit — 바뀐 한 토막', () => {
  it('같으면 null', () => {
    expect(diffTextEdit('abc', 'abc')).toBeNull();
  });
  it('삽입·삭제·치환을 한 모양으로 잡는다', () => {
    expect(diffTextEdit('abc', 'abXc')).toEqual({ at: 2, removed: 0, inserted: 1 });
    expect(diffTextEdit('abcdef', 'abf')).toEqual({ at: 2, removed: 3, inserted: 0 });
    expect(diffTextEdit('hello world', 'hello there')).toEqual({ at: 6, removed: 5, inserted: 5 });
  });
  it('같은 낱말이 반복되어도 실제로 고른 앞쪽 삭제를 찾는다', () => {
    expect(diffTextEdit('foo foo', 'foo', { start: 0, end: 4, inputType: 'deleteByCut' }))
      .toEqual({ at: 0, removed: 4, inserted: 0 });
  });
  it('붙여넣기 결과가 앞뒤 글자와 같아도 고른 범위 전체를 치환으로 읽는다', () => {
    expect(diffTextEdit('foo foo', 'foo foo foo', { start: 0, end: 3, inputType: 'insertFromPaste' }))
      .toEqual({ at: 0, removed: 3, inserted: 7 });
  });
  it.each([
    ['deleteContentBackward', 1, 0],
    ['deleteContentForward', 0, 0],
    ['deleteWordBackward', 2, 1],
    ['deleteWordForward', 1, 1],
  ])('%s 는 반복된 글자에서도 캐럿의 삭제 방향을 따른다', (inputType, caret, at) => {
    expect(diffTextEdit('aaaa', 'aaa', { start: caret, end: caret, inputType }))
      .toEqual({ at, removed: 1, inserted: 0 });
  });
  it('삭제한 UTF-16 길이를 실제 본문에서 얻는다 — 이모지를 반으로 자르지 않는다', () => {
    expect(diffTextEdit('😀😀', '😀', { start: 2, end: 2, inputType: 'deleteContentBackward' }))
      .toEqual({ at: 0, removed: 2, inserted: 0 });
  });
  it('종류 없는 선택 힌트도 사용자 메뉴의 잘라내기·붙여넣기에 쓸 수 있다', () => {
    expect(diffTextEdit('foo foo', 'foo', { start: 0, end: 4 }))
      .toEqual({ at: 0, removed: 4, inserted: 0 });
    expect(diffTextEdit('aaaa', 'aaaaa', { start: 1, end: 1 }))
      .toEqual({ at: 1, removed: 0, inserted: 1 });
  });
  it('선택 범위 바깥도 바뀌었으면 낡은 힌트를 버리고 실제 본문을 비교한다', () => {
    expect(diffTextEdit('abc', 'abXc', { start: 0, end: 0, inputType: 'insertText' }))
      .toEqual({ at: 2, removed: 0, inserted: 1 });
  });
  it.each([
    { start: -1, end: 0 },
    { start: 0, end: 99 },
    { start: 2, end: 1 },
    { start: 0.5, end: 1 },
    { start: Number.NaN, end: 1 },
  ])('유효하지 않은 범위 %j 는 기존 비교로 돌아간다', (hint) => {
    expect(diffTextEdit('abc', 'aXbc', hint)).toEqual({ at: 1, removed: 0, inserted: 1 });
  });
  it('IME 조합·실행 취소는 현재 선택을 편집 범위로 오해하지 않는다', () => {
    expect(diffTextEdit('한 한', '한 가', { start: 0, end: 3, inputType: 'insertCompositionText' }))
      .toEqual({ at: 2, removed: 1, inserted: 1 });
    expect(diffTextEdit('foo foo', 'foo', { start: 0, end: 4, inputType: 'historyUndo' }))
      .toEqual({ at: 3, removed: 4, inserted: 0 });
    expect(diffTextEdit('한글', '한글', { start: 0, end: 2, inputType: 'insertCompositionText' })).toBeNull();
  });
});

describe('shiftLinkRange — 링크는 편집을 따라 움직인다', () => {
  const r = { start: 4, end: 8 }; // "abcdLINKefgh"

  it('앞에 치면 통째로 밀리고, 뒤에 치면 그대로다', () => {
    expect(shiftLinkRange(r, { at: 1, removed: 0, inserted: 3 })).toEqual({ start: 7, end: 11 });
    expect(shiftLinkRange(r, { at: 10, removed: 0, inserted: 2 })).toEqual(r);
  });
  it('경계에 친 글자는 링크가 되지 않는다 — 시작 경계면 밀리고 끝 경계면 그대로', () => {
    expect(shiftLinkRange(r, { at: 4, removed: 0, inserted: 2 })).toEqual({ start: 6, end: 10 });
    expect(shiftLinkRange(r, { at: 8, removed: 0, inserted: 2 })).toEqual(r);
  });
  it('안에서 치면 늘고, 안에서 지우면 준다', () => {
    expect(shiftLinkRange(r, { at: 6, removed: 0, inserted: 3 })).toEqual({ start: 4, end: 11 });
    expect(shiftLinkRange(r, { at: 5, removed: 2, inserted: 0 })).toEqual({ start: 4, end: 6 });
    // 끝 글자 하나를 지운다(Backspace 를 링크 끝에서).
    expect(shiftLinkRange(r, { at: 7, removed: 1, inserted: 0 })).toEqual({ start: 4, end: 7 });
  });
  it('링크 글자를 통째로 지우거나 갈아 치우면 링크도 사라진다', () => {
    expect(shiftLinkRange(r, { at: 4, removed: 4, inserted: 0 })).toBeNull();
    expect(shiftLinkRange(r, { at: 4, removed: 4, inserted: 3 })).toBeNull();
    expect(shiftLinkRange(r, { at: 2, removed: 9, inserted: 1 })).toBeNull();
  });
  it('한쪽 끝에 걸치면 남은 글자만 남는다', () => {
    // 앞쪽 [2,6) 을 "XY" 로 — 남은 링크 글자 [6,8) 은 [4,6) 으로 간다.
    expect(shiftLinkRange(r, { at: 2, removed: 4, inserted: 2 })).toEqual({ start: 4, end: 6 });
    // 뒤쪽 [6,10) 을 지운다 — 남는 것은 [4,6).
    expect(shiftLinkRange(r, { at: 6, removed: 4, inserted: 0 })).toEqual({ start: 4, end: 6 });
  });
  it('앞쪽 삭제가 링크 시작에 딱 닿으면(Backspace 를 링크 앞에서) 통째로 당겨진다', () => {
    expect(shiftLinkRange(r, { at: 3, removed: 1, inserted: 0 })).toEqual({ start: 3, end: 7 });
  });
});

describe('shiftMemoLinks — 본문 편집 한 번에 링크 목록 전체를', () => {
  const links = [link('a', 0, 5), link('b', 10, 13, URL_T)];

  it('안 바뀌면 같은 배열 — 저장 왕복이 헛돌지 않는다', () => {
    expect(shiftMemoLinks(links, 'build log app docs', 'build log app docs')).toBe(links);
    // 링크 뒤만 고쳤다.
    expect(shiftMemoLinks(links, 'build log app docs', 'build log app docs!')).toBe(links);
  });
  it('앞을 고치면 뒤의 링크들이 같이 밀린다', () => {
    const out = shiftMemoLinks(links, 'build log app docs', '>> build log app docs');
    expect(out.map((l) => [l.id, l.start, l.end])).toEqual([['a', 3, 8], ['b', 13, 16]]);
  });
  it('링크 글자가 사라지면 그 링크만 빠진다', () => {
    const out = shiftMemoLinks(links, 'build log app docs', ' log app docs');
    expect(out.map((l) => l.id)).toEqual(['b']);
  });
  it('반복된 첫 낱말을 지우면 그 링크는 지워지고 남은 낱말의 링크만 당겨진다', () => {
    const out = shiftMemoLinks([link('first', 0, 3), link('second', 4, 7)], 'foo foo', 'foo', {
      start: 0, end: 4, inputType: 'deleteContentBackward',
    });
    expect(out).toEqual([link('second', 0, 3)]);
  });
  it('반복된 첫 링크 글자를 붙여넣기로 덮으면 새 글자로 링크가 옮겨 붙지 않는다', () => {
    const out = shiftMemoLinks([link('first', 0, 3), link('second', 4, 7)], 'foo foo', 'foo foo foo', {
      start: 0, end: 3, inputType: 'insertFromPaste',
    });
    expect(out).toEqual([link('second', 8, 11)]);
  });
  it('같은 글자를 링크 시작 경계에 넣으면 링크는 밀리고 안에 넣으면 늘어난다', () => {
    const repeated = [link('same', 0, 4)];
    expect(shiftMemoLinks(repeated, 'aaaa', 'aaaaa', { start: 0, end: 0, inputType: 'insertText' }))
      .toEqual([link('same', 1, 5)]);
    expect(shiftMemoLinks(repeated, 'aaaa', 'aaaaa', { start: 2, end: 2, inputType: 'insertText' }))
      .toEqual([link('same', 0, 5)]);
  });
  it('IME 조합은 중간 글자를 바꾸어도 그 글자를 감싼 링크를 유지한다', () => {
    let composing = shiftMemoLinks([link('korean', 0, 4)], '한글메모', '한ㄱ글메모', {
      start: 1, end: 1, inputType: 'insertCompositionText',
    });
    expect(composing).toEqual([link('korean', 0, 5)]);
    composing = shiftMemoLinks(composing, '한ㄱ글메모', '한가글메모', {
      start: 2, end: 2, inputType: 'insertCompositionText',
    });
    expect(composing).toEqual([link('korean', 0, 5)]);
    expect(shiftMemoLinks(composing, '한가글메모', '한가글메모', {
      start: 2, end: 2, inputType: 'insertFromComposition',
    })).toBe(composing);
  });
});

describe('shiftTextRange — 고르는 중인 범위도 같은 규칙', () => {
  it('옆에서 친 글자만큼 따라간다', () => {
    expect(shiftTextRange({ start: 6, end: 9 }, 'build log', 'my build log')).toEqual({ start: 9, end: 12 });
  });
  it('그 글자가 지워졌으면 null', () => {
    expect(shiftTextRange({ start: 6, end: 9 }, 'build log', 'build ')).toBeNull();
  });
  it('반복된 글자 중 실제로 지운 범위를 따라 고르기 대상을 걷는다', () => {
    expect(shiftTextRange({ start: 0, end: 3 }, 'foo foo', 'foo', { start: 0, end: 4 })).toBeNull();
  });
});

describe('어느 링크를 보고 있나', () => {
  const links = [link('a', 0, 5), link('b', 10, 13)];
  it('캐럿은 양 끝 포함 — 링크 바로 뒤에 캐럿을 둬도 그 링크다', () => {
    expect(linkAtRange(links, 5, 5)?.id).toBe('a');
    expect(linkAtRange(links, 0, 0)?.id).toBe('a');
    expect(linkAtRange(links, 7, 7)).toBeUndefined();
  });
  it('링크 상자는 고른 범위가 그 링크 안에 다 들어갈 때만', () => {
    expect(linkHoldingRange(links, 1, 3)?.id).toBe('a');
    expect(linkHoldingRange(links, 3, 8)).toBeUndefined();
  });
  it('메뉴는 범위가 링크와 **똑같을** 때만 그 링크 — 넓게 고르면 새로 거는 것이다', () => {
    const text = 'build log app docs';
    expect(linkForMenu(links, text, 10, 13)?.id).toBe('b');
    // 앞뒤 공백을 떼면 같은 범위다(더블클릭이 공백을 데려와도 같은 링크).
    expect(linkForMenu(links, text, 9, 14)?.id).toBe('b');
    expect(linkForMenu(links, text, 6, 13)).toBeUndefined();
    expect(rangeOverlapsLinks(links, { start: 6, end: 13 })).toBe(true);
  });
});

describe('걸기·다시 고르기·해제', () => {
  it('겹친 옛 링크는 걷히고 결과는 시작 순이다', () => {
    const out = withMemoLink([link('a', 0, 5), link('b', 10, 13)], { start: 3, end: 11 }, URL_T, 'new');
    expect(out?.map((l) => l.id)).toEqual(['new']);
    const kept = withMemoLink([link('b', 10, 13)], { start: 0, end: 5 }, URL_T, 'new');
    expect(kept?.map((l) => l.id)).toEqual(['new', 'b']);
  });
  it('상한이면 null — 화면은 미리 흐린다', () => {
    const full = Array.from({ length: SESSION_MEMO.LINK_MAX }, (_, i) => link(`l${i}`, i * 2, i * 2 + 1));
    expect(withMemoLink(full, { start: 200, end: 201 }, URL_T, 'x')).toBeNull();
    expect(canAddMemoLink(full)).toBe(false);
    // 겹쳐서 걷히는 자리가 있으면 그만큼은 걸 수 있다.
    expect(canAddMemoLink(full, { start: 0, end: 1 })).toBe(true);
  });
  it('다시 고르기는 범위를 두고 가리키는 곳만 바꾼다', () => {
    const out = retargetMemoLink([link('a', 0, 5)], 'a', URL_T);
    expect(out).toEqual([{ id: 'a', start: 0, end: 5, target: URL_T }]);
    expect(retargetMemoLink([link('a', 0, 5)], 'zz', URL_T)).toBeNull();
  });
  it('해제는 그 링크만 걷는다', () => {
    expect(removeMemoLink([link('a', 0, 5), link('b', 6, 9)], 'a').map((l) => l.id)).toEqual(['b']);
  });
  it('새 링크 id 는 정화(`[\\w-]`)를 그대로 지난다', () => {
    const id = newMemoLinkId(1700000000000, () => 0.5);
    expect(id).toMatch(/^[\w-]{1,64}$/);
    const text = 'abcdef';
    expect(sanitizeMemoLinks([link(id, 0, 3)], text.length)).toHaveLength(1);
  });
});

describe('가리키는 곳 — 서버 정화와 같은 자로', () => {
  it('세션 글 위치는 글을 접어 둔다(서버가 돌려줄 글과 같다)', () => {
    expect(streamLinkTarget('sub-1', 'cmd-9', '  빌드\n  오류  ')).toEqual({ kind: 'stream', sessionId: 'sub-1', anchorId: 'cmd-9', text: '빌드 오류' });
    expect(streamLinkTarget(null, undefined, '')).toBeNull();
  });
  it('항목을 눌러 고르면 첫머리만 들고 간다', () => {
    expect(streamHeadText('가'.repeat(500))).toHaveLength(SESSION_MEMO.LINK_HEAD_MAX);
  });
  it('웹 주소 — 스킴이 없으면 붙여 주고(localhost 는 http), 위험한 스킴은 받지 않는다', () => {
    expect(parseMemoLinkUrlInput('example.com/docs')).toBe('https://example.com/docs');
    expect(parseMemoLinkUrlInput('localhost:5173/app')).toBe('http://localhost:5173/app');
    expect(parseMemoLinkUrlInput('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(parseMemoLinkUrlInput('https://a.dev')).toBe('https://a.dev');
    expect(parseMemoLinkUrlInput('javascript:alert(1)')).toBe('');
    expect(parseMemoLinkUrlInput('ftp://host/file')).toBe('');
    expect(parseMemoLinkUrlInput('   ')).toBe('');
    expect(urlLinkTarget('example.com')).toEqual({ kind: 'url', url: 'https://example.com' });
    expect(urlLinkTarget('data:text/html,x')).toBeNull();
  });
  it('주소처럼 생긴 고른 글자만 웹 주소 칸에 미리 채운다', () => {
    expect(urlLikeSelection('https://a.dev/x')).toBe('https://a.dev/x');
    expect(urlLikeSelection('docs.example.com')).toBe('docs.example.com');
    expect(urlLikeSelection('localhost:3000')).toBe('localhost:3000');
    expect(urlLikeSelection('README')).toBe('');
    expect(urlLikeSelection('빌드 오류 확인')).toBe('');
  });
});

describe('화면에 보일 글', () => {
  it('내 입력은 첫 줄을 접어 상한까지(넘치면 …)', () => {
    expect(promptLinkLabel('\n\n  첫   줄  \n둘째 줄')).toBe('첫 줄');
    const long = promptLinkLabel('가'.repeat(100));
    expect(long).toHaveLength(48);
    expect(long.endsWith('…')).toBe(true);
  });
  it('다른 세션은 살아 있는 이름이 이기고, 없으면 걸 때의 이름', () => {
    const target: SessionMemoLinkTarget = { kind: 'session', sessionId: 'sub-2', label: '옛 이름' };
    expect(memoLinkTargetText(target, '새 이름')).toBe('새 이름');
    expect(memoLinkTargetText(target, null)).toBe('옛 이름');
  });
  it('밝은 판과 어두운 판의 잉크는 다르다 — 같은 파랑이면 한쪽에서 녹아 사라진다', () => {
    expect(memoLinkInk(true).line).not.toBe(memoLinkInk(false).line);
  });
});

describe('memoLinkSegments — 거울 층 토막', () => {
  const text = 'build log app docs';
  const join = (segs: { text: string }[]): string => segs.map((s) => s.text).join('');

  it('토막을 이으면 본문 그대로 — 한 글자라도 빠지면 밑줄이 전부 밀린다', () => {
    const segs = memoLinkSegments(text, [link('a', 0, 5), link('b', 10, 13)], null);
    expect(join(segs)).toBe(text);
    expect(segs.filter((s) => s.linkId).map((s) => s.text)).toEqual(['build', 'app']);
  });
  it('고르는 중인 범위가 겹친 링크를 이긴다(곧 그 범위로 바뀐다)', () => {
    const segs = memoLinkSegments(text, [link('a', 0, 5), link('b', 10, 13)], { start: 3, end: 7 });
    expect(join(segs)).toBe(text);
    expect(segs.find((s) => s.pending)?.text).toBe('ld l');
    expect(segs.some((s) => s.linkId === 'a')).toBe(false);
    expect(segs.some((s) => s.linkId === 'b')).toBe(true);
  });
  it('본문 밖으로 나간 링크는 그리지 않는다', () => {
    expect(join(memoLinkSegments('abc', [link('a', 1, 9)], null))).toBe('abc');
  });
});

describe('mergeLinkFileEntries — 갈래 넷을 한 목록으로', () => {
  const entry = (relPath: string, mtimeMs?: number): WorkspaceEntry => ({
    name: relPath.split('/').pop() ?? relPath,
    relPath,
    isDirectory: false,
    ...(mtimeMs !== undefined ? { mtimeMs } : {}),
  });
  it('경로가 같으면 하나, 최근 고친 것부터, 시각이 같으면 경로 순', () => {
    const out = mergeLinkFileEntries([
      [entry('src/a.ts', 10), entry('src/b.ts', 30)],
      [entry('index.html', 20), entry('src/a.ts', 10)],
      [entry('img/z.png'), entry('img/y.png')],
    ]);
    expect(out.map((e) => e.relPath)).toEqual(['src/b.ts', 'index.html', 'src/a.ts', 'img/y.png', 'img/z.png']);
  });
});
