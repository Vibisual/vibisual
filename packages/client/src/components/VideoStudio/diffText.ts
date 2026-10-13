import type { TFunction } from 'i18next';
import type { DiffLine } from '@vibisual/video';

/**
 * §5.13 (V) 37-3 — 차이 한 줄을 사람 말로. 값 가운데 **코드 낱말**(장면 단계 `plan`·`done`, 전환 `dissolve` 등)은 그대로 끼우면
 * 다른 언어 화면에 영문 코드가 박히므로 먼저 그 언어의 라벨로 바꿔 끼운다. 판 둘 비교와 바뀐 것 카드가 같은 함수를 쓴다.
 */
export function diffLineText(t: TFunction, line: DiffLine): string {
  const values: Record<string, string | number> = { ...line.values };
  const status = values['status'];
  if (typeof status === 'string' && status !== '') {
    values['status'] = t(`panel.videoStudio.chapterStatus.${status}`, { defaultValue: status });
  }
  const transition = values['transition'];
  if (typeof transition === 'string' && transition !== '') {
    values['transition'] = t(`panel.videoStudio.transitions.${transition}`, { defaultValue: transition });
  }
  return t(`panel.videoStudio.diff.${line.kind}`, values);
}
