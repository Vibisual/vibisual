import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';

vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §9 폴더 스코프 — **좁혀도 흔들리면 안 되는 것들**.
 *
 * 이 두 값은 "상대 척도" 라 입력이 줄면 화면이 통째로 달라진다.
 *  · `fileSizeRange` — 파일 버블의 크기가 서로 대비되는 기준
 *  · `readCountMaxByProject` — §5.24 히트맵의 색이 서로 대비되는 기준
 *
 * 종전에는 클라가 **받은 스냅샷에서** 쟀다. 폴더 범위를 좁히는 순간 그 입력이 줄어들어,
 * 폴더에 들어갔다 나올 때마다 버블 크기와 히트맵 색이 바뀐다 — 성능을 얻고 화면을 잃는
 * 종류의 손상이라, 프로젝트 축이 탭 목록·전역 집계에 세운 규칙(④)을 그대로 물려받는다:
 * **범위와 무관하게 서버가 전량으로 재서 실어 준다.**
 */

const tmpDirs: string[] = [];
const SESSION = 'sess-scale';

function setup(): { manager: ProjectGraphManager; name: string; root: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-scale-')));
  tmpDirs.push(root);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(root).name;
  return { manager, name, root };
}

/** 크기가 서로 다른 파일 둘을 서로 다른 깊이에 만든다(하나는 깊어서 쉽게 범위 밖이 된다). */
function seedFiles(manager: ProjectGraphManager, root: string): void {
  const shallow = path.join(root, 'top.txt');
  const deep = path.join(root, 'src', 'core', 'deep', 'huge.txt');
  fs.mkdirSync(path.dirname(deep), { recursive: true });
  fs.writeFileSync(shallow, 'a'.repeat(100), 'utf8');
  fs.writeFileSync(deep, 'b'.repeat(50_000), 'utf8');
  for (const [i, abs] of [shallow, deep].entries()) {
    manager.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: `u-${i}`,
      tool_input: { file_path: abs },
      cwd: root,
    });
  }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('§9 폴더 스코프 — 전역 상대 척도', () => {
  it('파일 크기 척도는 범위를 어떻게 좁혀도 같다', () => {
    const { manager, name, root } = setup();
    seedFiles(manager, root);

    manager.setClientProjectScope({}, [name], []);            // 메인 뷰(가장 좁다)
    const narrow = manager.getBroadcastSnapshot().fileSizeRange;
    manager.setClientProjectScope({}, [name]);                // 폴더 축 미선언(= 전량)
    const full = manager.getBroadcastSnapshot().fileSizeRange;

    expect(narrow).toBeDefined();
    expect(narrow).toEqual(full);
    // 좁힌 스냅샷에는 그 깊은 파일이 실려 있지 않은데도 척도에는 들어 있다(= 서버가 전량으로 쟀다).
    expect((narrow?.max ?? 0)).toBeGreaterThan(narrow?.min ?? 0);
  });

  it('히트맵 척도도 범위와 무관하게 같다', () => {
    const { manager, name, root } = setup();
    seedFiles(manager, root);

    manager.setClientProjectScope({}, [name], []);
    const narrow = manager.getBroadcastSnapshot().readCountMaxByProject;
    manager.setClientProjectScope({}, [name]);
    const full = manager.getBroadcastSnapshot().readCountMaxByProject;

    expect(narrow).toBeDefined();
    expect(narrow).toEqual(full);
    expect(narrow?.[name] ?? 0).toBeGreaterThan(0);
  });

  it('두 값은 내부 조회용 스냅샷에도 그대로 실린다(같은 산식 한 벌)', () => {
    const { manager, root } = setup();
    seedFiles(manager, root);

    const internal = manager.getSnapshot();
    expect(internal.fileSizeRange).toBeDefined();
    expect(internal.readCountMaxByProject).toBeDefined();
  });
});
