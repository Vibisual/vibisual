import { describe, expect, it, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseCodexMcpList,
  parseCodexPluginList,
  parseCodexSkillDescription,
  parseCodexHookEntries,
  readCodexSkillsIn,
  readCodexPluginSkillsIn,
  parseCodexPromptInputSkills,
  readCodexAgentsDocsIn,
} from './codexInventoryService.js';

/**
 * §5.25 (M) — 코덱스 인벤토리 파서.
 *
 * 못 박는 것 셋: ① **모르는 모양이면 빈 목록**(지어내지 않는다), ② **비밀값을 담지 않는다**
 * (MCP 의 `env`·토큰 환경변수명·헤더는 읽고 버린다), ③ **남의 훅도 그대로 보여 준다**
 * (`ours` 로 갈라 적을 뿐 감추지 않는다).
 *
 * 디스크를 만지는 시험은 전부 `mkdtemp` 임시 폴더에서 돈다 — 진짜 `~/.codex` 를 건드리지 않는다.
 */

const tmpRoots: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-codex-inv-'));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
  }
});

describe('parseCodexMcpList', () => {
  const REAL = JSON.stringify([
    {
      name: 'node_repl',
      enabled: true,
      disabled_reason: null,
      transport: { type: 'stdio', command: 'node', args: ['x.js'], env: { OPENAI_API_KEY: 'sk-secret' }, cwd: null },
      auth_status: 'unsupported',
    },
    {
      name: 'openaiDeveloperDocs',
      enabled: true,
      transport: { type: 'streamable_http', url: 'https://example.test/mcp', bearer_token_env_var: 'SECRET_ENV' },
      auth_status: 'unsupported',
    },
  ]);

  it('이름·전송·켜짐을 코덱스가 신고한 그대로 옮긴다', () => {
    const got = parseCodexMcpList(REAL);
    expect(got.map((s) => s.name)).toEqual(['node_repl', 'openaiDeveloperDocs']);
    expect(got[0]?.transport).toBe('stdio');
    expect(got[1]?.transport).toBe('streamable_http');
    expect(got.every((s) => s.enabled)).toBe(true);
    expect(got[0]?.authStatus).toBe('unsupported');
  });

  it('붙는 자리만 적고 **비밀값은 담지 않는다**', () => {
    const got = parseCodexMcpList(REAL);
    expect(got[0]?.target).toBe('node');
    expect(got[1]?.target).toBe('https://example.test/mcp');
    const dumped = JSON.stringify(got);
    expect(dumped).not.toContain('sk-secret');
    expect(dumped).not.toContain('SECRET_ENV');
    expect(dumped).not.toContain('OPENAI_API_KEY');
  });

  it('말 안 한 enabled 는 켜진 것으로 읽지 않는다', () => {
    const got = parseCodexMcpList(JSON.stringify([{ name: 'x', transport: { type: 'stdio' } }]));
    expect(got[0]?.enabled).toBe(false);
  });

  it('꺼진 사유는 코덱스가 준 그대로, 없으면 칸 자체가 없다', () => {
    const got = parseCodexMcpList(JSON.stringify([
      { name: 'a', enabled: false, disabled_reason: 'auth expired', transport: { type: 'stdio' } },
      { name: 'b', enabled: true, disabled_reason: null, transport: { type: 'stdio' } },
    ]));
    expect(got[0]?.disabledReason).toBe('auth expired');
    expect(got[1]?.disabledReason).toBeUndefined();
  });

  it('모르는 모양이면 빈 배열(지어내지 않는다)', () => {
    expect(parseCodexMcpList('not json')).toEqual([]);
    expect(parseCodexMcpList('{"servers":[]}')).toEqual([]);
    expect(parseCodexMcpList('[]')).toEqual([]);
    // 이름 없는 항목은 그릴 수 없다 — 통째로 버린다.
    expect(parseCodexMcpList('[{"transport":{"type":"stdio"}}]')).toEqual([]);
  });
});

