// SCENARIO.md §5.5 #17-6 (H-10) — 오가는 창의 자리(슬롯)를 누가 언제 놓는가.
// 한 에이전트에 창은 하나고 `agentId → 창` / `windowId → 창` 두 장부가 가리킨다. `win.close()` 뒤 `closed` 가 오기까지 창은 장부에 남고
// `isDestroyed()` 도 거짓이다 — 빠르게 오가면 그 틈에서 ⓐ 닫히는 창을 다시 써 IDE 가 사라지거나 `Object has been destroyed` 가
// 렌더러 `open()` 을 깨고 ⓑ 늦은 `closed` 가 새 창 자리를 지워 뗌 신호(`dragEndFor`)가 닿지 못해 창이 커서를 따라다닌다.
// 그래서 자리를 놓는 규칙을 순수 함수로 모은다(창을 띄우지 않고 확인한다).

/** 장부가 가리키는 창의 지금 형편 — 판정에 필요한 것은 이 둘뿐이다. */
export interface OverlaySlotState {
  /** 이미 `close()` 를 불렀는가(아직 `closed` 는 안 왔을 수 있다). */
  closing: boolean;
  /** 네이티브 창이 실제로 사라졌는가. */
  destroyed: boolean;
}

/**
 * 이 자리를 다시 쓸 수 있는가 — 닫히는 중이거나 죽은 창은 없는 것으로 본다(그래야 `openOverlay` 가 새 창을 세운다).
 * 재사용하면 그 창은 곧 죽고 앱 안 창도 이미 닫혀 어디에도 IDE 가 남지 않는다.
 */
export function isOverlaySlotUsable(entry: OverlaySlotState | null | undefined): boolean {
  if (!entry) return false;
  return !entry.closing && !entry.destroyed;
}

/**
 * 내가 아직 쥐고 있을 때만 자리를 놓는다 — `closed` 는 늦게 와, 그 사이 같은 `agentId` 로 들어선 새 창을 조건 없이 지우면
 * 뗌 신호가 닿지 못해 커서를 계속 따라다닌다.
 * @returns 실제로 놓았는가(내 것이 아니어서 지나갔으면 거짓).
 */
export function releaseSlotIfOwner<K, V>(map: Map<K, V>, key: K, owner: V): boolean {
  if (map.get(key) !== owner) return false;
  map.delete(key);
  return true;
}

/**
 * 이미 서 있는 창을 다시 꺼낼 때 앞으로 세울 것인가.
 * `follow`(매달린 채 나가는 판)에서는 세우지 않는다 — §17-6 (H-4) ⑥ 활성화 순간 OS 가 메인 창의 마우스 캡처를 걷어
 * 눌린 손짓의 나머지(이동·뗌)가 어디에도 닿지 않는다. 손을 뗄 때 `finishOverlayFollow` 가 올린다.
 * (H-25) `settled` 는 손이 이미 떠난 판이라 세운다 — 예열한 창은 이 재사용 갈래로 오므로 새 창 길((H-17) ⑤)과 같은 규칙이어야 한다.
 */
export function overlayReuseActivation(follow: boolean, settled?: boolean): 'inactive' | 'foreground' {
  return follow && !settled ? 'inactive' : 'foreground';
}

// §5.5 #17-6 (H-16) 밖의 그 창을 앞으로 세우기 — (H-13) 이미 밖에 선 IDE 를 앱 안에서 열면 그 창을 세운다. `show()`+`focus()` 만으론 깔린 채 남는다:
//   ⓐ 같은 상시-위 층 안의 앞뒤는 정해지지 않는다 — 층을 다시 박아도 맨 위로 안 온다(`moveTop` 이 한다)
//   ⓑ Windows 는 `show`·`setBounds`·`setResizable` 류 전이가 topmost 를 조용히 푼다(§17-6 (E)) — 세운 뒤에 다시 박는다
//   ⓒ macOS 는 창 `focus()` 로 앱이 앞으로 오지 않는다 — 앱을 함께 깨워야 한다.
// 순서를 순수 함수로 모으고 `platform` 을 인자로 받아 세 OS 를 전부 시험한다.

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
 * `inactive`(§17-6 (H-4) ⑥ 매달린 판)에서는 아무것도 활성화하지 않는다(캡처가 걷혀 눌린 손짓이 사라진다) — 보이기와 층 재단언까지만,
 * 맨 위로 올리기는 손을 뗄 때 `finishOverlayFollow` 가 한다.
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
 * 앞으로 세운 창에 "눌렸다"는 기척을 보낼 것인가 — 앱 안에서 부른 판(`foreground`)에서만.
 * 이미 보이던 창이면 앞으로 와도 화면이 그대로라 창이 한 번 대답해야 손짓과 결과가 이어진다. 매달린 판(`inactive`)에선 보내지 않는다.
 */
export function overlayAttentionOnReuse(activation: 'inactive' | 'foreground'): boolean {
  return activation === 'foreground';
}

// §5.5 #17-6 (E) — 층은 펼침 여부 하나로 갈린다. 버블은 곁눈질하는 위젯이라 늘 위(상시-위), 펼친 IDE 는 화면을 덮는 작업 창이라
// 보통 층이다(위에 박히면 브라우저·탐색기를 옆에서 쓸 수 없다). 갈림을 이 한 곳에 둔다 — 창 상태 전이마다 흩어지면
// 한 곳이 빠뜨려도 띄워 보기 전엔 드러나지 않는다.

/** 창이 서야 할 층. 부르는 쪽은 이 답을 창에 그대로 쓰기만 한다. */
export type OverlayTopMost =
  | { alwaysOnTop: true; level: 'screen-saver' | 'floating' }
  | { alwaysOnTop: false };

