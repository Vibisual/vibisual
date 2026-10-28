import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH } from '@vibisual/shared';
import { useWebSocket, type ConnectionStatus } from '../../hooks/useWebSocket.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { useAnchoredMenuPlacement } from '../Layout/useAnchoredMenuPlacement.js';
import { CommandCenterBoard } from './CommandCenterBoard.js';
import { elapsedParts } from './commandCenterModel.js';
import { clientPathKey } from '../../utils/platform.js';
import {
  loadCommandCenterSettings,
  saveCommandCenterSettings,
  type CommandCenterSettings,
} from './commandCenterSettings.js';

// SCENARIO.md §5.12 (A) — 지휘통제실 창 shell(`#command=1&projectId=…`). 같은 in-process 서버에 IPC WS 로 붙는다(별도 hydrate·REST ❌).
// 활성 프로젝트는 `setActiveProjectLocal` 로 **로컬만** — 서버 appState 를 건드리면 다른 창의 활성 탭이 바뀐다.
// 앱에 하나, 기본은 따라가기(스냅샷 `appState.lastActiveProject` 역해소 — 새 상태·폴링 ❌), 타이틀바에서 고르면 고정(localStorage). 캔버스는 그리지 않는다.

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

// §5.12 (J) — push 로 실시간이지만 WS 가 끊기면 낡은 스냅샷에서 조용히 멈춘다 — 보는 동안 30초마다 다시 붙고, [새로고침]·연결 상태·갱신 시각을 둔다.

/** 자동 갱신 주기. 창이 가려져 있으면 건너뛴다(안 보는 창을 위해 도는 타이머는 두지 않는다). */
const AUTO_REFRESH_MS = 30_000;
/** 자동 갱신 시점을 확인하는 간격 — 타이머 드리프트·백그라운드 스로틀에 견디도록 짧게 재 본다. */
const REFRESH_CHECK_MS = 5_000;
/** 눌렀다는 것이 보이도록 아이콘이 도는 최소 시간. */
const REFRESH_SPIN_MS = 600;
/** 창이 다시 보일 때의 즉시 갱신만 이 간격을 둔다(alt-tab 왕복마다 소켓을 다시 열지 않게). 직접 누른 새로고침은 타지 않는다. */
const REFRESH_MIN_GAP_MS = 2_000;

export interface CommandCenterShellProps {
  projectId: string;
}

/** main.tsx 가 부팅 시 호출 — `#command=1&projectId=...` 파싱. */
export function parseCommandCenterHash(hash: string): { projectId: string } | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('command') !== '1') return null;
  const projectId = params.get('projectId');
  if (!projectId) return null;
  return { projectId };
}

/** 서버 appState 경로 키와 같은 규칙(구분자·끝 슬래시 무시). 대소문자는 플랫폼이 실제로 무시할 때만 접는다 — Linux 에서 접으면 두 프로젝트가 뭉개진다. */
function normalizePath(p: string): string {
  return clientPathKey(p);
}

