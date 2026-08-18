/**
 * ssot-drift — **이 카드의 REST 창구** (§5.11 자립 규약 ⑥).
 *
 * v4.67 에서 이 세 경로는 호스트 코어(`server/src/services/pluginHost.ts`)에 손으로 붙어 있었다. 동작은
 * 멀쩡했지만 자립 규약이 클라이언트에서만 지켜지는 상태였다 — 이 폴더를 다른 앱에 복사하면 카드·문자열·
 * 집행은 따라가는데 **서버 쪽만 남았다.** 서버 기여 배럴(`server.ts`)이 존재한 이유가 정확히 그것을
 * 막는 것이었는데, 첫 사례부터 배럴을 우회했다.
 *
 * 그래서 경로·응답을 **한 글자도 바꾸지 않고** 자리만 여기로 옮긴다. 프레임워크(express)도 `node:fs` 도
 * 여기 없다 — 호스트가 `PluginServerHost` 로 탐침·원자적 쓰기·캐시 무효화만 건네고, 경로 정규화와
 * 루트 이탈 차단은 호스트가 한 번만 한다(§5.11 "슬롯 경유만").
 */
import type {
  PluginPromptContext,
  PluginRoute,
  PluginRouteResponse,
  PluginServerHost,
} from '../sdk/index.js';
import { readSsotConfig, SSOT_CONFIG_PATH, SSOT_DOC_CANDIDATES, type SsotConfig } from './ssot.js';

export const SSOT_DRIFT_ID = 'ssot-drift';

/** 지정 가능한 경로인가 — 프로젝트 루트 밖·절대경로·`..` 탈출은 받지 않는다. */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.trim() === '') return false;
  const rel = p.trim().replace(/\\/g, '/');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  return !rel.split('/').includes('..');
}

/** 이 폴더의 판정 함수들이 기대하는 맥락 — 파일 접근만 호스트 탐침에서 받는다. */
function ctxOf(host: PluginServerHost, projectPath: string): PluginPromptContext {
  return {
    projectPath,
    cwd: projectPath,
    agentId: '',
    agentLabel: '',
    customCreated: true,
    ...host.probe(projectPath),
  };
}

const readConfig = (host: PluginServerHost, projectPath: string): SsotConfig =>
  readSsotConfig(ctxOf(host, projectPath));

