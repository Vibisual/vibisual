/**
 * §5.5 #17-20 ⑦-1 v4.83 — 언리얼 프로젝트 해석기 테스트.
 *
 * 여기서 지키는 것은 하나다 — **엔진을 마음대로 고르지 않는다.** `EngineAssociation` 이
 * 가리키지 않는 엔진으로 프로젝트를 열면 에셋이 상향 변환되고 되돌릴 수 없다. 그래서
 * "못 찾았을 때 설치된 최신으로 때우지 않는다" 가 회귀 테스트의 핵심이다.
 *
 * 레지스트리·런처 매니페스트는 이 기계에 무엇이 깔려 있느냐에 따라 답이 달라지므로 검증하지
 * 않는다. 대신 **디스크만 보고 답이 정해지는** 두 갈래(엔진 트리 내장 · 상대 경로)와 실행
 * 파일·빌드 스크립트 탐색을 임시 폴더로 세워 확인한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findBuildScript,
  findEditorExe,
  findUProject,
  inspectUnrealProject,
  resolveEngineRoot,
} from './unrealProjectService.js';

let tmpDir: string;

function write(rel: string, body: string): void {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

/** 이 플랫폼에서 엔진이 실제로 갖는 실행 파일·빌드 스크립트 상대 경로. */
function enginePaths(): { editor: string; build: string } {
  if (process.platform === 'win32') {
    return { editor: 'Engine/Binaries/Win64/UnrealEditor.exe', build: 'Engine/Build/BatchFiles/Build.bat' };
  }
  if (process.platform === 'darwin') {
    return {
      editor: 'Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
      build: 'Engine/Build/BatchFiles/Mac/Build.sh',
    };
  }
  return { editor: 'Engine/Binaries/Linux/UnrealEditor', build: 'Engine/Build/BatchFiles/Linux/Build.sh' };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-unreal-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 정리 실패는 테스트 결과와 무관 */
  }
});

describe('findUProject', () => {
  it('루트의 .uproject 를 찾는다', () => {
    write('P_MPS.uproject', '{"EngineAssociation":"5.8"}');
    expect(findUProject(tmpDir)).toBe(path.join(tmpDir, 'P_MPS.uproject'));
  });

  it('한 겹 아래에 있어도 찾는다', () => {
    write('Game/P_MPS.uproject', '{}');
    expect(findUProject(tmpDir)).toBe(path.join(tmpDir, 'Game', 'P_MPS.uproject'));
  });

  it('빌드 산출물 폴더는 뒤지지 않는다 — 거기 있는 사본에 속으면 안 된다', () => {
    write('Intermediate/Copy.uproject', '{}');
    write('Binaries/Old.uproject', '{}');
    expect(findUProject(tmpDir)).toBeNull();
  });

  it('언리얼 프로젝트가 아니면 null', () => {
    write('package.json', '{}');
    expect(findUProject(tmpDir)).toBeNull();
  });
});

describe('resolveEngineRoot', () => {
  it('EngineAssociation 이 비면 엔진 트리 안에서 찾는다', () => {
    write('Engine/Binaries/placeholder', '');
    write('Projects/P_MPS.uproject', '{}');
    const { root, source } = resolveEngineRoot('', path.join(tmpDir, 'Projects', 'P_MPS.uproject'));
    expect(root).toBe(tmpDir);
    expect(source).toBe('in-engine-tree');
  });

  it('없는 버전을 가리키면 설치된 최신으로 때우지 않고 not-found 를 돌려준다', () => {
    // 이 회귀가 이 파일의 존재 이유다 — 폴백이 다시 생기면 여기서 걸린다.
    const { root, source } = resolveEngineRoot('4.11', path.join(tmpDir, 'P_MPS.uproject'));
    expect(root).toBeNull();
    expect(source).toBe('not-found');
  });

  it('등록되지 않은 GUID(소스 빌드)도 not-found 로 답한다', () => {
    const { root, source } = resolveEngineRoot(
      '{12345678-1234-1234-1234-123456789ABC}',
      path.join(tmpDir, 'P_MPS.uproject'),
    );
    expect(root).toBeNull();
    expect(source).toBe('not-found');
  });

  it('상대 경로를 적어 둔 경우 프로젝트 기준으로 푼다', () => {
    write('MyEngine/Engine/Binaries/placeholder', '');
    write('Game/P_MPS.uproject', '{}');
    const { root, source } = resolveEngineRoot('../MyEngine', path.join(tmpDir, 'Game', 'P_MPS.uproject'));
    expect(root).toBe(path.join(tmpDir, 'MyEngine'));
    expect(source).toBe('conventional-path');
  });
});

describe('findEditorExe · findBuildScript', () => {
  it('플랫폼에 맞는 에디터와 빌드 스크립트를 찾는다', () => {
    const { editor, build } = enginePaths();
    write(editor, '');
    write(build, '');
    expect(findEditorExe(tmpDir)).toBe(path.join(tmpDir, ...editor.split('/')));
    expect(findBuildScript(tmpDir)).toBe(path.join(tmpDir, ...build.split('/')));
  });

  it('엔진 루트가 비면 둘 다 null', () => {
    expect(findEditorExe(tmpDir)).toBeNull();
    expect(findBuildScript(tmpDir)).toBeNull();
  });
});

describe('inspectUnrealProject', () => {
  it('언리얼이 아니면 null', () => {
    write('package.json', '{"name":"web"}');
    expect(inspectUnrealProject(tmpDir)).toBeNull();
  });

  it('엔진을 못 찾아도 프로젝트 정보는 돌려준다 — 화면이 이유를 적어야 하므로', () => {
    write('P_MPS.uproject', '{"EngineAssociation":"4.11"}');
    const info = inspectUnrealProject(tmpDir);
    expect(info).not.toBeNull();
    expect(info?.projectName).toBe('P_MPS');
    expect(info?.engineAssociation).toBe('4.11');
    expect(info?.engineRoot).toBeNull();
    expect(info?.editorExe).toBeNull();
    expect(info?.engineSource).toBe('not-found');
  });

  it('엔진 트리 안 프로젝트는 에디터·빌드 스크립트까지 채워진다', () => {
    const { editor, build } = enginePaths();
    write(editor, '');
    write(build, '');
    write('Projects/P_MPS/P_MPS.uproject', '{"EngineAssociation":""}');
    const info = inspectUnrealProject(path.join(tmpDir, 'Projects', 'P_MPS'));
    expect(info?.engineRoot).toBe(tmpDir);
    expect(info?.engineSource).toBe('in-engine-tree');
    expect(info?.editorExe).toBe(path.join(tmpDir, ...editor.split('/')));
    expect(info?.buildScript).toBe(path.join(tmpDir, ...build.split('/')));
  });

  it('.uproject 가 깨져 있어도 언리얼 프로젝트라는 사실은 잃지 않는다', () => {
    write('P_MPS.uproject', '{ this is not json');
    const info = inspectUnrealProject(tmpDir);
    expect(info?.projectName).toBe('P_MPS');
    expect(info?.engineAssociation).toBe('');
  });
});
