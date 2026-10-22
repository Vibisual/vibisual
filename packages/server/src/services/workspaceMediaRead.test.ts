/**
 * §5.1 #2-1 (A) — 미디어 창구 **읽기** 판정(`resolveWorkspaceMediaRead`) 회귀 시험.
 *
 * 배경(2026-10-21 사용자 보고): 에이전트가 프로젝트 밖(`%TEMP%/vib-icon-probe/out`)에서 읽은 그림 다섯 장이 캔버스에 떠
 * 있는데, 창구가 루트 밖을 통째로 막아 **png 인데 미리보기도 그림 창도 비었다.** 이제 루트 밖이라도 그 파일 자체가 지금
 * 버블로 떠 있으면 읽기를 연다 — 열기 라우트 셋과 같은 두 번째 기준(`hasNodeAbsolutePath`). 여기서 못 박는 계약:
 *  - 루트 안은 종전 그대로 연다.
 *  - 루트 밖은 **버블로 떠 있는 그 파일만** 연다 — 같은 폴더의 다른 파일·홈의 비밀 파일·`..` 로 빠져나가기는 막는다.
 *
 * 실제 `ProjectGraph` 에 Read 훅을 흘려 노드를 세운다(`projectGraphOpenPathGuard.test.ts` 와 같은 자리).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { isWithinRoot } from './pathKey.js';
import {
  resolveWorkspaceMediaRead,
  resolveWorkspaceMediaStream,
  resolveWorkspaceMediaStreamFile,
  setWorkspaceMediaReadGuards,
  type WorkspaceMediaReadGuards,
} from './workspaceMediaRead.js';

let projectRoot: string;
let outsideRoot: string;

beforeEach(() => {
  projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-mediaread-')));
  outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-mediaread-ext-')));
});

afterEach(() => {
  for (const dir of [projectRoot, outsideRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** 그림 파일 하나를 만들고 그 파일에 대한 Read PostToolUse 훅을 흘려보낸다(사진 속 그 읽기). */
function readPicture(graph: ProjectGraph, absFile: string): void {
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  graph.processHookEvent({
    session_id: 'sess-media-read',
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_use_id: `toolu-${path.basename(absFile)}`,
    tool_input: { file_path: absFile },
    cwd: projectRoot,
  });
}

function setup(): { graph: ProjectGraph; read: (root: string, rel: string) => { abs: string; rel: string } | null } {
  const graph = new ProjectGraph();
  graph.registerProject(projectRoot);
  const read = (root: string, rel: string): { abs: string; rel: string } | null => resolveWorkspaceMediaRead(root, rel, {
    isOpenableRoot: (resolvedRoot) => isWithinRoot(resolvedRoot, projectRoot),
    isBubblePath: (absPath) => graph.hasNodeAbsolutePath(absPath),
  });
  return { graph, read };
}

describe('resolveWorkspaceMediaRead — 미디어 창구 읽기', () => {
  it('루트 밖이어도 지금 버블로 떠 있는 그 파일은 연다(사진 속 preview2.png)', () => {
    const { graph, read } = setup();
    const outDir = path.join(outsideRoot, 'vib-icon-probe', 'out');
    const picture = path.join(outDir, 'preview2.png');
    readPicture(graph, picture);
    expect(graph.hasNodeAbsolutePath(picture)).toBe(true);

    const resolved = read(outDir, 'preview2.png');
    expect(resolved).not.toBeNull();
    expect(fs.readFileSync(resolved!.abs)).toEqual(fs.readFileSync(picture));
  });

  it('같은 폴더라도 버블이 아닌 파일 · 홈의 비밀 파일은 막는다', () => {
    const { graph, read } = setup();
    const outDir = path.join(outsideRoot, 'vib-icon-probe', 'out');
    readPicture(graph, path.join(outDir, 'preview2.png'));
    fs.writeFileSync(path.join(outDir, 'secret.png'), 'x');

    expect(read(outDir, 'secret.png')).toBeNull();
    expect(read(path.join(os.homedir(), '.ssh'), 'id_rsa')).toBeNull();
  });

  it('`..` 로 버블 폴더 밖으로 빠져나가지 못한다', () => {
    const { graph, read } = setup();
    const outDir = path.join(outsideRoot, 'vib-icon-probe', 'out');
    const picture = path.join(outDir, 'preview2.png');
    readPicture(graph, picture);

    // 버블 파일을 가리키더라도 루트를 벗어나는 상대 경로는 경로 해석이 막는다.
    expect(read(path.join(outsideRoot, 'vib-icon-probe', 'elsewhere'), '../out/preview2.png')).toBeNull();
  });

  it('루트 안은 종전 그대로 연다(버블이 아니어도)', () => {
    const { read } = setup();
    const inside = path.join(projectRoot, 'assets', 'logo.png');
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, 'x');

    expect(read(projectRoot, 'assets/logo.png')).toEqual({ abs: path.resolve(projectRoot, 'assets/logo.png'), rel: 'assets/logo.png' });
    expect(read(projectRoot, '../escape.png')).toBeNull();
  });
});

