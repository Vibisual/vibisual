// §5.4 #36 (C) 연결 강제 — 입력 경로와 무관한 한 곳. 판정은 shared `appToolGate`, 규칙·글은 앱의 `agentLink`. 어떤 실패도 도구를 막지 않는다.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  APP_LINK_GATE,
  findAppToolScriptEvidence,
  readAppToolInvocation,
  scriptLocalImports,
  toNativeDriveShellPath,
  type AppAgentLink,
  type AppBubble,
  type AppLinkTarget,
  type AppToolRule,
  type PlatformName,
} from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';
import { WINDOWS_CHROME_CAPTURE_DENIAL, WINDOWS_CHROME_CAPTURE_RULE } from './windowsChromeCapture.js';

export interface AppLinkCheck {
  agentId: string;
  subAgentId?: string | undefined;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd?: string | null | undefined;
}

export interface AppLinkVerdict {
  /** 있으면 이 호출을 막는다 — 모델이 읽는 사유. */
  deny?: string;
  /** 있으면 이 호출에 곁들이는 안내 한 줄. */
  additionalContext?: string;
}

export interface AppLinkGateDeps {
  linkedNodes(agentId: string): readonly AppBubble[];
  /** 이 sub 가 지금 도는 명령의 앱 범위(없으면 null). */
  commandScope(agentId: string, subAgentId: string): { appNodeIds: readonly string[]; off: boolean } | null;
  // 호스트는 앱마다 다르고 게이트는 그대로 건네기만 한다.
  resolveLink(appId: string): Promise<{ link: AppAgentLink<unknown>; host: unknown } | null>;
  bindRef(nodeId: string, ref: string): boolean;
  warn(message: string): void;
  readText?(file: string): Promise<string | null>;
  platform?: PlatformName;
}

/** 셸이 말한 경로를 디스크 경로로. Windows 의 Git Bash 형식(`/c/work`)은 안 풀면 파일을 못 찾아 판정을 빠져나간다. cwd 를 모르는 상대 경로는 그대로 둔다. */
export function resolveScriptPath(raw: string, cwd: string | null, platform: PlatformName): string {
  const native = platform === 'win32' ? toNativeDriveShellPath(raw) : raw;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (paths.isAbsolute(native)) return paths.normalize(native);
  return cwd ? paths.resolve(platform === 'win32' ? toNativeDriveShellPath(cwd) : cwd, native) : native;
}

async function readCapped(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    return text.length > APP_LINK_GATE.scriptMaxChars ? text.slice(0, APP_LINK_GATE.scriptMaxChars) : text;
  } catch {
    return null;
  }
}

export class AppLinkGate {
  /** 안내를 이미 받은 sub → 노드들. 비영속 — 재시작하면 한 번 더 받을 뿐이다. */
  private readonly pointed = new Map<string, Set<string>>();
  private readonly ensuring = new Map<string, Promise<string | null>>();
  private readonly readText: (file: string) => Promise<string | null>;
  private readonly platform: PlatformName;

  constructor(private readonly deps: AppLinkGateDeps) {
    this.readText = deps.readText ?? readCapped;
    this.platform = deps.platform ?? HOST_PLATFORM;
  }

  private get paths(): typeof path.posix {
    return this.platform === 'win32' ? path.win32 : path.posix;
  }

  async check(q: AppLinkCheck): Promise<AppLinkVerdict> {
    try {
      return await this.judge(q);
    } catch (error) {
      this.deps.warn(`[app-link] gate failed: ${String(error)}`);
      return {};
    }
  }

  private async judge(q: AppLinkCheck): Promise<AppLinkVerdict> {
    if (this.platform === 'win32' && await this.findEvidence(q, WINDOWS_CHROME_CAPTURE_RULE)) {
      return { deny: WINDOWS_CHROME_CAPTURE_DENIAL };
    }
    const nodes = this.deps.linkedNodes(q.agentId);
    if (nodes.length === 0) return {};
    const scope = q.subAgentId ? this.deps.commandScope(q.agentId, q.subAgentId) : null;
    if (scope?.off) return {};
    const chosen = scope && scope.appNodeIds.length > 0 ? nodes.filter((n) => scope.appNodeIds.includes(n.id)) : nodes;

    const active: { link: AppAgentLink<unknown>; target: AppLinkTarget }[] = [];
    for (const node of chosen) {
      const resolved = await this.deps.resolveLink(node.appId);
      if (!resolved) continue;
      active.push({ link: resolved.link, target: { ...(await this.withRef(q.agentId, node, resolved)), projectName: node.projectName } });
    }
    if (active.length === 0) return {};

    for (const { link, target } of active) {
      const evidence = await this.findEvidence(q, link.rule);
      if (evidence) {
        this.markPointed(q.subAgentId, active.map((a) => a.target.id));
        return { deny: link.denyReason(target, evidence) };
      }
    }

    // 말풍선 전송은 브리프가 이미 실렸다(앱 노드가 명령에 박혀 있다) — 같은 말을 두 번 싣지 않는다.
    if (!q.subAgentId || (scope && scope.appNodeIds.length > 0)) return {};
    const seen = this.pointed.get(q.subAgentId);
    const pending = active.filter((a) => !seen?.has(a.target.id));
    if (pending.length === 0) return {};
    this.markPointed(q.subAgentId, pending.map((a) => a.target.id));
    return { additionalContext: pending.map((a) => a.link.pointer(a.target)).join('\n') };
  }

