import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AgentEngineKind } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { LanguageSwitcher } from '../Layout/LanguageSwitcher.js';
import { useOnboardingGate } from '../../stores/onboardingGates.js';
import { isEngineChooserOpen, handoffForEngine } from './engineChoiceFlow.js';
import { EngineIcon } from './engineIcons.js';

/**
 * §5.25 (C) — **첫 진입 엔진 선택 관문.**
 *
 * 앱을 처음 켠 사람이 마주하는 첫 화면이다. 셋 중 하나를 고르면 그 엔진이 **새 에이전트의
 * 기본값**이 되고, 곧바로 그 엔진의 준비 계단(설치 → 로그인 → 폴더)으로 넘어간다.
 *
 * **고르는 것은 기본값이지 자물쇠가 아니다.** 나머지 둘도 그대로 쓸 수 있고(우클릭 메뉴에 세
 * 갈래가 다 있다), 옵션창에서 나중에 준비할 수도 있다. 그래서 이 창에는 "되돌릴 수 없다"는
 * 경고가 없고, 대신 세 칸 아래에 그 사실을 한 줄로 적어 둔다 — 처음 켠 사람이 가장 두려워하는
 * 것이 "잘못 고르면 어떡하지"이기 때문이다.
 *
 * z-index 는 설치 게이트(100_700)보다 위다. 어떤 엔진을 준비할지가 설치보다 앞선 질문이라,
 * 이 창이 떠 있는 동안에는 클로드 설치 게이트가 뒤에서 먼저 뜨면 안 된다.
 */

const Z = 100_800;

interface EngineOption {
  kind: AgentEngineKind;
  /** 카드 테두리·강조색. 세 엔진이 화면 어디서나 같은 색을 갖게 여기서 정한다. */
  accent: string;
}

/** 글리프는 `engineIcons` 가 정본이다 — 옵션창의 계정 칸·엔진 칸이 같은 그림을 쓴다. */
const OPTIONS: EngineOption[] = [
  { kind: 'claude', accent: 'sky' },
  { kind: 'codex', accent: 'emerald' },
  { kind: 'local', accent: 'violet' },
];

/** 카드 색은 Tailwind 클래스라 문자열 조립이 아니라 표로 갖는다(빌드 시 걷어내지지 않게). */
const ACCENT: Record<string, { border: string; hover: string; text: string; glow: string }> = {
  sky: { border: 'border-sky-500/40', hover: 'hover:border-sky-400 hover:bg-sky-500/10', text: 'text-sky-400', glow: 'rgba(56,189,248,0.35)' },
  emerald: { border: 'border-emerald-500/40', hover: 'hover:border-emerald-400 hover:bg-emerald-500/10', text: 'text-emerald-400', glow: 'rgba(16,185,129,0.35)' },
  violet: { border: 'border-violet-500/40', hover: 'hover:border-violet-400 hover:bg-violet-500/10', text: 'text-violet-400', glow: 'rgba(139,92,246,0.35)' },
};

