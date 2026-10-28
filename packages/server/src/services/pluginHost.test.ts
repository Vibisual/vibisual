/**
 * §5.11 — 플러그인 서버 관문(`requirePluginEnabled`) 검증. 라우트는 부팅 때 전부 마운트되고 켬/끔은 이 관문만 가른다 — 틀리면 꺼 둔 플러그인의 서버 기능이 계속 응답한다.
 * 등록된 플러그인이 전부 `clientOnly` 면 `PLUGIN_SERVER_MODULES` 가 비어 이 관문이 한 번도 안 돈다 — 실행되지 않는 코드는 어떤 검사에도 안 걸리므로 여기서 행동을 고정한다.
 * 활성 판정은 프로젝트별 맵(`UserDefaults.enabledPluginsByProject`)이다 — 관문이 프로젝트를 안 보면 A 에서 켠 것이 B 에서도 열린다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { getPluginManifest } from '@vibisual/plugins';

/** 저장된 켬/끔 (프로젝트 맵 + 구 전역 시드). 테스트마다 갈아 끼운다. */
const defaults = {
  enabledPluginsByProject: undefined as Record<string, string[]> | undefined,
  enabledPlugins: undefined as string[] | undefined,
};
/** 사용자가 마지막으로 보던 프로젝트 — 요청에 projectId 가 없을 때의 판정 기준. */
const lastActiveProject = { value: null as string | null };

vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: {
    get: () => ({
      enabledPluginsByProject: defaults.enabledPluginsByProject,
      enabledPlugins: defaults.enabledPlugins,
    }),
  },
}));
vi.mock('./appState.js', () => ({
  loadAppState: () => ({ lastActiveProject: lastActiveProject.value }),
}));
vi.mock('../logger.js', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

/** 호스트는 CMD 경로에서 에이전트 → 프로젝트를 그래프에 묻는다(터미널의 cwd 는 워크트리·하위 폴더일 수 있어 켬/끔 키와 어긋난다). 여기서는 그 답만 흉내낸다. */
const agentProject = { value: null as string | null };
/** §5.11 정독 게이트 — 호스트가 프로젝트의 정독 설정을 그래프에 묻는다(아직 안 정했으면 undefined). */
const specSettings = { value: undefined as import('@vibisual/shared').SpecReadingSettings | undefined };
vi.mock('./projectGraphManager.js', () => ({
  graphManager: {
    getProjectPathForAgent: () => agentProject.value,
    getSpecReadingSettings: () => specSettings.value,
  },
}));

const {
  requirePluginEnabled,
  buildPluginPromptSection,
  getPluginFactsFor,
  getPluginFactsForProjects,
  buildInteractivePluginBlockForAgent,
  mountPluginRoutes,
} = await import('./pluginHost.js');

const PROJECT_A = '/w/alpha';
const PROJECT_B = '/w/beta';

/**
 * 픽스처 문서에 **내용이 있어야 한다** — 집행은 "문서가 있다"와 "내용이 있다"를 가르므로(0바이트·제목만 있는 파일은 SSOT 로 치지 않는다),
 * 두 줄짜리 픽스처는 실제 프로젝트와 다른 분기를 고정한다.
 */
const BODY = '이 프로젝트의 기획 원칙을 적는다. '.repeat(30);
const DOC_WITH_LOG = `# 기획\n\n## 1. 개요\n${BODY}\n\n## Change Log\n- 2026-08-01 첫 줄\n`;
const DOC_NO_LOG = `# 기획\n\n## 1. 개요\n${BODY}\n\n## 부록\n본문만 있다\n`;

/** 응답을 기록하는 최소 스텁 — express 를 띄우지 않고 미들웨어만 직접 부른다. */
function fakeRes(): Response & { statusCode: number | null; body: unknown } {
  const res = {
    statusCode: null as number | null,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number | null; body: unknown };
}

/** 요청 스텁 — `?projectId=` 를 준 것과 안 준 것을 구분해 만든다. */
function fakeReq(projectId?: string): Request {
  return { query: projectId ? { projectId } : {}, get: () => undefined } as unknown as Request;
}

const run = (id: string, projectId?: string): { res: ReturnType<typeof fakeRes>; passed: boolean } => {
  const res = fakeRes();
  let passed = false;
  requirePluginEnabled(id)(fakeReq(projectId), res, () => { passed = true; });
  return { res, passed };
};

beforeEach(() => {
  defaults.enabledPluginsByProject = undefined;
  defaults.enabledPlugins = undefined;
  lastActiveProject.value = PROJECT_A;
});

describe('플러그인 서버 관문', () => {
  it('꺼져 있으면 409 로 끊고 다음으로 넘기지 않는다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: [] };
    const { res, passed } = run('lethal-trifecta');
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ ok: false, pluginId: 'lethal-trifecta' });
  });

  it('켜져 있으면 통과시킨다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: ['lethal-trifecta'] };
    const { res, passed } = run('lethal-trifecta');
    expect(passed).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('설정이 아직 없으면 막는다 — 기본값은 전부 비활성이다', () => {
    expect(run('lethal-trifecta').passed).toBe(false);
  });

  it('다른 플러그인을 켠 것으로 열리지 않는다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: ['kill-switch'] };
    expect(run('lethal-trifecta').passed).toBe(false);
    expect(run('kill-switch').passed).toBe(true);
  });

  it('판정은 매 요청마다 다시 한다 — 껐다 켠 것이 재시작 없이 즉시 유효해야 한다', () => {
    const guard = requirePluginEnabled('kill-switch');
    const call = (): boolean => {
      let passed = false;
      guard(fakeReq(), fakeRes(), () => { passed = true; });
      return passed;
    };
    defaults.enabledPluginsByProject = { [PROJECT_A]: [] };
    expect(call()).toBe(false);
    defaults.enabledPluginsByProject = { [PROJECT_A]: ['kill-switch'] };   // 창에서 켠 순간
    expect(call()).toBe(true);
    defaults.enabledPluginsByProject = { [PROJECT_A]: [] };                // 다시 끈 순간
    expect(call()).toBe(false);
  });
});

