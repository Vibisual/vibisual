/**
 * §5.5 #17-20 ⑩⑪ v4.94 — 경로 맞춰 보기(순수 함수 · 단위 테스트 대상).
 *
 * 디버거가 주는 경로는 **절대 경로**이고(OS 구분자 그대로), 편집창이 아는 것은 프로젝트 루트
 * 기준 **상대 경로**(`/` 구분자)다. 둘을 맞대는 규칙을 한곳에 모아 둔다 — 이 계산이 화면 두
 * 곳(멈춘 줄 강조 · 오류 줄 클릭해 열기)에서 똑같이 쓰이므로 흩어 두면 언젠가 어긋난다.
 */

/** 윈도우 경로 구분자. 소스에 리터럴로 적으면 이스케이프가 깨지기 쉬워 코드로 만든다. */
const BACKSLASH = String.fromCharCode(92);

/** 구분자를 `/` 로 통일하고 대소문자를 접는다(윈도우는 대소문자를 가리지 않는다). */
export function normalizePathKey(p: string): string {
  return p.split(BACKSLASH).join('/').toLowerCase();
}

/**
 * 디버거가 준 절대 경로가 지금 편집창에 열린 파일과 같은가.
 *
 * `루트 + / + 상대경로` 로 맞춰 보고, 그것이 어긋나면 **꼬리 일치**로 한 번 더 본다 —
 * 심볼릭 링크·워크트리·대소문자 차이로 앞부분이 달라져도 같은 파일인 경우가 흔하기 때문이다.
 */
export function sameWorkspaceFile(absoluteFromDebugger: string, root: string, relPath: string): boolean {
  const a = normalizePathKey(absoluteFromDebugger);
  const expected = normalizePathKey(`${root}/${relPath}`);
  if (a === expected) return true;
  return a.endsWith(`/${normalizePathKey(relPath)}`);
}

/**
 * 출력에서 뽑아낸 경로(상대일 수도, 절대일 수도 있다)를 **프로젝트 루트 기준 상대 경로**로.
 * 루트 밖을 가리키면 null — 열 수 없는 것을 열려고 하지 않는다.
 */
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
