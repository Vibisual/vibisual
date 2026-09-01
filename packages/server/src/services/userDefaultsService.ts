/**
 * §4 v2.42 — 사용자 글로벌 옵션 (Options 창의 SSOT).
 *
 * `~/.vibisual/user-defaults.json` 단일 파일에 영속화. ProjectCheckpoint 미관여(별도 글로벌 파일).
 *
 * 대부분의 값은 프로젝트 무관(여러 프로젝트가 같은 디폴트 공유)이지만, **§5.11 v4.54 플러그인 켬/끔은
 * 프로젝트별**(`enabledPluginsByProject`: 프로젝트 절대경로 → id 목록)이다. 저장 파일을 쪼개지 않고
 * 키 한 겹으로만 가른다 — 새 저장소·새 WS·체크포인트 4지점을 만들지 않기 위해서다.
 *
 * 콜사이트:
 * - `ProjectGraph.createCustomAgent` — 신규 에이전트의 `agentConfigs[agentId]` 초기값 머지
 * - REST `GET /api/user-defaults` — 클라 OptionsWindow 마운트 시 페치
 * - REST `PUT /api/user-defaults` — Apply 시 부분 머지 저장 + WS broadcast
 * - WS `user_defaults_updated` — 변경 즉시 다른 창에도 반영
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UserDefaults, UserDefaultsPatch } from '@vibisual/shared';
import { AGENT_TOOLS_BACKFILL_GEN, backfillAgentTools } from '@vibisual/shared';
import { logger } from '../logger.js';

/**
 * §4 (설정 3층) — 카테고리 안을 부분 머지하되 **`null` 은 "그 키를 지운다"** 로 읽는다.
 *
 * 설정 창은 미설정을 `undefined` 로 담았고 `JSON.stringify` 가 그 키를 버렸기 때문에, 서버에는
 * "비웠다"가 도착한 적이 없었다 — 그래서 전역 기본값은 한 번 켜면 창에서 끌 수 없었다.
 * `null` 은 전선을 건너므로 그 뜻을 실어 나를 수 있고, 저장분에는 남지 않는다.
 */
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

/**
 * §4 (설정 3층) — 이번 저장이 **도구 목록을 명시했으면** 현행 세대 도장을 함께 찍는다.
 *
 * 도장은 "이 목록은 지금 화면에서 직접 고른 것"이라는 표식이라, 없으면 다음 부팅의 백필이
 * 사용자가 방금 해제한 도구를 되살린다. 목록을 안 보낸 저장은 건드리지 않는다 — 그때 찍으면
 * 아직 백필을 못 받은 옛 프리셋이 채워지지도 않은 채 "이미 받았다"로 굳는다.
 */
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
          // §4 v2.63 — 레거시 토글 잔재 정리: executionMode 는 더는 글로벌 디폴트가 아니다(우클릭 CMD 전용).
          //   예전 Options 토글이 agentConfig.executionMode 를 저장해 두면 새 커스텀 에이전트가 전부 CMD 로
          //   생성되던 회귀를 차단 — 로드 시 1회 제거하고 다음 save 때 디스크에서도 사라진다.
          if (parsed.agentConfig && 'executionMode' in parsed.agentConfig) {
            delete (parsed.agentConfig as { executionMode?: unknown }).executionMode;
          }
          // §4 (설정 3층) — 전역 프리셋의 도구 목록도 **에이전트 설정과 같은 백필**을 받는다.
          //   여기서만 빠져 있었고, 그 목록이 곧 신규 에이전트의 씨앗이라 판올림 전에 골라 둔
          //   목록이 앞으로 만들 모든 에이전트의 상한이 됐다(실측 11/48 — 씨앗에는 현행 세대
          //   도장이 함께 찍혀 어느 복원에서도 회복되지 않았다).
          //   디스크에는 다음 `update()` 때 함께 적힌다 — 부팅만으로 홈 디렉터리에 쓰지 않는다
          //   (테스트가 실제 사용자 파일을 건드리지 않게 하는 규율).
          if (parsed.agentConfig) parsed.agentConfig = backfillAgentTools(parsed.agentConfig);
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
   * 부분 머지 저장 — top-level 카테고리(agentConfig/appearance/...) 마다 합치되,
   * 카테고리 안 필드는 patch 가 명시한 것만 덮어쓴다. **지우려면 `null` 을 보낸다**
   * (`undefined` 는 `JSON.stringify` 가 키째 버려 서버에 도착하지 않는다 — §4 설정 3층).
   *
   * §5.11 v3.88 — `enabledPlugins` 는 **배열 통째 교체**가 의도된 동작이다(스프레드가 그대로 처리).
   * 켜고 끈 결과 전체를 보내는 값이라, 머지하면 "껐다"가 반영되지 않는다.
   *
   * §5.11 v4.54 — `enabledPluginsByProject` 는 **프로젝트 키 단위로 머지**한다. 안쪽 배열은 위와 같은
   * 이유로 통째 교체지만, 맵 자체를 통째 교체하면 **클라가 보낸 한 프로젝트만 남고 나머지 프로젝트의
   * 설정이 전부 사라진다**(창 두 개를 띄워 두면 곧바로 재현된다).
   */
  async update(patch: UserDefaultsPatch): Promise<UserDefaults> {
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
      appearance:  mergeCategory(prev.appearance,  patch.appearance),
      notifications: mergeCategory(prev.notifications, patch.notifications),
      permissions:   mergeCategory(prev.permissions,   patch.permissions),
      advanced:      mergeCategory(prev.advanced,      patch.advanced),
      // §4 (Claude Code CLI 자동 업데이트) — 다른 카테고리와 같은 부분 머지. 미설정 = 켬이라
      // 이 키가 없는 기존 사용자는 앱을 켤 때 CLI 가 최신으로 유지된다.
      claudeAutoUpdate: mergeCategory(prev.claudeAutoUpdate, patch.claudeAutoUpdate),
      updatedAt: Date.now(),
    };
    this.defaults = next;
    await this.save();
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
