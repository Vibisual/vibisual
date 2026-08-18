/**
 * §5.13 (O) v4.48 — 앱 창 판별.
 *
 * 부팅 경로가 앱 코드를 끌어오지 않도록 **판별만** 여기 둔다(화면은 레지스트리의
 * 로더가 늦게 불러온다). 앱이 늘어도 이 파일은 그대로다 — 앱 이름을 모르기 때문이다.
 */

export interface AppHash {
  readonly appId: string;
  /** 어떤 화면인가. 기본 `main`. */
  readonly mode: string;
  /** 앱이 해석하는 나머지 값들(projectId·docId·크기 등). */
  readonly params: Record<string, string>;
}

/** `#app=<id>&mode=<mode>&…` 파싱. 아니면 null. */
export function parseAppHash(hash: string): AppHash | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const appId = params.get('app');
  if (!appId) return null;

  const rest: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key === 'app' || key === 'mode') continue;
    rest[key] = value;
  }
  return { appId, mode: params.get('mode') ?? 'main', params: rest };
}