export function EngineChooserGate(): React.JSX.Element | null {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const forced = useGraphStore((s) => s.engineChooserForced);
  const dismissed = useGraphStore((s) => s.engineChooserDismissed);
  const setEngineChooser = useGraphStore((s) => s.setEngineChooser);
  const chooseEngine = useGraphStore((s) => s.chooseEngine);

  const shouldOpen = isEngineChooserOpen({
    userDefaults,
    presence: { projects, stubProjects },
    forced,
    dismissed,
  });
  useOnboardingGate('setup', shouldOpen);

  /**
   * 고른 엔진을 기본값으로 저장하고 **그 엔진의 첫 칸**을 연다.
   *
   * 판정은 렌더 시점이 아니라 그 순간의 스토어로 한다 — 저장이 비동기라 그 사이 스냅샷이
   * 한 번 더 올 수 있고, 오래된 클로저 값으로 다음 창을 열면 엉뚱한 게이트가 뜬다.
   */
  const pick = useCallback(
    async (engine: AgentEngineKind) => {
      await chooseEngine(engine);
      const now = useGraphStore.getState();
      switch (handoffForEngine(engine)) {
        case 'codex-setup':
          now.setCodexSetupGate({ forced: true, dismissed: false });
          break;
        case 'project-folder':
          // 로컬은 앱 차원의 설치·로그인 칸이 없다 — 폴더부터 고르면 그 다음은 캔버스 우클릭
          //   한 번(All Model)이고, 엔진 받기는 그 창이 맡는다(§5.19 (B)).
          now.setProjectGate({ forced: true, dismissed: false, reason: 'onboarding' });
          break;
        default:
          // 클로드는 이미 있는 계단을 그대로 탄다 — 설치가 끝나 있으면 설치 게이트가 스스로
          //   닫히며 로그인으로 넘기므로, 여기서는 열어 주기만 한다.
          now.setSetupGate({ forced: true, dismissed: false });
          break;
      }
    },
    [chooseEngine],
  );

  if (!shouldOpen) return null;

  return createPortal(
    <>
      {/* 백드롭에 닫기를 달지 않는다 — 첫 질문이라 실수로 흘려보내면 아무 안내 없이 빈 캔버스가 된다.
          대신 아래 [나중에] 가 같은 일을 명시적으로 해 준다. */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-[2px]" style={{ zIndex: Z - 1 }} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z }}>
        <div
          className="pointer-events-auto flex max-h-[92vh] w-[720px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(148,163,184,0.15), 0 25px 50px -12px rgba(0,0,0,0.9)' }}
        >
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3 6 6 .9-4.5 4.3 1.1 6.1L12 16.4 6.4 19.3l1.1-6.1L3 8.9 9 8z" />
            </svg>
            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">
              {t('panel.engineChooser.title', { defaultValue: 'Choose your agent engine' })}
            </h3>
            <div className="shrink-0 md:hidden"><LanguageSwitcher portalMenu menuZIndex={Z + 100} /></div>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-gray-400">
              {t('panel.engineChooser.intro', {
                defaultValue: 'Vibisual can drive three different engines. Pick the one to start with — Vibisual will walk you through installing and signing in.',
              })}
            </p>

            <div className="grid gap-2.5 md:grid-cols-3">
              {OPTIONS.map((opt) => {
                const accent = ACCENT[opt.accent] ?? ACCENT['sky']!;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => { void pick(opt.kind); }}
                    className={`flex flex-col gap-2 rounded-lg border ${accent.border} ${accent.hover} bg-gray-950/60 px-3.5 py-3 text-left transition-colors`}
                  >
                    <span className={accent.text}><EngineIcon kind={opt.kind} className="h-6 w-6" /></span>
                    <span className="text-[13px] font-bold text-gray-100">
                      {t(`panel.engineChooser.${opt.kind}.name`, {
                        defaultValue: opt.kind === 'claude' ? 'Claude Code' : opt.kind === 'codex' ? 'Codex' : 'Local models',
                      })}
                    </span>
                    <span className="text-[12px] leading-relaxed text-gray-400">
                      {t(`panel.engineChooser.${opt.kind}.desc`, {
                        defaultValue:
                          opt.kind === 'claude'
                            ? 'Anthropic account. The engine Vibisual was built around.'
                            : opt.kind === 'codex'
                              ? 'OpenAI account. Runs the Codex CLI as a second engine.'
                              : 'No account, no cost. Runs models on this computer.',
                      })}
                    </span>
                    <span className="mt-0.5 text-[12px] font-semibold text-gray-500">
                      {t(`panel.engineChooser.${opt.kind}.need`, {
                        defaultValue:
                          opt.kind === 'local' ? 'Download only' : 'Install + sign in',
                      })}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 처음 켠 사람이 가장 두려워하는 것에 먼저 답한다 — 자물쇠가 아니라 기본값이다. */}
            <p className="rounded-lg border border-gray-800 bg-gray-950/70 px-3.5 py-2.5 text-[12px] leading-relaxed text-gray-400">
              {t('panel.engineChooser.note', {
                defaultValue: 'This only sets the default for new agents. All three stay available side by side, and you can set up the others later in Options.',
              })}
            </p>
          </div>

          <div className="flex items-center justify-end border-t border-gray-800 px-4 py-3">
            <button
              type="button"
              onClick={() => setEngineChooser({ forced: false, dismissed: true })}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              {t('panel.engineChooser.later', { defaultValue: 'Decide later' })}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
