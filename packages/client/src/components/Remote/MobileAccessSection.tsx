import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MOBILE_QR_TICKET_TTL_MS, MOBILE_QR_MAX_USES, type MobileAccessState } from '@vibisual/shared';
import { drawQrToCanvas, downloadCanvasPng } from '../../utils/qrCanvas';
import { MobileAddressList, mobileAddressKindLabelKey } from './MobileAddressList';

// §4 v3.16 모바일 웹 접속 — **원격 접속 창의 한 칸**(판올림 번호 발급 대기).
//
// 종전에는 이것이 File 메뉴의 독립 모달(`MobileAccessWindow`)이었다. 폰으로 이 PC 를 만지는
// 길이 둘(웹 브라우저 · 메신저)인데 **File 메뉴에 창이 둘로 서 있어** 사용자는 무엇이 무엇인지
// 알 수 없었다. 이제 셋(폰 브라우저 · 텔레그램 · 디스코드)이 한 창의 칸으로 나뉜다.
//
// 상태의 SSOT 는 여전히 main 의 mobileAccess 매니저다. 구독은 **셸이 한 번만** 하고(사이드바
// 점이 그 상태를 함께 쓴다) 여기서는 표시 + 액션만 한다.

/** 남은 시간을 mm:ss 로. 만료됐으면 0:00. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

interface MobileAccessSectionProps {
  state: MobileAccessState | null;
  onState: (state: MobileAccessState) => void;
}

export function MobileAccessSection({ state, onState }: MobileAccessSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // §4 v3.66 QR — 대상 주소 인덱스 + 1초 카운트다운용 현재 시각.
  const [qrTargetIndex, setQrTargetIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleToggle = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || !state || busy) return;
    setBusy(true);
    try {
      onState(state.enabled ? await mobile.disable() : await mobile.enable());
    } catch {
      // main 쪽 실패는 status push 로 반영된다 — 여기선 조용히 무시.
    } finally {
      setBusy(false);
    }
  }, [state, busy, onState]);

  const handleRegen = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      onState(await mobile.regenCode());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy, onState]);

  /**
   * 수동 포트포워딩의 **대상 주소** — 공유기가 아는 이 PC 의 랜 주소다.
   *
   * 종전에는 `state.publicIp` 를 넘기고 있었다. 공유기 포워딩 규칙의 "내부 대상" 칸에 공인 IP 를
   * 적으면 규칙이 서지 않거나 엉뚱한 곳을 가리킨다 — 안내를 그대로 따라 한 사용자가 공유기를
   * 잘못 설정하게 되는 자리였다(`MobileAccessState.httpsPort` 주석도 "이 LAN IP" 라고 말한다).
   * VPN 주소는 공유기가 모르는 망이라 후보가 아니다 — `lan` 만 고른다.
   */
  const forwardTargetIp = useMemo(
    () => state?.addresses.find((a) => a.kind === 'lan')?.address ?? null,
    [state],
  );

  /** 공유기 규칙을 지웠다는 확인 — 우리가 못 지우는 것이라 사람이 알려 주는 수밖에 없다. */
  const handleAckForward = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      onState(await mobile.ackManualForward());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy, onState]);

  const handleToggleExternal = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || !state || busy) return;
    setBusy(true);
    try {
      onState(state.externalEnabled ? await mobile.disableExternal() : await mobile.enableExternal());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [state, busy, onState]);

  // ─── §4 v3.66 QR 페어링 ──────────────────────────────────────────────────

  const qrTargets = useMemo(() => state?.qrTicket?.targets ?? [], [state]);
  const qrTarget = qrTargets[Math.min(qrTargetIndex, qrTargets.length - 1)] ?? null;
  const qrUrl = qrTarget?.url ?? null;
  const qrRemainingMs = state?.qrTicket ? state.qrTicket.expiresAt - now : 0;

  const handleIssueQr = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      onState(await mobile.issueQr());
      setQrTargetIndex(0);
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy, onState]);

  const handleRevokeQr = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      onState(await mobile.revokeQr());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy, onState]);

  const handleDownloadQr = useCallback(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    downloadCanvasPng(canvas, `vibisual-qr-${Date.now()}.png`);
  }, []);

  // 남은 시간 카운트다운 — 티켓이 있을 때만 1초 타이머를 돈다(만료는 main 이 push 로 알린다).
  useEffect(() => {
    if (!state?.qrTicket) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.qrTicket]);

  // 선택된 딥링크를 QR 로 그린다. 대상 주소를 바꾸면 같은 토큰으로 다시 그릴 뿐 재발급은 없다.
  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !qrUrl) return;
    void drawQrToCanvas(canvas, qrUrl).catch(() => {
      // 인코딩 실패(모듈 로드 실패 등) — 아래 주소 텍스트가 폴백으로 남는다.
    });
  }, [qrUrl]);

  const enabled = state?.enabled === true;
  const qrTtlMinutes = Math.round(MOBILE_QR_TICKET_TTL_MS / 60000);
  // 담을 주소가 하나라도 있어야 발급 의미가 있다 — LAN 이 없어도 외부 주소만 있으면 가능.
  const qrIssuable = (state?.addresses.length ?? 0) > 0 || (state?.externalUrl ?? null) !== null;

  return (
    <div>
      <div className="border-b border-gray-700/50 pb-2">
        <h4 className="text-sm font-semibold text-gray-200">{t('panel.mobileAccess.title')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{t('panel.mobileAccess.subtitle')}</p>
      </div>

      {/* on/off 토글 행 */}
      <div className="mt-4 mb-4 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          <span className="text-[13px] text-gray-200">
            {enabled ? t('panel.mobileAccess.statusOn') : t('panel.mobileAccess.statusOff')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={busy || !state}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
            enabled
              ? 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.14]'
              : 'bg-sky-500 text-gray-950 hover:bg-sky-400'
          } ${busy || !state ? 'opacity-50' : ''}`}
        >
          {enabled ? t('panel.mobileAccess.disable') : t('panel.mobileAccess.enable')}
        </button>
      </div>

      {/* 종료 후 행동 — 우리가 못 닫는 구멍의 뒷정리. 모바일 접속을 통째로 꺼도 남아야 한다
          (공유기 규칙은 우리 리스너와 무관하게 살아 있으므로) 그래서 이 자리가 바깥이다. */}
      {state?.manualForwardPending === true && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-red-200">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
            {t('panel.mobileAccess.forwardCleanupTitle')}
          </div>
          <p className="text-[12px] leading-relaxed text-red-200/85">
            {t('panel.mobileAccess.forwardCleanupBody', { external: t('panel.mobileAccess.externalTitle') })}
          </p>
          <button
            type="button"
            onClick={() => void handleAckForward()}
            disabled={busy}
            className={`mt-2 rounded-md bg-white/[0.08] px-3 py-1.5 text-[12px] text-gray-200 transition-colors hover:bg-white/[0.14] ${busy ? 'opacity-50' : ''}`}
          >
            {t('panel.mobileAccess.forwardCleanupDone')}
          </button>
        </div>
      )}

      {enabled && state && (
        <>
          {/* 접속 주소 — 정체·조건·복사까지 MobileAddressList 가 그린다. */}
          <div className="mb-3">
            <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
              {t('panel.mobileAccess.url')}
            </div>
            {state.addresses.length > 0 ? (
              <MobileAddressList addresses={state.addresses} />
            ) : (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                {t('panel.mobileAccess.noNetwork')}
              </div>
            )}
          </div>

          {/* 페어링 코드 */}
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-medium uppercase tracking-wide text-gray-500">
                {t('panel.mobileAccess.pairingCode')}
              </span>
              <button
                type="button"
                onClick={() => void handleRegen()}
                disabled={busy}
                className="rounded-md px-2 py-1 text-[12px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
              >
                {t('panel.mobileAccess.regen')}
              </button>
            </div>
            <div className="rounded-md border border-white/[0.06] bg-black/30 px-3 py-3 text-center font-mono text-[26px] font-semibold tracking-[0.35em] text-white">
              {state.pairingCode ?? '—'}
            </div>
            {state.pairingLocked ? (
              <p className="mt-1.5 text-[12px] text-red-400">{t('panel.mobileAccess.locked')}</p>
            ) : (
              <p className="mt-1.5 text-[12px] text-gray-500">{t('panel.mobileAccess.pairingHint')}</p>
            )}
          </div>

          {/* §4 v3.66 — QR 페어링(3분 티켓) */}
          <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="7" height="7" x="3" y="3" rx="1" />
                  <rect width="7" height="7" x="14" y="3" rx="1" />
                  <rect width="7" height="7" x="3" y="14" rx="1" />
                  <path d="M14 14h3v3h-3z" /><path d="M20 14v.01" /><path d="M14 20v.01" /><path d="M20 20v.01" />
                </svg>
                <span className="text-[13px] font-medium text-gray-200">{t('panel.mobileAccess.qrTitle')}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleIssueQr()}
                disabled={busy || !qrIssuable}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  state.qrTicket
                    ? 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.14]'
                    : 'bg-sky-500 text-gray-950 hover:bg-sky-400'
                } ${busy || !qrIssuable ? 'opacity-50' : ''}`}
              >
                {state.qrTicket ? t('panel.mobileAccess.qrReissue') : t('panel.mobileAccess.qrIssue')}
              </button>
            </div>
            <p className="text-[12px] leading-relaxed text-gray-500">
              {t('panel.mobileAccess.qrSubtitle', { minutes: qrTtlMinutes, max: MOBILE_QR_MAX_USES })}
            </p>

            {state.qrTicket && qrUrl && (
              <div className="mt-3">
                {/* 대상 주소 선택 — 칩도 접속 주소 목록과 **같은 종류 이름**을 쓴다. */}
                {qrTargets.length > 1 && (
                  <>
                    <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
                      {t('panel.mobileAccess.qrTarget')}
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {qrTargets.map((target, i) => (
                        <button
                          key={target.url}
                          type="button"
                          onClick={() => setQrTargetIndex(i)}
                          title={target.adapter}
                          className={`rounded-md border px-2 py-1 font-mono text-[12px] transition-colors ${
                            target === qrTarget
                              ? 'border-sky-400/40 bg-sky-500/15 text-sky-200'
                              : 'border-white/[0.06] bg-black/20 text-gray-400 hover:bg-white/[0.06]'
                          }`}
                        >
                          <span className="mr-1 font-sans text-[12px] tracking-wide opacity-70">
                            {target.product ?? t(mobileAddressKindLabelKey(target.kind))}
                          </span>
                          {target.address}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="flex flex-col items-center gap-2">
                  {/* 캔버스 실제 크기는 drawQrToCanvas 가 DPR 에 맞춰 잡는다 — 여기선 자리만. */}
                  <div className="flex min-h-[212px] min-w-[212px] items-center justify-center rounded-lg bg-white p-2">
                    <canvas ref={qrCanvasRef} className="block" />
                  </div>
                  <div className={`text-[12px] font-medium ${qrRemainingMs > 30000 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {qrRemainingMs > 0
                      ? t('panel.mobileAccess.qrExpiresIn', { time: formatRemaining(qrRemainingMs) })
                      : t('panel.mobileAccess.qrExpired')}
                  </div>
                  {state.qrTicket.usedCount > 0 && (
                    <div className="text-[12px] text-gray-500">
                      {t('panel.mobileAccess.qrPairedCount', {
                        count: state.qrTicket.usedCount,
                        max: state.qrTicket.maxUses,
                      })}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      className="flex items-center gap-1.5 rounded-md bg-white/[0.08] px-3 py-1.5 text-[12px] text-gray-200 transition-colors hover:bg-white/[0.14]"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
                      </svg>
                      {t('panel.mobileAccess.qrDownload')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevokeQr()}
                      disabled={busy}
                      className={`rounded-md px-3 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200 ${busy ? 'opacity-50' : ''}`}
                    >
                      {t('panel.mobileAccess.qrRevoke')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mb-3 text-[12px] text-gray-400">
            {t('panel.mobileAccess.clients', { count: state.clientCount })}
          </div>

          {/* §4 v3.20 — 외부(인터넷) 접속 */}
          <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span className="text-[13px] font-medium text-gray-200">{t('panel.mobileAccess.externalTitle')}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleToggleExternal()}
                disabled={busy}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  state.externalEnabled
                    ? 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.14]'
                    : 'bg-sky-500 text-gray-950 hover:bg-sky-400'
                } ${busy ? 'opacity-50' : ''}`}
              >
                {state.externalEnabled ? t('panel.mobileAccess.disable') : t('panel.mobileAccess.enable')}
              </button>
            </div>
            <p className="mb-2 text-[12px] leading-relaxed text-gray-500">{t('panel.mobileAccess.externalSubtitle')}</p>

            {/* 노출 시간이 위험의 대부분이다 — 켜 두면 재시작해도 다시 열린다는 사실을 말한다. */}
            {state.externalEnabled && (
              <p className="mb-2 flex gap-1.5 text-[12px] leading-relaxed text-amber-300/85">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
                </svg>
                {t('panel.mobileAccess.externalAutoResume')}
              </p>
            )}

            {state.externalEnabled && (
              <>
                {state.externalStatus === 'mapping' && (
                  <div className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[12px] text-gray-300">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                    {t('panel.mobileAccess.externalMapping')}
                  </div>
                )}

                {/* UPnP 자동 개방 성공 — 접속 가능. */}
                {state.externalStatus === 'active' && state.externalUrl && (
                  <>
                    <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-emerald-300">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {t('panel.mobileAccess.externalReachable')}
                    </div>
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2 font-mono text-[13px] text-emerald-300">
                      {state.externalUrl}
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-amber-300/80">{t('panel.mobileAccess.externalHttpsNote')}</p>
                  </>
                )}

                {/* CGNAT — 구조적으로 불가(수동 포워딩으로도 못 뚫음). */}
                {state.externalReason === 'cgnat' && (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-relaxed text-amber-200">
                    {t('panel.mobileAccess.externalCgnat')}
                  </div>
                )}

                {/* 자동 개방 실패 → 수동 포워딩 안내 + 접속에 쓸 주소를 그대로 제공. */}
                {state.externalStatus === 'error' && (
                  <>
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-relaxed text-amber-200">
                      {t('panel.mobileAccess.externalManual', {
                        ip: forwardTargetIp ?? '—',
                        port: state.httpsPort ?? '—',
                      })}
                    </div>
                    {/* 우리가 못 닫는 구멍이 생기는 자리다 — 만드는 그 화면에서 뒷정리를 예고한다.
                        UPnP 매핑과 달리 임대가 없어 저절로 닫히지 않는다. */}
                    <div className="mt-2 flex gap-2 rounded-md border border-red-500/25 bg-red-500/[0.07] px-3 py-2">
                      <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <path d="M12 9v4" /><path d="M12 17h.01" />
                      </svg>
                      <p className="text-[12px] leading-relaxed text-red-200/90">
                        {t('panel.mobileAccess.externalManualWarn')}
                      </p>
                    </div>
                    {state.externalUrl && (
                      <>
                        <div className="mb-1 mt-3 text-[12px] font-medium text-gray-400">
                          {t('panel.mobileAccess.externalManualUrl')}
                        </div>
                        <div className="rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-[13px] text-sky-300">
                          {state.externalUrl}
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-amber-300/80">{t('panel.mobileAccess.externalHttpsNote')}</p>
                      </>
                    )}
                  </>
                )}

                {/* 인증서 지문 — "지금 폰에 뜬 경고가 우리 것인가"를 가릴 유일한 값.
                    자체 서명은 도청은 막아도 중간자는 못 막는데, 화면이 "계속"을 누르라고
                    가르치기 때문에 대조할 값이 없으면 남의 인증서도 똑같이 넘어간다. */}
                {state.certFingerprint !== null && (
                  <div className="mt-3 rounded-md border border-white/[0.06] bg-black/30 px-3 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-gray-300">
                      <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z" />
                        <path d="m9.3 12.2 1.8 1.8 3.4-3.6" />
                      </svg>
                      {t('panel.mobileAccess.certFingerprintTitle')}
                    </div>
                    <div className="select-all break-all font-mono text-[12px] leading-relaxed text-gray-400">
                      {state.certFingerprint}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                      {t('panel.mobileAccess.certFingerprintNote')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* 보안 안내 — on/off 무관 상시 표시 */}
      <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
        <p className="text-[12px] leading-relaxed text-amber-200/90">{t('panel.mobileAccess.securityNote')}</p>
      </div>
    </div>
  );
}
