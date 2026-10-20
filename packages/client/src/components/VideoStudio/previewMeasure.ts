import { ctxTextMeasure, estimateTextMeasure, type TextMeasure } from '@vibisual/video';

let measure: TextMeasure | null = null;

/**
 * §5.13 (V) 37-6 — 캔버스 미리보기의 기본 씬 글자 폭을 **그리기와 같은 캔버스로** 잰다(가리킨 자리와 그림이 어긋나지 않게).
 * 캔버스를 못 만드는 자리(시험)는 어림으로 물러난다. 하나만 만들어 계속 쓴다 — 마우스 이동마다 재기 때문이다.
 */
export function previewTextMeasure(): TextMeasure {
  if (measure) return measure;
  const ctx = typeof document !== 'undefined' && typeof document.createElement === 'function'
    ? document.createElement('canvas').getContext('2d')
    : null;
  measure = ctx ? ctxTextMeasure(ctx) : estimateTextMeasure;
  return measure;
}
