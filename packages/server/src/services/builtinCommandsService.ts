/**
 * §5.5 #17-2 v3.19 — Claude Code CLI 내장(built-in) 슬래시 명령 레지스트리.
 *
 * 내장 명령(`/clear` `/compact` `/model` …)은 디스크의 `.claude/skills|commands` 가 아니라
 * CLI 바이너리에 하드코딩돼 있어 기존 available-skills 디렉토리 스캔에 잡히지 않는다.
 * §4 v2.41 모델 레지스트리 cli-scan 과 동일한 패턴으로 바이너리를 raw scan 해
 * `{type:"local"|"local-jsx"|"prompt", name:…, description:…}` 명령 객체 리터럴을 추출한다.
 * 0 하드코딩 — 사용자가 CLI 만 업데이트하면 신규/변경 내장 명령이 자동 발견된다.
 *
 * 캐시: `~/.vibisual/builtin-commands.json`. 바이너리 (binPath, size, mtimeMs) 가 그대로면
 * 재스캔 생략(수백 MB 재독 회피) — CLI 가 바뀐 부팅에서만 스캔이 다시 돈다.
 *
 * 콜사이트: `GET /api/available-skills` 응답의 `builtins` 배열(§17-2 `/` 자동완성 전용 —
 * Skills 사이드바(#17-4)는 `skills` 배열만 읽으므로 불변).
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../logger.js';
import { resolveClaudeBin } from './claudeBin.js';

const IS_WIN = process.platform === 'win32';
const PLATFORM_BIN_NAME = IS_WIN ? 'claude.exe' : 'claude';

const CACHE_DIR = path.join(os.homedir(), '.vibisual');
const CACHE_FILE = path.join(CACHE_DIR, 'builtin-commands.json');

/** 내장 명령 정의 시작 마커 — 명령 객체 리터럴은 이 3종 type 으로 시작한다. */
const TYPE_RE = /[,{]type:"(?:local|local-jsx|prompt)",/g;
/** 마커 뒤 이 범위 안에서 name/description/aliases 를 찾는다(minified 코드 내 같은 객체). */
const OBJECT_WINDOW = 700;
/**
 * 명령 객체일 강한 신호 키 — MCP 서버 config 등 `type:"local"` 오탐을 배제한다.
 * (실측: 이 키 중 하나 없이 name+description 만 가진 비명령 객체가 존재)
 */
const COMMAND_KEY_RE = /argumentHint:|aliases:|supportsNonInteractive:|progressMessage:|getPromptForCommand|isEnabled:|thinClientDispatch:|requires:\{ink/;
const NAME_RE = /name:"([a-z][a-z0-9-]*)"/;
const DESC_RE = /description:"((?:[^"\\]|\\.)*)"/;
const ALIASES_RE = /aliases:\[((?:"[a-z0-9-]+",?)*)\]/;

export interface BuiltinCommandInfo {
  name: string;
  description: string;
  aliases: string[];
  /** CLI 가 헤드리스(비인터랙티브) 모드에서도 처리하는 명령인지 (`supportsNonInteractive:!0`). */
  supportsNonInteractive: boolean;
}

interface CachedBuiltins {
  binPath: string;
  size: number;
  mtimeMs: number;
  scannedAt: number;
  commands: BuiltinCommandInfo[];
}

/**
 * 스캔 대상 바이너리 후보 — modelRegistryService.scanClaudeBinaryForModels 와 동일한 3단 폴백.
 * PATH 의 `claude.cmd` 같은 얇은 shim 은 문자열이 없어 0건 → 다음 후보(플랫폼 패키지 본체)로.
 */
function scanCandidates(): string[] {
  const candidates: string[] = [];
  try {
    const bin = resolveClaudeBin();
    if (bin?.binPath && bin.binPath !== 'claude') candidates.push(bin.binPath);
  } catch { /* PATH 미발견 — 다른 후보 시도 */ }

  // (2) 같은 트리 안의 플랫폼 패키지
  for (const cand of [...candidates]) {
    try {
      const dir = path.dirname(cand);
      const platRoot = path.join(dir, '..', 'node_modules', '@anthropic-ai');
      if (fsSync.existsSync(platRoot)) {
        for (const sub of fsSync.readdirSync(platRoot)) {
          if (sub.startsWith('claude-code-') && sub !== 'claude-code') {
            const subBin = path.join(platRoot, sub, PLATFORM_BIN_NAME);
            if (fsSync.existsSync(subBin)) candidates.push(subBin);
          }
        }
      }
    } catch { /* ignore */ }
  }

  // (3) 글로벌 npm root 의 패키지
  try {
    const globalNpm = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
    const platRoot = path.join(globalNpm, 'node_modules', '@anthropic-ai');
    if (fsSync.existsSync(platRoot)) {
      for (const sub of fsSync.readdirSync(platRoot)) {
        if (sub.startsWith('claude-code-')) {
          const subBin = path.join(platRoot, sub, PLATFORM_BIN_NAME);
          if (fsSync.existsSync(subBin) && !candidates.includes(subBin)) candidates.push(subBin);
        }
      }
    }
  } catch { /* ignore */ }

  return candidates;
}