describe('프로젝트별 활성', () => {
  it('A 에서 켠 것이 B 를 열지 않는다 — 이게 프로젝트별의 전부다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: ['kill-switch'], [PROJECT_B]: [] };
    expect(run('kill-switch', PROJECT_A).passed).toBe(true);
    expect(run('kill-switch', PROJECT_B).passed).toBe(false);
  });

  it('요청이 프로젝트를 말하지 않으면 마지막으로 보던 프로젝트로 판정한다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: ['kill-switch'], [PROJECT_B]: [] };
    lastActiveProject.value = PROJECT_B;
    expect(run('kill-switch').passed).toBe(false);
    lastActiveProject.value = PROJECT_A;
    expect(run('kill-switch').passed).toBe(true);
  });

  it('요청의 projectId 가 마지막 프로젝트보다 우선한다', () => {
    defaults.enabledPluginsByProject = { [PROJECT_A]: [], [PROJECT_B]: ['kill-switch'] };
    lastActiveProject.value = PROJECT_A;
    expect(run('kill-switch', PROJECT_B).passed).toBe(true);
  });

  it('그 프로젝트 칸이 없으면 구 전역 목록을 시드로 쓴다 — 판올림에 켠 것이 사라지지 않게', () => {
    defaults.enabledPlugins = ['kill-switch'];
    defaults.enabledPluginsByProject = { [PROJECT_B]: [] };
    expect(run('kill-switch', PROJECT_A).passed).toBe(true);
  });

  it('프로젝트 칸이 있으면 시드를 보지 않는다 — 빈 배열은 "이 프로젝트에서 전부 끔"이다', () => {
    defaults.enabledPlugins = ['kill-switch'];
    defaults.enabledPluginsByProject = { [PROJECT_A]: [] };
    expect(run('kill-switch', PROJECT_A).passed).toBe(false);
  });

  it('대소문자·역슬래시만 다른 경로는 같은 프로젝트로 본다 — Windows 에서 칸이 둘로 갈리면 안 된다', () => {
    defaults.enabledPluginsByProject = { 'C:/Work/Alpha': ['kill-switch'] };
    expect(run('kill-switch', 'c:\\work\\alpha').passed).toBe(true);
  });
});

