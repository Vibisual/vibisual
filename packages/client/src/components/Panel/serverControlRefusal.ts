/**
 * §7.11 / §3.5 — Stop/Restart 를 서버가 **다른 프로젝트의 서버라서** 거절했는가.
 *
 * 한 포트에 주인이 둘이면(옆 프로젝트 vite 가 `[::1]`, 우리 서버가 `::`) 위성 주소가 닿는 리스너가 다른
 * 열린 프로젝트의 것일 수 있다. 서버는 그때 죽이지도 넘겨받지도 않고 `refused: 'foreign'` 으로 답한다
 * (Stop = 200, Restart = 409). 이걸 읽지 않으면 버튼을 눌러도 아무 일이 없는 채로 남아 사용자가 이유를
 * 알 길이 없다(인계 실패 `takeoverFailed` 를 화면까지 흘려보내는 것과 같은 이유).
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
