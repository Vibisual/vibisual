import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { foldPermissionChoice, type PermissionChoice, type PermissionRequest } from '@vibisual/shared';
// §5.3 #12-1-B — 발 줄의 답 넷(순서·글자·"항상" 제목)은 순수 함수 한 곳에서 짓는다.
import { permissionFooterButtons } from '../../utils/permissionChoices.js';
import { restorePendingPrompts } from '../../utils/pendingPrompts.js';
import { CODEX_TOOL_GROUP_NAMES } from '../Panel/CodexToolPermissions.js';
// §5.22 — 위험 배지는 타임라인과 **같은 색·같은 라벨**을 쓴다(두 화면이 어긋나면 못 믿는다).
import { riskLabelKey, riskToneClass } from '../../utils/auditLog.js';
// §5.3 #12-3 — 자물쇠 띠는 버블 표식·우클릭 메뉴와 **같은 그림**을 쓴다.
import { PathLockGlyph } from '../PathLockGlyph.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';
import { isImeConsumedKey } from '../../utils/inputComposition.js';
import { decideEnterKey } from '../../utils/inputEnterKey.js';

/** §5.3 #12-1 — 스택 모달 간 z-index 시작값. */
const BASE_Z = 100_000;
/** 스택 카드 cascading offset — 뒤 카드일수록 위·우측으로 밀려 꼬리만 보이게. */
const STACK_OFFSET_Y = 14;
const STACK_OFFSET_X = 10;
/** 그려 두는 카드 수(맨 앞 포함) — 깊이마다 14px 밀고 3% 줄이는 식이라 전부 그리면 화면 밖·음수 배율로 뒤집힌다. 개수는 `N / total` 배지가 말한다. */
const STACK_VISIBLE = 4;
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

  const submit = async (choice: PermissionChoice, reason?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFlash(foldPermissionChoice(choice));
    // 플래시 애니메이션이 보이도록 살짝 대기한 뒤 서버 응답.
    await new Promise((r) => setTimeout(r, FLASH_DURATION_MS));
    const ok = await respond(request.requestId, choice, reason);
    // 성공이면 store 가 이 모달을 제거했다. 서버가 "항상"을 못 받았으면 카드가 되돌아오므로 다시 누를 수 있게 푼다.
    if (!ok) {
      setBusy(false);
      setFlash(null);
    }
  };

  useEffect(() => {
    if (!isTop) return;
    // §5.3 #12-1-B — 단축키는 한 번짜리에만. "항상"은 손이 미끄러져 눌리면 안 된다.
    const onKey = (e: KeyboardEvent): void => {
      if (busy) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        void submit('reject_once', 'user-cancel');
      } else {
        // Ctrl/Cmd+Enter = 이번만 허용. 판정은 보내는 칸들과 **같은 한 곳**에서 — 입력기가 먹은
        //   키(조합 중·변환 확정)를 허용으로 세면, 거절 사유를 한글로 적다 확정하는 순간 허용이 나간다.
        //   창 전체 단축키라 칸 임자 표시(`IME_ENTER_OWNER`)는 붙지 않는다 — 임자가 될 칸이 없다.
        const enter = decideEnterKey({
          key: e.key,
          shiftKey: e.shiftKey,
          chordKey: e.ctrlKey || e.metaKey,
          imeConsumed: isImeConsumedKey(e),
          slashMatchCount: 0,
          gesture: 'chord',
        });
        if (enter.kind === 'submit') {
          e.preventDefault();
          void submit('allow_once');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // submit 은 closure 로 최신 busy 상태 포착 불가 → deps 에 busy 포함 (deps 의도적)
  }, [isTop, request.requestId, busy]);

  const seconds = Math.ceil(remaining / 1000);
  const footerButtons = permissionFooterButtons(request);
  const groupName = request.codexToolGroup ? (CODEX_TOOL_GROUP_NAMES[request.codexToolGroup] ?? request.codexToolGroup) : '';

  // 꼬리 깊이는 STACK_VISIBLE 에서 멈춘다 — 그 너머는 화면 밖·음수 배율.
  const tailDepth = Math.min(depth, STACK_VISIBLE - 1);
  const translateY = tailDepth * -STACK_OFFSET_Y; // 위로 밀어 올림
  const translateX = tailDepth * STACK_OFFSET_X;  // 오른쪽으로 밀어냄
  const scale = 1 - tailDepth * 0.03;             // 뒤로 갈수록 살짝 작게
  const opacity = tailDepth === 0 ? 1 : Math.max(0.45, 1 - tailDepth * 0.18);

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
      {/* 폰에서는 카드가 화면보다 길어진다(자물쇠·위험 띠 + 2×2 단추) — 머리줄과 [허용]/[거절]이 화면 밖으로
          잘리지 않게 카드 안에서 스크롤한다. 데스크톱은 종전 그대로(번쩍임 덮개가 카드 밖으로 커지는 연출 유지). */}
      <div
        className="relative flex w-[520px] max-w-[92vw] flex-col rounded-lg border-2 bg-gray-900 shadow-2xl transition-all duration-200 ease-out max-md:max-h-[calc(100dvh-1rem)] max-md:overflow-y-auto"
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
              {/* MCP 도구 이름(`mcp__서버__도구`)은 한 덩어리라 줄이 안 바뀐다 — 좁으면 … 로 줄여 옆 칸을 덮지 않는다. */}
              <span className="min-w-0 truncate rounded bg-amber-500/20 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-amber-300" title={request.toolName}>
                {request.toolName}
              </span>
            </div>
            <span className="truncate text-[12px] text-gray-400">
              {request.agentLabel}
              {request.projectName ? ` · ${request.projectName}` : ''}
            </span>
          </div>
          {total > 1 && (
            <span
              className="flex-shrink-0 rounded-full bg-amber-500/25 px-2 py-0.5 text-[12px] font-bold text-amber-200"
              title={t('panel.permissionPrompt.stackCount', { defaultValue: '{{current}} of {{total}} pending', current: indexFromTop + 1, total })}
            >
              {indexFromTop + 1} / {total}
            </span>
          )}
          <span className="ml-2 flex-shrink-0 rounded bg-gray-800 px-2 py-0.5 font-mono text-[12px] text-gray-400">
            {seconds}s
          </span>
        </div>

        {/* §5.3 #12-3 — 자물쇠 띠. 사용자가 직접 잠근 곳이라 **이유가 가장 먼저** 온다(위험 띠보다 위).
            무엇을 하려는지(접근 종류)와 어디를(자물쇠 대상) 말하고, 다른 탭이 건 자물쇠면 그 탭을 밝힌다. */}
        {(request.lockHits?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
            <div className="flex items-center gap-1.5">
              <PathLockGlyph className="h-3.5 w-3.5 text-amber-300" />
              <span className="text-[12px] font-semibold text-amber-200">
                {t('panel.permissionPrompt.lockedTitle', { defaultValue: 'Locked path' })}
              </span>
            </div>
            {request.lockHits!.map((hit) => (
              <div key={hit.lockId} className="flex flex-wrap items-baseline gap-1.5 text-[12px] text-amber-100/90">
                <span className="rounded border border-amber-400/40 px-1.5 py-0.5 font-semibold">
                  {t(`panel.permissionPrompt.lockAccess.${hit.access}`)}
                </span>
                <span className="break-all font-mono">{hit.target}</span>
                {hit.projectName && request.projectName && hit.projectName !== request.projectName && (
                  <span className="text-amber-200/60">
                    {t('panel.permissionPrompt.lockOtherTab', { project: hit.projectName })}
                  </span>
                )}
              </div>
            ))}
            <span className="text-[12px] leading-relaxed text-amber-200/80">
              {t('panel.permissionPrompt.lockedHint')}
            </span>
          </div>
        )}

        {/* §5.22 위험 띠 — 위험 3종 호출일 때(경계가 되돌려 물었으면 그 이유도 한 줄).
           §5.3 #12-1-A 확인 목록에 넣은 도구 호출도 같은 띠다(새 띠 ❌) — 그래서 조건이 둘. */}
        {((request.risk?.length ?? 0) > 0 || request.askedByTool === true) && (
          <div className="flex flex-col gap-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5 7.5-9.5V6Z" />
              </svg>
              <span className="text-[12px] font-semibold text-amber-200">
                {(request.risk?.length ?? 0) > 0
                  ? t('panel.audit.promptRiskTitle', { defaultValue: 'Risky action' })
                  : t('panel.permissionPrompt.askedByToolTitle', { defaultValue: 'Tool you asked to confirm' })}
              </span>
              {request.risk?.map((kind) => (
                <span key={kind} className={`rounded border px-1.5 py-0.5 text-[12px] font-semibold ${riskToneClass(kind)}`}>
                  {t(riskLabelKey(kind))}
                </span>
              ))}
            </div>
            {/* §5.3 #12-1-A — 사용자가 지목해서 붙잡힌 것이 **먼저**다. 그 사람이 방금 자기 손으로
                켠 설정이라 "왜 내 bypass 가 안 먹나"의 답이 여기 있고, 감사 경계 문구가 대신 뜨면
                켠 적 없는 기능을 원인으로 읽게 된다. */}
            {request.askedByTool === true ? (
              <span className="text-[12px] leading-relaxed text-amber-200/80">
                {t('panel.permissionPrompt.askedByToolHint', {
                  defaultValue: 'You marked {{tool}} as "ask before use" in this agent’s settings — so it asks even in Bypass mode.',
                  tool: request.toolName,
                })}
              </span>
            ) : request.escalated ? (
              <span className="text-[12px] leading-relaxed text-amber-200/80">
                {t('panel.audit.promptEscalatedHint', {
                  defaultValue: 'Your permission mode would have allowed this automatically — the audit boundary is asking first.',
                })}
              </span>
            ) : null}
          </div>
        )}

        {/* Body — tool_input 요약 */}
        <div className="flex max-h-64 flex-col gap-2 overflow-auto px-4 py-3">
          <div className="text-[12px] text-gray-500">
            {t('panel.permissionPrompt.bodyHint', {
              defaultValue: 'This agent is about to call a tool. Approve or deny to continue.',
            })}
          </div>
          <pre className="whitespace-pre-wrap break-words rounded border border-gray-800 bg-gray-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-200">
            {formatToolInput(request.toolInput ?? {}, t('panel.permissionPrompt.emptyToolInput', { defaultValue: '(empty)' }))}
          </pre>
        </div>

        {/* Deny reason (optional) */}
        <div className="border-t border-gray-800 px-4 py-2">
          <label className="flex items-center gap-2 text-[12px] text-gray-500">
            <span>{t('panel.permissionPrompt.denyReasonLabel', { defaultValue: 'Deny reason (optional)' })}</span>
          </label>
          <input
            type="text"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder={t('panel.permissionPrompt.denyReasonPlaceholder', { defaultValue: 'e.g. wrong path, unsafe command' })}
            className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 outline-none focus:border-red-500 pointer-coarse:py-2"
          />
        </div>

        {/* Footer — §5.3 #12-1-B 답 넷: [이번만 거절][항상 거절] · [항상 허용][이번만 허용] */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-700 px-4 py-3">
          {/* 키보드 안내 — 터치 화면에는 누를 키가 없으니 접는다(장식 줄이라 입구가 사라지지 않는다). */}
          <span className="text-[12px] text-gray-600 pointer-coarse:hidden">
            {t('panel.permissionPrompt.shortcutHint', { shortcut: shortcutLabel('Ctrl+Enter'), defaultValue: '{{shortcut}} = Allow · Esc = Deny' })}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            {footerButtons.map((button) => (
              <button
                key={button.choice}
                type="button"
                onClick={() => submit(button.choice, button.tone === 'deny' ? denyReason.trim() || undefined : undefined)}
                disabled={busy}
                title={button.titleKey
                  ? t(button.titleKey, { defaultValue: button.defaultTitle, tool: request.toolName, group: groupName })
                  : undefined}
                className={`rounded px-4 py-1.5 text-xs font-semibold shadow-md transition-all duration-100 ease-out hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-95 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:py-2.5 ${
                  button.always
                    ? button.tone === 'deny'
                      ? 'border border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/25 active:bg-red-500/35'
                      : 'border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/25 active:bg-emerald-500/35'
                    : button.tone === 'deny'
                      ? 'bg-red-600/80 text-white hover:bg-red-500 active:bg-red-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
                }`}
              >
                {t(button.labelKey, { defaultValue: button.defaultLabel })}
              </button>
            ))}
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

/** §5.3 #12-1 — 대기 권한 요청 스택 모달. 배열 앞이 오래된 것, top(최신)만 전면·포커스·키보드. backdrop 은 한 장. */
export function PermissionPromptStack(): React.JSX.Element | null {
  const pending = useGraphStore((s) => s.pendingPermissions);
  // §5.3 #12-1 — 이 창의 activeProject(메인 = 현재 탭, 별창 = 자기 탭) 카드만 띄운다 — 전환 시 누출·여러 창 중복을 막는다(§3.5 한 프로젝트 한 창).
  // projectName 이 빈 요청만 모든 창에.
  const activeProject = useGraphStore((s) => s.activeProject);

  // 부트 복구 — 권한 요청 + §5.3 #12-2 AskUserQuestion. 재연결 때도 같은 함수(`hooks/reconnectResync.ts`).
  useEffect(() => {
    let cancelled = false;
    restorePendingPrompts(() => cancelled);
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
        // 더미 뒤쪽은 그리지 않는다 — 보이지도 않으면서 타이머만 늘어난다(STACK_VISIBLE 주석 참고).
        if (indexFromTop >= STACK_VISIBLE) return null;
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
