import { useCallback, useSyncExternalStore } from 'react';

interface QuestionCardState {
  answered: Record<number, number>;
  selected: Record<number, Set<number>>;
  customAnswers: Record<number, string>;
}

/** 가상 목록/탭 이동을 견디는 표시용 초안. 디스크에는 저장하지 않는다. */
const EMPTY: QuestionCardState = { answered: {}, selected: {}, customAnswers: {} };
export const QUESTION_CARD_CACHE_MAX = 50;
export const QUESTION_ANSWER_MAX_LENGTH = 20_000;
const states = new Map<string, QuestionCardState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 오래된 카드부터 회수한다. 카드 id는 서버가 발급한 전역 고유 id다. */
export function useQuestionCardState(id: string): [QuestionCardState, (update: (prev: QuestionCardState) => QuestionCardState) => void] {
  const getSnapshot = useCallback(() => states.get(id) ?? EMPTY, [id]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const updateState = useCallback((update: (prev: QuestionCardState) => QuestionCardState) => {
    const next = update(states.get(id) ?? EMPTY);
    states.delete(id);
    states.set(id, next);
    while (states.size > QUESTION_CARD_CACHE_MAX) {
      const oldest = states.keys().next().value;
      if (oldest === undefined) break;
      states.delete(oldest);
    }
    listeners.forEach((listener) => listener());
  }, [id]);
  return [state, updateState];
}

/** 테스트·초기화용. */
export function resetQuestionCardState(): void {
  states.clear();
  listeners.forEach((listener) => listener());
}
