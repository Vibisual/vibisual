import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChatBridgeState, ChatChannelKind, MobileAccessState } from '@vibisual/shared';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { WINDOW_NAV_BODY, WINDOW_NAV_LIST, WINDOW_NAV_PANE, windowNavItemClass } from '../Layout/windowNav.js';
import { MobileAccessSection } from './MobileAccessSection';
import { ChatChannelSection } from './ChatChannelSection';

// §4 — 원격 접속 창: 이 PC 에 닿는 길 셋(폰 브라우저·텔레그램·디스코드)을 옵션 창 구조(좌측 카테고리 + 우측 패널)로. IPC 는 기존 `window.api.mobile` / `window.api.chat`.
// 상태 구독은 셸이 한 번 — 칸마다 하면 안 보이는 칸의 사이드바 점이 회색으로 남는다.

/** 사이드바의 칸 하나 = 이 PC 에 닿는 한 가지 길. */
export type RemoteAccessCategory = 'mobile' | ChatChannelKind;

const CATEGORIES: RemoteAccessCategory[] = ['mobile', 'telegram', 'discord'];

/** 점 색 — 초록=지금 붙어 있음 · 호박=연결 중 · 빨강=실패 · 회색=꺼짐. 세 칸이 같은 규칙을 쓴다. */
function dotClass(tone: 'on' | 'connecting' | 'error' | 'off'): string {
  if (tone === 'on') return 'bg-emerald-400';
  if (tone === 'connecting') return 'bg-amber-400';
  if (tone === 'error') return 'bg-red-400';
  return 'bg-gray-600';
}

function CategoryIcon({ category }: { category: RemoteAccessCategory }): React.JSX.Element {
  const common = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.5',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (category === 'mobile') {
    return (
      <svg {...common}>
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (category === 'telegram') {
    // 종이비행기 — 텔레그램의 통념적 상징을 lucide 톤 stroke 로.
    return (
      <svg {...common}>
        <path d="M21.5 3.5 2.5 10.2a.5.5 0 0 0 .04.94l4.7 1.42 1.77 5.3a.5.5 0 0 0 .87.16l2.5-2.9 4.7 3.45a.5.5 0 0 0 .79-.29l3.3-14.2a.5.5 0 0 0-.67-.58z" />
        <path d="m7.24 12.56 11-7.3-7.9 8.7" />
      </svg>
    );
  }
  // 디스코드 — 말풍선 두 개(게임 채팅) stroke.
  return (
    <svg {...common}>
      <path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" />
      <path d="M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 0 1-4.2-.9L3 21l1.9-4.8A7.6 7.6 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

interface RemoteAccessWindowProps {
  open: boolean;
  onClose: () => void;
}

export function RemoteAccessWindow({ open, onClose }: RemoteAccessWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [category, setCategory] = useState<RemoteAccessCategory>('mobile');
  const [mobileState, setMobileState] = useState<MobileAccessState | null>(null);
  const [chatState, setChatState] = useState<ChatBridgeState | null>(null);

  // §4 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('remote-access', open);
    return () => setCanvasCover('remote-access', false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mobile = window.api?.mobile;
    if (!mobile) return;
    void mobile.getState().then(setMobileState).catch(() => {});
    return mobile.onStatus(setMobileState);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const chat = window.api?.chat;
    if (!chat) return;
    void chat.getState().then(setChatState).catch(() => {});
    return chat.onStatus(setChatState);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const labelOf = useCallback((c: RemoteAccessCategory): string => (
    c === 'mobile'
      ? t('panel.remoteAccess.categories.mobile')
      : t(`panel.remoteControl.channel.${c}`)
  ), [t]);

  const toneOf = useCallback((c: RemoteAccessCategory): 'on' | 'connecting' | 'error' | 'off' => {
    if (c === 'mobile') return mobileState?.enabled === true ? 'on' : 'off';
    const channel = chatState?.channels.find((ch) => ch.kind === c);
    if (channel?.status === 'online') return 'on';
    if (channel?.status === 'connecting') return 'connecting';
    if (channel?.status === 'error') return 'error';
    return 'off';
  }, [mobileState, chatState]);

  const backdrop = useBackdropDismiss(onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" {...backdrop}>
      <div
        className="flex h-[640px] max-h-[92dvh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h.01" />
              <path d="M8.5 16.4a5 5 0 0 1 7 0" />
              <path d="M5 12.9a10 10 0 0 1 14 0" />
              <path d="M1.5 9.4a15 15 0 0 1 21 0" />
            </svg>
            {t('panel.remoteAccess.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-9 pointer-coarse:w-9"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body — 좌측 사이드바 + 우측 패널 (옵션 창과 같은 뼈대 — `windowNav` 한 벌). 폰에선 사이드바가 본문 위 가로 띠. */}
        <div className={WINDOW_NAV_BODY}>
          {/* Sidebar */}
          <div className={WINDOW_NAV_LIST}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={windowNavItemClass(category === c)}
              >
                <span className="text-gray-500"><CategoryIcon category={c} /></span>
                <span className="min-w-0 flex-1 truncate">{labelOf(c)}</span>
                {/* 켜져 있는 길을 사이드바에서 바로 본다 — 칸을 하나씩 열어 보지 않아도 된다. */}
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(toneOf(c))}`} />
              </button>
            ))}
          </div>

          {/* Right pane */}
          <div className={WINDOW_NAV_PANE}>
            {category === 'mobile'
              ? <MobileAccessSection state={mobileState} onState={setMobileState} />
              : <ChatChannelSection kind={category} state={chatState} onState={setChatState} />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
