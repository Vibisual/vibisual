/**
 * §5.11 v4.57 — SSOT 플러그인의 집행 기여(`agentPrompt`).
 *
 * 판정·문구는 전부 `ssot.ts`(순수 함수)에 있고 여기서는 id 와 묶기만 한다 — 규율을 바꾸려면 테스트가
 * 걸려 있는 그 파일 하나만 고치면 되게 하기 위해서다.
 *
 * ⚠ **카드(`index.tsx`)를 import 하지 않는다.** 그것을 물면 서버가 프롬프트 한 줄 만들려고 React 를
 * 끌어온다(집행 배럴은 서버 전용). id 는 문자열로 직접 든다.
 */
import type { PluginPromptModule } from '../sdk/index.js';
import { buildSsotPromptBlock, surveySsotFacts } from './ssot.js';

export const SSOT_DRIFT_ID = 'ssot-drift';

export const enforcement: PluginPromptModule = {
  id: SSOT_DRIFT_ID,
  buildBlock: buildSsotPromptBlock,
  // v4.65 — 프롬프트에 실은 판단 근거를 카드가 같은 값으로 그리게 한다(둘 다 `surveySsot` 하나에서 나온다).
  survey: surveySsotFacts,
};