export function CommandCenterShell({ projectId: initialProjectId }: CommandCenterShellProps): React.JSX.Element {
  const { status, reconnect, getLastSnapshotAt } = useWebSocket(WS_URL);
  const { t } = useTranslation();

  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const appState = useGraphStore((s) => s.appState);
  const setActiveProjectLocal = useGraphStore((s) => s.setActiveProjectLocal);

  const [settings, setSettings] = useState<CommandCenterSettings>(() => loadCommandCenterSettings());
  const update = useCallback((patch: Partial<CommandCenterSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveCommandCenterSettings(next);
      return next;
    });
  }, []);

  // 다른 프로젝트의 root 를 더블클릭하면 main 이 이 창에 "저기를 보여라"고 민다(창은 하나).
  const [requested, setRequested] = useState<string>(initialProjectId);
  useEffect(() => {
    const off = window.api?.command?.onShowProject?.(({ projectId }) => {
      if (!projectId) return;
      setRequested(projectId);
      // 고정 중이었다면 **그 프로젝트로 다시 고정**한다 — 다른 프로젝트의 root 를 눌렀다는 것은
      // "지금은 저기를 보고 싶다"는 뜻이고, 고정을 이유로 무시하면 눌러도 아무 일이 없어 보인다.
      setSettings((prev) => {
        if (!prev.pinnedProject) return prev;
        const next = { ...prev, pinnedProject: projectId };
        saveCommandCenterSettings(next);
        return next;
      });
    });
    return () => { off?.(); };
  }, []);

  /** 메인 창이 지금 보고 있는 프로젝트(표시명). 경로 → 표시명 역해소. */
  const followed = useMemo((): string | null => {
    const path = appState?.lastActiveProject;
    if (!path) return null;
    const target = normalizePath(path);
    for (const [name, info] of Object.entries(projects)) {
      if (normalizePath(info.path) === target) return name;
    }
    for (const [name, stub] of Object.entries(stubProjects)) {
      if (normalizePath(stub.project.path) === target) return name;
    }
    return null;
  }, [appState?.lastActiveProject, projects, stubProjects]);

  // 고정 > 따라가기 > 창을 연 프로젝트. 셋 다 없으면 아무 것도 못 그린다.
  const viewed = settings.pinnedProject ?? followed ?? requested ?? null;

  useEffect(() => {
    if (viewed) setActiveProjectLocal(viewed);
  }, [viewed, setActiveProjectLocal]);

  const known = !!viewed && (!!projects[viewed] || !!stubProjects[viewed]);

  const projectNames = useMemo(
    () => [...new Set([...Object.keys(projects), ...Object.keys(stubProjects)])].sort((a, b) => a.localeCompare(b)),
    [projects, stubProjects],
  );

  return (
    // h-dvh — 폰 브라우저가 해시로 바로 열 때 주소창 높이만큼 아래가 가려지지 않게(데스크톱 창에서는 h-screen 과 같다).
    <div className="flex h-dvh w-screen flex-col bg-gray-950 text-gray-100">
      <CommandCenterTitleBar
        viewed={viewed}
        pinned={settings.pinnedProject}
        projectNames={projectNames}
        onFollow={() => update({ pinnedProject: null })}
        onPin={(name) => update({ pinnedProject: name })}
        status={status}
        onRefresh={reconnect}
        getLastSnapshotAt={getLastSnapshotAt}
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        {known && viewed ? (
          <CommandCenterBoard projectId={viewed} settings={settings} onUpdate={update} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <svg className="h-10 w-10 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-[13px] text-gray-300">{t('commandCenter.missingTitle')}</p>
            <p className="text-[12px] text-gray-500">
              {t('commandCenter.missingBody', { name: viewed ?? '—' })}
            </p>
            {settings.pinnedProject && (
              <button
                type="button"
                onClick={() => update({ pinnedProject: null })}
                className="mt-1 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.1]"
              >
                {t('commandCenter.followProject')}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** 미니 타이틀바 — redock 드래그 없음(도구 창). 창 단추는 별창의 `vibisual:window:*-self` 채널. 가운데 선택기가 따라가기/고정 모드를 보인다. */
function CommandCenterTitleBar({
  viewed,
  pinned,
  projectNames,
  onFollow,
  onPin,
  status,
  onRefresh,
  getLastSnapshotAt,
}: {
  viewed: string | null;
  pinned: string | null;
  projectNames: string[];
  onFollow: () => void;
  onPin: (name: string) => void;
  status: ConnectionStatus;
  onRefresh: () => void;
  getLastSnapshotAt: () => number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // 목록은 선택기 왼쪽 변·타이틀바 바로 아래(종전 `left-0 top-9`)에 펼치되 화면 안으로 당긴다 —
  //   창이 좁으면 288px 목록이 오른쪽 창 밖으로 나갔다.
  const pickerListRef = useRef<HTMLDivElement | null>(null);
  useAnchoredMenuPlacement(pickerOpen, pickerRef, pickerListRef, 'start', 0);

  // 바깥 press 로 닫기(공통 규약 — 목록 안에서 시작한 드래그로는 안 닫힌다).
  useOutsidePressDismiss({
    enabled: pickerOpen,
    onDismiss: () => setPickerOpen(false),
    refs: [pickerRef],
    capture: false,
  });

  return (
    // 좁아지면 창 이름·프로젝트 이름이 먼저 줄어든다(min-w-0 + truncate) — 줄지 않으면 오른쪽 새로고침·창 조작
    //   단추가 창 밖으로 밀려 [닫기]를 누를 길이 없어진다. 넓을 때는 종전과 같은 폭이다.
    <div className="flex h-9 flex-shrink-0 items-stretch border-b border-black/40 bg-vb-raised select-none">
      <div className="flex min-w-0 items-center gap-2 px-3 text-[12px] font-medium text-gray-200">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="4" />
        </svg>
        <span className="min-w-0 truncate">{t('commandCenter.title')}</span>
      </div>

      {/* 프로젝트 선택기 — 무엇을 보는 중인지 + 따라가기/고정 */}
      <div ref={pickerRef} className="relative flex min-w-0 items-center app-nodrag">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex min-w-0 max-w-[320px] items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-gray-200 transition-colors hover:bg-white/[0.08] pointer-coarse:py-2"
          title={pinned ? t('commandCenter.pinnedHint') : t('commandCenter.followingHint')}
        >
          {pinned ? (
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4h6l-1 6 3 2v2H7v-2l3-2-1-6zM12 14v6" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h10M10 8l4 4-4 4" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          )}
          <span className="truncate">{viewed ?? t('commandCenter.noProject')}</span>
          <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {pickerOpen && (
          <div
            ref={pickerListRef}
            className="fixed z-40 max-h-[60vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-white/10 bg-gray-900 py-1 shadow-lg shadow-black/60"
          >
            <button
              type="button"
              onClick={() => { onFollow(); setPickerOpen(false); }}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.08] ${pinned ? '' : 'bg-white/[0.05]'}`}
            >
              <svg className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${pinned ? 'text-gray-600' : 'text-sky-300'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12h10M10 8l4 4-4 4" />
                <circle cx="19" cy="12" r="2" />
              </svg>
              <span className="min-w-0">
                <span className="block text-[12px] text-gray-200">{t('commandCenter.followProject')}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-gray-500">{t('commandCenter.followProjectNote')}</span>
              </span>
            </button>

            <div className="my-1 h-px bg-white/[0.07]" />

            {projectNames.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-gray-600">{t('commandCenter.noProjects')}</p>
            ) : (
              projectNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => { onPin(name); setPickerOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.08] pointer-coarse:py-2.5 ${
                    pinned === name ? 'text-amber-200' : 'text-gray-300'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${name === viewed ? 'bg-emerald-400' : 'bg-transparent'}`} />
                  <span className="truncate">{name}</span>
                  {pinned === name && (
                    <svg className="ml-auto h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 4h6l-1 6 3 2v2H7v-2l3-2-1-6zM12 14v6" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* OS 드래그 영역 */}
      <div className="app-drag flex-1" style={{ minWidth: 0 }} />

      <CommandCenterRefresh status={status} onRefresh={onRefresh} getLastSnapshotAt={getLastSnapshotAt} />

      <WindowControls />
    </div>
  );
}

/**
 * §5.12 (J) — **1초 시계와 30초 타이머를 이 부품 안에 가둔다**: shell 이 매초 그려지면 항목 → 레인 정착 → 정렬이 통째로 다시 돈다.
 * 수신 시각은 `useWebSocket` 의 ref 를 읽는다(구독 ❌).
 */
function CommandCenterRefresh({
  status,
  onRefresh,
  getLastSnapshotAt,
}: {
  status: ConnectionStatus;
  onRefresh: () => void;
  getLastSnapshotAt: () => number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [lastAt, setLastAt] = useState(() => getLastSnapshotAt());
  const [now, setNow] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);
  /** 마지막으로 새로고침을 **건** 시각(자동/수동 공통). 자동 주기는 이 값을 기준으로 센다. */
  const lastRunRef = useRef(Date.now());
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback((): void => {
    lastRunRef.current = Date.now();
    setSpinning(true);
    if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    spinTimerRef.current = setTimeout(() => setSpinning(false), REFRESH_SPIN_MS);
    onRefresh();
  }, [onRefresh]);

  useEffect(() => () => {
    if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
  }, []);

  // 1초 시계 — 상대 시간 갱신 + 새 스냅샷 도착 감지(둘 다 이 부품 안에서만 리렌더를 만든다).
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      const at = getLastSnapshotAt();
      setLastAt((prev) => (at > prev ? at : prev));
    }, 1_000);
    return () => clearInterval(id);
  }, [getLastSnapshotAt]);

  // 30초 자동 새로고침 — **창을 보고 있는 동안만**. 가려졌다 돌아오면 그 순간 즉시 한 번.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunRef.current < AUTO_REFRESH_MS) return;
      run();
    }, REFRESH_CHECK_MS);
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunRef.current < REFRESH_MIN_GAP_MS) return;
      run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [run]);

  const elapsed = elapsedParts(now - (lastAt || now));
  const updatedLabel = lastAt === 0
    ? t('commandCenter.updatedNever')
    : elapsed.unit === 'now'
      ? t('commandCenter.updatedNow')
      : t('commandCenter.updatedAgo', {
          time: t(`commandCenter.time.${elapsed.unit}`, { count: elapsed.value }),
        });

  const connHint = status === 'connected'
    ? t('commandCenter.connLive')
    : status === 'connecting'
      ? t('commandCenter.connConnecting')
      : t('commandCenter.connLostHint');

  const dotClass = status === 'connected'
    ? 'bg-emerald-400'
    : status === 'connecting'
      ? 'bg-amber-400 animate-pulse'
      : 'bg-rose-500';

  return (
    <div className="flex flex-shrink-0 items-center gap-1.5 pr-1 app-nodrag">
      {status !== 'connected' && (
        <span
          className={`rounded px-1.5 py-[1px] text-[12px] ${
            status === 'connecting' ? 'bg-amber-500/15 text-amber-200' : 'bg-rose-500/15 text-rose-200'
          }`}
        >
          {status === 'connecting' ? t('commandCenter.connConnecting') : t('commandCenter.connLost')}
        </span>
      )}
      {/* 좁은 창(폰)에서는 갱신 시각 글자를 접고 연결 점·새로고침 단추만 남긴다 — 그 폭을 비워야 창 조작 단추가 창 안에 남는다. */}
      <span className="whitespace-nowrap text-[12px] tabular-nums text-gray-500 max-sm:hidden">{updatedLabel}</span>
      <button
        type="button"
        onClick={run}
        title={`${t('commandCenter.refreshHint')} — ${connHint}`}
        aria-label={t('commandCenter.refresh')}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-gray-300 transition-colors hover:bg-white/[0.08] pointer-coarse:p-2"
      >
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 ${spinning ? 'animate-spin' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </button>
    </div>
  );
}
