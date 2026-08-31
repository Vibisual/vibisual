import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_DRAG_MIME,
  WORKSPACE_DRAG_DIR_MIME,
  decodeWorkspaceDrag,
  encodeWorkspaceDrag,
  dragHasWorkspaceEntry,
  dragIsDirectory,
  movedRelPath,
  parentRelOf,
  resolveWorkspaceDropZone,
  workspaceDropBox,
  dropBoxToPercent,
  workspaceMoveBlock,
  type WorkspaceDragPayload,
} from './explorerDrag.js';

/**
 * §5.5 #17-19 ⑧ — 끌어다 놓기의 순수 판정 테스트.
 *
 * 이 파일이 지키는 것은 셋이다 — (a) 남의 드래그를 우리 짐으로 넘겨짚지 않는다, (b) 눈에 보이는
 * 미리보기 띠와 실제 판정이 **같은 값**에서 나온다, (c) 되물음을 띄우기 전에 헛일을 걸러 낸다.
 * 케이스 접기는 세 OS 를 전부 넣어 본다(win/mac 은 접고 linux 는 안 접는다 — 실기가 없어 인자로 받는다).
 */

const lower = (p: string): string => p.toLowerCase();
const asIs = (p: string): string => p;

const file: WorkspaceDragPayload = {
  root: 'C:/work/app',
  relPath: 'src/App.tsx',
  name: 'App.tsx',
  isDirectory: false,
  absPath: 'C:/work/app/src/App.tsx',
};
const dir: WorkspaceDragPayload = {
  root: 'C:/work/app',
  relPath: 'src',
  name: 'src',
  isDirectory: true,
  absPath: 'C:/work/app/src',
};

describe('짐표 — 종류로 알아보고 값은 손을 뗄 때 읽는다', () => {
  it('왕복해도 그대로다', () => {
    expect(decodeWorkspaceDrag(encodeWorkspaceDrag(file))).toEqual(file);
  });

  it('우리 짐이 아니면 null — 넘겨짚지 않는다', () => {
    expect(decodeWorkspaceDrag(null)).toBeNull();
    expect(decodeWorkspaceDrag('')).toBeNull();
    expect(decodeWorkspaceDrag('not json')).toBeNull();
    expect(decodeWorkspaceDrag('{"relPath":"a.ts"}')).toBeNull();
    expect(decodeWorkspaceDrag('[1,2]')).toBeNull();
  });

  it('종류만으로 우리 짐·폴더 여부를 가른다', () => {
    expect(dragHasWorkspaceEntry([WORKSPACE_DRAG_MIME])).toBe(true);
    expect(dragHasWorkspaceEntry(['Files', 'text/plain'])).toBe(false);
    expect(dragIsDirectory([WORKSPACE_DRAG_MIME, WORKSPACE_DRAG_DIR_MIME])).toBe(true);
    expect(dragIsDirectory([WORKSPACE_DRAG_MIME])).toBe(false);
  });
});

describe('resolveWorkspaceDropZone — 가운데는 글자, 오른쪽은 열기', () => {
  const rect = { left: 100, top: 0, width: 1000, height: 600 };

  it('편집창이 닫혀 있으면 오른쪽 끝의 띠만 열기 자리다', () => {
    expect(resolveWorkspaceDropZone(rect, 300, null)).toBe('input');
    expect(resolveWorkspaceDropZone(rect, 1090, null)).toBe('editor');
  });

  it('편집창이 열려 있으면 그 패널 자체가 열기 자리다 — 보이는 경계와 판정이 같다', () => {
    expect(resolveWorkspaceDropZone(rect, 690, 700)).toBe('input');
    expect(resolveWorkspaceDropZone(rect, 700, 700)).toBe('editor');
    expect(resolveWorkspaceDropZone(rect, 1050, 700)).toBe('editor');
  });

  it('미리보기 띠는 판정과 같은 경계를 쓴다', () => {
    const boxInput = workspaceDropBox(rect, 'input', 700);
    const boxEditor = workspaceDropBox(rect, 'editor', 700);
    expect(boxInput).toEqual({ leftPx: 0, widthPx: 600 });
    expect(boxEditor).toEqual({ leftPx: 600, widthPx: 400 });
    // 두 띠를 합치면 본문 폭 그대로 — 사이가 벌어지거나 겹치지 않는다.
    expect(boxInput.widthPx + boxEditor.widthPx).toBe(rect.width);
  });

  it('편집창이 닫혀 있을 때의 띠도 서로 붙어 있다', () => {
    const a = workspaceDropBox(rect, 'input', null);
    const b = workspaceDropBox(rect, 'editor', null);
    expect(a.leftPx + a.widthPx).toBe(b.leftPx);
    expect(b.widthPx).toBeGreaterThan(0);
  });
});