/**
 * 이 창은 어느 층에 서는가 — 접힌 버블은 늘 상시-위, 펼친 IDE 는 보통 층이 기본(버블은 여전히 그 위에 뜬다).
 * (H-28) [항상 위에 고정]을 켠 펼친 창(`pinned`)만 `'floating'` 에 선다. `'screen-saver'` 를 쓰지 마라 — Windows 작업표시줄보다 위라
 * 큰 작업 창이 작업표시줄까지 가린다(`'floating'` 은 그 뒤에 선다). 접힌 버블에는 고정이 뜻이 없다(이미 상시-위).
 */
export function overlayTopMostFor(expanded: boolean, pinned = false): OverlayTopMost {
  if (!expanded) return { alwaysOnTop: true, level: 'screen-saver' };
  return pinned ? { alwaysOnTop: true, level: 'floating' } : { alwaysOnTop: false };
}

// §5.5 #17-6 (E-2) — 본체 창을 고르면 펼친 IDE 가 따라 올라온다. 펼친 IDE 는 `skipTaskbar:true` 라 깔리면 되찾을 길이 버블뿐이다.
// 그래서 본체가 포커스를 받으면 펼친 창들을 함께 맨 위로 올린다(포커스는 옮기지 않는다 — 타이핑은 본체로 가야 한다).

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

// §5.5 #17-6 (H-27) — 접힌 버블은 그 창의 렌더가 IDE 로 편다. 앱이 밖의 에이전트를 부르면 그 창을 쓴다(두 벌 ❌).
// 접힌 버블이면 창만 키우지 마라 — 그 창의 가게는 접힌 채라 큰 투명 창 가운데 버블만 그려진다. `open-ide` 를 보내 렌더가 IDE 를 열고,
// 창은 렌더의 미러(`expand-self`)가 편다. 기척은 IDE 일 때만 비추므로 편 뒤에 보낸다.

/** (H-27) ④ 부른 뒤 이 안에 펴져야 "앱이 부른 펼침"으로 읽는다(ms). 늦게 온 펼침은 사용자가 직접 편 것이다. */
export const OVERLAY_EXPAND_ATTENTION_MS = 5000;

/**
 * 재사용 갈래가 이 창을 렌더에게 펴게 할 것인가((H-27) ③) — 접힌 창을 `expanded: true` 로 불렀고 `follow`·`handoff` 가 아닐 때만 참.
 * 끌어 넣기는 커서를 따라 크기가 정해지고 짐은 렌더가 짐 신호로 IDE 를 열어 그 둘은 main 이 편다. 이미 펼친 창은 (H-16) 기척만 받는다.
 */
export function overlayBubbleOpensIde(input: {
  /** 이번 부름이 IDE 로 열어 달라는 것인가. */
  expanded: boolean;
  /** 그 창이 이미 펼쳐져 있는가. */
  wasExpanded: boolean;
  /** 커서를 따라 끌어 넣는 중인가. */
  follow: boolean;
  /** 앱 안의 IDE 짐을 지고 들어오는가. */
  handoff: boolean;
}): boolean {
  return input.expanded && !input.wasExpanded && !input.follow && !input.handoff;
}

/**
 * 이 펼침에 앞세우기와 기척을 한 번 더 줄 것인가((H-27) ④). `stampedAt` 은 재사용 갈래가 `open-ide` 를 보낸 시각.
 * 표식이 없거나 시계가 뒤로 갔거나 늦게 펴졌으면 거짓 — 나중에 직접 편 창을 비추지 않는다.
 */
export function overlayExpandAttentionDue(stampedAt: number | null, now: number): boolean {
  if (stampedAt === null) return false;
  const elapsed = now - stampedAt;
  return elapsed >= 0 && elapsed <= OVERLAY_EXPAND_ATTENTION_MS;
}

/** (H-27) ⑦ 재사용 갈래가 그 창의 렌더에 보내는 [IDE 열기] 한 통. */
export interface OverlayOpenIdeCommand {
  command: 'open-ide';
  /** 그 창에 세울 세션(북마크면 위치까지). 모양은 main 이 모른다 — 받는 렌더가 가린다. */
  focus?: unknown;
}

/**
 * 재사용 갈래가 그 창에 [IDE 열기]를 보낼 것인가, 무엇을 실어서((H-27) ⑦). 없으면 `null`.
 * ① 접힌 버블을 IDE 로 불렀다(`bubbleOpensIde`) ② 이미 IDE 인 창을 세울 세션을 실어 불렀다(북마크 점프·지휘통제실 [이동]·콘티 이력·
 * [창과 버블] 색 줄) — ② 가 없으면 창만 앞으로 오고 고른 세션은 서지 않는다(앱 안에서 세우면 남의 창에 선다).
 * `follow`·`handoff` 는 제 신호가 따로 있어 싣지 않는다.
 */
export function overlayOpenIdeCommand(input: {
  /** `overlayBubbleOpensIde` 의 답. */
  bubbleOpensIde: boolean;
  /** 그 창이 이미 펼쳐져 있는가. */
  wasExpanded: boolean;
  /** 커서를 따라 끌어 넣는 중인가. */
  follow: boolean;
  /** 앱 안의 IDE 짐을 지고 들어오는가. */
  handoff: boolean;
  /** 부르는 쪽이 실어 보낸 세울 세션(없으면 `undefined`·`null`). */
  focus: unknown;
}): OverlayOpenIdeCommand | null {
  const hasFocus = input.focus !== undefined && input.focus !== null;
  if (input.bubbleOpensIde) {
    return hasFocus ? { command: 'open-ide', focus: input.focus } : { command: 'open-ide' };
  }
  if (!hasFocus || !input.wasExpanded || input.follow || input.handoff) return null;
  return { command: 'open-ide', focus: input.focus };
}
