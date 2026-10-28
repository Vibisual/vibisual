/** §5.5 #17-20 ⑩⑪ — 디버거 절대 경로(OS 구분자) ↔ 편집창 상대 경로(`/`) 맞대기. 두 화면이 같이 쓰니 한곳에. */

import { foldPathCase } from '../../utils/platform.js';

/** 윈도우 경로 구분자. 소스에 리터럴로 적으면 이스케이프가 깨지기 쉬워 코드로 만든다. */
const BACKSLASH = String.fromCharCode(92);

/**
 * 구분자를 `/` 로 통일하고, 대소문자는 **그 플랫폼이 실제로 무시할 때만** 접는다.
 * Linux 에서 접으면 `App.ts` 와 `app.ts` 가 같은 파일로 읽혀 엉뚱한 파일에 멈춘 줄이 그려진다.
 * 길이를 바꾸지 않는 foldPathCase 를 쓴다 — 아래 toWorkspaceRelative 가 이 결과 길이로 slice 한다.
 */
export function normalizePathKey(p: string): string {
  return foldPathCase(p.split(BACKSLASH).join('/'));
}

/** `루트/상대경로` 로 보고 어긋나면 꼬리 일치로 한 번 더 — 심볼릭 링크·워크트리·대소문자로 앞부분만 다른 같은 파일이 흔하다. */
export function sameWorkspaceFile(absoluteFromDebugger: string, root: string, relPath: string): boolean {
  const a = normalizePathKey(absoluteFromDebugger);
  const expected = normalizePathKey(`${root}/${relPath}`);
  if (a === expected) return true;
  return a.endsWith(`/${normalizePathKey(relPath)}`);
}

/** 출력의 경로(상대·절대) → 루트 기준 상대 경로. 루트 밖이면 null(열 수 없는 것을 열지 않는다). */
export function toWorkspaceRelative(file: string, root: string): string | null {
  const normalizedRoot = normalizePathKey(root).replace(/\/+$/, '');
  const normalizedFile = normalizePathKey(file);
  const cleaned = file.split(BACKSLASH).join('/').replace(/^\.\//, '');

  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return cleaned.slice(normalizedRoot.length + 1);
  }
  // 드라이브 문자나 선행 `/` 가 있으면 절대 경로인데 루트 밖이라는 뜻이다.
  if (/^([a-z]:)?\//i.test(cleaned) && !cleaned.startsWith('./')) {
    return normalizedFile.startsWith(normalizedRoot) ? cleaned.slice(normalizedRoot.length + 1) : null;
  }
  if (cleaned.includes('..')) return null;
  return cleaned;
}