describe('parseCodexPluginList', () => {
  const REAL = JSON.stringify({
    installed: [
      {
        pluginId: 'documents@openai-primary-runtime',
        name: 'documents',
        marketplaceName: 'openai-primary-runtime',
        version: '26.826.12353',
        installed: true,
        enabled: true,
        source: { source: 'local', path: 'C:\\p\\documents' },
      },
      {
        pluginId: 'computer-use@openai-bundled',
        name: 'computer-use',
        marketplaceName: 'openai-bundled',
        installed: true,
        enabled: false,
      },
    ],
    available: [
      { pluginId: 'github@openai-curated', name: 'github', marketplaceName: 'openai-curated', installed: false, enabled: false },
      // 깔린 것과 같은 id 가 available 에도 있으면 깔린 쪽만 남는다.
      { pluginId: 'documents@openai-primary-runtime', name: 'documents', installed: false, enabled: false },
    ],
  });

  it('깔린 것이 앞, 장터 것이 뒤', () => {
    const got = parseCodexPluginList(REAL);
    expect(got.map((p) => p.name)).toEqual(['documents', 'computer-use', 'github']);
  });

  it('깔림/켜짐을 각각 옮긴다(깔렸지만 꺼진 것이 있다)', () => {
    const got = parseCodexPluginList(REAL);
    expect(got[0]).toMatchObject({ installed: true, enabled: true, version: '26.826.12353', marketplace: 'openai-primary-runtime' });
    expect(got[1]).toMatchObject({ installed: true, enabled: false });
    expect(got[2]).toMatchObject({ installed: false, enabled: false });
  });

  it('같은 pluginId 가 양쪽에 있으면 한 번만 뜬다', () => {
    expect(parseCodexPluginList(REAL).filter((p) => p.name === 'documents')).toHaveLength(1);
  });

  it('모르는 모양이면 빈 배열', () => {
    expect(parseCodexPluginList('nope')).toEqual([]);
    expect(parseCodexPluginList('[]')).toEqual([]);
    expect(parseCodexPluginList('{}')).toEqual([]);
  });
});

describe('parseCodexSkillDescription', () => {
  it('앞머리의 description 을 먼저 본다', () => {
    const raw = ['---', 'name: art', 'description: 배경 그림을 그린다', '---', '', '# 제목', '본문'].join('\n');
    expect(parseCodexSkillDescription(raw)).toBe('배경 그림을 그린다');
  });

  it('따옴표는 벗긴다', () => {
    expect(parseCodexSkillDescription('---\ndescription: "quoted"\n---\n')).toBe('quoted');
  });

  it('앞머리가 없으면 첫 본문 줄(제목 줄은 건너뛴다)', () => {
    expect(parseCodexSkillDescription('# 제목\n\n첫 줄입니다\n둘째 줄')).toBe('첫 줄입니다');
  });

  it('쓸 줄이 없으면 undefined — 없는 설명을 지어내지 않는다', () => {
    expect(parseCodexSkillDescription('')).toBeUndefined();
    expect(parseCodexSkillDescription('# 제목만')).toBeUndefined();
  });
});

describe('readCodexSkillsIn', () => {
  it('폴더가 곧 스킬이고, SKILL.md 가 있으면 설명을 붙인다', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'character-art'));
    fs.writeFileSync(path.join(root, 'character-art', 'SKILL.md'), '---\ndescription: 캐릭터를 그린다\n---\n');
    fs.mkdirSync(path.join(root, 'plain-skill'));
    const got = readCodexSkillsIn(root);
    expect(got.map((s) => s.name)).toEqual(['character-art', 'plain-skill']);
    expect(got[0]?.description).toBe('캐릭터를 그린다');
    // 설명이 없으면 칸 자체가 없다 — 화면은 이름만 적는다.
    expect(got[1]?.description).toBeUndefined();
  });

  it('점 폴더와 파일은 스킬이 아니다', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'README.md'), 'x');
    expect(readCodexSkillsIn(root)).toEqual([]);
  });

  it('폴더가 없으면 빈 배열(에러 ❌)', () => {
    expect(readCodexSkillsIn(path.join(tmpDir(), 'nope'))).toEqual([]);
  });
});

