// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 다음 스플래시가 첫 칠에 쓸 **표시 캐시**(userData/splash.json).
//
// 스플래시는 서버 코어가 읽히기 **전에** 뜬다. 그때는 UI 언어(프로젝트 체크포인트)도 테마(설정 창 저장값)도 아직 모른다.
// 그래서 본체 창이 보인 순간·테마가 바뀐 순간·앱이 끝날 때 그 값을 여기 적어 두고, 다음 실행의 스플래시가 읽는다.
// 권위는 늘 원래 자리다 — 이 파일이 깨지거나 없으면 OS 언어·기본 바탕으로 뜰 뿐이다(오류 ❌, §3.2.1-5 와 같은 태도).
// 프로젝트 데이터가 아니라 앱 인스턴스의 표시 값이라 userData 에 둔다(§3.7 "desktop 은 앱 인스턴스 설정만 userData").
//
// 읽기는 시작 진입점이 하므로 서버 코어를 부르지 않는다. 쓰기는 본체가 서버의 원자적 쓰기(`atomicWriteFileSync`)를
// 넣어 준다 — 새 쓰기 레일을 만들지 않는다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { parseSplashCache, serializeSplashCache, SPLASH_CACHE_FILE, type SplashCache } from './splashPolicy';

export function splashCachePath(): string {
  return join(app.getPath('userData'), SPLASH_CACHE_FILE);
}

/** 없거나 깨졌으면 `null`. */
export function readSplashCache(path: string = splashCachePath()): SplashCache | null {
  try {
    return parseSplashCache(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

let lastWritten: string | null = null;

/**
 * 바뀐 것이 있을 때만 쓴다(같은 값으로 디스크를 두드리지 않는다). 쓰기 실패는 표시 캐시라 조용히 넘긴다.
 * @returns 실제로 썼는가.
 */
export function writeSplashCache(
  cache: SplashCache,
  write: (filePath: string, data: string) => void,
  path: string = splashCachePath(),
): boolean {
  const text = serializeSplashCache(cache);
  if (text === lastWritten) return false;
  if (lastWritten === null) {
    try {
      if (readFileSync(path, 'utf8') === text) {
        lastWritten = text;
        return false;
      }
    } catch { /* 아직 없다 — 쓴다 */ }
  }
  try {
    write(path, text);
    lastWritten = text;
    return true;
  } catch (err) {
    console.warn('[splash] could not save the display cache:', err);
    return false;
  }
}
