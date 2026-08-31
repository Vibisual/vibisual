// §5.5 #17-19 ③-1 (a) / ⑧ — 경로 한 토막을 **이 창의 명령 입력창**에 넣는다.
//
// 부르는 곳이 둘이라(행 손잡이 · 대화 위에 끌어다 놓기) 배선을 한 벌로 둔다 — 두 벌로 갈라 두면
// 한쪽만 고쳐지고, 그 사실은 "손잡이는 되는데 끌어다 놓으면 안 된다" 로 사용자에게 나타난다.
// 넣는 길 자체는 스킬 사이드바(#17-4 `insertSkill`)가 쓰던 것 그대로다(새 경로 ❌).

import { useCallback } from 'react';
import { useGraphStore, agentSessionInputKey } from '../../stores/graphStore.js';
import { appendPathToInput } from './explorerModel.js';
import { useIDEPaneValue } from './idePane.js';
import { autosizeInput } from './inputAutosize.js';

/**
 * @returns 절대 경로를 받아 입력창 끝에 붙이는 함수. **넣을 자리가 없으면 `false`** 를 돌려준다
 *          (#17-29 — 훅 버블은 전면 읽기 전용이라 입력창 자체가 없다). 부르는 쪽이 그 사실을
 *          알아야 "넣었다"는 표시를 거짓으로 띄우지 않는다.
 */
export function useInsertPathIntoInput(agentId: string): (fullPath: string) => boolean {
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const isCustom = useGraphStore((s) => s.nodeMap[agentId]?.customCreated ?? false);
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);

  return useCallback((fullPath: string): boolean => {
    if (!isCustom || !fullPath) return false;
    const insert = `${fullPath} `;
    // CMD(인터랙티브 터미널)는 store 가 아니라 PTY 입력행에 직접 친다(같은 규약, #17-4 선례).
    if (executionMode === 'interactive-terminal' && window.api?.terminal) {
      const termId = `term:${agentId}:${activeSessionId ?? 'main'}`;
      void window.api.terminal.write(termId, insert);
      return true;
    }
    const key = agentSessionInputKey(agentId, activeSessionId);
    const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
    setAgentSessionInputText(agentId, activeSessionId, appendPathToInput(existing, fullPath));
    requestAnimationFrame(() => {
      const sessionAttr = activeSessionId ?? '';
      const ta = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-ide-input="${agentId}"][data-ide-input-session="${sessionAttr}"]`,
      );
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      // ⚠ 인라인 height 직접 조작 금지 — field-sizing 환경에서 명시 height 를 남기면 자동 확장이 죽는다.
      autosizeInput(ta);
    });
    return true;
  }, [agentId, activeSessionId, isCustom, executionMode, setAgentSessionInputText]);
}
