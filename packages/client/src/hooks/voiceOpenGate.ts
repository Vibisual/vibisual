/**
 * §5.5 #17-38 — **마이크를 켜는 몇 초 동안의 규율**(순수 — 단위 테스트). 엔진이 없으면 서버가 그때 띄워(`ensureVoiceEngine`, 3분 유휴면 내림) 켜기가 몇 초 걸리고 사람은 다시 누른다.
 * 참·거짓 "여는 중" 가드로 막지 마라(최대 20초 동안 다시 켜기가 버려진다) — **세대**를 센다: 누를 때마다 오르고 최신 세대만 자원을 심는다.
 */

export interface VoiceOpenGate {
  /**
   * 새 켜기를 시작한다 — **거절하지 않는다.** 앞서 돌던 켜기는 이 순간 낡은 것이 된다.
   * 돌려주는 값이 그 켜기의 표이고, 이후 판정은 전부 이 표로 한다.
   */
  begin: () => number;
  /** 이 표가 아직 최신인가. 아니면 그 흐름은 자원을 심지 말고 물러나야 한다. */
  isCurrent: (token: number) => boolean;
  /** 도는 켜기를 전부 낡은 것으로 만든다(끄기·정리·창 닫힘). */
  abandon: () => void;
}

export function createVoiceOpenGate(): VoiceOpenGate {
  let generation = 0;
  return {
    begin: (): number => {
      generation += 1;
      return generation;
    },
    isCurrent: (token: number): boolean => token === generation,
    abandon: (): void => {
      generation += 1;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 엔진 포트 받아 오기 — "안 받았다" 와 "못 띄웠다" 를 가른다
// ─────────────────────────────────────────────────────────────────────────────

/** 켜기 한 번이 엔진에 닿은 결과. 사유를 `null` 하나로 뭉치지 마라 — 잠깐 못 닿은 것까지 "아직 안 받았다"가 되어 받아 둔 사람에게 설치 창이 뜬다. */
export type VoicePortResult =
  | { ok: true; port: number }
  | { ok: false; reason: 'needs-install' }
  | { ok: false; reason: 'engine-failed' };

export interface VoicePortDeps {
  /**
   * 지금까지 알고 있는 준비 상태(창이 뜰 때 한 번 물어 둔 값). 아직 모르면 `null`.
   * 이 값이 참이면 **묻는 왕복 한 번을 건너뛴다** — 누름과 마이크 사이는 짧을수록 좋다.
   */
  knownReady: boolean | null;
  /** 서버에게 디스크를 다시 보게 한다. 못 물어봤으면 `null`(= 아직 모름, ≠ 없음). */
  refresh: () => Promise<boolean | null>;
  /** 엔진을 띄우고 포트를 받는다. 못 받으면 `null`. */
  openSession: () => Promise<number | null>;
}

/** **판정 정본은 끝까지 서버(=디스크)다.** 아는 값은 왕복을 건너뛰는 데만 쓴다 — 틀렸으면(폴더를 지웠으면) 다음 걸음 `openSession` 이 실패해 다시 묻는다. */
export async function resolveVoicePort(deps: VoicePortDeps): Promise<VoicePortResult> {
  const ready = deps.knownReady === true ? true : await deps.refresh();
  // 없는 것이 확인됐을 때만 설치 창이다. 모르면(`null`) 일단 열어 본다 — 물어보다 실패한 것을
  //   "안 받았다"로 옮기면, 받아 둔 사람이 누를 때마다 설치 창을 보게 된다.
  if (ready === false) return { ok: false, reason: 'needs-install' };

  const port = await deps.openSession();
  if (port !== null) return { ok: true, port };

  // 못 띄웠다. 이 순간의 디스크가 답을 가른다: 지웠으면 설치 안내, 있는데 안 뜨면 실패 사유.
  const after = await deps.refresh();
  return { ok: false, reason: after === false ? 'needs-install' : 'engine-failed' };
}
