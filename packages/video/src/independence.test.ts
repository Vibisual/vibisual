import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §5.13 (P) — **독립 규약을 기계가 지킨다.**
 *
 * 이 검사가 없으면 규약은 문서에만 남고 코드는 조용히 새 나간다. 실제로 이 프로젝트에서
 * 앱 하나를 넣었을 뿐인데 코어 6개 파일에 앱 전용 이름이 30곳 박혔고, 아무 검사도
 * 그것을 알려 주지 않았다. 사람이 매번 세는 대신 여기서 센다.
 *
 * 지키는 것 셋:
 *
 * 1. **코어는 앱 이름을 모른다** — 코어 파일에 앱 전용 식별자가 나오면 실패.
 * 2. **앱은 코어를 부르지 않는다** — 앱 패키지가 코어 패키지를 import 하면 실패
 *    (그 순간 서로를 부르는 고리가 생겨 "떼어 낼 수 있다"가 거짓이 된다).
 * 3. **앱은 늦게 실린다** — 코어의 앱 진입점이 정적 import 를 쓰면 실패.
 */

const REPO = path.resolve(__dirname, '../../..');

/** 앱이 코어에 흘리면 안 되는 이름들. 새 앱을 만들면 여기 한 줄 추가한다. */
const APP_SPECIFIC_NAMES = [
  'vibistudio',
  'Vibistudio',
  'VideoStudio',
  'VideoRender',
  'videoOffscreen',
  'mountVideoRoutes',
  'vibisual:video',
];

/**
 * 앱을 몰라야 하는 코어 파일들.
 *
 * 여기 없는 코어 파일에 앱 이름이 들어가도 잡히지 않으므로, 코어에 새 접촉면이
 * 생기면 이 목록도 함께 늘린다.
 */
const CORE_FILES = [
  'packages/desktop/src/main/ipc.ts',
  'packages/desktop/src/main/windowManager.ts',
  'packages/desktop/src/main/index.ts',
  'packages/desktop/src/preload/index.ts',
  'packages/client/src/main.tsx',
  'packages/client/src/transport/install-packaged-transport.ts',
  'packages/client/src/components/Layout/FileMenu.tsx',
  'packages/client/src/components/BubbleMap/BubbleMap.tsx',
  'packages/client/src/components/BubbleMap/CanvasContextMenu.tsx',
  'packages/client/src/components/BubbleMap/AppBubbleNode.tsx',
  'packages/server/src/index.ts',
];

/** 앱을 늦게 부르기로 한 자리 — 여기서 정적 import 를 쓰면 상주 비용이 생긴다. */
const LAZY_ENTRY_POINTS = [
  'packages/server/src/services/appHost.ts',
  'packages/desktop/src/main/apps/index.ts',
];

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO, rel));
}

describe('§5.13 (P) 독립 규약 — 코어는 앱 이름을 모른다', () => {
  for (const rel of CORE_FILES) {
    it(`${rel} 에 앱 전용 이름이 없다`, () => {
      if (!exists(rel)) return; // 파일 구조가 바뀌었으면 다른 테스트가 잡는다.
      const src = read(rel);
      const found = APP_SPECIFIC_NAMES.filter((name) => src.includes(name));
      expect(found, `${rel} 에 앱 전용 이름이 새어 들어갔습니다: ${found.join(', ')}`).toEqual([]);
    });
  }
});

describe('§5.13 (P) 독립 규약 — 앱은 코어를 부르지 않는다', () => {
  /** 이 앱 패키지의 모든 소스. */
  function appSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
      }
    };
    walk(path.join(REPO, 'packages/video/src'));
    return out;
  }

  it('코어 패키지를 import 하지 않는다', () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      const src = fs.readFileSync(file, 'utf8');
      // shared 는 공용 계약이라 허용. client/server/desktop 은 코어라 금지.
      if (/from '@vibisual\/(client|server|desktop)/.test(src)) {
        offenders.push(path.relative(REPO, file));
      }
    }
    expect(offenders, `앱이 코어를 직접 부르고 있습니다: ${offenders.join(', ')}`).toEqual([]);
  });

  it('호스트 계약 파일이 있다 (앱과 코어의 유일한 접촉면)', () => {
    expect(exists('packages/video/src/host.ts')).toBe(true);
  });
});

describe('§5.13 (P) 독립 규약 — 앱은 늦게 실린다', () => {
  for (const rel of LAZY_ENTRY_POINTS) {
    it(`${rel} 은 앱을 정적으로 import 하지 않는다`, () => {
      if (!exists(rel)) return;
      const src = read(rel);
      // 맨 위 `import … from '@vibisual/video…'` 는 금지, `import('@vibisual/video…')` 는 허용.
      const staticImport = /^\s*import\s[^\n]*from\s+'@vibisual\/video/m.test(src);
      expect(staticImport, `${rel} 이 앱을 정적으로 불러 상주 비용을 만듭니다.`).toBe(false);
      expect(src).toMatch(/import\('@vibisual\/video/);
    });
  }
});
