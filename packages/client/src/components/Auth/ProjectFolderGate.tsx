import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  hasProjectFolder,
  isProjectFolderBannerOpen,
  isProjectFolderGateOpen,
} from './projectFolderGateFlow.js';
import { LanguageSwitcher } from '../Layout/LanguageSwitcher.js';
import { useOnboardingGate } from '../../stores/onboardingGates.js';

/**
 * §4 (첫 실행 온보딩) ③ — 프로젝트 폴더 선택 게이트 + 상단 배너.
 *
 * 온보딩의 **마지막 칸**이다. ①설치 → ②로그인 까지는 앱 안에서 끝났는데 그 다음이 비어 있었다:
 * 폴더를 한 번도 고르지 않은 사람이 캔버스 우클릭 → "커스텀 에이전트" 를 누르면, 서버가
 * `process.cwd()` 를 임시 프로젝트로 등록해 **이름이 빈 탭 하나와 파일시스템 루트에 매인
 * 에이전트**가 조용히 생겼다(Finder 로 띄운 mac 앱의 `process.cwd()` 는 `/`). 사용자 눈에는
 * "폴더를 고른 적도 없는데 빈 것이 생성됐다" 로 보인다.
 *
 * 화면 규칙은 앞 두 칸(`ClaudeSetupGate`)과 **같은 결**로 맞췄다 — 처음 보는 사람이 세 창을
 * 연달아 보는데 규칙이 칸마다 다르면 그때마다 다시 배워야 한다:
 *  - **권장형(차단 ❌)** — [나중에] 로 닫으면 모달만 사라지고 **상단 배너**가 남는다.
 *  - z-index 는 `LoginWindow`(100_600) 보다 **아래** — 순서상 이 창이 마지막이다.
 *  - 무언가를 만들려다 막혀서 열렸으면(`reason==='create-blocked'`) 첫 문장이 그 사정을 말한다.
 *    같은 창인데 왜 떴는지가 안 적히면 "누른 게 안 먹었다" 로 읽힌다.
 *  - 폴더가 생기는 순간 어떤 경로로 열렸든 닫힌다(판정은 `projectFolderGateFlow`).
 *
 * ⚠ 표시 판정은 `projectFolderGateFlow.ts` 에 따로 있다 — `setupGateFlow` 와 같은 이유다
 *   (렌더 없이 검사할 수 있어야 순서 회귀를 한 번에 잡는다).
 */

const Z = 100_500; // LoginWindow(100_600) 보다 아래 — 폴더는 로그인 다음 칸이다.

