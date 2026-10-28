/**
 * spec-driven — 집행(§5.11 정독 게이트). 판정·문구는 `spec.ts`(순수 함수·시험 고정)에 있고 여기선 id 와 묶기만 한다.
 * ⚠ 카드(`index.tsx`)를 import 하지 않는다 — 서버가 프롬프트 한 줄에 React 를 끌어온다. id 는 문자열로 든다.
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