describe('readCodexAgentsDocsIn', () => {
  it('있으면 크기·줄수까지, 없으면 자리는 남기고 exists=false', () => {
    const home = tmpDir();
    const project = tmpDir();
    fs.writeFileSync(path.join(home, 'AGENTS.md'), 'a\nb\nc');
    const got = readCodexAgentsDocsIn(home, project);
    expect(got.map((d) => d.scope)).toEqual(['home', 'project']);
    expect(got[0]).toMatchObject({ exists: true, bytes: 5, lines: 3 });
    // 없다는 것도 정보다 — 자리를 지우면 "이 프로젝트엔 규칙이 없다"를 말할 수 없다.
    expect(got[1]?.exists).toBe(false);
    expect(got[1]?.bytes).toBeUndefined();
  });

  it('프로젝트 폴더를 모르면 홈 것만 본다', () => {
    const got = readCodexAgentsDocsIn(tmpDir(), null);
    expect(got).toHaveLength(1);
    expect(got[0]?.scope).toBe('home');
  });
});

describe('parseCodexHookEntries', () => {
  const HANDLER = 'C:/app/hooks/handler.mjs';
  const RAW = JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: `node "${HANDLER}" --token abc` }] }],
      PostToolUse: [
        { hooks: [{ type: 'command', command: 'my-own-script.sh' }] },
        { hooks: [{ type: 'command', command: `node "${HANDLER}" --token abc` }] },
      ],
    },
  });

  it('남의 훅도 그대로 보여 주고 ours 로만 가른다', () => {
    const got = parseCodexHookEntries(RAW, HANDLER);
    expect(got).toHaveLength(3);
    expect(got.filter((h) => h.ours)).toHaveLength(2);
    const foreign = got.find((h) => !h.ours);
    expect(foreign?.command).toBe('my-own-script.sh');
    expect(foreign?.event).toBe('PostToolUse');
  });

  it('서명을 모르면 전부 남의 것으로 읽는다(안전한 쪽)', () => {
    expect(parseCodexHookEntries(RAW, null).every((h) => !h.ours)).toBe(true);
  });

  it('모르는 모양이면 빈 배열', () => {
    expect(parseCodexHookEntries('nope', HANDLER)).toEqual([]);
    expect(parseCodexHookEntries('{}', HANDLER)).toEqual([]);
    expect(parseCodexHookEntries('{"hooks":{"X":"not-an-array"}}', HANDLER)).toEqual([]);
  });
});


/**
 * §5.25 (M-1) — **코덱스의 스킬은 홈 하나에서 오지 않는다.**
 *
 * 이 블록이 생긴 이유는 실측이다(2026-09-08 · `codex-cli 0.152.1`): `codex debug prompt-input` 이
 * 신고한 스킬은 **15개**였고 우리 홈 폴더 스캔은 **3개**만 찾았다. 나머지 12개(코덱스 기본 스킬 5,
 * 플러그인 스킬 7)는 사용자 화면에서 통째로 사라져 있었다 — "있는 것을 감추지 않는다"는 §5.25 (M)
 * 의 규율이 스킬 칸에서만 지켜지지 않고 있었다.
 *
 * 못 박는 것: ① 신고 목록을 정본으로 읽는다, ② 짧은 경로를 루트 표로 편다, ③ 출처를 경로로 가른다,
 * ④ 루트를 모르는 항목은 **버린다**(경로를 지어내지 않는다).
 */
