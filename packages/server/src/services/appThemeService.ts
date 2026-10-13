/**
 * §4 앱 테마 — 사용자 테마 폴더(`~/.vibisual/themes/*.json`)를 읽고, 데스크톱 창에 칠할 색을 낸다.
 *
 * 왜 서버에 있나: 테마 파일은 사용자 디스크의 입력이고(렌더러는 디스크를 못 읽는다), 창 바탕·제목줄
 * 버튼은 desktop main 이 칠한다. 둘 다 **같은 해석**(shared `resolveAppTheme`)을 거쳐야 창 바탕과 화면이
 * 같은 테마가 된다 — 그래서 고른 id(`UserDefaults.appearance.themeId`)와 사용자 테마 목록이 만나는
 * 자리를 여기 한 곳에 둔다.
 *
 * 영속화: 고른 테마는 `user-defaults.json`(기존 설정 창 저장소) 하나뿐이다. 이 서비스는 **아무것도
 * 저장하지 않는다** — 테마 폴더는 사용자가 넣는 입력이고, 우리가 쓰는 것은 [지금 테마로 새로 만들기]가
 * 만드는 견본 파일뿐이다(원자적 쓰기 · 같은 폴더 rename).
 *
 * 경로: `os.homedir()` 아래 `.vibisual` — 설정 창 저장소(`user-defaults.json`)·앱 상태와 같은 뿌리라
 * 세 OS 에서 같은 자리다. 파일 이름은 그대로 쓰고 접지 않는다(Linux 는 대소문자를 가른다) — 같은 id 가
 * 둘이면 뒤의 것을 `duplicateId` 로 알린다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  APP_THEME_LIMITS,
  appThemeChrome,
  appThemeSlug,
  buildAppThemeTemplate,
  customAppThemeId,
  normalizeAppThemeDefinition,
  resolveAppTheme,
  type AppThemeCatalog,
  type AppThemeChrome,
  type AppThemeDefinition,
  type AppThemeIssue,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { userDefaultsService } from './userDefaultsService.js';

/** 사용자 테마 폴더 — 테스트는 임시 폴더를 넘긴다(실제 홈을 건드리지 않게). */
export function defaultAppThemesDir(home: string = os.homedir()): string {
  return path.join(home, '.vibisual', 'themes');
}

/** 확장자는 대소문자를 가리지 않는다(`Theme.JSON` 도 테마다) — 경로 키가 아니라 파일 종류 판정이다. */
const isThemeFileName = (name: string): boolean => name.toLowerCase().endsWith('.json');

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * 폴더 하나를 읽어 목록을 만든다. 폴더가 없으면 **빈 목록이 정상**이다(아직 아무것도 넣지 않았다).
 * 파일마다 따로 실패한다 — 한 파일이 깨져도 나머지 테마는 그대로 쓴다.
 */
