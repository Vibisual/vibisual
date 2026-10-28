import koffi from 'koffi';

// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 ② 첫 표시 — dwmapi 의 `DwmSetWindowAttribute` 하나만 묶는다(Windows 전용).
// `windowCloak.ts` 가 Windows 에서 처음 가릴 때만 동적으로 읽는다 — 시작 청크에 koffi 가 실려 다른 OS 스플래시까지 늦추지 않게.
// koffi 는 다른 곳(`winJobObject.ts` 등)과 같은 입구(정적 import → 빌드가 require 로 낸다)로 읽는다 — `import('koffi')` 는 ESM 입구를 타 같은 네이티브 모듈을 JS 사본 둘이 나눠 쥔다.

export type DwmSetWindowAttribute = (hwnd: bigint, attribute: number, value: Buffer, size: number) => number;

export function bindDwmSetWindowAttribute(): DwmSetWindowAttribute {
  return koffi.load('dwmapi.dll').func(
    'int __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, const void *pvAttribute, uint32_t cbAttribute)',
  ) as unknown as DwmSetWindowAttribute;
}
