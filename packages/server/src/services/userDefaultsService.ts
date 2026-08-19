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
import type { UserDefaults } from '@vibisual/shared';
import { logger } from '../logger.js';

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
   * 카테고리 안 필드는 patch 가 명시한 것만 덮어쓴다. `undefined` 로 지운다는 의도면 클라가 명시 send 해야 함.
   *
   * §5.11 v3.88 — `enabledPlugins` 는 **배열 통째 교체**가 의도된 동작이다(스프레드가 그대로 처리).
   * 켜고 끈 결과 전체를 보내는 값이라, 머지하면 "껐다"가 반영되지 않는다.
   *
   * §5.11 v4.54 — `enabledPluginsByProject` 는 **프로젝트 키 단위로 머지**한다. 안쪽 배열은 위와 같은
   * 이유로 통째 교체지만, 맵 자체를 통째 교체하면 **클라가 보낸 한 프로젝트만 남고 나머지 프로젝트의
   * 설정이 전부 사라진다**(창 두 개를 띄워 두면 곧바로 재현된다).
   */
  async update(patch: Partial<UserDefaults>): Promise<UserDefaults> {
    const prev = this.defaults;
    const next: UserDefaults = {
      ...prev,
      ...patch,
      enabledPluginsByProject: patch.enabledPluginsByProject !== undefined
        ? { ...(prev.enabledPluginsByProject ?? {}), ...patch.enabledPluginsByProject }
        : prev.enabledPluginsByProject,
      agentConfig: patch.agentConfig !== undefined ? { ...(prev.agentConfig ?? {}), ...patch.agentConfig } : prev.agentConfig,
      appearance:  patch.appearance  !== undefined ? { ...(prev.appearance  ?? {}), ...patch.appearance  } : prev.appearance,
      notifications: patch.notifications !== undefined ? { ...(prev.notifications ?? {}), ...patch.notifications } : prev.notifications,
      permissions:   patch.permissions   !== undefined ? { ...(prev.permissions   ?? {}), ...patch.permissions   } : prev.permissions,
      advanced:      patch.advanced      !== undefined ? { ...(prev.advanced      ?? {}), ...patch.advanced      } : prev.advanced,
      // §4 (Claude Code CLI 자동 업데이트) — 다른 카테고리와 같은 부분 머지. 미설정 = 켬이라
      // 이 키가 없는 기존 사용자는 앱을 켤 때 CLI 가 최신으로 유지된다.
      claudeAutoUpdate: patch.claudeAutoUpdate !== undefined ? { ...(prev.claudeAutoUpdate ?? {}), ...patch.claudeAutoUpdate } : prev.claudeAutoUpdate,
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
