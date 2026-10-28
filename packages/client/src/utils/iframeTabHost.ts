/**
 * §5.23 「더블클릭」 · §7.11 — 이 창에 iframe 탭 줄이 있는가.
 * iframe 탭은 창마다 따로 든 스토어 목록이고 탭 줄을 그리는 것은 본체 창의 `App` 하나뿐이다 — 별창·오버레이·지휘통제실·내부 앱 창에서 열면
 * 보이지 않는 탭이 생긴다. 그래서 탭으로 열려는 쪽은 먼저 이 표식을 본다(없으면 바깥 브라우저로 연다).
 * 창 해시를 해석해 판정하지 않는다 — 해석기는 셸 컴포넌트와 함께 살아 캔버스와 셸이 서로를 끌어온다. 탭 줄을 그리는 쪽이 마운트될 때 스스로 세운다.
 */
let hosts = 0;

/** 탭 줄을 그리는 셸이 마운트될 때 부른다. 돌려받은 함수로 내린다(StrictMode 의 두 번 마운트에도 셈이 맞는다). */
export function registerIframeTabHost(): () => void {
  hosts += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hosts = Math.max(0, hosts - 1);
  };
}

/** 이 창이 iframe 탭을 보여 줄 수 있는가. */
export function hasIframeTabHost(): boolean {
  return hosts > 0;
}
