/**
 * §5.5 #17-27 ⑬ (h) — 본문에서 누른 실행 파일이 **어떤 명령으로 도는가**.
 *
 * 이 계산이 틀리면 화면에는 아무 표도 나지 않고 셸만 조용히 실패한다(따옴표가 빠져 공백 든 경로가
 * 두 토막으로 갈리는 것이 그 대표다 — `C:\Program Files\…`). 셸을 띄우지 않고도 고정할 수 있는
 * 부분이라 여기서 세 OS 의 규칙을 한 표로 굳힌다.
 */
import { describe, expect, it } from 'vitest';

import {
  ADHOC_RUN_PREFIX,
  buildExecutableRunCommand,
  buildExecutableRunConfig,
  executableConfigId,
  executableName,
  executableWorkDir,
} from './runExecutableFile.js';

describe('buildExecutableRunCommand', () => {
  it('windows — 큰따옴표로 감싸고 구분자를 역슬래시로 맞춘다', () => {
    expect(buildExecutableRunCommand('C:/Games/P_MPS_GPT/Saved/Windows/P_MPS_GPT.exe')).toBe(
      '"C:\\Games\\P_MPS_GPT\\Saved\\Windows\\P_MPS_GPT.exe"',
    );
  });

  it('windows — 공백이 든 경로가 두 토막으로 갈리지 않는다', () => {
    expect(buildExecutableRunCommand('C:\\Program Files\\My Game\\game.exe')).toBe(
      '"C:\\Program Files\\My Game\\game.exe"',
    );
  });

  it('macOS — .app 번들은 open 이 받는다(폴더를 그대로 실행하는 유일한 창구)', () => {
    expect(buildExecutableRunCommand('/Applications/Game.app')).toBe("open '/Applications/Game.app'");
  });

  it('posix — 작은따옴표로 감싸고, 경로 안의 작은따옴표도 살린다', () => {
    expect(buildExecutableRunCommand('/opt/game/bin/game')).toBe("'/opt/game/bin/game'");
    expect(buildExecutableRunCommand("/opt/it's/game")).toBe("'/opt/it'\\''s/game'");
  });
});

describe('executableWorkDir', () => {
  it('그 파일이 있는 폴더를 잡는다 — 옆에 둔 자원을 상대 경로로 찾기 때문', () => {
    expect(executableWorkDir('C:/g/Saved/Windows/P_MPS_GPT.exe')).toBe('C:\\g\\Saved\\Windows');
    expect(executableWorkDir('/opt/game/bin/game')).toBe('/opt/game/bin');
  });

  it('드라이브 바로 아래면 그 드라이브의 루트다', () => {
    expect(executableWorkDir('C:/game.exe')).toBe('C:\\');
  });

  it('폴더를 가를 수 없으면 null — 호출부가 프로젝트 루트로 떨어진다', () => {
    expect(executableWorkDir('game.exe')).toBeNull();
  });
});

describe('executableConfigId / executableName', () => {
  it('같은 파일은 같은 id — 다시 누르면 새 세션이 아니라 재시작이다', () => {
    const a = executableConfigId('C:\\g\\Game.exe');
    const b = executableConfigId('c:/g/game.exe');
    expect(a).toBe(b);
    expect(a.startsWith(ADHOC_RUN_PREFIX)).toBe(true);
  });

  it('이름은 경로의 마지막 조각', () => {
    expect(executableName('C:\\g\\Saved\\Windows\\P_MPS_GPT.exe')).toBe('P_MPS_GPT.exe');
    expect(executableName('/opt/game/bin/game')).toBe('game');
  });
});

describe('buildExecutableRunConfig', () => {
  it('실행 세션이 받는 모양으로 옮긴다 — 출처는 "우리가 알아본 것"', () => {
    const cfg = buildExecutableRunConfig('C:/g/build/game.exe');
    expect(cfg).toMatchObject({
      command: '"C:\\g\\build\\game.exe"',
      cwd: 'C:\\g\\build',
      kind: 'run',
      name: 'game.exe',
      runtime: 'other',
      source: 'detected',
    });
    // 근거는 화면이 툴팁으로 그대로 보여 준다 — 무엇을 띄웠는지가 경로로 남아야 한다.
    expect(cfg.reason).toBe('C:/g/build/game.exe');
  });
});
