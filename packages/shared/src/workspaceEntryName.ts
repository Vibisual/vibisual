/**
 * workspaceEntryName.ts — §5.5 #17-19 ⑦ 탐색기가 **새로 만들거나 바꿔 다는 이름**의 판정.
 *
 * 화면(입력창)과 디스크(서버)가 **같은 규칙 하나**를 봐야 한다 — 클라이언트가 통과시킨 이름을
 * 서버가 거절하면 사용자는 "왜 안 되는지 모른 채" 같은 이름을 다시 친다. 그래서 판정은 순수
 * 함수 하나로 shared 에 두고 양쪽이 그것만 부른다.
 *
 * ⚠ 규칙은 **셋 중 가장 좁은 것(Windows)** 을 세 OS 에 똑같이 적용한다. 리눅스에서는 `a:b.txt`
 * 가 만들어지지만 그 저장소를 Windows 에서 체크아웃하는 순간 그 파일은 꺼낼 수 없다 —
 * 만드는 자리에서 막는 것이 그 사람에게도, 그 저장소를 받는 다음 사람에게도 낫다.
 * 플랫폼 분기를 두지 않으므로 `platform` 인자도 없다(어디서 돌아도 같은 답).
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

/**
 * 이 이름으로 파일·폴더를 만들 수 있는가. 만들 수 있으면 `null`, 아니면 그 사유.
 *
 * 이름 **한 조각**만 받는다(경로 ❌ — 부모 폴더는 호출부가 이미 알고 있다).
 */
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
