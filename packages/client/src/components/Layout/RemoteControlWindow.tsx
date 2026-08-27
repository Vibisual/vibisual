import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CHAT_PAIR_TICKET_TTL_MS,
  type ChatBridgeState, type ChatChannelKind, type ChatChannelState, type ChatVerbosity,
} from '@vibisual/shared';
import { drawQrToCanvas, downloadCanvasPng } from '../../utils/qrCanvas';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

// 메신저 원격제어 모달 — SCENARIO.md §4 (판올림 번호 발급 대기).
//
// File 메뉴 > Remote Control. main 의 chat 브리지가 SSOT 인 상태(ChatBridgeState)를
// window.api.chat 으로 조회/구독하고, 여기서는 표시 + 액션만 한다(Mobile Access 선례).
//
// 이 화면의 목적은 하나다: **봇 설정에서 사람이 가장 많이 막히는 자리를 없애는 것.**
// ① 봇 만들기 링크와 명령을 복사 버튼으로 준다 → ② 토큰을 넣는 즉시 검증해 **봇 이름을 보여
// 준다**(맞게 넣었는지 눈으로 확인) → ③ QR 을 찍으면 chat id 가 자동으로 묶인다(숫자를 사람이
// 알아낼 필요가 없다). 그래서 단계가 셋이고, 각 단계는 앞 단계가 끝나야 열린다.

const CHANNELS: ChatChannelKind[] = ['telegram', 'discord'];

/** 봇을 만드는 곳 — 채널마다 다르다. 새 창은 main 의 setWindowOpenHandler 가 OS 브라우저로 보낸다. */
const CREATE_URL: Record<ChatChannelKind, string> = {
  telegram: 'https://t.me/BotFather',
  discord: 'https://discord.com/developers/applications',
};

/** 그 자리에서 그대로 쓰는 명령(텔레그램만 — 디스코드는 화면에서 버튼을 누른다). */
const CREATE_COMMAND: Record<ChatChannelKind, string | null> = {
  telegram: '/newbot',
  discord: null,
};

