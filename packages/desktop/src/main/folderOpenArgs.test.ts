import { describe, expect, it } from 'vitest';
import {
  FOLDER_MENU_REGISTER_ARG, FOLDER_OPEN_ARG, folderPathsFromArgv, isFolderMenuRegisterRun, normalizeFolderArg,
} from './folderOpenArgs';

// 2026-11-01 실측(Electron 31.7.7 · 셸 동사 ShellExecuteEx): 첫 실행 process.argv 와 떠 있는 쪽이 받은 second-instance argv.
describe('폴더 우클릭 인자 — 탐색기 동사로 띄운 실제 모양', () => {
  const exe = 'D:\\Apps\\Vibisual\\Vibisual.exe';
  const folder = 'D:\\Work\\한글 폴더\\trunk\\Content';

  it('첫 실행 — 명령 그대로', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=${folder}`], 'win32')).toEqual([folder]);
  });

  it('second-instance — 스위치가 앞으로 오고 Chromium 스위치가 끼어도', () => {
    const argv = [exe, `${FOLDER_OPEN_ARG}=${folder}`, '--allow-file-access-from-files'];
    expect(folderPathsFromArgv(argv, 'win32')).toEqual([folder]);
  });
});

describe('설치기의 메뉴 등록 모드', () => {
  it('그 인자가 있을 때만 — 폴더 열기 인자와 섞이지 않는다', () => {
    expect(FOLDER_MENU_REGISTER_ARG).toBe('--vibisual-register-folder-menu');
    expect(isFolderMenuRegisterRun(['C:\\V\\Vibisual.exe', FOLDER_MENU_REGISTER_ARG])).toBe(true);
    expect(isFolderMenuRegisterRun(['C:\\V\\Vibisual.exe'])).toBe(false);
    expect(isFolderMenuRegisterRun(['C:\\V\\Vibisual.exe', `${FOLDER_OPEN_ARG}=C:\\W`])).toBe(false);
    expect(folderPathsFromArgv(['C:\\V\\Vibisual.exe', FOLDER_MENU_REGISTER_ARG], 'win32')).toEqual([]);
  });
});

describe('폴더 우클릭 인자 — Windows', () => {
  const exe = 'C:\\Program Files\\Vibisual\\Vibisual.exe';

  it('= 한 토큰에서 경로를 꺼내고, 스위치 이름 대소문자는 접어 본다', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=C:\\Work\\My App`], 'win32')).toEqual(['C:\\Work\\My App']);
    expect(folderPathsFromArgv([exe, '--VIBISUAL-OPEN-FOLDER=D:\\Proj'], 'win32')).toEqual(['D:\\Proj']);
  });

  it('Chromium 이 끼워 넣은 스위치가 있어도 그대로', () => {
    const argv = [exe, '--allow-file-access-from-files', `${FOLDER_OPEN_ARG}=C:\\Work`, '--original-process-start-time=1'];
    expect(folderPathsFromArgv(argv, 'win32')).toEqual(['C:\\Work']);
  });

  it('드라이브 루트의 %V 가 `C:"` 로 와도 `C:\\` 로 돌린다', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=C:"`], 'win32')).toEqual(['C:\\']);
  });

  it('끝 구분자를 떼고, 상대·드라이브 상대 경로는 버린다', () => {
    expect(normalizeFolderArg('C:\\Work\\', 'win32')).toBe('C:\\Work');
    expect(normalizeFolderArg('C:/Work/sub', 'win32')).toBe('C:\\Work\\sub');
    expect(normalizeFolderArg('Work', 'win32')).toBeNull();
    expect(normalizeFolderArg('C:Work', 'win32')).toBeNull();
    expect(normalizeFolderArg('\\\\server\\share\\proj', 'win32')).toBe('\\\\server\\share\\proj');
  });

  it('플래그가 없으면 위치 인자를 폴더로 읽지 않는다(개발 실행의 앱 경로)', () => {
    expect(folderPathsFromArgv([exe, 'C:\\repo\\packages\\desktop'], 'win32')).toEqual([]);
  });

  it('file 주소도 받는다', () => {
    expect(normalizeFolderArg('file:///C:/My%20Work', 'win32')).toBe('C:\\My Work');
    expect(normalizeFolderArg('file://server/share/a', 'win32')).toBe('\\\\server\\share\\a');
  });
});

describe('폴더 우클릭 인자 — macOS·Linux', () => {
  const exe = '/opt/Vibisual/vibisual';

  it('스크립트의 = 한 토큰 · 대소문자를 지킨다', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=/srv/work/Feature-X`], 'linux')).toEqual(['/srv/work/Feature-X']);
  });

  it('맨 플래그는 위치 인자를 본다 — 스위치가 사이에 끼어도', () => {
    const argv = [exe, FOLDER_OPEN_ARG, '--no-sandbox', '/srv/work/proj dir'];
    expect(folderPathsFromArgv(argv, 'linux')).toEqual(['/srv/work/proj dir']);
  });

  it('Nautilus 의 지금 폴더 주소(file://)를 경로로 · 원격 주소는 버린다', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=file:///srv/work/%ED%95%9C%EA%B8%80`], 'linux')).toEqual(['/srv/work/한글']);
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=smb://nas/share`], 'linux')).toEqual([]);
    expect(normalizeFolderArg('file://nas/share', 'linux')).toBeNull();
  });

  it('같은 폴더가 두 번 와도 하나 · 루트는 그대로', () => {
    expect(folderPathsFromArgv([exe, `${FOLDER_OPEN_ARG}=/a/b/`, `${FOLDER_OPEN_ARG}=/a/b`], 'darwin')).toEqual(['/a/b']);
    expect(normalizeFolderArg('/', 'linux')).toBe('/');
  });
});
