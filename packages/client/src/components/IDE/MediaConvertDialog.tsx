import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  fetchConversionJob,
  fetchMediaTools,
  installMediaTools,
  startConversion,
  useMediaConvert,
} from '../../stores/mediaConvert.js';
import { openWorkspaceTarget } from './openWorkspaceTarget.js';
import { mediaFileName } from '../../utils/workspaceMedia.js';

/**
 * §5.13 (R-8) (f) — **못 읽는 영상·소리를 눌렀을 때 뜨는 팝업 하나.**
 *
 * 플레이어들이 띄우는 "코덱이 없습니다" 창과 같은 자리지만 말이 다르다 — 우리가 받는 것은 코덱이
 * 아니라 **변환기**이기 때문이다(Chromium 은 시스템 코덱을 쓰지 않는다). 그래서 화면에 "코덱"이라는
 * 말을 쓰지 않고, 무엇을 할 수 있는지만 말한다.
 *
 * 어느 단계에서도 **막다른 길을 만들지 않는다** — 변환이 안 되든 변환기가 없든 [연결 프로그램으로
 * 열기] 는 늘 그 자리에 있다.
 */

/** 진행 상황을 얼마나 자주 물을지(ms). 리먹스는 대개 한두 번 만에 끝난다. */
const POLL_MS = 400;

