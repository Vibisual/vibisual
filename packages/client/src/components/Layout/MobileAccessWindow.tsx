import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MOBILE_QR_TICKET_TTL_MS, type MobileAccessState } from '@vibisual/shared';
import { drawQrToCanvas, downloadCanvasPng } from '../../utils/qrCanvas';
import { setCanvasCover } from '../../stores/canvasVisibility.js';

// 모바일 웹 접속 모드 모달 — SCENARIO.md §4 v3.16.
//
// File 메뉴 > Mobile Access. main 의 mobileAccess 매니저가 SSOT 인 shell 상태
// (MobileAccessState) 를 window.api.mobile 로 조회/구독하고, 여기서는 표시 + 액션만 한다.
// packaged Electron 한정 — FileMenu 가 isPackagedDesktop() 으로 항목 노출을 막는다.
//
// §4 v3.66 — QR 페어링 블록 추가. 티켓(3분)의 SSOT 도 main 이며 여기서는 발급/폐기 요청 +
// 딥링크를 QR 로 그리기 + 남은 시간 카운트다운 + PNG 저장만 한다.

/** 남은 시간을 mm:ss 로. 만료됐으면 0:00. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** 외부(인터넷) 딥링크인지 — LAN http 와 배지를 구분해 어느 주소를 찍는지 알려준다. */
function isExternalUrl(url: string): boolean {
  return url.startsWith('https://');
}

interface MobileAccessWindowProps {
  open: boolean;
  onClose: () => void;
}

