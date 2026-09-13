/**
 * spec-driven — 집행(§5.11 정독 게이트).
 *
 * v4.59 의 이 파일은 고정 두 줄이었다("명세를 먼저 읽어라"). 부탁은 지켜졌는지 잴 수 없어서, 실제로는
 * 대충 보고 "확인했다"로 끝나는 것을 하나도 못 막았다 — 사용자가 겪은 문제가 정확히 그것이다.
 *
 * 그래서 이 카드는 `ssot-drift` 와 같은 자리로 올라간다. 판정·문구는 전부 `spec.ts`(순수 함수)에 있고
 * 여기서는 id 와 묶기만 한다 — 규율을 바꾸려면 테스트가 걸려 있는 그 파일 하나만 고치면 되게.
 *
 * ⚠ **카드(`index.tsx`)를 import 하지 않는다.** 그것을 물면 서버가 프롬프트 한 줄 만들려고 React 를
 * 끌어온다(집행 배럴은 서버 전용). id 는 문자열로 직접 든다.
 */
import type { PluginPromptModule } from '../sdk/index.js';
import { buildSpecPromptBlock, surveySpecFacts } from './spec.js';

export const SPEC_DRIVEN_ID = 'spec-driven';

export const enforcement: PluginPromptModule = {
  id: SPEC_DRIVEN_ID,
  buildBlock: buildSpecPromptBlock,
  // 프롬프트에 실은 판단 근거를 카드·활동바가 같은 값으로 그린다(둘 다 `evaluateSpecReading` 하나에서 나온다).
  survey: surveySpecFacts,
};
