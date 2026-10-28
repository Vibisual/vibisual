/**
 * §5.25 (F) "쓴 내용도 남는다" — 코덱스 패치 장부(`codexPatchEdits.ts`) 시험.
 * `file_change` 는 경로만 실어, 사전 훅이 받은 패치 본문을 파일별로 적어 두었다가 완료에서 꺼낸다.
 * 그 짝짓기가 모양이 다른 두 경로(머리줄 `C:/…`·상대경로 ↔ 완료 `C:\…`)와 세 OS 대소문자 규칙에서 맞는지, 남의 칸·지난 턴의 칸을 꺼내지 않는지 본다.
 */
import { describe, expect, it } from 'vitest';
import { CodexPatchEditLedger } from './codexPatchEdits.js';

const PATCH = (header: string): string => [
  '*** Begin Patch',
  `*** Update File: ${header}`,
  '@@',
  ' export interface OutsidePathLinkMenuHandlers {',
  '-  /** 파일이면 그 파일이 든 폴더. */',
  '+  /** 파일이면 상위 폴더에서 해당 파일 선택. */',
  '*** End Patch',
].join('\n');

const note = (ledger: CodexPatchEditLedger, owner: string, patch: string, cwd: string, toolUseId?: string): number =>
  ledger.note(owner, { cwd, toolName: 'apply_patch', toolInput: { command: patch }, ...(toolUseId ? { toolUseId } : {}) });

describe('짝짓기 — 머리줄과 완료가 모양이 달라도 같은 파일이다', () => {
  it('win32: `C:/…` 머리줄 ↔ `C:\\…` 완료(대소문자까지 달라도)', () => {
    const ledger = new CodexPatchEditLedger('win32');
    expect(note(ledger, 'sub-1', PATCH('C:/Work/Proj/src/pathLinkContextMenu.ts'), 'C:\\Work\\Proj', 'call-1')).toBe(1);
    const hit = ledger.take('sub-1', 'c:\\work\\proj\\src\\PATHLINKCONTEXTMENU.ts', 'C:\\Work\\Proj');
    expect(hit).toEqual({
      id: 'call-1:c:/work/proj/src/pathlinkcontextmenu.ts',
      oldString: 'export interface OutsidePathLinkMenuHandlers {\n  /** 파일이면 그 파일이 든 폴더. */',
      newString: 'export interface OutsidePathLinkMenuHandlers {\n  /** 파일이면 상위 폴더에서 해당 파일 선택. */',
    });
  });

  it('상대경로 머리줄은 그 턴의 작업 폴더로 올린다(win32·posix)', () => {
    const win = new CodexPatchEditLedger('win32');
    note(win, 'sub-1', PATCH('src/a.ts'), 'C:\\proj', 'call-1');
    expect(win.take('sub-1', 'C:\\proj\\src\\a.ts', 'C:\\proj')).not.toBeNull();

    const linux = new CodexPatchEditLedger('linux');
    note(linux, 'sub-1', PATCH('src/a.ts'), '/fixture/proj', 'call-1');
    expect(linux.take('sub-1', '/fixture/proj/src/a.ts', '/fixture/proj')).not.toBeNull();
  });

  it('linux 는 케이스를 접지 않는다 — `A.ts` 와 `a.ts` 는 다른 파일이다', () => {
    const ledger = new CodexPatchEditLedger('linux');
    note(ledger, 'sub-1', PATCH('/fixture/proj/src/A.ts'), '/fixture/proj', 'call-1');
    expect(ledger.take('sub-1', '/fixture/proj/src/a.ts', '/fixture/proj')).toBeNull();
    expect(ledger.take('sub-1', '/fixture/proj/src/A.ts', '/fixture/proj')).not.toBeNull();
  });

  it('darwin 은 기본 볼륨처럼 케이스를 접는다', () => {
    const ledger = new CodexPatchEditLedger('darwin');
    note(ledger, 'sub-1', PATCH('/Fixture/Proj/src/A.ts'), '/Fixture/Proj', 'call-1');
    expect(ledger.take('sub-1', '/fixture/proj/src/a.ts', '/Fixture/Proj')).not.toBeNull();
  });
});

