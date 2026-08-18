import { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { getTerminalTransport } from '../../transport/terminalTransport.js';

/**
 * §4 v4.82 — 로그인 팝업의 터미널 폴백.
 *
 * `LoginWindow` 가 이미 띄운 로그인 PTY 에 **재부착만** 한다(`createTerminal` 은 살아있는 termId 면
 * 재스폰 대신 sink 갱신 + scrollback replay — §4 v2.63). 우리가 못 알아본 프롬프트(SSO 선택 등)가
 * 떠도 여기서 직접 응답할 수 있어, 어떤 경우에도 앱 밖 cmd 창으로 나갈 일이 없다.
 *
 * IDE 터미널(`IDETerminalView`)과 달리 카드 스니퍼·검색·폰트 조절은 없다 — 로그인 한 판에 필요한
 * 최소 기능만.
 */

const THEME = {
  background: '#030712',
  foreground: '#e5e7eb',
  cursor: '#a78bfa',
  cursorAccent: '#030712',
  selectionBackground: 'rgba(139, 92, 246, 0.35)',
} as const;

interface LoginTerminalProps {
  termId: string;
  /**
   * 로그인 명령. 재부착이면 쓰이지 않지만, PTY 가 이미 죽은 뒤 마운트되면 이 값이 있어야
   * 셸에 **로그인 명령이 채워진 채** 새로 뜬다(없으면 실행 런처 갈래를 못 타 claude 세션이 뜬다).
   * 자동 실행은 하지 않는다 — 그 상황에선 사용자가 Enter 로 직접 시작하는 편이 안전하다.
   */
  command?: string;
}

export function LoginTerminal({ termId, command }: LoginTerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => getTerminalTransport(), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !transport) return;

    const term = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 12,
      cursorBlink: true,
      convertEol: false,
      theme: THEME,
      scrollback: 2_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // 0 크기(레이아웃 전)에서 fit 하면 xterm 내부 dimensions 가 비어 이후 write 에서 터진다.
    const safeFit = (): void => {
      if (host.clientWidth > 0 && host.clientHeight > 0 && host.isConnected) {
        try { fit.fit(); } catch { /* 측정 실패 — 다음 기회에 */ }
      }
    };
    safeFit();

    const offData = transport.onData(({ termId: id, data }) => {
      if (id === termId) term.write(data);
    });
    const offExit = transport.onExit(({ termId: id }) => {
      if (id === termId) term.write('\r\n[claude auth login] exited\r\n');
    });
    const keySub = term.onData((data) => { void transport.write(termId, data).catch(() => {}); });

    // 재부착 — 살아있는 PTY 면 scrollback 이 replay 되고, 없으면 소프트 실패(팝업이 이미 안내).
    void transport.create({
      termId,
      cwd: '',
      config: DEFAULT_AGENT_CONFIG,
      cols: term.cols,
      rows: term.rows,
      ...(command ? { command, autoRun: false } : {}),
    }).catch(() => {});

    const ro = new ResizeObserver(() => {
      safeFit();
      if (term.cols > 0 && term.rows > 0) {
        void transport.resize(termId, term.cols, term.rows).catch(() => {});
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      keySub.dispose();
      term.dispose();
    };
  }, [transport, termId, command]);

  return (
    <div
      ref={hostRef}
      className="h-[220px] w-full overflow-hidden rounded-md border border-gray-800 bg-gray-950 px-1.5 py-1"
    />
  );
}