/** 관문이 정확해도 **코어가 라우터를 안 부르면** 아무 일도 없다 — 빌드·타입체크를 다 통과하는 조용한 사고라 배선의 존재만 확인한다. */
describe('플러그인 라우트 배선', () => {
  it('코어가 mountPluginRoutes(app) 를 부른다', () => {
    const core = path.resolve(__dirname, '../index.ts');
    expect(fs.existsSync(core)).toBe(true);
    expect(fs.readFileSync(core, 'utf8')).toContain('mountPluginRoutes(app)');
  });
});

/**
 * §5.11 — 집행 슬롯(`agentPrompt`). 켠 사람이 없으면 이 경로는 안 돈다 — 그래서 **안 켜면 한 글자도 안 나온다**를 못 박는다
 * (무너지면 플러그인을 안 쓰는 모든 프로젝트의 프롬프트가 조용히 오염된다).
 */
describe('집행 슬롯 — 프롬프트 블록 조립', () => {
  let root = '';

  const call = (projectPath = root): string =>
    buildPluginPromptSection({
      projectPath,
      cwd: projectPath,
      agentId: 'agent-1',
      agentLabel: 'Agent',
      customCreated: true,
    });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-plugin-'));
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    lastActiveProject.value = root;
  });

  it('안 켜면 빈 문자열 — 프롬프트가 한 글자도 늘지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: [] };
    expect(call()).toBe('');
  });

  it('설정 자체가 없어도 빈 문자열 — 기본은 전부 비활성이다', () => {
    expect(call()).toBe('');
  });

  it('켜면 그 프로젝트에서 실제로 찾은 SSOT 문서 경로가 박혀 나온다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    const out = call();
    expect(out).toContain('docs/SCENARIO.md');
    expect(out).toContain('Change Log');
  });

  it('A 에서 켠 것이 B 의 프롬프트로 새지 않는다', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-plugin-b-'));
    fs.mkdirSync(path.join(other, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(other, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'], [other]: [] };
    expect(call(root)).not.toBe('');
    expect(call(other)).toBe('');
  });

  it('SSOT 문서가 없으면 침묵하지 않고 "먼저 물어라"를 싣는다', () => {
    fs.rmSync(path.join(root, 'docs', 'SCENARIO.md'));
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(call()).toContain('묻는다');
  });

  it('projectPath 가 비면 아무것도 만들지 않는다 — 프로젝트를 모르면 판정 자체가 불가능하다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(call('')).toBe('');
  });

  it('탐침은 프로젝트 루트를 벗어나지 못한다 — 상위 폴더의 같은 이름 문서를 집지 않는다', () => {
    // 부모에 SSOT 문서를 심고, 자식 폴더를 프로젝트로 잡는다. `..` 로 새어 나가면 그것을 집을 것이다.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-parent-'));
    fs.mkdirSync(path.join(parent, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(parent, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    const child = path.join(parent, 'child');
    fs.mkdirSync(child, { recursive: true });
    defaults.enabledPluginsByProject = { [child]: ['ssot-drift'] };
    // 자식에는 후보가 하나도 없으므로 "지정되지 않음" 쪽으로 가야 한다.
    expect(call(child)).toContain('묻는다');
  });

  it('같은 자리에서 지시하는 문서가 더 있으면 누가 이기는지를 못 박는다', () => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# rules\n', 'utf8');
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    const out = call();
    expect(out).toContain('CLAUDE.md');
    expect(out).toContain('SSOT 가 이긴다');
  });

  /**
   * 읽기 캐시의 짧은 TTL — 실시간 append 되는 큰 문서를 매 턴 다시 읽지 않으면서 이어지는 턴에도 집행을 싣는 절충이다.
   * 그래서 **TTL 안에서는 다시 읽지 않고**, **지나면 새 내용으로 판정한다**를 함께 못 박는다.
   */
  it('문서가 바뀌어도 TTL 안에서는 직전 판정을 쓴다 — 매 턴 큰 문서를 다시 읽지 않는다', () => {
    vi.useFakeTimers();
    try {
      defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
      expect(call()).toContain('한 줄 남긴 뒤');          // Change Log 있음
      const doc = path.join(root, 'docs', 'SCENARIO.md');
      fs.writeFileSync(doc, DOC_NO_LOG, 'utf8');
      fs.utimesSync(doc, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
      vi.advanceTimersByTime(1_000);                      // TTL(10초) 안
      expect(call()).toContain('한 줄 남긴 뒤');          // 아직 직전 내용
    } finally {
      vi.useRealTimers();
    }
  });

  it('TTL 이 지나면 새 내용으로 판정한다 — 낡은 판정에 갇히지 않는다', () => {
    vi.useFakeTimers();
    try {
      defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
      expect(call()).toContain('한 줄 남긴 뒤');
      const doc = path.join(root, 'docs', 'SCENARIO.md');
      fs.writeFileSync(doc, DOC_NO_LOG, 'utf8');
      fs.utimesSync(doc, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
      vi.advanceTimersByTime(11_000);                     // TTL 경과
      expect(call()).toContain('절을 만들고');            // Change Log 없음
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * §5.11 — 집행 실측(카드가 집행과 같은 것을 세게 하는 통로). 이 경로도 켠 사람이 없으면 안 도는 부류라(survey 를 내는 카드가 `ssot-drift` 하나뿐)
 * 실행되지 않는 코드는 어떤 검사에도 안 걸리므로 행동을 여기서 고정한다.
 */
describe('집행 실측 — 카드가 읽는 값', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-facts-'));
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# rules\n', 'utf8');
    lastActiveProject.value = root;
    agentProject.value = root;
  });

  it('안 켜면 빈 객체 — 스냅샷에 필드가 생기지 않는다(켬 목록을 묻지 않는 카드만 예외)', () => {
    defaults.enabledPluginsByProject = { [root]: [] };
    const facts = getPluginFactsFor(root);
    expect(Object.keys(facts).filter((id) => getPluginManifest(id)?.ownToggle !== true)).toEqual([]);
    /*
     * §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드도 여기서 한 칸(**꺼져 있다**)을 낸다 — 안 내면 계기판이 "측정 전"에 머물러
     * 켜야 한다는 것을 영영 모른다(`spec-driven/index.tsx` 의 `status` 가 두 상태를 갈라 그린다).
     * 대신 그 한 칸이 전부여야 한다 — 꺼진 층은 색인조차 안 세우므로, 잰 값이 딸려 오면 꺼 둔 프로젝트가 매 턴 `docs/**` 를 훑는다는 뜻이다.
     */
    expect(facts['spec-driven']).toEqual({ specEnabled: false });
  });

  it('켜면 프롬프트에 실은 것과 같은 값이 실측으로 나온다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    const facts = getPluginFactsFor(root)['ssot-drift'];
    expect(facts).toBeDefined();
    expect(facts?.doc).toBe('docs/SCENARIO.md');
    expect(facts?.hasChangeLog).toBe(true);
    expect(facts?.rivals).toEqual(['CLAUDE.md']);
    // 프롬프트가 "N곳"이라 말하면 카드도 N 이어야 한다(둘이 갈리면 안 된다).
    expect(facts?.sources).toBe(2);
    expect(buildPluginPromptSection({ projectPath: root, cwd: root, agentId: 'a', agentLabel: 'A', customCreated: true }))
      .toContain(`**${facts?.sources as number}곳**`);
  });

  it('SSOT 문서를 못 찾으면 빈 경로로 알린다 — "없음"과 "아직 안 재봤음"은 다른 상태다', () => {
    fs.rmSync(path.join(root, 'docs', 'SCENARIO.md'));
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(getPluginFactsFor(root)['ssot-drift']?.doc).toBe('');
  });

  it('A 에서 켠 것이 B 의 실측으로 새지 않는다', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-facts-b-'));
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'], [other]: [] };
    /*
     * §5.5 #17-44 ⑧(d) — `ownToggle` 카드는 이 목록을 묻지 않아 모든 프로젝트에 선다(새는 게 아니라 스위치가 여기 없는 것이고, 내는 값도 "꺼져 있다" 한 칸뿐).
     * 그래서 **여기서 켜서 선 것**만 남기고 샘을 본다.
     */
    const byList = (p: string): string[] =>
      Object.keys(getPluginFactsFor(p)).filter((id) => getPluginManifest(id)?.ownToggle !== true);
    expect(byList(root)).toEqual(['ssot-drift']);
    expect(byList(other)).toEqual([]);
    // 프로젝트 칸 자체는 양쪽 다 선다 — `ownToggle` 카드가 프로젝트마다 꺼짐을 신고하기 때문이다.
    expect(Object.keys(getPluginFactsForProjects([root, other]) ?? {}).sort()).toEqual([root, other].sort());
  });

  it('끄면 다음 조회에서 바로 빠진다 — 캐시가 켬/끔을 지연시키지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(getPluginFactsFor(root)['ssot-drift']).toBeDefined();
    defaults.enabledPluginsByProject = { [root]: [] };
    // 끈 카드가 빠지는지만 본다 — 켬 목록을 묻지 않는 카드(§5.5 #17-44 ⑧(d))는 끌 대상이 아니다.
    expect(getPluginFactsFor(root)['ssot-drift']).toBeUndefined();
  });

  it('프로젝트를 모르면 아무것도 재지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(getPluginFactsFor('')).toEqual({});
  });
});

/** §5.11 — CMD(인터랙티브 터미널) 경로에도 집행이 닿아야 한다 — 안 닿으면 CMD 버블에서는 켜도 아무 일도 안 일어난다. */
describe('집행 슬롯 — CMD 세션 블록', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-cmd-'));
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    lastActiveProject.value = root;
    agentProject.value = root;
  });

  it('켠 프로젝트의 CMD 에이전트는 집행 블록을 받는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(buildInteractivePluginBlockForAgent('agent-cmd')).toContain('docs/SCENARIO.md');
  });

  it('안 켜면 빈 문자열 — rules 파일이 종전과 바이트 단위로 같다', () => {
    defaults.enabledPluginsByProject = { [root]: [] };
    expect(buildInteractivePluginBlockForAgent('agent-cmd')).toBe('');
  });

  it('그래프가 프로젝트를 모르면 빈 문자열 — cwd 로 추측하지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    agentProject.value = null;
    expect(buildInteractivePluginBlockForAgent('agent-cmd')).toBe('');
  });

  it('다른 프로젝트에서 켠 것은 이 에이전트에 실리지 않는다', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-cmd-b-'));
    defaults.enabledPluginsByProject = { [other]: ['ssot-drift'], [root]: [] };
    expect(buildInteractivePluginBlockForAgent('agent-cmd')).toBe('');
  });
});