/** 남은 시간을 mm:ss 로. 만료됐으면 0:00. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

interface RemoteControlWindowProps {
  open: boolean;
  onClose: () => void;
}

export function RemoteControlWindow({ open, onClose }: RemoteControlWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [state, setState] = useState<ChatBridgeState | null>(null);
  const [active, setActive] = useState<ChatChannelKind>('telegram');
  const [tokenDraft, setTokenDraft] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // §4 v3.71 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('remote-control', open);
    return () => setCanvasCover('remote-control', false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const chat = window.api?.chat;
    if (!chat) return;
    void chat.getState().then(setState).catch(() => {});
    const off = chat.onStatus(setState);
    return off;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // 탭을 옮기면 그 채널의 입력 상태를 새로 시작한다(남의 검증 결과가 따라오면 안 된다).
  useEffect(() => {
    setTokenDraft('');
    setVerifiedName(null);
    setVerifyError(null);
  }, [active]);

  const channel: ChatChannelState | undefined = useMemo(
    () => state?.channels.find((c) => c.kind === active),
    [state, active],
  );

  const ticket = channel?.pairTicket ?? null;

  // 티켓이 살아 있는 동안만 1초 카운트다운을 돌린다.
  useEffect(() => {
    if (!open || !ticket) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, ticket]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !ticket?.url) return;
    void drawQrToCanvas(canvas, ticket.url).catch(() => {
      // 인코딩 실패 — 아래 주소 텍스트가 폴백으로 남는다.
    });
  }, [ticket?.url]);

  const copy = useCallback((text: string, tag: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    }).catch(() => {});
  }, []);

  const handleVerifyAndSave = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || verifying || !tokenDraft.trim()) return;
    setVerifying(true);
    setVerifyError(null);
    setVerifiedName(null);
    try {
      const result = await chat.verifyToken(active, tokenDraft.trim());
      if (!result.ok) {
        setVerifyError(result.error ?? 'network');
        return;
      }
      setVerifiedName(result.botName ?? null);
      setState(await chat.setToken(active, tokenDraft.trim()));
      setTokenDraft('');
    } catch {
      setVerifyError('network');
    } finally {
      setVerifying(false);
    }
  }, [active, tokenDraft, verifying]);

  const handleToggle = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || !channel || busy) return;
    setBusy(true);
    try {
      setState(channel.enabled ? await chat.disable(active) : await chat.enable(active));
    } catch {
      // main 쪽 실패는 status push 로 반영된다.
    } finally {
      setBusy(false);
    }
  }, [busy, active, channel]);

  const handleIssuePair = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || busy) return;
    setBusy(true);
    try {
      setState(ticket ? await chat.revokePair(active) : await chat.issuePair(active));
    } catch { /* 상태 push 로 반영 */ } finally { setBusy(false); }
  }, [ticket, busy, active]);

  const handleUnpair = useCallback(async (kind: ChatChannelKind, chatId: string) => {
    const chat = window.api?.chat;
    if (!chat) return;
    try { setState(await chat.unpair(kind, chatId)); } catch { /* 상태 push 로 반영 */ }
  }, []);

  const handleVerbosity = useCallback(async (verbosity: ChatVerbosity) => {
    const chat = window.api?.chat;
    if (!chat) return;
    try { setState(await chat.setVerbosity(verbosity)); } catch { /* 상태 push 로 반영 */ }
  }, []);

  const handleClearToken = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || busy) return;
    setBusy(true);
    try {
      setState(await chat.setToken(active, ''));
      setVerifiedName(null);
    } catch { /* 상태 push 로 반영 */ } finally { setBusy(false); }
  }, [active, busy]);

  const backdrop = useBackdropDismiss(onClose);

  if (!open) return null;

  const ttlMinutes = Math.round(CHAT_PAIR_TICKET_TTL_MS / 60000);
  const peers = (state?.peers ?? []).filter((p) => p.kind === active);
  const online = channel?.status === 'online';
  const createCommand = CREATE_COMMAND[active];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" {...backdrop}>
      <div
        className="max-h-[88vh] w-[460px] max-w-[92vw] overflow-y-auto rounded-xl border border-white/[0.08] bg-gray-900/95 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-4.5 w-4.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" />
              <path d="M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 0 1-4.2-.9L3 21l1.9-4.8A7.6 7.6 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h2 className="text-[15px] font-semibold text-white">{t('panel.remoteControl.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-gray-400">{t('panel.remoteControl.subtitle')}</p>

        {/* 채널 탭 */}
        <div className="mb-4 flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] p-1">
          {CHANNELS.map((kind) => {
            const st = state?.channels.find((c) => c.kind === kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActive(kind)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active === kind ? 'bg-white/[0.10] text-white' : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
                }`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${st?.status === 'online' ? 'bg-emerald-400' : st?.status === 'error' ? 'bg-red-400' : 'bg-gray-600'}`} />
                {t(`panel.remoteControl.channel.${kind}`)}
              </button>
            );
          })}
        </div>

        {/* ① 봇 만들기 */}
        <StepBlock index={1} label={t('panel.remoteControl.step1')} done={channel?.hasToken === true}>
          <div className="flex items-center gap-2">
            <a
              href={CREATE_URL[active]}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-gray-950 transition-colors hover:bg-sky-400"
            >
              {t(`panel.remoteControl.open.${active}`)}
            </a>
            {createCommand && (
              <button
                type="button"
                onClick={() => copy(createCommand, 'cmd')}
                className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 font-mono text-[12px] text-gray-300 transition-colors hover:bg-white/[0.08]"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                {copied === 'cmd' ? t('panel.remoteControl.copied') : createCommand}
              </button>
            )}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t(`panel.remoteControl.step1Hint.${active}`)}</p>
        </StepBlock>

        {/* ② 토큰 */}
        <StepBlock index={2} label={t('panel.remoteControl.step2')} done={channel?.hasToken === true}>
          {channel?.hasToken ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <span className="text-[12px] text-emerald-300">
                {t('panel.remoteControl.tokenSaved', { name: channel.botName ?? verifiedName ?? '—' })}
              </span>
              <button
                type="button"
                onClick={() => void handleClearToken()}
                disabled={busy}
                className="rounded-md px-2 py-1 text-[12px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
              >
                {t('panel.remoteControl.clearToken')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder={t('panel.remoteControl.tokenPlaceholder')}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
                />
                <button
                  type="button"
                  onClick={() => void handleVerifyAndSave()}
                  disabled={verifying || !tokenDraft.trim()}
                  className={`shrink-0 rounded-md bg-sky-500 px-3 py-2 text-[12px] font-medium text-gray-950 transition-colors hover:bg-sky-400 ${verifying || !tokenDraft.trim() ? 'opacity-50' : ''}`}
                >
                  {verifying ? t('panel.remoteControl.verifying') : t('panel.remoteControl.verify')}
                </button>
              </div>
              {verifyError && (
                <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                  {t(`panel.remoteControl.error.${verifyError}`, { defaultValue: t('panel.remoteControl.error.network') })}
                </div>
              )}
            </>
          )}
        </StepBlock>

        {/* ③ 켜고 QR 로 연결 */}
        <StepBlock index={3} label={t('panel.remoteControl.step3')} done={peers.length > 0}>
          <div className="mb-2 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : channel?.status === 'connecting' ? 'bg-amber-400' : channel?.status === 'error' ? 'bg-red-400' : 'bg-gray-600'}`} />
              <span className="text-[13px] text-gray-200">
                {t(`panel.remoteControl.status.${channel?.status ?? 'off'}`)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleToggle()}
              disabled={busy || !channel?.hasToken}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                channel?.enabled
                  ? 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.14]'
                  : 'bg-sky-500 text-gray-950 hover:bg-sky-400'
              } ${busy || !channel?.hasToken ? 'opacity-50' : ''}`}
            >
              {channel?.enabled ? t('panel.remoteControl.disable') : t('panel.remoteControl.enable')}
            </button>
          </div>

          {channel?.error && (
            <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-300">
              {t(`panel.remoteControl.error.${channel.error}`, { defaultValue: t('panel.remoteControl.error.network') })}
            </div>
          )}

          {online && (
            <>
              <button
                type="button"
                onClick={() => void handleIssuePair()}
                disabled={busy}
                className="w-full rounded-md border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-gray-200 transition-colors hover:bg-white/[0.08]"
              >
                {ticket ? t('panel.remoteControl.revokeQr') : t('panel.remoteControl.issueQr', { minutes: ttlMinutes })}
              </button>

              {ticket && (
                <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/30 p-3">
                  <div className="flex items-start gap-3">
                    <canvas ref={qrCanvasRef} className="shrink-0 rounded bg-white" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] uppercase tracking-wide text-gray-500">
                        {t('panel.remoteControl.expiresIn')}
                      </div>
                      <div className="mb-2 font-mono text-[16px] font-semibold text-white">
                        {formatRemaining(ticket.expiresAt - now)}
                      </div>
                      <div className="mb-2 break-all font-mono text-[12px] leading-relaxed text-gray-500">{ticket.url}</div>
                      <button
                        type="button"
                        onClick={() => {
                          const c = qrCanvasRef.current;
                          if (c) downloadCanvasPng(c, `vibisual-${active}-pair.png`);
                        }}
                        className="rounded-md border border-white/[0.08] px-2 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.08]"
                      >
                        {t('panel.remoteControl.savePng')}
                      </button>
                    </div>
                  </div>
                  {ticket.command && (
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <p className="mb-1.5 text-[12px] leading-relaxed text-gray-400">
                        {t('panel.remoteControl.discordPairHint')}
                      </p>
                      <button
                        type="button"
                        onClick={() => { if (ticket.command) copy(ticket.command, 'pair'); }}
                        className="w-full break-all rounded-md border border-white/[0.08] bg-black/40 px-2.5 py-2 text-left font-mono text-[12px] text-sky-300 transition-colors hover:bg-white/[0.06]"
                      >
                        {copied === 'pair' ? t('panel.remoteControl.copied') : ticket.command}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 연결된 대화 */}
          {peers.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
                {t('panel.remoteControl.pairedChats')}
              </div>
              <div className="space-y-1">
                {peers.map((p) => (
                  <div key={`${p.kind}:${p.chatId}`} className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                    <span className="truncate text-[12px] text-gray-200">{p.label}</span>
                    <button
                      type="button"
                      onClick={() => void handleUnpair(p.kind, p.chatId)}
                      className="shrink-0 rounded-md px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                    >
                      {t('panel.remoteControl.unpair')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </StepBlock>

        {/* 전송량 정책 */}
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-gray-500">
            {t('panel.remoteControl.verbosityTitle')}
          </div>
          <div className="flex gap-1 rounded-md bg-black/30 p-1">
            {(['cards', 'full'] as ChatVerbosity[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => void handleVerbosity(v)}
                className={`flex-1 rounded px-2 py-1.5 text-[12px] transition-colors ${
                  (state?.verbosity ?? 'cards') === v ? 'bg-white/[0.12] text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t(`panel.remoteControl.verbosity.${v}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
            {t(`panel.remoteControl.verbosityHint.${state?.verbosity ?? 'cards'}`)}
          </p>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t('panel.remoteControl.securityNote')}</p>
      </div>
    </div>,
    document.body,
  );
}

interface StepBlockProps {
  index: number;
  label: string;
  done: boolean;
  children: React.ReactNode;
}

/** 단계 하나. 끝난 단계는 번호 자리에 체크가 들어가 "여기까지 됐다"가 한눈에 보인다. */
function StepBlock({ index, label, done, children }: StepBlockProps): React.JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[12px] font-semibold ${
          done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.08] text-gray-400'
        }`}>
          {done ? (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : index}
        </span>
        <span className="text-[12px] font-medium text-gray-300">{label}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}
