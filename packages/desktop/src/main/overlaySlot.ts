// SCENARIO.md §5.5 #17-6 (H-10) — **오가는 창의 자리(슬롯)를 누가 언제 놓는가.**
//
// 한 에이전트에 창은 하나다. 그 하나를 `agentId → 창` / `windowId → 창` 두 장부가 가리키는데,
// 창을 닫는 일과 장부에서 지우는 일 사이에 **틈**이 있었다: `win.close()` 를 부른 뒤 실제
// `closed` 이벤트가 오기까지 그 창은 여전히 장부에 남아 있고 `isDestroyed()` 도 아직 거짓이다.
//
// 앱 안 ↔ 밖을 천천히 오갈 때는 그 틈이 드러나지 않는다. 빠르게 오가면 그 틈 안에서 다음
// 팝아웃이 일어나 두 가지가 한꺼번에 무너졌다:
//   ⓐ **닫히는 중인 창을 "이미 있는 창"으로 알고 다시 쓴다** — 새 창이 서지 않은 채 그 창이
//      죽으므로 화면에서 IDE 가 통째로 사라지고, 죽는 찰나에 `show()`/`focus()` 가 닿으면
//      `Object has been destroyed` 가 렌더러의 `open()` 약속을 깨뜨린다.
//   ⓑ **늦게 온 `closed` 가 그 사이 들어선 새 창의 자리를 지운다** — 장부에서 사라진 창은
//      손을 뗐다는 신호(`dragEndFor(agentId)`)가 닿지 못해 **영영 커서를 따라다닌다**.
//
// 그래서 자리를 놓는 규칙을 여기 순수 함수로 모은다 — 창을 띄우지 않고 확인할 수 있어야
// 이런 틈이 다음에 또 생기지 않는다.

/** 장부가 가리키는 창의 지금 형편 — 판정에 필요한 것은 이 둘뿐이다. */
export interface OverlaySlotState {
  /** 이미 `close()` 를 불렀는가(아직 `closed` 는 안 왔을 수 있다). */
  closing: boolean;
  /** 네이티브 창이 실제로 사라졌는가. */
  destroyed: boolean;
}

/**
 * 이 자리를 **다시 쓸 수 있는가** — 닫히는 중이거나 이미 죽은 창은 *없는 것*으로 본다.
 *
 * 없는 것으로 봐야 `openOverlay` 가 새 창을 세운다. 재사용하면 그 창은 곧 죽고, 그때 앱 안
 * 창은 이미 닫힌 뒤라 어느 쪽에도 IDE 가 남지 않는다.
 */
export function isOverlaySlotUsable(entry: OverlaySlotState | null | undefined): boolean {
  if (!entry) return false;
  return !entry.closing && !entry.destroyed;
}

/**
 * **내가 아직 쥐고 있을 때만** 자리를 놓는다.
 *
 * `closed` 는 늦게 온다. 그 사이에 같은 `agentId` 로 새 창이 들어섰다면 장부의 그 칸은 이미
 * 남의 것이다 — 조건 없이 지우면 살아 있는 창이 장부에서 사라진다(= 뗌 신호가 닿지 못해
 * 커서를 계속 따라다니는 창).
 *
 * @returns 실제로 놓았는가(내 것이 아니어서 그냥 지나갔으면 거짓).
 */
export function releaseSlotIfOwner<K, V>(map: Map<K, V>, key: K, owner: V): boolean {
  if (map.get(key) !== owner) return false;
  map.delete(key);
  return true;
}

/**
 * 이미 서 있는 창을 **다시 꺼낼 때** 앞으로 세울 것인가.
 *
 * `follow`(커서에 매달린 채 나가는 판)에서는 세우면 안 된다 — §17-6 (H-4) ⑥ 대로, 새 창이
 * 활성화되는 순간 OS 가 메인 창의 마우스 캡처를 걷어 **아직 눌려 있는 그 손짓의 나머지가
 * 어디에도 도착하지 않는다**(이동·뗌을 아무도 못 듣는다 = 창이 커서에 달라붙은 채 남는다).
 * 손을 뗄 때 `finishOverlayFollow` 가 앞으로 올린다.
 *
 * §17-6 (H-25) — **`settled` 는 그 손이 이미 떠난 판이다.** 걷어 갈 캡처가 없으므로 뒤에 세울
 * 이유가 없고, 방금 놓은 창이 뒤에 뜨면 "놓았는데 안 보인다"가 된다((H-17) ⑤ 가 **새 창** 길에서
 * 이미 정한 그대로 — 예열해 둔 창은 그 길 대신 이 재사용 갈래로 오므로 같은 규칙이 여기에도
 * 있어야 한다. 갈림이 두 곳에 있으면 한쪽만 고쳐지는 날이 온다).
 */