const PROMPT_INPUT_SAMPLE = JSON.stringify([
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: [
    '<skills_instructions>',
    '## Skills',
    '### Skill roots',
    '- `r0` = `C:/profile/.codex/skills`',
    '- `r1` = `C:/profile/.codex/skills/.system`',
    '- `r2` = `C:/profile/.codex/plugins/cache/openai-bundled`',
    '### Available skills',
    '- imagegen: Generate raster images. (file: r1/imagegen/SKILL.md)',
    '- my-skill: 내가 넣은 것. (file: r0/my-skill/SKILL.md)',
    '- visualize: Draw charts. (file: r2/visualize/1.0.27/skills/visualize/SKILL.md)',
    '- documents:documents: Edit docx. (file: r2/documents/26.1/skills/documents/SKILL.md)',
    '- ghost: 루트를 모르는 것. (file: r9/ghost/SKILL.md)',
    '</skills_instructions>',
  ].join('\n') }] },
]);

describe('parseCodexPromptInputSkills', () => {
  const HOME = 'C:/profile/.codex';

  it('코덱스가 신고한 스킬을 전부 읽는다 — 홈 것만이 아니다', () => {
    const got = parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME);
    expect(got.map((s2) => s2.name).sort()).toEqual(['documents', 'imagegen', 'my-skill', 'visualize']);
  });

  it('출처를 경로로 가른다 — 사용자 것과 코덱스 기본과 플러그인이 다른 칸에 선다', () => {
    const by = new Map(parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME).map((s2) => [s2.name, s2]));
    expect(by.get('my-skill')?.source).toBe('user');
    expect(by.get('imagegen')?.source).toBe('system');
    expect(by.get('visualize')?.source).toBe('plugin');
    // 플러그인 이름은 캐시 아래 둘째 칸이다(`<장터>/<플러그인>`).
    expect(by.get('visualize')?.pluginName).toBe('visualize');
    expect(by.get('documents')?.pluginName).toBe('documents');
  });

  it('짧은 경로를 절대경로 **폴더**로 편다(SKILL.md 가 아니라 그것을 담은 폴더)', () => {
    const by = new Map(parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME).map((s2) => [s2.name, s2]));
    expect(by.get('imagegen')?.path.replace(/\\/g, '/')).toBe('C:/profile/.codex/skills/.system/imagegen');
  });

  it('`plugin:skill` 접두가 붙은 이름은 뒤 칸이 스킬 이름이다', () => {
    const by = new Map(parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME).map((s2) => [s2.name, s2]));
    expect(by.has('documents')).toBe(true);
    expect(by.has('documents:documents')).toBe(false);
  });

  it('루트를 모르는 항목은 버린다 — 경로를 지어내지 않는다', () => {
    const names = parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME).map((s2) => s2.name);
    expect(names).not.toContain('ghost');
  });

  it('설명을 그대로 싣고, 없으면 붙이지 않는다', () => {
    const by = new Map(parseCodexPromptInputSkills(PROMPT_INPUT_SAMPLE, HOME).map((s2) => [s2.name, s2]));
    expect(by.get('imagegen')?.description).toBe('Generate raster images.');
  });

  it('모르는 모양이면 빈 배열 — 호출자가 폴더 스캔으로 떨어진다', () => {
    expect(parseCodexPromptInputSkills('not json', HOME)).toEqual([]);
    expect(parseCodexPromptInputSkills('{}', HOME)).toEqual([]);
    // 블록이 아예 없는 정상 JSON(스킬이 없는 계정)도 빈 배열이다.
    expect(parseCodexPromptInputSkills('[{"content":[{"text":"hello"}]}]', HOME)).toEqual([]);
  });
});

describe('readCodexSkillsIn — 출처 꼬리표', () => {
  it('출처를 인자로 받아 그대로 단다(스스로 판정하지 않는다)', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\ndescription: 하나\n---\n');
    expect(readCodexSkillsIn(root, 'system')[0]).toMatchObject({ name: 'alpha', source: 'system' });
    // 인자를 안 주면 사용자 것 — 옛 호출부의 뜻을 그대로 지킨다.
    expect(readCodexSkillsIn(root)[0]?.source).toBe('user');
  });

  it('점 폴더는 여전히 건너뛴다 — `.system` 은 따로 읽는 자리다', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, '.system', 'imagegen'), { recursive: true });
    expect(readCodexSkillsIn(root)).toEqual([]);
  });
});

