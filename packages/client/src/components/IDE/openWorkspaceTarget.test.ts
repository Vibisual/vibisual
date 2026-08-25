/**
 * §5.13 (R-1) — **어떤 파일이 어디로 가는가**.
 *
 * 이 표가 틀리면 사용자는 눌렀는데 엉뚱한 창이 뜬다(zip 을 편집창에 띄우거나, 영상을 바깥 앱으로
 * 던지거나). 화면 없이 고정할 수 있는 판정이므로 여기서 못 박는다 — 특히 **앱이 선언한 확장자가
 * 코어 표가 아니라 앱에서 온다**는 규약이 살아 있는지를 함께 본다.
 */
import { describe, expect, it } from 'vitest';

import { planWorkspaceOpen } from './openWorkspaceTarget.js';

describe('planWorkspaceOpen — 내부 앱이 받는 것', () => {
  it('영상은 Vibistudio 로 간다', () => {
    expect(planWorkspaceOpen({ relPath: 'out/clip.mp4', kind: 'file' })).toEqual({ action: 'app', appId: 'vibistudio' });
    expect(planWorkspaceOpen({ relPath: 'a/b/Scene.WEBM', kind: 'file' })).toEqual({ action: 'app', appId: 'vibistudio' });
  });

  it('[실측] mkv 도 그냥 열린다 — 동봉 ffmpeg 에 Matroska 데먹서가 있다((R-8) (b))', () => {
    expect(planWorkspaceOpen({ relPath: 'raw/take.mkv', kind: 'file' })).toEqual({ action: 'app', appId: 'vibistudio' });
    expect(planWorkspaceOpen({ relPath: 'phone/clip.3gp', kind: 'file' })).toEqual({ action: 'app', appId: 'vibistudio' });
  });

  it('소리는 Vibisound 로 간다', () => {
    expect(planWorkspaceOpen({ relPath: 'bgm.mp3', kind: 'file' })).toEqual({ action: 'app', appId: 'vibisound' });
    expect(planWorkspaceOpen({ relPath: 'sfx/hit.wav', kind: 'file' })).toEqual({ action: 'app', appId: 'vibisound' });
  });

  it('3D 는 Vibi3D 로 간다', () => {
    expect(planWorkspaceOpen({ relPath: 'models/robot.glb', kind: 'file' })).toEqual({ action: 'app', appId: 'vibi3d' });
    expect(planWorkspaceOpen({ relPath: 'models/part.stl', kind: 'file' })).toEqual({ action: 'app', appId: 'vibi3d' });
  });
});

describe('planWorkspaceOpen — 우리가 다루지 않는 것', () => {
  it('압축·폰트·오피스 문서는 연결 프로그램', () => {
    expect(planWorkspaceOpen({ relPath: 'dist/app.zip', kind: 'file' }).action).toBe('external');
    expect(planWorkspaceOpen({ relPath: 'assets/Pretendard.ttf', kind: 'file' }).action).toBe('external');
    expect(planWorkspaceOpen({ relPath: '계획.xlsx', kind: 'file' }).action).toBe('external');
    expect(planWorkspaceOpen({ relPath: 'doc/보고서.hwp', kind: 'file' }).action).toBe('external');
  });

  it('악보(mid)는 변환해도 소리가 안 되므로 연결 프로그램 — 신시사이저가 필요한 일이다', () => {
    expect(planWorkspaceOpen({ relPath: 'bgm/theme.mid', kind: 'file' }).action).toBe('external');
    expect(planWorkspaceOpen({ relPath: 'bgm/theme.midi', kind: 'file' }).action).toBe('external');
  });

  it('[회귀] .ts 는 TypeScript 다 — 영상 컨테이너로 읽어 바깥으로 던지지 않는다', () => {
    expect(planWorkspaceOpen({ relPath: 'src/App.ts', kind: 'file' }).action).toBe('editor');
    expect(planWorkspaceOpen({ relPath: 'src/App.tsx', kind: 'file' }).action).toBe('editor');
  });
});

describe('planWorkspaceOpen — 변환하면 우리 안에서 보는 것((R-8))', () => {
  it('데먹서가 없는 영상은 변환 갈래로 — 바깥으로 내보내지 않는다', () => {
    expect(planWorkspaceOpen({ relPath: 'raw/take1.avi', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'video' });
    expect(planWorkspaceOpen({ relPath: 'old/clip.wmv', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'video' });
    expect(planWorkspaceOpen({ relPath: 'cam/rec.MPG', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'video' });
  });

  it('데먹서가 없는 소리도 변환 갈래 — WAV 로 바꿔 음악 편집기가 받는다', () => {
    expect(planWorkspaceOpen({ relPath: 'voice.wma', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'audio' });
    expect(planWorkspaceOpen({ relPath: 'take.aiff', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'audio' });
    expect(planWorkspaceOpen({ relPath: 'song.ape', kind: 'file' })).toEqual({ action: 'convert', convertTo: 'audio' });
  });

  it('[회귀] .ts 는 여전히 TypeScript — 변환 갈래로도 새지 않는다', () => {
    expect(planWorkspaceOpen({ relPath: 'src/api.ts', kind: 'file' }).action).toBe('editor');
  });
});

describe('planWorkspaceOpen — 우리 안에서 보는 것', () => {
  it('그림은 내장 미리보기, PDF 는 내장 뷰어', () => {
    expect(planWorkspaceOpen({ relPath: 'shot.png', kind: 'file' }).action).toBe('image');
    expect(planWorkspaceOpen({ relPath: '설명서.pdf', kind: 'file' }).action).toBe('pdf');
  });

  it('svg 는 그림이 아니라 편집창 — 텍스트라서 고칠 수 있는 편이 쓸모 있다', () => {
    expect(planWorkspaceOpen({ relPath: 'icon.svg', kind: 'file' }).action).toBe('editor');
  });

  it('모르는 확장자는 편집창 — 바깥으로 던지지 않는다', () => {
    expect(planWorkspaceOpen({ relPath: 'notes.qqq', kind: 'file' }).action).toBe('editor');
    expect(planWorkspaceOpen({ relPath: 'Makefile', kind: 'file' }).action).toBe('editor');
  });
});

describe('planWorkspaceOpen — 폴더와 실행', () => {
  it('폴더는 탐색기', () => {
    expect(planWorkspaceOpen({ relPath: 'assets', kind: 'directory' }).action).toBe('folder');
  });

  it('실행할 수 있으면 확장자보다 실행이 먼저 — macOS .app 은 폴더이면서 실행이다', () => {
    expect(planWorkspaceOpen({ relPath: 'Saved/Windows/Game.exe', kind: 'file', executable: true }).action).toBe('run');
    expect(planWorkspaceOpen({ relPath: 'Build/Mac/Game.app', kind: 'directory', executable: true }).action).toBe('run');
  });
});