export function overlayReuseActivation(follow: boolean, settled?: boolean): 'inactive' | 'foreground' {
  return follow && !settled ? 'inactive' : 'foreground';
}

// ─── §5.5 #17-6 (H-16) 밖의 그 창을 **앞으로 세우기** ──────────────────────────
//
// (H-13) 이 정한 대로, 앱 안에서 IDE 를 여는 손짓은 그 IDE 가 이미 밖에 서 있으면 **그 창을 앞으로
// 세우는 것**으로 끝난다. 그런데 세우는 손짓이 `show()` + `focus()` 둘뿐이라, 다른 프로그램 뒤에
// 깔린 창이 그대로 깔려 있는 경우가 있었다(사용자 보고). 까닭은 셋으로 갈린다.
//
//   ⓐ 이 창은 상시-위(`screen-saver`)지만 **같은 층에 다른 창이 있으면 그 안에서의 앞뒤는 정해지지
//      않는다** — 층을 다시 박는 것만으로는 맨 위로 오지 않는다(`moveTop` 이 그 일을 한다).
//   ⓑ Windows 에선 `show`·`setBounds`·`setResizable` 류 상태 전이가 topmost 를 조용히 푼다
//      (§17-6 (E) v2.80 이 이미 겪은 회귀) — 그래서 세운 **뒤에** 다시 박아야 한다.
//   ⓒ macOS 는 창 하나를 `focus()` 해도 **앱이 앞으로 오지 않는다** — 앱 활성화가 창 포커스와
//      별개의 일이라, 앱을 함께 깨우지 않으면 창은 자기 앱 안에서만 맨 위가 된다.
//
// 그래서 "무엇을 어떤 순서로 밟는가"를 여기 순수 함수로 모은다. `platform` 을 인자로 받으므로
// Windows 개발기에서 세 OS 의 순서를 전부 시험할 수 있다(멀티플랫폼 규약 — 실기가 없는 우리에겐
// 이것이 분기를 확인하는 유일한 방법이다).

/** 앞세우기가 밟는 손짓 하나. 부르는 쪽은 이 목록을 순서대로 실행하기만 한다. */
export type OverlayRaiseStep =
  /** 최소화되어 있으면 먼저 되살린다(최소화된 창은 자리도 Z 순서도 뜻이 없다). */
  | 'restore'
  /** 보이기만 한다 — **활성화하지 않는다**(매달린 손짓을 지키는 길). */
  | 'showInactive'
  /** 보이면서 활성화한다. */
  | 'show'
  /** (mac) 앱 자체를 앞으로 — 창만 포커스하면 앱은 여전히 뒤에 있다. */
  | 'activateApp'
  /** 키보드 포커스를 이 창에. */
  | 'focus'
  /** **그 창의 층** 다시 박기 — 전이가 조용히 풀어 놓은 것을 되돌린다(접힘=상시-위·펼침=보통 층, (E) 개정). */
  | 'reassertTop'
  /** 같은 층 안에서 맨 위로 — 층을 박는 것과 별개의 일이다. */
  | 'moveTop';

/**
 * 이미 서 있는 창을 앞으로 세울 때 밟을 순서.
 *
 * `inactive`(§17-6 (H-4) ⑥ 매달린 채 나가는 판)에서는 **아무것도 활성화하지 않는다** — 그 순간
 * OS 가 메인 창의 마우스 캡처를 걷어 아직 눌려 있는 손짓의 나머지가 어디에도 도착하지 않는다.
 * 그 판에서는 보이기와 층 재단언까지만 하고 멈춘다(맨 위로 올리는 일조차 하지 않는다 — 손을
 * 뗄 때 `finishOverlayFollow` 가 한다).
 */
export function overlayRaiseSteps(input: {
  platform: NodeJS.Platform;
  activation: 'inactive' | 'foreground';
  minimized: boolean;
}): OverlayRaiseStep[] {
  const steps: OverlayRaiseStep[] = [];
  if (input.minimized) steps.push('restore');
  if (input.activation === 'inactive') {
    steps.push('showInactive', 'reassertTop');
    return steps;
  }
  steps.push('show');
  // ⓒ mac 은 앱 활성화가 따로다 — 창 포커스보다 **먼저** 앱을 깨워야 그 포커스가 화면에 반영된다.
  if (input.platform === 'darwin') steps.push('activateApp');
  steps.push('focus');
  // ⓑ 여기까지가 전부 상태 전이다 — 그것들이 풀어 놓았을 층을 다시 박고, ⓐ 그 층 안에서 맨 위로.
  steps.push('reassertTop', 'moveTop');
  return steps;
}

