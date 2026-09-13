/**
 * Claude Code **설정 홈 목록** — §3.6 훅 설치처와 §5.7 #24 세션 스캔이 **함께** 보는 한 곳.
 *
 * ## 왜 목록인가
 *
 * 우리는 오랫동안 설정 홈이 `~/.claude` 하나라고 가정했다. 훅은 거기 깔았고, 살아 있는 세션도
 * 거기 `sessions/<PID>.json` 만 읽었다. VS Code 진입점 세션에는 그게 맞다.
 *
 * Cowork(Claude Desktop 로컬 세션)는 **같은 코어로 돌면서 설정 홈만 세션마다 따로 잡는다**.
 * 그래서 우리 훅은 한 번도 발화하지 않았고(anthropics/claude-code#63360 "not planned",
 * 근본 원인 #40495), 세션 목록에도 뜬 적이 없다 — 두 증상의 원인이 **하나**다.
 * 설정 홈을 목록으로 바꾸면 두 구멍이 같이 메워진다.
 *
 * ## 두 갈래가 이 목록을 어떻게 쓰나
 *
 * - **훅 설치**(`hookInstaller.ensureClaudeHooksInstalled`): 목록의 각 홈에 같은 블록을 심는다.
 * - **세션 스캔**(`sessionDiscovery.scanSessionLiveness`): 각 홈의 `sessions/*.json` 을 읽고,
 *   **어느 홈에서 읽었는지**로 진입점을 정한다(`entrypointFromConfigHome` — Cowork 의
 *   `entrypoint` 문자열을 추측하지 않기 위함).
 *
 * ## 멀티플랫폼
 *
 * 경로 규약(win `%APPDATA%` · mac `~/Library/Application Support` · linux `~/.config`)은
 * shared 의 순수 함수가 **플랫폼을 인자로 받아** 계산한다. 이 파일은 `HOST_PLATFORM` 을 물려
 * 감싸기만 한다 — 세 OS 판정의 단위 테스트는 그 순수 함수에 붙는다(실기가 없는 우리가 규칙을
 * 지켰는지 확인하는 유일한 방법).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  COWORK_HOME_CACHE_MS,
  COWORK_HOME_SCAN_MAX,
  coworkConfigHome,
  coworkSessionRootDirs,
  isCoworkSessionDirName,
} from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';

/** 설정 홈 하나 — `…/.claude` 디렉터리와 그 출처. */
export interface ClaudeConfigHome {
  /** 설정 홈 디렉터리. `settings.json`·`sessions/`·`projects/` 가 이 아래 산다. */
  dir: string;
  /**
   * 어디서 온 홈인가. **Cowork 판정의 근거**라 세션 스캔이 이 값을 그대로 진입점으로 쓴다
   * (`entrypointFromConfigHome`) — 파일에 적힌 `entrypoint` 문자열을 추측하지 않기 위함.
   */
  source: 'host' | 'cowork';
  /** cowork 일 때 그 세션 디렉터리(`…/<sessionId>`). 훅 주입·cwd 계산이 쓴다. */
  sessionDir?: string;
  /** 최근순 정렬 키 — 오래된 Cowork 세션을 상한 밖으로 밀어내는 축. */
  mtimeMs: number;
}

/** 호스트 설정 홈 — 종전부터 우리가 쓰던 그 자리. 항상 목록의 첫 칸이다. */
export function hostConfigHome(): ClaudeConfigHome {
  return { dir: path.join(os.homedir(), '.claude'), source: 'host', mtimeMs: 0 };
}

/** 캐시 — 디렉터리 3겹 열거를 세션 스캔 주기(10초)마다 다시 하지 않기 위함. */
let coworkCache: { at: number; homes: ClaudeConfigHome[] } | null = null;

/** 테스트에서 캐시를 비운다(다음 호출이 디스크를 다시 읽게). */
export function __resetCoworkHomeCacheForTest(): void {
  coworkCache = null;
}

/** 디렉터리의 하위 디렉터리 이름들. 없거나 못 읽으면 빈 배열(조용히) — 설치 안 된 기계가 정상이다. */
function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 디렉터리 mtime. 못 읽으면 0(가장 오래된 것으로 취급해 상한에서 먼저 밀려난다). */
function dirMtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 살아 있는 Cowork 세션 홈들 — **최근 것부터 `COWORK_HOME_SCAN_MAX` 개까지**.
 *
 * 열거는 `<root>/<orgId>/<userId>/<sessionId>` 로 **깊이를 못 박는다**(`COWORK_SESSION_DEPTH`).
 * 그 아래에는 세션마다 `.claude/projects/…` 가 통째로 들어 있어, "적당히 재귀" 하면 사용자
 * 기계에서 수만 개 디렉터리를 훑게 된다.
 *
 * 세션 디렉터리 판정은 **이름(uuid 꼴)** 으로 한다. `.claude` 존재를 조건에 넣지 않는 이유는
 * 갓 생긴 세션에는 아직 그 폴더가 없을 수 있고, **훅은 CLI 가 읽기 전에 심어야 발화**하기
 * 때문이다 — 있는 것만 상대하면 언제나 한 세션씩 늦는다.
 */
export function listCoworkConfigHomes(now: number = Date.now()): ClaudeConfigHome[] {
  if (coworkCache && now - coworkCache.at < COWORK_HOME_CACHE_MS) return coworkCache.homes;

  const homes: ClaudeConfigHome[] = [];
  for (const root of coworkSessionRootDirs(HOST_PLATFORM, process.env)) {
    for (const orgId of subdirs(root)) {
      const orgDir = path.join(root, orgId);
      for (const userId of subdirs(orgDir)) {
        const userDir = path.join(orgDir, userId);
        for (const name of subdirs(userDir)) {
          if (!isCoworkSessionDirName(name)) continue;
          const sessionDir = path.join(userDir, name);
          homes.push({
            dir: coworkConfigHome(sessionDir),
            source: 'cowork',
            sessionDir,
            mtimeMs: dirMtime(sessionDir),
          });
        }
      }
    }
  }

  // 최근 것부터 — 오래된 세션은 이미 끝난 대화라 훅을 깔아도 발화하지 않는다.
  homes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const capped = homes.slice(0, COWORK_HOME_SCAN_MAX);
  coworkCache = { at: now, homes: capped };
  return capped;
}

/**
 * 우리가 다루는 **모든** 설정 홈 — 호스트 하나 + Cowork 세션 홈들.
 *
 * 호스트가 언제나 첫 칸이다. 훅 설치가 이 순서로 돌므로, Cowork 쪽 열거가 느리거나 실패해도
 * 호스트 설치(= 종전 동작 전부)는 이미 끝나 있다.
 */
export function listClaudeConfigHomes(now: number = Date.now()): ClaudeConfigHome[] {
  return [hostConfigHome(), ...listCoworkConfigHomes(now)];
}