/**
 * §5.11 — 프로젝트가 SSOT 를 지정하는 창구(켤 때 문서를 자동 생성하거나, 이미 있으면 폴더를 따로 지정한다).
 * 쓰기가 있는 첫 플러그인 창구이자 `requirePluginEnabled` 가 실제로 도는 경로라 셋을 못 박는다:
 * 꺼져 있으면 안 열린다 · 프로젝트 밖으로는 못 쓴다 · 쓰면 그 즉시 판정이 바뀐다.
 */
describe('SSOT 지정 창구 (플러그인 REST)', () => {
  interface Route { method: string; path: string; handlers: ((req: Request, res: Response, next: () => void) => void)[] }
  const routes: Route[] = [];

  /** express 를 띄우지 않고 등록만 받아 두는 최소 앱 — 핸들러를 직접 부른다. */
  const fakeApp = {
    get: (p: string, ...h: unknown[]) => { routes.push({ method: 'get', path: p, handlers: h as Route['handlers'] }); },
    put: (p: string, ...h: unknown[]) => { routes.push({ method: 'put', path: p, handlers: h as Route['handlers'] }); },
    post: (p: string, ...h: unknown[]) => { routes.push({ method: 'post', path: p, handlers: h as Route['handlers'] }); },
    use: () => {},
  };

  let root = '';

  function callRoute(method: string, suffix: string, body: unknown, projectId?: string): ReturnType<typeof fakeRes> {
    const route = routes.find((r) => r.method === method && r.path.endsWith(suffix));
    if (!route) throw new Error(`route not registered: ${method} ${suffix}`);
    const res = fakeRes();
    const req = {
      query: projectId ? { projectId } : {},
      get: () => undefined,
      body,
    } as unknown as Request;
    let index = 0;
    const next = (): void => {
      const handler = route.handlers[index++];
      if (handler) handler(req, res, next);
    };
    next();
    return res;
  }

  beforeEach(() => {
    routes.length = 0;
    mountPluginRoutes(fakeApp as unknown as Parameters<typeof mountPluginRoutes>[0]);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-ssot-cfg-'));
    lastActiveProject.value = root;
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
  });

  it('꺼 두면 열리지 않는다 — 관문이 실제로 도는 첫 경로다', () => {
    defaults.enabledPluginsByProject = { [root]: [] };
    expect(callRoute('get', '/config', undefined).statusCode).toBe(409);
  });

  it('지정하면 프로젝트 안 파일로 남고, 그 다음 판정이 그 문서를 잡는다', () => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'GDD.md'), DOC_WITH_LOG, 'utf8');

    const res = callRoute('put', '/config', { doc: 'docs/GDD.md' });
    expect((res.body as { ok?: boolean }).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.vibisual', 'ssot.json'), 'utf8'))).toEqual({ doc: 'docs/GDD.md' });

    // 캐시가 옛 답을 붙들고 있으면 "저장했는데 안 바뀌네"가 된다 — 그 자리에서 새 판정이 나와야 한다.
    expect(getPluginFactsFor(root)['ssot-drift']?.doc).toBe('docs/GDD.md');
    expect(buildPluginPromptSection({ projectPath: root, cwd: root, agentId: 'a', agentLabel: 'A', customCreated: true }))
      .toContain('docs/GDD.md');
  });

  it('프로젝트 밖으로는 못 쓴다 — 절대경로·상위 탈출은 거부', () => {
    expect(callRoute('put', '/config', { doc: 'C:/etc/hosts' }).statusCode).toBe(400);
    expect(callRoute('put', '/config', { doc: '../outside.md' }).statusCode).toBe(400);
    expect(fs.existsSync(path.join(root, '.vibisual', 'ssot.json'))).toBe(false);
  });

  it('빈 값을 보내면 지정이 풀린다 — 다시 후보 탐색으로 돌아간다', () => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'SCENARIO.md'), DOC_WITH_LOG, 'utf8');
    callRoute('put', '/config', { doc: 'docs/GDD.md' });
    callRoute('put', '/config', { doc: '' });
    expect(getPluginFactsFor(root)['ssot-drift']?.doc).toBe('docs/SCENARIO.md');
  });

  it('문서가 없으면 만들어 주고 곧바로 지정한다 — 그리고 그 문서는 빈 문서가 아니다', () => {
    const res = callRoute('post', '/create-doc', { path: 'docs/SSOT.md', locale: 'ko' });
    expect((res.body as { created?: boolean }).created).toBe(true);
    expect(fs.existsSync(path.join(root, 'docs', 'SSOT.md'))).toBe(true);

    const facts = getPluginFactsFor(root)['ssot-drift'];
    expect(facts?.doc).toBe('docs/SSOT.md');
    // 우리가 만든 문서가 "내용 없음"으로 떨어지면, 이 플러그인이 막기로 한 상태를 우리가 만든 셈이다.
    expect(facts?.docState).toBe('ok');
    expect(facts?.hasChangeLog).toBe(true);
  });

  it('이미 있는 문서는 덮어쓰지 않는다 — 사용자의 기획서를 지우는 길은 열지 않는다', () => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'SSOT.md'), DOC_WITH_LOG, 'utf8');
    const res = callRoute('post', '/create-doc', { path: 'docs/SSOT.md' });
    expect((res.body as { created?: boolean }).created).toBe(false);
    expect(fs.readFileSync(path.join(root, 'docs', 'SSOT.md'), 'utf8')).toBe(DOC_WITH_LOG);
  });

  it('지정만 하고 파일이 없으면 그 사실을 그대로 알린다 — "못 찾음"과 다른 상태다', () => {
    callRoute('put', '/config', { doc: 'docs/NOPE.md' });
    expect(getPluginFactsFor(root)['ssot-drift']?.docState).toBe('configMissing');
  });
});
