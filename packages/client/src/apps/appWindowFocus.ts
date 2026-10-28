import { clientPathKey } from '../utils/platform.js';
import type { AppWindowListWire } from '../transport/install-packaged-transport.js';

/**
 * §5.13 (S-11) — 여는 손짓이 앱 안에 세우나, 밖의 그 창을 앞으로 세우나(같은 문서 두 창 ❌ — IDE (H-13)(H-27) 과 같다). 끌어낸 창은 store 에서 빠지므로
 * 여기서 가른다(세우기는 main 의 `focusAppWindow`). 손잡이가 여럿이라 규칙은 이 파일 한 곳 — 순수 함수라 창 없이 시험한다.
 */

/** "같은 창인가"를 가르는 대상 — 앱·프로젝트·열쇠(문서 id)·파일. */
export interface AppWindowTarget {
  readonly appId: string;
  /** 프로젝트 루트 절대 경로(= projectId). */
  readonly projectId: string;
  readonly ref?: string | undefined;
  readonly file?: string | undefined;
  readonly draftKey?: string | undefined;
}

/**
 * 같은 창 = 앱·프로젝트·열쇠·파일이 모두 같다(`title` 은 열쇠가 아니다 — 같은 문서에 창이 두 벌 뜨면 편집이 갈라진다).
 * ⚠ 경로는 `clientPathKey` — `C:\proj`·`C:/proj` 를 그대로 견주면 Windows 에서 두 벌, 소문자로 접으면 Linux 의 `Feature-X`·`feature-x` 가 한 창을 나눠 쓴다.
 */
export function appWindowKey(a: AppWindowTarget): string {
  // `ref` 는 앱이 발급한 식별자(문서 id)라 경로가 아니다 — 접지 않고 그대로 견준다.
  //   JSON 으로 묶는 까닭: 구분자를 문자 하나로 두면 그 문자가 값 안에 들어올 때 두 열쇠가 같아진다.
  return JSON.stringify([
    a.appId,
    clientPathKey(a.projectId),
    a.ref ?? '',
    a.file === undefined || a.file === '' ? '' : clientPathKey(a.file),
    // Existing documents/files keep their established identity; distinct untitled drafts do not.
    !a.ref && !a.file ? a.draftKey ?? '' : '',
  ]);
}

/** 밖에 떠 있는 앱 창 하나 — main 의 목록을 앱 안 창과 **같은 말**(대상)로 옮긴 것. */
export interface OutsideAppWindow extends AppWindowTarget {
  /** main 의 창 id — 세울 때 "본 그 창"인지 main 이 한 번 더 맞춘다. */
  readonly windowId: number;
}

/**
 * main 목록(앱 화면 파라미터)을 대상으로 옮긴다. 문서 열쇠 이름은 앱마다 달라(`docId`·`clipId` …) 모르는 앱·프로젝트 없는 줄은 버린다(견줄 수 없는 것을 "같다"로 ❌).
 * @param refKeyOf 그 앱의 문서 열쇠 이름(레지스트리 `refKey`). 모르는 앱이면 null.
 */
export function outsideAppWindowsFrom(list: AppWindowListWire, refKeyOf: (appId: string) => string | null): OutsideAppWindow[] {
  const out: OutsideAppWindow[] = [];
  for (const item of list) {
    const refKey = refKeyOf(item.appId);
    const projectId = item.params['projectId'];
    if (refKey === null || !projectId) continue;
    const ref = item.params[refKey];
    const file = item.params['file'];
    const draftKey = item.params['draftKey'];
    out.push({
      windowId: item.windowId,
      appId: item.appId,
      projectId,
      ...(ref ? { ref } : {}),
      ...(file ? { file } : {}),
      ...(draftKey ? { draftKey } : {}),
    });
  }
  return out;
}

export type AppWindowDestination =
  | { readonly kind: 'inside' }
  | { readonly kind: 'outside'; readonly appId: string; readonly windowId: number };

/**
 * 앱 안에 같은 창 → 앱 안(앞으로) · 밖에 같은 대상 → 밖(새로 열지 않는다) · 세울 수 없는 판(웹·구버전 preload) → 앱 안.
 * `redock` 은 예외 — 닫히는 밖의 창이 목록에 남아 있어, 빼지 않으면 닫히는 자기 자신을 세우고 앱 안엔 아무것도 서지 않는다(#17-6 (H-13) ④).
 */
export function resolveAppWindowDestination(input: {
  args: AppWindowTarget;
  inside: readonly AppWindowTarget[];
  outside: readonly OutsideAppWindow[];
  redock: boolean;
  canFocusOutside: boolean;
}): AppWindowDestination {
  if (input.redock || !input.canFocusOutside) return { kind: 'inside' };
  const key = appWindowKey(input.args);
  if (input.inside.some((w) => appWindowKey(w) === key)) return { kind: 'inside' };
  const hit = input.outside.find((w) => appWindowKey(w) === key);
  return hit ? { kind: 'outside', appId: hit.appId, windowId: hit.windowId } : { kind: 'inside' };
}
