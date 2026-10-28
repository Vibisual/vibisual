/**
 * §5.5 #17-19 ⑦ 탐색기의 새 이름 판정 — 입력창과 서버가 이 한 함수만 부른다(어긋나면 이유 모를 거절이 된다).
 * ⚠ 가장 좁은 Windows 규칙을 세 OS 에 건다 — 리눅스에서 만든 `a:b.txt` 는 Windows 체크아웃에서 꺼낼 수 없다. 그래서 `platform` 인자가 없다.
 */

/** 이름을 거절하는 사유 — 화면은 이 값으로 번역문을 고른다(문구를 여기서 만들지 않는다). */
export type WorkspaceEntryNameError =
  /** 빈 이름 · 공백뿐 */
  | 'empty'
  /** `/` 나 `\` 가 들어 있다 — 이름이지 경로가 아니다 */
  | 'separator'
  /** `.` · `..` — 상위/자기 자신을 가리키는 이름 */
  | 'traversal'
  /** Windows 가 금지하는 글자(`<>:"|?*`) 또는 제어 문자 */
  | 'invalid-char'
  /** 끝이 마침표·공백 — Windows 에서 만들어도 열리지 않는 이름이 된다 */
  | 'trailing'
  /** `CON`·`NUL`·`COM1` 같은 Windows 예약 장치 이름 */
  | 'reserved'
  /** 255자 초과 — 대부분의 파일시스템이 한 조각에 허용하는 상한 */
  | 'too-long';

/** 한 조각(이름) 길이 상한 — ext4·APFS·NTFS 가 공통으로 받는 값. */
export const WORKSPACE_ENTRY_NAME_MAX = 255;

/**
 * Windows 예약 장치 이름 — 확장자가 붙어도(`CON.txt`) 여전히 예약이다.
 * `COM0`·`LPT0` 은 최신 Windows 에서만 예약이라 함께 막는다(막아서 잃는 것이 없다).
 */
const RESERVED_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Windows 파일명이 받지 않는 글자. 구분자(`/` `\`)는 사유를 따로 주려고 여기서 뺐다. */
const INVALID_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*']);

/** 만들 수 있으면 `null`, 아니면 사유. 이름 한 조각만 받는다(경로 ❌). */
export function workspaceEntryNameError(name: string): WorkspaceEntryNameError | null {
  if (name.length === 0 || name.trim().length === 0) return 'empty';
  if (name.length > WORKSPACE_ENTRY_NAME_MAX) return 'too-long';
  if (name.includes('/') || name.includes('\\')) return 'separator';
  if (name === '.' || name === '..') return 'traversal';

  for (const ch of name) {
    // 제어 문자(0x00~0x1f)는 세 OS 어디서도 정상 이름이 아니다.
    if (ch.charCodeAt(0) < 0x20) return 'invalid-char';
    if (INVALID_CHARS.has(ch)) return 'invalid-char';
  }

  const last = name[name.length - 1];
  if (last === '.' || last === ' ') return 'trailing';
  // 앞 공백은 만들 수는 있지만 목록에서 이름이 밀려 보여 사고의 원인이 된다 — 같은 사유로 막는다.
  if (name[0] === ' ') return 'trailing';

  const base = (name.split('.')[0] ?? '').toUpperCase();
  if (RESERVED_BASENAMES.has(base)) return 'reserved';

  return null;
}
