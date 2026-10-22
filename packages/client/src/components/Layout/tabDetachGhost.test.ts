import { describe, it, expect } from 'vitest';

/**
 * §5.4 #14-1 (H) — **탭을 떼어 내는 동안 그림이 앱 경계에서 사라지지 않는다.**
 *
 * 종전에 손에 들린 것은 탭 모양의 DOM 이라, 앱 창 밖으로 나가는 순간 잘려 사라졌다(사용자 보고 —
 * "앱의 경계에서 그림이 사라져서 내 마우스를 따라오지 않는 느낌"). 이제 IDE 창을 밖으로 빼는 길
 * (§5.5 #17-6 (H-6)·(H-17)·(H-19))과 같이, 띠 밖에서는 **곧 설 별창 크기의 선** 하나가 손을 따라오고
 * 그 선은 main 의 클릭통과 창이 앱 밖까지 잇는다. 놓으면 선을 그 자리에 멈추고, 별창이 그 선의
 * 자리·크기 그대로 선다.
 *
 * 여기서 막는 것은 그 약속이 조용히 풀리는 자리들이다 — ⓐ 띠 밖인데 선을 안 켜면 도로 잘린다
 * ⓑ 멈춤보다 `detach` 가 먼저 나가면 main 이 선의 자리를 못 읽는다 ⓒ 거두는 길을 하나라도 빠뜨리면
 * 클릭통과 선이 화면에 남는다(사용자가 없앨 수 없다) ⓓ 탭 고스트와 선이 함께 뜨면 무엇이 진짜인지
 * 알 수 없다 ⓔ 앱 안 선의 그림이 main 의 선과 다르면 넘어가는 순간이 보인다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다 —
 * `tabPointerDrag.test.ts` 가 쓰는 그 방식 그대로다.
 */
