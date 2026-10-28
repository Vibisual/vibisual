/**
 * §5.1 #2-1 (A) — 미디어 창구 읽기(`resolveWorkspaceMediaRead`) 회귀: 루트 밖은 버블로 떠 있는 그 파일만 연다(같은 폴더 다른 파일·`..` 탈출은 막음).
 * 실제 `ProjectGraph` 에 Read 훅을 흘려 노드를 세운다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { isWithinRoot } from './pathKey.js';
import {
  resolveWorkspaceFileRead,
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

/** §5.5 #17-27 ⑥ — 편집창 읽기: 파일 버블 더블클릭이 앱 안 편집창으로 열리므로 루트 밖도 버블로 떠 있는 그 파일만 보기 전용(`outside`)으로 읽힌다. */
describe('resolveWorkspaceFileRead — 편집창 읽기', () => {
  function guards(graph: ProjectGraph): WorkspaceMediaReadGuards {
    return {
      isOpenableRoot: (resolvedRoot) => isWithinRoot(resolvedRoot, projectRoot),
      isBubblePath: (absPath) => graph.hasNodeAbsolutePath(absPath),
    };
  }
  /** 글 파일 하나를 만들고 그 파일에 대한 Read 훅을 흘린다(에이전트가 프로젝트 밖 문서를 읽은 자리). */
  function readText(graph: ProjectGraph, absFile: string): void {
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, '# notes\n');
    graph.processHookEvent({
      session_id: 'sess-file-read',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: `toolu-${path.basename(absFile)}`,
      tool_input: { file_path: absFile },
      cwd: projectRoot,
    });
  }

  it('루트 안은 종전 그대로 — 바깥이 아니다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    expect(resolveWorkspaceFileRead(projectRoot, 'src/app.ts', guards(graph))).toEqual({ outside: false });
    expect(resolveWorkspaceFileRead(path.join(projectRoot, 'src'), 'app.ts', guards(graph))).toEqual({ outside: false });
  });

  it('루트 밖은 버블로 떠 있는 그 파일만 보기 전용으로 연다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(projectRoot);
    const dir = path.join(outsideRoot, 'notes');
    readText(graph, path.join(dir, 'plan.md'));
    fs.writeFileSync(path.join(dir, 'secret.md'), 'x');

    expect(resolveWorkspaceFileRead(dir, 'plan.md', guards(graph))).toEqual({ outside: true });
    expect(resolveWorkspaceFileRead(dir, 'secret.md', guards(graph))).toBeNull();
    expect(resolveWorkspaceFileRead(path.join(os.homedir(), '.ssh'), 'id_rsa', guards(graph))).toBeNull();
    // 버블 폴더 밖으로 빠져나가는 상대 경로·폴더 자체는 경로 해석이 막는다.
    expect(resolveWorkspaceFileRead(path.join(outsideRoot, 'elsewhere'), '../notes/plan.md', guards(graph))).toBeNull();
    expect(resolveWorkspaceFileRead(dir, '.', guards(graph))).toBeNull();
  });
});

/** §5.13 40-1 — vibproxy 흘려 보내기 갈래 판정: 라우트와 같은 한 벌 + 미디어 표 형식만(같은 출처 프리뷰도 닿아 코드·설정·키는 내지 않는다). */
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