/** 설정 파일 본문 — 사용자가 적어 둔 후보·경쟁 문서는 건드리지 않고 보존한다. */
function configJson(doc: string | null, current: SsotConfig): string {
  const next = {
    ...(doc ? { doc: doc.replace(/\\/g, '/') } : {}),
    ...(current.candidates.length > 0 ? { candidates: current.candidates } : {}),
    ...(current.rivals.length > 0 ? { rivals: current.rivals } : {}),
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}

const noProject: PluginRouteResponse = { status: 400, body: { ok: false, error: 'no project' } };

/**
 * 새 SSOT 문서의 뼈대.
 *
 * **빈 파일을 만들어 주면 안 된다** — 그것이 v4.67 이 고친 문제(빈 문서가 SSOT 로 인정되던 것)를 우리가
 * 직접 만드는 꼴이다. 그래서 절 구조와 `Change Log` 를 함께 넣어 "만들자마자 내용 있음"으로 시작한다.
 */
export function ssotDocTemplate(projectName: string, locale: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (locale.startsWith('ko')) {
    return [
      `# ${projectName} — 기획 SSOT (단일 진실 공급원)`,
      '',
      '> 이 문서가 이 프로젝트의 기획·UX·동작 원칙 정본입니다. 코드와 어긋나면 **이 문서를 먼저** 고칩니다.',
      '',
      '에이전트는 기획이 걸린 작업을 시작하기 전에 이 문서의 관련 절을 읽고, 재설계·교체가 필요하면',
      '먼저 물어봅니다. 그러니 여기에 적힌 것이 곧 그 프로젝트에서 통하는 규칙이 됩니다. 아래 뼈대는',
      '지우고 바꿔도 됩니다 — 절 이름만 남겨 두면 도구가 계속 알아봅니다.',
      '',
      '## 1. 목적',
      '',
      '이 프로젝트가 무엇을 하는 물건인지, 누구를 위한 것인지 한두 문단으로 적습니다.',
      '',
      '## 2. 범위 (Scope)',
      '',
      '- 지금 만들기로 한 것을 한 줄씩 적습니다.',
      '',
      '## 3. Out of Scope',
      '',
      '- 지금은 만들지 않기로 한 것. 여기 적힌 항목은 사용자가 범위에 넣기 전까지 에이전트가 스스로 착수하지 않습니다.',
      '',
      '## 4. 동작 원칙',
      '',
      '- 화면·데이터·상태가 지켜야 하는 규칙을 적습니다.',
      '- 예: 저장은 언제 일어나는가, 실패하면 무엇을 보여 주는가.',
      '',
      '## Change Log',
      '',
      `- ${today} 문서 생성.`,
      '',
    ].join('\n');
  }
  return [
    `# ${projectName} — Spec SSOT (single source of truth)`,
    '',
    '> This document is the source of truth for scope, UX and behaviour. When code and this doc disagree, **fix the doc first**.',
    '',
    'Agents read the relevant section here before starting anything that touches the plan, and they ask',
    'before redesigning or replacing what it describes. So whatever you write here becomes the rule for',
    'this project. Feel free to rewrite the skeleton below — keep the section names and the tooling will',
    'keep recognising it.',
    '',
    '## 1. Purpose',
    '',
    'One or two paragraphs: what this project is and who it is for.',
    '',
    '## 2. Scope',
    '',
    '- One line per thing we decided to build.',
    '',
    '## 3. Out of Scope',
    '',
    '- What we decided not to build. Agents will not start these on their own until you move them into scope.',
    '',
    '## 4. Behaviour rules',
    '',
    '- Rules that screens, data and state must follow.',
    '- For example: when does saving happen, and what shows up when it fails.',
    '',
    '## Change Log',
    '',
    `- ${today} Document created.`,
    '',
  ].join('\n');
}

export const routes: readonly PluginRoute[] = [
  /** 지금 이 프로젝트의 지정 상태 + 집행이 실제로 잰 값. 창이 그대로 그린다. */
  {
    method: 'get',
    path: 'config',
    handle: (req, host) => {
      if (!req.projectPath) return noProject;
      return {
        body: {
          ok: true,
          projectPath: req.projectPath,
          configPath: SSOT_CONFIG_PATH,
          config: readConfig(host, req.projectPath),
          facts: host.facts(req.projectPath, SSOT_DRIFT_ID),
          candidates: SSOT_DOC_CANDIDATES,
        },
      };
    },
  },

  /** 사용자가 고른 문서 경로를 프로젝트에 남긴다. 빈 값을 보내면 지정을 **해제**한다(후보 탐색으로 복귀). */
  {
    method: 'put',
    path: 'config',
    handle: (req, host) => {
      if (!req.projectPath) return noProject;
      const doc = req.body.doc;
      const raw = typeof doc === 'string' ? doc.trim() : '';
      if (raw !== '' && !isSafeRelPath(raw)) {
        return { status: 400, body: { ok: false, error: 'doc must be a path inside the project' } };
      }
      const current = readConfig(host, req.projectPath);
      if (!host.writeProjectFile(req.projectPath, SSOT_CONFIG_PATH, configJson(raw !== '' ? raw : null, current))) {
        host.log('[ssot-drift] config write failed');
        return { status: 500, body: { ok: false, error: 'write failed' } };
      }
      host.invalidate(req.projectPath);
      return {
        body: {
          ok: true,
          config: readConfig(host, req.projectPath),
          facts: host.facts(req.projectPath, SSOT_DRIFT_ID),
        },
      };
    },
  },

  /**
   * 문서가 없는 프로젝트에 **뼈대를 만들어 주고 그것을 지정**한다.
   *
   * 이미 파일이 있으면 덮어쓰지 않는다 — 사용자의 기획서를 우리가 지우는 일은 어떤 경우에도 없어야 한다.
   * 그 경우엔 만들지 않고 지정만 한다(= "기존에 있다면 사용자가 지정" 쪽 경로).
   */
  {
    method: 'post',
    path: 'create-doc',
    handle: (req, host) => {
      if (!req.projectPath) return noProject;
      const asked = req.body.path;
      const rel = typeof asked === 'string' && asked.trim() !== '' ? asked.trim() : 'docs/SSOT.md';
      if (!isSafeRelPath(rel)) {
        return { status: 400, body: { ok: false, error: 'path must be inside the project' } };
      }
      // 화면과 같은 말로 된 문서가 나오게 — 창이 헤더로 언어를 알려 준다(없으면 본문, 그것도 없으면 영어).
      const bodyLocale = req.body.locale;
      const locale = req.locale || (typeof bodyLocale === 'string' ? bodyLocale : 'en');
      const probe = host.probe(req.projectPath);
      const created = !probe.fileExists(rel);
      if (created) {
        const text = ssotDocTemplate(req.projectName ?? 'Project', locale);
        if (!host.writeProjectFile(req.projectPath, rel, text)) {
          host.log('[ssot-drift] doc create failed');
          return { status: 500, body: { ok: false, error: 'write failed' } };
        }
      }
      const current = readConfig(host, req.projectPath);
      if (!host.writeProjectFile(req.projectPath, SSOT_CONFIG_PATH, configJson(rel, current))) {
        host.log('[ssot-drift] config write failed');
        return { status: 500, body: { ok: false, error: 'write failed' } };
      }
      host.invalidate(req.projectPath);
      return {
        body: {
          ok: true,
          created,
          doc: rel,
          config: readConfig(host, req.projectPath),
          facts: host.facts(req.projectPath, SSOT_DRIFT_ID),
        },
      };
    },
  },
];