describe('readCodexPluginSkillsIn', () => {
  it('`<장터>/<플러그인>/<버전>/skills/<이름>/` 을 찾아 플러그인 이름을 단다', () => {
    const cache = tmpDir();
    const dir = path.join(cache, 'openai-bundled', 'visualize', '1.0.27', 'skills', 'visualize');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: 그린다\n---\n');
    const got = readCodexPluginSkillsIn(cache);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: 'visualize', source: 'plugin', pluginName: 'visualize', description: '그린다' });
  });

  it('버전 폴더가 여럿이면 한 벌만 — 같은 스킬을 두 번 그리지 않는다', () => {
    const cache = tmpDir();
    for (const v of ['1.0.0', '2.0.0']) {
      const dir = path.join(cache, 'm', 'p', v, 'skills', 'thing');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: v' + v + '\n---\n');
    }
    const got = readCodexPluginSkillsIn(cache);
    expect(got).toHaveLength(1);
    expect(got[0]?.description).toBe('v2.0.0');
  });

  it('버전 칸이 없는 배치도 받는다 — 캐시 모양은 코덱스 몫이다', () => {
    const cache = tmpDir();
    const dir = path.join(cache, 'm', 'p', 'skills', 'thing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '한 줄\n');
    expect(readCodexPluginSkillsIn(cache).map((s2) => s2.name)).toEqual(['thing']);
  });

  it('없는 캐시는 빈 배열 — 플러그인을 한 번도 안 깐 기계가 정상이다', () => {
    expect(readCodexPluginSkillsIn(path.join(tmpDir(), 'nope'))).toEqual([]);
  });
});


/**
 * §5.25 (M-1) — **세 OS 에서 스킬이 제 칸에 서는가.**
 *
 * 이 블록이 생긴 이유는 앞의 판정이 `startsWith` 로 직접 적혀 있었고, 그것이 **세 가지가 동시에
 * 틀린** 상태였기 때문이다(전부 실측으로 걸렸다):
 *   ① **구분자** — 코덱스는 루트 표를 `C:/Users/<you>/...`(슬래시)로 적는데 우리 `path.join` 은 win 에서
 *      `\` 를 쓴다. 접두 비교가 어긋나 win 사용자의 스킬이 전부 `plugin` 칸으로 떨어진다.
 *   ② **대소문자** — win 과 **mac(APFS 기본)** 은 케이스를 안 가린다. 코덱스가 `c:/` 로 적고 우리가
 *      `C:\` 를 들고 있으면 같은 폴더가 남남이 된다. **linux 는 반대로 접으면 안 된다** —
 *      그 갈림은 `pathKey`/`isPathWithin` 이 이미 알고 있으므로 우리가 다시 적지 않는다.
 *   ③ **경계** — `startsWith` 만 보면 형제 폴더 `skills-backup` 이 `skills` 로 시작해 홈 스킬로 읽힌다.
 *
 * 그리고 **`platform` 을 인자로 받는 것**이 이 시험이 성립하는 조건이다(정본 §1 "검증 가능하게
 * 짜라"). `process.platform` 을 안에서 읽으면 win 가지는 리눅스 CI 에서, posix 가지는 개발기에서
 * 영영 안 돌아 이 세 결함이 다시 조용히 들어온다.
 */