export function scanAppThemesDir(dir: string, now: number = Date.now()): AppThemeCatalog {
  const themes: AppThemeDefinition[] = [];
  const issues: AppThemeIssue[] = [];
  const folderLabel = path.basename(dir);

  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && isThemeFileName(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') {
      issues.push({ file: folderLabel, level: 'error', code: 'readFailed' });
      logger.warn(`[appTheme] themes folder read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { dir, themes, issues, scannedAt: now };
  }

  if (names.length > APP_THEME_LIMITS.maxFiles) {
    issues.push({ file: folderLabel, level: 'warning', code: 'tooMany', detail: String(names.length) });
    names = names.slice(0, APP_THEME_LIMITS.maxFiles);
  }

  const seen = new Set<string>();
  for (const name of names) {
    const full = path.join(dir, name);
    let text: string;
    try {
      const size = fs.statSync(full).size;
      if (size > APP_THEME_LIMITS.maxFileBytes) {
        issues.push({ file: name, level: 'error', code: 'tooLarge', detail: String(size) });
        continue;
      }
      text = fs.readFileSync(full, 'utf8');
    } catch {
      issues.push({ file: name, level: 'error', code: 'readFailed' });
      continue;
    }

    let raw: unknown;
    try {
      // 메모장 등이 붙이는 BOM 은 JSON 이 아니다 — 떼고 읽는다.
      raw = JSON.parse(text.replace(/^﻿/, ''));
    } catch (err) {
      issues.push({
        file: name,
        level: 'error',
        code: 'invalidJson',
        ...(err instanceof Error ? { detail: err.message.slice(0, APP_THEME_LIMITS.maxIssueDetailLength) } : {}),
      });
      continue;
    }

    const { theme, issues: found } = normalizeAppThemeDefinition(raw, { file: name, fallbackId: name.replace(/\.json$/i, '') });
    issues.push(...found);
    if (!theme) continue;
    if (seen.has(theme.id)) {
      issues.push({ file: name, level: 'error', code: 'duplicateId', detail: theme.id });
      continue;
    }
    seen.add(theme.id);
    themes.push(theme);
  }

  // 해석해야만 드러나는 문제(없는 출발점·순환)도 같은 목록에 싣는다 — 옵션창이 한 곳에서 보여 준다.
  for (const t of themes) issues.push(...resolveAppTheme(t.id, themes).issues);
  themes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { dir, themes, issues, scannedAt: now };
}

/** 내용이 같은가(읽은 시각은 빼고) — 같으면 다시 알리지 않는다. */
function fingerprint(c: AppThemeCatalog): string {
  return JSON.stringify({ dir: c.dir, themes: c.themes, issues: c.issues });
}

export class AppThemeService {
  private readonly dir: string;
  private catalog: AppThemeCatalog | null = null;
  private readonly listeners = new Set<(c: AppThemeCatalog) => void>();

  constructor(dir: string) {
    this.dir = dir;
  }

  getDir(): string {
    return this.dir;
  }

  /** 마지막으로 읽은 목록. 아직 안 읽었으면 지금 읽는다(창 생성 전에 불려도 답이 있게 — 동기). */
  list(): AppThemeCatalog {
    return this.catalog ?? this.rescan();
  }

  /** 폴더를 다시 읽는다. 내용이 달라졌을 때만 구독자에게 알린다. */
  rescan(): AppThemeCatalog {
    const prev = this.catalog;
    const next = scanAppThemesDir(this.dir);
    this.catalog = next;
    if (prev && fingerprint(prev) !== fingerprint(next)) this.emit(next);
    return next;
  }

  /** 폴더를 만든다(이미 있으면 그대로). [폴더 열기]가 빈 폴더라도 열 수 있게. */
  ensureDir(): string {
    fs.mkdirSync(this.dir, { recursive: true });
    return this.dir;
  }

  /**
   * [지금 테마로 새로 만들기] — `baseId` 테마를 잇는 견본 파일을 쓰고 목록을 다시 읽는다.
   * 이름이 겹치면 `-2`, `-3` … 을 붙인다(남의 파일을 덮지 않는다).
   */
  createFromTheme(baseId: string | undefined, name: string): { id: string; file: string } {
    const catalog = this.list();
    const base = resolveAppTheme(baseId, catalog.themes);
    // 뒤에 붙일 `-NN` 자리를 남겨 두어 정규화(`appThemeSlug` 의 길이 상한)가 id 를 다시 자르지 않게 한다.
    const stem = appThemeSlug(name).slice(0, APP_THEME_LIMITS.maxIdLength - 4).replace(/-+$/g, '') || 'theme';
    this.ensureDir();
    const taken = (slug: string): boolean =>
      catalog.themes.some((t) => t.id === customAppThemeId(slug))
      || fs.existsSync(path.join(this.dir, `${slug}.json`));
    let slug = stem;
    for (let n = 2; taken(slug); n++) {
      if (n > 999) throw new Error('no free theme file name');
      slug = `${stem}-${n}`;
    }
    const file = `${slug}.json`;
    const target = path.join(this.dir, file);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(buildAppThemeTemplate(base, { slug, name }), null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    this.rescan();
    return { id: customAppThemeId(slug), file };
  }

  subscribe(fn: (c: AppThemeCatalog) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: AppThemeCatalog): void {
    for (const fn of this.listeners) {
      try { fn(c); } catch (err) { logger.error('[appTheme] listener error', err); }
    }
  }
}

export const appThemeService = new AppThemeService(defaultAppThemesDir());

/** 지금 고른 테마의 창 색 — 고른 id 는 설정 창 저장소, 사용자 테마는 이 서비스의 목록에서. */
export function currentAppThemeChrome(): AppThemeChrome {
  const themeId = userDefaultsService.get().appearance?.themeId;
  return appThemeChrome(resolveAppTheme(themeId, appThemeService.list().themes));
}

/**
 * 창 색이 **실제로 바뀔 때만** 알린다 — 고른 테마가 바뀌었거나, 고른 사용자 테마 파일이 다시 읽혀
 * 색이 달라졌을 때. 다른 설정을 저장할 때마다 창 바탕을 다시 칠하지 않는다.
 */
export function subscribeAppThemeChrome(cb: (chrome: AppThemeChrome) => void): () => void {
  let last = JSON.stringify(currentAppThemeChrome());
  const check = (): void => {
    let next: AppThemeChrome;
    try {
      next = currentAppThemeChrome();
    } catch (err) {
      logger.warn(`[appTheme] chrome resolve failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    cb(next);
  };
  const offDefaults = userDefaultsService.subscribe(check);
  const offThemes = appThemeService.subscribe(check);
  return () => {
    offDefaults();
    offThemes();
  };
}
