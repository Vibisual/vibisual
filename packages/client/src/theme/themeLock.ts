/**
 * §4 앱 테마 — **어두운 판 고정**을 붙이는 속성 묶음.
 *
 * 고정 어두운 바탕을 전제로 칠한 화면(내부 앱 화면·캔버스 앱 노드의 미디어 면)은 라이트 테마에서
 * 글자색(`text-white` 등)만 뒤집히고 바탕은 그대로라 글자가 사라진다. 이 속성을 단 요소 아래는
 * 기본 테마의 변수가 다시 선언돼(`appThemeEngine.installThemeLockStyles`) 종전 화면 그대로 칠해진다.
 * 그 화면들이 테마를 따라가게 되면 이 속성을 떼면 된다 — 그 화면의 코드는 그대로다.
 */
import { APP_THEME_LOCK_ATTR } from '@vibisual/shared';

export const DARK_THEME_LOCK = { [APP_THEME_LOCK_ATTR]: 'dark' } as const;