/**
 * §5.13 40-1 — 패키지 앱이 이 창구의 읽기를 **흘려 보내는 갈래**(vibproxy)로 받을 때의 판정. 라우트와 같은 한 벌에 하나를 더 본다 —
 * 미디어 표에 있는 형식만(같은 출처의 프리뷰 페이지도 닿는 길이라 코드·설정·키는 내지 않는다).
 */
describe('resolveWorkspaceMediaStream — 흘려 보내는 갈래', () => {
  function guards(graph: ProjectGraph): WorkspaceMediaReadGuards {
    return {
      isOpenableRoot: (resolvedRoot) => isWithinRoot(resolvedRoot, projectRoot),
      isBubblePath: (absPath) => graph.hasNodeAbsolutePath(absPath),
    };
  }
  const query = (root: string, rel: string): URLSearchParams => new URLSearchParams({ root, path: rel });

  it('루트 안 그림 · 버블로 떠 있는 바깥 그림은 낸다(라우트와 같은 판정)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    const inside = path.join(projectRoot, 'assets', 'logo.png');
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, 'x');
    const outDir = path.join(outsideRoot, 'vib-icon-probe', 'out');
    readPicture(graph, path.join(outDir, 'preview2.png'));

    expect(resolveWorkspaceMediaStream(query(projectRoot, 'assets/logo.png'), guards(graph))?.abs).toBe(path.resolve(inside));
    expect(resolveWorkspaceMediaStream(query(outDir, 'preview2.png'), guards(graph))?.abs).toBe(path.join(outDir, 'preview2.png'));
  });

  it('미디어 표 밖(코드 · 설정 · 확장자 없음)은 루트 안이어도 내지 않는다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    for (const name of ['.env', 'src/app.ts', 'config.json', 'id_rsa', 'notes.txt']) {
      const abs = path.join(projectRoot, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'secret');
      expect(resolveWorkspaceMediaStream(query(projectRoot, name), guards(graph)), name).toBeNull();
    }
  });

  it('미디어 표 안의 영상 · 소리 · 3D · PDF 는 낸다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    for (const name of ['out/clip.mp4', 'out/hit.wav', 'out/robot.glb', 'docs/spec.pdf', 'out/icon.svg', 'out/photo.JPG']) {
      const abs = path.join(projectRoot, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
      expect(resolveWorkspaceMediaStream(query(projectRoot, name), guards(graph))?.rel, name).toBe(name);
    }
  });

  it('질의가 비었거나 루트 자체 · 버블이 아닌 바깥 파일은 내지 않는다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    const outDir = path.join(outsideRoot, 'vib-icon-probe', 'out');
    readPicture(graph, path.join(outDir, 'preview2.png'));
    fs.writeFileSync(path.join(outDir, 'other.png'), 'x');

    expect(resolveWorkspaceMediaStream(new URLSearchParams({ root: projectRoot }), guards(graph))).toBeNull();
    expect(resolveWorkspaceMediaStream(new URLSearchParams({ path: 'a.png' }), guards(graph))).toBeNull();
    expect(resolveWorkspaceMediaStream(query(outDir, 'other.png'), guards(graph))).toBeNull();
    expect(resolveWorkspaceMediaStream(query(projectRoot, '../escape.png'), guards(graph))).toBeNull();
  });

  it('서버가 판정을 걸기 전·내린 뒤에는 아무것도 내지 않는다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    const inside = path.join(projectRoot, 'a.png');
    fs.writeFileSync(inside, 'x');
    try {
      setWorkspaceMediaReadGuards(null);
      expect(resolveWorkspaceMediaStreamFile(query(projectRoot, 'a.png'))).toBeNull();
      setWorkspaceMediaReadGuards(guards(graph));
      expect(resolveWorkspaceMediaStreamFile(query(projectRoot, 'a.png'))).toBe(path.resolve(inside));
    } finally {
      setWorkspaceMediaReadGuards(null);
    }
  });
});
