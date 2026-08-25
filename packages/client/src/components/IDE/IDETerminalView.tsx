import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useGraphStore } from '../../stores/graphStore.js';
import { TerminalCardSniffer, type TerminalCard } from './terminalCardSniffer.js';
import { IDETerminalCardRail } from './IDETerminalCardRail.js';
import { getTerminalTransport } from '../../transport/terminalTransport.js';
import { TerminalStateTracker } from './terminalStateSniffer.js';
import {
  cmdPaneTermId,
  clampTerminalScrollback,
  CMD_STATE_TICK_MS,
  CMD_PROCESS_POLL_MS,
  CMD_PANE_MAX,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  type CmdTerminalState,
} from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { openWebSearch } from './webSearchUrl.js';

// §4 v2.63 — 임베디드 인터랙티브 터미널 뷰. (편의성 보강 v2.65)
//
// `AgentConfig.executionMode === 'interactive-terminal'` 인 커스텀 에이전트의 IDE 메인 영역에
// 기존 채팅 스트림 대신 이 xterm.js 터미널이 렌더된다(IDEMainArea 분기). 더블클릭 → 셸+claude
// prefill PTY(desktop main terminalManager)에 붙어 사용자가 직접 모는 인터랙티브 세션.
//
// 터미널 I/O 는 graphStore/WS 가 아니라 transport(§4 v3.33)로 흐른다: 데스크톱 = shell-state 전용
// IPC(`window.api.terminal.*`), 모바일 웹 접속(§4 v3.16) = `/ws` 브리지(LAN 한정, 외부 접속은 차단).
// 둘 다 없는 환경에서만 안내 폴백을 표시한다.
//
// v2.65 편의성: ① 프로젝트 톤 완전 ANSI 팔레트 테마, ② 복사/붙여넣기(우클릭 메뉴 + Ctrl+C/V·
// Ctrl+Shift+C/V), ③ Ctrl+F 인앱 검색, ④ 출력 속 URL 클릭, ⑤ Ctrl +/-/0 폰트 확대·축소(localStorage 보존).

interface IDETerminalViewProps {
  agentId: string;
  /** 세션(탭) id — null = 메인 탭. 탭마다 독립 PTY(termId=term:agentId:session)로 "+"=새 cmd 터미널. */
  sessionId: string | null;
  /**
   * §4 (CMD ⑤) — 이 뷰가 그리는 pane. 단일 pane 은 `'0'`(= termId 에 접미사 없음, 종전과 동일).
   * 분할 시 `term:<agentId>:<session>#<paneId>` 로 **PTY 가 pane 마다 따로** 뜬다.
   */
  paneId?: string;
  /** §4 (⑤) — 이 pane 을 좌우/상하로 쪼갠다. 없으면 우클릭 메뉴에 항목이 뜨지 않는다. */
  onSplit?: (paneId: string, dir: 'row' | 'column') => void;
  /** §4 (⑤) — 이 pane 을 닫는다(형제가 자리를 물려받는다). */
  onClosePane?: (paneId: string) => void;
  /** §4 (⑤) — 이 pane 만 임시 전체화면(zoom) 토글. */
  onToggleZoom?: (paneId: string) => void;
  /** §4 (⑤) — 지금 이 pane 이 zoom 상태인가(메뉴 라벨 분기). */
  zoomed?: boolean;
  /** §4 (⑤) — 현재 세션 탭의 pane 개수(상한 도달 시 split 항목 비활성). */
  paneCount?: number;
}

const FONT_SIZE_KEY = 'vibisual.terminal.fontSize';
const FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 28;

function clampFont(n: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)));
}

// 호스트가 실제로 화면에 측정 가능한 크기를 가질 때만 true.
// xterm 의 fit()/resize 는 0 크기(숨겨진 탭·미배치) 상태에서 호출하면 내부 RenderService 의
// dimensions 가 비어, 이후 write/scroll 시 Viewport.syncScrollArea 가 undefined.dimensions 로 터진다.
// → fit 류는 반드시 이 가드를 통과할 때만 수행한다.
function hostMeasurable(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.clientWidth > 0 && el.clientHeight > 0 && el.isConnected;
}

