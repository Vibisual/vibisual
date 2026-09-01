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
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';

type CategoryKey =
  | 'start'
  | 'bubbleMap'
  | 'memory'
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
    { key: 'memory', label: t('panel.guide.cat.memory', { defaultValue: 'Project Memory' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M7 7.5V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-1.5"/><path d="M5 14h7M5 17h4.5"/></svg>
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

  const sections = useMemo<Record<CategoryKey, { intro: string; entries: GuideEntry[] }>>(() => ({
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
        { title: t('panel.guide.navigation.copyT', { defaultValue: 'Copy & paste' }), desc: t('panel.guide.navigation.copyD', { copy: shortcutLabel('Ctrl+C'), paste: shortcutLabel('Ctrl+V'), defaultValue: 'Select custom agents and edges, then {{copy}} / {{paste}} to clone them into another project.' }) },
      ],
    },
    history: {
      intro: t('panel.guide.history.intro', { defaultValue: 'Vibisual remembers your projects between runs.' }),
      entries: [
        { title: t('panel.guide.history.saveT', { defaultValue: 'Automatic saving' }), desc: t('panel.guide.history.saveD', { defaultValue: 'The whole graph is checkpointed to disk and restored the next time you open Vibisual.' }) },
        { title: t('panel.guide.history.replayT', { defaultValue: 'History replay' }), desc: t('panel.guide.history.replayD', { defaultValue: 'Scrub a timeline to replay how the map grew over a session.' }) },
      ],
    },
    memory: {
      intro: t('panel.guide.memory.intro', { defaultValue: "Project Memory keeps what worked and loads it back into your next task. It ships turned off — you switch it on per project, and switching it off never deletes anything." }),
      entries: [
        { title: t('panel.guide.memory.turnOnT', { defaultValue: "Turning it on" }), desc: t('panel.guide.memory.turnOnD', { defaultValue: "Right-click empty canvas and pick \"Turn on Project Memory\", or open File > Options > Project Memory. It applies immediately — no restart." }) },
        { title: t('panel.guide.memory.bubbleT', { defaultValue: "The memory bubble" }), desc: t('panel.guide.memory.bubbleD', { defaultValue: "Once on, an indigo bubble sits on the canvas with the number of stored cards. Double-click it to open the library; hover for a summary." }) },
        { title: t('panel.guide.memory.skillsT', { defaultValue: "Procedural memory" }), desc: t('panel.guide.memory.skillsD', { defaultValue: "When a complex job finishes, the steps are distilled into a procedure. Next time a similar task starts, that procedure is loaded into the prompt automatically." }) },
        { title: t('panel.guide.memory.recallT', { defaultValue: "Recall" }), desc: t('panel.guide.memory.recallD', { defaultValue: "Searches the text of past sessions, not just saved cards — for the answer that was never written down as a card." }) },
        { title: t('panel.guide.memory.groundingT', { defaultValue: "Grounding" }), desc: t('panel.guide.memory.groundingD', { defaultValue: "A card is only treated as current truth after the files it points at are checked against the code that exists right now." }) },
        { title: t('panel.guide.memory.curatorT', { defaultValue: "Curator" }), desc: t('panel.guide.memory.curatorD', { defaultValue: "Cards that were never read, never classified, or are still candidates collect in one rail so you can sort or promote them in a batch." }) },
        { title: t('panel.guide.memory.operatorT', { defaultValue: "Operator profile" }), desc: t('panel.guide.memory.operatorD', { defaultValue: "Working habits it notices are stored on this machine only. Nothing is sent anywhere." }) },
        { title: t('panel.guide.memory.railsT', { defaultValue: "The five rails" }), desc: t('panel.guide.memory.railsD', { defaultValue: "The library\\u2019s left column: Needs check, Pending review, Procedures, To sort, Archived." }) },
        { title: t('panel.guide.memory.keepsT', { defaultValue: "Nothing is thrown away" }), desc: t('panel.guide.memory.keepsD', { defaultValue: "Turning memory off stops the work, not the storage. Cards stay on disk under .vibisual/brain and pick up where they left off when you switch it back on." }) },
      ],
    },
    shortcuts: {
      intro: t('panel.guide.shortcuts.intro', { defaultValue: 'Keyboard shortcuts speed up navigation and editing. They pause while you type in an input or terminal.' }),
      entries: [
        { title: t('panel.guide.shortcuts.bookmarkT', { defaultValue: 'Bubble bookmarks' }), desc: t('panel.guide.shortcuts.bookmarkD', { defaultValue: 'Alt+1…0 pins a bubble or session to a slot; press 1…0 to jump back to it.' }) },
        // §5.5 #17-37 — Tab 계열은 mac 에서 Command 가 아니라 진짜 Control 이다(Cmd+Tab 은 OS 앱 전환).
        { title: t('panel.guide.shortcuts.sessionTabsT', { defaultValue: 'Session tabs' }), desc: t('panel.guide.shortcuts.sessionTabsD', { cycle: shortcutLabel('Control+Tab'), cycleBack: shortcutLabel('Control+Shift+Tab'), pageNext: shortcutLabel('Ctrl+PageDown'), pagePrev: shortcutLabel('Ctrl+PageUp'), first: shortcutLabel('Ctrl+1'), last: shortcutLabel('Ctrl+9'), defaultValue: '{{cycle}} / {{cycleBack}} steps to the next or previous session tab in the front IDE window, and {{pageNext}} / {{pagePrev}} do the same. {{first}}…{{last}} jumps straight to the Nth tab; {{last}} is always the last one.' }) },
        { title: t('panel.guide.shortcuts.copyT', { defaultValue: 'Copy / paste' }), desc: t('panel.guide.shortcuts.copyD', { copy: shortcutLabel('Ctrl+C'), paste: shortcutLabel('Ctrl+V'), defaultValue: '{{copy}} / {{paste}} copies and pastes selected agents, edges and comment boxes.' }) },
        { title: t('panel.guide.shortcuts.inspectorT', { defaultValue: 'Inspector' }), desc: t('panel.guide.shortcuts.inspectorD', { defaultValue: 'Hold Alt to inspect and click to copy an element; Shift-drag for region select.' }) },
        { title: t('panel.guide.shortcuts.closeT', { defaultValue: 'Close & cancel' }), desc: t('panel.guide.shortcuts.closeD', { defaultValue: 'Esc closes menus, popups and the IDE overlay.' }) },
      ],
    },
  }), [t]);

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
