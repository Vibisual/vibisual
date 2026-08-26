/**
 * 경로 대소문자 정책이 **실제 경계**(두뇌 활성화·플러그인 활성 목록·플러그인 배치·그래프 노드 키)에서
 * 지켜지는가. 정책 자체(`shared/pathCase.ts`)의 단위 테스트는 `src/pathCase.test.ts` 에 있고,
 * 여기서는 그 정책을 쓰는 쪽이 옛 습관(무조건 `.toLowerCase()`)으로 되돌아가지 못하게 고정한다.
 *
 * 배경: 이 앱은 오랫동안 경로를 플랫폼과 무관하게 소문자로 접어 Map 키·비교 키로 썼다.
 * Windows(NTFS)·mac(기본 APFS)은 파일시스템이 대소문자를 안 가려 옳았지만, **Linux 는
 * `Feature-X` 와 `feature-x` 가 실재하는 서로 다른 디렉터리**다. 워크트리 생성은 이름 케이스를
 * 보존하고 중복 판정을 `fs.existsSync` 로 하므로 Linux 에서는 두 워크트리가 진짜로 따로 생기는데,
 * `projects`/`nodes` Map 에서는 같은 키로 접혀 한쪽 등록이 다른 쪽을 **에러 한 줄 없이** 덮어썼다.
 * 두뇌 카드·플러그인 활성 목록도 같은 방식으로 남의 프로젝트 것이 실렸다.
 *
 * 고정하는 계약 셋:
 *   ① Linux 에서 케이스만 다른 두 경로는 **다른 칸**이다.
 *   ② Windows·mac 에서는 **같은 칸**이다.
 *   ③ 예전 소문자 키로 저장된 데이터는 Linux 에서도 **여전히 읽힌다**(업그레이드 손실 방지).
 *      단 폴백은 **이미 소문자인 칸**만 본다 — 아니면 ①이 그대로 무너진다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCaseInsensitiveFs,
  legacyLowerPathKey,
  pathKey,
  isBrainEnabled,
  resolveBrainActivation,
  resolveBrainProjectKey,
  normalizePluginPath,
  resolvePluginPlacement,
  type BrainActivation,
} from '@vibisual/shared';
import {
  resolveEnabledPluginsFor,
  resolveProjectKey,
  selectProjectEnabledList,
  type PluginEnablementSource,
} from '@vibisual/plugins';
import { CASE_INSENSITIVE_FS, pathKey as serverPathKey, readByPath, samePath as serverSamePath } from './pathKey.js';
import { ProjectGraph } from './projectGraph.js';

const UPPER = '/repos/app/Feature-X';
const LOWER = '/repos/app/feature-x';

// ─── 서버 래퍼 ───────────────────────────────────────────────────────────────

describe('services/pathKey — 서버는 이 프로세스의 플랫폼 정책을 그대로 물려받는다', () => {
  it('CASE_INSENSITIVE_FS 는 shared 판정과 같다', () => {
    expect(CASE_INSENSITIVE_FS).toBe(isCaseInsensitiveFs(process.platform));
    expect(serverPathKey(UPPER)).toBe(pathKey(UPPER, process.platform));
    expect(serverSamePath(UPPER, LOWER)).toBe(CASE_INSENSITIVE_FS);
  });

  it('readByPath — 새 키로 못 찾으면 예전 소문자 키로 한 번 더 찾는다', () => {
    const store: Record<string, number> = { [legacyLowerPathKey(UPPER)]: 1 };
    // win/mac 은 새 키가 곧 예전 키라 폴백 없이도, linux 는 폴백으로 찾아야 한다.
    expect(readByPath(store, UPPER)).toBe(1);
    if (!CASE_INSENSITIVE_FS) {
      // 정확 일치가 있으면 그쪽이 이긴다(두 칸이 실제로 공존하는 건 대소문자 구분 FS 뿐이다).
      const both: Record<string, number> = { [serverPathKey(UPPER)]: 2, [legacyLowerPathKey(UPPER)]: 1 };
      expect(readByPath(both, UPPER)).toBe(2);
    }
  });
});

// ─── 두뇌 활성화(§5.10) ──────────────────────────────────────────────────────

describe('두뇌 활성화 맵 — 프로젝트 경계가 플랫폼 규칙을 따른다', () => {
  const on: BrainActivation = { enabled: true };

  it('linux 는 케이스만 다른 프로젝트의 두뇌 설정을 가져오지 않는다', () => {
    const byProject: Record<string, BrainActivation> = { [UPPER]: on };
    expect(isBrainEnabled(byProject, UPPER, 'linux')).toBe(true);
    expect(isBrainEnabled(byProject, LOWER, 'linux')).toBe(false);
  });

  it('win32·darwin 은 같은 폴더로 보고 그대로 가져온다', () => {
    const byProject: Record<string, BrainActivation> = { [UPPER]: on };
    for (const platform of ['win32', 'darwin'] as const) {
      expect(isBrainEnabled(byProject, LOWER, platform)).toBe(true);
    }
  });

  it('플랫폼 인자를 생략하면 예전대로 접는다(기존 호출부 회귀 없음)', () => {
    expect(isBrainEnabled({ [UPPER]: on }, LOWER)).toBe(true);
  });

  it('하위호환 — 예전 소문자 키로 저장된 설정을 linux 에서도 읽어낸다', () => {
    // 업그레이드 직전 디스크 상태: 실제 폴더는 `Feature-X` 인데 키는 소문자로 적혀 있다.
    const legacy: Record<string, BrainActivation> = { [legacyLowerPathKey(UPPER)]: on };
    expect(resolveBrainActivation(legacy, UPPER, 'linux')).toEqual(on);
    expect(isBrainEnabled(legacy, UPPER, 'linux')).toBe(true);
    // 저장 키도 예전 칸을 재사용한다 — 아니면 새 칸이 생겨 기존 설정이 통째로 밀린다.
    expect(resolveBrainProjectKey(legacy, UPPER, 'linux')).toBe(legacyLowerPathKey(UPPER));
  });

  it('정확 일치가 폴백보다 우선한다(두 칸이 공존해도 자기 것을 본다)', () => {
    const both: Record<string, BrainActivation> = {
      [UPPER]: { enabled: true },
      [LOWER]: { enabled: false },
    };
    expect(isBrainEnabled(both, UPPER, 'linux')).toBe(true);
    expect(isBrainEnabled(both, LOWER, 'linux')).toBe(false);
  });

  it('폴백은 **이미 소문자인 칸**만 본다 — 대소문자 섞인 남의 칸을 집어 들지 않는다', () => {
    // 이 가드가 없으면 `feature-x` 조회가 `Feature-X` 칸을 집어 들어 원래 결함이 그대로 되살아난다.
    const byProject: Record<string, BrainActivation> = { [UPPER]: on };
    expect(resolveBrainActivation(byProject, LOWER, 'linux')).toBeUndefined();
    expect(resolveBrainProjectKey(byProject, LOWER, 'linux')).toBe(LOWER);
  });
});

// ─── 플러그인 활성 목록(§5.11) ───────────────────────────────────────────────

describe('플러그인 활성 목록 — 프로젝트 경계가 플랫폼 규칙을 따른다', () => {
  const source: PluginEnablementSource = { enabledPluginsByProject: { [UPPER]: ['lethal-trifecta'] } };

  it('linux 는 케이스만 다른 프로젝트의 활성 목록을 가져오지 않는다', () => {
    expect(selectProjectEnabledList(source, UPPER, 'linux')).toEqual(['lethal-trifecta']);
    // 다른 폴더다 — 프로젝트별 칸이 없으니 구 전역 시드(여기서는 undefined)로 떨어진다.
    // 폴백이 `Feature-X`(대소문자 섞인 새 방식 칸)를 집어 들면 이 기대가 깨진다.
    expect(selectProjectEnabledList(source, LOWER, 'linux')).toBeUndefined();
    expect(resolveProjectKey(source, LOWER, 'linux')).toBe(LOWER);
  });

  it('win32·darwin 은 같은 폴더로 보고 그대로 가져온다', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(selectProjectEnabledList(source, LOWER, platform)).toEqual(['lethal-trifecta']);
    }
  });

  it('플랫폼 인자를 생략하면 예전대로 접는다(기존 호출부 회귀 없음)', () => {
    expect(selectProjectEnabledList(source, LOWER)).toEqual(['lethal-trifecta']);
  });

  it('하위호환 — 예전 소문자 키로 저장된 목록을 linux 에서도 읽어낸다', () => {
    const legacy: PluginEnablementSource = {
      enabledPluginsByProject: { [legacyLowerPathKey(UPPER)]: ['lethal-trifecta'] },
    };
    expect(selectProjectEnabledList(legacy, UPPER, 'linux')).toEqual(['lethal-trifecta']);
    expect(resolveEnabledPluginsFor(legacy, UPPER, 'linux').has('lethal-trifecta')).toBe(true);
    expect(resolveProjectKey(legacy, UPPER, 'linux')).toBe(legacyLowerPathKey(UPPER));
  });

  it('한 번도 저장된 적 없는 프로젝트는 예전대로 자기 경로가 저장 키다', () => {
    expect(resolveProjectKey({ enabledPluginsByProject: {} }, UPPER, 'linux')).toBe(UPPER);
  });
});

// ─── Claude 플러그인 배치 판정(§5.5 #17-33) ──────────────────────────────────

describe('claude 플러그인 배치 — 남의 프로젝트 것이 이 프로젝트 것으로 읽히지 않는다', () => {
  it('linux 는 케이스만 다른 경로를 남의 프로젝트로 본다', () => {
    expect(normalizePluginPath(UPPER, 'linux')).not.toBe(normalizePluginPath(LOWER, 'linux'));
    expect(resolvePluginPlacement('project', LOWER, UPPER, 'linux')).toBe('other-project');
  });

  it('win32·darwin 은 같은 프로젝트로 본다', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(resolvePluginPlacement('project', LOWER, UPPER, platform)).toBe('this-project');
    }
  });

  it('플랫폼 인자를 생략하면 예전대로 접는다', () => {
    expect(resolvePluginPlacement('project', LOWER, UPPER)).toBe('this-project');
    expect(normalizePluginPath('c:\\work\\Proj\\')).toBe(normalizePluginPath('C:/work/Proj'));
  });
});

// ─── ProjectGraph — 실제 그래프 키가 정책을 따르는가 ─────────────────────────

describe('ProjectGraph 노드/프로젝트 키 — 이 플랫폼의 파일시스템 규칙을 따른다', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-pathcase-')));
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function editFile(graph: ProjectGraph, relPath: string): void {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x\n', 'utf8');
    graph.processHookEvent({
      session_id: 'sess-pathcase',
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: `toolu-${relPath}`,
      tool_input: { file_path: abs, old_string: 'a', new_string: 'x' },
      cwd: tmpRoot,
    });
  }

  it('케이스만 다른 두 파일은 대소문자를 가리는 FS 에서 별개 노드가 된다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    editFile(graph, 'Feature.ts');
    editFile(graph, 'feature.ts');

    const keys = Object.keys(graph.toProjectCheckpoint(project.name).graph.nodes)
      .filter((k) => k.toLowerCase().endsWith('feature.ts'));

    // win32/darwin: 파일시스템이 같은 파일로 보므로 노드도 하나. linux: 실재하는 두 파일 → 두 노드.
    expect(keys.length).toBe(CASE_INSENSITIVE_FS ? 1 : 2);
    if (!CASE_INSENSITIVE_FS) {
      expect(keys.some((k) => k.endsWith('Feature.ts'))).toBe(true);
    }
  });

  it('하위호환 — 예전 소문자 키로 저장된 체크포인트의 프로젝트를 복원 후에도 찾아낸다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(project.name))) as ReturnType<
      ProjectGraph['toProjectCheckpoint']
    >;

    // 업그레이드 직전 디스크 판본을 재현한다 — `graph.projects` 키가 무조건 소문자.
    cp.graph.projects = Object.fromEntries(
      Object.entries(cp.graph.projects).map(([, v]) => [legacyLowerPathKey(v.path), v]),
    );

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);

    // 조회는 항상 `normalize(path)`(= 이 플랫폼의 pathKey)로 들어온다. 저장 키를 그대로 실었다면
    // linux 에서 여기가 null 이 되어 프로젝트가 미등록으로 보이고 탭이 통째로 사라진다.
    expect(revived.getProjectInfoByPath(serverPathKey(tmpRoot))).not.toBeNull();
    expect(Object.keys(revived.getProjects())).toContain(project.name);
  });
});
