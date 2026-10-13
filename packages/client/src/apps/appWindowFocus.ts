import { clientPathKey } from '../utils/platform.js';
import type { AppWindowListWire } from '../transport/install-packaged-transport.js';

/**
 * §5.13 (S-11) — 앱을 여는 손짓이 **어디로 가는가**(앱 안에 세우나 · 밖에 이미 떠 있는 그 창을 앞으로 세우나).
 *
 * §5.5 #17-6 (H-13)(H-27) 의 IDE 창과 같은 규율이다 — 같은 문서를 두 창에 띄우면 어느 쪽이 진짜인지 알 수 없다.
 * 앱 안 창끼리는 store 가 이미 막는다(같은 것을 또 열면 앞으로 올 뿐). 그런데 밖으로 끌어낸 창은 앱 안 store 에서
 * 빠지므로, 그 문서를 캔버스에서 다시 열면 앱 안에 **같은 편집기가 한 벌 더** 섰다. 이제 그 손짓은 밖의 그 창을
 * 앞으로 세우는 것으로 끝난다(세우기·기척은 main 이 한다 — `focusAppWindow`).
 *
 * 갈림의 규칙은 이 파일 한 곳이 쥔다 — 여는 손잡이가 여럿이라(노드 더블클릭·우클릭 [열기]·상세 패널·파일 클릭)
 * 손잡이마다 두면 다음에 늘어나는 손잡이가 또 두 벌을 만든다. 순수 함수라 창 없이 시험한다.
 */

/** "같은 창인가"를 가르는 대상 — 앱·프로젝트·열쇠(문서 id)·파일. */
export interface AppWindowTarget {
  readonly appId: string;
  /** 프로젝트 루트 절대 경로(= projectId). */
  readonly projectId: string;
  readonly ref?: string | undefined;
  readonly file?: string | undefined;
}

/**
 * 같은 것을 가리키는 창인가 — 앱·프로젝트·열쇠·파일이 모두 같으면 같은 창이다.
 *
 * 버블 이름(`title`)은 열쇠가 아니다. 이름만 다른 버블 둘이 같은 문서를 가리킬 수 있고, 그때
 * 창이 두 벌 뜨면 편집이 갈라진다.
 *
 * ⚠ 경로는 `clientPathKey` 로 접는다(멀티플랫폼 규약 ① 경로키). 같은 파일이 부르는 자리에 따라
 * `C:\proj` 와 `C:/proj` 로 오는데 그대로 견주면 Windows 에서 창이 두 벌 뜬다. **소문자로 접지**
 * **않는다** — Linux 는 `Feature-X` 와 `feature-x` 가 다른 파일이라, 접으면 서로 다른 두 파일이
 * 한 창을 나눠 쓴다(그 판정은 `clientPathKey` 안에 있다).
 */
export function appWindowKey(a: AppWindowTarget): string {
  // `ref` 는 앱이 발급한 식별자(문서 id)라 경로가 아니다 — 접지 않고 그대로 견준다.
  //   JSON 으로 묶는 까닭: 구분자를 문자 하나로 두면 그 문자가 값 안에 들어올 때 두 열쇠가 같아진다.
  return JSON.stringify([
    a.appId,
    clientPathKey(a.projectId),
    a.ref ?? '',
    a.file === undefined || a.file === '' ? '' : clientPathKey(a.file),
  ]);
}

/** 밖에 떠 있는 앱 창 하나 — main 의 목록을 앱 안 창과 **같은 말**(대상)로 옮긴 것. */
export interface OutsideAppWindow extends AppWindowTarget {
  /** main 의 창 id — 세울 때 "본 그 창"인지 main 이 한 번 더 맞춘다. */
  readonly windowId: number;
}

/**
 * main 의 목록(앱 화면 파라미터)을 대상으로 옮긴다. 문서 열쇠의 이름은 앱마다 다르다(`docId`·`clipId` …) — 모르는
 * 앱이거나 프로젝트가 없는 줄은 버린다(견줄 수 없는 것을 "같다"로 읽지 않는다).
 *
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
    out.push({
      windowId: item.windowId,
      appId: item.appId,
      projectId,
      ...(ref ? { ref } : {}),
      ...(file ? { file } : {}),
    });
  }
  return out;
}

export type AppWindowDestination =
  | { readonly kind: 'inside' }
  | { readonly kind: 'outside'; readonly appId: string; readonly windowId: number };

/**
 * 여는 손짓의 행선지.
 *
 * - **앱 안에 같은 창이 이미 있으면 앱 안**이다 — store 가 그 창을 앞으로 올린다(종전 그대로).
 * - **밖에 같은 대상의 창이 떠 있으면 밖**이다 — 그 창을 앞으로 세운다(새로 열지 않는다).
 * - **되돌아오는 길(`redock`)은 예외** — 밖의 창을 앱 안으로 들이는 중이라 그 창은 닫히는 중인데 목록에는 아직 남아
 *   있다. 표시가 없으면 되돌리기가 닫히는 자기 자신을 앞으로 세우고 앱 안에는 아무것도 서지 않는다(#17-6 (H-13) ④).
 * - 밖의 창을 세울 수 없는 판(웹·구버전 preload)이면 종전대로 앱 안이다.
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
