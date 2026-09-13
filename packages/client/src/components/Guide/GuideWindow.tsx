/**
 * Guide — 기능 안내 / 만든 기능 인벤토리 (읽기 전용).
 *
 * File 메뉴 → Guide 로 열림. OptionsWindow 와 동형 모달 셸(portal + 좌측 카테고리
 * 사이드바 + 우측 패널)을 재사용하되, 입력/저장 없이 SSOT(§5 기능 범위)를 사용자
 * 눈높이로 설명한다. 새 기능을 추가할 때 이 파일의 SECTIONS 에 한 항목을 더하면
 * Guide 와 "만든 것 정리"가 함께 갱신된다.
 */
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
// §6 — 단축키는 레지스트리가 정본이다. 문장 안에 키를 적어야 할 때도 하드코딩 대신 **지금
//   배정된 값**을 라벨로 바꿔 쓴다(재매핑·mac 기호가 자동으로 따라온다).
import { ShortcutList } from '../Shortcuts/ShortcutList.js';
import { bindingLabel } from '../Shortcuts/bindingLabel.js';
import { useKeymapStore } from '../../stores/keymap.js';

type CategoryKey =
  | 'start'
  | 'bubbleMap'
  | 'autoGoal'
  | 'agents'
  | 'taskEdges'
  | 'ide'
  | 'navigation'
  | 'history'
  | 'shortcuts';

interface GuideEntry {
  title: string;
  desc: string;
}

interface GuideSection {
  intro: string;
  entries: GuideEntry[];
  /**
   * 글로 설명할 수 없는 부분 — 지금은 §6 단축키 목록 하나다.
   *
   * 단축키를 문장으로 적으면 사용자가 키를 바꾼 순간 도움말이 거짓말이 된다. 그래서
   * 그 절만 **레지스트리가 그리는 실물**로 바꾼다(글은 표가 못 말하는 것만 남는다).
   */
  extra?: React.ReactNode;
}

interface GuideWindowProps {
  open: boolean;
  onClose: () => void;
  /** §5.10 — 특정 항목으로 곧장 여는 입구(메모리 라이브러리의 [사용법] 버튼). 없으면 첫 항목. */
  initialCategory?: CategoryKey;
}

