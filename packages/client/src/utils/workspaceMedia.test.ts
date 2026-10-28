/**
 * §5.1 #2-1 (A) — 바이트 창구 도우미가 **절대경로**(프로젝트 밖, 지금 버블로 떠 있는 파일)를 그 파일의 폴더 + 이름으로 풀어 보내는지 고정한다.
 * 서버는 루트 기준으로만 풀어(앞 `/` 를 떼고 루트 아래 붙인다) 절대경로를 그대로 실으면 Windows 는 403, POSIX 는 루트 안의 다른 파일을 가리킨다. 세 OS 모양을 한 기계에서 잰다.
 */
import { describe, it, expect } from 'vitest';

import { isAbsoluteMediaPath, workspaceMediaQuery, workspaceMediaStreamUrl, workspaceMediaUrl } from './workspaceMedia.js';

describe('isAbsoluteMediaPath — 절대경로 모양 셋', () => {
  it('Windows 드라이브 · UNC · POSIX 루트는 절대경로다', () => {
    expect(isAbsoluteMediaPath('C:/Users/a/out/preview2.png')).toBe(true); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(isAbsoluteMediaPath('c:\\users\\a\\out\\preview2.png')).toBe(true); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(isAbsoluteMediaPath('\\\\server\\share\\a.png')).toBe(true);
    expect(isAbsoluteMediaPath('//server/share/a.png')).toBe(true);
    expect(isAbsoluteMediaPath('/tmp/probe/out/a.png')).toBe(true);
  });

  it('루트 기준 상대 경로는 아니다', () => {
    expect(isAbsoluteMediaPath('assets/logo.png')).toBe(false);
    expect(isAbsoluteMediaPath('a.png')).toBe(false);
    expect(isAbsoluteMediaPath('C:')).toBe(false);
  });
});

describe('workspaceMediaQuery — 서버에 실을 루트·경로', () => {
  it('상대 경로는 그대로다(프로젝트 안 — 종전 그대로)', () => {
    expect(workspaceMediaQuery('C:/proj', 'out/a.png')).toEqual({ root: 'C:/proj', path: 'out/a.png' });
  });

  it('절대경로는 그 파일의 폴더 + 이름이다(주인 루트는 쓰지 않는다)', () => {
    expect(workspaceMediaQuery('C:/proj', 'c:/users/dev/appdata/local/temp/icon-probe/out/preview2.png')).toEqual({ // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      root: 'c:/users/dev/appdata/local/temp/icon-probe/out', // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      path: 'preview2.png',
    });
    expect(workspaceMediaQuery('/home/u/proj', '/tmp/probe/out/a.png')).toEqual({ root: '/tmp/probe/out', path: 'a.png' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(workspaceMediaQuery('C:/proj', 'D:\\Shots\\Raw\\A.PNG')).toEqual({ root: 'D:/Shots/Raw', path: 'A.PNG' });
    expect(workspaceMediaQuery('C:/proj', '//server/share/x/a.png')).toEqual({ root: '//server/share/x', path: 'a.png' });
  });

  it('드라이브 루트·POSIX 루트 바로 아래 파일은 루트의 구분자를 남긴다', () => {
    expect(workspaceMediaQuery('C:/proj', 'D:/a.png')).toEqual({ root: 'D:/', path: 'a.png' });
    expect(workspaceMediaQuery('/home/u/proj', '/a.png')).toEqual({ root: '/', path: 'a.png' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });
});

describe('workspaceMediaUrl — 조립', () => {
  it('절대경로는 풀린 루트·이름으로 실린다', () => {
    const url = new URL(workspaceMediaUrl('C:/proj', '/tmp/probe/out/a.png'), 'http://x');
    expect(url.pathname).toBe('/api/workspace-media');
    expect(url.searchParams.get('root')).toBe('/tmp/probe/out');
    expect(url.searchParams.get('path')).toBe('a.png');
  });

  it('상대 경로는 종전 주소 그대로다', () => {
    expect(workspaceMediaUrl('C:/proj', 'out/a b.png')).toBe('/api/workspace-media?root=C%3A%2Fproj&path=out%2Fa%20b.png');
  });
});

/**
 * §5.13 40-1 — 읽기 바이트는 패키지 앱에서 흘려 받는 주소(vibproxy 미디어 갈래)로 받는다. 상대 주소는 패치된 fetch(IPC)를 타는데,
 * IPC 는 응답 전체를 메인에 모았다가 한 번에 넘긴다.
 */
describe('workspaceMediaStreamUrl — 흘려 받는 읽기 주소', () => {
  it('패키지 앱의 미디어 파일은 vibproxy 미디어 갈래다(같은 질의)', () => {
    const plain = workspaceMediaUrl('C:/proj', 'out/photo.png');
    expect(workspaceMediaStreamUrl('C:/proj', 'out/photo.png', true)).toBe(`vibproxy://proxy${plain}`);
    // 프로젝트 밖 그림(절대경로)도 같은 질의 그대로 — 판정은 서버 라우트와 같은 한 벌이다.
    const outside = 'c:/users/dev/appdata/local/temp/icon-probe/out/preview2.png'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(workspaceMediaStreamUrl('C:/proj', outside, true)).toBe(`vibproxy://proxy${workspaceMediaUrl('C:/proj', outside)}`);
    for (const rel of ['clip.mp4', 'hit.wav', 'robot.glb', 'spec.pdf', 'icon.SVG', 'photo.JPG']) {
      expect(workspaceMediaStreamUrl('/home/u/proj', rel, true).startsWith('vibproxy://proxy/api/workspace-media?'), rel).toBe(true); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    }
  });

  it('미디어 표 밖은 패키지 앱이어도 종전 주소다(그 갈래는 내지 않는다)', () => {
    for (const rel of ['.env', 'src/app.ts', 'config.json', 'mesh.bin', 'README']) {
      expect(workspaceMediaStreamUrl('C:/proj', rel, true), rel).toBe(workspaceMediaUrl('C:/proj', rel));
    }
  });

  it('웹·모바일(패키지 앱이 아님)은 상대 주소 그대로다', () => {
    expect(workspaceMediaStreamUrl('C:/proj', 'out/photo.png', false)).toBe(workspaceMediaUrl('C:/proj', 'out/photo.png'));
    // 노드 시험 판은 창이 없어 패키지 앱이 아니다(기본값).
    expect(workspaceMediaStreamUrl('C:/proj', 'out/photo.png')).toBe(workspaceMediaUrl('C:/proj', 'out/photo.png'));
  });
});