  private async withRef(
    agentId: string,
    node: AppBubble,
    resolved: { link: AppAgentLink<unknown>; host: unknown },
  ): Promise<{ id: string; title?: string | undefined; ref?: string | undefined }> {
    const base = { id: node.id, title: node.title, ref: node.ref };
    if (node.ref) return base;
    // 첫 턴의 병렬 도구 호출이 각자 빈 문서를 만들지 않게 — 기다리는 사이 묶인 문서를 다시 보고, 진행 중인 준비는 함께 기다린다.
    const current = this.deps.linkedNodes(agentId).find((n) => n.id === node.id)?.ref;
    if (current) return { ...base, ref: current };
    let ensuring = this.ensuring.get(node.id);
    if (!ensuring) {
      ensuring = Promise.resolve(resolved.link.ensureRef(resolved.host, node.projectName, base))
        .then((ref) => (ref && this.deps.bindRef(node.id, ref) ? ref : null))
        .catch((error: unknown) => {
          this.deps.warn(`[app-link] ${node.id} document setup failed: ${String(error)}`);
          return null;
        })
        .finally(() => this.ensuring.delete(node.id));
      this.ensuring.set(node.id, ensuring);
    }
    const ref = await ensuring;
    return ref ? { ...base, ref } : base;
  }

  private markPointed(subAgentId: string | undefined, nodeIds: readonly string[]): void {
    if (!subAgentId) return;
    let seen = this.pointed.get(subAgentId);
    if (!seen) {
      seen = new Set();
      this.pointed.set(subAgentId, seen);
      // 키가 세션 수만큼 는다(§3.2.4 F′) — 밀려나도 안내를 한 번 더 받을 뿐이다.
      if (this.pointed.size > APP_LINK_GATE.pointedSessionsMax) {
        const oldest = this.pointed.keys().next().value;
        if (oldest !== undefined) this.pointed.delete(oldest);
      }
    }
    for (const id of nodeIds) seen.add(id);
  }

  private async findEvidence(q: AppLinkCheck, rule: AppToolRule): Promise<string | null> {
    const invocation = readAppToolInvocation(q.toolName, q.toolInput, rule);
    if (invocation.direct) return invocation.direct;
    const cwd = typeof q.cwd === 'string' && q.cwd.trim() ? q.cwd.trim() : null;
    if (invocation.inlineCode) {
      const hit = findAppToolScriptEvidence(String(q.toolInput['command'] ?? ''), rule);
      if (hit) return hit;
    }
    for (const { dir, name } of invocation.packageScripts) {
      const hit = await this.packageScriptEvidence(rule, dir, name, cwd);
      if (hit) return hit;
    }
    return this.scriptEvidence(invocation.scripts.map((s) => resolveScriptPath(s, cwd, this.platform)), rule);
  }

  private async packageScriptEvidence(
    rule: AppToolRule,
    dir: string | null,
    name: string,
    cwd: string | null,
  ): Promise<string | null> {
    const base = dir ? resolveScriptPath(dir, cwd, this.platform) : cwd;
    if (!base) return null;
    const text = await this.readScriptText(this.paths.join(base, 'package.json'), rule);
    if (!text) return null;
    let script: unknown;
    try {
      script = (JSON.parse(text) as { scripts?: Record<string, unknown> }).scripts?.[name];
    } catch {
      return null;
    }
    if (typeof script !== 'string' || script.trim() === '') return null;
    const inner = readAppToolInvocation('Bash', { command: script }, rule);
    if (inner.direct) return inner.direct;
    if (inner.inlineCode) {
      const hit = findAppToolScriptEvidence(script, rule);
      if (hit) return hit;
    }
    return this.scriptEvidence(inner.scripts.map((s) => resolveScriptPath(s, base, this.platform)), rule);
  }

  /** 스크립트와 그 로컬 import 를 넓이 우선으로 — 깊이·파일 수 상한 안에서만(도구 호출을 붙잡는 자리다). */
  private async scriptEvidence(roots: readonly string[], rule: AppToolRule): Promise<string | null> {
    const visited = new Set<string>();
    let found = 0;
    let frontier = [...roots];
    for (let depth = 0; depth <= APP_LINK_GATE.scriptFollowDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const file of frontier) {
        // 표준 라이브러리 import 는 없는 파일 후보로 온다 — 읽기 시도와 찾은 파일을 따로 센다.
        if (visited.has(file) || visited.size >= APP_LINK_GATE.scriptFollowProbes || found >= APP_LINK_GATE.scriptFollowFiles) continue;
        visited.add(file);
        const text = await this.readScriptText(file, rule);
        if (text === null) continue;
        found++;
        const hit = findAppToolScriptEvidence(text, rule);
        if (hit) return hit;
        for (const spec of scriptLocalImports(text, file)) next.push(this.paths.resolve(this.paths.dirname(file), spec));
      }
      frontier = next;
    }
    return null;
  }

  private readScriptText(file: string, rule: AppToolRule): Promise<string | null> {
    if (rule === WINDOWS_CHROME_CAPTURE_RULE && (!this.paths.isAbsolute(file) || file.startsWith('\\\\'))) {
      return Promise.resolve(null);
    }
    return this.readText(file);
  }
}
