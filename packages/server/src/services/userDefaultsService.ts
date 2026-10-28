/**
 * §4 — 사용자 전역 옵션(Options 창의 SSOT), `~/.vibisual/user-defaults.json` 한 파일(체크포인트 무관).
 * §5.11 — 플러그인 켬/끔만 프로젝트별(`enabledPluginsByProject`) — 파일을 쪼개지 않고 키 한 겹으로 가른다.
 * 쓰는 곳: `ProjectGraph.createCustomAgent` · `GET`/`PUT /api/user-defaults` · WS `user_defaults_updated`.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UserDefaults, UserDefaultsPatch } from '@vibisual/shared';
import { AGENT_TOOLS_BACKFILL_GEN, backfillAgentTools, providerForEngine, resolveBubbleSkin, resolveBubbleEdgeStyle } from '@vibisual/shared';
import { logger } from '../logger.js';

/** §4 (설정 3층) — 부분 머지, **`null` 은 그 키를 지운다** — `undefined` 는 `JSON.stringify` 가 버려 서버에 안 닿는다. */
function mergeCategory<T extends object>(
  prev: T | undefined,
  patch: { [K in keyof T]?: T[K] | null } | undefined,
): T | undefined {
  if (patch === undefined) return prev;
  const next: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as T;
}

/** Only known canvas paint IDs are normalized; theme, language and future siblings survive. */
function sanitizeAppearance(value: unknown): UserDefaults['appearance'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const next = { ...value } as NonNullable<UserDefaults['appearance']>;
  if ('bubbleSkin' in next) {
    if (next.bubbleSkin == null) delete next.bubbleSkin;
    else next.bubbleSkin = resolveBubbleSkin(next.bubbleSkin);
  }
  if ('edgeStyle' in next) {
    if (next.edgeStyle == null) delete next.edgeStyle;
    else next.edgeStyle = resolveBubbleEdgeStyle(next.edgeStyle);
  }
  return next;
}

function mergeAppearance(prev: UserDefaults['appearance'], patch: UserDefaultsPatch['appearance']): UserDefaults['appearance'] {
  // An invalid category must not replace existing theme/language settings.
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return prev;
  return sanitizeAppearance(mergeCategory(prev, patch));
}

/** §4 (설정 3층) — **도구 목록을 명시한 저장에만** 세대 도장을 찍는다 — 없으면 백필이 방금 끈 도구를 되살리고, 목록 없는 저장에 찍으면 옛 프리셋이 백필 없이 굳는다. */
function stampToolsGen(
  merged: UserDefaults['agentConfig'],
  patch: UserDefaultsPatch['agentConfig'],
): UserDefaults['agentConfig'] {
  if (!merged || !Array.isArray(patch?.tools)) return merged;
  return { ...merged, toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN };
}

const STORE_DIR = path.join(os.homedir(), '.vibisual');
const STORE_FILE = path.join(STORE_DIR, 'user-defaults.json');

class UserDefaultsService {
  private defaults: UserDefaults;
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(d: UserDefaults) => void>();

  constructor() {
    this.defaults = this.loadSync();
  }