describe('§5.25 (M-1) 스킬 출처 판정 — 세 OS', () => {
  function promptInput(roots: string[], items: string[]): string {
    return JSON.stringify([
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: [
        '<skills_instructions>', '### Skill roots', ...roots, '### Available skills', ...items,
      ].join('\n') }] },
    ]);
  }

  it('win: 코덱스는 슬래시로 적고 우리 홈은 역슬래시다 — 그래도 제 칸에 선다', () => {
    const raw = promptInput(
      [
        '- `r0` = `C:/profile/.codex/skills`',
        '- `r1` = `C:/profile/.codex/skills/.system`',
        '- `r2` = `C:/profile/.codex/plugins/cache/openai-bundled`',
      ],
      [
        '- mine: 내 것. (file: r0/mine/SKILL.md)',
        '- imagegen: 기본. (file: r1/imagegen/SKILL.md)',
        '- visualize: 플러그인. (file: r2/visualize/1.0.0/skills/visualize/SKILL.md)',
      ],
    );
    const by = new Map(
      parseCodexPromptInputSkills(raw, 'C:\\profile\\.codex', 'win32').map((s2) => [s2.name, s2]),
    );
    expect(by.get('mine')?.source).toBe('user');
    expect(by.get('imagegen')?.source).toBe('system');
    expect(by.get('visualize')?.source).toBe('plugin');
    expect(by.get('visualize')?.pluginName).toBe('visualize');
  });

  it('win: 드라이브 문자의 대소문자가 달라도 남의 칸으로 안 떨어진다', () => {
    // 실측으로 걸린 자리 — 종전에는 `user` 가 `plugin` 으로 읽혔다.
    const raw = promptInput(
      ['- `r0` = `c:/profile/.codex/skills`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)'],
    );
    expect(parseCodexPromptInputSkills(raw, 'C:\\profile\\.codex', 'win32')[0]?.source).toBe('user');
  });

  it('mac: 공백 든 홈(`/Users/John Smith`)에서도 선다', () => {
    const raw = promptInput(
      ['- `r0` = `/Users/John Smith/.codex/skills`', '- `r1` = `/Users/John Smith/.codex/skills/.system`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)', '- imagegen: 기본. (file: r1/imagegen/SKILL.md)'],
    );
    const by = new Map(
      parseCodexPromptInputSkills(raw, '/Users/John Smith/.codex', 'darwin').map((s2) => [s2.name, s2]),
    );
    expect(by.get('mine')?.source).toBe('user');
    expect(by.get('imagegen')?.source).toBe('system');
    expect(by.get('mine')?.path).toBe('/Users/John Smith/.codex/skills/mine');
  });

  it('mac: APFS 는 케이스를 안 가린다 — 접어서 본다', () => {
    const raw = promptInput(
      ['- `r0` = `/volumes/profile/.codex/skills`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)'],
    );
    expect(parseCodexPromptInputSkills(raw, '/Volumes/Profile/.codex', 'darwin')[0]?.source).toBe('user');
  });

  it('linux: 케이스는 **접지 않는다** — `Skills` 와 `skills` 는 다른 폴더다', () => {
    const raw = promptInput(
      ['- `r0` = `/srv/profile/.codex/Skills`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)'],
    );
    // 홈 스킬 폴더가 아니므로 `user` 로 읽으면 거짓말이다.
    expect(parseCodexPromptInputSkills(raw, '/srv/profile/.codex', 'linux')[0]?.source).not.toBe('user');
    // 같은 이름이면 당연히 선다.
    const ok = promptInput(
      ['- `r0` = `/srv/profile/.codex/skills`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)'],
    );
    expect(parseCodexPromptInputSkills(ok, '/srv/profile/.codex', 'linux')[0]?.source).toBe('user');
  });

  it('형제 폴더는 홈 스킬이 아니다 — `skills-backup` 이 `skills` 로 시작한다', () => {
    // 실측으로 걸린 자리 — 종전에는 `user` 로 읽혔다.
    const raw = promptInput(
      ['- `r0` = `/srv/profile/.codex/skills-backup`'],
      ['- old: 옛 것. (file: r0/old/SKILL.md)'],
    );
    expect(parseCodexPromptInputSkills(raw, '/srv/profile/.codex', 'linux')[0]?.source).not.toBe('user');
  });

  it('세 OS 모두 스킬의 자리는 `SKILL.md` 가 아니라 그 **폴더**다', () => {
    const raw = promptInput(
      ['- `r0` = `C:/profile/.codex/skills`'],
      ['- mine: 내 것. (file: r0/mine/SKILL.md)'],
    );
    expect(parseCodexPromptInputSkills(raw, 'C:\\profile\\.codex', 'win32')[0]?.path)
      .toBe('C:/profile/.codex/skills/mine');
  });
});