export function GuideWindow({ open, onClose, initialCategory }: GuideWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [category, setCategory] = useState<CategoryKey>(initialCategory ?? 'start');
  // 다른 화면이 특정 항목을 지목해 열면 그때마다 그 항목으로 옮겨 앉는다
  //   (창이 이미 열려 있던 뒤에 다시 지목되는 경우까지 포함).
  useEffect(() => {
    if (open && initialCategory) setCategory(initialCategory);
  }, [open, initialCategory]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const backdrop = useBackdropDismiss(onClose);

  const categories = useMemo<{ key: CategoryKey; label: string; icon: React.JSX.Element }[]>(() => [
    { key: 'start', label: t('panel.guide.cat.start', { defaultValue: 'Getting Started' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    ) },
    { key: 'bubbleMap', label: t('panel.guide.cat.bubbleMap', { defaultValue: 'Bubble Map' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="7" r="2"/><circle cx="15" cy="17" r="3.5"/><path d="M9.5 9.7l3.7 5M9.7 7.4l5.4-.3"/></svg>
    ) },
    { key: 'autoGoal', label: t('panel.guide.cat.autoGoal', { defaultValue: 'Procedure detection' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8V6a2 2 0 0 1 2-2h2M16 4h3a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-3M8 20H5a2 2 0 0 1-2-2v-2"/><path d="M8 9.5h8M8 12.5h8M8 15.5h4.5"/></svg>
    ) },
    { key: 'agents', label: t('panel.guide.cat.agents', { defaultValue: 'Agents' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M12 8V5M9 13h.01M15 13h.01"/><circle cx="12" cy="4" r="1"/></svg>
    ) },
    { key: 'taskEdges', label: t('panel.guide.cat.taskEdges', { defaultValue: 'Task Edges' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 8.5l7 7"/></svg>
    ) },
    { key: 'ide', label: t('panel.guide.cat.ide', { defaultValue: 'IDE Overlay' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>
    ) },
    { key: 'navigation', label: t('panel.guide.cat.navigation', { defaultValue: 'Navigation' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16 8 10 10 8 16 14 14 16 8"/></svg>
    ) },
    { key: 'history', label: t('panel.guide.cat.history', { defaultValue: 'History & Saving' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>
    ) },
    { key: 'shortcuts', label: t('panel.guide.cat.shortcuts', { defaultValue: 'Shortcuts' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>
    ) },
  ], [t]);

  // 도움말 문장에 섞여 들어가는 키 — 스토어가 바뀌면 문장도 다시 만들어진다.
  const resolved = useKeymapStore((st) => st.resolved);

  const sections = useMemo<Record<CategoryKey, GuideSection>>(() => ({
    start: {
      intro: t('panel.guide.start.intro', { defaultValue: 'Vibisual visualizes what your AI agents are doing, in real time, as a bubble map.' }),
      entries: [
        { title: t('panel.guide.start.openFolderT', { defaultValue: 'Open a folder' }), desc: t('panel.guide.start.openFolderD', { defaultValue: 'File → Open Folder to start tracking a project. Each project opens in its own tab.' }) },
        { title: t('panel.guide.start.watchT', { defaultValue: 'Watch agents work' }), desc: t('panel.guide.start.watchD', { defaultValue: 'When Claude Code runs, the files and folders it touches appear as bubbles and pulse as they change.' }) },
        { title: t('panel.guide.start.optionsT', { defaultValue: 'Set your defaults' }), desc: t('panel.guide.start.optionsD', { defaultValue: 'File → Options to choose the default model, tools, permission mode and Claude Code binary for new agents.' }) },
      ],
    },
    bubbleMap: {
      intro: t('panel.guide.bubbleMap.intro', { defaultValue: 'The canvas draws your project as bubbles linked by hierarchy and activity.' }),
      entries: [
        { title: t('panel.guide.bubbleMap.typesT', { defaultValue: 'Bubble categories' }), desc: t('panel.guide.bubbleMap.typesD', { defaultValue: 'Files, folders, agents, Bash, edits, iframes and more — each color-coded by category.' }) },
        { title: t('panel.guide.bubbleMap.sizeT', { defaultValue: 'Size means activity' }), desc: t('panel.guide.bubbleMap.sizeD', { defaultValue: 'Bigger bubbles were touched more often. A pulsing bubble is active right now.' }) },
        { title: t('panel.guide.bubbleMap.contextT', { defaultValue: 'Context fill' }), desc: t('panel.guide.bubbleMap.contextD', { defaultValue: 'An agent bubble fills like water to show how much of its context window is in use.' }) },
        { title: t('panel.guide.bubbleMap.ghostT', { defaultValue: 'Ghost nodes' }), desc: t('panel.guide.bubbleMap.ghostD', { defaultValue: "Deleted or renamed nodes linger as faded ghosts so the trail isn't lost." }) },
      ],
    },
    agents: {
      intro: t('panel.guide.agents.intro', { defaultValue: 'Beyond passive tracking, you can create and orchestrate your own agents from the canvas.' }),
      entries: [
        { title: t('panel.guide.agents.customT', { defaultValue: 'Custom Agent' }), desc: t('panel.guide.agents.customD', { defaultValue: 'Right-click the canvas to spawn your own agent bubble and give it a command.' }) },
        { title: t('panel.guide.agents.autoT', { defaultValue: 'Auto Agent' }), desc: t('panel.guide.agents.autoD', { defaultValue: 'Describe what you want in plain language; a builder agent designs and wires up a whole team for you.' }) },
        { title: t('panel.guide.agents.configT', { defaultValue: 'Agent settings' }), desc: t('panel.guide.agents.configD', { defaultValue: 'Click a bubble to set its model, tools, permission mode, effort, isolation and color.' }) },
        { title: t('panel.guide.agents.pipelineT', { defaultValue: 'Sub-agents & Pipelines' }), desc: t('panel.guide.agents.pipelineD', { defaultValue: 'Run independent sessions and chain agents together with pipeline, teams or hybrid strategies.' }) },
      ],
    },
    taskEdges: {
      intro: t('panel.guide.taskEdges.intro', { defaultValue: 'Connect two custom agents with a Task Edge to delegate work between them.' }),
      entries: [
        { title: t('panel.guide.taskEdges.drawT', { defaultValue: 'Draw an edge' }), desc: t('panel.guide.taskEdges.drawD', { defaultValue: 'Drag from one custom-agent bubble to another to create a delegation edge between them.' }) },
        { title: t('panel.guide.taskEdges.kindsT', { defaultValue: 'Edge meanings' }), desc: t('panel.guide.taskEdges.kindsD', { defaultValue: 'Command, artifact, request or critique — the kind says what flows across the edge.' }) },
        { title: t('panel.guide.taskEdges.critiqueT', { defaultValue: 'Review & auto-rework' }), desc: t('panel.guide.taskEdges.critiqueD', { defaultValue: 'A critique edge can force the target agent to rework its output until a reviewer accepts it.' }) },
      ],
    },
    ide: {
      intro: t('panel.guide.ide.intro', { defaultValue: 'Double-click an agent to open the IDE overlay — its live output, sessions and reports.' }),
      entries: [
        { title: t('panel.guide.ide.streamT', { defaultValue: 'Live stream' }), desc: t('panel.guide.ide.streamD', { defaultValue: "Follow the agent's messages, tool calls and results as they happen." }) },
        { title: t('panel.guide.ide.cardsT', { defaultValue: 'Did / To-do cards' }), desc: t('panel.guide.ide.cardsD', { defaultValue: 'Finished work and things you need to do yourself are split into color-coded cards.' }) },
        { title: t('panel.guide.ide.reviewT', { defaultValue: 'Review cards' }), desc: t('panel.guide.ide.reviewD', { defaultValue: 'When an agent finishes a fix, a purple card shows what changed and what to check.' }) },
        { title: t('panel.guide.ide.dockT', { defaultValue: 'Dock or float' }), desc: t('panel.guide.ide.dockD', { defaultValue: "Drag the overlay's title bar to float it, or snap it to the right as a side panel." }) },
      ],
    },
    navigation: {
      intro: t('panel.guide.navigation.intro', { defaultValue: 'Move around large maps quickly.' }),
      entries: [
        { title: t('panel.guide.navigation.panT', { defaultValue: 'Pan & zoom' }), desc: t('panel.guide.navigation.panD', { defaultValue: 'Drag the canvas to pan and scroll to zoom; the minimap shows where you are.' }) },
        { title: t('panel.guide.navigation.tabsT', { defaultValue: 'Tabs & detach' }), desc: t('panel.guide.navigation.tabsD', { defaultValue: 'Each open folder is a tab; drag a tab out of the bar to pop it into its own window.' }) },
        { title: t('panel.guide.navigation.inspectorT', { defaultValue: 'Inspector' }), desc: t('panel.guide.navigation.inspectorD', { defaultValue: 'Hold Alt to highlight elements and click to copy; Shift-drag to select a region.' }) },
        // 키는 §6 레지스트리의 **지금 값**이다 — 사용자가 바꾸면 이 문장도 함께 바뀐다.
        { title: t('panel.guide.navigation.copyT', { defaultValue: 'Copy & paste' }), desc: t('panel.guide.navigation.copyD', { copy: bindingLabel(resolved['canvas.copy']), paste: bindingLabel(resolved['canvas.paste']), defaultValue: 'Select custom agents and edges, then {{copy}} / {{paste}} to clone them into another project.' }) },
      ],
    },
    history: {
      intro: t('panel.guide.history.intro', { defaultValue: 'Vibisual remembers your projects between runs.' }),
      entries: [
        { title: t('panel.guide.history.saveT', { defaultValue: 'Automatic saving' }), desc: t('panel.guide.history.saveD', { defaultValue: 'The whole graph is checkpointed to disk and restored the next time you open Vibisual.' }) },
        { title: t('panel.guide.history.replayT', { defaultValue: 'History replay' }), desc: t('panel.guide.history.replayD', { defaultValue: 'Scrub a timeline to replay how the map grew over a session.' }) },
      ],
    },
    autoGoal: {
      intro: t('panel.guide.autoGoal.intro', { defaultValue: "Procedure detection watches what you and your agents actually repeat, and writes the repeated work down as a reusable procedure. It ships turned off — you switch it on per project, per agent or per session." }),
      entries: [
        { title: t('panel.guide.autoGoal.turnOnT', { defaultValue: "Turning it on" }), desc: t('panel.guide.autoGoal.turnOnD', { procedures: t('ide.activityBar.autoGoal'), defaultValue: "Open {{procedures}} in the activity bar. Three switches stack there — whole project, this agent, this session — and the lower one overrides the one above it. Each click cycles On → Off → Inherit." }) },
        { title: t('panel.guide.autoGoal.watchesT', { defaultValue: "What it watches" }), desc: t('panel.guide.autoGoal.watchesD', { defaultValue: "Runs of shell commands an agent actually executed, and step groups you pinned to the stage yourself. Nothing is sent anywhere — the analysis is a plain count that happens on this machine." }) },
        { title: t('panel.guide.autoGoal.thresholdT', { defaultValue: "The threshold" }), desc: t('panel.guide.autoGoal.thresholdD', { defaultValue: "A run has to come back the same way several times before it becomes a procedure. Until then it sits in the candidate list with a progress bar, so you can see what is about to be written." }) },
        { title: t('panel.guide.autoGoal.filesT', { defaultValue: "Where procedures live" }), desc: t('panel.guide.autoGoal.filesD', { defaultValue: "Each one is a plain SKILL.md under .vibisual/skills in your project, with the agentskills.io frontmatter. Open it, edit it, commit it — a file you edited by hand is never overwritten." }) },
        { title: t('panel.guide.autoGoal.promptT', { defaultValue: "What reaches the prompt" }), desc: t('panel.guide.autoGoal.promptD', { defaultValue: "Only the name, one line of description and the file path. The body stays on disk and the agent opens it when the work matches, so twenty procedures still cost almost nothing." }) },
        { title: t('panel.guide.autoGoal.dismissT', { defaultValue: "Turning one down" }), desc: t('panel.guide.autoGoal.dismissD', { defaultValue: "Dismissing a candidate stops the suggestion, it does not erase the observation. The same run can keep happening — procedure detection simply stops offering to write it down." }) },
        { title: t('panel.guide.autoGoal.keepsT', { defaultValue: "Nothing is thrown away" }), desc: t('panel.guide.autoGoal.keepsD', { defaultValue: "Switching it off stops the analysis, not the storage. Procedures already written stay in your project and are yours to keep, and nothing is ever deleted automatically." }) },
      ],
    },
    shortcuts: {
      intro: t('panel.guide.shortcuts.intro', { defaultValue: 'Keyboard shortcuts speed up navigation and editing. They pause while you type in an input or terminal.' }),
      // 목록은 §6 레지스트리가 그린다 — 여기 키를 적지 않으므로 재매핑해도 어긋나지 않고,
      //   mac 기호도 자동이다. 연필을 눌러 이 자리에서 바로 바꿀 수 있다.
      extra: (
        <>
          <ShortcutList />
          <p className="text-[12px] text-gray-500">
            {/* 화면 이름은 보간으로 받는다(§i18n 라벨 참조 규칙 — 박으면 12개 로케일이 틀어진다). */}
            {t('panel.guide.shortcuts.remapNote', {
              options: t('panel.options.title'),
              keyboard: t('panel.options.categories.keyboard'),
              defaultValue: 'Click the pencil on a shortcut to change it — conflicts are checked as you press. {{options}} › {{keyboard}} has the full list with search, import and export.',
            })}
          </p>
        </>
      ),
      entries: [
        // 아래 둘은 **레지스트리에 없는** 동작이다(제스처 · 여러 화면이 각자 처리하는 Esc).
        //   표에 넣으면 "바꿀 수 있다"고 거짓말하는 스위치가 되므로 글로만 남긴다.
        { title: t('panel.guide.shortcuts.inspectorT', { defaultValue: 'Inspector' }), desc: t('panel.guide.shortcuts.inspectorD', { defaultValue: 'Hold Alt to inspect and click to copy an element; Shift-drag for region select.' }) },
        { title: t('panel.guide.shortcuts.closeT', { defaultValue: 'Close & cancel' }), desc: t('panel.guide.shortcuts.closeD', { defaultValue: 'Esc closes menus, popups and the IDE overlay.' }) },
      ],
    },
  }), [t, resolved]);

  if (!open) return null;

  const active = sections[category];

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      <div className="flex h-[640px] max-h-[92dvh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            {t('panel.guide.title', { defaultValue: 'Guide' })}
          </h3>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body — 좌측 사이드바 + 우측 패널 */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — 폰에선 좁혀 본문 공간 확보 */}
          <div className="w-44 shrink-0 overflow-y-auto border-r border-gray-700/50 bg-gray-900/40 py-2 max-md:w-28">
            {categories.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  category === c.key
                    ? 'border-l-2 border-blue-500 bg-blue-500/10 text-white'
                    : 'border-l-2 border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                }`}
              >
                <span className="text-gray-500">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          {/* Right pane */}
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-4">
              <div className="border-b border-gray-700/50 pb-2">
                <h4 className="text-sm font-semibold text-gray-200">
                  {categories.find((c) => c.key === category)?.label}
                </h4>
                <p className="mt-1 text-[12px] text-gray-500">{active.intro}</p>
              </div>

              {active.extra}

              <div className="flex flex-col gap-2">
                {active.entries.map((entry) => (
                  <div
                    key={entry.title}
                    className="rounded-md border border-gray-700/60 bg-gray-900/40 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/80" />
                      <span className="text-xs font-medium text-gray-200">{entry.title}</span>
                    </div>
                    <p className="mt-1 pl-3.5 text-[12px] leading-relaxed text-gray-400">{entry.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer — subtitle as a quiet hint */}
        <div className="border-t border-gray-700 px-4 py-2.5">
          <p className="text-[12px] text-gray-600">
            {t('panel.guide.subtitle', { defaultValue: 'A tour of what Vibisual can do — and an inventory of features built so far.' })}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