/**
 * 앞으로 세운 그 창에 **"눌렸다"는 기척**을 보낼 것인가.
 *
 * 사용자가 앱 안에서 그 창을 부른 판(`foreground`)에서만 보낸다. 창이 앞으로 오는 것만으로는
 * "내 더블클릭이 저 창에 닿았다"가 읽히지 않아(이미 보이고 있던 창이면 화면이 그대로다),
 * 그 창이 한 번 대답해야 손짓과 결과가 이어진다. 매달린 판(`inactive`)에서는 보내지 않는다 —
 * 그때 사용자가 보고 있는 것은 커서를 따라오는 창이지 기척이 아니다.
 */
export function overlayAttentionOnReuse(activation: 'inactive' | 'foreground'): boolean {
  return activation === 'foreground';
}

// ─── §5.5 #17-6 (E) 개정 — 층은 **펼침 여부** 하나로 갈린다 ────────────────────
//
// 오버레이의 본질은 "어떤 프로그램이 선택돼 있든 위에 떠 있는 것"(사용자 정의)인데, 그 본질이
// 붙는 것은 **버블**이다. 버블은 옆에 두고 곁눈질하는 위젯이라 늘 보여야 하지만, 펼친 IDE 는
// 화면을 크게 덮는 **작업 창**이다 — 그것까지 위에 박혀 있으면 브라우저·탐색기를 그 옆에서 쓸
// 수가 없다(사용자 지시). 그래서 접힘은 상시-위, 펼침은 보통 층으로 갈린다.
//
// 갈림을 여기 한 곳에 두는 까닭은 (E) v2.80 이 이미 겪었다 — 층을 박는 자리가 창 상태 전이마다
// 흩어져 있어서, 한 곳이 규칙을 빠뜨려도 그 창을 띄워 보기 전에는 드러나지 않는다.

/** 창이 서야 할 층. 부르는 쪽은 이 답을 창에 그대로 쓰기만 한다. */
export type OverlayTopMost =
  | { alwaysOnTop: true; level: 'screen-saver' }
  | { alwaysOnTop: false };

/**
 * 이 창은 어느 층에 서는가 — **접힌 버블만 상시-위**다.
 *
 * 펼친 IDE 를 보통 층으로 내려도 버블은 여전히 그 위에 뜬다(상시-위 층이 보통 층보다 위라서
 * 둘 사이를 따로 조율할 것이 없다) — 사용자가 말한 "오버레이 버블을 빼곤"이 그대로 성립한다.
 */
export function overlayTopMostFor(expanded: boolean): OverlayTopMost {
  return expanded ? { alwaysOnTop: false } : { alwaysOnTop: true, level: 'screen-saver' };
}

// ─── §5.5 #17-6 (E-2) — 본체 창을 고르면 펼친 IDE 가 따라 올라온다 ──────────────
//
// 상시-위를 뺀 대가로 펼친 IDE 는 다른 앱 뒤에 깔릴 수 있는데, 이 창은 `skipTaskbar:true` 라
// **작업표시줄에도 없다** — 깔리면 되돌릴 길이 캔버스로 돌아가 그 버블을 다시 부르는 것뿐이다.
// 그래서 본체 창이 포커스를 받는 순간 펼친 창들을 함께 맨 위로 올린다(포커스는 옮기지 않는다 —
// 사용자가 고른 것은 본체 창이므로 타이핑은 거기로 가야 한다).

/** 본체 창이 포커스를 받았을 때 **이 창을 따라 올릴 것인가.** */
export function overlayFollowsMainFocus(input: {
  /** 펼친 IDE 인가(접힌 버블은 이미 위층이라 할 일이 없다). */
  expanded: boolean;
  /** 지금 화면에 있는가(전역 토글·"이 버블만 숨기기"로 감춘 창을 되살리지 않는다). */
  visible: boolean;
  /** 최소화되어 있는가(올린다고 복원되지 않으며, 복원은 사용자가 할 일이다). */
  minimized: boolean;
  /** 이미 닫으라고 말한 창인가((H-10) — `close()` 와 `closed` 사이의 틈). */
  closing: boolean;
  /** 네이티브 창이 이미 사라졌는가. */
  destroyed: boolean;
  /** 아직 태어나지 않은 예열 창인가((H-25) ② — 어느 길로도 보이지 않는다). */
  warming: boolean;
}): boolean {
  if (input.destroyed || input.closing || input.warming) return false;
  if (!input.expanded) return false;
  return input.visible && !input.minimized;
}