describe('꺼내는 규칙 — 한 번만, 내 칸만, 이번 턴만', () => {
  it('꺼내면 지워진다 — 같은 파일의 다음 완료에 같은 이력이 두 번 붙지 않는다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-1');
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).not.toBeNull();
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).toBeNull();
    expect(ledger.size).toBe(0);
  });

  it('다른 sub 의 칸은 꺼내지 않는다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-1');
    expect(ledger.take('sub-2', 'C:\\p\\a.ts', 'C:/p')).toBeNull();
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).not.toBeNull();
  });

  it('턴이 바뀌면(clearOwner) 지난 턴에 적용되지 못한 칸은 사라진다 — 남의 칸은 그대로', () => {
    const ledger = new CodexPatchEditLedger('win32');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-1');
    note(ledger, 'sub-2', PATCH('C:/p/a.ts'), 'C:/p', 'call-2');
    ledger.clearOwner('sub-1');
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).toBeNull();
    expect(ledger.take('sub-2', 'C:\\p\\a.ts', 'C:/p')).not.toBeNull();
  });

  it('같은 파일을 다시 적으면 가장 새 패치가 이긴다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-old');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-new');
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')?.id.startsWith('call-new:')).toBe(true);
  });
});

describe('적는 규칙', () => {
  it('한 패치가 여러 파일을 고치면 파일마다 한 칸 — id 는 호출 id + 경로라 서로를 지우지 않는다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    const patch = [
      '*** Begin Patch',
      '*** Update File: C:/p/a.ts', '@@', '-a', '+A',
      '*** Update File: C:/p/b.ts', '@@', '-b', '+B',
      '*** End Patch',
    ].join('\n');
    expect(note(ledger, 'sub-1', patch, 'C:/p', 'call-1')).toBe(2);
    const a = ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p');
    const b = ledger.take('sub-1', 'C:\\p\\b.ts', 'C:/p');
    expect([a?.oldString, a?.newString, b?.oldString, b?.newString]).toEqual(['a', 'A', 'b', 'B']);
    expect(a?.id).not.toBe(b?.id);
  });

  it('같은 파일이 한 패치에 두 번 나오면 덩어리를 잇는다(뒤엣것이 앞엣것을 지우지 않는다)', () => {
    const ledger = new CodexPatchEditLedger('win32');
    const patch = [
      '*** Begin Patch',
      '*** Update File: C:/p/a.ts', '@@', '-one', '+ONE',
      '*** Update File: c:\\p\\A.ts', '@@', '-two', '+TWO',
      '*** End Patch',
    ].join('\n');
    expect(note(ledger, 'sub-1', patch, 'C:/p', 'call-1')).toBe(1);
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).toMatchObject({ oldString: 'one\ntwo', newString: 'ONE\nTWO' });
  });

  it('지우기·패치가 아닌 도구·본문 없는 입력은 적지 않는다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    expect(note(ledger, 'sub-1', '*** Begin Patch\n*** Delete File: C:/p/a.ts\n*** End Patch', 'C:/p', 'call-1')).toBe(0);
    expect(ledger.note('sub-1', { cwd: 'C:/p', toolName: 'exec_command', toolInput: { command: PATCH('C:/p/a.ts') } })).toBe(0);
    expect(ledger.note('sub-1', { cwd: 'C:/p', toolName: 'apply_patch', toolInput: {} })).toBe(0);
    expect(ledger.note('', { cwd: 'C:/p', toolName: 'apply_patch', toolInput: { command: PATCH('C:/p/a.ts') } })).toBe(0);
    expect(ledger.size).toBe(0);
  });

  it('본문이 `input`·`patch` 칸으로 와도 읽는다(감사 원장과 같은 칸 목록)', () => {
    const ledger = new CodexPatchEditLedger('win32');
    expect(ledger.note('sub-1', { cwd: 'C:/p', toolName: 'apply_patch', toolInput: { input: PATCH('C:/p/a.ts') } })).toBe(1);
    expect(ledger.note('sub-1', { cwd: 'C:/p', toolName: 'apply_patch', toolInput: { patch: PATCH('C:/p/b.ts') } })).toBe(1);
  });

  it('호출 id 가 없으면 지어낸 id 끼리도 겹치지 않는다', () => {
    const ledger = new CodexPatchEditLedger('win32');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p');
    const first = ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p');
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p');
    const second = ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p');
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  it('완료가 오지 않는 칸은 상한에서 가장 오래된 것부터 걷힌다', () => {
    const ledger = new CodexPatchEditLedger('win32', 2);
    note(ledger, 'sub-1', PATCH('C:/p/a.ts'), 'C:/p', 'call-a');
    note(ledger, 'sub-1', PATCH('C:/p/b.ts'), 'C:/p', 'call-b');
    note(ledger, 'sub-1', PATCH('C:/p/c.ts'), 'C:/p', 'call-c');
    expect(ledger.size).toBe(2);
    expect(ledger.take('sub-1', 'C:\\p\\a.ts', 'C:/p')).toBeNull();
    expect(ledger.take('sub-1', 'C:\\p\\c.ts', 'C:/p')).not.toBeNull();
  });
});