/** 바이너리 원문(latin1)에서 내장 명령 정의 추출. 같은 name 다중 정의 시 nonInteractive 지원 변형 우선. */
function extractCommands(text: string): BuiltinCommandInfo[] {
  const found = new Map<string, BuiltinCommandInfo>();
  let m: RegExpExecArray | null;
  TYPE_RE.lastIndex = 0;
  while ((m = TYPE_RE.exec(text)) !== null) {
    const win = text.slice(m.index, m.index + OBJECT_WINDOW);
    const name = win.match(NAME_RE);
    const desc = win.match(DESC_RE);
    if (!name?.[1] || !desc) continue;
    if (!COMMAND_KEY_RE.test(win)) continue;
    const aliasesM = win.match(ALIASES_RE);
    const aliases = aliasesM?.[1]
      ? aliasesM[1].split(',').filter(Boolean).map((s) => s.replace(/"/g, ''))
      : [];
    const supportsNonInteractive = /supportsNonInteractive:!0/.test(win);
    const prev = found.get(name[1]);
    if (!prev || (!prev.supportsNonInteractive && supportsNonInteractive)) {
      found.set(name[1], {
        name: name[1],
        description: desc[1] ?? '',
        aliases,
        supportsNonInteractive,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

class BuiltinCommandsService {
  private commands: BuiltinCommandInfo[] = [];
  private refreshPromise: Promise<void> | null = null;

  /** 현재 알려진 내장 명령 — refresh 완료 전엔 빈 배열. */
  getCommands(): BuiltinCommandInfo[] {
    return this.commands;
  }

  /** 첫 조회가 부팅 직후 콜드 스캔과 경합해도 빈 목록으로 응답하지 않도록 대기 지점 제공. */
  whenReady(): Promise<void> {
    return this.refreshPromise ?? Promise.resolve();
  }

  /**
   * 부팅 시 1회 호출. 바이너리 (binPath,size,mtimeMs) 가 캐시와 같으면 캐시 사용,
   * 다르면(=CLI 업데이트/교체) 재스캔 후 캐시 갱신. 실패해도 throw 하지 않는다(표시 전용 기능).
   */
  refreshIfStale(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().catch((err) => {
        logger.warn(`[builtinCommands] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const candidates = scanCandidates();
    const cached = await this.loadCache();

    for (const candidate of candidates) {
      let stat: fsSync.Stats;
      try {
        stat = await fs.stat(candidate);
      } catch {
        continue;
      }
      if (
        cached &&
        cached.binPath === candidate &&
        cached.size === stat.size &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.commands.length > 0
      ) {
        this.commands = cached.commands;
        logger.info(`[builtinCommands] cache hit: ${cached.commands.length} commands (${path.basename(candidate)} unchanged)`);
        return;
      }
      try {
        const text = (await fs.readFile(candidate)).toString('latin1');
        const commands = extractCommands(text);
        if (commands.length === 0) continue; // shim/미매칭 — 다음 후보
        this.commands = commands;
        await this.saveCache({
          binPath: candidate,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          scannedAt: Date.now(),
          commands,
        });
        logger.info(`[builtinCommands] cli-scan: ${commands.length} builtin commands from ${path.basename(candidate)}`);
        return;
      } catch (err) {
        logger.warn(`[builtinCommands] scan failed for ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 전 후보 실패 — 낡았더라도 캐시가 있으면 그걸로(빈 목록보단 낫다).
    if (cached && cached.commands.length > 0) {
      this.commands = cached.commands;
      logger.info(`[builtinCommands] all candidates failed — using stale cache (${cached.commands.length} commands)`);
    } else {
      logger.info('[builtinCommands] no claude binary found — builtin command list empty');
    }
  }

  private async loadCache(): Promise<CachedBuiltins | null> {
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as CachedBuiltins;
      if (!parsed?.binPath || !Array.isArray(parsed.commands)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async saveCache(payload: CachedBuiltins): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[builtinCommands] cache save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const builtinCommandsService = new BuiltinCommandsService();
