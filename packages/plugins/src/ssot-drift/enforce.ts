/**
 * §5.11 — SSOT 플러그인의 집행 기여(`agentPrompt`). 판정·문구는 `ssot.ts`(순수 함수·시험 고정)에 있고 여기선 id 와 묶기만 한다.
 * ⚠ 카드(`index.tsx`)를 import 하지 않는다 — 서버가 프롬프트 한 줄에 React 를 끌어온다. id 는 문자열로 든다.
 */
import type { PluginPromptModule } from '../sdk/index.js';
import { buildSsotPromptBlock, surveySsotFacts } from './ssot.js';

export const SSOT_DRIFT_ID = 'ssot-drift';

export const enforcement: PluginPromptModule = {
  id: SSOT_DRIFT_ID,
  buildBlock: buildSsotPromptBlock,
  // 프롬프트의 판단 근거를 카드가 같은 값으로 그리게 한다(둘 다 `surveySsot` 에서 나온다).
  survey: surveySsotFacts,
};