  private loadSync(): UserDefaults {
    try {
      if (fsSync.existsSync(STORE_FILE)) {
        const raw = fsSync.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as UserDefaults;
        if (parsed && typeof parsed === 'object') {
          // §4 — `executionMode` 는 전역 기본이 아니다(우클릭 CMD 전용) — 옛 저장분에 있으면 새 에이전트가 전부 CMD 로 생겨 로드 때 지운다.
          if (parsed.agentConfig && 'executionMode' in parsed.agentConfig) {
            delete (parsed.agentConfig as { executionMode?: unknown }).executionMode;
          }
          // §4 (설정 3층) — 전역 프리셋도 같은 도구 백필을 받는다(새 에이전트의 씨앗이라 빠지면 옛 목록이 상한 — 실측 11/48).
          //   디스크엔 다음 `update()` 때 적는다 — 부팅만으로 홈에 쓰지 않는다(시험이 사용자 파일을 안 건드리게).
          if (parsed.agentConfig) parsed.agentConfig = backfillAgentTools(parsed.agentConfig);
          // Normalize explicit choices in memory only. Missing fields retain resolver defaults;
          // loading/restarting never writes new preferences to the user's settings file.
          if (parsed.appearance !== undefined) parsed.appearance = sanitizeAppearance(parsed.appearance);
          logger.info(`[userDefaults] loaded from ${STORE_FILE}`);
          return { ...parsed, updatedAt: parsed.updatedAt ?? Date.now() };
        }
      }
    } catch (err) {
      logger.warn(`[userDefaults] load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { updatedAt: Date.now() };
  }

  get(): UserDefaults {
    return this.defaults;
  }

  /**
   * 부분 머지 — 카테고리 안은 patch 가 명시한 필드만 덮고, 지우려면 `null`. §5.11 — `enabledPlugins` 는 배열 통째 교체(머지하면 "껐다"가 안 먹는다).
   * `enabledPluginsByProject` 는 **프로젝트 키 단위 머지** — 통째 바꾸면 보낸 한 프로젝트만 남는다.
   */
  update(patch: UserDefaultsPatch): Promise<UserDefaults> {
    const write = this.writes.then(() => this.updateNow(patch));
    this.writes = write.catch(() => {});
    return write;
  }

  private async updateNow(patch: UserDefaultsPatch): Promise<UserDefaults> {
    const prev = this.defaults;
    const next: UserDefaults = {
      ...prev,
      ...(patch as Partial<UserDefaults>),
      enabledPluginsByProject: patch.enabledPluginsByProject !== undefined
        ? { ...(prev.enabledPluginsByProject ?? {}), ...patch.enabledPluginsByProject }
        : prev.enabledPluginsByProject,
      // §4 (설정 3층) — 목록을 새로 저장하면 **그 자리에서 세대 도장을 찍는다.** 안 찍으면
      //   다음 부팅의 백필이 "고를 기회가 없어서 빠진 것"으로 오인해 방금 끈 도구를 되살린다
      //   (에이전트 오버라이드에서 `sparsifyAgentConfig` 가 하는 것과 같은 규칙).
      agentConfig: stampToolsGen(mergeCategory(prev.agentConfig, patch.agentConfig), patch.agentConfig),
      appearance:  mergeAppearance(prev.appearance, patch.appearance),
      notifications: mergeCategory(prev.notifications, patch.notifications),
      permissions:   mergeCategory(prev.permissions,   patch.permissions),
      advanced:      mergeCategory(prev.advanced,      patch.advanced),
      // §4 (Claude Code CLI 자동 업데이트) — 다른 카테고리와 같은 부분 머지. 미설정 = 켬이라
      // 이 키가 없는 기존 사용자는 앱을 켤 때 CLI 가 최신으로 유지된다.
      claudeAutoUpdate: mergeCategory(prev.claudeAutoUpdate, patch.claudeAutoUpdate),
      // §4 (앱 전용 엔진) — 코덱스 앱 전용 사본의 자동 업데이트 스위치. 같은 부분 머지 · 미설정 = 켬.
      codexAutoUpdate: mergeCategory(prev.codexAutoUpdate, patch.codexAutoUpdate),
      updatedAt: Math.max(Date.now(), (prev.updatedAt ?? 0) + 1),
    };
    const oldEngine = prev.engineChoice?.kind ?? 'claude';
    const newEngine = next.engineChoice?.kind ?? 'claude';
    next.engineConfigs = { ...prev.engineConfigs, [oldEngine]: prev.agentConfig, ...patch.engineConfigs };
    next.projectEngineConfigs = { ...prev.projectEngineConfigs };
    for (const [project, configs] of Object.entries(patch.projectEngineConfigs ?? {})) {
      next.projectEngineConfigs[project] = { ...prev.projectEngineConfigs?.[project], ...configs };
    }
    if (oldEngine !== newEngine) {
      next.agentConfig = { ...next.engineConfigs[newEngine], provider: next.engineConfigs[newEngine]?.provider ?? providerForEngine(newEngine) };
      if (newEngine === 'claude') delete next.agentConfig.provider;
    } else if (patch.engineConfigs?.[newEngine]) {
      next.agentConfig = { ...patch.engineConfigs[newEngine] };
    }
    next.engineConfigs[newEngine] = next.agentConfig;
    this.defaults = next;
    try { await this.save(); } catch (error) { this.defaults = prev; throw error; }
    this.emit();
    return next;
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(STORE_DIR, { recursive: true });
      const tmp = STORE_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.defaults, null, 2), 'utf-8');
      await fs.rename(tmp, STORE_FILE);
    } catch (err) {
      logger.warn(`[userDefaults] save failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  subscribe(fn: (d: UserDefaults) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try { fn(this.defaults); } catch (err) { logger.error('[userDefaults] listener error', err); }
    }
  }
}

export const userDefaultsService = new UserDefaultsService();
