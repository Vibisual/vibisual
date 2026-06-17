import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useGraphStore } from '../../stores/graphStore.js';
import { TerminalCardSniffer } from './terminalCardSniffer.js';

// §4 v2.63 — 임베디드 인터랙티브 터미널 뷰. (편의성 보강 v2.65)
//
// `AgentConfig.executionMode === 'interactive-terminal'` 인 커스텀 에이전트의 IDE 메인 영역에
// 기존 채팅 스트림 대신 이 xterm.js 터미널이 렌더된다(IDEMainArea 분기). 더블클릭 → 셸+claude
// prefill PTY(desktop main terminalManager)에 붙어 사용자가 직접 모는 인터랙티브 세션.
//
// 터미널 I/O 는 graphStore/WS 가 아니라 shell-state 전용 IPC(`window.api.terminal.*`)로 흐른다.
// dev/web 모드(window.api 부재)에선 안내만 표시 — 임베디드 PTY 는 패키지/preview Electron 한정.
//
// v2.65 편의성: ① 프로젝트 톤 완전 ANSI 팔레트 테마, ② 복사/붙여넣기(우클릭 메뉴 + Ctrl+C/V·
// Ctrl+Shift+C/V), ③ Ctrl+F 인앱 검색, ④ 출력 속 URL 클릭, ⑤ Ctrl +/-/0 폰트 확대·축소(localStorage 보존).

