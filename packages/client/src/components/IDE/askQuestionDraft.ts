import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@vibisual/shared';

type AskItem = AskUserQuestionRequest['items'][number];

/** 한 step 의 사용자 입력 작업 상태 — 옵션 선택 set + note 텍스트. "Other" 는 모델 옵션 다음 인덱스. */
export interface StepDraft {
  selected: Set<number>;
  note: string;
}

export const emptyStepDraft = (): StepDraft => ({ selected: new Set<number>(), note: '' });

/** step draft → 서버로 보낼 답. Other 를 골랐으면 note 가 그 답 라벨이 된다(note 칸으로 따로 싣지 않는다). */
export function compileAnswer(draft: StepDraft, item: AskItem | undefined): AskUserQuestionAnswer {
  if (!item) return { selectedLabels: [] };
  const otherIdx = item.options.length;
  const otherSelected = draft.selected.has(otherIdx);
  const note = draft.note.trim();
  const labels = Array.from(draft.selected)
    .filter((i) => i !== otherIdx)
    .sort((a, b) => a - b)
    .map((i) => item.options[i]?.label)
    .filter((l): l is string => typeof l === 'string');
  const answer: AskUserQuestionAnswer = { selectedLabels: otherSelected ? [...labels, note] : labels };
  if (!otherSelected && note) answer.note = note;
  return answer;
}

/** `compileAnswer` 의 역 — 보내지 못해 되돌아온 카드가 고른 답을 그대로 다시 보여 준다(§5.3 #12-2). */
export function draftFromAnswer(item: AskItem, answer: AskUserQuestionAnswer | undefined): StepDraft {
  const draft = emptyStepDraft();
  if (!answer) return draft;
  draft.note = answer.note ?? '';
  for (const label of answer.selectedLabels) {
    const idx = item.options.findIndex((o) => o.label === label);
    if (idx >= 0) {
      draft.selected.add(idx);
    } else {
      draft.selected.add(item.options.length);
      draft.note = label;
    }
  }
  return draft;
}