describe('dropBoxToPercent — 확대한 캔버스 위에서도 띠가 어긋나지 않는다', () => {
  const outer = { left: 0, top: 0, width: 1200, height: 600 };
  const content = { left: 200, top: 0, width: 1000, height: 600 };

  it('본문이 바깥 상자 안쪽에서 시작해도 그만큼 밀어 준다', () => {
    expect(dropBoxToPercent({ leftPx: 0, widthPx: 600 }, content, outer))
      .toEqual({ leftPct: (200 / 1200) * 100, widthPct: 50 });
  });

  it('두 배로 확대돼도(두 사각형이 함께 커져도) 같은 비율이 나온다', () => {
    const outer2 = { left: 0, top: 0, width: 2400, height: 1200 };
    const content2 = { left: 400, top: 0, width: 2000, height: 1200 };
    expect(dropBoxToPercent({ leftPx: 0, widthPx: 1200 }, content2, outer2))
      .toEqual(dropBoxToPercent({ leftPx: 0, widthPx: 600 }, content, outer));
  });

  it('바깥 상자가 0 이면 0 — 나누기가 무너지지 않는다', () => {
    expect(dropBoxToPercent({ leftPx: 0, widthPx: 10 }, content, { left: 0, top: 0, width: 0, height: 0 }))
      .toEqual({ leftPct: 0, widthPct: 0 });
  });
});

describe('workspaceMoveBlock — 되물음을 띄우기 전에 헛일을 걸러 낸다', () => {
  it('다른 폴더로는 옮길 수 있다', () => {
    expect(workspaceMoveBlock(file, 'C:/work/app', 'docs', asIs)).toBeNull();
    expect(workspaceMoveBlock(file, 'C:/work/app', '', asIs)).toBeNull();
  });

  it('이미 사는 폴더 위에서는 막는다', () => {
    expect(workspaceMoveBlock(file, 'C:/work/app', 'src', asIs)).toBe('same-parent');
  });

  it('자기 자신 위·자기 하위로는 막는다', () => {
    expect(workspaceMoveBlock(dir, 'C:/work/app', 'src', asIs)).toBe('self');
    expect(workspaceMoveBlock(dir, 'C:/work/app', 'src/deep', asIs)).toBe('into-self');
  });

  it('이름이 접두사만 같은 이웃은 자기 하위가 아니다', () => {
    expect(workspaceMoveBlock(dir, 'C:/work/app', 'srcery', asIs)).toBeNull();
  });

  it('다른 프로젝트 트리로는 못 넘긴다', () => {
    expect(workspaceMoveBlock(file, 'C:/work/other', 'docs', asIs)).toBe('other-root');
  });

  it('루트 표기가 달라도(역슬래시·끝 슬래시) 같은 트리로 본다', () => {
    expect(workspaceMoveBlock(file, 'C:\\work\\app\\', 'docs', asIs)).toBeNull();
  });

  it('win/mac 은 대소문자를 접고, linux 는 접지 않는다', () => {
    // 접는 쪽: `SRC` 는 곧 `src` 라 "이미 사는 폴더"다.
    expect(workspaceMoveBlock(file, 'C:/work/app', 'SRC', lower)).toBe('same-parent');
    // 안 접는 쪽: `SRC` 는 다른 폴더라 옮길 수 있다.
    expect(workspaceMoveBlock(file, 'C:/work/app', 'SRC', asIs)).toBeNull();
  });
});

describe('경로 조각', () => {
  it('부모 폴더 — 최상위는 루트다', () => {
    expect(parentRelOf('src/App.tsx')).toBe('src');
    expect(parentRelOf('README.md')).toBe('');
  });

  it('옮기고 나면 앉을 자리', () => {
    expect(movedRelPath(file, 'docs')).toBe('docs/App.tsx');
    expect(movedRelPath(file, '')).toBe('App.tsx');
  });
});