export function ProjectFolderGate(): React.JSX.Element | null {
  const { t } = useTranslation();
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const setup = useGraphStore((s) => s.claudeSetup);
  const auth = useGraphStore((s) => s.claudeAuth);
  const forced = useGraphStore((s) => s.projectGateForced);
  const dismissed = useGraphStore((s) => s.projectGateDismissed);
  const reason = useGraphStore((s) => s.projectGateReason);
  const setProjectGate = useGraphStore((s) => s.setProjectGate);
  const openProjectFolder = useGraphStore((s) => s.openProjectFolder);

  /** 대화상자가 떠 있는 동안 — OS 폴더 선택기는 우리 창 밖이라 버튼만 눌러 둔 상태로 만든다. */
  const [picking, setPicking] = useState(false);
  /** 취소했을 때의 짧은 안내. 실패가 아니라 "아직 안 골랐다" 이므로 붉게 쓰지 않는다. */
  const [cancelled, setCancelled] = useState(false);

  const hasFolder = hasProjectFolder({ projects, stubProjects });
  const shouldOpen = isProjectFolderGateOpen({ setup, auth, hasFolder, forced, dismissed });
  // §4 (첫 실행 온보딩) — 백드롭이 헤더를 덮는 동안 헤더 언어 전환기를 창 위로 띄우게 알린다.
  useOnboardingGate('projectFolder', shouldOpen);

  const handlePick = useCallback(() => {
    setCancelled(false);
    setPicking(true);
    void openProjectFolder()
      .then((ok) => { if (!ok) setCancelled(true); })
      .finally(() => setPicking(false));
  }, [openProjectFolder]);

  // 바깥 클릭은 [나중에] 와 같다 — 권장형이라 가두지 않는다. 창 안에서 시작한 제스처(드래그·
  // 텍스트 선택)가 밖에서 끝나도 닫히지 않게 공통 규약에 위임한다.
  const backdrop = useBackdropDismiss(() => setProjectGate({ forced: false, dismissed: true }));

  if (!shouldOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" style={{ zIndex: Z - 1 }} {...backdrop} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z }}>
        <div
          className="pointer-events-auto flex max-h-[90vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-sky-500/40 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(56,189,248,0.2), 0 25px 50px -12px rgba(0,0,0,0.85), 0 0 40px -8px rgba(56,189,248,0.35)' }}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-sky-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h3.7a1.5 1.5 0 0 1 1.2.6l1 1.4h7.1A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
            </svg>
            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">
              {t('panel.projectFolder.title', { defaultValue: 'Choose a project folder' })}
            </h3>
            {/* §4 (첫 실행 온보딩) — 설치·로그인 창과 같은 자리, 같은 규칙으로 **폰 전용**이다.
                데스크톱은 헤더 전환기가 이 창 위로 떠 오르고(HeaderLanguageSlot), 폰은 헤더 우측
                묶음이 접혀 그 띄우기가 없으므로 여기가 유일한 입구다. */}
            <div className="shrink-0 md:hidden"><LanguageSwitcher portalMenu menuZIndex={Z + 100} /></div>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {/* 왜 떴는지 — 만들려다 막힌 사람에게는 그 사정이 첫 문장이어야 한다. */}
            {reason === 'create-blocked' ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-200">
                {t('panel.projectFolder.blocked', {
                  defaultValue: 'Nothing was created — no project folder is open yet. Agents work inside a folder you choose, so pick one first.',
                })}
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-gray-400">
                {t('panel.projectFolder.intro', {
                  defaultValue: 'Claude Code is installed and signed in. The last step is choosing the folder your agents will work in — usually the root of a project or repository.',
                })}
              </p>
            )}

            <p className="text-[12px] leading-relaxed text-gray-500">
              {t('panel.projectFolder.detail', {
                defaultValue: 'Everything Vibisual saves for a project lives inside that folder, and agents may only read and edit files under it. You can open more folders later from File → Open Folder.',
              })}
            </p>

            {cancelled && (
              <div className="rounded-lg border border-gray-700 bg-gray-950/70 px-3.5 py-2.5 text-[12px] text-gray-400">
                {t('panel.projectFolder.cancelled', { defaultValue: 'No folder was chosen yet. Choose one to continue.' })}
              </div>
            )}
          </div>

          {/* 푸터 — [나중에] 와 [폴더 선택]. 설치 게이트와 같은 배치. */}
          <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
            <button
              type="button"
              onClick={() => setProjectGate({ forced: false, dismissed: true })}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              {t('panel.projectFolder.later', { defaultValue: 'Later' })}
            </button>
            <button
              type="button"
              autoFocus
              onClick={handlePick}
              disabled={picking}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {picking
                ? t('panel.projectFolder.picking', { defaultValue: 'Choosing…' })
                : t('panel.projectFolder.choose', { defaultValue: 'Choose Folder' })}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * 권장형 게이트를 [나중에] 로 닫았을 때 남는 상단 배너 — 누르면 게이트가 다시 열린다.
 * `ClaudeSetupBanner` 와 같은 자리·같은 규칙이다(둘이 동시에 뜰 일은 없다 — 순서 판정이
 * 한 번에 한 칸만 내주기 때문).
 */
export function ProjectFolderBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const setup = useGraphStore((s) => s.claudeSetup);
  const auth = useGraphStore((s) => s.claudeAuth);
  const forced = useGraphStore((s) => s.projectGateForced);
  const dismissed = useGraphStore((s) => s.projectGateDismissed);
  const setProjectGate = useGraphStore((s) => s.setProjectGate);

  const hasFolder = hasProjectFolder({ projects, stubProjects });
  if (!isProjectFolderBannerOpen({ setup, auth, hasFolder, forced, dismissed })) return null;

  return (
    <button
      type="button"
      onClick={() => setProjectGate({ forced: true, reason: 'onboarding' })}
      className="flex w-full items-center justify-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[12px] text-sky-200 transition-colors hover:bg-sky-500/20"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h3.7a1.5 1.5 0 0 1 1.2.6l1 1.4h7.1A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      </svg>
      <span>
        {t('header.projectFolderBanner.text', { defaultValue: 'No project folder is open — agents have nowhere to work yet.' })}
      </span>
      <span className="font-semibold underline">
        {t('header.projectFolderBanner.action', { defaultValue: 'Choose folder' })}
      </span>
    </button>
  );
}
