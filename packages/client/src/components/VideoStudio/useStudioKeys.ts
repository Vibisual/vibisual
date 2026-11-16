import { useCallback, type KeyboardEvent } from 'react';

import { dispatchStudioKey } from './studioCommandKeys.js';
import type { StudioCommandContext } from './studioCommandTypes.js';

export type { StudioKeyActions } from './studioCommandTypes.js';

/**
 * §5.13 (V) 37-1 · 37-22 — 스튜디오 단축키. 키·조건·동작은 명령 등록부(`studioCommands.ts`) 한 장이 갖고, 여기는 뿌리의 키 처리에
 * 잇기만 한다(팔레트와 같은 표 — 판정문 두 벌 ❌). 판정 `ctrlKey || metaKey`, 표시 `shortcutLabel()`. 맨 숫자 키는 쓰지 않는다
 * (캔버스 북마크가 먼저 가져간다). 입력칸·한글 조합 중·팔레트가 열린 동안에는 비켜 선다.
 */
export function useStudioKeys(a: StudioCommandContext): (event: KeyboardEvent<HTMLDivElement>) => void {
  return useCallback((event: KeyboardEvent<HTMLDivElement>): void => { dispatchStudioKey(event, a); }, [a]);
}
