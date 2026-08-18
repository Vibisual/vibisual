import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DebugScope, DebugSessionState, DebugVariable } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import {
  controlDebugSession,
  detachDebugSession,
  evaluateDebugExpression,
  fetchDebugScopes,
  fetchDebugVariables,
  getDebugConsole,
  useDebugSessions,
} from '../../stores/debugSessions.js';
import type { DebugControlActionWire } from '../../stores/debugSessionTypes.js';
import { toWorkspaceRelative } from './debugPaths.js';

/**
 * §5.5 #17-20 ⑩ v4.94 — 붙어 있는 디버그 세션 하나의 조작판.
 *
 * **여기에는 CDP·DAP 라는 말이 없다.** 서버가 한 모양으로 정규화해 보내므로 이 컴포넌트는
 * `DebugSessionState` 하나만 알면 되고, 런타임이 늘어도 한 줄도 바뀌지 않는다.
 */

/** 조작 버튼 하나 — 아이콘은 전부 lucide 톤 stroke SVG(이모지 ❌). */
function ControlButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-0.5 text-gray-300 transition-colors hover:bg-gray-700 hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-600"
    >
      {children}
    </button>
  );
}

const ICON_PROPS = {
  className: 'h-3.5 w-3.5',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 변수 한 줄 — 펼칠 수 있으면(참조 > 0) 눌러서 자식을 받아 온다. */
const VariableRow = memo(function VariableRow({
  sessionId,
  variable,
  depth,
}: {
  sessionId: string;
  variable: DebugVariable;
  depth: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DebugVariable[] | null>(null);

  const toggle = useCallback(() => {
    if (variable.variablesReference <= 0) return;
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      void fetchDebugVariables(sessionId, variable.variablesReference).then(setChildren);
    }
  }, [open, children, sessionId, variable.variablesReference]);

  const expandable = variable.variablesReference > 0;
  return (
    <>
      <div
        onClick={expandable ? toggle : undefined}
        className={`flex items-start gap-1 py-0.5 text-[9.5px] ${expandable ? 'cursor-pointer hover:bg-gray-800/60' : ''}`}
      >
        <span className="w-3 flex-shrink-0 text-center text-gray-600">
          {expandable ? (open ? '−' : '+') : ''}
        </span>
        <span className="min-w-0 flex-shrink-0 truncate text-sky-300" title={variable.name}>
          {variable.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-gray-400" title={variable.value}>
          {variable.value}
        </span>
      </div>
      {open && children?.map((child) => (
        <div key={`${child.name}-${child.variablesReference}`} className="pl-3">
          <VariableRow sessionId={sessionId} variable={child} depth={depth + 1} />
        </div>
      ))}
    </>
  );
});

export const IDEDebugSessionPanel = memo(function IDEDebugSessionPanel({
  session,
}: {
  session: DebugSessionState;
}): React.JSX.Element {
  const { t } = useTranslation();
  const selectedFrame = useDebugSessions((s) => s.selectedFrame[session.sessionId]);
  const selectFrame = useDebugSessions((s) => s.selectFrame);
  const consoleVersion = useDebugSessions((s) => s.consoleVersion);
  const openEditorFile = useGraphStore((s) => s.openIDEEditorFile);

  const [scopes, setScopes] = useState<DebugScope[]>([]);
  const [variablesByScope, setVariablesByScope] = useState<Record<number, DebugVariable[]>>({});
  const [watchInput, setWatchInput] = useState('');
  const [watchResult, setWatchResult] = useState<DebugVariable | null>(null);

  const paused = session.status === 'paused';
  const frames = session.frames ?? [];
  const activeFrameId = selectedFrame ?? frames[0]?.id;

  // 멈춘 프레임이 바뀌면 그 프레임의 변수 묶음을 새로 받는다(멈춰 있을 때만 물을 수 있다).
  useEffect(() => {
    if (!paused || activeFrameId === undefined) {
      setScopes([]);
      setVariablesByScope({});
      return;
    }
    let cancelled = false;
    void fetchDebugScopes(session.sessionId, activeFrameId).then((next) => {
      if (cancelled) return;
      setScopes(next);
      setVariablesByScope({});
      // 첫 묶음(대개 Local)은 바로 펼쳐 둔다 — 한 번 더 누르게 하지 않는다.
      const first = next[0];
      if (first) {
        void fetchDebugVariables(session.sessionId, first.variablesReference).then((vars) => {
          if (!cancelled) setVariablesByScope({ [first.variablesReference]: vars });
        });
      }
    });
    return () => { cancelled = true; };
  }, [paused, activeFrameId, session.sessionId]);

  const control = useCallback(
    (action: DebugControlActionWire) => { void controlDebugSession(session.sessionId, action); },
    [session.sessionId],
  );

  /**
   * 콜스택 한 칸을 누르면 **내장 편집창**(#17-27)에서 그 파일을 연다 — 앱 밖 편집기로 나가면
   * 창이 바뀌어 디버깅 흐름이 끊긴다. 멈춘 줄 강조는 편집창이 세션 상태를 보고 스스로 그린다.
   */
  const openFrame = useCallback(
    (frameId: number, file?: string) => {
      selectFrame(session.sessionId, frameId);
      if (!file) return;
      const rel = toWorkspaceRelative(file, session.projectPath);
      if (!rel) return;
      const base = session.projectPath.split(/[\\/]+$/)[0] ?? session.projectPath;
      openEditorFile({
        relPath: rel,
        absPath: `${base}/${rel}`,
        name: rel.split('/').pop() ?? rel,
      });
    },
    [selectFrame, session.sessionId, session.projectPath, openEditorFile],
  );

  const runWatch = useCallback(() => {
    const expression = watchInput.trim();
    if (!expression) return;
    void evaluateDebugExpression(session.sessionId, expression, activeFrameId).then(setWatchResult);
  }, [watchInput, session.sessionId, activeFrameId]);

  const consoleLines = getDebugConsole(session.sessionId);
  void consoleVersion; // 링버퍼는 스토어 밖이라 이 카운터를 구독해야 다시 그려진다.

  return (
    <div className="mt-1 rounded border border-sky-500/30 bg-sky-500/5 px-1.5 py-1">
      {/* 상태 + 조작 */}
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate text-[9.5px] text-sky-300">
          {t(`ide.debug.status.${session.status}`)}
          {session.stoppedReason ? ` — ${t(`ide.debug.stoppedReason.${session.stoppedReason}`)}` : ''}
        </span>
        <ControlButton onClick={() => control('continue')} disabled={!paused} label={t('ide.debug.continue')}>
          <svg {...ICON_PROPS}><path d="M6 4l14 8-14 8z" /></svg>
        </ControlButton>
        <ControlButton onClick={() => control('pause')} disabled={paused} label={t('ide.debug.pause')}>
          <svg {...ICON_PROPS}><path d="M9 5v14M15 5v14" /></svg>
        </ControlButton>
        <ControlButton onClick={() => control('stepOver')} disabled={!paused} label={t('ide.debug.stepOver')}>
          <svg {...ICON_PROPS}><path d="M4 15a8 8 0 0 1 16 0" /><path d="M20 9v6h-6" /></svg>
        </ControlButton>
        <ControlButton onClick={() => control('stepIn')} disabled={!paused} label={t('ide.debug.stepIn')}>
          <svg {...ICON_PROPS}><path d="M12 4v10" /><path d="M8 10l4 4 4-4" /><path d="M5 20h14" /></svg>
        </ControlButton>
        <ControlButton onClick={() => control('stepOut')} disabled={!paused} label={t('ide.debug.stepOut')}>
          <svg {...ICON_PROPS}><path d="M12 20V10" /><path d="M8 14l4-4 4 4" /><path d="M5 4h14" /></svg>
        </ControlButton>
        <ControlButton onClick={() => void detachDebugSession(session.sessionId)} label={t('ide.debug.detach')}>
          <svg {...ICON_PROPS}><path d="M18 6L6 18M6 6l12 12" /></svg>
        </ControlButton>
      </div>

      {session.error && (
        <p className="mt-0.5 text-[9px] leading-snug text-amber-400/80">
          {t(`ide.debug.sessionError.${session.error}`, { defaultValue: session.error })}
        </p>
      )}

      {/* 콜스택 — 누르면 그 파일을 편집창에서 연다 */}
      {paused && frames.length > 0 && (
        <div className="mt-1">
          <h4 className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
            {t('ide.debug.callStack')}
          </h4>
          <ul className="mt-0.5 max-h-28 overflow-y-auto">
            {frames.map((frame) => (
              <li key={frame.id}>
                <button
                  type="button"
                  onClick={() => openFrame(frame.id, frame.file)}
                  className={`flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left text-[9.5px] transition-colors hover:bg-gray-700/60 ${
                    frame.id === activeFrameId ? 'bg-gray-700/50 text-gray-100' : 'text-gray-400'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                  <span className="flex-shrink-0 text-gray-600">
                    {frame.file ? `${frame.file.split(/[\\/]/).pop()}:${frame.line}` : `:${frame.line}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 변수 */}
      {paused && scopes.length > 0 && (
        <div className="mt-1">
          <h4 className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
            {t('ide.debug.variables')}
          </h4>
          <div className="mt-0.5 max-h-40 overflow-y-auto">
            {scopes.map((scope) => (
              <div key={scope.variablesReference} className="mb-1">
                <button
                  type="button"
                  onClick={() => {
                    if (variablesByScope[scope.variablesReference]) {
                      setVariablesByScope((prev) => {
                        const next = { ...prev };
                        delete next[scope.variablesReference];
                        return next;
                      });
                      return;
                    }
                    void fetchDebugVariables(session.sessionId, scope.variablesReference).then((vars) =>
                      setVariablesByScope((prev) => ({ ...prev, [scope.variablesReference]: vars })),
                    );
                  }}
                  className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
                >
                  {scope.name}
                </button>
                {variablesByScope[scope.variablesReference]?.map((v) => (
                  <VariableRow key={`${v.name}-${v.variablesReference}`} sessionId={session.sessionId} variable={v} depth={0} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 워치 — 멈춘 자리에서 식 하나 계산 */}
      {paused && (
        <div className="mt-1 flex items-center gap-1">
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runWatch(); }}
            placeholder={t('ide.debug.watchPlaceholder')}
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-[9.5px] text-gray-200 outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={runWatch}
            className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[9px] text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('ide.debug.evaluate')}
          </button>
        </div>
      )}
      {watchResult && (
        <p className="mt-0.5 truncate text-[9.5px] text-gray-400" title={watchResult.value}>
          {watchResult.name} = {watchResult.value}
        </p>
      )}

      {/* 어댑터/디버기가 낸 콘솔 — 곁눈 확인용 몇 줄만(본 출력은 실행 출력 패널) */}
      {consoleLines.length > 0 && (
        <div className="mt-1 rounded bg-gray-950/60 px-1 py-0.5">
          {consoleLines.map((line, i) => (
            <p key={i} className="truncate font-mono text-[9px] text-gray-500" title={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
});