function readStoredFontSize(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampFont(n) : FONT_SIZE_DEFAULT;
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

// IDE 본문(gray-950)과 통일한 프로젝트 톤 + 완전한 ANSI 16색 팔레트(tailwind 색 기반 — 다크 배경 가독).
const TERMINAL_THEME = {
  background: '#030712', // gray-950
  foreground: '#e5e7eb', // gray-200
  cursor: '#2dd4bf', // teal-400 (터미널 액센트)
  cursorAccent: '#030712',
  selectionBackground: 'rgba(139, 92, 246, 0.35)', // violet-500 (IDE 액센트)
  black: '#1f2937',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e5e7eb',
  brightBlack: '#4b5563',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f9fafb',
} as const;

export function IDETerminalView({ agentId, sessionId, paneId = '0', onSplit, onClosePane, onToggleZoom, zoomed = false, paneCount = 1 }: IDETerminalViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  // cwd = 그 에이전트가 속한 프로젝트 루트(ProjectInfo.path). config = 그 에이전트의 AgentConfig.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const cwd = useGraphStore((s) => (projectName ? s.projects[projectName]?.path : undefined));
  const config = useGraphStore((s) => s.agentConfigs[agentId]);

  // 세션(탭)마다 독립 termId. IDE 를 닫았다 열거나 탭을 다시 그려도 같은 termId 로 reattach → 보존.
  // §4 (⑤) — pane 이 갈리면 `#<paneId>` 가 붙는다. pane `'0'` 은 접미사가 없어 **기존 termId 와
  //   바이트 단위로 같다** → 이미 떠 있던 세션·`sessions.json` 의 `--resume` 키가 그대로 이어진다.
  const termId = useMemo(
    () => cmdPaneTermId(`term:${agentId}:${sessionId ?? 'main'}`, paneId),
    [agentId, sessionId, paneId],
  );

  // §4 (③) — scrollback 은 한 값에서 나온다: xterm 의 `scrollback` 과 desktop PTY 링버퍼 상한이
  //   같은 숫자를 쓰므로 "화면엔 있는데 Ctrl+F 로는 안 찾히는" 구간이 사라진다.
  const scrollbackLines = useGraphStore((st) => clampTerminalScrollback(st.userDefaults?.advanced?.terminalScrollbackLines));
  const scrollbackRef = useRef(scrollbackLines);
  scrollbackRef.current = scrollbackLines;

  // §4 v3.33 — 데스크톱(window.api.terminal IPC) / 모바일(/ws 브리지) 공통 transport. 모듈 참조라 stable.
  const transport = useMemo(() => getTerminalTransport(), []);

  // xterm 인스턴스/애드온 — effect 밖(메뉴·검색바·폰트 버튼 핸들러)에서 조작하려고 ref 로 보관.
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  // §4 (CMD ①) — 이 pane 의 상태 감지기. 스니퍼 콜백·cleanup 에서 접근하려고 ref 로 보관.
  const trackerRef = useRef<TerminalStateTracker | null>(null);
  // §4 (CMD ③) — 크기 동기화(fit + PTY resize)를 예약하는 **단일 창구**. 아래 effect 가 채운다.
  //   폰트 확대/축소도 이 창구를 타야 "+"연타가 리사이즈 N회로 번지지 않는다(리사이즈 1회 = ConPTY
  //   화면 전체 리페인트 1벌이므로, 횟수가 그대로 중복 출력으로 남는다).
  const scheduleSizeSyncRef = useRef<(() => void) | null>(null);
  const fontSizeRef = useRef<number>(typeof window !== 'undefined' ? readStoredFontSize() : FONT_SIZE_DEFAULT);

  const [fontSize, setFontSize] = useState<number>(fontSizeRef.current);
  // §4 v2.89 — CMD 카드(작업 신고/질문/검수/목록). 마커 줄은 터미널에서 숨기고, 카드는 우측 DOM 패널이 렌더.
  const [cards, setCards] = useState<TerminalCard[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasTerminalApi = !!transport;

  // ── 편의 동작들 (메뉴 버튼 + 키보드 핸들러 공용) ──────────────────────────
  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (!term || !term.hasSelection()) return;
    const text = term.getSelection();
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  }, []);

  const paste = useCallback(() => {
    if (!transport) return;
    void navigator.clipboard?.readText().then((text) => {
      if (text) void transport.write(termId, text);
    }).catch(() => {});
  }, [transport, termId]);

  const selectAll = useCallback(() => {
    termRef.current?.selectAll();
  }, []);

  // §5.5 #17-3 (판올림 번호 발급 대기) — 고른 글자를 기본 브라우저에서 검색(스트림 메뉴와 같은 함수).
  const searchWeb = useCallback(() => {
    const term = termRef.current;
    if (!term || !term.hasSelection()) return;
    openWebSearch(term.getSelection());
  }, []);

  // §4 v2.89 — CMD 질문 카드 "즉시 전송": 프롬프트를 터미널 PTY 에 prefill(newline ❌ — 사람이 Enter, ToS 인루프).
  const sendPromptToTerminal = useCallback((prompt: string) => {
    if (!transport) return;
    void transport.write(termId, prompt);
    termRef.current?.focus();
  }, [transport, termId]);

  const clearCards = useCallback(() => setCards([]), []);

  const clearTerminal = useCallback(() => {
    termRef.current?.clear();
    termRef.current?.focus();
  }, []);

  const applyFontSize = useCallback((next: number) => {
    const size = clampFont(next);
    fontSizeRef.current = size;
    setFontSize(size);
    try { window.localStorage.setItem(FONT_SIZE_KEY, String(size)); } catch { /* private mode */ }
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = size;
    // §4 (CMD ③) — 여기서 곧바로 fit+resize 하지 않고 **디바운스 창구**에 맡긴다. 폰트를 한 단계
    //   올릴 때마다 PTY 를 리사이즈하면 ConPTY 가 그때마다 화면을 통째로 다시 뱉어(실측) 같은
    //   배너가 단계 수만큼 쌓인다. 연타해도 멎은 뒤 한 번만 PTY 에 통지한다.
    scheduleSizeSyncRef.current?.();
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // 다음 프레임에 입력 포커스 + 기존 선택을 검색어로 프리필.
    requestAnimationFrame(() => {
      const sel = termRef.current?.hasSelection() ? termRef.current.getSelection() : '';
      if (sel) setSearchQuery(sel);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  const findNext = useCallback((query: string) => {
    if (query) searchRef.current?.findNext(query);
  }, []);
  const findPrev = useCallback((query: string) => {
    if (query) searchRef.current?.findPrevious(query);
  }, []);

  // 키보드 핸들러는 effect(1회) 안에서 attach 되므로, 최신 콜백을 ref 로 넘겨 stale 클로저 방지.
  const actionsRef = useRef({ copySelection, paste, selectAll, clearTerminal, applyFontSize, openSearch });
  actionsRef.current = { copySelection, paste, selectAll, clearTerminal, applyFontSize, openSearch };

  // ── xterm 생성/재부착 ────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // transport 부재(터미널 불가 환경) — 안내는 JSX 폴백이 처리하므로 여기선 no-op.
    if (!transport || !config) return;

    // 새 터미널/세션 부착 시 카드 패널을 비운다. reattach 면 아래 replay 가 buffer 의 마커로 재구성.
    setCards([]);

    const term = new Terminal({
      fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: fontSizeRef.current,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: { ...TERMINAL_THEME },
      scrollback: scrollbackRef.current,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    // 출력 속 URL 클릭 → 새 창/외부 브라우저로 열기(Electron shell.openExternal 폴백).
    const links = new WebLinksAddon((_event, uri) => {
      try { window.open(uri, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    });
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(links);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // 언마운트/탭 전환 후 뒤늦게 도착하는 콜백(write·resize·fit)이 dispose 된 터미널을 건드려
    // xterm 내부 syncScrollArea 가 터지는 걸 막는 가드. cleanup 이 가장 먼저 true 로 세운다.
    let disposed = false;
    // 호스트가 측정 가능하고 dispose 전일 때만 fit. (0 크기 fit = dimensions 깨짐의 원인)
    // 반환값 = **실제로 화면 크기에 맞췄는가**. false 면 지금 term.cols/rows 는 xterm 기본값(80x24)이라
    // 그 값을 PTY 에 실어 보내면 안 된다(§4 CMD ③ — 잘못된 크기로 줄였다 늘리며 리페인트가 두 번 난다).
    const safeFit = (): boolean => {
      if (disposed || !hostMeasurable(host)) return false;
      try { fit.fit(); return true; } catch { return false; /* host not measured yet */ }
    };

    term.open(host);
    const measured = safeFit();

    // 커스텀 키 핸들러 — 복붙/검색/폰트 단축키. return false = xterm 이 PTY stdin 으로 보내지 않음.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return true;
      const a = actionsRef.current;
      // Ctrl+Shift+C / Ctrl+Shift+V — 명시적 복사/붙여넣기.
      if (e.shiftKey && e.code === 'KeyC') { a.copySelection(); return false; }
      if (e.shiftKey && e.code === 'KeyV') { a.paste(); return false; }
      if (e.shiftKey) return true;
      // Ctrl+C — 선택이 있으면 복사, 없으면 통과(셸 SIGINT 보존).
      if (e.code === 'KeyC') {
        if (term.hasSelection()) { a.copySelection(); return false; }
        return true;
      }
      if (e.code === 'KeyV') { a.paste(); return false; }
      if (e.code === 'KeyF') { a.openSearch(); return false; }
      if (e.code === 'KeyA') { a.selectAll(); return false; }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { a.applyFontSize(fontSizeRef.current + 1); return false; }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { a.applyFontSize(fontSizeRef.current - 1); return false; }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { a.applyFontSize(FONT_SIZE_DEFAULT); return false; }
      return true;
    });

    // 측정에 성공했을 때만 크기를 싣는다 — 미측정(숨은 탭·미배치)이면 생략해 **재부착 PTY 를
    //   80x24 로 건드리지 않는다**(생략 시 새 셸은 main 의 기본 크기로 뜨고, 첫 fit 뒤 한 번만 맞춰진다).
    const initialSize = measured ? { cols: term.cols, rows: term.rows } : {};

    // §4 v2.89 — CMD 카드 스니퍼. PTY 출력 중 `::VIBISUAL-CARD::{…}` 마커 줄을 **터미널에서 숨기고**(feed 가
    //   그 줄을 뺀 문자열을 돌려줌 → claude TUI 무간섭), 파싱한 카드는 onCard 로 받아 우측 DOM 패널이 렌더.
    //   reattach replay 는 onReset 으로 패널을 비운 뒤 buffer 의 마커로 카드를 재구성한다.
    const sniffer = new TerminalCardSniffer({
      onCard: (card) => { if (!disposed) setCards((prev) => [...prev, card]); },
      // §7.11 v2.29 — iframe 신고: 표시 카드가 아니라 서버 프리뷰 버블 트리거. 서버가 agentId 로 세션을 찾아
      //   그 URL 로 iframe 위성을 만든다(정규식 추측 대체). 실패해도 조용히 무시(표시 전용).
      onIframe: (url) => {
        if (disposed) return;
        void fetch('/api/agent-iframe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, url }),
        }).catch(() => { /* 표시 전용 — 무시 */ });
      },
      onReset: () => { if (!disposed) { setCards([]); trackerRef.current?.reset(); } },
    });

    // §4 (CMD ①②) — 상태 감지기. **새 스트림을 만들지 않는다** — 위 카드 스니퍼와 같은 PTY
    //   바이트를 읽기만 해(변형 ❌) working/idle/blocked 를 주기 신고한다. 판정·쓰기·전파는
    //   서버가 한다(§3.1) — 여기엔 상태 전이 규칙이 한 줄도 없다.
    const tracker = new TerminalStateTracker();
    trackerRef.current = tracker;
    let lastProcess: string | undefined;
    let lastProcessAt = 0;
    const postState = (payload: { state: CmdTerminalState; reason?: string }): void => {
      void fetch('/api/cmd-terminal-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termId,
          ...payload,
          ...(lastProcess ? { foregroundProcess: lastProcess } : {}),
        }),
      }).catch(() => { /* 표시 전용 — 실패해도 터미널 동작엔 영향 없음 */ });
    };
    const stateTimer = setInterval(() => {
      if (disposed) return;
      const now = Date.now();
      // ② 전경 프로세스명은 훨씬 느리게 표본한다(모바일 /ws 브리지엔 info 가 없어 그냥 건너뛴다).
      if (transport.info && now - lastProcessAt >= CMD_PROCESS_POLL_MS) {
        lastProcessAt = now;
        void transport.info(termId).then((info) => {
          if (disposed || !info?.process || info.process === lastProcess) return;
          lastProcess = info.process;
          const cur = tracker.current;
          if (cur) postState({ state: cur }); // 프로세스명만 바뀐 경우도 한 번 실어 보낸다.
        }).catch(() => { /* 선택 기능 — 없으면 탭 라벨 보조 표기만 빈다 */ });
      }
      const next = tracker.poll(now);
      if (next) postState(next);
    }, CMD_STATE_TICK_MS);

    // main → renderer 출력: 이 termId 만 골라, 변환된 표시 문자열을 write(원본 data 직접 write ❌).
    const offData = transport.onData(({ termId: id, data }) => {
      if (id === termId && !disposed) {
        const outStr = sniffer.feed(data);
        if (outStr) term.write(outStr);
        tracker.feed(data);
      }
    });
    const offExit = transport.onExit(({ termId: id, exitCode }) => {
      if (id === termId && !disposed) {
        term.write(`\r\n\x1b[90m[${t('ide.terminal.exited', { code: exitCode })}]\x1b[0m\r\n`);
      }
    });

    // renderer → main 입력.
    const onDataDisposable = term.onData((data) => {
      void transport.write(termId, data);
    });

    // 셸+claude prefill PTY 생성. §4 v3.33 — 외부(인터넷) 접속은 서버가 셸을 막고 external-blocked 회신.
    void transport.create({ termId, cwd: cwd ?? '', config, ...initialSize, scrollbackLines: scrollbackRef.current }).then((r) => {
      if (r.ok || disposed) return;
      const msg = r.error === 'external-blocked'
        ? t('ide.terminal.unavailableExternal')
        : t('ide.terminal.createFailed', { error: r.error ?? '' });
      term.write(`\r\n\x1b[31m[${msg}]\x1b[0m\r\n`);
    });

    // 리사이즈 — xterm fit 과 PTY resize 를 **항상 함께, 리사이즈가 멎은 뒤 1회만**(트레일링 디바운스)
    // 적용한다.
    //   • 함께: xterm cols/rows 와 PTY cols/rows 가 어긋나면 claude REPL 의 하단 입력 박스 커서 계산이
    //     틀려 박스가 조각나며 깨진다. 그래서 fit 으로 xterm 크기를 잡은 직후 같은 값으로 PTY 도 맞춘다.
    //   • 1회만: 드래그 중 매 픽셀 SIGWINCH 를 쏘면 claude 가 프레임을 다시 그려 누적되므로, 멈춘 최종
    //     크기에서만 한 번 통지한다. (재마운트 replay 덧쌓임은 main 의 clear-before-replay 가 따로 막음.)
    //   드래그 도중에는 xterm 이 마지막으로 동기화된 크기를 유지하다가, 멈추면 새 크기로 한 번에 맞춰진다.
    //   • §4 (CMD ③) — 리사이즈 1회 = ConPTY 화면 전체 리페인트 1벌이다. 여기서 횟수를 줄이는 것과
    //     main 의 `shouldBufferPtyChunk` 가 그 리페인트를 링버퍼에서 걸러 내는 것은 **한 쌍** —
    //     둘 중 하나만 되돌리면 재부착 replay 에 같은 배너가 다시 쌓인다.
    let lastCols = term.cols;
    let lastRows = term.rows;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    // 크기 동기화 창구 — 컨테이너 리사이즈와 **폰트 확대/축소가 같은 타이머**를 공유한다.
    // 마지막에 실제로 cols/rows 가 달라졌을 때만 PTY 에 통지하므로, 드래그 도중이나 "+"연타로
    // 중간 크기가 여러 번 스쳐 가도 PTY 리사이즈(=ConPTY 화면 전체 리페인트)는 한 번뿐이다.
    const scheduleSizeSync = (): void => {
      if (disposed) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        if (disposed) return;
        if (!safeFit()) return; // 미측정 상태에서는 기본 크기를 PTY 에 실어 보내지 않는다.
        try {
          if (term.cols !== lastCols || term.rows !== lastRows) {
            lastCols = term.cols;
            lastRows = term.rows;
            void transport.resize(termId, term.cols, term.rows);
          }
        } catch { /* disposed */ }
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
    };
    scheduleSizeSyncRef.current = scheduleSizeSync;
    const ro = new ResizeObserver(() => { scheduleSizeSync(); });
    ro.observe(host);

    term.focus();

    return () => {
      // §4 v2.63 — **PTY 는 kill 하지 않는다**. IDE 닫기/탭 전환은 컴포넌트만 unmount 하고
      // 메인 프로세스의 PTY 는 살려둔다 → 다시 열면 reattach + scrollback replay 로 세션 보존.
      // 진짜 종료(탭 명시 닫기)는 IDETabBar 가 api.terminal.kill 로, 앱/창 종료는 main 이 일괄 정리.
      disposed = true; // 이후 도착하는 write/resize/fit 콜백이 dispose 된 터미널을 건드리지 않게.
      clearInterval(stateTimer);
      trackerRef.current = null;
      scheduleSizeSyncRef.current = null;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      offData();
      offExit();
      onDataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // termId(agentId+session) 단위 1개 터미널 — config/cwd 변경엔 재생성하지 않음(세션 유지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId, paneId]);

  // 검색어 변경 시 라이브 하이라이트(다음 매치로 이동).
  // §4 (CMD ③ QA) — scrollback 설정을 **이미 떠 있는 터미널에도** 반영한다. 종전에는 생성 시점
  //   값만 쓰여, 옵션창에서 늘려도 "새로 여는 터미널부터"라 지금 보고 있는 창에서는 아무 일도
  //   일어나지 않았다(설정을 바꾼 사용자가 고장으로 읽는 자리). PTY 링버퍼 쪽은 다음 부착에서
  //   맞춰지므로 여기서는 xterm 만 즉시 올린다.
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.scrollback = scrollbackLines;
  }, [scrollbackLines]);

  // 검색어 변경 시 라이브 하이라이트(다음 매치로 이동).
  useEffect(() => {
    if (searchOpen) findNext(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

  // 컨텍스트 메뉴 닫힘 트리거 — 외부 press(공통 규약) / Esc.
  useOutsidePressDismiss({
    enabled: menu !== null,
    onDismiss: () => setMenu(null),
    refs: [menuRef],
    capture: false,
  });

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // 뷰포트 클리핑 — 메뉴(약 180×210)가 화면 밖으로 넘치지 않게 좌상단 보정.
    const MENU_W = 200;
    const MENU_H = 220;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  }, []);

  const hasSelection = () => !!termRef.current?.hasSelection();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#030712]">
      {/* §4 v2.63 — 권한 경계 고지 + v2.65 폰트/검색 컨트롤. */}
      <div className="flex items-center gap-1.5 border-b border-teal-500/20 bg-teal-500/5 px-3 py-1">
        <svg className="h-3 w-3 shrink-0 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="4" width="19" height="16" rx="2" />
          <path d="M6 9l3 3-3 3" />
          <line x1="12" y1="15" x2="16" y2="15" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-teal-200/70">{t('ide.terminal.harnessNote')}</span>
        {hasTerminalApi && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => applyFontSize(fontSize - 1)}
              title={t('ide.terminal.fontDecrease')}
              aria-label={t('ide.terminal.fontDecrease')}
              className="rounded p-1 text-teal-200/60 transition-colors hover:bg-teal-500/15 hover:text-teal-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <button
              type="button"
              onClick={() => applyFontSize(FONT_SIZE_DEFAULT)}
              title={t('ide.terminal.fontReset')}
              aria-label={t('ide.terminal.fontReset')}
              className="min-w-[28px] rounded px-1 py-0.5 text-center text-[12px] tabular-nums text-teal-200/60 transition-colors hover:bg-teal-500/15 hover:text-teal-100"
            >
              {fontSize}
            </button>
            <button
              type="button"
              onClick={() => applyFontSize(fontSize + 1)}
              title={t('ide.terminal.fontIncrease')}
              aria-label={t('ide.terminal.fontIncrease')}
              className="rounded p-1 text-teal-200/60 transition-colors hover:bg-teal-500/15 hover:text-teal-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <button
              type="button"
              onClick={() => openSearch()}
              title={`${t('ide.terminal.find')} (Ctrl+F)`}
              aria-label={t('ide.terminal.find')}
              className="rounded p-1 text-teal-200/60 transition-colors hover:bg-teal-500/15 hover:text-teal-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
        )}
      </div>

      {!hasTerminalApi ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <span className="text-[12px] text-gray-500">{t('ide.terminal.unavailable')}</span>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 flex-1">
          {/* 인앱 검색바 — Ctrl+F. */}
          {searchOpen && (
            <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900/95 px-1.5 py-1 shadow-xl backdrop-blur">
              <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrev(searchQuery); else findNext(searchQuery); }
                  else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                }}
                placeholder={t('ide.terminal.findPlaceholder')}
                className="w-44 bg-transparent text-[12px] text-gray-100 placeholder:text-gray-600 focus:outline-none"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => findPrev(searchQuery)}
                title={t('ide.terminal.findPrev')}
                aria-label={t('ide.terminal.findPrev')}
                className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
              </button>
              <button
                type="button"
                onClick={() => findNext(searchQuery)}
                title={t('ide.terminal.findNext')}
                aria-label={t('ide.terminal.findNext')}
                className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button
                type="button"
                onClick={() => closeSearch()}
                title={t('ide.terminal.findClose')}
                aria-label={t('ide.terminal.findClose')}
                className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          )}
          <div ref={hostRef} onContextMenu={onContextMenu} className="h-full min-h-0 w-full overflow-hidden p-1.5" />
          </div>
          {cards.length > 0 && (
            <IDETerminalCardRail
              cards={cards}
              agentId={agentId}
              sessionId={sessionId}
              onSendPrompt={sendPromptToTerminal}
              onClear={clearCards}
            />
          )}
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴 — createPortal 로 body 에. */}
      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] min-w-[200px] rounded-md border border-gray-700 bg-gray-900 py-1 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <TerminalMenuItem label={t('ide.terminal.copy')} shortcut="Ctrl+C" disabled={!hasSelection()} onClick={() => { copySelection(); setMenu(null); }} />
          <TerminalMenuItem label={t('ide.mainArea.ctxSearchWeb')} disabled={!hasSelection()} onClick={() => { searchWeb(); setMenu(null); }} />
          <TerminalMenuItem label={t('ide.terminal.paste')} shortcut="Ctrl+V" onClick={() => { paste(); setMenu(null); }} />
          <TerminalMenuItem label={t('ide.terminal.selectAll')} shortcut="Ctrl+A" onClick={() => { selectAll(); setMenu(null); }} />
          <div className="my-1 h-px bg-gray-700/70" />
          <TerminalMenuItem label={t('ide.terminal.find')} shortcut="Ctrl+F" onClick={() => { setMenu(null); openSearch(); }} />
          <TerminalMenuItem label={t('ide.terminal.clear')} onClick={() => { clearTerminal(); setMenu(null); }} />
          {(onSplit || onToggleZoom || onClosePane) && <div className="my-1 h-px bg-gray-700/70" />}
          {onSplit && (
            <>
              <TerminalMenuItem
                label={t('ide.terminal.splitRight')}
                disabled={paneCount >= CMD_PANE_MAX}
                onClick={() => { setMenu(null); onSplit(paneId, 'row'); }}
              />
              <TerminalMenuItem
                label={t('ide.terminal.splitDown')}
                disabled={paneCount >= CMD_PANE_MAX}
                onClick={() => { setMenu(null); onSplit(paneId, 'column'); }}
              />
            </>
          )}
          {onToggleZoom && paneCount > 1 && (
            <TerminalMenuItem
              label={zoomed ? t('ide.terminal.unzoom') : t('ide.terminal.zoom')}
              onClick={() => { setMenu(null); onToggleZoom(paneId); }}
            />
          )}
          {onClosePane && paneCount > 1 && (
            <TerminalMenuItem
              label={t('ide.terminal.closePane')}
              onClick={() => { setMenu(null); onClosePane(paneId); }}
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function TerminalMenuItem({ label, shortcut, disabled, onClick }: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
    >
      <span>{label}</span>
      {shortcut && <span className="font-mono text-[12px] text-gray-500">{shortcut}</span>}
    </button>
  );
}
