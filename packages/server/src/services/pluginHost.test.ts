/**
 * §5.11 v4.27 · v4.54 — 플러그인 서버 관문(`requirePluginEnabled`) 검증.
 *
 * 이 미들웨어가 플러그인의 **온/오프 경계 그 자체**다. 서버 라우트는 부팅 시 전부 마운트되고, 껐는지 켰는지는
 * 오직 이 관문이 판단한다. 여기가 잘못되면 **꺼 둔 플러그인의 서버 기능이 계속 응답한다** — 사용자는
 * 창에서 껐다고 믿고 있는데.
 *
 * 그런데 지금까지 이 관문은 **한 번도 실행된 적이 없다.** 등록된 111종이 전부 `clientOnly` 라
 * `PLUGIN_SERVER_MODULES` 가 비어 있고, 그래서 마운트 반복문이 한 바퀴도 돌지 않기 때문이다.
 * 즉 첫 서버 기여 플러그인이 들어오는 순간 처음 실행되는 코드다 — 그때 처음 검증하면 늦다.
 *
 * v4.54 에서 활성 판정 SSOT 가 전역 배열 → **프로젝트별 맵**(`UserDefaults.enabledPluginsByProject`)으로
 * 바뀌었다. 관문이 프로젝트를 안 보고 판정하면 "A 프로젝트에서 켠 것이 B 프로젝트에서도 열린다" —
 * 실행되지 않는 코드라 어떤 검사에도 안 걸리므로 여기서 행동을 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';

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

/**
 * v4.65 — 호스트가 CMD 경로용으로 **에이전트 → 프로젝트**를 그래프에 묻는다(터미널이 아는 cwd 는
 * 워크트리·하위 폴더일 수 있어 켬/끔 키와 어긋난다). 여기서는 그 답만 흉내낸다.
 */
const agentProject = { value: null as string | null };
vi.mock('./projectGraphManager.js', () => ({
  graphManager: { getProjectPathForAgent: () => agentProject.value },
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
 * v4.67 — 픽스처 문서에 **내용이 있어야 한다.**
 *
 * 그전까지 이 파일의 SSOT 픽스처는 `# 기획\n## Change Log\n` 두 줄이었다. 그런데 v4.67 부터 집행은
 * "문서가 있다"와 "문서에 내용이 있다"를 가른다(0바이트·제목만 있는 파일이 SSOT 로 인정돼 규율 여섯
 * 줄이 실리던 것을 막기 위해서다). 두 줄짜리 픽스처를 그대로 두면 이 검사는 **실제 사용자 프로젝트와
 * 다른 분기**를 고정하게 된다.
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

describe('프로젝트별 활성 (v4.54)', () => {
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

/**
 * 관문이 아무리 정확해도 **코어가 라우터를 안 부르면** 아무 일도 안 일어난다. 그리고 그 사고는 조용하다 —
 * 빌드도 타입체크도 통과하고, 지금은 서버 기여가 0 이라 눈에 띄는 증상조차 없다. 배선의 존재만 확인한다.
 */
describe('플러그인 라우트 배선', () => {
  it('코어가 mountPluginRoutes(app) 를 부른다', () => {
    const core = path.resolve(__dirname, '../index.ts');
    expect(fs.existsSync(core)).toBe(true);
    expect(fs.readFileSync(core, 'utf8')).toContain('mountPluginRoutes(app)');
  });
});

/**
 * §5.11 v4.57 — 집행 슬롯(`agentPrompt`). 관문과 같은 함정이 있다: **켠 사람이 없으면 이 경로는 한 번도
 * 안 돈다.** 그래서 여기서 못 박는 것은 "켜면 나온다"보다 **"안 켜면 한 글자도 안 나온다"** 쪽이다 —
 * 그게 무너지면 플러그인을 쓰지 않는 모든 프로젝트의 프롬프트가 조용히 오염된다.
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
   * v4.65 — 읽기 캐시에 **짧은 TTL** 이 붙었다. 이어지는 턴에도 집행을 실으면서, 실시간으로 append 되는
   * 문서(이 저장소의 SSOT 가 그렇다)를 매 턴 900KB 씩 다시 읽지 않게 하기 위한 절충이다. 그래서 두 성질을
   * 함께 못 박는다 — **TTL 안에서는 다시 읽지 않고**, **TTL 이 지나면 새 내용으로 판정한다.**
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
 * §5.11 v4.65 — **집행 실측**(카드가 집행과 같은 것을 세게 하는 통로).
 *
 * 이 경로도 "켠 사람이 없으면 한 번도 안 도는" 부류다(survey 를 내는 카드가 현재 `ssot-drift` 하나뿐).
 * v4.27 의 교훈대로 — 실행되지 않는 코드는 어떤 검사에도 안 걸리므로 — 행동을 지금 고정한다.
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

  it('안 켜면 빈 객체 — 스냅샷에 필드가 생기지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: [] };
    expect(getPluginFactsFor(root)).toEqual({});
    expect(getPluginFactsForProjects([root])).toBeUndefined();
  });

  it('켜면 프롬프트에 실은 것과 같은 값이 실측으로 나온다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    const facts = getPluginFactsFor(root)['ssot-drift'];
    expect(facts).toBeDefined();
    expect(facts?.doc).toBe('docs/SCENARIO.md');
    expect(facts?.hasChangeLog).toBe(true);
    expect(facts?.rivals).toEqual(['CLAUDE.md']);
    // 프롬프트가 "3곳"이라 말하면 카드도 3이어야 한다 — 이 둘이 갈리는 것이 v4.57~v4.63 의 결함이었다.
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
    expect(Object.keys(getPluginFactsFor(root))).toEqual(['ssot-drift']);
    expect(getPluginFactsFor(other)).toEqual({});
    expect(Object.keys(getPluginFactsForProjects([root, other]) ?? {})).toEqual([root]);
  });

  it('끄면 다음 조회에서 바로 빠진다 — 캐시가 켬/끔을 지연시키지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(getPluginFactsFor(root)['ssot-drift']).toBeDefined();
    defaults.enabledPluginsByProject = { [root]: [] };
    expect(getPluginFactsFor(root)).toEqual({});
  });

  it('프로젝트를 모르면 아무것도 재지 않는다', () => {
    defaults.enabledPluginsByProject = { [root]: ['ssot-drift'] };
    expect(getPluginFactsFor('')).toEqual({});
  });
});

/**
 * §5.11 v4.65 — **CMD(인터랙티브 터미널) 경로**. v4.57~v4.63 에서 이 경로는 집행이 아예 닿지 않았고,
 * 그래서 "켰는데 아무 일도 안 일어난다"가 CMD 버블에서는 사실이었다.
 */
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
 * §5.11 v4.67 — **SSOT 를 프로젝트가 지정하는 창구.**
 *
 * 사용자 지시 — "활성화 시 내 프로젝트에 자동 생성해서 문서를 지정해 주든가, 기존에 있다면 사용자가
 * 별도로 폴더 지정을 할 수 있어야 할 듯."
 *
 * 이 라우트들은 **쓰기가 있는 첫 플러그인 창구**이고, `requirePluginEnabled` 관문이 실제로 실행되는
 * 첫 경로이기도 하다(v4.27 의 교훈 — 실행되지 않는 코드는 어떤 검사에도 안 걸린다). 그래서 여기서
 * 세 가지를 못 박는다: 꺼져 있으면 안 열린다 · 프로젝트 밖으로는 못 쓴다 · 쓰면 그 즉시 판정이 바뀐다.
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