export function MobileAccessWindow({ open, onClose }: MobileAccessWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [state, setState] = useState<MobileAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  // §4 v3.66 QR — 대상 주소 인덱스 + 1초 카운트다운용 현재 시각.
  const [qrTargetIndex, setQrTargetIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // §4 v3.71 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('mobile-access', open);
    return () => setCanvasCover('mobile-access', false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mobile = window.api?.mobile;
    if (!mobile) return;
    void mobile.getState().then(setState).catch(() => {});
    const off = mobile.onStatus(setState);
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

  const handleToggle = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || !state || busy) return;
    setBusy(true);
    try {
      setState(state.enabled ? await mobile.disable() : await mobile.enable());
    } catch {
      // main 쪽 실패는 status push 로 반영된다 — 여기선 조용히 무시.
    } finally {
      setBusy(false);
    }
  }, [state, busy]);

  const handleRegen = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      setState(await mobile.regenCode());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleToggleExternal = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || !state || busy) return;
    setBusy(true);
    try {
      setState(state.externalEnabled ? await mobile.disableExternal() : await mobile.enableExternal());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [state, busy]);

  // ─── §4 v3.66 QR 페어링 ──────────────────────────────────────────────────

  const qrUrls = useMemo(() => state?.qrTicket?.urls ?? [], [state]);
  const qrUrl = qrUrls[Math.min(qrTargetIndex, qrUrls.length - 1)] ?? null;
  const qrRemainingMs = state?.qrTicket ? state.qrTicket.expiresAt - now : 0;

  const handleIssueQr = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      setState(await mobile.issueQr());
      setQrTargetIndex(0);
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleRevokeQr = useCallback(async () => {
    const mobile = window.api?.mobile;
    if (!mobile || busy) return;
    setBusy(true);
    try {
      setState(await mobile.revokeQr());
    } catch {
      // status push 폴백.
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleDownloadQr = useCallback(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    downloadCanvasPng(canvas, `vibisual-qr-${Date.now()}.png`);
  }, []);

  // 남은 시간 카운트다운 — 티켓이 있을 때만 1초 타이머를 돈다(만료는 main 이 push 로 알린다).
  useEffect(() => {
    if (!open || !state?.qrTicket) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, state?.qrTicket]);

  // 선택된 딥링크를 QR 로 그린다. 대상 주소를 바꾸면 같은 토큰으로 다시 그릴 뿐 재발급은 없다.
  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !qrUrl) return;
    void drawQrToCanvas(canvas, qrUrl).catch(() => {
      // 인코딩 실패(모듈 로드 실패 등) — 아래 주소 텍스트가 폴백으로 남는다.
    });
  }, [qrUrl]);

  if (!open) return null;

  const enabled = state?.enabled === true;
  const qrTtlMinutes = Math.round(MOBILE_QR_TICKET_TTL_MS / 60000);
  // 담을 주소가 하나라도 있어야 발급 의미가 있다 — LAN 이 없어도 외부 주소만 있으면 가능.
  const qrIssuable = (state?.urls.length ?? 0) > 0 || (state?.externalUrl ?? null) !== null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-[440px] max-w-[92vw] rounded-xl border border-white/[0.08] bg-gray-900/95 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-4.5 w-4.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
              <path d="M12 18h.01" />
            </svg>
            <h2 className="text-[15px] font-semibold text-white">{t('panel.mobileAccess.title')}</h2>
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
        <p className="mb-4 text-[12px] leading-relaxed text-gray-400">{t('panel.mobileAccess.subtitle')}</p>

        {/* on/off 토글 행 */}
        <div className="mb-4 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
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

        {enabled && state && (
          <>
            {/* 접속 URL */}
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {t('panel.mobileAccess.url')}
              </div>
              {state.urls.length > 0 ? (
                <div className="space-y-1">
                  {state.urls.map((u) => (
                    <div key={u} className="rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-[13px] text-sky-300">
                      {u}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                  {t('panel.mobileAccess.noNetwork')}
                </div>
              )}
            </div>

            {/* 페어링 코드 */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {t('panel.mobileAccess.pairingCode')}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRegen()}
                  disabled={busy}
                  className="rounded-md px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
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
              <p className="text-[11px] leading-relaxed text-gray-500">
                {t('panel.mobileAccess.qrSubtitle', { minutes: qrTtlMinutes })}
              </p>

              {state.qrTicket && qrUrl && (
                <div className="mt-3">
                  {/* 대상 주소 선택 — 주소가 둘 이상일 때만(LAN 인터페이스 다중 / 외부 병행). */}
                  {qrUrls.length > 1 && (
                    <>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        {t('panel.mobileAccess.qrTarget')}
                      </div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {qrUrls.map((u, i) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setQrTargetIndex(i)}
                            className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                              u === qrUrl
                                ? 'border-sky-400/40 bg-sky-500/15 text-sky-200'
                                : 'border-white/[0.06] bg-black/20 text-gray-400 hover:bg-white/[0.06]'
                            }`}
                          >
                            <span className="mr-1 font-sans text-[10px] uppercase tracking-wide opacity-70">
                              {isExternalUrl(u)
                                ? t('panel.mobileAccess.qrTargetExternal')
                                : t('panel.mobileAccess.qrTargetLan')}
                            </span>
                            {u.replace(/^https?:\/\//, '').replace(/\/mobile\/qr.*$/, '')}
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
                      <div className="text-[11px] text-gray-500">
                        {t('panel.mobileAccess.qrPairedCount', { count: state.qrTicket.usedCount })}
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
              <p className="mb-2 text-[11px] leading-relaxed text-gray-500">{t('panel.mobileAccess.externalSubtitle')}</p>

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
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {t('panel.mobileAccess.externalReachable')}
                      </div>
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2 font-mono text-[13px] text-emerald-300">
                        {state.externalUrl}
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">{t('panel.mobileAccess.externalHttpsNote')}</p>
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
                          ip: state.publicIp ?? '—',
                          port: state.httpsPort ?? '—',
                        })}
                      </div>
                      {state.externalUrl && (
                        <>
                          <div className="mb-1 mt-3 text-[11px] font-medium text-gray-400">
                            {t('panel.mobileAccess.externalManualUrl')}
                          </div>
                          <div className="rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-[13px] text-sky-300">
                            {state.externalUrl}
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">{t('panel.mobileAccess.externalHttpsNote')}</p>
                        </>
                      )}
                    </>
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
    </div>,
    document.body,
  );
}
