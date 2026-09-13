import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHAT_PAIR_TICKET_TTL_MS,
  type ChatBridgeState, type ChatChannelKind, type ChatChannelState, type ChatVerbosity,
} from '@vibisual/shared';
import { drawQrToCanvas, downloadCanvasPng } from '../../utils/qrCanvas';

// §4 메신저 원격제어 브리지 — **원격 접속 창의 한 칸**(판올림 번호 발급 대기).
//
// 종전에는 두 메신저가 한 모달 안의 **좌우 탭**이었고, 그 모달은 모바일 웹과 **별개의 창**이었다.
// 이제 텔레그램·디스코드가 각각 사이드바의 자기 칸을 갖는다 — 채널마다 봇도 토큰도 페어링도
// 따로이므로 탭보다 칸이 맞는 단위다(옵션 창이 카테고리를 나누는 것과 같은 이유).
//
// 이 화면의 목적은 그대로다: **봇 설정에서 사람이 가장 많이 막히는 자리를 없애는 것.**
// ① 봇 만들기 링크와 명령을 복사 버튼으로 → ② 토큰을 넣는 즉시 검증해 봇 이름을 보여 줌 →
// ③ QR 을 찍으면 chat id 가 자동으로 묶인다. 단계는 셋이고, 각 단계는 앞 단계가 끝나야 열린다.

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

interface ChatChannelSectionProps {
  kind: ChatChannelKind;
  state: ChatBridgeState | null;
  onState: (state: ChatBridgeState) => void;
}

export function ChatChannelSection({ kind, state, onState }: ChatChannelSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const [tokenDraft, setTokenDraft] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 칸을 옮기면 그 채널의 입력 상태를 새로 시작한다(남의 검증 결과가 따라오면 안 된다).
  useEffect(() => {
    setTokenDraft('');
    setVerifiedName(null);
    setVerifyError(null);
  }, [kind]);

  const channel: ChatChannelState | undefined = useMemo(
    () => state?.channels.find((c) => c.kind === kind),
    [state, kind],
  );

  const ticket = channel?.pairTicket ?? null;

  // 티켓이 살아 있는 동안만 1초 카운트다운을 돌린다.
  useEffect(() => {
    if (!ticket) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticket]);

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
      const result = await chat.verifyToken(kind, tokenDraft.trim());
      if (!result.ok) {
        setVerifyError(result.error ?? 'network');
        return;
      }
      setVerifiedName(result.botName ?? null);
      onState(await chat.setToken(kind, tokenDraft.trim()));
      setTokenDraft('');
    } catch {
      setVerifyError('network');
    } finally {
      setVerifying(false);
    }
  }, [kind, tokenDraft, verifying, onState]);

  const handleToggle = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || !channel || busy) return;
    setBusy(true);
    try {
      onState(channel.enabled ? await chat.disable(kind) : await chat.enable(kind));
    } catch {
      // main 쪽 실패는 status push 로 반영된다.
    } finally {
      setBusy(false);
    }
  }, [busy, kind, channel, onState]);

  const handleIssuePair = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || busy) return;
    setBusy(true);
    try {
      onState(ticket ? await chat.revokePair(kind) : await chat.issuePair(kind));
    } catch { /* 상태 push 로 반영 */ } finally { setBusy(false); }
  }, [ticket, busy, kind, onState]);

  const handleUnpair = useCallback(async (peerKind: ChatChannelKind, chatId: string) => {
    const chat = window.api?.chat;
    if (!chat) return;
    try { onState(await chat.unpair(peerKind, chatId)); } catch { /* 상태 push 로 반영 */ }
  }, [onState]);

  const handleVerbosity = useCallback(async (verbosity: ChatVerbosity) => {
    const chat = window.api?.chat;
    if (!chat) return;
    try { onState(await chat.setVerbosity(verbosity)); } catch { /* 상태 push 로 반영 */ }
  }, [onState]);

  const handleClearToken = useCallback(async () => {
    const chat = window.api?.chat;
    if (!chat || busy) return;
    setBusy(true);
    try {
      onState(await chat.setToken(kind, ''));
      setVerifiedName(null);
    } catch { /* 상태 push 로 반영 */ } finally { setBusy(false); }
  }, [kind, busy, onState]);

  const ttlMinutes = Math.round(CHAT_PAIR_TICKET_TTL_MS / 60000);
  const peers = (state?.peers ?? []).filter((p) => p.kind === kind);
  const online = channel?.status === 'online';
  const createCommand = CREATE_COMMAND[kind];

  return (
    <div>
      <div className="border-b border-gray-700/50 pb-2">
        <h4 className="text-sm font-semibold text-gray-200">{t(`panel.remoteControl.channel.${kind}`)}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{t('panel.remoteControl.subtitle')}</p>
      </div>

      <div className="mt-4">
        {/* ① 봇 만들기 */}
        <StepBlock index={1} label={t('panel.remoteControl.step1')} done={channel?.hasToken === true}>
          <div className="flex items-center gap-2">
            <a
              href={CREATE_URL[kind]}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-gray-950 transition-colors hover:bg-sky-400"
            >
              {t(`panel.remoteControl.open.${kind}`)}
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
          <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t(`panel.remoteControl.step1Hint.${kind}`)}</p>
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
                          if (c) downloadCanvasPng(c, `vibisual-${kind}-pair.png`);
                        }}
                        className="rounded-md border border-white/[0.08] px-2 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.08]"
                      >
                        {t('panel.remoteControl.savePng')}
                      </button>
                    </div>
                  </div>
                  {/*
                    §4 ④ — 페어링은 두 채널 모두 **1:1 DM 에서만** 받는다. 길드 채널·그룹에서
                    묶으면 화이트리스트의 단위가 사람이 아니라 그 방의 구성원 전원이 되는데,
                    아래 목록에는 명령을 친 한 사람 이름만 떠서 화면이 범위를 잘못 말한다.
                  */}
                  <p className="mt-3 flex items-start gap-1.5 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-amber-300/90">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4" /><path d="M12 17h.01" />
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    </svg>
                    <span>{t('panel.remoteControl.dmOnlyHint')}</span>
                  </p>
                  {ticket.command && (
                    <div className="mt-3">
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] text-gray-200">{p.label}</span>
                      {/*
                        DM 전용 규칙이 생기기 전에 묶인 대화는 방 전체가 조작할 수 있다.
                        끊지 않고 남기되(사용자의 것이다) **그렇다고 말은 해 준다** —
                        이름 하나만 보여 주면 화면이 범위를 잘못 말하게 된다.
                      */}
                      {p.direct !== true && (
                        <span
                          title={t('panel.remoteControl.sharedChatWarning')}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[12px] font-medium text-amber-300"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          {t('panel.remoteControl.sharedChatBadge')}
                        </span>
                      )}
                    </span>
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

        {/* 전송량 정책 — **채널 공통 설정**이라 두 칸 어디서 바꿔도 같은 값이다.
            한 칸에만 두면 그 칸을 안 여는 사용자에게는 없는 손잡이가 되므로 양쪽에 두되,
            화면이 "함께 적용된다"고 말해 준다(값은 하나 · `ChatBridgeState.verbosity`). */}
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
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            {t('panel.remoteControl.verbosityShared')}
          </p>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t('panel.remoteControl.securityNote')}</p>
      </div>
    </div>
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
