/**
 * 루트 패널 "표시됨" 목록이 **캔버스와 어긋나지 않는다**는 것을 고정한다.
 *
 * 실제 사고: 에이전트가 `.claude/…` 를 만져 캔버스에 `.claude` 버블이 떠 있는데도 패널의
 * "표시됨" 에는 한 줄도 안 나왔다 — 종전 구현이 **디스크 목록을 걸러서** 표시됨을 만들었고,
 * 그 목록은 점으로 시작하는 폴더와 무시 목록(`node_modules`, `dist` …)을 일부러 감추기 때문이다.
 * 사용자에겐 "에이전트가 쓰는 폴더가 체크가 안 된다"로 보였다.
 *
 * 반대 방향도 고정한다: 캔버스에는 디스크 경로가 아닌 합성 버블(프로젝트 루트 자신, 루트 밖
 * 외부 폴더, 워크트리 네임스페이스, 도메인)도 뜨는데, 이들은 이 폴더 **안의** 항목이 아니고
 * `/api/root/toggle` 로 끌 수도 없으므로 행으로 만들면 안 된다.
 */
import { describe, expect, it } from 'vitest';
import type { BubbleData, FolderFileEntry } from '@vibisual/shared';
import { baseName, isSyntheticNodeKey, visibleRowsFrom } from './rootFileRows.js';

/** 테스트용 노드 한 개 — 이 함수가 보는 필드만 채운다. */
function node(p: string, label: string, isDir = true): BubbleData {
  return {
    id: `n-${p}`,
    label,
    bubbleType: isDir ? 'internal_folder' : 'file',
    path: p,
    status: 'idle',
    activity: 0,
  };
}

function entry(relativePath: string, name: string, isDirectory = true): FolderFileEntry {
  return { name, relativePath, isDirectory, isSatellite: false, ...(isDirectory ? { children: [] } : {}) };
}

/** 윈도우/맥 규칙(대소문자 접기) — 리눅스 규칙은 케이스를 보존한다. */
const foldWin = (p: string): string => p.toLowerCase();
const foldLinux = (p: string): string => p;

describe('visibleRowsFrom — 캔버스에 뜬 것은 빠짐없이, 뜨지 않는 것은 하나도', () => {
  it('디스크 목록이 감춘 폴더(`.claude`)도 캔버스에 있으면 행이 된다', () => {
    const rows = visibleRowsFrom([node('.claude', '.claude')], [entry('packages', 'packages')], foldWin);

    expect(rows.map((r) => r.relativePath)).toEqual(['.claude']);
    expect(rows[0]?.isDirectory).toBe(true);
  });

  it('무시 목록 폴더(`node_modules`)도 마찬가지 — 체크 해제할 길이 있어야 한다', () => {
    const rows = visibleRowsFrom([node('node_modules', 'node_modules')], [], foldWin);

    expect(rows.map((r) => r.name)).toEqual(['node_modules']);
  });

  // §7.5 지연 로딩 이후 `FolderFileEntry` 에는 `children` 이 없다(한 겹만 온다) — 이 시험이
  // 지키는 것은 "디스크가 준 항목을 **그 객체 그대로** 쓴다"이지 자식 수가 아니다.
  it('디스크 목록에 있는 항목은 그 항목을 그대로 쓴다 — 이름·상태가 화면에서 흔들리지 않게', () => {
    const onDisk: FolderFileEntry = {
      name: 'packages', relativePath: 'packages', isDirectory: true, isSatellite: true,
    };

    const rows = visibleRowsFrom([node('packages', 'packages')], [onDisk], foldWin);

    expect(rows[0]).toBe(onDisk);
    expect(rows[0]?.isSatellite).toBe(true);
  });

  it('합성 버블(루트 자신·외부 폴더·워크트리·도메인)은 행이 되지 않는다', () => {
    const rows = visibleRowsFrom([
      node('__root__:vibisual', 'vibisual'),
      node('__ext__c:/tmp', 'tmp'),
      node('wt1a2b3c__packages', 'packages'),
      node('__web__github.com', 'github.com'),
      node('docs', 'docs'),
    ], [], foldWin);

    expect(rows.map((r) => r.relativePath)).toEqual(['docs']);
  });

  it('같은 경로가 두 번 와도 한 줄만 — React key 중복이 나지 않는다', () => {
    const rows = visibleRowsFrom([node('docs', 'docs'), node('Docs', 'Docs')], [], foldWin);

    expect(rows).toHaveLength(1);
  });

  it('리눅스 규칙에서는 케이스만 다른 두 폴더가 서로 다른 줄이다', () => {
    const rows = visibleRowsFrom([node('Docs', 'Docs'), node('docs', 'docs')], [], foldLinux);

    expect(rows.map((r) => r.name).sort()).toEqual(['Docs', 'docs']);
  });

  it('폴더가 먼저, 그다음 파일 — 디스크 목록과 같은 정렬', () => {
    const rows = visibleRowsFrom([
      node('readme.md', 'readme.md', false),
      node('scripts', 'scripts'),
      node('docs', 'docs'),
    ], [], foldWin);

    expect(rows.map((r) => r.name)).toEqual(['docs', 'scripts', 'readme.md']);
  });

  it('디스크 목록이 비어도(조회 실패·빈 폴더) 캔버스에 뜬 것은 나온다', () => {
    expect(visibleRowsFrom([node('docs', 'docs')], [], foldWin)).toHaveLength(1);
  });
});

describe('isSyntheticNodeKey / baseName', () => {
  it('디스크 상대 경로는 합성 키가 아니다', () => {
    expect(isSyntheticNodeKey('docs')).toBe(false);
    expect(isSyntheticNodeKey('packages/client/src')).toBe(false);
    expect(isSyntheticNodeKey('.claude')).toBe(false);
  });

  it('절대 경로는 이 목록의 상대 경로가 아니다', () => {
    // 아래 두 경로는 실재하는 사용자 홈이 아니라 가상의 픽스처다.
    // 줄 끝 `privacy-ok` 는 개인정보 스캐너(scripts/privacy-scan.mjs) 오탐 회피 표식이다.
    expect(isSyntheticNodeKey('C:/Users/x/proj')).toBe(true); // privacy-ok
    expect(isSyntheticNodeKey('/home/x/proj')).toBe(true); // privacy-ok
  });

  it('빈 키는 행이 될 수 없다', () => {
    expect(isSyntheticNodeKey('')).toBe(true);
  });

  it('마지막 조각을 이름으로 쓴다', () => {
    expect(baseName('packages/client/src')).toBe('src');
    expect(baseName('docs')).toBe('docs');
  });
});