interface IDETerminalViewProps {
  agentId: string;
  /** 세션(탭) id — null = 메인 탭. 탭마다 독립 PTY(termId=term:agentId:session)로 "+"=새 cmd 터미널. */
  sessionId: string | null;
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

export function IDETerminalView({ agentId, sessionId }: IDETerminalViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  // cwd = 그 에이전트가 속한 프로젝트 루트(ProjectInfo.path). config = 그 에이전트의 AgentConfig.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const cwd = useGraphStore((s) => (projectName ? s.projects[projectName]?.path : undefined));
  const config = useGraphStore((s) => s.agentConfigs[agentId]);

  // 세션(탭)마다 독립 termId. IDE 를 닫았다 열거나 탭을 다시 그려도 같은 termId 로 reattach → 보존.
  const termId = useMemo(() => `term:${agentId}:${sessionId ?? 'main'}`, [agentId, sessionId]);

  // xterm 인스턴스/애드온 — effect 밖(메뉴·검색바·폰트 버튼 핸들러)에서 조작하려고 ref 로 보관.
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fontSizeRef = useRef<number>(typeof window !== 'undefined' ? readStoredFontSize() : FONT_SIZE_DEFAULT);

  const [fontSize, setFontSize] = useState<number>(fontSizeRef.current);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasTerminalApi = typeof window !== 'undefined' && !!window.api?.terminal;

  // ── 편의 동작들 (메뉴 버튼 + 키보드 핸들러 공용) ──────────────────────────
  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (!term || !term.hasSelection()) return;
    const text = term.getSelection();
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  }, []);

  const paste = useCallback(() => {
    const api = window.api?.terminal;
    if (!api) return;
    void navigator.clipboard?.readText().then((text) => {
      if (text) void api.write(termId, text);
    }).catch(() => {});
  }, [termId]);

  const selectAll = useCallback(() => {
    termRef.current?.selectAll();
  }, []);

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
    // 호스트가 측정 가능할 때만 fit → 0 크기에서 dimensions 가 깨지는 걸 방지.
    if (!hostMeasurable(hostRef.current)) return;
    try {
      fitRef.current?.fit();
      window.api?.terminal?.resize(termId, term.cols, term.rows);
    } catch { /* host not measured */ }
  }, [termId]);

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
    const api = typeof window !== 'undefined' ? window.api : undefined;
    const host = hostRef.current;
    if (!host) return;
    // dev/web 모드 — PTY 없음. 안내는 JSX 폴백이 처리하므로 여기선 no-op.
    if (!api?.terminal || !config) return;

    const term = new Terminal({
      fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: fontSizeRef.current,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: { ...TERMINAL_THEME },
      scrollback: 5000,
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
    const safeFit = (): void => {
      if (disposed || !hostMeasurable(host)) return;
      try { fit.fit(); } catch { /* host not measured yet */ }
    };

    term.open(host);
    safeFit();

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

    const cols = term.cols;
    const rows = term.rows;

    // §4 v2.83 — CMD 카드 인라인 렌더러. PTY 출력 중 `::VIBISUAL-CARD::{…}` 마커 줄을 ANSI 색 박스로
    //   **대체**해 터미널 안에 그대로 그린다(마커 없는 출력은 무변형 통과). feed 가 돌려준 문자열을 write.
    const sniffer = new TerminalCardSniffer();

    // main → renderer 출력: 이 termId 만 골라, 변환된 표시 문자열을 write(원본 data 직접 write ❌).
    const offData = api.terminal.onData(({ termId: id, data }) => {
      if (id === termId && !disposed) {
        const outStr = sniffer.feed(data);
        if (outStr) term.write(outStr);
      }
    });
    const offExit = api.terminal.onExit(({ termId: id, exitCode }) => {
      if (id === termId && !disposed) {
        term.write(`\r\n\x1b[90m[${t('ide.terminal.exited', { code: exitCode })}]\x1b[0m\r\n`);
      }
    });

    // renderer → main 입력.
    const onDataDisposable = term.onData((data) => {
      void api.terminal!.write(termId, data);
    });

    // 셸+claude prefill PTY 생성.
    void api.terminal.create({ termId, cwd: cwd ?? '', config, cols, rows }).then((r) => {
      if (!r.ok) {
        term.write(`\r\n\x1b[31m[${t('ide.terminal.createFailed', { error: r.error ?? '' })}]\x1b[0m\r\n`);
      }
    });

    // 리사이즈 — xterm fit 과 PTY resize 를 **항상 함께, 리사이즈가 멎은 뒤 1회만**(트레일링 디바운스)
    // 적용한다.
    //   • 함께: xterm cols/rows 와 PTY cols/rows 가 어긋나면 claude REPL 의 하단 입력 박스 커서 계산이
    //     틀려 박스가 조각나며 깨진다. 그래서 fit 으로 xterm 크기를 잡은 직후 같은 값으로 PTY 도 맞춘다.
    //   • 1회만: 드래그 중 매 픽셀 SIGWINCH 를 쏘면 claude 가 프레임을 다시 그려 누적되므로, 멈춘 최종
    //     크기에서만 한 번 통지한다. (재마운트 replay 덧쌓임은 main 의 clear-before-replay 가 따로 막음.)
    //   드래그 도중에는 xterm 이 마지막으로 동기화된 크기를 유지하다가, 멈추면 새 크기로 한 번에 맞춰진다.
    let lastCols = term.cols;
    let lastRows = term.rows;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (disposed) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        if (disposed) return;
        safeFit();
        try {
          if (term.cols !== lastCols || term.rows !== lastRows) {
            lastCols = term.cols;
            lastRows = term.rows;
            void api.terminal!.resize(termId, term.cols, term.rows);
          }
        } catch { /* disposed */ }
      }, 150);
    });
    ro.observe(host);

    term.focus();

    return () => {
      // §4 v2.63 — **PTY 는 kill 하지 않는다**. IDE 닫기/탭 전환은 컴포넌트만 unmount 하고
      // 메인 프로세스의 PTY 는 살려둔다 → 다시 열면 reattach + scrollback replay 로 세션 보존.
      // 진짜 종료(탭 명시 닫기)는 IDETabBar 가 api.terminal.kill 로, 앱/창 종료는 main 이 일괄 정리.
      disposed = true; // 이후 도착하는 write/resize/fit 콜백이 dispose 된 터미널을 건드리지 않게.
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
  }, [agentId, sessionId]);

  // 검색어 변경 시 라이브 하이라이트(다음 매치로 이동).
  useEffect(() => {
    if (searchOpen) findNext(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

  // 컨텍스트 메뉴 닫힘 트리거(외부 mousedown / Esc).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
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
        <span className="min-w-0 flex-1 truncate text-[10px] leading-snug text-teal-200/70">{t('ide.terminal.harnessNote')}</span>
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
              className="min-w-[28px] rounded px-1 py-0.5 text-center text-[10px] tabular-nums text-teal-200/60 transition-colors hover:bg-teal-500/15 hover:text-teal-100"
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
      )}

      {/* 우클릭 컨텍스트 메뉴 — createPortal 로 body 에. */}
      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] min-w-[200px] rounded-md border border-gray-700 bg-gray-900 py-1 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <TerminalMenuItem label={t('ide.terminal.copy')} shortcut="Ctrl+C" disabled={!hasSelection()} onClick={() => { copySelection(); setMenu(null); }} />
          <TerminalMenuItem label={t('ide.terminal.paste')} shortcut="Ctrl+V" onClick={() => { paste(); setMenu(null); }} />
          <TerminalMenuItem label={t('ide.terminal.selectAll')} shortcut="Ctrl+A" onClick={() => { selectAll(); setMenu(null); }} />
          <div className="my-1 h-px bg-gray-700/70" />
          <TerminalMenuItem label={t('ide.terminal.find')} shortcut="Ctrl+F" onClick={() => { setMenu(null); openSearch(); }} />
          <TerminalMenuItem label={t('ide.terminal.clear')} onClick={() => { clearTerminal(); setMenu(null); }} />
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
      {shortcut && <span className="font-mono text-[10px] text-gray-500">{shortcut}</span>}
    </button>
  );
}
