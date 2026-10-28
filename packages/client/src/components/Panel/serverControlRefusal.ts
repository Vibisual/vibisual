/**
 * §7.11 / §3.5 — 위성 주소의 리스너가 다른 열린 프로젝트 것이면 서버는 손대지 않고 `refused: 'foreign'` 으로 답한다(Stop 200, Restart 409).
 * 읽지 않으면 버튼이 아무 일 없이 남는다(`takeoverFailed` 를 흘리는 것과 같은 이유).
 */
export function isRefusedForOtherProject(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>)['refused'] === 'foreign';
}

/** 응답 본문을 읽어 거절 여부만 돌려준다. 본문이 JSON 이 아니면 거절 아님. */
export async function refusedForOtherProject(res: Response): Promise<boolean> {
  try {
    return isRefusedForOtherProject(await res.json());
  } catch {
    return false;
  }
}