function Button({
  onClick,
  disabled,
  tone = 'plain',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'accent';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === 'accent'
          ? 'bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
          : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]'
      }`}
    >
      {children}
    </button>
  );
}

export const MediaConvertDialog = memo(function MediaConvertDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const request = useMediaConvert((s) => s.request);
  const tools = useMediaConvert((s) => s.tools);
  const job = useMediaConvert((s) => s.job);
  const phase = useMediaConvert((s) => s.phase);
  const error = useMediaConvert((s) => s.error);
  const close = useMediaConvert((s) => s.close);
  const setTools = useMediaConvert((s) => s.setTools);
  const setJob = useMediaConvert((s) => s.setJob);
  const setPhase = useMediaConvert((s) => s.setPhase);
  const setError = useMediaConvert((s) => s.setError);

  const [installing, setInstalling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 팝업이 열릴 때 변환기 상태를 한 번 확인한다 — [변환] 과 [설치] 중 무엇을 낼지가 여기서 갈린다.
  useEffect(() => {
    if (!request) return;
    let alive = true;
    setPhase('checking');
    void fetchMediaTools().then((info) => {
      if (!alive) return;
      setTools(info);
      setPhase('idle');
    });
    return () => {
      alive = false;
    };
  }, [request, setTools, setPhase]);

  // 창이 닫히면 폴링도 멈춘다(닫은 뒤에도 도는 타이머는 다음 팝업의 상태를 흔든다).
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };
  }, [request]);

  /** 변환이 끝나면 그 캐시 파일을 들고 **우리 편집기**를 연다. 여는 일은 갈림길 함수가 그대로 한다. */
  const openConverted = useCallback(
    async (outRel: string): Promise<void> => {
      if (!request) return;
      const base = request.root.replace(/\\/g, '/').replace(/\/+$/, '');
      await openWorkspaceTarget(
        { relPath: outRel, absPath: `${base}/${outRel}`, kind: 'file' },
        request.root,
        t('ide.streamRenderer.pathLink.runFailed'),
      );
      close();
    },
    [request, t, close],
  );

  const poll = useCallback(
    (jobId: string): void => {
      pollRef.current = setTimeout(() => {
        void fetchConversionJob(jobId).then((next) => {
          if (!next) {
            setError('failed');
            return;
          }
          setJob(next);
          if (next.status === 'done') {
            setPhase('done');
            void openConverted(next.outRel);
            return;
          }
          if (next.status === 'error') {
            setError(next.error ?? 'failed');
            return;
          }
          poll(jobId);
        });
      }, POLL_MS);
    },
    [openConverted, setJob, setPhase, setError],
  );

  const convert = useCallback((): void => {
    if (!request) return;
    setError(null);
    setPhase('converting');
    void startConversion(request.root, request.relPath, request.kind).then((result) => {
      if (!result.ok) {
        // 변환기가 없다는 답은 오류가 아니라 **다음 행동**이다 — 화면이 [설치] 로 갈린다.
        if (result.error === 'no-ffmpeg') {
          setPhase('idle');
          void fetchMediaTools(true).then(setTools);
          return;
        }
        setError(result.error);
        return;
      }
      setJob(result.job);
      if (result.job.status === 'done') {
        setPhase('done');
        void openConverted(result.job.outRel);
        return;
      }
      poll(result.job.id);
    });
  }, [request, poll, openConverted, setJob, setPhase, setError, setTools]);

  const install = useCallback((): void => {
    setInstalling(true);
    setPhase('installing');
    void installMediaTools().then((result) => {
      setInstalling(false);
      setTools(result.info);
      setPhase('idle');
      // 깔렸으면 사용자가 한 번 더 누르지 않아도 이어서 변환한다 — 원래 하려던 일이 그것이다.
      if (result.ok) convert();
    });
  }, [convert, setTools, setPhase]);

  const openExternal = useCallback((): void => {
    if (!request) return;
    void fetch('/api/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absolutePath: request.absPath }),
    }).catch(() => undefined);
    close();
  }, [request, close]);

  if (!request) return null;

  const name = mediaFileName(request.relPath);
  const hasTools = tools?.available === true;
  const busy = phase === 'converting' || phase === 'installing' || phase === 'done';
  const percent = job?.percent ?? 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl shadow-black/50">
        <div className="mb-3 flex items-start gap-3">
          <span className="mt-0.5 text-sky-300">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7V5a1 1 0 0 1 1-1h4" />
              <path d="M20 17v2a1 1 0 0 1-1 1h-4" />
              <path d="m8 12 4-4 4 4" />
              <path d="M12 8v8" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-100">{name}</p>
            <p className="mt-1 text-[12px] leading-snug text-gray-400">
              {request.kind === 'video'
                ? t('panel.mediaConvert.videoIntro', { defaultValue: '이 영상 형식은 앱 안에서 바로 열 수 없습니다. 포장만 바꾸면(화질 손실 없이) 우리 편집기에서 열립니다.' })
                : t('panel.mediaConvert.audioIntro', { defaultValue: '이 소리 형식은 앱 안에서 바로 열 수 없습니다. WAV 로 바꾸면 우리 편집기에서 열립니다.' })}
            </p>
          </div>
        </div>

        {/* 변환기가 없을 때만 뜨는 줄 — 무엇을 받는지 정확히 적는다(코덱이 아니다). */}
        {!hasTools && phase !== 'converting' && (
          <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[12px] leading-snug text-amber-200">
            {tools?.installer === null
              ? t('panel.mediaConvert.needToolManual', { defaultValue: '변환기(ffmpeg)가 필요합니다. 설치한 뒤 다시 눌러 주세요.' })
              : t('panel.mediaConvert.needTool', { defaultValue: '변환기(ffmpeg)가 필요합니다 — 한 번만 설치하면 다음부터는 바로 열립니다.' })}
          </p>
        )}

        {/* 진행 줄 */}
        {(phase === 'converting' || phase === 'done') && (
          <div className="mb-3">
            <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
              <div className="h-full bg-sky-400 transition-[width] duration-200" style={{ width: `${phase === 'done' ? 100 : percent}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] text-gray-400">
              {phase === 'done'
                ? t('panel.mediaConvert.opening', { defaultValue: '편집기에서 여는 중…' })
                : percent > 0
                  ? t('panel.mediaConvert.converting', { defaultValue: '변환 중… {{percent}}%', percent })
                  : t('panel.mediaConvert.convertingStart', { defaultValue: '변환을 시작했습니다…' })}
            </p>
          </div>
        )}

        {phase === 'installing' && (
          <p className="mb-3 text-[12px] text-gray-400">
            {t('panel.mediaConvert.installing', { defaultValue: '변환기를 설치하는 중… 처음 한 번만 걸립니다.' })}
          </p>
        )}

        {error !== null && (
          <p className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[12px] leading-snug text-rose-200">
            {t('panel.mediaConvert.failed', { defaultValue: '변환하지 못했습니다. 연결 프로그램으로 열어 주세요.' })}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={close} disabled={busy}>
            {t('panel.mediaConvert.cancel', { defaultValue: '닫기' })}
          </Button>
          <Button onClick={openExternal}>
            {t('panel.mediaConvert.openExternal', { defaultValue: '연결 프로그램으로 열기' })}
          </Button>
          {hasTools ? (
            <Button onClick={convert} disabled={busy} tone="accent">
              {t('panel.mediaConvert.convert', { defaultValue: '앱 안에서 보기' })}
            </Button>
          ) : (
            <Button onClick={install} disabled={installing || tools?.installer === null || phase === 'checking'} tone="accent">
              {t('panel.mediaConvert.install', { defaultValue: '변환기 설치' })}
            </Button>
          )}
        </div>

        {tools?.available === true && tools.version !== null && (
          <p className="mt-2 text-right text-[12px] text-gray-600">ffmpeg {tools.version}</p>
        )}
      </div>
    </div>
  );
});
