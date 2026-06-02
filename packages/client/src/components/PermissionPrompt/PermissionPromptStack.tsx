import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { PermissionRequest } from '@vibisual/shared';

/** §5.3 #12-1 v1.43 — 스택 모달 간 z-index 시작값. */
const BASE_Z = 100_000;
/** 스택 카드 cascading offset — 뒤 카드일수록 위·우측으로 밀려 꼬리만 보이게. */
const STACK_OFFSET_Y = 14;
const STACK_OFFSET_X = 10;
/** 클릭 피드백(플래시) 지속 시간 — 버튼 눌림 → 모달 색상 플래시 → 제거 */
const FLASH_DURATION_MS = 220;

function formatToolInput(input: Record<string, unknown>, emptyLabel: string): string {
  const entries = Object.entries(input).slice(0, 6);
  if (entries.length === 0) return emptyLabel;
  return entries
    .map(([k, v]) => {
      if (v == null) return `${k}: ${String(v)}`;
      if (typeof v === 'string') {
        const s = v.length > 120 ? v.slice(0, 120) + '…' : v;
        return `${k}: ${s}`;
      }
      try {
        const s = JSON.stringify(v);
        return `${k}: ${s.length > 120 ? s.slice(0, 120) + '…' : s}`;
      } catch {
        return `${k}: [unserializable]`;
      }
    })
    .join('\n');
}

type FlashKind = null | 'allow' | 'deny';