const sources = import.meta.glob(
  [
    './TabBar.tsx',
    './TabDetachOutline.tsx',
    '../../apps/AppWindow.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다 — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
const src = (name: string): string => {
  const hit = Object.entries(sources).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`소스를 못 찾았다: ${name}`);
  return hit[1].replace(/\r\n/g, '\n');
};

/** 그 자리의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(s: string, startMarker: string, endMarker: string): string {
  const from = s.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = s.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return s.slice(from, to);
}

const BAR = src('TabBar.tsx');

describe('(H) 띠 밖 = 선 — 켜고 끄는 자리는 한 곳', () => {
  const zone = block(BAR, 'const followDetachZone = useCallback(', '}, [showDetachGhost, hideDetachGhost]);');

  it('드는 순간과 끄는 동안 같은 판정을 탄다(잡은 지점까지 함께 받는다)', () => {
    expect(BAR).toContain('onDragStart: (key, p, grab) => { followDetachZone(key, p, grab); }');
    expect(BAR).toContain('onDragMove: (key, p, grab) => { followDetachZone(key, p, grab); }');
  });

  it('무장 표시와 선이 같은 판정으로 켜지고 꺼진다 — 띠 안으로 돌아오면 선을 거둔다', () => {
    expect(zone).toContain('const armed = canDetachTabs() && p.y >= HEADER_SAFE_HEIGHT;');
    expect(zone).toContain('setDetachHint(armed);');
    expect(zone).toContain('if (armed) showDetachGhost(key, grab);');
    expect(zone).toContain('else hideDetachGhost();');
  });

  it('별창을 못 여는 판(웹·모바일 접속)에서는 "놓으면 별창"을 말하지 않는다', () => {
    const can = block(BAR, 'function canDetachTabs(): boolean {', '\n}');
    expect(can).toContain('!!window.api?.window');
  });
});

describe('(H) 선은 곧 설 별창이다 — 크기·잡은 지점은 shared 한 곳', () => {
  const show = block(BAR, 'const showDetachGhost = useCallback(', '}, [tabMap, t]);');

  it('한 판에 한 번만 세운다(다시 재면 선이 손 아래에서 흔들린다)', () => {
    expect(show).toContain('if (detachGhostRef.current) return;');
  });

  it('크기·잡은 지점은 `detachGhostFrame` 이 정한다 — main 이 별창을 세우는 규칙과 한 벌', () => {
    expect(show).toContain('detachGhostFrame({');
    expect(show).toContain('grab,');
  });

  it('앱 안 선으로 **먼저** 그리고, main 의 선이 그려지면 넘긴다(그 사이 손 아래가 비지 않게)', () => {
    expect(show).toContain("setDetachGhost({ kind: 'inapp'");
    const first = show.indexOf("setDetachGhost({ kind: 'inapp'");
    const ask = show.indexOf('ov.ghostShow(look)');
    expect(first).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(first);
    expect(show).toContain("{ ...cur, kind: 'os' }");
    // 그 사이 선을 거뒀으면(빠른 왕복) 늦게 온 대답이 선을 되살리지 않는다.
    expect(show).toContain('detachGhostRef.current?.seq !== seq');
  });

  it('띠 밖에서는 언제나 무장 — 지금 놓으면 별창이다(밝은 선)', () => {
    expect(show).toContain('const look = { ...frame, label, armed: true, hint };');
  });

  it('오래 머무는 손 아래에서 main 의 수명 그물(20초)이 선을 걷지 않게 알린다', () => {
    expect(show).toContain('WINDOW_PULL_OUT.GHOST_KEEPALIVE_MS');
    expect(show).toContain('window.setInterval(');
  });
});

describe('(H) 놓으면 그 자리 — 멈춤이 별창보다 먼저', () => {
  const commit = block(BAR, 'onCommit: (next, p, key) => {', 'onCancel:');
  const settle = block(BAR, 'const settleDetachGhost = useCallback(', '}, []);');

  it('띠 밖에서 놓았으면 선을 멈추고, 그 결과로 별창을 그 선에 맞춰 세운다', () => {
    expect(commit).toContain('const detaching = canDetachTabs() && p.y >= HEADER_SAFE_HEIGHT;');
    expect(commit).toContain('const fromGhost = detaching && settleDetachGhost(p);');
    expect(commit).toContain('if (detaching) detachTab(key, p.screenX, p.screenY, fromGhost);');
    // 멈춤 부탁이 `detach` 보다 먼저 나가야 main 이 선의 자리를 읽는다(같은 통로라 차례대로 받는다).
    expect(commit.indexOf('settleDetachGhost(p)')).toBeLessThan(commit.indexOf('detachTab('));
  });

  it('빠르게 놓은 손 — main 의 선이 아직 안 그려졌으면 그 선이 설 때까지 앱 안 선이 놓은 자리를 지킨다((H-7) ②)', () => {
    // 그려졌는지는 첫 부탁의 대답이 참일 때만 세운다(늦게 온 대답은 판 번호로 거른 뒤).
    const show = block(BAR, 'const showDetachGhost = useCallback(', '}, [tabMap, t]);');
    expect(show.indexOf('session.painted = true;')).toBeGreaterThan(show.indexOf('detachGhostRef.current?.seq !== seq'));
    // 그려졌으면 곧바로 넘긴다 — 앱 안 선을 세워 둘 까닭이 없다.
    expect(settle).toMatch(/if \(session\.painted\) \{[\s\S]*?return true;/);
    // 안 그려졌으면 놓은 자리(= main 의 선이 멈춘 자리)에 세워 두고, 대답이 오면(참이든 거짓이든) 거둔다.
    expect(settle).toContain('at: { x: at.x - session.frame.grabX, y: at.y - session.frame.grabY }');
    expect(settle).toContain('void settled.then(clear, clear);');
    // 대답이 끝내 안 와도 남지 않게 상한을 건다 — main 의 선 대기 상한(300ms)보다 넉넉히.
    expect(settle).toContain('window.setTimeout(clear, DETACH_SETTLED_OUTLINE_MAX_MS)');
    expect(BAR).toMatch(/const DETACH_SETTLED_OUTLINE_MAX_MS = (\d+);/);
    const cap = Number(/const DETACH_SETTLED_OUTLINE_MAX_MS = (\d+);/.exec(BAR)?.[1]);
    expect(cap).toBeGreaterThan(300);
    // 거둘 때는 자기 판의 선만 — 뒤따른 판의 선을 앞 판의 대답이 지우지 않게.
    expect(settle).toContain('cur?.seq === seq ? null : cur');
  });

  it('그 앱 안 선은 끌기가 끝나도 그려진다 — 손에 든 칸(끌기 중에만 서는 포털)과 따로 선다', () => {
    expect(BAR).toContain('{settledOutline && createPortal(');
    const portal = block(BAR, '{settledOutline && createPortal(', 'document.body');
    expect(portal).toContain('<TabDetachOutline frame={settledOutline.frame} offset={settledOutline.at}');
    expect(portal).toContain('pointer-events-none fixed left-0 top-0');
  });

  it('띠 안에 놓았으면 선을 거둔다', () => {
    expect(commit).toContain('if (!detaching) hideDetachGhost();');
  });

  it('멈춤은 `settled` 로 부탁한다 — 손을 뗀 뒤 선이 커서를 따라가면 창과 어긋난다', () => {
    expect(settle).toContain('settled: true');
    expect(settle).toContain('armed: true');
    // 걷지 않는다 — 선은 main 이 별창이 보인 뒤에 걷는다(여기서 걷으면 놓은 자리가 빈다).
    expect(settle).not.toContain('ghostHide');
  });

  it('`detach` 에 그 사실을 싣는다(선이 있을 때만)', () => {
    const detach = block(BAR, 'const detachTab = useCallback(', '}, [tabMap, tabOrder]);');
    expect(detach).toContain('...(fromGhost ? { fromGhost: true } : {})');
  });
});

describe('(H) 거두는 길을 빠뜨리지 않는다 — 클릭통과 선은 사용자가 없앨 수 없다', () => {
  it('Esc·창 포커스 상실(취소)', () => {
    expect(BAR).toContain('onCancel: () => { setDetachHint(false); hideDetachGhost(); }');
  });

  it('탭바가 내려갈 때 — 떠 있던 선과 멈춘 앱 안 선의 시계까지', () => {
    const unmount = block(BAR, 'useEffect(() => () => {\n    hideDetachGhost();', '}, [hideDetachGhost]);');
    expect(unmount).toContain('window.clearTimeout(settledOutlineTimerRef.current)');
  });

  it('별창이 못 섰을 때 · 그 사이 탭이 사라졌을 때', () => {
    const detach = block(BAR, 'const detachTab = useCallback(', '}, [tabMap, tabOrder]);');
    const ghostHides = detach.match(/if \(fromGhost\) void window\.api\?\.overlay\?\.ghostHide\?\.\(\);/g) ?? [];
    expect(ghostHides).toHaveLength(2);
    expect(block(detach, '.catch((err) => {', '});')).toContain('ghostHide');
  });

  it('거둘 때 유지 시계도 함께 멈춘다(남으면 거둔 선을 되살린다)', () => {
    const hide = block(BAR, 'const hideDetachGhost = useCallback(', '}, []);');
    expect(hide).toContain('window.clearInterval(session.keepAlive)');
    expect(hide).toContain('if (session.requested) void window.api?.overlay?.ghostHide?.();');
  });
});

describe('(H) 손에 든 것은 하나다 — 선이 서면 탭 고스트는 숨는다', () => {
  const portal = block(BAR, 'ref={tabDrag.ghostRef}', 'document.body');

  it('선이 있으면 탭·안내 카드 대신 선(앱 안일 때만), 없으면 탭·안내 카드', () => {
    expect(portal).toContain('{detachGhost ? (');
    expect(portal).toContain("detachGhost.kind === 'inapp' && (");
    expect(portal).toContain('<TabDetachOutline');
    // 탭 고스트는 선이 없을 때의 가지에만 있다.
    expect(portal.indexOf('style={tabDrag.dragSize ?? undefined}')).toBeGreaterThan(portal.indexOf(') : ('));
  });

  it('띠 밖의 옛 연출(호박색 탭 · "여기에 놓으면 별창" 카드)은 걷었다 — 그 말은 이제 선이 한다', () => {
    expect(portal).not.toContain('border-t-amber-400');
    expect(portal).not.toContain('text-amber-200');
  });
});

describe('(H) 앱 안 선은 main 의 선 · IDE · 앱 창의 앱 안 선과 같은 그림이다', () => {
  const outline = src('TabDetachOutline.tsx');
  const app = src('AppWindow.tsx');

  it('이름 띠(34px · 같은 여백·점·글자)', () => {
    const barClass = 'flex h-[34px] items-center gap-1.5 border-b bg-slate-900/55 px-2.5 text-[12px] font-medium text-violet-100/95';
    // 앱 창은 무장 여부로 띠 테두리 색만 바꿔 끼운다 — 나머지 뼈대는 같은 문자열이어야 한다.
    expect(app).toContain(barClass);
    for (const piece of barClass.split(' ')) expect(outline).toContain(piece);
    expect(outline).toContain('border-violet-300/80');
    expect(outline).toContain('h-2 w-2 flex-none rounded-full bg-violet-400/95');
  });

  it('안내 한 줄', () => {
    const hintClass = 'truncate border-b border-violet-400/30 bg-slate-900/40 px-[11px] py-[7px] text-[12px] font-medium leading-[1.35] text-violet-200/90';
    expect(app).toContain(hintClass);
    expect(outline).toContain(hintClass);
  });

  it('무장한 테두리 · 그림자', () => {
    expect(app).toContain("'border-violet-300/95 bg-violet-500/[0.14]'");
    expect(outline).toContain('border-violet-300/95 bg-violet-500/[0.14]');
    const shadow = 'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.55),0_10px_30px_rgba(0,0,0,0.35)]';
    expect(app).toContain(shadow);
    expect(outline).toContain(shadow);
  });

  it('손에 든 칸 안의 오프셋으로 선다 — 화면에서는 `커서 − 선의 잡은 지점`(= main 의 선 자리)', () => {
    expect(outline).toContain('left: Math.round(offset.x)');
    expect(outline).toContain('top: Math.round(offset.y)');
    expect(BAR).toContain('offset: { x: grab.x - frame.grabX, y: grab.y - frame.grabY }');
  });
});
