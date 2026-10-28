/**
 * §4 앱 테마 — **어두운 판 고정** 속성(어두운 바탕 전제 화면은 라이트에서 글자색만 뒤집혀 사라진다). 아래는 기본 테마 변수가 다시 선언된다
 * (`installThemeLockStyles`). 화면이 테마를 따르게 되면 속성만 뗀다.
 */
import { APP_THEME_LOCK_ATTR } from '@vibisual/shared';

export const DARK_THEME_LOCK = { [APP_THEME_LOCK_ATTR]: 'dark' } as const;