function PermissionModal({
  request,
  zIndex,
  depth,
  isTop,
  indexFromTop,
  total,
}: {
  request: PermissionRequest;
  zIndex: number;
  depth: number;
  isTop: boolean;
  indexFromTop: number;
  total: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const respond = useGraphStore((s) => s.respondPermission);
  const [denyReason, setDenyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<FlashKind>(null);
  const [remaining, setRemaining] = useState(() => Math.max(0, request.expiresAt - Date.now()));

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining(Math.max(0, request.expiresAt - Date.now()));
    }, 500);
    return () => clearInterval(tick);
  }, [request.expiresAt]);

  const submit = async (decision: 'allow' | 'deny', reason?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFlash(decision);
    // 플래시 애니메이션이 보이도록 살짝 대기한 뒤 서버 응답.
    await new Promise((r) => setTimeout(r, FLASH_DURATION_MS));
    await respond(request.requestId, decision, reason);
    // respond 는 store 에서 이 모달을 제거하므로 여기서 상태 클린업 불필요.
  };

  useEffect(() => {
    if (!isTop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (busy) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        void submit('deny', 'user-cancel');
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit('allow');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // submit 은 closure 로 최신 busy 상태 포착 불가 → deps 에 busy 포함 (deps 의도적)
  }, [isTop, request.requestId, busy]);

  const seconds = Math.ceil(remaining / 1000);

  // 스택 뒤쪽 카드: 꼬리만 보이게 밀어냄.
  const translateY = depth * -STACK_OFFSET_Y; // 위로 밀어 올림
  const translateX = depth * STACK_OFFSET_X;  // 오른쪽으로 밀어냄
  const scale = 1 - depth * 0.03;             // 뒤로 갈수록 살짝 작게
  const opacity = depth === 0 ? 1 : Math.max(0.45, 1 - depth * 0.18);

  const flashOverlay = flash && (
    <div
      className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg ${
        flash === 'allow' ? 'bg-emerald-500/35' : 'bg-red-500/35'
      }`}
      style={{
        animation: `vibisual-flash-pop ${FLASH_DURATION_MS}ms ease-out forwards`,
      }}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-900/70 shadow-2xl">
        {flash === 'allow' ? (
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 12 10 18 20 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        )}
      </span>
    </div>
  );

  return (
    <div
      className="pointer-events-none fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
    >
      <div
        className="relative flex w-[520px] max-w-[92vw] flex-col rounded-lg border-2 bg-gray-900 shadow-2xl transition-all duration-200 ease-out"
        style={{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          opacity,
          pointerEvents: isTop ? 'auto' : 'none',
          borderColor: isTop ? request.agentColor : '#374151',
          boxShadow: isTop
            ? `0 0 0 1px ${request.agentColor}33, 0 25px 50px -12px rgba(0,0,0,0.8), 0 0 32px -4px ${request.agentColor}55`
            : '0 8px 16px -4px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header — 요청자 에이전트 식별용 색 dot + 스택 카운터 */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
          <span
            className="relative inline-flex h-3 w-3 flex-shrink-0 rounded-full"
            style={{ backgroundColor: request.agentColor }}
          >
            {isTop && (
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{ backgroundColor: request.agentColor, opacity: 0.6 }}
              />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-bold text-gray-100">
                {t('panel.permissionPrompt.title', { defaultValue: 'Permission required' })}
              </h3>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                {request.toolName}
              </span>
            </div>
            <span className="truncate text-[11px] text-gray-400">
              {request.agentLabel}
              {request.projectName ? ` · ${request.projectName}` : ''}
            </span>
          </div>
          {total > 1 && (
            <span
              className="flex-shrink-0 rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] font-bold text-amber-200"
              title={t('panel.permissionPrompt.stackCount', { defaultValue: '{{current}} of {{total}} pending', current: indexFromTop + 1, total })}
            >
              {indexFromTop + 1} / {total}
            </span>
          )}
          <span className="ml-2 flex-shrink-0 rounded bg-gray-800 px-2 py-0.5 font-mono text-[10px] text-gray-400">
            {seconds}s
          </span>
        </div>

        {/* Body — tool_input 요약 */}
        <div className="flex max-h-64 flex-col gap-2 overflow-auto px-4 py-3">
          <div className="text-[11px] text-gray-500">
            {t('panel.permissionPrompt.bodyHint', {
              defaultValue: 'This agent is about to call a tool. Approve or deny to continue.',
            })}
          </div>
          <pre className="whitespace-pre-wrap break-words rounded border border-gray-800 bg-gray-950/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-200">
            {formatToolInput(request.toolInput ?? {}, t('panel.permissionPrompt.emptyToolInput', { defaultValue: '(empty)' }))}
          </pre>
        </div>

        {/* Deny reason (optional) */}
        <div className="border-t border-gray-800 px-4 py-2">
          <label className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>{t('panel.permissionPrompt.denyReasonLabel', { defaultValue: 'Deny reason (optional)' })}</span>
          </label>
          <input
            type="text"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder={t('panel.permissionPrompt.denyReasonPlaceholder', { defaultValue: 'e.g. wrong path, unsafe command' })}
            className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 outline-none focus:border-red-500"
          />
        </div>

        {/* Footer — Allow / Deny */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-700 px-4 py-3">
          <span className="text-[10px] text-gray-600">
            {t('panel.permissionPrompt.shortcutHint', { defaultValue: 'Ctrl+Enter = Allow · Esc = Deny' })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit('deny', denyReason.trim() || undefined)}
              disabled={busy}
              className="rounded bg-red-600/80 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-100 ease-out hover:bg-red-500 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-95 active:bg-red-700 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('panel.permissionPrompt.deny', { defaultValue: 'Deny' })}
            </button>
            <button
              type="button"
              onClick={() => submit('allow')}
              disabled={busy}
              className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-100 ease-out hover:bg-emerald-500 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-95 active:bg-emerald-700 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('panel.permissionPrompt.allow', { defaultValue: 'Allow' })}
            </button>
          </div>
        </div>

        {flashOverlay}
      </div>
    </div>
  );
}

/** @keyframes inline 주입 — 플래시/ping 애니메이션. Tailwind 커스텀 키프레임 회피용. */
function InlineStyles(): React.JSX.Element {
  return (
    <style>{`
      @keyframes vibisual-flash-pop {
        0%   { opacity: 0; transform: scale(0.85); }
        40%  { opacity: 1; transform: scale(1.05); }
        100% { opacity: 0; transform: scale(1.1); }
      }
    `}</style>
  );
}

/**
 * §5.3 #12-1 v1.43 — 모든 대기 중인 권한 요청을 스택 모달로 렌더.
 * 오래된 요청이 배열 앞, 최신이 뒤. 최신(top)이 전면에 보이고 이전 요청은 뒤쪽 꼬리로 쌓인다.
 * 포커스·키보드는 top 만 받음. 한 장짜리 반투명 backdrop 이 전체 덮음.
 */
export function PermissionPromptStack(): React.JSX.Element | null {
  const pending = useGraphStore((s) => s.pendingPermissions);
  // §5.3 #12-1 v2.64 — 윈도우/프로젝트 격리. pendingPermissions 는 전역(모든 broadcast 수신)
  // 이지만, 이 윈도우가 보고 있는 프로젝트(activeProject — 메인은 현재 탭, 별창은
  // setActiveProjectLocal 로 set 한 자기 단일 탭)의 카드만 띄운다. §3.5 상 같은 프로젝트는
  // 메인·별창 중 한 곳에만 활성 노출되므로, 이 필터로 (1) 다른 프로젝트로 전환 시 이전
  // 프로젝트 팝업이 따라오는 누출, (2) 멀티뷰에서 같은 카드가 여러 창에 중복 표시되는 문제가
  // 동시에 차단된다. projectName 이 비어 귀속 불명한 요청만 안전망으로 모든 창에 표시.
  const activeProject = useGraphStore((s) => s.activeProject);

  // 부트 시 서버 재연결 — 대기 목록 복구
  useEffect(() => {
    let cancelled = false;
    fetch('/api/permission-pending')
      .then((r) => r.json())
      .then((data: { ok: boolean; pending: PermissionRequest[] }) => {
        if (cancelled || !data.ok) return;
        const store = useGraphStore.getState();
        store.setPendingPermissions(data.pending ?? []);
      })
      .catch(() => {});
    // §5.3 #12-2 v2.26 — AskUserQuestion broker 도 같은 부팅 시점에 복구.
    // 별도 컴포넌트 분리 비용 회피용으로 같은 자리에서 fetch — UI 렌더는 IDE 안 인라인 카드라
    // PermissionPromptStack 의 모달 렌더와 충돌하지 않는다.
    fetch('/api/ask-user-question/pending')
      .then((r) => r.json())
      .then((data: { ok: boolean; pending: import('@vibisual/shared').AskUserQuestionRequest[] }) => {
        if (cancelled || !data.ok) return;
        const store = useGraphStore.getState();
        store.setPendingAskQuestions(data.pending ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const ordered = useMemo(() => {
    // createdAt 오래된 순(뒤에 쌓임) → 최신은 배열 마지막 = top
    return Object.values(pending)
      .filter((req) => !req.projectName || req.projectName === activeProject)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [pending, activeProject]);

  if (ordered.length === 0) return null;

  const total = ordered.length;

  return createPortal(
    <>
      <InlineStyles />
      {/* 단일 backdrop — 여러 모달 겹침 대응 (각 모달마다 덮지 않음) */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
        style={{ zIndex: BASE_Z - 1 }}
      />
      {ordered.map((req, i) => {
        // i 는 오래된 → 최신(top), depth 는 top=0, 뒤로 갈수록 ↑ (꼬리)
        const indexFromTop = total - 1 - i;
        const isTop = indexFromTop === 0;
        const zIndex = BASE_Z + i;
        return (
          <PermissionModal
            key={req.requestId}
            request={req}
            zIndex={zIndex}
            depth={indexFromTop}
            isTop={isTop}
            indexFromTop={indexFromTop}
            total={total}
          />
        );
      })}
    </>,
    document.body,
  );
}
