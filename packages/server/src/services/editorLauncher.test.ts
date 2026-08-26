import { describe, it, expect } from 'vitest';

import { knownEditorPaths } from './editorLauncher.js';

/**
 * "VS Code 로 열기"가 macOS 에서 **TextEdit** 로 떨어지던 사고의 회귀 테스트.
 *
 * 두 사정이 겹쳤다: ① macOS 의 `code` 는 `.app` 번들 **안**에 있고 사용자가
 * "Shell Command: Install 'code' command in PATH" 를 눌러야 PATH 에 심볼릭이 생긴다.
 * ② Finder 로 띄운 우리 앱의 PATH 는 launchd 최소값이라 눌렀더라도 `/usr/local/bin` 이 안 보인다.
 * 그래서 `which code` 가 실패 → `openFile` 폴백 `open -t` → TextEdit.
 */

/** 테스트용 가짜 홈 — 실제 사용자 경로가 아니라 픽스처다. */
const MAC_HOME = '/Users/t';
const NIX_HOME = '/home/t';
const WIN_HOME = 'C:\\Users\\t'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처

describe('knownEditorPaths — mac', () => {
  it('VS Code 는 .app 번들 안 CLI 런처를 본다', () => {
    const paths = knownEditorPaths('code', 'darwin', MAC_HOME);
    expect(paths).toContain('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
    // 관리자 권한 없이 개인 Applications 에 깐 경우도 본다.
    expect(paths).toContain(`${MAC_HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`);
  });

  it('Cursor 도 같은 규약', () => {
    expect(knownEditorPaths('cursor', 'darwin', MAC_HOME)).toContain(
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    );
  });

  it('Zed 는 Contents/MacOS/cli 다(`zed` 라는 이름의 파일이 아니다)', () => {
    expect(knownEditorPaths('zed', 'darwin', MAC_HOME)).toContain('/Applications/Zed.app/Contents/MacOS/cli');
  });

  it('Sublime Text 는 SharedSupport/bin/subl', () => {
    expect(knownEditorPaths('subl', 'darwin', MAC_HOME)).toContain(
      '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
    );
  });

  it('JetBrains 는 Toolbox 스크립트 폴더를 먼저 본다', () => {
    const paths = knownEditorPaths('webstorm', 'darwin', MAC_HOME);
    expect(paths[0]).toContain('JetBrains');
    expect(paths[0]).toContain('Toolbox');
  });

  it('표에 없는 에디터는 빈 배열(추측 경로를 지어내지 않는다)', () => {
    expect(knownEditorPaths('emacs', 'darwin', MAC_HOME)).toEqual([]);
  });
});

describe('knownEditorPaths — linux', () => {
  it('snap 과 배포판 패키지 자리를 본다', () => {
    const paths = knownEditorPaths('code', 'linux', NIX_HOME);
    expect(paths).toContain('/snap/bin/code');
    expect(paths).toContain('/usr/share/code/bin/code');
  });

  it('JetBrains Toolbox 스크립트는 ~/.local/share 아래', () => {
    expect(knownEditorPaths('idea', 'linux', NIX_HOME)[0]).toContain(`${NIX_HOME}/.local/share/JetBrains/Toolbox/scripts/idea`);
  });
});

describe('knownEditorPaths — windows', () => {
  it('Windows 는 resolveWinFullPath 가 따로 보므로 추가 후보가 없다', () => {
    expect(knownEditorPaths('code', 'win32', WIN_HOME)).toEqual([]);
  });
});
